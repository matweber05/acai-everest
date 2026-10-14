import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, Download, FileText } from 'lucide-react';
import { useStore } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { fetchAllMovements, useCategories, useStockPosition, useSuppliers } from '@/lib/api';
import { addDaysISO, formatBRL, formatCost, formatDate, formatDateTime, formatPct, formatQty, todayISO } from '@/lib/format';
import { downloadCSV, type CsvColumn } from '@/lib/csv';
import { DIRECTION_LABEL, REASON_LABEL, STOCK_STATUS_LABEL } from '@/lib/labels';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Select, Label } from '@/components/ui/form';
import { EmptyState, ErrorState, PageHeader, Spinner } from '@/components/ui/misc';
import { Pagination, Table, TBody, TD, TH, THead, TR, usePagination } from '@/components/ui/table';
import { ProductPicker } from '@/components/ProductPicker';
import type { Lot, Movement, StockPosition } from '@/types/db';

type FilterKey = 'period' | 'product' | 'category' | 'supplier';
type Kind = 'money' | 'cost' | 'qty' | 'int' | 'pct' | 'text' | 'date' | 'datetime';
interface Col<T> { header: string; value: (r: T) => string | number | null | undefined; kind?: Kind; unit?: (r: T) => string | undefined; total?: boolean }
interface Ctx { storeId: string; from: string; to: string; productId?: string; categoryId?: string; supplierId?: string; stock: StockPosition[]; maxAlert: number }
interface ReportDef<T = any> { // eslint-disable-line @typescript-eslint/no-explicit-any
  id: string; group: string; title: string; description: string; filters: FilterKey[];
  load: (c: Ctx) => Promise<T[]>; columns: Col<T>[]; note?: string;
}

const stockFilter = (c: Ctx) => c.stock.filter((p) => p.stock_mode === 'stock' && p.active
  && (!c.categoryId || p.category_id === c.categoryId) && (!c.productId || p.id === c.productId)
  && (!c.supplierId || p.default_supplier_id === c.supplierId));

const stockCols: Col<StockPosition>[] = [
  { header: 'SKU', value: (r) => r.sku }, { header: 'Produto', value: (r) => r.name }, { header: 'Categoria', value: (r) => r.category_name },
  { header: 'Saldo', value: (r) => r.quantity, kind: 'qty', unit: (r) => r.unit_code }, { header: 'Mínimo', value: (r) => r.min_stock, kind: 'qty' },
  { header: 'Custo médio', value: (r) => r.unit_cost, kind: 'cost' }, { header: 'Valor (custo)', value: (r) => r.stock_value, kind: 'money', total: true },
  { header: 'Situação', value: (r) => STOCK_STATUS_LABEL[r.stock_status] },
];

const movCols: Col<Movement>[] = [
  { header: 'Data/hora', value: (r) => r.occurred_at, kind: 'datetime' }, { header: 'Tipo', value: (r) => DIRECTION_LABEL[r.direction] },
  { header: 'Motivo', value: (r) => REASON_LABEL[r.reason] }, { header: 'Produto', value: (r) => r.product_name },
  { header: 'Quantidade', value: (r) => r.quantity, kind: 'qty', unit: (r) => r.unit_code }, { header: 'Custo un.', value: (r) => r.unit_cost, kind: 'cost' },
  { header: 'Valor', value: (r) => r.total_cost, kind: 'money', total: true }, { header: 'Responsável', value: (r) => r.created_by_name },
  { header: 'Referência', value: (r) => r.document_ref },
];

async function rpcRows<T>(fn: string, args: Record<string, unknown>) {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return (data ?? []) as T[];
}

