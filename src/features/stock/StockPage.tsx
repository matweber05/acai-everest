import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowDownToLine, ArrowUpFromLine, ClipboardCheck, Download, Boxes, CalendarClock } from 'lucide-react';
import { useStore } from '@/contexts/AuthContext';
import { useQuickActions } from '@/contexts/QuickActions';
import { useCategories, useLots, useStockPosition } from '@/lib/api';
import { formatBRL, formatCost, formatDate, formatQty } from '@/lib/format';
import { downloadCSV } from '@/lib/csv';
import { STOCK_STATUS_LABEL } from '@/lib/labels';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select } from '@/components/ui/form';
import { EmptyState, ErrorState, PageHeader, SearchInput, Segmented, Spinner } from '@/components/ui/misc';
import { Pagination, Table, TBody, TD, TH, THead, TR, usePagination } from '@/components/ui/table';
import { matchesProduct } from '@/components/ProductPicker';
import { StockBadge } from '@/components/StockBadge';
import type { StockStatus } from '@/types/db';

type Tab = 'posicao' | 'lotes';

function PositionTab() {
  const { storeId } = useStore();
  const { openMovement } = useQuickActions();
  const [params, setParams] = useSearchParams();
  const status = (params.get('status') ?? '') as StockStatus | '';
  const { data = [], isLoading, error, refetch } = useStockPosition(storeId);
  const { data: categories = [] } = useCategories(storeId);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');

  const base = useMemo(() => data.filter((p) => p.active && p.stock_mode === 'stock'), [data]);
  const rows = useMemo(() => base.filter((p) => matchesProduct(p, q) && (!cat || p.category_id === cat) && (!status || p.stock_status === status)), [base, q, cat, status]);
  const totalValue = rows.reduce((a, p) => a + Number(p.stock_value), 0);
  const { slice, page, pages, setPage, total } = usePagination(rows);

  function exportCsv() {
    downloadCSV('posicao-estoque', rows, [
      { header: 'SKU', value: (r) => r.sku }, { header: 'Produto', value: (r) => r.name }, { header: 'Categoria', value: (r) => r.category_name },
      { header: 'Unidade', value: (r) => r.unit_code }, { header: 'Saldo', value: (r) => r.quantity }, { header: 'Mínimo', value: (r) => r.min_stock },
      { header: 'Custo médio', value: (r) => r.unit_cost }, { header: 'Valor (custo)', value: (r) => r.stock_value },
      { header: 'Situação', value: (r) => STOCK_STATUS_LABEL[r.stock_status] }, { header: 'Próximo vencimento', value: (r) => (r.next_expiry ? formatDate(r.next_expiry) : '') },
    ]);
  }

  return (
    <Card>
      <div className="flex flex-col gap-2 border-b border-line p-4 lg:flex-row">
        <SearchInput className="flex-1" placeholder="Buscar item" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar item" />
        <Select className="lg:w-56" value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Categoria">
          <option value="">Todas as categorias</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <Select className="lg:w-52" value={status} aria-label="Situação"
          onChange={(e) => { if (e.target.value) params.set('status', e.target.value); else params.delete('status'); setParams(params, { replace: true }); }}>
          <option value="">Todas as situações</option>
          <option value="low">Abaixo do mínimo</option><option value="out">Sem estoque</option>
          <option value="ok">Normal</option><option value="over">Acima do máximo</option>
        </Select>
        <Button variant="secondary" onClick={exportCsv} disabled={!rows.length}><Download className="h-4 w-4" />CSV</Button>
      </div>
      {error ? <ErrorState error={error} onRetry={() => refetch()} /> : isLoading ? <Spinner /> : rows.length === 0 ? (
        base.length === 0
          ? <EmptyState icon={<Boxes className="h-7 w-7" />} title="Nenhum item com estoque próprio" description="Cadastre produtos em “Produtos e insumos” e registre o estoque inicial." action={<Link to="/produtos"><Button>Ir para Produtos</Button></Link>} />
          : <EmptyState title="Nenhum item com estes filtros" />
      ) : (
        <>
          <div className="flex flex-wrap gap-x-6 gap-y-1 border-b border-line bg-surface/60 px-4 py-2.5 text-[13px] text-ink-muted">
            <span>{rows.length} itens</span>
            <span>Valor total (custo): <b className="text-ink">{formatBRL(totalValue)}</b></span>
          </div>
          <ul className="divide-y divide-line md:hidden">
            {slice.map((p) => (
              <li key={p.id} className="flex items-center gap-3 px-4 py-3">
                <Link to={`/produtos/${p.id}`} className="min-w-0 flex-1">
                  <div className="truncate font-medium">{p.name}</div>
                  <div className="mt-0.5 flex items-center gap-2 text-[12.5px] text-ink-muted"><StockBadge p={p} />mín. {formatQty(p.min_stock)}</div>
                </Link>
                <div className="text-right font-semibold tabular">{formatQty(p.quantity, p.unit_code)}</div>
                <div className="flex gap-1">
                  <Button size="icon" variant="secondary" className="h-9 w-9" aria-label={`Entrada de ${p.name}`} onClick={() => openMovement('in', p.id)}><ArrowDownToLine className="h-4 w-4 text-leaf-600" /></Button>
                  <Button size="icon" variant="secondary" className="h-9 w-9" aria-label={`Saída de ${p.name}`} onClick={() => openMovement('out', p.id)}><ArrowUpFromLine className="h-4 w-4 text-acai-600" /></Button>
                </div>
              </li>
            ))}
          </ul>
          <div className="hidden md:block">
            <Table>
              <THead><tr>
                <TH>Item</TH><TH>Categoria</TH><TH className="text-right">Saldo</TH><TH className="text-right">Mínimo</TH>
                <TH className="text-right">Custo médio</TH><TH className="text-right">Valor</TH><TH>Situação</TH><TH>Validade</TH><TH className="text-right">Ações</TH>
              </tr></THead>
              <TBody>
                {slice.map((p) => (
                  <TR key={p.id}>
                    <TD><Link to={`/produtos/${p.id}`} className="font-medium hover:text-acai-700">{p.name}</Link><div className="text-[12px] text-ink-muted">{p.sku}</div></TD>
                    <TD className="text-ink-muted">{p.category_name ?? '—'}</TD>
                    <TD className="text-right font-semibold tabular">{formatQty(p.quantity, p.unit_code)}</TD>
                    <TD className="text-right tabular text-ink-muted">{formatQty(p.min_stock)}</TD>
                    <TD className="text-right tabular">{formatCost(p.unit_cost)}</TD>
                    <TD className="text-right tabular">{formatBRL(p.stock_value)}</TD>
                    <TD><StockBadge p={p} /></TD>
                    <TD className="whitespace-nowrap text-ink-muted">{p.next_expiry ? formatDate(p.next_expiry) : '—'}</TD>
                    <TD className="text-right">
                      <div className="inline-flex gap-1">
                        <Button size="sm" variant="secondary" onClick={() => openMovement('in', p.id)} aria-label={`Entrada de ${p.name}`}><ArrowDownToLine className="h-4 w-4 text-leaf-600" /></Button>
                        <Button size="sm" variant="secondary" onClick={() => openMovement('out', p.id)} aria-label={`Saída de ${p.name}`}><ArrowUpFromLine className="h-4 w-4 text-acai-600" /></Button>
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
          <Pagination page={page} pages={pages} total={total} onPage={setPage} label="itens" />
        </>
      )}
    </Card>
  );
}

function LotsTab() {
  const { storeId, store } = useStore();
  const { openMovement } = useQuickActions();
  const { data = [], isLoading, error, refetch } = useLots(storeId);
  const windows = [...store.expiry_alert_days].sort((a, b) => a - b);
  const [win, setWin] = useState<string>('all');
  const rows = useMemo(() => data.filter((l) => {
    if (win === 'all') return true;
    if (win === 'expired') return l.days_to_expiry != null && l.days_to_expiry < 0;
    return l.days_to_expiry != null && l.days_to_expiry >= 0 && l.days_to_expiry <= Number(win);
  }), [data, win]);
  const { slice, page, pages, setPage, total } = usePagination(rows);
  const counts = useMemo(() => ({
    expired: data.filter((l) => l.days_to_expiry != null && l.days_to_expiry < 0).length,
    ...Object.fromEntries(windows.map((w) => [w, data.filter((l) => l.days_to_expiry != null && l.days_to_expiry >= 0 && l.days_to_expiry <= w).length])),
  }) as Record<string, number>, [data, windows]);

  function exportCsv() {
    downloadCSV('lotes-validade', rows, [
      { header: 'Produto', value: (r) => r.product_name }, { header: 'Lote', value: (r) => r.lot_code }, { header: 'Entrada', value: (r) => formatDate(r.received_at) },
      { header: 'Validade', value: (r) => (r.expiry_date ? formatDate(r.expiry_date) : '') }, { header: 'Dias para vencer', value: (r) => r.days_to_expiry },
      { header: 'Restante', value: (r) => r.remaining_qty }, { header: 'Unidade', value: (r) => r.unit_code }, { header: 'Fornecedor', value: (r) => r.supplier_name },
      { header: 'Custo', value: (r) => r.unit_cost },
    ]);
  }

  return (
    <Card>
      <div className="flex flex-col gap-2 border-b border-line p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filtro de validade">
          {[['all', 'Todos'], ['expired', `Vencidos (${counts.expired ?? 0})`], ...windows.map((w) => [String(w), `Até ${w} dias (${counts[w] ?? 0})`])].map(([v, l]) => (
            <button key={v} onClick={() => setWin(v)} aria-pressed={win === v}
              className={`rounded-full border px-3 py-1.5 text-[13px] font-medium transition-colors ${win === v ? 'border-acai-700 bg-acai-700 text-white' : 'border-line bg-white text-ink-muted hover:border-acai-300'}`}>
              {l}
            </button>
          ))}
        </div>
        <Button variant="secondary" onClick={exportCsv} disabled={!rows.length}><Download className="h-4 w-4" />CSV</Button>
      </div>
      {error ? <ErrorState error={error} onRetry={() => refetch()} /> : isLoading ? <Spinner /> : rows.length === 0 ? (
        <EmptyState icon={<CalendarClock className="h-7 w-7" />} title={data.length ? 'Nenhum lote neste filtro' : 'Nenhum lote com saldo'}
          description="Lotes são criados nas entradas de itens com controle de lote ou validade." />
      ) : (
        <>
          <Table>
            <THead><tr><TH>Produto</TH><TH>Lote</TH><TH>Validade</TH><TH className="text-right">Restante</TH><TH className="hidden md:table-cell">Fornecedor</TH><TH className="text-right">Ação</TH></tr></THead>
            <TBody>
              {slice.map((l) => (
                <TR key={l.id}>
                  <TD><Link to={`/produtos/${l.product_id}`} className="font-medium hover:text-acai-700">{l.product_name}</Link></TD>
                  <TD>{l.lot_code ?? '—'}</TD>
                  <TD className="whitespace-nowrap">
                    {l.expiry_date ? formatDate(l.expiry_date) : '—'}{' '}
                    {l.days_to_expiry != null && (l.days_to_expiry < 0 ? <Badge tone="danger">Vencido</Badge>
                      : l.days_to_expiry <= (windows[0] ?? 7) ? <Badge tone="warning">{l.days_to_expiry === 0 ? 'Hoje' : `${l.days_to_expiry} dia(s)`}</Badge>
                      : l.days_to_expiry <= (windows[windows.length - 1] ?? 30) ? <Badge tone="info">{l.days_to_expiry} dias</Badge> : null)}
                  </TD>
                  <TD className="text-right tabular">{formatQty(l.remaining_qty, l.unit_code)}</TD>
                  <TD className="hidden text-ink-muted md:table-cell">{l.supplier_name ?? '—'}</TD>
                  <TD className="text-right"><Button size="sm" variant="secondary" onClick={() => openMovement('out', l.product_id)}>Dar baixa</Button></TD>
                </TR>
              ))}
            </TBody>
          </Table>
          <Pagination page={page} pages={pages} total={total} onPage={setPage} label="lotes" />
        </>
      )}
    </Card>
  );
}

export default function StockPage() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('aba') === 'lotes' ? 'lotes' : 'posicao') as Tab;
  return (
    <>
      <PageHeader
        title="Estoque"
        description="Saldos calculados a partir das movimentações confirmadas."
        actions={<Link to="/estoque/inventario"><Button variant="secondary"><ClipboardCheck className="h-4 w-4" />Inventário / contagem</Button></Link>}
      />
      <Segmented className="mb-4" ariaLabel="Visão do estoque" value={tab}
        onChange={(v) => { const n = new URLSearchParams(); if (v === 'lotes') n.set('aba', 'lotes'); setParams(n, { replace: true }); }}
        options={[{ value: 'posicao', label: 'Posição atual' }, { value: 'lotes', label: 'Lotes e validade' }]} />
      {tab === 'posicao' ? <PositionTab /> : <LotsTab />}
    </>
  );
}
