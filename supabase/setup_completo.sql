-- Açaí Everest — instalação completa do banco (cole no SQL Editor do Supabase e clique em Run).
-- Gerado a partir de supabase/migrations/. Execute UMA vez em um projeto novo.

-- ===================== supabase/migrations/20261013000001_schema.sql =====================
-- =====================================================================
-- Açaí Everest — Migration 001: esquema principal
-- Convenções:
--   * Dinheiro: numeric(14,2). Custos unitários: numeric(14,4). Quantidades: numeric(14,3).
--   * Datas/horas: timestamptz (UTC no banco); datas de calendário: date.
--   * Isolamento multi-loja: toda tabela de negócio tem store_id.
--   * Fonte da verdade do estoque: stock_movements. stock_balances é um cache
--     mantido somente pelas funções transacionais (o cliente não escreve nele).
-- =====================================================================

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

-- ---------- Tipos ----------
create type public.member_role as enum ('admin', 'operator');
create type public.item_type as enum ('resale', 'ingredient', 'packaging', 'consumable', 'finished');
create type public.stock_mode as enum ('stock', 'recipe');
create type public.movement_direction as enum ('in', 'out');
create type public.movement_reason as enum (
  'purchase',            -- recebimento de compra
  'manual_entry',        -- entrada manual
  'initial_stock',       -- implantação / saldo inicial
  'return_in',           -- devolução de cliente (entrada)
  'sale',                -- venda
  'internal_use',        -- consumo interno
  'loss',                -- perda
  'expired',             -- produto vencido
  'damage',              -- avaria
  'return_out',          -- devolução ao fornecedor
  'inventory_adjustment',-- ajuste de inventário
  'reversal',            -- estorno de movimentação
  'sale_cancel',         -- estorno por cancelamento de venda
  'purchase_cancel'      -- estorno por cancelamento de compra
);
create type public.purchase_status as enum ('draft', 'received', 'cancelled');
create type public.sale_status as enum ('confirmed', 'cancelled');
create type public.payment_method as enum ('cash', 'pix', 'debit', 'credit', 'other');
create type public.inventory_status as enum ('open', 'confirmed', 'cancelled');

-- ---------- updated_at ----------
create or replace function public.tg_set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------- Lojas ----------
create table public.stores (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 2 and 120),
  legal_name text,
  phone text,
  address text,
  logo_path text,
  timezone text not null default 'America/Sao_Paulo',
  allow_negative_stock boolean not null default false,
  expiry_alert_days int[] not null default '{7,15,30}',
  low_stock_alerts boolean not null default true,
  display_prefs jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint expiry_days_valid check (
    array_length(expiry_alert_days, 1) between 1 and 5
    and 0 < all(expiry_alert_days) and 366 > all(expiry_alert_days))
);
create trigger stores_updated before update on public.stores
  for each row execute function public.tg_set_updated_at();

-- ---------- Perfis ----------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger profiles_updated before update on public.profiles
  for each row execute function public.tg_set_updated_at();

