// Tipos que espelham o esquema do banco (supabase/migrations).
export type MemberRole = 'admin' | 'operator';
export type ItemType = 'resale' | 'ingredient' | 'packaging' | 'consumable' | 'finished';
export type StockMode = 'stock' | 'recipe';
export type Direction = 'in' | 'out';
export type MovementReason =
  | 'purchase' | 'manual_entry' | 'initial_stock' | 'return_in'
  | 'sale' | 'internal_use' | 'loss' | 'expired' | 'damage' | 'return_out'
  | 'inventory_adjustment' | 'reversal' | 'sale_cancel' | 'purchase_cancel';
export type PurchaseStatus = 'draft' | 'received' | 'cancelled';
export type SaleStatus = 'confirmed' | 'cancelled';
export type PaymentMethod = 'cash' | 'pix' | 'debit' | 'credit' | 'other';
export type InventoryStatus = 'open' | 'confirmed' | 'cancelled';
export type StockStatus = 'ok' | 'low' | 'out' | 'over' | 'recipe';

export interface Store {
  id: string;
  name: string;
  legal_name: string | null;
  phone: string | null;
  address: string | null;
  logo_path: string | null;
  timezone: string;
  allow_negative_stock: boolean;
  expiry_alert_days: number[];
  low_stock_alerts: boolean;
  display_prefs: { page_size?: number };
  created_at: string;
  updated_at: string;
}

export interface Profile { id: string; full_name: string | null; email: string | null }

export interface Membership {
  store_id: string;
  user_id: string;
  role: MemberRole;
  active: boolean;
  stores?: Store;
  profiles?: Profile;
}

export interface Unit { id: string; store_id: string; code: string; name: string; allows_decimal: boolean; active: boolean }
export interface Category { id: string; store_id: string; name: string; color: string | null; sort_order: number; active: boolean }

export interface Supplier {
  id: string;
  store_id: string;
  name: string;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  document: string | null;
  address: string | null;
  notes: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Product {
  id: string;
  store_id: string;
  sku: string;
  barcode: string | null;
  name: string;
  description: string | null;
  category_id: string | null;
  item_type: ItemType;
  unit_id: string;
  stock_mode: StockMode;
  min_stock: number;
  max_stock: number | null;
  cost_price: number;
  sale_price: number | null;
  default_supplier_id: string | null;
  track_lots: boolean;
  track_expiry: boolean;
  active: boolean;
  is_demo: boolean;
  created_at: string;
  updated_at: string;
}

/** Linha da view v_stock_position */
export interface StockPosition extends Product {
  category_name: string | null;
  category_color: string | null;
  unit_code: string;
  allows_decimal: boolean;
  supplier_name: string | null;
  quantity: number;
  unit_cost: number;
  stock_value: number;
  last_movement_at: string | null;
  stock_status: StockStatus;
  next_expiry: string | null;
}

export interface Lot {
  id: string;
  store_id: string;
  product_id: string;
  lot_code: string | null;
  received_qty: number;
  remaining_qty: number;
  received_at: string;
  expiry_date: string | null;
  supplier_id: string | null;
  unit_cost: number;
  product_name: string;
  sku: string;
  unit_code: string;
  supplier_name: string | null;
  days_to_expiry: number | null;
}

export interface Movement {
  id: string;
  store_id: string;
  product_id: string;
  direction: Direction;
  reason: MovementReason;
  quantity: number;
  unit_cost: number;
  total_cost: number;
  balance_after: number;
  lot_id: string | null;
  supplier_id: string | null;
  document_ref: string | null;
  notes: string | null;
  occurred_at: string;
  purchase_id: string | null;
  sale_id: string | null;
  inventory_count_id: string | null;
  reverses_movement_id: string | null;
  reversed_by_movement_id: string | null;
  negative_override: boolean;
  created_by: string | null;
  created_at: string;
  product_name: string;
  sku: string;
  unit_code: string;
  created_by_name: string | null;
  supplier_name: string | null;
  lot_code: string | null;
  lot_expiry: string | null;
}

export interface Purchase {
  id: string;
  store_id: string;
  number: number;
  supplier_id: string | null;
  purchase_date: string;
  received_date: string | null;
  document_number: string | null;
  status: PurchaseStatus;
  subtotal: number;
  discount: number;
  freight: number;
  total: number;
  notes: string | null;
  created_at: string;
  received_at: string | null;
  cancel_reason: string | null;
  suppliers?: { name: string } | null;
}

export interface PurchaseItem {
  id: string;
  purchase_id: string;
  product_id: string;
  quantity: number;
  unit_cost: number;
  discount: number;
  total: number;
  landed_unit_cost: number | null;
  lot_code: string | null;
  expiry_date: string | null;
  products?: { name: string; sku: string; track_expiry: boolean; units: { code: string } };
}

export interface Sale {
  id: string;
  store_id: string;
  number: number;
  sold_at: string;
  status: SaleStatus;
  subtotal: number;
  discount: number;
  total: number;
  cost_total: number;
  cost_complete: boolean;
  payment_method: PaymentMethod | null;
  notes: string | null;
  created_by: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  profiles?: { full_name: string | null } | null;
}

export interface SaleItem {
  id: string;
  sale_id: string;
  product_id: string;
  quantity: number;
  unit_price: number;
  discount: number;
  total: number;
  cost_total: number;
  cost_known: boolean;
  products?: { name: string; units: { code: string } };
}

export interface Recipe { id: string; store_id: string; product_id: string; yield_qty: number; notes: string | null; active: boolean }
export interface RecipeItem { id: string; recipe_id: string; ingredient_id: string; quantity: number; loss_pct: number; sort_order: number }

export interface InventoryCount {
  id: string;
  store_id: string;
  number: number;
  status: InventoryStatus;
  notes: string | null;
  created_at: string;
  confirmed_at: string | null;
}
export interface InventoryCountItem {
  id: string;
  product_id: string;
  theoretical_qty: number | null;
  counted_qty: number;
  difference: number | null;
  reason: string | null;
}

export interface AuditLog {
  id: number;
  user_id: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  details: Record<string, unknown>;
  created_at: string;
}

export interface Dashboard {
  period: { from: string; to: string; today: string };
  kpis: {
    active_skus: number;
    stock_skus: number;
    qty_by_unit: { unit: string; quantity: number; skus: number }[];
    stock_value: number;
    below_min: number;
    out_of_stock: number;
    expiring_lots: number;
    expired_lots: number;
    purchases_count: number;
    purchases_total: number;
    sales_count: number;
    revenue: number;
    cogs: number;
    cost_complete: boolean;
    sales_missing_cost: number;
    avg_ticket: number;
  };
  daily: {
    day: string; in_value: number; out_value: number; in_count: number; out_count: number;
    revenue: number; sales: number; stock_value: number;
  }[];
  top_products: { product_id: string; name: string; unit: string; quantity: number; revenue: number }[];
  by_category: { category: string; color: string | null; value: number; skus: number }[];
  critical: { id: string; name: string; unit: string; quantity: number; min_stock: number; status: StockStatus }[];
  expiring: { lot_id: string; product_id: string; name: string; lot_code: string | null; remaining: number; unit: string; expiry_date: string; days: number }[];
  recent: { id: string; product: string; direction: Direction; reason: MovementReason; quantity: number; unit: string; occurred_at: string; user: string | null }[];
}