const REPORTS: ReportDef[] = [
  { id: 'posicao', group: 'Estoque', title: 'Posição atual do estoque', description: 'Saldo, custo médio e valor de cada item.', filters: ['category', 'product', 'supplier'],
    load: async (c) => stockFilter(c), columns: stockCols },
  { id: 'minimo', group: 'Estoque', title: 'Abaixo do estoque mínimo', description: 'Itens com saldo positivo, mas abaixo do mínimo.', filters: ['category', 'supplier'],
    load: async (c) => stockFilter(c).filter((p) => p.stock_status === 'low'),
    columns: [...stockCols.slice(0, 5), { header: 'Falta p/ mínimo', value: (r: StockPosition) => Math.max(r.min_stock - r.quantity, 0), kind: 'qty', unit: (r: StockPosition) => r.unit_code }, stockCols[7]] },
  { id: 'zerados', group: 'Estoque', title: 'Produtos sem estoque', description: 'Itens ativos com saldo zero ou negativo.', filters: ['category', 'supplier'],
    load: async (c) => stockFilter(c).filter((p) => p.stock_status === 'out'), columns: stockCols.slice(0, 5) },
  { id: 'validade', group: 'Estoque', title: 'Próximos do vencimento', description: 'Lotes vencidos e que vencem dentro do maior prazo de alerta.', filters: ['product'],
    load: async (c) => {
      let q = supabase.from('v_lots').select('*').eq('store_id', c.storeId).gt('remaining_qty', 0).not('expiry_date', 'is', null)
        .lte('expiry_date', addDaysISO(todayISO(), c.maxAlert));
      if (c.productId) q = q.eq('product_id', c.productId);
      const { data, error } = await q.order('expiry_date');
      if (error) throw error;
      return (data ?? []) as Lot[];
    },
    columns: [
      { header: 'Produto', value: (r: Lot) => r.product_name }, { header: 'Lote', value: (r: Lot) => r.lot_code },
      { header: 'Validade', value: (r: Lot) => r.expiry_date, kind: 'date' },
      { header: 'Dias', value: (r: Lot) => (r.days_to_expiry != null && r.days_to_expiry < 0 ? `Vencido há ${-r.days_to_expiry}` : r.days_to_expiry) },
      { header: 'Restante', value: (r: Lot) => r.remaining_qty, kind: 'qty', unit: (r: Lot) => r.unit_code },
      { header: 'Valor (custo)', value: (r: Lot) => Math.round(r.remaining_qty * r.unit_cost * 100) / 100, kind: 'money', total: true },
      { header: 'Fornecedor', value: (r: Lot) => r.supplier_name },
    ] },
  { id: 'valor', group: 'Estoque', title: 'Valor do estoque pelo custo', description: 'Valor investido em estoque, por categoria (custo médio).', filters: ['category'],
    load: async (c) => {
      const m = new Map<string, { categoria: string; itens: number; valor: number }>();
      for (const p of stockFilter(c)) {
        const k = p.category_name ?? 'Sem categoria';
        const e = m.get(k) ?? { categoria: k, itens: 0, valor: 0 };
        e.itens += 1; e.valor = Math.round((e.valor + Number(p.stock_value)) * 100) / 100; m.set(k, e);
      }
      return [...m.values()].sort((a, b) => b.valor - a.valor);
    },
    columns: [{ header: 'Categoria', value: (r) => r.categoria }, { header: 'Itens', value: (r) => r.itens, kind: 'int', total: true }, { header: 'Valor (custo)', value: (r) => r.valor, kind: 'money', total: true }] },
  { id: 'historico', group: 'Movimentações', title: 'Histórico de movimentações', description: 'Todas as entradas e saídas do período.', filters: ['period', 'product', 'category'],
    load: (c) => fetchAllMovements(c.storeId, { from: c.from, to: c.to, productId: c.productId, categoryId: c.categoryId }), columns: movCols },
  { id: 'entradas', group: 'Movimentações', title: 'Entradas por período', description: 'Compras, entradas manuais, devoluções e ajustes positivos.', filters: ['period', 'product', 'category'],
    load: (c) => fetchAllMovements(c.storeId, { from: c.from, to: c.to, productId: c.productId, categoryId: c.categoryId, direction: 'in' }), columns: movCols },
  { id: 'saidas', group: 'Movimentações', title: 'Saídas por período', description: 'Vendas, consumo, perdas, vencidos, avarias e ajustes negativos.', filters: ['period', 'product', 'category'],
    load: (c) => fetchAllMovements(c.storeId, { from: c.from, to: c.to, productId: c.productId, categoryId: c.categoryId, direction: 'out' }), columns: movCols },
  { id: 'compras', group: 'Compras e vendas', title: 'Compras por fornecedor', description: 'Compras recebidas no período (pela data de recebimento).', filters: ['period'],
    load: (c) => rpcRows('report_purchases_by_supplier', { p_store: c.storeId, p_from: c.from, p_to: c.to }),
    columns: [{ header: 'Fornecedor', value: (r) => r.supplier }, { header: 'Compras', value: (r) => r.purchases, kind: 'int', total: true },
      { header: 'Produtos', value: (r) => r.subtotal, kind: 'money', total: true }, { header: 'Descontos', value: (r) => r.discounts, kind: 'money', total: true },
      { header: 'Frete', value: (r) => r.freight, kind: 'money', total: true }, { header: 'Total', value: (r) => r.total, kind: 'money', total: true }] },
  { id: 'vendas', group: 'Compras e vendas', title: 'Vendas por período', description: 'Vendas confirmadas por dia. Canceladas não entram.', filters: ['period'],
    load: (c) => rpcRows('report_sales_by_day', { p_store: c.storeId, p_from: c.from, p_to: c.to }),
    columns: [{ header: 'Dia', value: (r) => r.day, kind: 'date' }, { header: 'Vendas', value: (r) => r.sales, kind: 'int', total: true },
      { header: 'Receita bruta', value: (r) => r.revenue, kind: 'money', total: true }, { header: 'Descontos', value: (r) => r.discounts, kind: 'money', total: true },
      { header: 'Ticket médio', value: (r) => (r.sales ? Math.round((r.revenue / r.sales) * 100) / 100 : 0), kind: 'money' }] },
  { id: 'top', group: 'Compras e vendas', title: 'Produtos mais vendidos', description: 'Ranking por receita no período.', filters: ['period', 'category'],
    load: (c) => rpcRows('report_product_sales', { p_store: c.storeId, p_from: c.from, p_to: c.to, p_category: c.categoryId ?? null }),
    columns: [{ header: 'Produto', value: (r) => r.name }, { header: 'Categoria', value: (r) => r.category },
      { header: 'Quantidade', value: (r) => r.quantity, kind: 'qty', unit: (r) => r.unit }, { header: 'Receita', value: (r) => r.revenue, kind: 'money', total: true }] },
  { id: 'margem', group: 'Compras e vendas', title: 'Margem bruta estimada', description: 'Receita − custo dos produtos vendidos (custo médio).', filters: ['period', 'category'],
    note: 'Margem bruta não é lucro: não considera despesas operacionais, impostos, taxas de cartão, aluguel, salários etc. Itens sem custo cadastrado ficam sem margem.',
    load: (c) => rpcRows('report_product_sales', { p_store: c.storeId, p_from: c.from, p_to: c.to, p_category: c.categoryId ?? null }),
    columns: [{ header: 'Produto', value: (r) => r.name }, { header: 'Qtd.', value: (r) => r.quantity, kind: 'qty', unit: (r) => r.unit },
      { header: 'Receita', value: (r) => r.revenue, kind: 'money', total: true }, { header: 'CMV', value: (r) => (r.cost_complete ? r.cogs : null), kind: 'money' },
      { header: 'Margem bruta', value: (r) => r.gross_margin, kind: 'money' }, { header: 'Margem %', value: (r) => r.margin_pct, kind: 'pct' }] },
];