create table public.store_members (
  store_id uuid not null references public.stores(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.member_role not null default 'operator',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (store_id, user_id)
);
create index store_members_user_idx on public.store_members(user_id);
create trigger store_members_updated before update on public.store_members
  for each row execute function public.tg_set_updated_at();

-- Convites: quando alguém se cadastra com esse e-mail, entra automaticamente na loja.
create table public.store_invites (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  email text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  role public.member_role not null default 'operator',
  invited_by uuid references public.profiles(id),
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index store_invites_pending_uq on public.store_invites(store_id, lower(email)) where accepted_at is null;

-- ---------- Cadastros ----------
create table public.units (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  code text not null check (length(trim(code)) between 1 and 12),
  name text not null check (length(trim(name)) between 1 and 40),
  allows_decimal boolean not null default true,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index units_store_code_uq on public.units(store_id, lower(code));
create trigger units_updated before update on public.units
  for each row execute function public.tg_set_updated_at();

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 60),
  color text check (color is null or color ~ '^#[0-9A-Fa-f]{6}$'),
  sort_order int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index categories_store_name_uq on public.categories(store_id, lower(name));
create trigger categories_updated before update on public.categories
  for each row execute function public.tg_set_updated_at();

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  name text not null check (length(trim(name)) between 2 and 160),
  contact_name text,
  phone text,
  email text check (email is null or email = '' or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  document text,
  address text,
  notes text,
  active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index suppliers_store_idx on public.suppliers(store_id, active);
create index suppliers_name_trgm on public.suppliers using gin (name gin_trgm_ops);
create trigger suppliers_updated before update on public.suppliers
  for each row execute function public.tg_set_updated_at();

create table public.products (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  sku text not null check (length(trim(sku)) between 1 and 40),
  barcode text check (barcode is null or length(trim(barcode)) between 4 and 32),
  name text not null check (length(trim(name)) between 2 and 160),
  description text,
  category_id uuid references public.categories(id),
  item_type public.item_type not null,
  unit_id uuid not null references public.units(id),
  stock_mode public.stock_mode not null default 'stock',
  min_stock numeric(14,3) not null default 0 check (min_stock >= 0),
  max_stock numeric(14,3) check (max_stock is null or max_stock >= 0),
  cost_price numeric(14,4) not null default 0 check (cost_price >= 0),
  sale_price numeric(14,2) check (sale_price is null or sale_price >= 0),
  default_supplier_id uuid references public.suppliers(id),
  track_lots boolean not null default false,
  track_expiry boolean not null default false,
  active boolean not null default true,
  is_demo boolean not null default false,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint max_ge_min check (max_stock is null or max_stock >= min_stock),
  -- produto por ficha técnica não tem estoque próprio, logo não controla lote
  constraint recipe_no_lots check (stock_mode = 'stock' or (not track_lots and not track_expiry)),
  constraint recipe_only_finished check (stock_mode = 'stock' or item_type = 'finished'),
  unique (id, store_id)
);
create unique index products_store_sku_uq on public.products(store_id, lower(sku));
create unique index products_store_barcode_uq on public.products(store_id, barcode) where barcode is not null;
create index products_store_active_idx on public.products(store_id, active);
create index products_category_idx on public.products(category_id);
create index products_name_trgm on public.products using gin (name gin_trgm_ops);
create trigger products_updated before update on public.products
  for each row execute function public.tg_set_updated_at();

-- ---------- Estoque ----------
-- Cache do saldo. Atualizado SOMENTE por public._apply_movement (security definer).
create table public.stock_balances (
  product_id uuid primary key references public.products(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  quantity numeric(14,3) not null default 0,
  avg_cost numeric(14,4) not null default 0 check (avg_cost >= 0),
  last_movement_at timestamptz,
  updated_at timestamptz not null default now()
);
create index stock_balances_store_idx on public.stock_balances(store_id);

create table public.stock_lots (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  product_id uuid not null references public.products(id),
  lot_code text,
  received_qty numeric(14,3) not null check (received_qty > 0),
  remaining_qty numeric(14,3) not null check (remaining_qty >= 0),
  received_at timestamptz not null default now(),
  expiry_date date,
  supplier_id uuid references public.suppliers(id),
  unit_cost numeric(14,4) not null default 0 check (unit_cost >= 0),
  purchase_id uuid,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  constraint remaining_le_received check (remaining_qty <= received_qty)
);
create index stock_lots_product_idx on public.stock_lots(product_id, expiry_date) where remaining_qty > 0;
create index stock_lots_store_expiry_idx on public.stock_lots(store_id, expiry_date) where remaining_qty > 0;

create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  product_id uuid not null references public.products(id),
  direction public.movement_direction not null,
  reason public.movement_reason not null,
  quantity numeric(14,3) not null check (quantity > 0),
  unit_cost numeric(14,4) not null default 0 check (unit_cost >= 0),
  total_cost numeric(14,2) generated always as (round(quantity * unit_cost, 2)) stored,
  balance_after numeric(14,3) not null,
  lot_id uuid references public.stock_lots(id),
  supplier_id uuid references public.suppliers(id),
  document_ref text,
  notes text,
  occurred_at timestamptz not null default now(),
  purchase_id uuid,
  sale_id uuid,
  sale_item_id uuid,
  inventory_count_id uuid,
  reverses_movement_id uuid references public.stock_movements(id),
  reversed_by_movement_id uuid references public.stock_movements(id),
  negative_override boolean not null default false,
  operation_id uuid not null, -- agrupa movimentos gerados pela mesma operação
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index stock_movements_store_date_idx on public.stock_movements(store_id, occurred_at desc);
create index stock_movements_product_idx on public.stock_movements(product_id, occurred_at desc);
create index stock_movements_sale_idx on public.stock_movements(sale_id) where sale_id is not null;
create index stock_movements_purchase_idx on public.stock_movements(purchase_id) where purchase_id is not null;
create index stock_movements_creator_idx on public.stock_movements(store_id, created_by);
create unique index stock_movements_one_reversal_uq on public.stock_movements(reverses_movement_id) where reverses_movement_id is not null;

-- Alocação das saídas por lote (FEFO)
create table public.stock_movement_lots (
  movement_id uuid not null references public.stock_movements(id) on delete cascade,
  lot_id uuid not null references public.stock_lots(id),
  quantity numeric(14,3) not null check (quantity > 0),
  primary key (movement_id, lot_id)
);
create index stock_movement_lots_lot_idx on public.stock_movement_lots(lot_id);

-- Movimentações confirmadas são imutáveis (exceto marcação de estorno).
create or replace function public.tg_stock_movements_immutable() returns trigger
language plpgsql as $$
begin
  if current_setting('app.allow_demo_cleanup', true) = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'Movimentações confirmadas não podem ser apagadas. Use estorno.' using errcode = 'P0001';
  end if;
  if (new.product_id, new.direction, new.reason, new.quantity, new.unit_cost, new.occurred_at, new.store_id)
     is distinct from (old.product_id, old.direction, old.reason, old.quantity, old.unit_cost, old.occurred_at, old.store_id)
     or (old.reversed_by_movement_id is not null and new.reversed_by_movement_id is distinct from old.reversed_by_movement_id) then
    raise exception 'Movimentações confirmadas não podem ser alteradas. Use estorno.' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger stock_movements_immutable before update or delete on public.stock_movements
  for each row execute function public.tg_stock_movements_immutable();

-- ---------- Numeração de documentos ----------
create table public.store_counters (
  store_id uuid not null references public.stores(id) on delete cascade,
  key text not null,
  value bigint not null default 0,
  primary key (store_id, key)
);

-- ---------- Compras ----------
create table public.purchases (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  number bigint not null,
  supplier_id uuid references public.suppliers(id),
  purchase_date date not null default current_date,
  received_date date,
  document_number text,
  status public.purchase_status not null default 'draft',
  subtotal numeric(14,2) not null default 0 check (subtotal >= 0),
  discount numeric(14,2) not null default 0 check (discount >= 0),
  freight numeric(14,2) not null default 0 check (freight >= 0),
  total numeric(14,2) not null default 0 check (total >= 0),
  notes text,
  created_by uuid references public.profiles(id),
  received_by uuid references public.profiles(id),
  received_at timestamptz,
  cancelled_by uuid references public.profiles(id),
  cancelled_at timestamptz,
  cancel_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, number),
  constraint discount_le_subtotal check (discount <= subtotal)
);
create index purchases_store_date_idx on public.purchases(store_id, purchase_date desc);
create index purchases_supplier_idx on public.purchases(supplier_id);
create trigger purchases_updated before update on public.purchases
  for each row execute function public.tg_set_updated_at();

create table public.purchase_items (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references public.purchases(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  product_id uuid not null references public.products(id),
  quantity numeric(14,3) not null check (quantity > 0),
  unit_cost numeric(14,4) not null check (unit_cost >= 0),
  discount numeric(14,2) not null default 0 check (discount >= 0),
  total numeric(14,2) not null check (total >= 0),
  landed_unit_cost numeric(14,4),   -- custo unitário final (rateio de desconto e frete)
  lot_code text,
  expiry_date date,
  sort_order int not null default 0
);
create index purchase_items_purchase_idx on public.purchase_items(purchase_id);
create index purchase_items_product_idx on public.purchase_items(product_id);

-- ---------- Vendas ----------
create table public.sales (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  number bigint not null,
  sold_at timestamptz not null default now(),
  status public.sale_status not null default 'confirmed',
  subtotal numeric(14,2) not null check (subtotal >= 0),
  discount numeric(14,2) not null default 0 check (discount >= 0),
  total numeric(14,2) not null check (total >= 0),
  cost_total numeric(14,2) not null default 0,
  cost_complete boolean not null default false, -- todos os itens têm custo conhecido?
  payment_method public.payment_method,
  channel text not null default 'balcao', -- preparado p/ PDV/delivery no futuro
  external_ref text,
  notes text,
  created_by uuid references public.profiles(id),
  cancelled_by uuid references public.profiles(id),
  cancelled_at timestamptz,
  cancel_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, number),
  constraint sale_discount_le_subtotal check (discount <= subtotal)
);
create index sales_store_date_idx on public.sales(store_id, sold_at desc);
create unique index sales_external_ref_uq on public.sales(store_id, channel, external_ref) where external_ref is not null;
create trigger sales_updated before update on public.sales
  for each row execute function public.tg_set_updated_at();

create table public.sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  product_id uuid not null references public.products(id),
  quantity numeric(14,3) not null check (quantity > 0),
  unit_price numeric(14,2) not null check (unit_price >= 0),
  discount numeric(14,2) not null default 0 check (discount >= 0),
  total numeric(14,2) not null check (total >= 0),
  cost_total numeric(14,2) not null default 0,
  cost_known boolean not null default false,
  sort_order int not null default 0
);
create index sale_items_sale_idx on public.sale_items(sale_id);
create index sale_items_product_idx on public.sale_items(product_id);

-- ---------- Fichas técnicas ----------
create table public.recipes (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  product_id uuid not null unique references public.products(id) on delete cascade,
  yield_qty numeric(14,3) not null default 1 check (yield_qty > 0),
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger recipes_updated before update on public.recipes
  for each row execute function public.tg_set_updated_at();

create table public.recipe_items (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  ingredient_id uuid not null references public.products(id),
  quantity numeric(14,3) not null check (quantity > 0),
  loss_pct numeric(5,2) not null default 0 check (loss_pct >= 0 and loss_pct < 100),
  sort_order int not null default 0,
  unique (recipe_id, ingredient_id)
);

-- ---------- Inventário ----------
create table public.inventory_counts (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  number bigint not null,
  status public.inventory_status not null default 'open',
  notes text,
  created_by uuid references public.profiles(id),
  confirmed_by uuid references public.profiles(id),
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, number)
);
create trigger inventory_counts_updated before update on public.inventory_counts
  for each row execute function public.tg_set_updated_at();

create table public.inventory_count_items (
  id uuid primary key default gen_random_uuid(),
  inventory_count_id uuid not null references public.inventory_counts(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  product_id uuid not null references public.products(id),
  theoretical_qty numeric(14,3),  -- registrado no momento da confirmação
  counted_qty numeric(14,3) not null check (counted_qty >= 0),
  difference numeric(14,3),
  reason text,
  movement_id uuid references public.stock_movements(id),
  unique (inventory_count_id, product_id)
);

-- ---------- Auditoria e idempotência ----------
create table public.audit_logs (
  id bigint generated always as identity primary key,
  store_id uuid references public.stores(id) on delete cascade,
  user_id uuid,
  action text not null,
  entity text not null,
  entity_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_store_date_idx on public.audit_logs(store_id, created_at desc);

create table public.operation_requests (
  store_id uuid not null references public.stores(id) on delete cascade,
  request_id uuid not null,
  operation text not null,
  result jsonb not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  primary key (store_id, request_id)
);

-- ===================== supabase/migrations/20261013000002_security.sql =====================
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

-- ===================== supabase/migrations/20261013000003_stock_functions.sql =====================
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

-- ===================== supabase/migrations/20261013000004_reports.sql =====================
-- =====================================================================
-- Açaí Everest — Migration 004: views, dashboard e relatórios
-- Definições financeiras (usadas em todo o sistema):
--   Receita bruta  = Σ total das vendas confirmadas (após descontos).
--   CMV            = Σ custo das saídas por venda (custo médio no momento).
--   Margem bruta   = Receita bruta − CMV. Só é exibida quando TODOS os itens
--                    vendidos no período têm custo conhecido (> 0).
--   Lucro líquido  = NÃO calculado: exigiria despesas, impostos e taxas.
-- =====================================================================

-- Posição de estoque (security_invoker => respeita RLS do usuário)
create or replace view public.v_stock_position with (security_invoker = true) as
select
  p.id, p.store_id, p.sku, p.barcode, p.name, p.description, p.item_type, p.stock_mode,
  p.category_id, c.name as category_name, c.color as category_color,
  p.unit_id, u.code as unit_code, u.allows_decimal,
  p.min_stock, p.max_stock, p.cost_price, p.sale_price, p.default_supplier_id,
  s.name as supplier_name, p.track_lots, p.track_expiry, p.active, p.is_demo,
  p.created_at, p.updated_at,
  coalesce(b.quantity, 0) as quantity,
  case when coalesce(b.avg_cost, 0) > 0 then b.avg_cost else p.cost_price end as unit_cost,
  round(greatest(coalesce(b.quantity, 0), 0) * case when coalesce(b.avg_cost, 0) > 0 then b.avg_cost else p.cost_price end, 2) as stock_value,
  b.last_movement_at,
  case
    when p.stock_mode = 'recipe' then 'recipe'
    when coalesce(b.quantity, 0) <= 0 then 'out'
    when p.min_stock > 0 and b.quantity < p.min_stock then 'low'
    when p.max_stock is not null and b.quantity > p.max_stock then 'over'
    else 'ok'
  end as stock_status,
  (select min(l.expiry_date) from public.stock_lots l where l.product_id = p.id and l.remaining_qty > 0) as next_expiry
from public.products p
join public.units u on u.id = p.unit_id
left join public.categories c on c.id = p.category_id
left join public.suppliers s on s.id = p.default_supplier_id
left join public.stock_balances b on b.product_id = p.id;

create or replace view public.v_lots with (security_invoker = true) as
select l.*, p.name as product_name, p.sku, u.code as unit_code, sp.name as supplier_name,
       (l.expiry_date - (now() at time zone st.timezone)::date) as days_to_expiry
  from public.stock_lots l
  join public.products p on p.id = l.product_id
  join public.units u on u.id = p.unit_id
  join public.stores st on st.id = l.store_id
  left join public.suppliers sp on sp.id = l.supplier_id;

create or replace view public.v_movements with (security_invoker = true) as
select m.*, p.name as product_name, p.sku, u.code as unit_code, p.category_id,
       pr.full_name as created_by_name, sp.name as supplier_name, l.lot_code, l.expiry_date as lot_expiry
  from public.stock_movements m
  join public.products p on p.id = m.product_id
  join public.units u on u.id = p.unit_id
  left join public.profiles pr on pr.id = m.created_by
  left join public.suppliers sp on sp.id = m.supplier_id
  left join public.stock_lots l on l.id = m.lot_id;

grant select on public.v_stock_position, public.v_lots, public.v_movements to authenticated;

-- ---------- Dashboard ----------
create or replace function public.get_dashboard(p_store uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_tz text; v_today date; v_from timestamptz; v_to timestamptz; v_max_days int; v_res jsonb;
  v_base numeric;
begin
  perform public._require_role(p_store);
  if p_from is null or p_to is null or p_from > p_to then raise exception 'Período inválido.' using errcode = '22023'; end if;
  if p_to - p_from > 731 then raise exception 'O período máximo é de 2 anos.' using errcode = '22023'; end if;
  select timezone, (select max(d) from unnest(expiry_alert_days) d) into v_tz, v_max_days from public.stores where id = p_store;
  v_today := (now() at time zone v_tz)::date;
  v_from := p_from::timestamp at time zone v_tz;
  v_to := (p_to + 1)::timestamp at time zone v_tz;

  select coalesce(sum(case when direction = 'in' then total_cost else -total_cost end), 0) into v_base
    from public.stock_movements where store_id = p_store and created_at < v_from;

  with pos as (
    select * from public.v_stock_position where store_id = p_store and active and stock_mode = 'stock'
  ), sales_p as (
    select * from public.sales where store_id = p_store and status = 'confirmed' and sold_at >= v_from and sold_at < v_to
  ), days as (
    select d::date as day from generate_series(p_from, p_to, interval '1 day') d
  )
  select jsonb_build_object(
    'period', jsonb_build_object('from', p_from, 'to', p_to, 'today', v_today),
    'kpis', jsonb_build_object(
      'active_skus', (select count(*) from public.products where store_id = p_store and active),
      'stock_skus', (select count(*) from pos),
      'qty_by_unit', coalesce((select jsonb_agg(jsonb_build_object('unit', unit_code, 'quantity', q, 'skus', n) order by unit_code)
                                 from (select unit_code, sum(greatest(quantity, 0)) q, count(*) n from pos group by unit_code) x), '[]'::jsonb),
      'stock_value', coalesce((select sum(stock_value) from pos), 0),
      'below_min', (select count(*) from pos where stock_status = 'low'),
      'out_of_stock', (select count(*) from pos where stock_status = 'out'),
      'expiring_lots', (select count(*) from public.stock_lots l join public.products p on p.id = l.product_id
                          where l.store_id = p_store and p.active and l.remaining_qty > 0
                            and l.expiry_date between v_today and v_today + v_max_days),
      'expired_lots', (select count(*) from public.stock_lots l join public.products p on p.id = l.product_id
                         where l.store_id = p_store and p.active and l.remaining_qty > 0 and l.expiry_date < v_today),
      'purchases_count', (select count(*) from public.purchases where store_id = p_store and status = 'received'
                            and received_date between p_from and p_to),
      'purchases_total', (select coalesce(sum(total), 0) from public.purchases where store_id = p_store and status = 'received'
                            and received_date between p_from and p_to),
      'sales_count', (select count(*) from sales_p),
      'revenue', (select coalesce(sum(total), 0) from sales_p),
      'cogs', (select coalesce(sum(cost_total), 0) from sales_p),
      'cost_complete', (select coalesce(bool_and(cost_complete), true) from sales_p),
      'sales_missing_cost', (select count(*) from sales_p where not cost_complete),
      'avg_ticket', (select case when count(*) > 0 then round(sum(total) / count(*), 2) else 0 end from sales_p)
    ),
    'daily', coalesce((select jsonb_agg(jsonb_build_object(
        'day', z.day, 'in_value', z.in_value, 'out_value', z.out_value, 'in_count', z.in_count, 'out_count', z.out_count,
        'revenue', z.revenue, 'sales', z.sales, 'stock_value', round(v_base + z.cum, 2)) order by z.day)
      from (
        select d.day,
               coalesce(mv.in_value, 0) in_value, coalesce(mv.out_value, 0) out_value,
               coalesce(mv.in_count, 0) in_count, coalesce(mv.out_count, 0) out_count,
               coalesce(sl.revenue, 0) revenue, coalesce(sl.cnt, 0) sales,
               sum(coalesce(mv.net_value, 0)) over (order by d.day) cum
          from days d
          left join (select (created_at at time zone v_tz)::date as day,
                            sum(total_cost) filter (where direction = 'in') as in_value,
                            sum(total_cost) filter (where direction = 'out') as out_value,
                            count(*) filter (where direction = 'in') as in_count,
                            count(*) filter (where direction = 'out') as out_count,
                            sum(case when direction = 'in' then total_cost else -total_cost end) as net_value
                       from public.stock_movements where store_id = p_store and created_at >= v_from and created_at < v_to
                      group by 1) mv on mv.day = d.day
          left join (select (sold_at at time zone v_tz)::date as day, sum(total) revenue, count(*) cnt from sales_p group by 1) sl on sl.day = d.day
      ) z), '[]'::jsonb),
    'top_products', coalesce((select jsonb_agg(x order by x->>'revenue' desc) from (
        select jsonb_build_object('product_id', p.id, 'name', p.name, 'unit', u.code,
                                  'quantity', sum(si.quantity), 'revenue', sum(si.total)) x
          from public.sale_items si join sales_p s on s.id = si.sale_id
          join public.products p on p.id = si.product_id join public.units u on u.id = p.unit_id
         group by p.id, p.name, u.code order by sum(si.total) desc limit 8) t), '[]'::jsonb),
    'by_category', coalesce((select jsonb_agg(jsonb_build_object('category', coalesce(category_name, 'Sem categoria'),
                                  'color', category_color, 'value', v, 'skus', n) order by v desc)
        from (select category_name, category_color, sum(stock_value) v, count(*) n from pos group by 1, 2) c), '[]'::jsonb),
    'critical', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'unit', unit_code,
                                  'quantity', quantity, 'min_stock', min_stock, 'status', stock_status) order by stock_status, name)
        from (select * from pos where stock_status in ('low', 'out') order by stock_status, quantity limit 10) c), '[]'::jsonb),
    'expiring', coalesce((select jsonb_agg(jsonb_build_object('lot_id', l.id, 'product_id', l.product_id, 'name', p.name,
                                  'lot_code', l.lot_code, 'remaining', l.remaining_qty, 'unit', u.code,
                                  'expiry_date', l.expiry_date, 'days', l.expiry_date - v_today) order by l.expiry_date)
        from (select * from public.stock_lots where store_id = p_store and remaining_qty > 0
                and expiry_date <= v_today + v_max_days order by expiry_date limit 10) l
        join public.products p on p.id = l.product_id and p.active join public.units u on u.id = p.unit_id), '[]'::jsonb),
    'recent', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'product', m.product_name, 'direction', m.direction,
                                  'reason', m.reason, 'quantity', m.quantity, 'unit', m.unit_code,
                                  'occurred_at', m.occurred_at, 'user', m.created_by_name) order by m.created_at desc)
        from (select * from public.v_movements where store_id = p_store order by created_at desc limit 8) m), '[]'::jsonb)
  ) into v_res;
  return v_res;
