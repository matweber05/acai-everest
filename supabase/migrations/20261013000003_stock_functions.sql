-- =====================================================================
-- Açaí Everest — Migration 003: funções transacionais de estoque
--
-- COMO O SALDO É CALCULADO
--   saldo(produto) = Σ quantidade das movimentações de entrada
--                  − Σ quantidade das movimentações de saída
--   stock_balances guarda esse valor já somado (cache), atualizado na MESMA
--   transação que insere a movimentação. public.check_stock_integrity() compara
--   o cache com a soma real e public.rebuild_stock_balances() reconstrói tudo.
--
-- CUSTO
--   Custo médio ponderado móvel. Entradas entram pelo custo informado; saídas
--   saem pelo custo médio do momento (fica gravado em unit_cost da movimentação).
--   Valor do estoque = Σ(entradas × custo) − Σ(saídas × custo gravado).
--
-- CONCORRÊNCIA
--   Toda operação trava (SELECT ... FOR UPDATE) as linhas de saldo envolvidas,
--   sempre em ordem crescente de product_id para evitar deadlock. Duas vendas
--   simultâneas do último item: a segunda espera a primeira terminar e então
--   recebe "Estoque insuficiente".
--
-- IDEMPOTÊNCIA
--   Cada chamada envia p_request_id (UUID gerado no cliente ao abrir o
--   formulário). Repetições (clique duplo, nova tentativa de rede) devolvem o
--   mesmo resultado sem gerar novas movimentações.
--
-- ESTORNO
--   Movimentações nunca são apagadas nem editadas. Um erro é corrigido com
--   uma movimentação de sentido oposto, mesma quantidade e mesmo custo,
--   ligada à original (reverses_movement_id / reversed_by_movement_id).
-- =====================================================================

-- ---------- utilidades ----------
create or replace function public._store_today(p_store uuid) returns date
language sql stable security definer set search_path = public as $$
  select (now() at time zone coalesce((select timezone from public.stores where id = p_store), 'America/Sao_Paulo'))::date
$$;

create or replace function public._next_number(p_store uuid, p_key text) returns bigint
language sql security definer set search_path = public as $$
  insert into public.store_counters(store_id, key, value) values (p_store, p_key, 1)
  on conflict (store_id, key) do update set value = public.store_counters.value + 1
  returning value
$$;

-- Retorna o resultado anterior se o request_id já foi processado (e trava o id).
create or replace function public._idem_begin(p_store uuid, p_request uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if p_request is null then return null; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_store::text || p_request::text, 0));
  select result into v from public.operation_requests where store_id = p_store and request_id = p_request;
  return v;
end $$;

