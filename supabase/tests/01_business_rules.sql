-- =====================================================================
-- Testes automatizados das regras de negócio, permissões e RLS.
-- Rodar com: npm run test:db   (ver supabase/tests/run.sh)
-- Cada asserção falha com exceção (o script para no primeiro erro).
-- =====================================================================
\set ON_ERROR_STOP 1
set client_min_messages = warning;

create schema if not exists tst;
grant usage on schema tst to authenticated, anon;
create table if not exists tst.ctx(k text primary key, v text);
grant select, insert, update on tst.ctx to authenticated;

create or replace function tst.ok(cond boolean, msg text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FALHOU: %', msg; end if;
  raise warning 'ok - %', msg;
end $$;

create or replace function tst.throws(sql text, pattern text, msg text) returns void language plpgsql as $$
begin
  begin
    execute sql;
  exception when others then
    if sqlerrm ~* pattern then raise warning 'ok - % (erro: %)', msg, sqlerrm; return; end if;
    raise exception 'FALHOU: % — erro inesperado: %', msg, sqlerrm;
  end;
  raise exception 'FALHOU: % — era esperado um erro', msg;
end $$;

create or replace function tst.login(p_email text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select id from auth.users where email = p_email), 'role', 'authenticated')::text, false);
end $$;
create or replace function tst.get(p_k text) returns text language sql as $$ select v from tst.ctx where k = p_k $$;
create or replace function tst.put(p_k text, p_v text) returns void language sql as $$
  insert into tst.ctx values (p_k, p_v) on conflict (k) do update set v = excluded.v $$;
grant execute on all functions in schema tst to authenticated, anon;

-- ---------------- usuários ----------------
insert into auth.users(email, raw_user_meta_data) values
  ('mae@acai.test', '{"full_name":"Dona Maria"}'), ('func@acai.test', '{}'), ('outra@loja.test', '{}');

-- ---------------- bootstrap da loja ----------------
select tst.login('mae@acai.test');
set role authenticated;
select tst.ok(public.can_bootstrap_store(), 'sistema vazio permite criar a primeira loja');
select tst.put('store', public.create_store('Açaí Everest ABC', '(11) 99999-0000', 'Santo André - SP')::text);
select tst.ok((select count(*) from public.categories where store_id = tst.get('store')::uuid) = 8, '8 categorias padrão criadas');
select tst.ok((select count(*) from public.units where store_id = tst.get('store')::uuid) = 7, '7 unidades padrão criadas');
select tst.ok(public.invite_member(tst.get('store')::uuid, 'func@acai.test', 'operator') = 'added', 'admin adiciona operadora já cadastrada');
select tst.ok(public.invite_member(tst.get('store')::uuid, 'nova@acai.test', 'operator') = 'invited', 'convite pendente para e-mail novo');
reset role;

-- convite aceito automaticamente no cadastro
insert into auth.users(email) values ('nova@acai.test');
select tst.ok(exists(select 1 from public.store_members m join auth.users u on u.id = m.user_id
                      where u.email = 'nova@acai.test' and m.role = 'operator'), 'cadastro com e-mail convidado entra na loja');

-- outra loja (outro tenant) criada pelo superusuário para testar isolamento
select tst.login('outra@loja.test');
set role authenticated;
select tst.throws($$select public.create_store('Loja Intrusa')$$, 'Somente administradores', 'usuário sem convite não cria loja');
reset role;
insert into public.profiles(id, email) select id, email from auth.users where email = 'outra@loja.test' on conflict do nothing;
insert into public.stores(id, name) values ('00000000-0000-0000-0000-0000000000b2', 'Outra Loja');
insert into public.store_members(store_id, user_id, role) select '00000000-0000-0000-0000-0000000000b2', id, 'admin' from auth.users where email = 'outra@loja.test';
select public._seed_store_defaults('00000000-0000-0000-0000-0000000000b2');
select tst.put('other_cat', (select id::text from public.categories where store_id = '00000000-0000-0000-0000-0000000000b2' limit 1));

-- ---------------- cadastro de produtos ----------------
select tst.login('mae@acai.test');
set role authenticated;
select tst.put('kg', (select id::text from public.units where store_id = tst.get('store')::uuid and code = 'kg'));
select tst.put('un', (select id::text from public.units where store_id = tst.get('store')::uuid and code = 'un'));
select tst.put('cat', (select id::text from public.categories where store_id = tst.get('store')::uuid and name = 'Açaí'));

