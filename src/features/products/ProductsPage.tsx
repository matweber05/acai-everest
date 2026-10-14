import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Download, Package, Plus } from 'lucide-react';
import { useStore } from '@/contexts/AuthContext';
import { useCategories, useStockPosition } from '@/lib/api';
import { ITEM_TYPE_LABEL } from '@/lib/labels';
import { formatBRL, formatCost, formatQty } from '@/lib/format';
import { downloadCSV } from '@/lib/csv';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { StockBadge } from '@/components/StockBadge';
import { Select } from '@/components/ui/form';
import { EmptyState, ErrorState, PageHeader, SearchInput, Spinner } from '@/components/ui/misc';
import { Pagination, Table, TBody, TD, TH, THead, TR, usePagination } from '@/components/ui/table';
import { matchesProduct } from '@/components/ProductPicker';
import type { ItemType } from '@/types/db';
import { ProductFormDialog } from './ProductFormDialog';

export default function ProductsPage() {
  const { storeId, isAdmin } = useStore();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { data = [], isLoading, error, refetch } = useStockPosition(storeId);
  const { data: categories = [] } = useCategories(storeId);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [type, setType] = useState<ItemType | ''>('');
  const [status, setStatus] = useState<'active' | 'inactive' | 'all'>('active');
  const [critical, setCritical] = useState(false);
  const [formOpen, setFormOpen] = useState(false);

  useEffect(() => {
    if (params.get('novo') === '1' && isAdmin) { setFormOpen(true); params.delete('novo'); setParams(params, { replace: true }); }
  }, [params, setParams, isAdmin]);

  const rows = useMemo(() => data.filter((p) =>
    matchesProduct(p, q)
    && (!cat || p.category_id === cat)
    && (!type || p.item_type === type)
    && (status === 'all' || (status === 'active' ? p.active : !p.active))
    && (!critical || p.stock_status === 'low' || p.stock_status === 'out')), [data, q, cat, type, status, critical]);
  const { slice, page, pages, setPage, total } = usePagination(rows);

  function exportCsv() {
    downloadCSV('produtos', rows, [
      { header: 'SKU', value: (r) => r.sku }, { header: 'Código de barras', value: (r) => r.barcode },
      { header: 'Nome', value: (r) => r.name }, { header: 'Categoria', value: (r) => r.category_name },
      { header: 'Tipo', value: (r) => ITEM_TYPE_LABEL[r.item_type] }, { header: 'Unidade', value: (r) => r.unit_code },
      { header: 'Saldo', value: (r) => r.quantity }, { header: 'Mínimo', value: (r) => r.min_stock },
      { header: 'Custo unitário', value: (r) => r.unit_cost }, { header: 'Preço de venda', value: (r) => r.sale_price },
      { header: 'Valor em estoque', value: (r) => r.stock_value }, { header: 'Ativo', value: (r) => (r.active ? 'Sim' : 'Não') },
    ]);
  }

  return (
    <>
      <PageHeader
        title="Produtos e insumos"
        description="Cadastro de produtos, ingredientes, embalagens e materiais."
        actions={
          <>
            <Button variant="secondary" onClick={exportCsv} disabled={!rows.length}><Download className="h-4 w-4" />CSV</Button>
            {isAdmin && <Button onClick={() => setFormOpen(true)}><Plus className="h-4 w-4" />Adicionar produto</Button>}
          </>
        }
      />

      <Card>
        <div className="grid gap-2 border-b border-line p-4 sm:grid-cols-2 lg:grid-cols-[1fr_180px_200px_140px_auto]">
          <SearchInput placeholder="Buscar por nome, SKU ou código de barras" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar produtos" />
          <Select value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Categoria">
            <option value="">Todas as categorias</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
          <Select value={type} onChange={(e) => setType(e.target.value as ItemType | '')} aria-label="Tipo">
            <option value="">Todos os tipos</option>
            {Object.entries(ITEM_TYPE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </Select>
          <Select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} aria-label="Situação">
            <option value="active">Ativos</option><option value="inactive">Inativos</option><option value="all">Todos</option>
          </Select>
          <label className="flex h-10 items-center gap-2 whitespace-nowrap rounded-xl border border-line px-3 text-sm">
            <input type="checkbox" checked={critical} onChange={(e) => setCritical(e.target.checked)} className="h-4 w-4 accent-acai-700" />
            Estoque crítico
          </label>
        </div>

        {error ? <ErrorState error={error} onRetry={() => refetch()} /> : isLoading ? <Spinner /> : rows.length === 0 ? (
          data.length === 0 ? (
            <EmptyState icon={<Package className="h-7 w-7" />} title="Nenhum produto cadastrado"
              description="Comece cadastrando os itens que a loja usa e vende: polpa de açaí, complementos, copos, colheres, bebidas…"
              action={isAdmin ? <Button onClick={() => setFormOpen(true)}><Plus className="h-4 w-4" />Adicionar produto</Button> : undefined} />
          ) : <EmptyState title="Nenhum item encontrado" description="Ajuste a busca ou os filtros." />
        ) : (
          <>
            {/* Celular: cartões */}
            <ul className="divide-y divide-line md:hidden">
              {slice.map((p) => (
                <li key={p.id}>
                  <Link to={`/produtos/${p.id}`} className="flex items-center gap-3 px-4 py-3 active:bg-surface">
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{p.name}{p.is_demo && <Badge tone="warning" className="ml-1.5">DEMO</Badge>}</div>
                      <div className="text-[12.5px] text-ink-muted">{p.sku} · {p.category_name ?? 'Sem categoria'}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-semibold tabular">{p.stock_mode === 'recipe' ? '—' : formatQty(p.quantity, p.unit_code)}</div>
                      <StockBadge p={p} />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
            {/* Computador: tabela */}
            <div className="hidden md:block">
              <Table>
                <THead><tr>
                  <TH>Produto</TH><TH>Categoria</TH><TH>Tipo</TH><TH className="text-right">Saldo</TH><TH className="text-right">Mínimo</TH>
                  <TH className="text-right">Custo</TH><TH className="text-right">Preço</TH><TH>Situação</TH>
                </tr></THead>
                <TBody>
                  {slice.map((p) => (
                    <TR key={p.id} className="cursor-pointer" onClick={() => navigate(`/produtos/${p.id}`)}>
                      <TD>
                        <Link to={`/produtos/${p.id}`} className="font-medium hover:text-acai-700 focus-visible:underline" onClick={(e) => e.stopPropagation()}>{p.name}</Link>
                        {p.is_demo && <Badge tone="warning" className="ml-1.5">DEMO</Badge>}
                        <div className="text-[12px] text-ink-muted">{p.sku}{p.barcode ? ` · ${p.barcode}` : ''}</div>
                      </TD>
                      <TD className="text-ink-muted">{p.category_name ?? '—'}</TD>
                      <TD className="text-ink-muted">{ITEM_TYPE_LABEL[p.item_type]}</TD>
                      <TD className="text-right font-semibold tabular">{p.stock_mode === 'recipe' ? '—' : formatQty(p.quantity, p.unit_code)}</TD>
                      <TD className="text-right tabular text-ink-muted">{p.stock_mode === 'recipe' ? '—' : formatQty(p.min_stock)}</TD>
                      <TD className="text-right tabular">{formatCost(p.unit_cost)}</TD>
                      <TD className="text-right tabular">{formatBRL(p.sale_price)}</TD>
                      <TD><StockBadge p={p} /></TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
            <Pagination page={page} pages={pages} total={total} onPage={setPage} label="itens" />
          </>
        )}
      </Card>

      <ProductFormDialog open={formOpen} onOpenChange={setFormOpen} onSaved={(id) => navigate(`/produtos/${id}`)} />
    </>
  );
}