create or replace function public._idem_end(p_store uuid, p_request uuid, p_op text, p_result jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if p_request is not null then
    insert into public.operation_requests(store_id, request_id, operation, result, created_by)
    values (p_store, p_request, p_op, p_result, auth.uid());
  end if;
  return p_result;
end $$;

-- Garante a linha de saldo e trava produtos em ordem (anti-deadlock).
create or replace function public._lock_balances(p_store uuid, p_products uuid[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.stock_balances(product_id, store_id)
  select distinct p, p_store from unnest(p_products) p
  on conflict (product_id) do nothing;
  perform 1 from public.stock_balances
   where product_id = any(p_products) and store_id = p_store
   order by product_id for update;
end $$;

-- Formata quantidade no padrão brasileiro (1.050 -> "1,05")
create or replace function public._fmt_qty(p numeric) returns text language sql immutable as $$
  select replace(rtrim(rtrim(to_char(p, 'FM999999999990.000'), '0'), '.'), '.', ',')
$$;

-- ---------- núcleo: aplica UMA movimentação ----------
create or replace function public._apply_movement(
  p_store uuid,
  p_product uuid,
  p_direction public.movement_direction,
  p_reason public.movement_reason,
  p_qty numeric,
  p_op uuid,
  p_unit_cost numeric default null,
  p_occurred_at timestamptz default null,
  p_supplier uuid default null,
  p_document_ref text default null,
  p_notes text default null,
  p_lot_code text default null,
  p_expiry date default null,
  p_lot_id uuid default null,
  p_purchase_id uuid default null,
  p_sale_id uuid default null,
  p_sale_item_id uuid default null,
  p_inventory_id uuid default null,
  p_reverses uuid default null
) returns public.stock_movements
language plpgsql security definer set search_path = public as $$
declare
  v_prod public.products;
  v_unit public.units;
  v_store public.stores;
  v_bal public.stock_balances;
  v_orig public.stock_movements;
  v_mov public.stock_movements;
  v_cost numeric;
  v_new_qty numeric;
  v_new_avg numeric;
  v_lot_id uuid;
  v_negative boolean := false;
  v_lot record;
  v_take numeric;
  v_rem numeric;
  v_allocs jsonb := '[]'::jsonb;
  v_lot_sum numeric;
  v_untracked numeric;
  v_expired_sum numeric;
  v_today date;
  v_alloc record;
begin
  if p_qty is null or p_qty <= 0 then
    raise exception 'A quantidade deve ser maior que zero.' using errcode = '22023';
  end if;
  select * into v_prod from public.products where id = p_product and store_id = p_store;
  if v_prod.id is null then raise exception 'Produto não encontrado nesta loja.' using errcode = 'P0002'; end if;
  if v_prod.stock_mode = 'recipe' then
    raise exception '"%" é baixado por ficha técnica e não tem estoque próprio.', v_prod.name using errcode = '22023';
  end if;
  select * into v_unit from public.units where id = v_prod.unit_id;
  if not v_unit.allows_decimal and p_qty <> trunc(p_qty) then
    raise exception 'A unidade "%" não aceita quantidades fracionadas.', v_unit.code using errcode = '22023';
  end if;
  select * into v_store from public.stores where id = p_store;
  v_today := public._store_today(p_store);

  if p_reverses is not null then
    select * into v_orig from public.stock_movements where id = p_reverses and store_id = p_store for update;
  end if;

  perform public._lock_balances(p_store, array[p_product]);
  select * into v_bal from public.stock_balances where product_id = p_product for update;

  -- custo
  v_cost := coalesce(p_unit_cost,
                     case when v_bal.avg_cost > 0 then v_bal.avg_cost else v_prod.cost_price end, 0);
  if v_cost < 0 then raise exception 'O custo não pode ser negativo.' using errcode = '22023'; end if;

  if p_direction = 'in' then
    v_new_qty := v_bal.quantity + p_qty;
    v_new_avg := case when v_bal.quantity <= 0 then v_cost
                      else round((v_bal.quantity * v_bal.avg_cost + p_qty * v_cost) / v_new_qty, 4) end;

    if v_orig.id is not null then
      -- estorno de uma saída: devolve aos mesmos lotes
      for v_alloc in select * from public.stock_movement_lots where movement_id = v_orig.id loop
        update public.stock_lots set remaining_qty = remaining_qty + v_alloc.quantity where id = v_alloc.lot_id;
        v_allocs := v_allocs || jsonb_build_object('lot_id', v_alloc.lot_id, 'qty', v_alloc.quantity);
      end loop;
    elsif v_prod.track_lots or v_prod.track_expiry then
      if v_prod.track_expiry and p_expiry is null and p_reason not in ('inventory_adjustment') then
        raise exception 'Informe a data de validade de "%".', v_prod.name using errcode = '22023';
      end if;
      insert into public.stock_lots(store_id, product_id, lot_code, received_qty, remaining_qty, received_at,
                                    expiry_date, supplier_id, unit_cost, purchase_id, created_by)
      values (p_store, p_product, nullif(trim(coalesce(p_lot_code, '')), ''), p_qty, p_qty,
              coalesce(p_occurred_at, now()), p_expiry, p_supplier, v_cost, p_purchase_id, auth.uid())
      returning id into v_lot_id;
    end if;
  else
    v_new_qty := v_bal.quantity - p_qty;
    v_new_avg := v_bal.avg_cost;
    if v_orig.id is not null and v_orig.direction = 'in' then
      -- estorno de entrada: remove o valor que entrou
      v_new_avg := case when v_new_qty > 0
                        then greatest(round((v_bal.quantity * v_bal.avg_cost - p_qty * v_cost) / v_new_qty, 4), 0)
                        else v_bal.avg_cost end;
    end if;

    if v_new_qty < 0 then
      if v_store.allow_negative_stock then
        v_negative := true;
      else
        raise exception 'Estoque insuficiente para "%": disponível % %, solicitado % %.',
          v_prod.name, public._fmt_qty(greatest(v_bal.quantity,0)), v_unit.code,
          public._fmt_qty(p_qty), v_unit.code
          using errcode = 'P0001', hint = 'insufficient_stock';
      end if;
    end if;

    if v_prod.track_lots or v_prod.track_expiry or exists (select 1 from public.stock_lots where product_id = p_product and remaining_qty > 0) then
      if v_orig.id is not null and v_orig.direction = 'in' and v_orig.lot_id is not null then
        select * into v_lot from public.stock_lots where id = v_orig.lot_id for update;
        if v_lot.remaining_qty < p_qty then
          raise exception 'Não é possível estornar: o lote desta entrada já foi parcialmente consumido (restam % de %).',
            public._fmt_qty(v_lot.remaining_qty), public._fmt_qty(p_qty) using errcode = 'P0001';
        end if;
        update public.stock_lots set remaining_qty = remaining_qty - p_qty where id = v_lot.id;
        v_allocs := v_allocs || jsonb_build_object('lot_id', v_lot.id, 'qty', p_qty);
      else
        select coalesce(sum(remaining_qty), 0),
               coalesce(sum(remaining_qty) filter (where expiry_date < v_today), 0)
          into v_lot_sum, v_expired_sum
          from public.stock_lots where product_id = p_product and remaining_qty > 0;
        v_untracked := greatest(v_bal.quantity - v_lot_sum, 0);
        v_rem := p_qty;
        -- FEFO: lote escolhido primeiro, depois o que vence antes
        for v_lot in
          select * from public.stock_lots
           where product_id = p_product and remaining_qty > 0
             and (p_reason <> 'sale' or expiry_date is null or expiry_date >= v_today or id = p_lot_id)
           order by (id = p_lot_id) desc nulls last, expiry_date asc nulls last, received_at asc
           for update
        loop
          exit when v_rem <= 0;
          v_take := least(v_rem, v_lot.remaining_qty);
          update public.stock_lots set remaining_qty = remaining_qty - v_take where id = v_lot.id;
          v_allocs := v_allocs || jsonb_build_object('lot_id', v_lot.id, 'qty', v_take);
          v_rem := v_rem - v_take;
        end loop;
        if v_rem > v_untracked and not v_negative then
          if p_reason = 'sale' and v_expired_sum > 0 then
            raise exception 'Estoque válido insuficiente para "%": há % % em lotes vencidos. Registre a baixa como "Produto vencido".',
              v_prod.name, public._fmt_qty(v_expired_sum), v_unit.code
              using errcode = 'P0001', hint = 'expired_lots';
          end if;
          raise exception 'Estoque insuficiente nos lotes de "%".', v_prod.name using errcode = 'P0001', hint = 'insufficient_stock';
        end if;
      end if;
    end if;
  end if;

  insert into public.stock_movements(
    store_id, product_id, direction, reason, quantity, unit_cost, balance_after, lot_id, supplier_id,
    document_ref, notes, occurred_at, purchase_id, sale_id, sale_item_id, inventory_count_id,
    reverses_movement_id, negative_override, operation_id, created_by)
  values (
    p_store, p_product, p_direction, p_reason, p_qty, v_cost, v_new_qty,
    coalesce(v_lot_id, case when jsonb_array_length(v_allocs) = 1 then (v_allocs->0->>'lot_id')::uuid end),
    p_supplier, nullif(trim(coalesce(p_document_ref, '')), ''), nullif(trim(coalesce(p_notes, '')), ''),
    coalesce(p_occurred_at, now()), p_purchase_id, p_sale_id, p_sale_item_id, p_inventory_id,
    p_reverses, v_negative, p_op, auth.uid())
  returning * into v_mov;

  insert into public.stock_movement_lots(movement_id, lot_id, quantity)
  select v_mov.id, (a->>'lot_id')::uuid, sum((a->>'qty')::numeric)
    from jsonb_array_elements(v_allocs) a group by 1, 2;

  update public.stock_balances
     set quantity = v_new_qty, avg_cost = greatest(coalesce(v_new_avg, 0), 0),
         last_movement_at = now(), updated_at = now()
   where product_id = p_product;

  if v_orig.id is not null then
    update public.stock_movements set reversed_by_movement_id = v_mov.id where id = v_orig.id;
  end if;

  if v_negative then
    perform public._audit(p_store, 'negative_stock_override', 'stock_movements', v_mov.id,
      jsonb_build_object('product', v_prod.name, 'balance_after', v_new_qty, 'quantity', p_qty));
  end if;
  return v_mov;
end $$;

-- ---------- Entrada manual ----------
create or replace function public.register_entry(
  p_store uuid, p_product uuid, p_quantity numeric, p_unit_cost numeric,
  p_supplier uuid default null, p_occurred_at timestamptz default null, p_document_ref text default null,
  p_lot_code text default null, p_expiry date default null, p_notes text default null,
  p_reason public.movement_reason default 'manual_entry', p_request_id uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_prev jsonb; v_mov public.stock_movements;
begin
  perform public._require_role(p_store);
  v_prev := public._idem_begin(p_store, p_request_id);
  if v_prev is not null then return v_prev; end if;
  if p_reason not in ('manual_entry', 'initial_stock', 'return_in') then
    raise exception 'Motivo de entrada inválido.' using errcode = '22023';
  end if;
  if p_unit_cost is null or p_unit_cost < 0 then
    raise exception 'Informe o custo unitário (pode ser zero).' using errcode = '22023';
  end if;
  if p_supplier is not null and not exists (select 1 from public.suppliers where id = p_supplier and store_id = p_store) then
    raise exception 'Fornecedor inválido.' using errcode = '22023';
  end if;
  if p_occurred_at is not null and p_occurred_at > now() + interval '5 minutes' then
    raise exception 'A data da entrada não pode estar no futuro.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.products where id = p_product and store_id = p_store and active) then
    raise exception 'Produto inativo ou inexistente.' using errcode = '22023';
  end if;
  v_mov := public._apply_movement(p_store, p_product, 'in', p_reason, p_quantity, gen_random_uuid(),
    p_unit_cost => p_unit_cost, p_occurred_at => p_occurred_at, p_supplier => p_supplier,
    p_document_ref => p_document_ref, p_notes => p_notes, p_lot_code => p_lot_code, p_expiry => p_expiry);
  return public._idem_end(p_store, p_request_id, 'register_entry',
    jsonb_build_object('movement_id', v_mov.id, 'balance_after', v_mov.balance_after));
end $$;

-- ---------- Saída manual ----------
create or replace function public.register_exit(
  p_store uuid, p_product uuid, p_quantity numeric, p_reason public.movement_reason,
  p_notes text default null, p_lot_id uuid default null, p_occurred_at timestamptz default null,
  p_request_id uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_prev jsonb; v_mov public.stock_movements;
begin
  perform public._require_role(p_store);
  v_prev := public._idem_begin(p_store, p_request_id);
  if v_prev is not null then return v_prev; end if;
  if p_reason not in ('sale', 'internal_use', 'loss', 'expired', 'damage', 'return_out', 'inventory_adjustment') then
    raise exception 'Motivo de saída inválido.' using errcode = '22023';
  end if;
  if p_occurred_at is not null and p_occurred_at > now() + interval '5 minutes' then
    raise exception 'A data da saída não pode estar no futuro.' using errcode = '22023';
  end if;
  if p_lot_id is not null and not exists (select 1 from public.stock_lots where id = p_lot_id and product_id = p_product and store_id = p_store) then
    raise exception 'Lote inválido para este produto.' using errcode = '22023';
  end if;
  v_mov := public._apply_movement(p_store, p_product, 'out', p_reason, p_quantity, gen_random_uuid(),
    p_occurred_at => p_occurred_at, p_notes => p_notes, p_lot_id => p_lot_id);
  return public._idem_end(p_store, p_request_id, 'register_exit',
    jsonb_build_object('movement_id', v_mov.id, 'balance_after', v_mov.balance_after));
end $$;

-- ---------- Estorno de movimentação avulsa ----------
create or replace function public.reverse_movement(
  p_store uuid, p_movement uuid, p_reason text, p_request_id uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_prev jsonb; v_orig public.stock_movements; v_mov public.stock_movements;
begin
  perform public._require_role(p_store, true);
  v_prev := public._idem_begin(p_store, p_request_id);
  if v_prev is not null then return v_prev; end if;
  if p_reason is null or length(trim(p_reason)) < 3 then
    raise exception 'Informe o motivo do estorno.' using errcode = '22023';
  end if;
  select * into v_orig from public.stock_movements where id = p_movement and store_id = p_store for update;
  if v_orig.id is null then raise exception 'Movimentação não encontrada.' using errcode = 'P0002'; end if;
  if v_orig.reversed_by_movement_id is not null then
    raise exception 'Esta movimentação já foi estornada.' using errcode = 'P0001';
  end if;
  if v_orig.reverses_movement_id is not null then
    raise exception 'Não é possível estornar um estorno. Registre uma nova movimentação.' using errcode = 'P0001';
  end if;
  if v_orig.sale_id is not null then
    raise exception 'Esta saída pertence a uma venda. Cancele a venda para estorná-la.' using errcode = 'P0001';
  end if;
  if v_orig.purchase_id is not null then
    raise exception 'Esta entrada pertence a uma compra. Cancele a compra para estorná-la.' using errcode = 'P0001';
  end if;
  v_mov := public._apply_movement(p_store, v_orig.product_id,
    case when v_orig.direction = 'in' then 'out'::public.movement_direction else 'in'::public.movement_direction end,
    'reversal', v_orig.quantity, gen_random_uuid(),
    p_unit_cost => v_orig.unit_cost, p_notes => 'Estorno: ' || trim(p_reason),
    p_document_ref => v_orig.document_ref, p_reverses => v_orig.id);
  perform public._audit(p_store, 'movement_reversed', 'stock_movements', v_orig.id,
    jsonb_build_object('reversal_id', v_mov.id, 'reason', p_reason));
  return public._idem_end(p_store, p_request_id, 'reverse_movement',
    jsonb_build_object('movement_id', v_mov.id, 'balance_after', v_mov.balance_after));
end $$;

-- ---------- Compras ----------
create or replace function public.save_purchase(
  p_store uuid, p_purchase uuid, p_data jsonb, p_request_id uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_prev jsonb; v_id uuid := p_purchase; v_status public.purchase_status;
  v_item jsonb; v_subtotal numeric := 0; v_discount numeric; v_freight numeric; v_total numeric;
  v_line numeric; v_prod public.products; v_i int := 0; v_supplier uuid;
begin
  perform public._require_role(p_store);
  v_prev := public._idem_begin(p_store, p_request_id);
  if v_prev is not null then return v_prev; end if;

  v_supplier := nullif(p_data->>'supplier_id', '')::uuid;
  if v_supplier is not null and not exists (select 1 from public.suppliers where id = v_supplier and store_id = p_store) then
    raise exception 'Fornecedor inválido.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_data->'items') <> 'array' or jsonb_array_length(p_data->'items') = 0 then
    raise exception 'Adicione pelo menos um item à compra.' using errcode = '22023';
  end if;
  v_discount := coalesce(nullif(p_data->>'discount', '')::numeric, 0);
  v_freight := coalesce(nullif(p_data->>'freight', '')::numeric, 0);
  if v_discount < 0 or v_freight < 0 then raise exception 'Desconto e frete não podem ser negativos.' using errcode = '22023'; end if;

  if v_id is null then
    insert into public.purchases(store_id, number, supplier_id, purchase_date, document_number, notes, created_by)
    values (p_store, public._next_number(p_store, 'purchase'), v_supplier,
            coalesce(nullif(p_data->>'purchase_date', '')::date, public._store_today(p_store)),
            nullif(trim(coalesce(p_data->>'document_number', '')), ''), nullif(trim(coalesce(p_data->>'notes', '')), ''), auth.uid())
    returning id into v_id;
  else
    select status into v_status from public.purchases where id = v_id and store_id = p_store for update;
    if v_status is null then raise exception 'Compra não encontrada.' using errcode = 'P0002'; end if;
    if v_status <> 'draft' then raise exception 'Apenas compras em rascunho podem ser editadas.' using errcode = 'P0001'; end if;
    update public.purchases set supplier_id = v_supplier,
      purchase_date = coalesce(nullif(p_data->>'purchase_date', '')::date, purchase_date),
      document_number = nullif(trim(coalesce(p_data->>'document_number', '')), ''),
      notes = nullif(trim(coalesce(p_data->>'notes', '')), '')
     where id = v_id;
    delete from public.purchase_items where purchase_id = v_id;
  end if;

  for v_item in select * from jsonb_array_elements(p_data->'items') loop
    v_i := v_i + 1;
    select * into v_prod from public.products where id = (v_item->>'product_id')::uuid and store_id = p_store;
    if v_prod.id is null then raise exception 'Item % da compra: produto inválido.', v_i using errcode = '22023'; end if;
    if v_prod.stock_mode <> 'stock' then
      raise exception '"%" é baixado por ficha técnica e não pode ser comprado diretamente.', v_prod.name using errcode = '22023';
    end if;
    if coalesce((v_item->>'quantity')::numeric, 0) <= 0 then
      raise exception 'Quantidade inválida para "%".', v_prod.name using errcode = '22023';
    end if;
    if coalesce((v_item->>'unit_cost')::numeric, -1) < 0 then
      raise exception 'Custo unitário inválido para "%".', v_prod.name using errcode = '22023';
    end if;
    v_line := round((v_item->>'quantity')::numeric * (v_item->>'unit_cost')::numeric
                    - coalesce(nullif(v_item->>'discount', '')::numeric, 0), 2);
    if v_line < 0 then raise exception 'O desconto de "%" é maior que o valor do item.', v_prod.name using errcode = '22023'; end if;
    insert into public.purchase_items(purchase_id, store_id, product_id, quantity, unit_cost, discount, total,
                                      lot_code, expiry_date, sort_order)
    values (v_id, p_store, v_prod.id, (v_item->>'quantity')::numeric, (v_item->>'unit_cost')::numeric,
            coalesce(nullif(v_item->>'discount', '')::numeric, 0), v_line,
            nullif(trim(coalesce(v_item->>'lot_code', '')), ''), nullif(v_item->>'expiry_date', '')::date, v_i);
    v_subtotal := v_subtotal + v_line;
  end loop;

  if v_discount > v_subtotal then raise exception 'O desconto da compra é maior que o subtotal.' using errcode = '22023'; end if;
  v_total := v_subtotal - v_discount + v_freight;
  update public.purchases set subtotal = v_subtotal, discount = v_discount, freight = v_freight, total = v_total where id = v_id;
  return public._idem_end(p_store, p_request_id, 'save_purchase', jsonb_build_object('purchase_id', v_id, 'total', v_total));
end $$;

create or replace function public.receive_purchase(
  p_store uuid, p_purchase uuid, p_received_date date default null, p_request_id uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_prev jsonb; v_p public.purchases; v_item record; v_op uuid := gen_random_uuid();
  v_landed numeric; v_extra numeric; v_count int := 0; v_date date; v_qty_sum numeric;
begin
  perform public._require_role(p_store);
  v_prev := public._idem_begin(p_store, p_request_id);
  if v_prev is not null then return v_prev; end if;

  select * into v_p from public.purchases where id = p_purchase and store_id = p_store for update;
  if v_p.id is null then raise exception 'Compra não encontrada.' using errcode = 'P0002'; end if;
  if v_p.status = 'received' then raise exception 'Esta compra já foi recebida.' using errcode = 'P0001', hint = 'already_received'; end if;
  if v_p.status <> 'draft' then raise exception 'Esta compra está cancelada.' using errcode = 'P0001'; end if;
  v_date := coalesce(p_received_date, public._store_today(p_store));
  if v_date < v_p.purchase_date then raise exception 'A data de recebimento não pode ser anterior à data da compra.' using errcode = '22023'; end if;
  if v_date > public._store_today(p_store) then raise exception 'A data de recebimento não pode estar no futuro.' using errcode = '22023'; end if;

  perform public._lock_balances(p_store, array(select product_id from public.purchase_items where purchase_id = v_p.id));
  v_extra := v_p.freight - v_p.discount;  -- rateado proporcionalmente ao valor de cada item
  select sum(quantity) into v_qty_sum from public.purchase_items where purchase_id = v_p.id;

  for v_item in
    select pi.*, p.name, p.track_expiry, p.active from public.purchase_items pi join public.products p on p.id = pi.product_id
     where pi.purchase_id = v_p.id order by pi.sort_order
  loop
    if v_item.track_expiry and v_item.expiry_date is null then
      raise exception 'Informe a validade de "%" antes de receber a compra.', v_item.name using errcode = '22023';
    end if;
    v_landed := round((v_item.total + case when v_p.subtotal > 0 then v_extra * v_item.total / v_p.subtotal
                                            else v_extra * v_item.quantity / v_qty_sum end) / v_item.quantity, 4);
    v_landed := greatest(v_landed, 0);
    update public.purchase_items set landed_unit_cost = v_landed where id = v_item.id;
    perform public._apply_movement(p_store, v_item.product_id, 'in', 'purchase', v_item.quantity, v_op,
      p_unit_cost => v_landed,
      p_occurred_at => case when v_date = public._store_today(p_store) then now()
                            else (v_date::timestamp + time '12:00') at time zone (select timezone from public.stores where id = p_store) end,
      p_supplier => v_p.supplier_id, p_document_ref => coalesce(v_p.document_number, 'Compra #' || v_p.number),
      p_lot_code => v_item.lot_code, p_expiry => v_item.expiry_date, p_purchase_id => v_p.id);
    -- custo de referência do cadastro passa a ser o último custo de compra
    update public.products set cost_price = v_landed where id = v_item.product_id and cost_price is distinct from v_landed;
    v_count := v_count + 1;
  end loop;
  if v_count = 0 then raise exception 'A compra não possui itens.' using errcode = '22023'; end if;

  update public.purchases set status = 'received', received_date = v_date, received_by = auth.uid(), received_at = now()
   where id = v_p.id;
  perform public._audit(p_store, 'purchase_received', 'purchases', v_p.id, jsonb_build_object('number', v_p.number, 'total', v_p.total));
  return public._idem_end(p_store, p_request_id, 'receive_purchase', jsonb_build_object('purchase_id', v_p.id, 'items', v_count));
end $$;

create or replace function public.cancel_purchase(
  p_store uuid, p_purchase uuid, p_reason text, p_request_id uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_prev jsonb; v_p public.purchases; v_m public.stock_movements; v_op uuid := gen_random_uuid(); v_role public.member_role;
begin
  v_role := public._require_role(p_store);
  v_prev := public._idem_begin(p_store, p_request_id);
  if v_prev is not null then return v_prev; end if;
  if p_reason is null or length(trim(p_reason)) < 3 then raise exception 'Informe o motivo do cancelamento.' using errcode = '22023'; end if;
  select * into v_p from public.purchases where id = p_purchase and store_id = p_store for update;
  if v_p.id is null then raise exception 'Compra não encontrada.' using errcode = 'P0002'; end if;
  if v_p.status = 'cancelled' then raise exception 'Esta compra já está cancelada.' using errcode = 'P0001'; end if;
  if v_p.status = 'received' then
    if v_role <> 'admin' then raise exception 'Apenas administradores podem cancelar compras já recebidas.' using errcode = '42501'; end if;
    perform public._lock_balances(p_store, array(select product_id from public.stock_movements where purchase_id = v_p.id));
    for v_m in select * from public.stock_movements
                where purchase_id = v_p.id and reverses_movement_id is null and reversed_by_movement_id is null
                order by product_id loop
      perform public._apply_movement(p_store, v_m.product_id, 'out', 'purchase_cancel', v_m.quantity, v_op,
        p_unit_cost => v_m.unit_cost, p_notes => 'Cancelamento da compra #' || v_p.number || ': ' || trim(p_reason),
        p_purchase_id => v_p.id, p_reverses => v_m.id, p_document_ref => v_m.document_ref);
    end loop;
  end if;
  update public.purchases set status = 'cancelled', cancelled_by = auth.uid(), cancelled_at = now(), cancel_reason = trim(p_reason)
   where id = v_p.id;
  perform public._audit(p_store, 'purchase_cancelled', 'purchases', v_p.id,
    jsonb_build_object('number', v_p.number, 'previous_status', v_p.status, 'reason', p_reason));
  return public._idem_end(p_store, p_request_id, 'cancel_purchase', jsonb_build_object('purchase_id', v_p.id));
end $$;

-- ---------- Vendas ----------
create or replace function public.create_sale(
  p_store uuid, p_data jsonb, p_request_id uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_prev jsonb; v_sale_id uuid; v_number bigint; v_item jsonb; v_prod public.products; v_i int := 0;
  v_line numeric; v_subtotal numeric := 0; v_discount numeric; v_total numeric; v_price numeric;
  v_needed uuid[] := '{}'; v_op uuid := gen_random_uuid(); v_si_id uuid; v_mov public.stock_movements;
  v_cost_total numeric; v_known boolean; v_sale_cost numeric := 0; v_sale_known boolean := true;
  v_recipe public.recipes; v_ri record; v_ing_qty numeric; v_sold_at timestamptz;
begin
  perform public._require_role(p_store);
  v_prev := public._idem_begin(p_store, p_request_id);
  if v_prev is not null then return v_prev; end if;

  if jsonb_typeof(p_data->'items') <> 'array' or jsonb_array_length(p_data->'items') = 0 then
    raise exception 'Adicione pelo menos um item à venda.' using errcode = '22023';
  end if;
  v_discount := coalesce(nullif(p_data->>'discount', '')::numeric, 0);
  if v_discount < 0 then raise exception 'O desconto não pode ser negativo.' using errcode = '22023'; end if;
  v_sold_at := coalesce(nullif(p_data->>'sold_at', '')::timestamptz, now());
  if v_sold_at > now() + interval '5 minutes' then raise exception 'A data da venda não pode estar no futuro.' using errcode = '22023'; end if;

  -- 1) valida itens e coleta todos os produtos que terão estoque baixado
  for v_item in select * from jsonb_array_elements(p_data->'items') loop
    v_i := v_i + 1;
    select * into v_prod from public.products where id = (v_item->>'product_id')::uuid and store_id = p_store;
    if v_prod.id is null then raise exception 'Item % da venda: produto inválido.', v_i using errcode = '22023'; end if;
    if not v_prod.active then raise exception '"%" está inativo.', v_prod.name using errcode = '22023'; end if;
    if coalesce((v_item->>'quantity')::numeric, 0) <= 0 then
      raise exception 'Quantidade inválida para "%".', v_prod.name using errcode = '22023';
    end if;
    if v_prod.stock_mode = 'recipe' then
      select * into v_recipe from public.recipes where product_id = v_prod.id and active;
      if v_recipe.id is null or not exists (select 1 from public.recipe_items where recipe_id = v_recipe.id) then
        raise exception '"%" baixa estoque por ficha técnica, mas a ficha não está cadastrada.', v_prod.name using errcode = '22023';
      end if;
      v_needed := v_needed || array(select ingredient_id from public.recipe_items where recipe_id = v_recipe.id);
    else
      v_needed := v_needed || v_prod.id;
    end if;
  end loop;

  perform public._lock_balances(p_store, v_needed);

  v_number := public._next_number(p_store, 'sale');
  insert into public.sales(store_id, number, sold_at, subtotal, discount, total, payment_method, channel, external_ref, notes, created_by)
  values (p_store, v_number, v_sold_at, 0, 0, 0,
          nullif(p_data->>'payment_method', '')::public.payment_method,
          coalesce(nullif(p_data->>'channel', ''), 'balcao'), nullif(p_data->>'external_ref', ''),
          nullif(trim(coalesce(p_data->>'notes', '')), ''), auth.uid())
  returning id into v_sale_id;

  -- 2) itens + movimentações
  v_i := 0;
  for v_item in select * from jsonb_array_elements(p_data->'items') loop
    v_i := v_i + 1;
    select * into v_prod from public.products where id = (v_item->>'product_id')::uuid;
    v_price := coalesce(nullif(v_item->>'unit_price', '')::numeric, v_prod.sale_price);
    if v_price is null or v_price < 0 then
      raise exception 'Informe o preço de venda de "%".', v_prod.name using errcode = '22023';
    end if;
    v_line := round((v_item->>'quantity')::numeric * v_price - coalesce(nullif(v_item->>'discount', '')::numeric, 0), 2);
    if v_line < 0 then raise exception 'O desconto de "%" é maior que o valor do item.', v_prod.name using errcode = '22023'; end if;

    insert into public.sale_items(sale_id, store_id, product_id, quantity, unit_price, discount, total, sort_order)
    values (v_sale_id, p_store, v_prod.id, (v_item->>'quantity')::numeric, v_price,
            coalesce(nullif(v_item->>'discount', '')::numeric, 0), v_line, v_i)
    returning id into v_si_id;

    v_cost_total := 0; v_known := true;
    if v_prod.stock_mode = 'recipe' then
      select * into v_recipe from public.recipes where product_id = v_prod.id and active;
      for v_ri in select * from public.recipe_items where recipe_id = v_recipe.id order by sort_order, id loop
        v_ing_qty := round((v_item->>'quantity')::numeric * v_ri.quantity * (1 + v_ri.loss_pct / 100) / v_recipe.yield_qty, 3);
        continue when v_ing_qty <= 0;
        v_mov := public._apply_movement(p_store, v_ri.ingredient_id, 'out', 'sale', v_ing_qty, v_op,
          p_occurred_at => v_sold_at, p_document_ref => 'Venda #' || v_number, p_sale_id => v_sale_id, p_sale_item_id => v_si_id);
        v_cost_total := v_cost_total + v_mov.total_cost;
        v_known := v_known and v_mov.unit_cost > 0;
      end loop;
    else
      v_mov := public._apply_movement(p_store, v_prod.id, 'out', 'sale', (v_item->>'quantity')::numeric, v_op,
        p_occurred_at => v_sold_at, p_document_ref => 'Venda #' || v_number, p_sale_id => v_sale_id, p_sale_item_id => v_si_id);
      v_cost_total := v_mov.total_cost;
      v_known := v_mov.unit_cost > 0;
    end if;
    update public.sale_items set cost_total = v_cost_total, cost_known = v_known where id = v_si_id;
    v_subtotal := v_subtotal + v_line;
    v_sale_cost := v_sale_cost + v_cost_total;
    v_sale_known := v_sale_known and v_known;
  end loop;

  if v_discount > v_subtotal then raise exception 'O desconto é maior que o subtotal da venda.' using errcode = '22023'; end if;
  v_total := v_subtotal - v_discount;
  update public.sales set subtotal = v_subtotal, discount = v_discount, total = v_total,
         cost_total = v_sale_cost, cost_complete = v_sale_known where id = v_sale_id;

  return public._idem_end(p_store, p_request_id, 'create_sale',
    jsonb_build_object('sale_id', v_sale_id, 'number', v_number, 'total', v_total));
end $$;

create or replace function public.cancel_sale(
  p_store uuid, p_sale uuid, p_reason text, p_request_id uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_prev jsonb; v_s public.sales; v_m public.stock_movements; v_op uuid := gen_random_uuid();
begin
  perform public._require_role(p_store, true);
  v_prev := public._idem_begin(p_store, p_request_id);
  if v_prev is not null then return v_prev; end if;
  if p_reason is null or length(trim(p_reason)) < 3 then raise exception 'Informe o motivo do cancelamento.' using errcode = '22023'; end if;
  select * into v_s from public.sales where id = p_sale and store_id = p_store for update;
  if v_s.id is null then raise exception 'Venda não encontrada.' using errcode = 'P0002'; end if;
  if v_s.status = 'cancelled' then raise exception 'Esta venda já está cancelada.' using errcode = 'P0001'; end if;
  perform public._lock_balances(p_store, array(select product_id from public.stock_movements where sale_id = v_s.id));
  for v_m in select * from public.stock_movements
              where sale_id = v_s.id and reverses_movement_id is null and reversed_by_movement_id is null
              order by product_id loop
    perform public._apply_movement(p_store, v_m.product_id, 'in', 'sale_cancel', v_m.quantity, v_op,
      p_unit_cost => v_m.unit_cost, p_notes => 'Cancelamento da venda #' || v_s.number || ': ' || trim(p_reason),
      p_sale_id => v_s.id, p_sale_item_id => v_m.sale_item_id, p_reverses => v_m.id, p_document_ref => v_m.document_ref);
  end loop;
  update public.sales set status = 'cancelled', cancelled_by = auth.uid(), cancelled_at = now(), cancel_reason = trim(p_reason)
   where id = v_s.id;
  perform public._audit(p_store, 'sale_cancelled', 'sales', v_s.id, jsonb_build_object('number', v_s.number, 'total', v_s.total, 'reason', p_reason));
  return public._idem_end(p_store, p_request_id, 'cancel_sale', jsonb_build_object('sale_id', v_s.id));
end $$;

-- ---------- Inventário ----------
create or replace function public.save_inventory_count(
  p_store uuid, p_count uuid, p_notes text, p_items jsonb, p_request_id uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_prev jsonb; v_id uuid := p_count; v_status public.inventory_status; v_item jsonb; v_prod public.products;
begin
  perform public._require_role(p_store);
  v_prev := public._idem_begin(p_store, p_request_id);
  if v_prev is not null then return v_prev; end if;
  if jsonb_typeof(p_items) <> 'array' then raise exception 'Itens inválidos.' using errcode = '22023'; end if;
  if v_id is null then
    insert into public.inventory_counts(store_id, number, notes, created_by)
    values (p_store, public._next_number(p_store, 'inventory'), nullif(trim(coalesce(p_notes, '')), ''), auth.uid())
    returning id into v_id;
  else
    select status into v_status from public.inventory_counts where id = v_id and store_id = p_store for update;
    if v_status is null then raise exception 'Inventário não encontrado.' using errcode = 'P0002'; end if;
    if v_status <> 'open' then raise exception 'Este inventário já foi finalizado.' using errcode = 'P0001'; end if;
    update public.inventory_counts set notes = nullif(trim(coalesce(p_notes, '')), '') where id = v_id;
    delete from public.inventory_count_items where inventory_count_id = v_id;
  end if;
  for v_item in select * from jsonb_array_elements(p_items) loop
    continue when nullif(v_item->>'counted_qty', '') is null;
    select * into v_prod from public.products where id = (v_item->>'product_id')::uuid and store_id = p_store;
    if v_prod.id is null or v_prod.stock_mode <> 'stock' then raise exception 'Produto inválido no inventário.' using errcode = '22023'; end if;
    if (v_item->>'counted_qty')::numeric < 0 then
      raise exception 'A quantidade contada de "%" não pode ser negativa.', v_prod.name using errcode = '22023';
    end if;
    insert into public.inventory_count_items(inventory_count_id, store_id, product_id, counted_qty, reason)
    values (v_id, p_store, v_prod.id, (v_item->>'counted_qty')::numeric, nullif(trim(coalesce(v_item->>'reason', '')), ''));
  end loop;
  return public._idem_end(p_store, p_request_id, 'save_inventory_count', jsonb_build_object('inventory_count_id', v_id));
end $$;

create or replace function public.confirm_inventory_count(
  p_store uuid, p_count uuid, p_request_id uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_prev jsonb; v_c public.inventory_counts; v_it record; v_theo numeric; v_diff numeric;
  v_mov public.stock_movements; v_op uuid := gen_random_uuid(); v_adj int := 0;
begin
  perform public._require_role(p_store);
  v_prev := public._idem_begin(p_store, p_request_id);
  if v_prev is not null then return v_prev; end if;
  select * into v_c from public.inventory_counts where id = p_count and store_id = p_store for update;
  if v_c.id is null then raise exception 'Inventário não encontrado.' using errcode = 'P0002'; end if;
  if v_c.status <> 'open' then raise exception 'Este inventário já foi finalizado.' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.inventory_count_items where inventory_count_id = v_c.id) then
    raise exception 'Informe a contagem de pelo menos um item.' using errcode = '22023';
  end if;
  perform public._lock_balances(p_store, array(select product_id from public.inventory_count_items where inventory_count_id = v_c.id));
  for v_it in select i.*, p.name from public.inventory_count_items i join public.products p on p.id = i.product_id
               where i.inventory_count_id = v_c.id order by i.product_id loop
    select quantity into v_theo from public.stock_balances where product_id = v_it.product_id;
    v_diff := v_it.counted_qty - v_theo;
    v_mov := null;
    if v_diff <> 0 then
      v_mov := public._apply_movement(p_store, v_it.product_id,
        case when v_diff > 0 then 'in'::public.movement_direction else 'out'::public.movement_direction end,
        'inventory_adjustment', abs(v_diff), v_op,
        p_notes => coalesce('Inventário #' || v_c.number || ': ' || v_it.reason, 'Inventário #' || v_c.number),
        p_document_ref => 'Inventário #' || v_c.number, p_inventory_id => v_c.id);
      v_adj := v_adj + 1;
    end if;
    update public.inventory_count_items set theoretical_qty = v_theo, difference = v_diff, movement_id = v_mov.id where id = v_it.id;
  end loop;
  update public.inventory_counts set status = 'confirmed', confirmed_by = auth.uid(), confirmed_at = now() where id = v_c.id;
  perform public._audit(p_store, 'inventory_confirmed', 'inventory_counts', v_c.id, jsonb_build_object('number', v_c.number, 'adjustments', v_adj));
  return public._idem_end(p_store, p_request_id, 'confirm_inventory_count',
    jsonb_build_object('inventory_count_id', v_c.id, 'adjustments', v_adj));
end $$;

create or replace function public.cancel_inventory_count(p_store uuid, p_count uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._require_role(p_store);
  update public.inventory_counts set status = 'cancelled' where id = p_count and store_id = p_store and status = 'open';
  if not found then raise exception 'Inventário não encontrado ou já finalizado.' using errcode = 'P0001'; end if;
end $$;

-- ---------- Integridade / reconstrução ----------
create or replace function public.check_stock_integrity(p_store uuid)
returns table(product_id uuid, product_name text, cached numeric, computed numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require_role(p_store);
  return query
  select p.id, p.name, coalesce(b.quantity, 0)::numeric,
         coalesce((select sum(case when m.direction = 'in' then m.quantity else -m.quantity end)
                     from public.stock_movements m where m.product_id = p.id), 0)::numeric
    from public.products p left join public.stock_balances b on b.product_id = p.id
   where p.store_id = p_store
     and coalesce(b.quantity, 0) <> coalesce((select sum(case when m.direction = 'in' then m.quantity else -m.quantity end)
                                                 from public.stock_movements m where m.product_id = p.id), 0);
end $$;

-- Reprocessa as movimentações (ordem de registro) e recalcula saldo, custo médio e lotes.
create or replace function public._rebuild_product(p_product uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_m record; v_q numeric := 0; v_avg numeric := 0; v_store uuid;
begin
  select store_id into v_store from public.products where id = p_product;
  for v_m in select * from public.stock_movements where product_id = p_product order by created_at, id loop
    if v_m.direction = 'in' then
      v_avg := case when v_q <= 0 then v_m.unit_cost else round((v_q * v_avg + v_m.quantity * v_m.unit_cost) / (v_q + v_m.quantity), 4) end;
      v_q := v_q + v_m.quantity;
    else
      if v_m.reverses_movement_id is not null and v_q - v_m.quantity > 0 then
        v_avg := greatest(round((v_q * v_avg - v_m.quantity * v_m.unit_cost) / (v_q - v_m.quantity), 4), 0);
      end if;
      v_q := v_q - v_m.quantity;
    end if;
  end loop;
  insert into public.stock_balances(product_id, store_id, quantity, avg_cost, updated_at)
  values (p_product, v_store, v_q, greatest(v_avg, 0), now())
  on conflict (product_id) do update set quantity = excluded.quantity, avg_cost = excluded.avg_cost, updated_at = now();

  update public.stock_lots l set remaining_qty = greatest(least(l.received_qty,
      l.received_qty
      - coalesce((select sum(a.quantity) from public.stock_movement_lots a join public.stock_movements m on m.id = a.movement_id
                   where a.lot_id = l.id and m.direction = 'out'), 0)
      + coalesce((select sum(a.quantity) from public.stock_movement_lots a join public.stock_movements m on m.id = a.movement_id
                   where a.lot_id = l.id and m.direction = 'in'), 0)), 0)
   where l.product_id = p_product;
end $$;

create or replace function public.rebuild_stock_balances(p_store uuid) returns int
language plpgsql security definer set search_path = public as $$
declare v_p uuid; v_n int := 0;
begin
  perform public._require_role(p_store, true);
  perform 1 from public.stock_balances where store_id = p_store order by product_id for update;
  for v_p in select id from public.products where store_id = p_store and stock_mode = 'stock' order by id loop
    perform public._rebuild_product(v_p);
    v_n := v_n + 1;
  end loop;
  perform public._audit(p_store, 'stock_rebuilt', 'stock_balances', null, jsonb_build_object('products', v_n));
  return v_n;
end $$;

-- ---------- Loja: criação, padrões, membros ----------
create or replace function public._seed_store_defaults(p_store uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.units(store_id, code, name, allows_decimal) values
    (p_store, 'un', 'Unidade', false), (p_store, 'kg', 'Quilograma', true), (p_store, 'g', 'Grama', true),
    (p_store, 'L', 'Litro', true), (p_store, 'mL', 'Mililitro', true), (p_store, 'pct', 'Pacote', false),
    (p_store, 'cx', 'Caixa', false)
  on conflict do nothing;
  insert into public.categories(store_id, name, color, sort_order) values
    (p_store, 'Açaí', '#6A0E7B', 1), (p_store, 'Polpas e frutas', '#E2557A', 2),
    (p_store, 'Cremes e complementos', '#F6C94C', 3), (p_store, 'Ingredientes', '#6A9E38', 4),
    (p_store, 'Embalagens', '#16C5BD', 5), (p_store, 'Produtos para revenda', '#3B82F6', 6),
    (p_store, 'Materiais de limpeza', '#64748B', 7), (p_store, 'Outros', '#A3A3A3', 8)
  on conflict do nothing;
end $$;

-- Cria a loja. Regra: o primeiro usuário do sistema cria a primeira loja;
-- depois disso, só administradores existentes podem criar novas unidades.
create or replace function public.create_store(p_name text, p_phone text default null, p_address text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'Sessão expirada. Faça login novamente.' using errcode = '28000'; end if;
  perform pg_advisory_xact_lock(hashtext('create_store'));
  if exists (select 1 from public.stores)
     and not exists (select 1 from public.store_members where user_id = auth.uid() and role = 'admin' and active) then
    raise exception 'Somente administradores podem criar novas lojas. Peça um convite ao administrador.' using errcode = '42501';
  end if;
  insert into public.profiles(id, email) select id, email from auth.users where id = auth.uid() on conflict do nothing;
  insert into public.stores(name, phone, address) values (trim(p_name), p_phone, p_address) returning id into v_id;
  insert into public.store_members(store_id, user_id, role) values (v_id, auth.uid(), 'admin');
  perform public._seed_store_defaults(v_id);
  perform public._audit(v_id, 'store_created', 'stores', v_id, jsonb_build_object('name', p_name));
  return v_id;
end $$;

create or replace function public.can_bootstrap_store() returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (select 1 from public.stores)
$$;

create or replace function public.invite_member(p_store uuid, p_email text, p_role public.member_role)
returns text language plpgsql security definer set search_path = public as $$
declare v_user uuid; v_email text := lower(trim(p_email));
begin
  perform public._require_role(p_store, true);
  if v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'E-mail inválido.' using errcode = '22023'; end if;
  select id into v_user from public.profiles where lower(email) = v_email;
  if v_user is not null then
    insert into public.store_members(store_id, user_id, role) values (p_store, v_user, p_role)
    on conflict (store_id, user_id) do update set role = excluded.role, active = true;
    return 'added';
  end if;
  insert into public.store_invites(store_id, email, role, invited_by) values (p_store, v_email, p_role, auth.uid())
  on conflict (store_id, lower(email)) where accepted_at is null do update set role = excluded.role;
  perform public._audit(p_store, 'member_invited', 'store_invites', null, jsonb_build_object('email', v_email, 'role', p_role));
  return 'invited';
end $$;

-- ---------- Dados de demonstração ----------
-- Cria apenas CADASTROS de exemplo (sem estoque, preço ou custo), marcados como DEMO.
create or replace function public.seed_demo_data(p_store uuid) returns int
language plpgsql security definer set search_path = public as $$
declare v_un uuid; v_kg uuid; v_l uuid; v_n int;
begin
  perform public._require_role(p_store, true);
  if exists (select 1 from public.products where store_id = p_store and is_demo) then
    raise exception 'Os itens de demonstração já foram criados.' using errcode = 'P0001';
  end if;
  perform set_config('app.seeding_demo', 'on', true);
  select id into v_un from public.units where store_id = p_store and code = 'un';
  select id into v_kg from public.units where store_id = p_store and code = 'kg';
  select id into v_l from public.units where store_id = p_store and code = 'L';
  insert into public.products(store_id, sku, name, description, category_id, item_type, unit_id, track_lots, track_expiry, is_demo)
  select p_store, x.sku, x.name, 'Item de demonstração — será apagado em "Limpar dados de demonstração".',
         (select id from public.categories where store_id = p_store and name = x.cat), x.typ::public.item_type,
         case x.u when 'kg' then v_kg when 'L' then v_l else v_un end, x.lots, x.lots, true
    from (values
      ('DEMO-001', '[DEMO] Polpa de açaí', 'Açaí', 'ingredient', 'kg', true),
      ('DEMO-002', '[DEMO] Leite condensado', 'Cremes e complementos', 'ingredient', 'kg', true),
      ('DEMO-003', '[DEMO] Granola', 'Cremes e complementos', 'ingredient', 'kg', false),
      ('DEMO-004', '[DEMO] Copo 500 mL', 'Embalagens', 'packaging', 'un', false),
      ('DEMO-005', '[DEMO] Água mineral 500 mL', 'Produtos para revenda', 'resale', 'un', true)
    ) as x(sku, name, cat, typ, u, lots);
  get diagnostics v_n = row_count;
  perform set_config('app.seeding_demo', 'off', true);
  return v_n;
end $$;

-- Apaga itens DEMO e TUDO que os referencia (movimentos, lotes, vendas/compras/inventários
-- que contenham itens demo). Exige confirmação textual e é auditado.
create or replace function public.clear_demo_data(p_store uuid, p_confirmation text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_demo uuid[]; v_sales uuid[]; v_purch uuid[]; v_inv uuid[]; v_movs uuid[]; v_lots uuid[]; v_affected uuid[]; v_p uuid;
begin
  perform public._require_role(p_store, true);
  if p_confirmation is distinct from 'LIMPAR' then
    raise exception 'Digite LIMPAR para confirmar.' using errcode = '22023';
  end if;
  v_demo := array(select id from public.products where store_id = p_store and is_demo);
  if cardinality(v_demo) = 0 then return jsonb_build_object('products', 0); end if;
  perform set_config('app.allow_demo_cleanup', 'on', true);
  perform 1 from public.stock_balances where store_id = p_store order by product_id for update;

  v_sales := array(select distinct sale_id from public.sale_items where product_id = any(v_demo)
                   union select distinct sale_id from public.stock_movements where product_id = any(v_demo) and sale_id is not null);
  v_purch := array(select distinct purchase_id from public.purchase_items where product_id = any(v_demo));
  v_inv := array(select distinct inventory_count_id from public.inventory_count_items where product_id = any(v_demo));
  v_movs := array(select id from public.stock_movements where store_id = p_store and (
              product_id = any(v_demo) or sale_id = any(v_sales) or purchase_id = any(v_purch) or inventory_count_id = any(v_inv)));
  -- inclui estornos de movimentos removidos
  v_movs := v_movs || array(select id from public.stock_movements where reverses_movement_id = any(v_movs));
  v_lots := array(select id from public.stock_lots where product_id = any(v_demo)
                  union select lot_id from public.stock_movements where id = any(v_movs) and direction = 'in' and lot_id is not null
                         and reverses_movement_id is null);
  v_affected := array(select distinct product_id from public.stock_movements where id = any(v_movs) and not (product_id = any(v_demo)));

  update public.inventory_count_items set movement_id = null where movement_id = any(v_movs);
  delete from public.stock_movement_lots where movement_id = any(v_movs) or lot_id = any(v_lots);
  update public.stock_movements set lot_id = null where lot_id = any(v_lots);
  delete from public.stock_movements where id = any(v_movs);
  delete from public.stock_lots where id = any(v_lots);
  delete from public.sales where id = any(v_sales);
  delete from public.purchases where id = any(v_purch);
  delete from public.inventory_counts where id = any(v_inv);
  delete from public.recipe_items where ingredient_id = any(v_demo);
  delete from public.recipes where product_id = any(v_demo);
  delete from public.products where id = any(v_demo);
  foreach v_p in array v_affected loop perform public._rebuild_product(v_p); end loop;
  perform set_config('app.allow_demo_cleanup', 'off', true);
  perform public._audit(p_store, 'demo_data_cleared', 'products', null,
    jsonb_build_object('products', cardinality(v_demo), 'sales', cardinality(v_sales), 'purchases', cardinality(v_purch)));
  return jsonb_build_object('products', cardinality(v_demo), 'sales', cardinality(v_sales), 'purchases', cardinality(v_purch));
end $$;

-- ---------- Ficha técnica (salva tudo de uma vez) ----------
create or replace function public.save_recipe(
  p_store uuid, p_product uuid, p_yield numeric, p_notes text, p_items jsonb
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_recipe uuid; v_item jsonb; v_i int := 0;
begin
  perform public._require_role(p_store, true);
  if not exists (select 1 from public.products where id = p_product and store_id = p_store and stock_mode = 'recipe') then
    raise exception 'Este produto não está configurado para baixa por ficha técnica.' using errcode = '22023';
  end if;
  if coalesce(p_yield, 0) <= 0 then raise exception 'O rendimento deve ser maior que zero.' using errcode = '22023'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Adicione pelo menos um ingrediente.' using errcode = '22023';
  end if;
  insert into public.recipes(store_id, product_id, yield_qty, notes) values (p_store, p_product, p_yield, nullif(trim(coalesce(p_notes, '')), ''))
  on conflict (product_id) do update set yield_qty = excluded.yield_qty, notes = excluded.notes, active = true
  returning id into v_recipe;
  delete from public.recipe_items where recipe_id = v_recipe;
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_i := v_i + 1;
    if coalesce((v_item->>'quantity')::numeric, 0) <= 0 then
      raise exception 'Informe a quantidade do ingrediente %.', v_i using errcode = '22023';
    end if;
    insert into public.recipe_items(recipe_id, store_id, ingredient_id, quantity, loss_pct, sort_order)
    values (v_recipe, p_store, (v_item->>'ingredient_id')::uuid, (v_item->>'quantity')::numeric,
            coalesce(nullif(v_item->>'loss_pct', '')::numeric, 0), v_i);
  end loop;
  return v_recipe;
exception when unique_violation then
  raise exception 'O mesmo ingrediente aparece mais de uma vez na ficha.' using errcode = '22023';
end $$;

-- ---------- Permissões de execução ----------
revoke all on all functions in schema public from public, anon;
grant execute on function
  public.register_entry(uuid, uuid, numeric, numeric, uuid, timestamptz, text, text, date, text, public.movement_reason, uuid),
  public.register_exit(uuid, uuid, numeric, public.movement_reason, text, uuid, timestamptz, uuid),
  public.reverse_movement(uuid, uuid, text, uuid),
  public.save_purchase(uuid, uuid, jsonb, uuid),
  public.receive_purchase(uuid, uuid, date, uuid),
  public.cancel_purchase(uuid, uuid, text, uuid),
  public.create_sale(uuid, jsonb, uuid),
  public.cancel_sale(uuid, uuid, text, uuid),
  public.save_inventory_count(uuid, uuid, text, jsonb, uuid),
  public.confirm_inventory_count(uuid, uuid, uuid),
  public.cancel_inventory_count(uuid, uuid),
  public.check_stock_integrity(uuid),
  public.rebuild_stock_balances(uuid),
  public.create_store(text, text, text),
  public.can_bootstrap_store(),
  public.invite_member(uuid, text, public.member_role),
  public.save_recipe(uuid, uuid, numeric, text, jsonb),
  public.seed_demo_data(uuid),
  public.clear_demo_data(uuid, text),
  public.is_store_member(uuid), public.is_store_admin(uuid), public.current_role_in_store(uuid)
to authenticated;
-- funções internas (prefixo _) NÃO são expostas ao cliente.