end $$;

-- ---------- Relatórios ----------
create or replace function public.report_sales_by_day(p_store uuid, p_from date, p_to date)
returns table(day date, sales bigint, revenue numeric, discounts numeric, cogs numeric, cost_complete boolean)
language plpgsql stable security definer set search_path = public as $$
declare v_tz text;
begin
  perform public._require_role(p_store);
  select timezone into v_tz from public.stores where id = p_store;
  return query
  select (s.sold_at at time zone v_tz)::date, count(*), sum(s.total), sum(s.discount), sum(s.cost_total), bool_and(s.cost_complete)
    from public.sales s
   where s.store_id = p_store and s.status = 'confirmed'
     and s.sold_at >= (p_from::timestamp at time zone v_tz) and s.sold_at < ((p_to + 1)::timestamp at time zone v_tz)
   group by 1 order by 1;
end $$;

create or replace function public.report_product_sales(p_store uuid, p_from date, p_to date, p_category uuid default null)
returns table(product_id uuid, name text, sku text, category text, unit text, quantity numeric, revenue numeric,
              cogs numeric, cost_complete boolean, gross_margin numeric, margin_pct numeric)
language plpgsql stable security definer set search_path = public as $$
declare v_tz text;
begin
  perform public._require_role(p_store);
  select timezone into v_tz from public.stores where id = p_store;
  return query
  select p.id, p.name, p.sku, c.name, u.code, sum(si.quantity), sum(si.total), sum(si.cost_total), bool_and(si.cost_known),
         case when bool_and(si.cost_known) then sum(si.total) - sum(si.cost_total) end,
         case when bool_and(si.cost_known) and sum(si.total) > 0 then round((sum(si.total) - sum(si.cost_total)) / sum(si.total) * 100, 1) end
    from public.sale_items si
    join public.sales s on s.id = si.sale_id
    join public.products p on p.id = si.product_id
    join public.units u on u.id = p.unit_id
    left join public.categories c on c.id = p.category_id
   where s.store_id = p_store and s.status = 'confirmed'
     and s.sold_at >= (p_from::timestamp at time zone v_tz) and s.sold_at < ((p_to + 1)::timestamp at time zone v_tz)
     and (p_category is null or p.category_id = p_category)
   group by p.id, p.name, p.sku, c.name, u.code
   order by sum(si.total) desc;