insert into public.suppliers(store_id, name, phone) values (tst.get('store')::uuid, 'Distribuidora Norte', '(11) 4000-0000');
select tst.put('sup', (select id::text from public.suppliers where name = 'Distribuidora Norte'));

insert into public.products(store_id, sku, name, category_id, item_type, unit_id, min_stock, cost_price, track_lots, track_expiry)
values (tst.get('store')::uuid, 'ACAI-10', 'Polpa de açaí 10kg', tst.get('cat')::uuid, 'ingredient', tst.get('kg')::uuid, 5, 0, true, true);
select tst.put('acai', (select id::text from public.products where sku = 'ACAI-10'));
insert into public.products(store_id, sku, name, item_type, unit_id, min_stock, cost_price, sale_price)
values (tst.get('store')::uuid, 'AGUA', 'Água 500 mL', 'resale', tst.get('un')::uuid, 10, 1.20, 3.50);
select tst.put('agua', (select id::text from public.products where sku = 'AGUA'));
insert into public.products(store_id, sku, name, item_type, unit_id, cost_price)
values (tst.get('store')::uuid, 'COPO500', 'Copo 500 mL', 'packaging', tst.get('un')::uuid, 0.35);
select tst.put('copo', (select id::text from public.products where sku = 'COPO500'));
insert into public.products(store_id, sku, name, item_type, unit_id, stock_mode, sale_price)
values (tst.get('store')::uuid, 'ACAI500', 'Açaí 500 mL', 'finished', tst.get('un')::uuid, 'recipe', 22.00);
select tst.put('acai500', (select id::text from public.products where sku = 'ACAI500'));

select tst.ok((select count(*) from public.products where store_id = tst.get('store')::uuid) = 4, 'produtos criados');
update public.products set name = 'Água mineral 500 mL', min_stock = 12 where id = tst.get('agua')::uuid;
select tst.ok((select name from public.products where id = tst.get('agua')::uuid) = 'Água mineral 500 mL', 'produto editado');
select tst.ok(exists(select 1 from public.audit_logs where entity = 'products' and action = 'update'), 'edição gerou auditoria');
select tst.throws($$insert into public.products(store_id, sku, name, item_type, unit_id) values ((select tst.get('store'))::uuid, 'agua', 'Duplicado', 'resale', (select tst.get('un'))::uuid)$$,
  'duplicate key|products_store_sku_uq', 'SKU duplicado (sem diferenciar maiúsculas) é bloqueado');
select tst.throws($$insert into public.products(store_id, sku, name, item_type, unit_id, category_id) values ((select tst.get('store'))::uuid, 'X1', 'Categoria de outra loja', 'resale', (select tst.get('un'))::uuid,
  (select tst.get('other_cat'))::uuid)$$,
  'Categoria inválida|violates', 'não aceita categoria de outra loja');
select tst.throws($$update public.stock_balances set quantity = 999$$, 'permission denied', 'saldo não pode ser editado diretamente');
select tst.throws($$insert into public.stock_movements(store_id, product_id, direction, reason, quantity, balance_after, operation_id) values ((select tst.get('store'))::uuid, (select tst.get('agua'))::uuid, 'in', 'manual_entry', 5, 5, gen_random_uuid())$$,
  'permission denied', 'cliente não insere movimentação diretamente');

-- ficha técnica: 1 açaí 500 mL = 0,35 kg de polpa (+ 0% perda) + 1 copo
select public.save_recipe(tst.get('store')::uuid, tst.get('acai500')::uuid, 1, null,
  jsonb_build_array(jsonb_build_object('ingredient_id', tst.get('acai'), 'quantity', 0.35),
                    jsonb_build_object('ingredient_id', tst.get('copo'), 'quantity', 1)));
select tst.ok((select count(*) from public.recipe_items) = 2, 'ficha técnica salva com 2 ingredientes');
select tst.throws($$select public.save_recipe((select tst.get('store'))::uuid, (select tst.get('acai500'))::uuid, 1, null,
  jsonb_build_array(jsonb_build_object('ingredient_id', (select tst.get('copo')), 'quantity', 1), jsonb_build_object('ingredient_id', (select tst.get('copo')), 'quantity', 2)))$$,
  'mais de uma vez', 'ingrediente duplicado na ficha é bloqueado');
