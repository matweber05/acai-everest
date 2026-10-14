import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
import { useStore } from '@/contexts/AuthContext';
import { usePurchase, useRpc, useStockPosition, useSuppliers } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { formatBRL, parseDecimal, todayISO } from '@/lib/format';
import { documentTotals, lineTotal } from '@/lib/money';
import { numToInput } from '@/lib/validation';
import { newRequestId } from '@/lib/utils';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Field, Input, Label, Select, Textarea } from '@/components/ui/form';
import { PageHeader, Spinner } from '@/components/ui/misc';
import { ProductPicker } from '@/components/ProductPicker';

interface Line { key: string; product_id: string | null; quantity: string; unit_cost: string; discount: string; lot_code: string; expiry_date: string }
const emptyLine = (): Line => ({ key: newRequestId(), product_id: null, quantity: '', unit_cost: '', discount: '', lot_code: '', expiry_date: '' });

/** Cria/edita uma compra em RASCUNHO. O estoque só muda ao confirmar o recebimento. */
export default function PurchaseFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { storeId } = useStore();
  const { data: existing, isLoading } = usePurchase(id);
  const { data: products = [] } = useStockPosition(storeId);
  const { data: suppliers = [] } = useSuppliers(storeId);
  const save = useRpc<Record<string, unknown>, { purchase_id: string }>('save_purchase');
  const [requestId, setRequestId] = useState(newRequestId());
  const [supplier, setSupplier] = useState('');
  const [date, setDate] = useState(todayISO());
  const [doc, setDoc] = useState('');
  const [discount, setDiscount] = useState('');
  const [freight, setFreight] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [submitted, setSubmitted] = useState(false);

  const buyable = useMemo(() => products.filter((p) => p.stock_mode === 'stock' && p.active), [products]);
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  useEffect(() => {
    if (!existing) return;
    const p = existing.purchase;
    if (p.status !== 'draft') { navigate(`/compras/${p.id}`, { replace: true }); return; }
    setSupplier(p.supplier_id ?? ''); setDate(p.purchase_date); setDoc(p.document_number ?? '');
    setDiscount(p.discount ? numToInput(p.discount, 2) : ''); setFreight(p.freight ? numToInput(p.freight, 2) : ''); setNotes(p.notes ?? '');
    setLines(existing.items.map((i) => ({
      key: i.id, product_id: i.product_id, quantity: numToInput(i.quantity, 3), unit_cost: numToInput(i.unit_cost),
      discount: i.discount ? numToInput(i.discount, 2) : '', lot_code: i.lot_code ?? '', expiry_date: i.expiry_date ?? '',
    })));
  }, [existing, navigate]);

  function patch(key: string, v: Partial<Line>) { setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...v } : l))); }

  const parsed = lines.map((l) => ({ ...l, q: parseDecimal(l.quantity), c: parseDecimal(l.unit_cost), d: parseDecimal(l.discount || '0') }));
  const errors = parsed.map((l) => {
    if (!l.product_id) return 'Escolha o produto';
    if (!(l.q > 0)) return 'Quantidade inválida';
    const prod = byId.get(l.product_id);
    if (prod && !prod.allows_decimal && !Number.isInteger(l.q)) return `"${prod.unit_code}" não aceita fração`;
    if (Number.isNaN(l.c) || l.c < 0) return 'Custo inválido';
    if (Number.isNaN(l.d) || l.d < 0 || lineTotal(l.q, l.c, l.d) < 0) return 'Desconto inválido';
    return null;
  });
  const disc = parseDecimal(discount || '0');
  const fr = parseDecimal(freight || '0');
  const totals = documentTotals(parsed.map((l) => ({ quantity: l.q || 0, unit: l.c || 0, discount: l.d || 0 })), disc || 0, fr || 0);
  const headerError = Number.isNaN(disc) || disc < 0 ? 'Desconto inválido' : disc > totals.subtotal ? 'Desconto maior que o subtotal' : Number.isNaN(fr) || fr < 0 ? 'Frete inválido' : null;
  const dup = new Set<string>();
  const hasDup = parsed.some((l) => l.product_id && (dup.has(l.product_id + l.lot_code) || !dup.add(l.product_id + l.lot_code)));

  async function onSave() {
    setSubmitted(true);
    if (errors.some(Boolean) || headerError) return toast.error('Revise os campos destacados.');
    try {
      const r = await save.mutateAsync({
        p_store: storeId, p_purchase: id ?? null, p_request_id: requestId,
        p_data: {
          supplier_id: supplier || null, purchase_date: date, document_number: doc, discount: disc || 0, freight: fr || 0, notes,
          items: parsed.map((l) => ({ product_id: l.product_id, quantity: l.q, unit_cost: l.c, discount: l.d || 0, lot_code: l.lot_code || null, expiry_date: l.expiry_date || null })),
        },
      });
      toast.success('Rascunho de compra salvo', { description: 'Confira os valores e confirme o recebimento para dar entrada no estoque.' });
      navigate(`/compras/${r.purchase_id}`, { replace: true });
    } catch (e) { toast.error(errorMessage(e)); setRequestId(newRequestId()); }
  }

  if (id && isLoading) return <Spinner />;

  return (
    <>
      <Link to="/compras" className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-ink-muted hover:text-acai-700"><ArrowLeft className="h-4 w-4" />Compras</Link>
      <PageHeader title={id ? `Editar compra #${existing?.purchase.number ?? ''}` : 'Nova compra'} description="1. Preencha  2. Salve como rascunho  3. Revise  4. Confirme o recebimento" />
      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <div className="space-y-5">
          <Card>
            <CardHeader title="Dados da compra" />
            <CardBody className="grid gap-3 sm:grid-cols-3">
              <Field label="Fornecedor" className="sm:col-span-3">
                {(a) => (
                  <Select {...a} value={supplier} onChange={(e) => setSupplier(e.target.value)}>
                    <option value="">Sem fornecedor</option>
                    {suppliers.filter((s) => s.active || s.id === supplier).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </Select>
                )}
              </Field>
              <Field label="Data da compra" required>{(a) => <Input {...a} type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} />}</Field>
              <Field label="Nº do documento / NF" className="sm:col-span-2">{(a) => <Input {...a} value={doc} onChange={(e) => setDoc(e.target.value)} placeholder="Opcional" />}</Field>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Produtos" description="Custo unitário = valor pago por unidade, antes do rateio de frete e desconto geral." />
            <CardBody className="space-y-3">
              {parsed.map((l, i) => {
                const prod = l.product_id ? byId.get(l.product_id) : undefined;
                const err = submitted ? errors[i] : null;
                return (
                  <div key={l.key} className={`rounded-xl border p-3 ${err ? 'border-red-300' : 'border-line'}`}>
                    <div className="flex items-start gap-2">
                      <div className="flex-1">
                        <Label htmlFor={`pi-${l.key}`}>Item {i + 1}</Label>
                        <ProductPicker id={`pi-${l.key}`} products={buyable} value={l.product_id} onChange={(pid, p) => patch(l.key, { product_id: pid, unit_cost: l.unit_cost || (p ? numToInput(p.unit_cost) : '') })} />
                      </div>
                      <Button variant="ghost" size="icon" className="mt-6" aria-label="Remover item" disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-2">
                      <label className="text-[12px] text-ink-muted">Qtd. {prod ? `(${prod.unit_code})` : ''}<Input className="h-9" inputMode="decimal" value={l.quantity} onChange={(e) => patch(l.key, { quantity: e.target.value })} /></label>
                      <label className="text-[12px] text-ink-muted">Custo un. (R$)<Input className="h-9" inputMode="decimal" value={l.unit_cost} onChange={(e) => patch(l.key, { unit_cost: e.target.value })} /></label>
                      <label className="text-[12px] text-ink-muted">Desconto (R$)<Input className="h-9" inputMode="decimal" placeholder="0,00" value={l.discount} onChange={(e) => patch(l.key, { discount: e.target.value })} /></label>
                    </div>
                    {prod && (prod.track_lots || prod.track_expiry) && (
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <label className="text-[12px] text-ink-muted">Lote<Input className="h-9" value={l.lot_code} onChange={(e) => patch(l.key, { lot_code: e.target.value })} placeholder="Opcional" /></label>
                        <label className="text-[12px] text-ink-muted">Validade {prod.track_expiry && <span className="text-red-500">*</span>}<Input className="h-9" type="date" value={l.expiry_date} onChange={(e) => patch(l.key, { expiry_date: e.target.value })} /></label>
                      </div>
                    )}
                    <div className="mt-1.5 flex justify-between text-[12.5px]">
                      <span className="text-red-600">{err ?? (prod?.track_expiry && !l.expiry_date ? <span className="text-mango-700">Validade obrigatória para receber</span> : '')}</span>
                      <span className="font-semibold tabular">{formatBRL(errors[i] ? 0 : lineTotal(l.q, l.c, l.d || 0))}</span>
                    </div>
                  </div>
                );
              })}
              <Button variant="secondary" size="sm" onClick={() => setLines((ls) => [...ls, emptyLine()])}><Plus className="h-4 w-4" />Adicionar produto</Button>
              {hasDup && <p className="text-[12.5px] text-mango-700">Há produtos repetidos com o mesmo lote. Verifique se não é duplicidade.</p>}
            </CardBody>
          </Card>
        </div>

        <Card className="h-fit lg:sticky lg:top-20">
          <CardHeader title="Valores" />
          <CardBody className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Desconto geral (R$)">{(a) => <Input {...a} inputMode="decimal" placeholder="0,00" value={discount} onChange={(e) => setDiscount(e.target.value)} />}</Field>
              <Field label="Frete (R$)">{(a) => <Input {...a} inputMode="decimal" placeholder="0,00" value={freight} onChange={(e) => setFreight(e.target.value)} />}</Field>
            </div>
            {headerError && <p className="text-[12.5px] text-red-600">{headerError}</p>}
            <Field label="Observações">{(a) => <Textarea {...a} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>
            <dl className="space-y-1 border-t border-line pt-3 text-sm">
              <div className="flex justify-between text-ink-muted"><dt>Produtos</dt><dd className="tabular">{formatBRL(totals.subtotal)}</dd></div>
              <div className="flex justify-between text-ink-muted"><dt>Desconto</dt><dd className="tabular">− {formatBRL(disc || 0)}</dd></div>
              <div className="flex justify-between text-ink-muted"><dt>Frete</dt><dd className="tabular">+ {formatBRL(fr || 0)}</dd></div>
              <div className="flex justify-between text-lg font-bold"><dt>Total</dt><dd className="tabular text-acai-900">{formatBRL(totals.total)}</dd></div>
            </dl>
            <Button size="lg" className="w-full" loading={save.isPending} onClick={onSave}>Salvar rascunho</Button>
            <p className="text-[12px] text-ink-muted">O rascunho não altera o estoque.</p>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
