import type { Direction, ItemType, MemberRole, MovementReason, PaymentMethod, PurchaseStatus, SaleStatus, StockMode, StockStatus } from '@/types/db';

export const ITEM_TYPE_LABEL: Record<ItemType, string> = {
  resale: 'Produto para revenda',
  ingredient: 'Ingrediente / matéria-prima',
  packaging: 'Embalagem',
  consumable: 'Material de consumo',
  finished: 'Produto acabado',
};

export const STOCK_MODE_LABEL: Record<StockMode, string> = {
  stock: 'Estoque próprio',
  recipe: 'Baixa pela ficha técnica',
};

export const REASON_LABEL: Record<MovementReason, string> = {
  purchase: 'Compra',
  manual_entry: 'Entrada manual',
  initial_stock: 'Estoque inicial',
  return_in: 'Devolução de cliente',
  sale: 'Venda',
  internal_use: 'Consumo interno',
  loss: 'Perda',
  expired: 'Produto vencido',
  damage: 'Avaria',
  return_out: 'Devolução ao fornecedor',
  inventory_adjustment: 'Ajuste de inventário',
  reversal: 'Estorno',
  sale_cancel: 'Cancelamento de venda',
  purchase_cancel: 'Cancelamento de compra',
};

export const ENTRY_REASONS: MovementReason[] = ['manual_entry', 'initial_stock', 'return_in'];
export const EXIT_REASONS: MovementReason[] = ['sale', 'internal_use', 'loss', 'expired', 'damage', 'return_out', 'inventory_adjustment'];

export const DIRECTION_LABEL: Record<Direction, string> = { in: 'Entrada', out: 'Saída' };

export const PAYMENT_LABEL: Record<PaymentMethod, string> = {
  cash: 'Dinheiro', pix: 'Pix', debit: 'Cartão de débito', credit: 'Cartão de crédito', other: 'Outros',
};

export const PURCHASE_STATUS_LABEL: Record<PurchaseStatus, string> = { draft: 'Rascunho', received: 'Recebida', cancelled: 'Cancelada' };
export const SALE_STATUS_LABEL: Record<SaleStatus, string> = { confirmed: 'Confirmada', cancelled: 'Cancelada' };
export const ROLE_LABEL: Record<MemberRole, string> = { admin: 'Administrador(a)', operator: 'Operador(a)' };

export const STOCK_STATUS_LABEL: Record<StockStatus, string> = {
  ok: 'Normal', low: 'Abaixo do mínimo', out: 'Sem estoque', over: 'Acima do máximo', recipe: 'Ficha técnica',
};