select tst.throws($$insert into public.recipe_items(recipe_id, store_id, ingredient_id, quantity) select id, store_id, product_id, 1 from public.recipes limit 1$$,
  'ficha técnica e não pode|dele mesmo', 'produto de ficha não pode ser ingrediente');

-- ---------------- entradas ----------------
select tst.throws($$select public.register_entry((select tst.get('store'))::uuid, (select tst.get('agua'))::uuid, 0, 1)$$, 'maior que zero', 'quantidade zero é rejeitada');
select tst.throws($$select public.register_entry((select tst.get('store'))::uuid, (select tst.get('agua'))::uuid, -3, 1)$$, 'maior que zero', 'quantidade negativa é rejeitada');
select tst.throws($$select public.register_entry((select tst.get('store'))::uuid, (select tst.get('agua'))::uuid, 1.5, 1)$$, 'não aceita quantidades fracionadas', 'unidade "un" não aceita fração');
select tst.throws($$select public.register_entry((select tst.get('store'))::uuid, (select tst.get('acai'))::uuid, 10, 20)$$, 'validade', 'item com validade exige data');
select tst.throws($$select public.register_entry((select tst.get('store'))::uuid, (select tst.get('acai500'))::uuid, 10, 20)$$, 'ficha técnica', 'item de ficha técnica não recebe entrada');

select tst.put('req1', gen_random_uuid()::text);
select public.register_entry(tst.get('store')::uuid, tst.get('agua')::uuid, 24, 1.00, tst.get('sup')::uuid, p_request_id => tst.get('req1')::uuid);
-- clique duplo: mesmo request_id
select public.register_entry(tst.get('store')::uuid, tst.get('agua')::uuid, 24, 1.00, tst.get('sup')::uuid, p_request_id => tst.get('req1')::uuid);
select tst.ok((select quantity from public.stock_balances where product_id = tst.get('agua')::uuid) = 24, 'entrada registrada uma única vez apesar do reenvio');
select tst.ok((select count(*) from public.stock_movements where product_id = tst.get('agua')::uuid) = 1, 'apenas 1 movimentação gerada');
select public.register_entry(tst.get('store')::uuid, tst.get('agua')::uuid, 12, 1.30);
select tst.ok((select avg_cost from public.stock_balances where product_id = tst.get('agua')::uuid) = 1.1, 'custo médio ponderado = (24×1,00 + 12×1,30)/36 = 1,10');

-- lotes da polpa: lote A vence antes (FEFO), lote B depois
select public.register_entry(tst.get('store')::uuid, tst.get('acai')::uuid, 10, 18.00, p_lot_code => 'B', p_expiry => current_date + 60);
select public.register_entry(tst.get('store')::uuid, tst.get('acai')::uuid, 10, 20.00, p_lot_code => 'A', p_expiry => current_date + 5);
select public.register_entry(tst.get('store')::uuid, tst.get('copo')::uuid, 100, 0.30);
select tst.ok((select quantity from public.stock_balances where product_id = tst.get('acai')::uuid) = 20, 'polpa: 20 kg em 2 lotes');

-- ---------------- saídas ----------------
select tst.throws($$select public.register_exit((select tst.get('store'))::uuid, (select tst.get('agua'))::uuid, 37, 'loss')$$,
  'Estoque insuficiente', 'saída maior que o estoque é bloqueada');
select public.register_exit(tst.get('store')::uuid, tst.get('agua')::uuid, 2, 'damage', 'Garrafas amassadas');
select tst.ok((select quantity from public.stock_balances where product_id = tst.get('agua')::uuid) = 34, 'saída por avaria baixa o saldo');
select tst.ok((select unit_cost from public.stock_movements where product_id = tst.get('agua')::uuid and reason = 'damage') = 1.1, 'saída valorizada pelo custo médio');
select public.register_exit(tst.get('store')::uuid, tst.get('acai')::uuid, 4, 'internal_use');
select tst.ok((select remaining_qty from public.stock_lots where lot_code = 'A') = 6, 'FEFO: consumiu primeiro o lote que vence antes');
select tst.ok((select remaining_qty from public.stock_lots where lot_code = 'B') = 10, 'FEFO: lote com validade maior intacto');
select tst.throws($$select public.register_exit((select tst.get('store'))::uuid, (select tst.get('agua'))::uuid, 1, 'purchase')$$, 'Motivo de saída inválido', 'motivo inválido rejeitado');

