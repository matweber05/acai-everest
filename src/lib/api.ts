// Camada de acesso a dados. Toda leitura passa pelo RLS do Supabase;
// toda operação de estoque passa por funções RPC transacionais no banco.
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';
import type {
  AuditLog, Category, Dashboard, Direction, InventoryCount, InventoryCountItem, Lot, Movement, MovementReason,
  Purchase, PurchaseItem, PurchaseStatus, Recipe, RecipeItem, Sale, SaleItem, SaleStatus, StockPosition, Supplier, Unit,
} from '@/types/db';

async function unwrap<T>(p: PromiseLike<{ data: unknown; error: unknown }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw error;
  return data as T;
}

// ---------- cadastros ----------
export const useUnits = (storeId: string) =>
  useQuery({
    queryKey: ['units', storeId],
    queryFn: () => unwrap<Unit[]>(supabase.from('units').select('*').eq('store_id', storeId).order('code')),
    staleTime: 5 * 60_000,
  });

export const useCategories = (storeId: string) =>
  useQuery({
    queryKey: ['categories', storeId],
    queryFn: () => unwrap<Category[]>(supabase.from('categories').select('*').eq('store_id', storeId).order('sort_order').order('name')),
    staleTime: 5 * 60_000,
  });

export const useSuppliers = (storeId: string) =>
  useQuery({
    queryKey: ['suppliers', storeId],
    queryFn: () => unwrap<Supplier[]>(supabase.from('suppliers').select('*').eq('store_id', storeId).order('name')),
  });

/** Lista completa de itens com saldo (uma loja tem dezenas/centenas de itens). */
export const useStockPosition = (storeId: string) =>
  useQuery({
    queryKey: ['stock', storeId],
    queryFn: () => unwrap<StockPosition[]>(supabase.from('v_stock_position').select('*').eq('store_id', storeId).order('name')),
  });

export const useProduct = (storeId: string, id?: string) =>
  useQuery({
    queryKey: ['stock', storeId, 'product', id],
    enabled: !!id,
    queryFn: () => unwrap<StockPosition>(supabase.from('v_stock_position').select('*').eq('id', id!).single()),
  });

export const useLots = (storeId: string, opts: { productId?: string; onlyOpen?: boolean } = {}) =>
  useQuery({
    queryKey: ['lots', storeId, opts],
    queryFn: () => {
      let q = supabase.from('v_lots').select('*').eq('store_id', storeId);
      if (opts.productId) q = q.eq('product_id', opts.productId);
      if (opts.onlyOpen !== false) q = q.gt('remaining_qty', 0);
      return unwrap<Lot[]>(q.order('expiry_date', { ascending: true, nullsFirst: false }).order('received_at'));
    },
  });

export const useRecipe = (storeId: string, productId?: string) =>
  useQuery({
    queryKey: ['recipe', storeId, productId],
    enabled: !!productId,
    queryFn: async () => {
      const recipe = await unwrap<Recipe | null>(supabase.from('recipes').select('*').eq('product_id', productId!).maybeSingle());
      const items = recipe
        ? await unwrap<RecipeItem[]>(supabase.from('recipe_items').select('*').eq('recipe_id', recipe.id).order('sort_order'))
        : [];
      return { recipe, items };
    },
  });

// ---------- movimentações ----------
export interface MovementFilters {
  productId?: string; direction?: Direction | ''; reason?: MovementReason | ''; userId?: string;
  from?: string; to?: string; categoryId?: string;
}
const PAGE = 25;

function applyMovementFilters<Q extends { eq: (c: string, v: unknown) => Q; gte: (c: string, v: unknown) => Q; lt: (c: string, v: unknown) => Q }>(q: Q, f: MovementFilters): Q {
  if (f.productId) q = q.eq('product_id', f.productId);
  if (f.direction) q = q.eq('direction', f.direction);
  if (f.reason) q = q.eq('reason', f.reason);
  if (f.userId) q = q.eq('created_by', f.userId);
  if (f.categoryId) q = q.eq('category_id', f.categoryId);
  if (f.from) q = q.gte('occurred_at', `${f.from}T00:00:00-03:00`);
  if (f.to) q = q.lt('occurred_at', new Date(new Date(`${f.to}T00:00:00-03:00`).getTime() + 86_400_000).toISOString());
  return q;
}

export const useMovements = (storeId: string, f: MovementFilters, page: number) =>
  useQuery({
    queryKey: ['movements', storeId, f, page],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const q = applyMovementFilters(supabase.from('v_movements').select('*', { count: 'exact' }).eq('store_id', storeId), f)
        .order('occurred_at', { ascending: false }).order('created_at', { ascending: false })
        .range((page - 1) * PAGE, page * PAGE - 1);
      const { data, error, count } = await q;
      if (error) throw error;
      return { rows: (data ?? []) as Movement[], total: count ?? 0, pages: Math.max(1, Math.ceil((count ?? 0) / PAGE)) };
    },
  });

