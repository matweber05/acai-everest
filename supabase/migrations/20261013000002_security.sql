-- =====================================================================
-- Açaí Everest — Migration 002: segurança (RLS, permissões, auditoria)
--
-- Modelo:
--   * O cliente (navegador/app) usa SOMENTE a anon key + JWT do usuário.
--   * Leitura: qualquer membro ativo da loja.
--   * Cadastros (produtos, categorias, fornecedores, unidades, fichas): só admin.
--   * Estoque, compras, vendas, inventário: escrita SOMENTE via funções RPC
--     (security definer) que validam perfil, loja e consistência.
-- =====================================================================

-- ---------- Funções auxiliares ----------
create or replace function public.current_role_in_store(p_store uuid)
returns public.member_role language sql stable security definer set search_path = public as $$
  select role from public.store_members
   where store_id = p_store and user_id = auth.uid() and active
$$;

create or replace function public.is_store_member(p_store uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.store_members
                  where store_id = p_store and user_id = auth.uid() and active)
$$;

create or replace function public.is_store_admin(p_store uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.store_members
                  where store_id = p_store and user_id = auth.uid() and active and role = 'admin')
$$;

-- Lança erro amigável se o usuário não tiver o perfil exigido.
create or replace function public._require_role(p_store uuid, p_admin_only boolean default false)
returns public.member_role language plpgsql stable security definer set search_path = public as $$
declare v_role public.member_role;
begin
  if auth.uid() is null then
    raise exception 'Sessão expirada. Faça login novamente.' using errcode = '28000';
  end if;
  v_role := public.current_role_in_store(p_store);
  if v_role is null then
    raise exception 'Você não tem acesso a esta loja.' using errcode = '42501';
  end if;
  if p_admin_only and v_role <> 'admin' then
    raise exception 'Apenas administradores podem realizar esta operação.' using errcode = '42501';
  end if;
  return v_role;
end $$;

create or replace function public._audit(p_store uuid, p_action text, p_entity text, p_entity_id uuid, p_details jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = public as $$
  insert into public.audit_logs(store_id, user_id, action, entity, entity_id, details)
  values (p_store, auth.uid(), p_action, p_entity, p_entity_id, coalesce(p_details, '{}'::jsonb));
$$;

-- ---------- Novo usuário => perfil + convites pendentes ----------
create or replace function public.tg_handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare inv record;
begin
  insert into public.profiles(id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;

  for inv in select * from public.store_invites
              where lower(email) = lower(new.email) and accepted_at is null loop
    insert into public.store_members(store_id, user_id, role)
    values (inv.store_id, new.id, inv.role)
    on conflict (store_id, user_id) do update set role = excluded.role, active = true;
    update public.store_invites set accepted_at = now() where id = inv.id;
    insert into public.audit_logs(store_id, user_id, action, entity, entity_id, details)
    values (inv.store_id, new.id, 'invite_accepted', 'store_members', new.id, jsonb_build_object('email', new.email, 'role', inv.role));
  end loop;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.tg_handle_new_user();

-- ---------- Consistência entre lojas (FKs apontando para a mesma loja) ----------
create or replace function public.tg_products_same_store() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.units where id = new.unit_id and store_id = new.store_id) then
    raise exception 'Unidade de medida inválida para esta loja.';
  end if;
  if new.category_id is not null and not exists (select 1 from public.categories where id = new.category_id and store_id = new.store_id) then
    raise exception 'Categoria inválida para esta loja.';
  end if;
  if new.default_supplier_id is not null and not exists (select 1 from public.suppliers where id = new.default_supplier_id and store_id = new.store_id) then
    raise exception 'Fornecedor inválido para esta loja.';
  end if;
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    if coalesce(current_setting('app.seeding_demo', true), '') <> 'on' then new.is_demo := false; end if;
  end if;
  if tg_op = 'UPDATE' then
    if new.store_id <> old.store_id then raise exception 'Não é permitido mudar a loja do produto.'; end if;
    -- Mudar o modelo de estoque de um item que já tem histórico quebraria a rastreabilidade
    if new.stock_mode <> old.stock_mode and exists (select 1 from public.stock_movements where product_id = new.id) then
      raise exception 'Não é possível mudar o modelo de estoque de um item com movimentações. Crie um novo item.';
    end if;
    if new.stock_mode = 'recipe' and old.stock_mode = 'stock' and exists (select 1 from public.recipe_items where ingredient_id = new.id) then
      raise exception 'Este item é ingrediente de outra ficha técnica.';
    end if;
  end if;
  return new;
end $$;
create trigger products_same_store before insert or update on public.products
  for each row execute function public.tg_products_same_store();

create or replace function public.tg_recipe_items_check() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_recipe record; v_ing record;
begin
  select r.*, p.stock_mode as product_mode into v_recipe
    from public.recipes r join public.products p on p.id = r.product_id where r.id = new.recipe_id;
  select * into v_ing from public.products where id = new.ingredient_id;
  if v_ing.id is null or v_ing.store_id <> v_recipe.store_id or new.store_id <> v_recipe.store_id then
    raise exception 'Ingrediente inválido para esta loja.';
  end if;
  if v_ing.stock_mode <> 'stock' then
    raise exception 'O ingrediente "%" é baixado por ficha técnica e não pode ser usado como ingrediente.', v_ing.name;
  end if;
  if new.ingredient_id = v_recipe.product_id then
    raise exception 'Um produto não pode ser ingrediente dele mesmo.';
  end if;
  return new;
end $$;
create trigger recipe_items_check before insert or update on public.recipe_items
  for each row execute function public.tg_recipe_items_check();

create or replace function public.tg_recipes_check() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.products where id = new.product_id and store_id = new.store_id) then
    raise exception 'Produto inválido para esta loja.';
  end if;
  return new;