-- ---------------- estorno ----------------
select tst.put('mov_damage', (select id::text from public.stock_movements where product_id = tst.get('agua')::uuid and reason = 'damage'));
select public.reverse_movement(tst.get('store')::uuid, tst.get('mov_damage')::uuid, 'Lançado por engano');
select tst.ok((select quantity from public.stock_balances where product_id = tst.get('agua')::uuid) = 36, 'estorno devolveu o saldo');
select tst.ok((select reversed_by_movement_id is not null from public.stock_movements where id = tst.get('mov_damage')::uuid), 'original marcada como estornada');
select tst.throws($$select public.reverse_movement((select tst.get('store'))::uuid, (select tst.get('mov_damage'))::uuid, 'de novo')$$, 'já foi estornada', 'não estorna duas vezes');
select tst.throws($$select public.reverse_movement((select tst.get('store'))::uuid, (select reversed_by_movement_id from public.stock_movements where id = (select tst.get('mov_damage'))::uuid), 'estorno do estorno')$$,
  'estornar um estorno', 'não estorna um estorno');
reset role;
select tst.throws($$delete from public.stock_movements$$, 'não podem ser apagadas', 'movimentações não podem ser apagadas (nem pelo superusuário)');
select tst.throws($$update public.stock_movements set quantity = 1$$, 'não podem ser alteradas', 'movimentações não podem ser alteradas');
select tst.login('mae@acai.test');
set role authenticated;

-- ---------------- compras ----------------
select tst.put('pur', (public.save_purchase(tst.get('store')::uuid, null, jsonb_build_object(
  'supplier_id', tst.get('sup'), 'document_number', 'NF 123', 'discount', 10, 'freight', 20,
  'items', jsonb_build_array(
     jsonb_build_object('product_id', tst.get('agua'), 'quantity', 48, 'unit_cost', 1.00),
     jsonb_build_object('product_id', tst.get('acai'), 'quantity', 10, 'unit_cost', 19.00, 'lot_code', 'C')
  )))->>'purchase_id'));
select tst.ok((select total from public.purchases where id = tst.get('pur')::uuid) = 248.00, 'total da compra = 48 + 190 − 10 + 20 = 248');
select tst.ok((select quantity from public.stock_balances where product_id = tst.get('agua')::uuid) = 36, 'rascunho NÃO altera estoque');
select tst.throws($$select public.receive_purchase((select tst.get('store'))::uuid, (select tst.get('pur'))::uuid)$$, 'validade', 'recebimento exige validade de item controlado');
select public.save_purchase(tst.get('store')::uuid, tst.get('pur')::uuid, jsonb_build_object(
  'supplier_id', tst.get('sup'), 'document_number', 'NF 123', 'discount', 10, 'freight', 20,
  'items', jsonb_build_array(
     jsonb_build_object('product_id', tst.get('agua'), 'quantity', 48, 'unit_cost', 1.00),
     jsonb_build_object('product_id', tst.get('acai'), 'quantity', 10, 'unit_cost', 19.00, 'lot_code', 'C', 'expiry_date', (current_date + 90)::text)
  )));
select public.receive_purchase(tst.get('store')::uuid, tst.get('pur')::uuid);
select tst.ok((select quantity from public.stock_balances where product_id = tst.get('agua')::uuid) = 84, 'recebimento gerou entrada (36 + 48)');
select tst.ok((select status from public.purchases where id = tst.get('pur')::uuid) = 'received', 'compra marcada como recebida');
select tst.ok((select landed_unit_cost from public.purchase_items where purchase_id = tst.get('pur')::uuid and product_id = tst.get('agua')::uuid)
               = round((48 + 10 * 48 / 238.0) / 48, 4), 'frete − desconto rateado no custo unitário');
select tst.throws($$select public.receive_purchase((select tst.get('store'))::uuid, (select tst.get('pur'))::uuid)$$, 'já foi recebida', 'recebimento duplicado é bloqueado');
select tst.throws($$select public.save_purchase((select tst.get('store'))::uuid, (select tst.get('pur'))::uuid, '{"items":[{"product_id":"00000000-0000-0000-0000-000000000000","quantity":1,"unit_cost":1}]}')$$,
  'rascunho', 'compra recebida não pode ser editada');

