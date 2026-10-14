import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { ArrowLeft, Ban } from 'lucide-react';
import { useStore } from '@/contexts/AuthContext';
import { useRpc, useSale } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { PAYMENT_LABEL, SALE_STATUS_LABEL } from '@/lib/labels';
import { formatBRL, formatDateTime, formatQty } from '@/lib/format';
import { grossMargin } from '@/lib/money';
import { newRequestId } from '@/lib/utils';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ui/confirm';
import { ErrorState, Spinner } from '@/components/ui/misc';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';

export default function SaleDetailPage() {
  const { id } = useParams();
  const { storeId, isAdmin } = useStore();
  const { data, isLoading, error, refetch } = useSale(id);
  const cancel = useRpc<Record<string, unknown>>('cancel_sale');
  const [open, setOpen] = useState(false);

  if (isLoading) return <Spinner />;
  if (error || !data) return <Card><ErrorState error={error} onRetry={() => refetch()} /></Card>;
  const { sale, items } = data;
  const margin = grossMargin(sale.total, sale.cost_total, sale.cost_complete);

  async function onCancel(reason: string) {
    try {
      await cancel.mutateAsync({ p_store: storeId, p_sale: sale.id, p_reason: reason, p_request_id: newRequestId() });
      toast.success('Venda cancelada', { description: 'O estoque foi devolvido por estorno.' });
      setOpen(false);
    } catch (e) { toast.error(errorMessage(e)); }
  }

  return (
    <>
      <Link to="/vendas" className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-ink-muted hover:text-acai-700"><ArrowLeft className="h-4 w-4" />Vendas</Link>
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-acai-950">Venda #{sale.number}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-muted">
            {formatDateTime(sale.sold_at)} · {sale.profiles?.full_name ?? '—'}
            <Badge tone={sale.status === 'confirmed' ? 'success' : 'neutral'}>{SALE_STATUS_LABEL[sale.status]}</Badge>
          </div>
        </div>
        {isAdmin && sale.status === 'confirmed' && <Button variant="secondary" onClick={() => setOpen(true)}><Ban className="h-4 w-4" />Cancelar venda</Button>}
      </div>

      {sale.status === 'cancelled' && (
        <p className="mb-4 rounded-xl bg-surface px-4 py-3 text-sm text-ink-muted">Cancelada em {formatDateTime(sale.cancelled_at)} — motivo: {sale.cancel_reason}. O estoque foi devolvido por estorno.</p>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Itens" />
          <CardBody className="px-0 pb-0">
            <Table>
              <THead><tr><TH>Produto</TH><TH className="text-right">Qtd.</TH><TH className="text-right">Preço</TH><TH className="text-right">Desc.</TH><TH className="text-right">Total</TH></tr></THead>
              <TBody>
                {items.map((i) => (
                  <TR key={i.id}>
                    <TD className="font-medium">{i.products?.name}</TD>
                    <TD className="text-right tabular">{formatQty(i.quantity, i.products?.units.code)}</TD>
                    <TD className="text-right tabular">{formatBRL(i.unit_price)}</TD>
                    <TD className="text-right tabular text-ink-muted">{i.discount > 0 ? formatBRL(i.discount) : '—'}</TD>
                    <TD className="text-right font-semibold tabular">{formatBRL(i.total)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Resumo" />
          <CardBody>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-ink-muted">Subtotal</dt><dd className="tabular">{formatBRL(sale.subtotal)}</dd></div>
              <div className="flex justify-between"><dt className="text-ink-muted">Desconto</dt><dd className="tabular">{formatBRL(sale.discount)}</dd></div>
              <div className="flex justify-between border-t border-line pt-2 text-base font-bold"><dt>Total</dt><dd className="tabular">{formatBRL(sale.total)}</dd></div>
              <div className="flex justify-between"><dt className="text-ink-muted">Pagamento</dt><dd>{sale.payment_method ? PAYMENT_LABEL[sale.payment_method] : '—'}</dd></div>
              <div className="flex justify-between"><dt className="text-ink-muted">Custo dos produtos</dt><dd className="tabular">{sale.cost_complete ? formatBRL(sale.cost_total) : 'incompleto'}</dd></div>
              <div className="flex justify-between"><dt className="text-ink-muted">Margem bruta est.</dt><dd className="tabular">{margin ? `${formatBRL(margin.value)} (${margin.pct}%)` : '—'}</dd></div>
            </dl>
            {sale.notes && <p className="mt-4 rounded-xl bg-surface p-3 text-sm text-ink-muted">{sale.notes}</p>}
          </CardBody>
        </Card>
      </div>

      <ConfirmDialog open={open} onOpenChange={setOpen} requireReason title={`Cancelar venda #${sale.number}?`}
        message="Os itens voltarão ao estoque por meio de estornos rastreáveis. A venda continua no histórico como cancelada."
        confirmLabel="Cancelar venda" loading={cancel.isPending} onConfirm={onCancel} />
    </>
  );
}