end $$;

create or replace function public.report_purchases_by_supplier(p_store uuid, p_from date, p_to date)
returns table(supplier_id uuid, supplier text, purchases bigint, subtotal numeric, discounts numeric, freight numeric, total numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require_role(p_store);
  return query
  select pu.supplier_id, coalesce(s.name, 'Sem fornecedor'), count(*), sum(pu.subtotal), sum(pu.discount), sum(pu.freight), sum(pu.total)
    from public.purchases pu left join public.suppliers s on s.id = pu.supplier_id
   where pu.store_id = p_store and pu.status = 'received' and pu.received_date between p_from and p_to
   group by 1, 2 order by sum(pu.total) desc;
end $$;

grant execute on function public.get_dashboard(uuid, date, date), public.report_sales_by_day(uuid, date, date),
  public.report_product_sales(uuid, date, date, uuid), public.report_purchases_by_supplier(uuid, date, date) to authenticated;

-- Garantia final: o papel anônimo não acessa nada (o Supabase concede privilégios padrão a anon).
revoke all on all tables in schema public from anon;
revoke all on all functions in schema public from anon, public;
grant execute on function public.get_dashboard(uuid, date, date), public.report_sales_by_day(uuid, date, date),
  public.report_product_sales(uuid, date, date, uuid), public.report_purchases_by_supplier(uuid, date, date) to authenticated;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on functions from anon, public;

-- ===================== supabase/migrations/20261013000005_storage.sql =====================
-- =====================================================================
-- Açaí Everest — Migration 005: armazenamento do logo da loja
-- Bucket público para leitura (o logo aparece na tela de login);
-- upload/remoção apenas por administradores, na pasta {store_id}/.
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('store-assets', 'store-assets', true, 2097152, array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'])
on conflict (id) do nothing;

create policy store_assets_admin_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'store-assets' and public.is_store_admin(((storage.foldername(name))[1])::uuid));
create policy store_assets_admin_update on storage.objects for update to authenticated
  using (bucket_id = 'store-assets' and public.is_store_admin(((storage.foldername(name))[1])::uuid));
create policy store_assets_admin_delete on storage.objects for delete to authenticated
  using (bucket_id = 'store-assets' and public.is_store_admin(((storage.foldername(name))[1])::uuid));