function fmt<T>(c: Col<T>, r: T) {
  const v = c.value(r);
  if (v == null || v === '') return '—';
  switch (c.kind) {
    case 'money': return formatBRL(Number(v));
    case 'cost': return formatCost(Number(v));
    case 'qty': return formatQty(Number(v), c.unit?.(r));
    case 'int': return Number(v).toLocaleString('pt-BR');
    case 'pct': return formatPct(Number(v));
    case 'date': return formatDate(String(v));
    case 'datetime': return formatDateTime(String(v));
    default: return String(v);
  }
}

export default function ReportsPage() {
  const { storeId, store } = useStore();
  const { data: stock = [] } = useStockPosition(storeId);
  const { data: categories = [] } = useCategories(storeId);
  const { data: suppliers = [] } = useSuppliers(storeId);
  const [reportId, setReportId] = useState('posicao');
  const [from, setFrom] = useState(addDaysISO(todayISO(), -29));
  const [to, setTo] = useState(todayISO());
  const [productId, setProductId] = useState<string | undefined>();
  const [categoryId, setCategoryId] = useState<string | undefined>();
  const [supplierId, setSupplierId] = useState<string | undefined>();
  const report = REPORTS.find((r) => r.id === reportId)!;
  const has = (k: FilterKey) => report.filters.includes(k);
  const maxAlert = Math.max(...store.expiry_alert_days);

  const ctx: Ctx = {
    storeId, from, to, stock, maxAlert,
    productId: has('product') ? productId : undefined, categoryId: has('category') ? categoryId : undefined, supplierId: has('supplier') ? supplierId : undefined,
  };
  const { data: rows = [], isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['report', reportId, ctx.from, ctx.to, ctx.productId, ctx.categoryId, ctx.supplierId, stock.length, has('period')],
    queryFn: () => report.load(ctx),
    enabled: from <= to,
  });
  const { slice, page, pages, setPage, total } = usePagination(rows);
  const totals = useMemo(() => report.columns.map((c) => (c.total ? rows.reduce((a, r) => a + (Number(c.value(r)) || 0), 0) : null)), [rows, report]);
  const groups = [...new Set(REPORTS.map((r) => r.group))];

  function exportCsv() {
    const suffix = has('period') ? `-${from}-a-${to}` : `-${todayISO()}`;
    downloadCSV(`relatorio-${report.id}${suffix}`, rows, report.columns.map((c) => ({
      header: c.header + (c.kind === 'money' || c.kind === 'cost' ? ' (R$)' : ''),
      value: (r) => { const v = c.value(r); return c.kind === 'date' && v ? formatDate(String(v)) : c.kind === 'datetime' && v ? formatDateTime(String(v)) : v; },
    })) as CsvColumn<unknown>[]);
  }

  return (
    <>
      <PageHeader title="Relatórios" description="Escolha o relatório, ajuste os filtros e exporte para CSV (abre no Excel)." />
      <div className="grid gap-5 lg:grid-cols-[260px_1fr]">
        <Card className="h-fit p-2">
          <nav aria-label="Relatórios">
            {groups.map((g) => (
              <div key={g} className="mb-2">
                <div className="px-3 pb-1 pt-2 text-[11.5px] font-semibold uppercase tracking-wider text-ink-soft">{g}</div>
                {REPORTS.filter((r) => r.group === g).map((r) => (
                  <button key={r.id} onClick={() => { setReportId(r.id); setPage(1); }} aria-current={r.id === reportId ? 'page' : undefined}
                    className={cn('block w-full rounded-lg px-3 py-2 text-left text-[13.5px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acai-400',
                      r.id === reportId ? 'bg-acai-700 font-medium text-white' : 'text-ink hover:bg-acai-50')}>
                    {r.title}
                  </button>
                ))}
              </div>
            ))}
          </nav>
        </Card>

        <Card>
          <div className="border-b border-line p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold">{report.title}</h2>
                <p className="text-[13px] text-ink-muted">{report.description}</p>
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={exportCsv} disabled={!rows.length}><Download className="h-4 w-4" />CSV</Button>
                <Button variant="secondary" disabled title="Exportação em PDF prevista para uma próxima versão"><FileText className="h-4 w-4" />PDF</Button>
              </div>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              {has('period') && (
                <>
                  <div><Label htmlFor="r-from">De</Label><Input id="r-from" type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} /></div>
                  <div><Label htmlFor="r-to">Até</Label><Input id="r-to" type="date" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} /></div>
                </>
              )}
              {has('category') && (
                <div><Label htmlFor="r-cat">Categoria</Label>
                  <Select id="r-cat" value={categoryId ?? ''} onChange={(e) => setCategoryId(e.target.value || undefined)}>
                    <option value="">Todas</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </Select></div>
              )}
              {has('supplier') && (
                <div><Label htmlFor="r-sup">Fornecedor principal</Label>
                  <Select id="r-sup" value={supplierId ?? ''} onChange={(e) => setSupplierId(e.target.value || undefined)}>
                    <option value="">Todos</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </Select></div>
              )}
              {has('product') && (
                <div className="sm:col-span-2"><Label htmlFor="r-prod">Produto</Label>
                  <ProductPicker id="r-prod" products={stock.filter((p) => p.stock_mode === 'stock')} value={productId ?? null} onChange={(id) => setProductId(id ?? undefined)} placeholder="Todos os produtos" showStock={false} /></div>
              )}
            </div>
            {report.note && <p className="mt-3 rounded-xl bg-mango-50 px-3 py-2 text-[12.5px] text-mango-700">{report.note}</p>}
          </div>

          {error ? <ErrorState error={error} onRetry={() => refetch()} /> : isLoading ? <Spinner /> : rows.length === 0 ? (
            <EmptyState icon={<BarChart3 className="h-7 w-7" />} title="Sem dados para este relatório" description="Ajuste o período ou os filtros." />
          ) : (
            <div className={cn(isFetching && 'opacity-70')}>
              <Table>
                <THead><tr>{report.columns.map((c) => <TH key={c.header} className={cn(c.kind && !['text', 'date', 'datetime'].includes(c.kind) && 'text-right')}>{c.header}</TH>)}</tr></THead>
                <TBody>
                  {slice.map((r, i) => (
                    <TR key={i}>
                      {report.columns.map((c) => <TD key={c.header} className={cn('whitespace-nowrap', c.kind && !['text', 'date', 'datetime'].includes(c.kind) && 'text-right tabular')}>{fmt(c, r)}</TD>)}
                    </TR>
                  ))}
                  {totals.some((t) => t != null) && (
                    <tr className="bg-surface font-semibold">
                      {report.columns.map((c, i) => (
                        <td key={c.header} className="px-4 py-3 text-right tabular">
                          {i === 0 ? <span className="float-left">Total ({rows.length})</span> : totals[i] == null ? '' : c.kind === 'money' ? formatBRL(totals[i]!) : totals[i]!.toLocaleString('pt-BR')}
                        </td>
                      ))}
                    </tr>
                  )}
                </TBody>
              </Table>
              <Pagination page={page} pages={pages} total={total} onPage={setPage} label="linhas" />
            </div>
          )}
        </Card>
      </div>
      <p className="mt-4 text-[12px] text-ink-muted">Receita bruta = total das vendas confirmadas (após descontos). Custo e margem usam o custo médio no momento de cada saída. Nenhum relatório calcula lucro líquido.</p>
    </>
  );
}