-- ---------------- vendas ----------------
select tst.put('sale1', (public.create_sale(tst.get('store')::uuid, jsonb_build_object('payment_method', 'pix',
  'items', jsonb_build_array(jsonb_build_object('product_id', tst.get('agua'), 'quantity', 2),
                             jsonb_build_object('product_id', tst.get('acai500'), 'quantity', 3, 'discount', 2))),
  gen_random_uuid())->>'sale_id'));
select tst.ok((select total from public.sales where id = tst.get('sale1')::uuid) = 71.00, 'total da venda = 2×3,50 + 3×22 − 2 = 71,00');
select tst.ok((select quantity from public.stock_balances where product_id = tst.get('agua')::uuid) = 82, 'venda baixou o produto de revenda');
select tst.ok((select quantity from public.stock_balances where product_id = tst.get('acai')::uuid) = 24.95, 'ficha técnica baixou 3 × 0,35 kg de polpa (26 − 1,05)');
select tst.ok((select quantity from public.stock_balances where product_id = tst.get('copo')::uuid) = 97, 'ficha técnica baixou 3 copos');
select tst.ok(not exists(select 1 from public.stock_balances where product_id = tst.get('acai500')::uuid and quantity <> 0), 'produto de ficha não tem estoque próprio baixado');
select tst.ok((select cost_complete and cost_total > 0 from public.sales where id = tst.get('sale1')::uuid), 'venda com CMV conhecido');

-- reenvio da mesma venda
select tst.put('req_sale', gen_random_uuid()::text);
select public.create_sale(tst.get('store')::uuid, jsonb_build_object('items', jsonb_build_array(jsonb_build_object('product_id', tst.get('agua'), 'quantity', 1))), tst.get('req_sale')::uuid);
select public.create_sale(tst.get('store')::uuid, jsonb_build_object('items', jsonb_build_array(jsonb_build_object('product_id', tst.get('agua'), 'quantity', 1))), tst.get('req_sale')::uuid);
select tst.ok((select quantity from public.stock_balances where product_id = tst.get('agua')::uuid) = 81, 'venda reenviada não baixa estoque duas vezes');
select tst.throws($$select public.create_sale((select tst.get('store'))::uuid, jsonb_build_object('items', jsonb_build_array(jsonb_build_object('product_id', (select tst.get('agua')), 'quantity', 500))))$$,
  'Estoque insuficiente', 'venda acima do estoque é bloqueada');
select tst.ok((select count(*) from public.sales where store_id = tst.get('store')::uuid) = 2, 'venda bloqueada não deixou registro parcial (transação desfeita)');

-- cancelamento com estorno
select public.cancel_sale(tst.get('store')::uuid, tst.get('sale1')::uuid, 'Cliente desistiu');
select tst.ok((select status from public.sales where id = tst.get('sale1')::uuid) = 'cancelled', 'venda cancelada');
select tst.ok((select quantity from public.stock_balances where product_id = tst.get('agua')::uuid) = 83, 'cancelamento devolveu a água');
select tst.ok((select quantity from public.stock_balances where product_id = tst.get('acai')::uuid) = 26, 'cancelamento devolveu a polpa');
select tst.ok((select count(*) from public.stock_movements where sale_id = tst.get('sale1')::uuid and reason = 'sale_cancel') = 3, 'estornos rastreáveis ligados à venda');
select tst.ok(exists(select 1 from public.sale_items where sale_id = tst.get('sale1')::uuid), 'histórico da venda preservado');
select tst.throws($$select public.cancel_sale((select tst.get('store'))::uuid, (select tst.get('sale1'))::uuid, 'de novo')$$, 'já está cancelada', 'não cancela duas vezes');
select tst.throws($$select public.reverse_movement((select tst.get('store'))::uuid, (select id from public.stock_movements where sale_id = (select tst.get('sale1'))::uuid limit 1), 'tentativa')$$,
  'Cancele a venda|já foi estornada', 'saída de venda não é estornada avulsa');