/** Busca todas as movimentações filtradas (para CSV/relatório). Limite de segurança: 10 mil. */
export async function fetchAllMovements(storeId: string, f: MovementFilters) {
  const rows: Movement[] = [];
  for (let from = 0; from < 10_000; from += 1000) {
    const { data, error } = await applyMovementFilters(supabase.from('v_movements').select('*').eq('store_id', storeId), f)
      .order('occurred_at', { ascending: false }).range(from, from + 999);
    if (error) throw error;
    rows.push(...((data ?? []) as Movement[]));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

// ---------- vendas ----------
export const useSales = (storeId: string, f: { from?: string; to?: string; status?: SaleStatus | '' }, page: number) =>
  useQuery({
    queryKey: ['sales', storeId, f, page],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      let q = supabase.from('sales').select('*, profiles:created_by(full_name)', { count: 'exact' }).eq('store_id', storeId);
      if (f.status) q = q.eq('status', f.status);
      if (f.from) q = q.gte('sold_at', `${f.from}T00:00:00-03:00`);
      if (f.to) q = q.lt('sold_at', new Date(new Date(`${f.to}T00:00:00-03:00`).getTime() + 86_400_000).toISOString());
      const { data, error, count } = await q.order('sold_at', { ascending: false }).range((page - 1) * PAGE, page * PAGE - 1);
      if (error) throw error;
      return { rows: (data ?? []) as Sale[], total: count ?? 0, pages: Math.max(1, Math.ceil((count ?? 0) / PAGE)) };
    },
  });

export const useSale = (id?: string) =>
  useQuery({
    queryKey: ['sale', id],
    enabled: !!id,
    queryFn: async () => {
      const sale = await unwrap<Sale>(supabase.from('sales').select('*, profiles:created_by(full_name)').eq('id', id!).single());
      const items = await unwrap<SaleItem[]>(supabase.from('sale_items').select('*, products(name, units(code))').eq('sale_id', id!).order('sort_order'));
      return { sale, items };
    },
  });

// ---------- compras ----------
export const usePurchases = (storeId: string, f: { status?: PurchaseStatus | ''; supplierId?: string; from?: string; to?: string }, page: number) =>
  useQuery({
    queryKey: ['purchases', storeId, f, page],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      let q = supabase.from('purchases').select('*, suppliers(name)', { count: 'exact' }).eq('store_id', storeId);
      if (f.status) q = q.eq('status', f.status);
      if (f.supplierId) q = q.eq('supplier_id', f.supplierId);
      if (f.from) q = q.gte('purchase_date', f.from);
      if (f.to) q = q.lte('purchase_date', f.to);
      const { data, error, count } = await q.order('purchase_date', { ascending: false }).order('number', { ascending: false })
        .range((page - 1) * PAGE, page * PAGE - 1);
      if (error) throw error;
      return { rows: (data ?? []) as Purchase[], total: count ?? 0, pages: Math.max(1, Math.ceil((count ?? 0) / PAGE)) };
    },
  });

export const usePurchase = (id?: string) =>
  useQuery({
    queryKey: ['purchase', id],
    enabled: !!id,
    queryFn: async () => {
      const purchase = await unwrap<Purchase>(supabase.from('purchases').select('*, suppliers(name)').eq('id', id!).single());
      const items = await unwrap<PurchaseItem[]>(
        supabase.from('purchase_items').select('*, products(name, sku, track_expiry, units(code))').eq('purchase_id', id!).order('sort_order'));
      return { purchase, items };
    },
  });

// ---------- inventário ----------
export const useInventoryCounts = (storeId: string) =>
  useQuery({
    queryKey: ['inventory', storeId],
    queryFn: () => unwrap<(InventoryCount & { inventory_count_items: { count: number }[] })[]>(
      supabase.from('inventory_counts').select('*, inventory_count_items(count)').eq('store_id', storeId).order('created_at', { ascending: false }).limit(100)),
  });

export const useInventoryCount = (id?: string) =>
  useQuery({
    queryKey: ['inventory-count', id],
    enabled: !!id,
    queryFn: async () => {
      const count = await unwrap<InventoryCount>(supabase.from('inventory_counts').select('*').eq('id', id!).single());
      const items = await unwrap<InventoryCountItem[]>(supabase.from('inventory_count_items').select('*').eq('inventory_count_id', id!));
      return { count, items };
    },
  });

// ---------- dashboard / relatórios ----------
export const useDashboard = (storeId: string, from: string, to: string) =>
  useQuery({
    queryKey: ['dashboard', storeId, from, to],
    placeholderData: keepPreviousData,
    queryFn: () => unwrap<Dashboard>(supabase.rpc('get_dashboard', { p_store: storeId, p_from: from, p_to: to })),
  });

// ---------- usuários ----------
export const useMembers = (storeId: string) =>
  useQuery({
    queryKey: ['members', storeId],
    queryFn: () => unwrap<{ user_id: string; role: 'admin' | 'operator'; active: boolean; created_at: string; profiles: { full_name: string | null; email: string | null } }[]>(
      supabase.from('store_members').select('user_id, role, active, created_at, profiles(full_name, email)').eq('store_id', storeId).order('created_at')),
  });

export const useInvites = (storeId: string, enabled: boolean) =>
  useQuery({
    queryKey: ['invites', storeId],
    enabled,
    queryFn: () => unwrap<{ id: string; email: string; role: 'admin' | 'operator'; created_at: string }[]>(
      supabase.from('store_invites').select('id, email, role, created_at').eq('store_id', storeId).is('accepted_at', null).order('created_at')),
  });

export const useAuditLogs = (storeId: string, enabled: boolean) =>
  useQuery({
    queryKey: ['audit', storeId],
    enabled,
    queryFn: () => unwrap<AuditLog[]>(supabase.from('audit_logs').select('*').eq('store_id', storeId).order('created_at', { ascending: false }).limit(200)),
  });

// ---------- escrita ----------
/** Chama uma função RPC do banco e atualiza todas as telas em caso de sucesso. */
export function useRpc<TArgs extends Record<string, unknown>, TResult = unknown>(fn: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: TArgs) => unwrap<TResult>(supabase.rpc(fn, args)),
    onSuccess: () => qc.invalidateQueries(),
  });
}

/** Mutação genérica (insert/update em cadastros), com invalidação global. */
export function useWrite<TArgs, TResult = unknown>(fn: (args: TArgs) => PromiseLike<{ data: unknown; error: unknown }>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: TArgs) => unwrap<TResult>(fn(args)),
    onSuccess: () => qc.invalidateQueries(),
  });
}