end $$;
create trigger recipes_check before insert or update on public.recipes
  for each row execute function public.tg_recipes_check();

-- ---------- Auditoria automática de cadastros ----------
create or replace function public.tg_audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_store uuid; v_id uuid; v_changes jsonb := '{}'::jsonb; k text;
begin
  if tg_op = 'DELETE' then
    v_store := case when tg_table_name = 'stores' then (to_jsonb(old)->>'id')::uuid else (to_jsonb(old)->>'store_id')::uuid end;
    v_id := coalesce((to_jsonb(old)->>'id')::uuid, (to_jsonb(old)->>'user_id')::uuid);
    v_changes := to_jsonb(old);
  else
    v_store := case when tg_table_name = 'stores' then (to_jsonb(new)->>'id')::uuid else (to_jsonb(new)->>'store_id')::uuid end;
    v_id := coalesce((to_jsonb(new)->>'id')::uuid, (to_jsonb(new)->>'user_id')::uuid);
    if tg_op = 'UPDATE' then
      for k in select jsonb_object_keys(to_jsonb(new)) loop
        if k not in ('updated_at') and to_jsonb(new)->k is distinct from to_jsonb(old)->k then
          v_changes := v_changes || jsonb_build_object(k, jsonb_build_object('de', to_jsonb(old)->k, 'para', to_jsonb(new)->k));
        end if;
      end loop;
      if v_changes = '{}'::jsonb then return new; end if;
    else
      v_changes := to_jsonb(new);
    end if;
  end if;
  if tg_op = 'DELETE' and tg_table_name = 'stores' then return old; end if;
  insert into public.audit_logs(store_id, user_id, action, entity, entity_id, details)
  values (v_store, auth.uid(), lower(tg_op), tg_table_name, v_id, v_changes);
  return case when tg_op = 'DELETE' then old else new end;
end $$;

create trigger audit_stores after update on public.stores for each row execute function public.tg_audit_row();
create trigger audit_store_members after insert or update or delete on public.store_members for each row execute function public.tg_audit_row();
create trigger audit_products after insert or update or delete on public.products for each row execute function public.tg_audit_row();
create trigger audit_categories after insert or update or delete on public.categories for each row execute function public.tg_audit_row();
create trigger audit_suppliers after insert or update or delete on public.suppliers for each row execute function public.tg_audit_row();
create trigger audit_units after insert or update or delete on public.units for each row execute function public.tg_audit_row();
create trigger audit_recipes after insert or update or delete on public.recipes for each row execute function public.tg_audit_row();

-- Impede exclusão física de produto com histórico (mensagem amigável; a FK também protegeria)
create or replace function public.tg_products_no_delete_with_history() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if current_setting('app.allow_demo_cleanup', true) = 'on' then return old; end if;
  if exists (select 1 from public.stock_movements where product_id = old.id)
     or exists (select 1 from public.sale_items where product_id = old.id)
     or exists (select 1 from public.purchase_items where product_id = old.id)
     or exists (select 1 from public.recipe_items where ingredient_id = old.id) then
    raise exception 'Este item possui histórico e não pode ser excluído. Inative-o.' using errcode = 'P0001';
  end if;
  return old;
end $$;
create trigger products_no_delete before delete on public.products
  for each row execute function public.tg_products_no_delete_with_history();

-- Admin não pode remover o próprio acesso de admin se for o último
create or replace function public.tg_store_members_keep_admin() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_store uuid := coalesce(old.store_id, new.store_id);
begin
  if (tg_op = 'DELETE' and old.role = 'admin' and old.active)
     or (tg_op = 'UPDATE' and old.role = 'admin' and old.active and (new.role <> 'admin' or not new.active)) then
    if not exists (select 1 from public.store_members
                    where store_id = v_store and role = 'admin' and active and user_id <> old.user_id) then
      raise exception 'A loja precisa ter pelo menos um administrador ativo.';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
create trigger store_members_keep_admin before update or delete on public.store_members
  for each row execute function public.tg_store_members_keep_admin();

