import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { ArrowLeft, Ban, PackageCheck, Pencil } from 'lucide-react';
import { useStore } from '@/contexts/AuthContext';
import { usePurchase, useRpc } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { PURCHASE_STATUS_LABEL } from '@/lib/labels';
import { formatBRL, formatCost, formatDate, formatDateTime, formatQty, todayISO } from '@/lib/format';
import { landedUnitCost } from '@/lib/money';
import { newRequestId } from '@/lib/utils';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/form';
import { ConfirmDialog } from '@/components/ui/confirm';
import { ErrorState, Spinner } from '@/components/ui/misc';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';

const TONE = { draft: 'warning', received: 'success', cancelled: 'neutral' } as const;

export default function PurchaseDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { storeId, isAdmin } = useStore();
  const { data, isLoading, error, refetch } = usePurchase(id);
  const receive = useRpc<Record<string, unknown>>('receive_purchase');
  const cancel = useRpc<Record<string, unknown>>('cancel_purchase');
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [receivedDate, setReceivedDate] = useState(todayISO());
  const [reqId, setReqId] = useState(newRequestId());

  if (isLoading) return <Spinner />;
  if (error || !data) return <Card><ErrorState error={error} onRetry={() => refetch()} /></Card>;
  const { purchase: p, items } = data;
  const missingExpiry = items.filter((i) => i.products?.track_expiry && !i.expiry_date);

  async function onReceive() {
    try {
      await receive.mutateAsync({ p_store: storeId, p_purchase: p.id, p_received_date: receivedDate, p_request_id: reqId });
      toast.success('Recebimento confirmado', { description: `${items.length} item(ns) deram entrada no estoque.` });
      setReceiveOpen(false);
    } catch (e) { toast.error(errorMessage(e)); setReqId(newRequestId()); }
  }
  async function onCancel(reason: string) {
    try {
      await cancel.mutateAsync({ p_store: storeId, p_purchase: p.id, p_reason: reason, p_request_id: newRequestId() });
      toast.success('Compra cancelada');
      setCancelOpen(false);
    } catch (e) { toast.error(errorMessage(e)); }
  }

  return (
    <>
      <Link to="/compras" className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-ink-muted hover:text-acai-700"><ArrowLeft className="h-4 w-4" />Compras</Link>
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-acai-950">Compra #{p.number}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-muted">
            {p.suppliers?.name ?? 'Sem fornecedor'} · {formatDate(p.purchase_date)}{p.document_number ? ` · ${p.document_number}` : ''}
            <Badge tone={TONE[p.status]}>{PURCHASE_STATUS_LABEL[p.status]}</Badge>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {p.status === 'draft' && (
            <>
              <Button variant="secondary" onClick={() => navigate(`/compras/${p.id}/editar`)}><Pencil className="h-4 w-4" />Editar</Button>
              <Button variant="success" onClick={() => setReceiveOpen(true)}><PackageCheck className="h-4 w-4" />Confirmar recebimento</Button>
            </>
          )}
          {(p.status === 'draft' || (p.status === 'received' && isAdmin)) && (
            <Button variant="ghost" onClick={() => setCancelOpen(true)}><Ban className="h-4 w-4" />Cancelar</Button>
          )}
        </div>
      </div>

      {p.status === 'draft' && <p className="mb-4 rounded-xl bg-mango-50 px-4 py-3 text-sm text-mango-700">Rascunho: o estoque ainda NÃO foi alterado. Revise os valores e confirme o recebimento quando a mercadoria chegar.</p>}
      {p.status === 'received' && <p className="mb-4 rounded-xl bg-leaf-50 px-4 py-3 text-sm text-leaf-700">Recebida em {formatDate(p.received_date)} (registrado em {formatDateTime(p.received_at)}). As entradas de estoque foram geradas.</p>}
      {p.status === 'cancelled' && <p className="mb-4 rounded-xl bg-surface px-4 py-3 text-sm text-ink-muted">Cancelada — motivo: {p.cancel_reason}</p>}

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Itens" />
          <CardBody className="px-0 pb-0">
            <Table>
              <THead><tr><TH>Produto</TH><TH className="text-right">Qtd.</TH><TH className="text-right">Custo un.</TH><TH className="text-right">Total</TH><TH className="text-right">Custo final un.</TH><TH>Lote / validade</TH></tr></THead>
              <TBody>
                {items.map((i) => (
                  <TR key={i.id}>
                    <TD className="font-medium">{i.products?.name}</TD>
                    <TD className="text-right tabular">{formatQty(i.quantity, i.products?.units.code)}</TD>
                    <TD className="text-right tabular">{formatCost(i.unit_cost)}</TD>
                    <TD className="text-right tabular">{formatBRL(i.total)}</TD>
                    <TD className="text-right tabular" title="Com rateio de frete e desconto">{formatCost(i.landed_unit_cost ?? landedUnitCost(i.total, i.quantity, p.subtotal, p.freight, p.discount))}</TD>
                    <TD className="text-ink-muted">{i.lot_code ?? '—'}{i.expiry_date ? ` · ${formatDate(i.expiry_date)}` : i.products?.track_expiry ? <Badge tone="warning" className="ml-1">sem validade</Badge> : ''}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Valores" />
          <CardBody>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-ink-muted">Produtos</dt><dd className="tabular">{formatBRL(p.subtotal)}</dd></div>
              <div className="flex justify-between"><dt className="text-ink-muted">Desconto</dt><dd className="tabular">− {formatBRL(p.discount)}</dd></div>
              <div className="flex justify-between"><dt className="text-ink-muted">Frete</dt><dd className="tabular">+ {formatBRL(p.freight)}</dd></div>
              <div className="flex justify-between border-t border-line pt-2 text-base font-bold"><dt>Total</dt><dd className="tabular">{formatBRL(p.total)}</dd></div>
            </dl>
            {p.notes && <p className="mt-4 rounded-xl bg-surface p-3 text-sm text-ink-muted">{p.notes}</p>}
          </CardBody>
        </Card>
      </div>

      <Dialog open={receiveOpen} onOpenChange={(v) => !receive.isPending && setReceiveOpen(v)} title="Confirmar recebimento" size="sm"
        footer={<>
          <Button variant="secondary" onClick={() => setReceiveOpen(false)} disabled={receive.isPending}>Voltar</Button>
          <Button variant="success" onClick={onReceive} loading={receive.isPending} disabled={missingExpiry.length > 0}>Confirmar e dar entrada</Button>
        </>}>
        <div className="space-y-4 text-sm text-ink-muted">
          <p>Serão geradas <b className="text-ink">{items.length} entrada(s)</b> de estoque, no total de <b className="text-ink">{formatBRL(p.total)}</b>. O recebimento só pode ser feito uma vez.</p>
          {missingExpiry.length > 0 && <p className="rounded-xl bg-red-50 p-3 text-red-700">Informe a validade de: {missingExpiry.map((i) => i.products?.name).join(', ')}. Use “Editar”.</p>}
          <Field label="Data do recebimento" required>{(a) => <Input {...a} type="date" value={receivedDate} min={p.purchase_date} max={todayISO()} onChange={(e) => setReceivedDate(e.target.value)} />}</Field>
        </div>
      </Dialog>
      <ConfirmDialog open={cancelOpen} onOpenChange={setCancelOpen} requireReason title={`Cancelar compra #${p.number}?`}
        message={p.status === 'received' ? 'As entradas de estoque desta compra serão estornadas. Só é possível se os itens ainda estiverem em estoque.' : 'O rascunho ficará registrado como cancelado.'}
        confirmLabel="Cancelar compra" loading={cancel.isPending} onConfirm={onCancel} />
    </>
  );
}