-- ---------------- lotes vencidos ----------------
reset role;
-- simula o vencimento do lote A (ajuste de data direto, apenas no teste)
update public.stock_lots set expiry_date = current_date - 1 where lot_code = 'A';
select tst.login('mae@acai.test');
set role authenticated;
select tst.ok((public.get_dashboard(tst.get('store')::uuid, current_date, current_date)->'kpis'->>'expired_lots')::int = 1, 'dashboard aponta 1 lote vencido');
select tst.throws($$select public.create_sale((select tst.get('store'))::uuid, jsonb_build_object('items', jsonb_build_array(jsonb_build_object('product_id', (select tst.get('acai500')), 'quantity', 60))))$$,
  'lotes vencidos', 'venda não usa lote vencido (21 kg pedidos, 20 kg válidos + 6 kg vencidos)');
select public.register_exit(tst.get('store')::uuid, tst.get('acai')::uuid, 6, 'expired', 'Lote A vencido', p_lot_id => (select id from public.stock_lots where lot_code = 'A'));
select tst.ok((select remaining_qty from public.stock_lots where lot_code = 'A') = 0, 'baixa de vencido zerou o lote A');
select tst.ok((public.get_dashboard(tst.get('store')::uuid, current_date, current_date)->'kpis'->>'expired_lots')::int = 0, 'dashboard sem lotes vencidos após a baixa');
select public.register_exit(tst.get('store')::uuid, tst.get('acai')::uuid, 19, 'internal_use');
select tst.ok((select quantity from public.stock_balances where product_id = tst.get('acai')::uuid) = 1, 'saldo 1 kg');
select tst.throws($$select public.create_sale((select tst.get('store'))::uuid, jsonb_build_object('items', jsonb_build_array(jsonb_build_object('product_id', (select tst.get('acai500')), 'quantity', 3))))$$,
  'insuficiente', 'venda bloqueada por estoque insuficiente de ingrediente da ficha');
select tst.ok((select sum(remaining_qty) from public.stock_lots where product_id = tst.get('acai')::uuid) = 1, 'soma dos lotes = saldo');

-- ---------------- inventário ----------------
select tst.put('inv', (public.save_inventory_count(tst.get('store')::uuid, null, 'Contagem mensal',
  jsonb_build_array(jsonb_build_object('product_id', tst.get('agua'), 'counted_qty', 80, 'reason', 'Quebra'),
                    jsonb_build_object('product_id', tst.get('copo'), 'counted_qty', 100)))->>'inventory_count_id'));
select public.confirm_inventory_count(tst.get('store')::uuid, tst.get('inv')::uuid);
select tst.ok((select quantity from public.stock_balances where product_id = tst.get('agua')::uuid) = 80, 'inventário ajustou água para 80');
select tst.ok((select difference from public.inventory_count_items where product_id = tst.get('agua')::uuid) = -3, 'diferença registrada (−3)');
select tst.ok((select theoretical_qty from public.inventory_count_items where product_id = tst.get('copo')::uuid) = 100, 'quantidade teórica registrada');
select tst.ok((select count(*) from public.stock_movements where inventory_count_id = tst.get('inv')::uuid) = 1, 'só itens com diferença geram ajuste');
select tst.throws($$select public.confirm_inventory_count((select tst.get('store'))::uuid, (select tst.get('inv'))::uuid)$$, 'já foi finalizado', 'inventário não é confirmado duas vezes');

-- ---------------- estoque negativo (exceção do admin) ----------------
update public.stores set allow_negative_stock = true where id = tst.get('store')::uuid;
select public.register_exit(tst.get('store')::uuid, tst.get('copo')::uuid, 101, 'loss', 'teste exceção');
select tst.ok((select quantity from public.stock_balances where product_id = tst.get('copo')::uuid) = -1, 'com exceção ativada o saldo pode ficar negativo');
select tst.ok(exists(select 1 from public.audit_logs where action = 'negative_stock_override'), 'exceção registrada na auditoria');
update public.stores set allow_negative_stock = false where id = tst.get('store')::uuid;
select public.register_entry(tst.get('store')::uuid, tst.get('copo')::uuid, 1, 0.30);

-- ---------------- integridade ----------------
select tst.ok((select count(*) from public.check_stock_integrity(tst.get('store')::uuid)) = 0, 'saldo em cache = soma das movimentações');
reset role;

