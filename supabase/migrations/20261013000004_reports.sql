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
