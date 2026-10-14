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