-- ---------------- permissões do operador ----------------
select tst.login('func@acai.test');
set role authenticated;
select tst.ok((select count(*) from public.products where store_id = (select tst.get('store'))::uuid) = 4, 'operadora enxerga os produtos');
select public.register_exit(tst.get('store')::uuid, tst.get('agua')::uuid, 1, 'internal_use');
select tst.ok((select created_by from public.stock_movements order by created_at desc limit 1) = auth.uid(), 'movimentação registra a operadora como responsável');
select public.create_sale(tst.get('store')::uuid, jsonb_build_object('items', jsonb_build_array(jsonb_build_object('product_id', tst.get('agua'), 'quantity', 1))));
select tst.ok(true, 'operadora lança venda');
update public.products set sale_price = 0.01 where id = tst.get('agua')::uuid;
select tst.ok((select sale_price from public.products where id = tst.get('agua')::uuid) = 3.50, 'operadora NÃO altera preço (RLS ignora o update)');
select tst.throws($$insert into public.products(store_id, sku, name, item_type, unit_id) values ((select tst.get('store'))::uuid, 'OP1', 'Produto operadora', 'resale', (select tst.get('un'))::uuid)$$,
  'row-level security', 'operadora não cadastra produto');
update public.stores set allow_negative_stock = true where id = tst.get('store')::uuid;
select tst.ok(not (select allow_negative_stock from public.stores where id = tst.get('store')::uuid), 'operadora não altera configurações críticas');
select tst.throws($$select public.reverse_movement((select tst.get('store'))::uuid, (select id from public.stock_movements where reason = 'manual_entry' limit 1), 'tentativa')$$,
  'Apenas administradores', 'operadora não estorna');
select tst.throws($$select public.cancel_sale((select tst.get('store'))::uuid, (select id from public.sales where status = 'confirmed' limit 1), 'tentativa')$$,
  'Apenas administradores', 'operadora não cancela venda');
select tst.throws($$select public.invite_member((select tst.get('store'))::uuid, 'x@y.com', 'admin')$$, 'Apenas administradores', 'operadora não convida usuários');
update public.store_members set role = 'admin' where user_id = auth.uid();
select tst.ok((select role from public.store_members where user_id = auth.uid()) = 'operator', 'operadora não se promove a admin');
select tst.ok((select count(*) from public.audit_logs) = 0, 'operadora não lê auditoria');
select tst.throws($$select public.clear_demo_data((select tst.get('store'))::uuid, 'LIMPAR')$$, 'Apenas administradores', 'operadora não limpa dados');
reset role;

-- ---------------- isolamento entre lojas ----------------
select tst.login('outra@loja.test');
set role authenticated;
select tst.ok((select count(*) from public.products) = 0, 'outra loja não vê produtos');
select tst.ok((select count(*) from public.stock_movements) = 0, 'outra loja não vê movimentações');
select tst.ok((select count(*) from public.sales) = 0, 'outra loja não vê vendas');
select tst.ok((select count(*) from public.suppliers) = 0, 'outra loja não vê fornecedores');
select tst.ok((select count(*) from public.v_stock_position) = 0, 'view de estoque respeita RLS');
select tst.ok((select count(*) from public.stores) = 1, 'enxerga só a própria loja');
select tst.ok((select count(*) from public.profiles) = 1, 'não enxerga perfis de outra loja');
select tst.throws($$select public.register_exit((select tst.get('store'))::uuid, (select tst.get('agua'))::uuid, 1, 'loss')$$, 'não tem acesso', 'não movimenta estoque de outra loja');
select tst.throws($$select public.get_dashboard((select tst.get('store'))::uuid, current_date, current_date)$$, 'não tem acesso', 'não lê dashboard de outra loja');
select tst.throws($$select public.register_entry('00000000-0000-0000-0000-0000000000b2', (select tst.get('agua'))::uuid, 1, 1)$$, 'inexistente|não encontrado', 'não usa produto de outra loja na própria loja');
update public.products set name = 'hack' where id = tst.get('agua')::uuid;
reset role;
select tst.ok((select name from public.products where id = tst.get('agua')::uuid) <> 'hack', 'update em produto de outra loja não tem efeito');

-- ---------------- anônimo ----------------
select set_config('request.jwt.claims', '{}', false);
set role anon;
select tst.throws($$select * from public.products$$, 'permission denied', 'anônimo não lê produtos');
select tst.throws($$select public.create_sale('00000000-0000-0000-0000-000000000000', '{}')$$, 'permission denied', 'anônimo não executa RPC');
reset role;

