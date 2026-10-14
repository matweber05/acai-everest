import { STOCK_STATUS_LABEL } from '@/lib/labels';
import type { StockPosition, StockStatus } from '@/types/db';
import { Badge, type Tone } from './ui/badge';

const STATUS_TONE: Record<StockStatus, Tone> = { ok: 'success', low: 'warning', out: 'danger', over: 'info', recipe: 'acai' };

export function StockBadge({ p }: { p: Pick<StockPosition, 'stock_status' | 'active'> }) {
  if (!p.active) return <Badge tone="neutral">Inativo</Badge>;
  return <Badge tone={STATUS_TONE[p.stock_status]}>{STOCK_STATUS_LABEL[p.stock_status]}</Badge>;
}
