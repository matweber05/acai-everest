import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Download, Plus, ShoppingCart } from 'lucide-react';
import { useStore } from '@/contexts/AuthContext';
import { usePurchases, useSuppliers } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/errors';
import { PURCHASE_STATUS_LABEL } from '@/lib/labels';
import { formatBRL, formatDate } from '@/lib/format';
import { downloadCSV } from '@/lib/csv';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input, Select } from '@/components/ui/form';
import { EmptyState, ErrorState, PageHeader, Spinner } from '@/components/ui/misc';
import { Pagination, Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import type { Purchase, PurchaseStatus } from '@/types/db';

const TONE = { draft: 'warning', received: 'success', cancelled: 'neutral' } as const;

export default function PurchasesPage() {
  const { storeId } = useStore();
  const navigate = useNavigate();
  const { data: suppliers = [] } = useSuppliers(storeId);
  const [params] = useSearchParams();
  const [f, setF] = useState<{ status?: PurchaseStatus | ''; supplierId?: string; from?: string; to?: string }>({ supplierId: params.get('fornecedor') ?? undefined });
  const [page, setPage] = useState(1);
  const { data, isLoading, error, refetch } = usePurchases(storeId, f, page);
  const upd = (patch: Partial<typeof f>) => { setF({ ...f, ...patch }); setPage(1); };

  async function exportCsv() {
    try {
      let q = supabase.from('purchases').select('*, suppliers(name)').eq('store_id', storeId);
      if (f.status) q = q.eq('status', f.status);
      if (f.supplierId) q = q.eq('supplier_id', f.supplierId);
      if (f.from) q = q.gte('purchase_date', f.from);
      if (f.to) q = q.lte('purchase_date', f.to);
      const { data: rows, error } = await q.order('purchase_date', { ascending: false }).limit(10000);
      if (error) throw error;
      downloadCSV('compras', (rows ?? []) as Purchase[], [
        { header: 'Número', value: (r) => r.number }, { header: 'Data', value: (r) => formatDate(r.purchase_date) },
        { header: 'Recebimento', value: (r) => (r.received_date ? formatDate(r.received_date) : '') }, { header: 'Fornecedor', value: (r) => r.suppliers?.name },
        { header: 'Documento', value: (r) => r.document_number }, { header: 'Situação', value: (r) => PURCHASE_STATUS_LABEL[r.status] },
        { header: 'Produtos', value: (r) => r.subtotal }, { header: 'Desconto', value: (r) => r.discount }, { header: 'Frete', value: (r) => r.freight }, { header: 'Total', value: (r) => r.total },
      ]);
    } catch (e) { toast.error(errorMessage(e)); }
  }

  return (
    <>
      <PageHeader title="Compras" description="Registre compras como rascunho e confirme o recebimento para dar entrada no estoque."
        actions={<>
          <Button variant="secondary" onClick={exportCsv}><Download className="h-4 w-4" />CSV</Button>
          <Button onClick={() => navigate('/compras/nova')}><Plus className="h-4 w-4" />Nova compra</Button>
        </>} />
      <Card>
        <div className="grid gap-2 border-b border-line p-4 sm:grid-cols-4">
          <Select value={f.supplierId ?? ''} onChange={(e) => upd({ supplierId: e.target.value || undefined })} aria-label="Fornecedor">
            <option value="">Todos os fornecedores</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
          <Select value={f.status ?? ''} onChange={(e) => upd({ status: e.target.value as PurchaseStatus | '' })} aria-label="Situação">
            <option value="">Todas as situações</option>
            {Object.entries(PURCHASE_STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </Select>
          <Input type="date" aria-label="De" value={f.from ?? ''} onChange={(e) => upd({ from: e.target.value || undefined })} />
          <Input type="date" aria-label="Até" value={f.to ?? ''} onChange={(e) => upd({ to: e.target.value || undefined })} />
        </div>
        {error ? <ErrorState error={error} onRetry={() => refetch()} /> : isLoading ? <Spinner /> : !data?.rows.length ? (
          <EmptyState icon={<ShoppingCart className="h-7 w-7" />} title="Nenhuma compra encontrada" description="Registre a próxima compra de mercadorias." action={<Button onClick={() => navigate('/compras/nova')}><Plus className="h-4 w-4" />Nova compra</Button>} />
        ) : (
          <>
            <Table>
              <THead><tr><TH>Nº</TH><TH>Data</TH><TH>Fornecedor</TH><TH className="hidden md:table-cell">Documento</TH><TH>Situação</TH><TH className="text-right">Total</TH></tr></THead>
              <TBody>
                {data.rows.map((p) => (
                  <TR key={p.id} className="cursor-pointer" onClick={() => navigate(`/compras/${p.id}`)}>
                    <TD><Link to={`/compras/${p.id}`} className="font-semibold hover:text-acai-700" onClick={(e) => e.stopPropagation()}>#{p.number}</Link></TD>
                    <TD>{formatDate(p.purchase_date)}</TD>
                    <TD>{p.suppliers?.name ?? '—'}</TD>
                    <TD className="hidden text-ink-muted md:table-cell">{p.document_number ?? '—'}</TD>
                    <TD><Badge tone={TONE[p.status]}>{PURCHASE_STATUS_LABEL[p.status]}</Badge></TD>
                    <TD className="text-right font-semibold tabular">{formatBRL(p.total)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <Pagination page={page} pages={data.pages} total={data.total} onPage={setPage} label="compras" />
          </>
        )}
      </Card>
    </>
  );
}
