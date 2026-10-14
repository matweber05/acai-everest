import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Download, History, RotateCcw, X } from 'lucide-react';
import { useStore } from '@/contexts/AuthContext';
import { fetchAllMovements, useMembers, useMovements, useRpc, useStockPosition, type MovementFilters } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { DIRECTION_LABEL, REASON_LABEL } from '@/lib/labels';
import { formatCost, formatDateTime, formatQty, formatBRL } from '@/lib/format';
import { downloadCSV } from '@/lib/csv';
import { newRequestId, cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input, Select } from '@/components/ui/form';
import { ConfirmDialog } from '@/components/ui/confirm';
import { EmptyState, ErrorState, PageHeader, Spinner } from '@/components/ui/misc';
import { Pagination, Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { ProductPicker } from '@/components/ProductPicker';
import type { Direction, Movement, MovementReason } from '@/types/db';

export default function MovementsPage() {
  const { storeId, isAdmin } = useStore();
  const [params] = useSearchParams();
  const [f, setF] = useState<MovementFilters>({ productId: params.get('produto') ?? undefined });
  const [page, setPage] = useState(1);
  const { data, isLoading, error, refetch, isFetching } = useMovements(storeId, f, page);
  const { data: products = [] } = useStockPosition(storeId);
  const { data: members = [] } = useMembers(storeId);
  const reverse = useRpc<Record<string, unknown>>('reverse_movement');
  const [target, setTarget] = useState<Movement | null>(null);
  const [exporting, setExporting] = useState(false);
  const stockProducts = useMemo(() => products.filter((p) => p.stock_mode === 'stock'), [products]);

  function update(patch: Partial<MovementFilters>) { setF((x) => ({ ...x, ...patch })); setPage(1); }
  const hasFilters = Object.values(f).some(Boolean);

  async function onReverse(reason: string) {
    if (!target) return;
    try {
      await reverse.mutateAsync({ p_store: storeId, p_movement: target.id, p_reason: reason, p_request_id: newRequestId() });
      toast.success('Movimentação estornada', { description: 'Foi criada uma movimentação compensatória ligada à original.' });
      setTarget(null);
    } catch (e) { toast.error(errorMessage(e)); }
  }

  async function exportCsv() {
    setExporting(true);
    try {
      const rows = await fetchAllMovements(storeId, f);
      downloadCSV('movimentacoes', rows, [
        { header: 'Data/hora', value: (r) => formatDateTime(r.occurred_at) }, { header: 'Tipo', value: (r) => DIRECTION_LABEL[r.direction] },
        { header: 'Motivo', value: (r) => REASON_LABEL[r.reason] }, { header: 'SKU', value: (r) => r.sku }, { header: 'Produto', value: (r) => r.product_name },
        { header: 'Quantidade', value: (r) => (r.direction === 'in' ? r.quantity : -r.quantity) }, { header: 'Unidade', value: (r) => r.unit_code },
        { header: 'Custo unitário', value: (r) => r.unit_cost }, { header: 'Valor', value: (r) => r.total_cost },
        { header: 'Saldo após', value: (r) => r.balance_after }, { header: 'Lote', value: (r) => r.lot_code },
        { header: 'Fornecedor', value: (r) => r.supplier_name }, { header: 'Referência', value: (r) => r.document_ref },
        { header: 'Responsável', value: (r) => r.created_by_name }, { header: 'Observações', value: (r) => r.notes },
        { header: 'Estornada', value: (r) => (r.reversed_by_movement_id ? 'Sim' : '') },
      ]);
    } catch (e) { toast.error(errorMessage(e)); } finally { setExporting(false); }
  }

  const canReverse = (m: Movement) => isAdmin && !m.reversed_by_movement_id && !m.reverses_movement_id && !m.sale_id && !m.purchase_id;

  return (
    <>
      <PageHeader title="Movimentações" description="Histórico completo e auditável. Erros são corrigidos por estorno — nada é apagado."
        actions={<Button variant="secondary" onClick={exportCsv} loading={exporting}><Download className="h-4 w-4" />Exportar CSV</Button>} />

      <Card>
        <div className="grid gap-2 border-b border-line p-4 sm:grid-cols-2 lg:grid-cols-6">
          <div className="sm:col-span-2">
            <ProductPicker products={stockProducts} value={f.productId ?? null} onChange={(id) => update({ productId: id ?? undefined })} placeholder="Filtrar por produto" showStock={false} />
          </div>
          <Select value={f.direction ?? ''} onChange={(e) => update({ direction: e.target.value as Direction | '' })} aria-label="Tipo">
            <option value="">Entradas e saídas</option><option value="in">Entradas</option><option value="out">Saídas</option>
          </Select>
          <Select value={f.reason ?? ''} onChange={(e) => update({ reason: e.target.value as MovementReason | '' })} aria-label="Motivo">
            <option value="">Todos os motivos</option>
            {Object.entries(REASON_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </Select>
          <Select value={f.userId ?? ''} onChange={(e) => update({ userId: e.target.value || undefined })} aria-label="Responsável">
            <option value="">Todos os responsáveis</option>
            {members.map((m) => <option key={m.user_id} value={m.user_id}>{m.profiles?.full_name || m.profiles?.email}</option>)}
          </Select>
          <div className="flex items-center gap-1.5">
            <Input type="date" aria-label="De" value={f.from ?? ''} onChange={(e) => update({ from: e.target.value || undefined })} className="min-w-0" />
            <Input type="date" aria-label="Até" value={f.to ?? ''} onChange={(e) => update({ to: e.target.value || undefined })} className="min-w-0" />
          </div>
          {hasFilters && (
            <div className="sm:col-span-2 lg:col-span-6">
              <Button size="sm" variant="ghost" onClick={() => { setF({}); setPage(1); }}><X className="h-4 w-4" />Limpar filtros</Button>
            </div>
          )}
        </div>

        {error ? <ErrorState error={error} onRetry={() => refetch()} /> : isLoading ? <Spinner /> : !data?.rows.length ? (
          <EmptyState icon={<History className="h-7 w-7" />} title={hasFilters ? 'Nada encontrado com estes filtros' : 'Nenhuma movimentação ainda'}
            description={hasFilters ? undefined : 'Entradas, saídas, vendas, compras e ajustes aparecerão aqui.'} />
        ) : (
          <div className={cn(isFetching && 'opacity-70 transition-opacity')}>
            <ul className="divide-y divide-line md:hidden">
              {data.rows.map((m) => (
                <li key={m.id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link to={`/produtos/${m.product_id}`} className="block truncate font-medium">{m.product_name}</Link>
                      <div className="text-[12.5px] text-ink-muted">{REASON_LABEL[m.reason]} · {formatDateTime(m.occurred_at)}</div>
                      <div className="text-[12px] text-ink-soft">{m.created_by_name ?? ''}{m.document_ref ? ` · ${m.document_ref}` : ''}</div>
                    </div>
                    <div className="text-right">
                      <div className={cn('font-semibold tabular', m.direction === 'in' ? 'text-leaf-700' : 'text-acai-700')}>{m.direction === 'in' ? '+' : '−'}{formatQty(m.quantity, m.unit_code)}</div>
                      {m.reversed_by_movement_id && <Badge>Estornada</Badge>}
                      {canReverse(m) && <button className="mt-1 text-[12.5px] font-medium text-acai-700" onClick={() => setTarget(m)}>Estornar</button>}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            <div className="hidden md:block">
              <Table>
                <THead><tr>
                  <TH>Data/hora</TH><TH>Produto</TH><TH>Motivo</TH><TH className="text-right">Qtd.</TH><TH className="text-right">Custo</TH>
                  <TH className="text-right">Saldo após</TH><TH>Responsável</TH><TH>Referência</TH><TH />
                </tr></THead>
                <TBody>
                  {data.rows.map((m) => (
                    <TR key={m.id} className={cn(m.reversed_by_movement_id && 'text-ink-muted')}>
                      <TD className="whitespace-nowrap">{formatDateTime(m.occurred_at)}</TD>
                      <TD><Link to={`/produtos/${m.product_id}`} className="font-medium hover:text-acai-700">{m.product_name}</Link>
                        {m.lot_code && <div className="text-[12px] text-ink-muted">Lote {m.lot_code}</div>}</TD>
                      <TD>
                        <div className="flex flex-wrap items-center gap-1">
                          {REASON_LABEL[m.reason]}
                          {m.reversed_by_movement_id && <Badge>Estornada</Badge>}
                          {m.negative_override && <Badge tone="danger">Estoque negativo</Badge>}
                        </div>
                        {m.notes && <div className="max-w-[240px] truncate text-[12px] text-ink-muted" title={m.notes}>{m.notes}</div>}
                      </TD>
                      <TD className={cn('whitespace-nowrap text-right font-semibold tabular', m.direction === 'in' ? 'text-leaf-700' : 'text-acai-700')}>
                        {m.direction === 'in' ? '+' : '−'}{formatQty(m.quantity, m.unit_code)}
                      </TD>
                      <TD className="text-right tabular" title={`Total ${formatBRL(m.total_cost)}`}>{formatCost(m.unit_cost)}</TD>
                      <TD className="text-right tabular">{formatQty(m.balance_after)}</TD>
                      <TD className="text-ink-muted">{m.created_by_name ?? '—'}</TD>
                      <TD className="text-ink-muted">
                        {m.sale_id ? <Link className="hover:text-acai-700" to={`/vendas/${m.sale_id}`}>{m.document_ref}</Link>
                          : m.purchase_id ? <Link className="hover:text-acai-700" to={`/compras/${m.purchase_id}`}>{m.document_ref}</Link>
                          : m.document_ref ?? '—'}
                      </TD>
                      <TD className="text-right">
                        {canReverse(m) && <Button size="sm" variant="ghost" onClick={() => setTarget(m)}><RotateCcw className="h-4 w-4" />Estornar</Button>}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
            <Pagination page={page} pages={data.pages} total={data.total} onPage={setPage} label="movimentações" />
          </div>
        )}
      </Card>

      <ConfirmDialog
        open={!!target} onOpenChange={(v) => !v && setTarget(null)} requireReason
        title="Estornar movimentação?"
        message={target && (
          <>Será criada uma movimentação de <b>{target.direction === 'in' ? 'saída' : 'entrada'}</b> de <b>{formatQty(target.quantity, target.unit_code)}</b> de <b>{target.product_name}</b> para anular este lançamento. O registro original continua no histórico.</>
        )}
        confirmLabel="Estornar" loading={reverse.isPending} onConfirm={onReverse}
      />
    </>
  );
}
