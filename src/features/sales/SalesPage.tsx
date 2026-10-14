import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Download, Plus, ReceiptText } from 'lucide-react';
import { useStore } from '@/contexts/AuthContext';
import { useSales } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/errors';
import { PAYMENT_LABEL, SALE_STATUS_LABEL } from '@/lib/labels';
import { formatBRL, formatDateTime } from '@/lib/format';
import { downloadCSV } from '@/lib/csv';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input, Select } from '@/components/ui/form';
import { EmptyState, ErrorState, PageHeader, Spinner } from '@/components/ui/misc';
import { Pagination, Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import type { Sale, SaleStatus } from '@/types/db';

export default function SalesPage() {
  const { storeId } = useStore();
  const navigate = useNavigate();
  const [f, setF] = useState<{ from?: string; to?: string; status?: SaleStatus | '' }>({});
  const [page, setPage] = useState(1);
  const { data, isLoading, error, refetch } = useSales(storeId, f, page);
  const [exporting, setExporting] = useState(false);

  async function exportCsv() {
    setExporting(true);
    try {
      let q = supabase.from('sales').select('*, profiles:created_by(full_name)').eq('store_id', storeId);
      if (f.status) q = q.eq('status', f.status);
      if (f.from) q = q.gte('sold_at', `${f.from}T00:00:00-03:00`);
      if (f.to) q = q.lt('sold_at', new Date(new Date(`${f.to}T00:00:00-03:00`).getTime() + 86_400_000).toISOString());
      const { data: rows, error } = await q.order('sold_at', { ascending: false }).limit(10000);
      if (error) throw error;
      downloadCSV('vendas', (rows ?? []) as Sale[], [
        { header: 'Número', value: (r) => r.number }, { header: 'Data/hora', value: (r) => formatDateTime(r.sold_at) },
        { header: 'Situação', value: (r) => SALE_STATUS_LABEL[r.status] }, { header: 'Subtotal', value: (r) => r.subtotal },
        { header: 'Desconto', value: (r) => r.discount }, { header: 'Total', value: (r) => r.total },
        { header: 'Custo (CMV)', value: (r) => r.cost_total }, { header: 'Pagamento', value: (r) => (r.payment_method ? PAYMENT_LABEL[r.payment_method] : '') },
        { header: 'Responsável', value: (r) => r.profiles?.full_name }, { header: 'Observações', value: (r) => r.notes },
      ]);
    } catch (e) { toast.error(errorMessage(e)); } finally { setExporting(false); }
  }

  return (
    <>
      <PageHeader title="Vendas" description="Vendas confirmadas baixam o estoque automaticamente."
        actions={<>
          <Button variant="secondary" onClick={exportCsv} loading={exporting}><Download className="h-4 w-4" />CSV</Button>
          <Button variant="accent" onClick={() => navigate('/vendas/nova')}><Plus className="h-4 w-4" />Lançar venda</Button>
        </>} />
      <Card>
        <div className="flex flex-col gap-2 border-b border-line p-4 sm:flex-row">
          <Input type="date" aria-label="De" value={f.from ?? ''} onChange={(e) => { setF({ ...f, from: e.target.value || undefined }); setPage(1); }} className="sm:w-44" />
          <Input type="date" aria-label="Até" value={f.to ?? ''} onChange={(e) => { setF({ ...f, to: e.target.value || undefined }); setPage(1); }} className="sm:w-44" />
          <Select value={f.status ?? ''} onChange={(e) => { setF({ ...f, status: e.target.value as SaleStatus | '' }); setPage(1); }} className="sm:w-48" aria-label="Situação">
            <option value="">Todas</option><option value="confirmed">Confirmadas</option><option value="cancelled">Canceladas</option>
          </Select>
        </div>
        {error ? <ErrorState error={error} onRetry={() => refetch()} /> : isLoading ? <Spinner /> : !data?.rows.length ? (
          <EmptyState icon={<ReceiptText className="h-7 w-7" />} title="Nenhuma venda encontrada" description="Use “Lançar venda” para registrar." />
        ) : (
          <>
            <Table>
              <THead><tr><TH>Nº</TH><TH>Data/hora</TH><TH className="hidden sm:table-cell">Pagamento</TH><TH className="hidden md:table-cell">Responsável</TH><TH>Situação</TH><TH className="text-right">Total</TH></tr></THead>
              <TBody>
                {data.rows.map((s) => (
                  <TR key={s.id} className="cursor-pointer" onClick={() => navigate(`/vendas/${s.id}`)}>
                    <TD><Link to={`/vendas/${s.id}`} className="font-semibold hover:text-acai-700" onClick={(e) => e.stopPropagation()}>#{s.number}</Link></TD>
                    <TD className="whitespace-nowrap">{formatDateTime(s.sold_at)}</TD>
                    <TD className="hidden text-ink-muted sm:table-cell">{s.payment_method ? PAYMENT_LABEL[s.payment_method] : '—'}</TD>
                    <TD className="hidden text-ink-muted md:table-cell">{s.profiles?.full_name ?? '—'}</TD>
                    <TD><Badge tone={s.status === 'confirmed' ? 'success' : 'neutral'}>{SALE_STATUS_LABEL[s.status]}</Badge></TD>
                    <TD className={`text-right font-semibold tabular ${s.status === 'cancelled' ? 'text-ink-soft line-through' : ''}`}>{formatBRL(s.total)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <Pagination page={page} pages={data.pages} total={data.total} onPage={setPage} label="vendas" />
          </>
        )}
      </Card>
    </>
  );
}