-- ---------- RLS ----------
alter table public.stores enable row level security;
alter table public.profiles enable row level security;
alter table public.store_members enable row level security;
alter table public.store_invites enable row level security;
alter table public.units enable row level security;
alter table public.categories enable row level security;
alter table public.suppliers enable row level security;
alter table public.products enable row level security;
alter table public.stock_balances enable row level security;
alter table public.stock_lots enable row level security;
alter table public.stock_movements enable row level security;
alter table public.stock_movement_lots enable row level security;
alter table public.store_counters enable row level security;
alter table public.purchases enable row level security;
alter table public.purchase_items enable row level security;
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;
alter table public.recipes enable row level security;
alter table public.recipe_items enable row level security;
alter table public.inventory_counts enable row level security;
alter table public.inventory_count_items enable row level security;
alter table public.audit_logs enable row level security;
alter table public.operation_requests enable row level security;

-- stores
create policy stores_select on public.stores for select to authenticated using (public.is_store_member(id));
create policy stores_update on public.stores for update to authenticated
  using (public.is_store_admin(id)) with check (public.is_store_admin(id));

-- profiles: o próprio usuário e colegas de loja
create policy profiles_select on public.profiles for select to authenticated using (
  id = auth.uid() or exists (
    select 1 from public.store_members a join public.store_members b on a.store_id = b.store_id
     where a.user_id = auth.uid() and a.active and b.user_id = profiles.id));
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- store_members
create policy members_select on public.store_members for select to authenticated
  using (user_id = auth.uid() or public.is_store_member(store_id));
create policy members_update on public.store_members for update to authenticated
  using (public.is_store_admin(store_id)) with check (public.is_store_admin(store_id));
create policy members_delete on public.store_members for delete to authenticated
  using (public.is_store_admin(store_id));

-- convites
create policy invites_select on public.store_invites for select to authenticated using (public.is_store_admin(store_id));
create policy invites_insert on public.store_invites for insert to authenticated with check (public.is_store_admin(store_id));
create policy invites_delete on public.store_invites for delete to authenticated using (public.is_store_admin(store_id));

-- Cadastros: leitura para membros, escrita para admin
do $$
declare t text;
begin
  foreach t in array array['units','categories','suppliers','products','recipes','recipe_items'] loop
    execute format('create policy %1$s_select on public.%1$s for select to authenticated using (public.is_store_member(store_id))', t);
    execute format('create policy %1$s_insert on public.%1$s for insert to authenticated with check (public.is_store_admin(store_id))', t);
    execute format('create policy %1$s_update on public.%1$s for update to authenticated using (public.is_store_admin(store_id)) with check (public.is_store_admin(store_id))', t);
    execute format('create policy %1$s_delete on public.%1$s for delete to authenticated using (public.is_store_admin(store_id))', t);
  end loop;
  -- Tabelas operacionais: apenas leitura direta; escrita via RPC
  foreach t in array array['stock_balances','stock_lots','stock_movements','purchases','purchase_items',
                           'sales','sale_items','inventory_counts','inventory_count_items'] loop
    execute format('create policy %1$s_select on public.%1$s for select to authenticated using (public.is_store_member(store_id))', t);
  end loop;
end $$;

create policy stock_movement_lots_select on public.stock_movement_lots for select to authenticated using (
  exists (select 1 from public.stock_movements m where m.id = movement_id and public.is_store_member(m.store_id)));
create policy audit_select on public.audit_logs for select to authenticated using (public.is_store_admin(store_id));
-- store_counters e operation_requests: sem políticas => inacessíveis ao cliente.

-- ---------- Privilégios ----------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;

grant select on all tables in schema public to authenticated;
revoke select on public.store_counters, public.operation_requests from authenticated;
grant insert, update, delete on public.units, public.categories, public.suppliers, public.products,
  public.recipes, public.recipe_items, public.store_invites, public.store_members to authenticated;
grant update (name, legal_name, phone, address, logo_path, timezone, allow_negative_stock,
              expiry_alert_days, low_stock_alerts, display_prefs) on public.stores to authenticated;
grant update (full_name) on public.profiles to authenticated;
-- Ninguém do lado do cliente pode alterar o store_id/autor de um produto via update:
revoke update on public.products from authenticated;
grant update (sku, barcode, name, description, category_id, item_type, unit_id, stock_mode, min_stock, max_stock,
              cost_price, sale_price, default_supplier_id, track_lots, track_expiry, active) on public.products to authenticated;
revoke update on public.store_members from authenticated;
grant update (role, active) on public.store_members to authenticated;

grant execute on function public.is_store_member(uuid), public.is_store_admin(uuid),
  public.current_role_in_store(uuid) to authenticated;
-- Funções-gatilho precisam ser executáveis pelo papel que dispara o gatilho
grant execute on function public.tg_set_updated_at(), public.tg_audit_row(), public.tg_products_same_store(),
  public.tg_recipe_items_check(), public.tg_recipes_check(), public.tg_products_no_delete_with_history(),
  public.tg_store_members_keep_admin(), public.tg_stock_movements_immutable() to authenticated;

alter default privileges in schema public revoke execute on functions from public, anon;