-- ---------------- dashboard ----------------
select tst.login('mae@acai.test');
set role authenticated;
select tst.put('dash', public.get_dashboard(tst.get('store')::uuid, current_date - 6, current_date)::text);
select tst.ok((tst.get('dash')::jsonb->'kpis'->>'sales_count')::int = 2, 'dashboard conta só vendas confirmadas (2)');
select tst.ok((tst.get('dash')::jsonb->'kpis'->>'revenue')::numeric = 7.00, 'receita = 2 × 3,50');
select tst.ok((tst.get('dash')::jsonb->'kpis'->>'stock_value')::numeric =
              (select sum(stock_value) from public.v_stock_position where store_id = tst.get('store')::uuid and stock_mode = 'stock' and active), 'valor do estoque consistente');
select tst.ok(jsonb_array_length(tst.get('dash')::jsonb->'daily') = 7, 'série diária com 7 dias');
select tst.ok(abs((tst.get('dash')::jsonb->'daily'->6->>'stock_value')::numeric - (tst.get('dash')::jsonb->'kpis'->>'stock_value')::numeric) < 0.5,
              'evolução do valor do estoque termina no valor atual');
select tst.ok((select count(*) from jsonb_array_elements(tst.get('dash')::jsonb->'kpis'->'qty_by_unit')) = 2, 'quantidades separadas por unidade (kg, un)');
select tst.put('rev_before', tst.get('dash')::jsonb->'kpis'->>'revenue');
select public.create_sale(tst.get('store')::uuid, jsonb_build_object('items', jsonb_build_array(jsonb_build_object('product_id', tst.get('agua'), 'quantity', 2, 'unit_price', 4))));
select tst.ok((public.get_dashboard(tst.get('store')::uuid, current_date - 6, current_date)->'kpis'->>'revenue')::numeric = tst.get('rev_before')::numeric + 8,
              'dashboard atualiza após nova venda');
select tst.ok((select count(*) from public.report_product_sales(tst.get('store')::uuid, current_date - 30, current_date)) = 1, 'relatório de produtos vendidos');
select tst.ok((select total from public.report_purchases_by_supplier(tst.get('store')::uuid, current_date - 30, current_date)) = 248, 'relatório de compras por fornecedor');

-- ---------------- cancelamento de compra recebida ----------------
select tst.throws($$select public.cancel_purchase((select tst.get('store'))::uuid, (select tst.get('pur'))::uuid, 'NF errada')$$, 'consumido|insuficiente', 'não cancela compra cujos itens já foram consumidos');

-- ---------------- demonstração ----------------
select tst.ok(public.seed_demo_data(tst.get('store')::uuid) = 5, '5 itens DEMO criados (sem estoque, sem preço)');
select tst.ok((select count(*) from public.products where is_demo and (sale_price is not null or cost_price > 0)) = 0, 'itens DEMO sem valores fictícios');
select public.register_entry(tst.get('store')::uuid, (select id from public.products where sku = 'DEMO-004'), 10, 0.5);
select public.create_sale(tst.get('store')::uuid, jsonb_build_object('items', jsonb_build_array(
  jsonb_build_object('product_id', (select id from public.products where sku = 'DEMO-004'), 'quantity', 1, 'unit_price', 1),
  jsonb_build_object('product_id', tst.get('agua'), 'quantity', 1))));
select tst.put('agua_before_clear', (select quantity::text from public.stock_balances where product_id = tst.get('agua')::uuid));
select tst.throws($$select public.clear_demo_data((select tst.get('store'))::uuid, 'sim')$$, 'LIMPAR', 'limpeza exige confirmação textual');
select public.clear_demo_data(tst.get('store')::uuid, 'LIMPAR');
select tst.ok((select count(*) from public.products where is_demo) = 0, 'itens DEMO removidos');
select tst.ok((select quantity from public.stock_balances where product_id = tst.get('agua')::uuid) = tst.get('agua_before_clear')::numeric + 1,
              'venda mista com DEMO removida e saldo real recalculado');
select tst.ok((select count(*) from public.check_stock_integrity(tst.get('store')::uuid)) = 0, 'integridade após limpeza');
select tst.ok(public.rebuild_stock_balances(tst.get('store')::uuid) > 0, 'reconstrução de saldos executa');
select tst.ok((select count(*) from public.check_stock_integrity(tst.get('store')::uuid)) = 0, 'integridade após reconstrução');
reset role;

select tst.ok(true, 'TODOS OS TESTES DE REGRAS DE NEGÓCIO PASSARAM');
