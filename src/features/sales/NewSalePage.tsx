import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { ArrowLeft, Minus, Plus, ShoppingBag, Trash2 } from 'lucide-react';
import { useStore } from '@/contexts/AuthContext';
import { useRpc, useStockPosition } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { PAYMENT_LABEL } from '@/lib/labels';
import { formatBRL, formatQty, parseDecimal } from '@/lib/format';
import { documentTotals, lineTotal } from '@/lib/money';
import { numToInput } from '@/lib/validation';
import { newRequestId, cn } from '@/lib/utils';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { EmptyState, PageHeader, SearchInput } from '@/components/ui/misc';
import { matchesProduct } from '@/components/ProductPicker';
import type { PaymentMethod, StockPosition } from '@/types/db';

interface CartLine { product: StockPosition; qty: string; price: string; discount: string }

export default function NewSalePage() {
  const { storeId } = useStore();
  const navigate = useNavigate();
  const { data: products = [] } = useStockPosition(storeId);
  const create = useRpc<Record<string, unknown>, { sale_id: string; number: number; total: number }>('create_sale');
  const [requestId, setRequestId] = useState(newRequestId());
  const [q, setQ] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [discount, setDiscount] = useState('');
  const [payment, setPayment] = useState<PaymentMethod | ''>('pix');
  const [notes, setNotes] = useState('');

  const sellable = useMemo(() => products.filter((p) => p.active && (p.sale_price != null || p.item_type === 'finished' || p.item_type === 'resale')), [products]);
  const results = useMemo(() => (q ? products.filter((p) => p.active && matchesProduct(p, q)) : sellable).slice(0, 24), [q, products, sellable]);

  function add(p: StockPosition) {
    setCart((c) => {
      const i = c.findIndex((l) => l.product.id === p.id);
      if (i >= 0) return c.map((l, j) => (j === i ? { ...l, qty: numToInput(parseDecimal(l.qty) + 1, 3) } : l));
      return [...c, { product: p, qty: '1', price: numToInput(p.sale_price ?? 0, 2), discount: '' }];
    });
    setQ('');
  }
  function patch(id: string, v: Partial<CartLine>) { setCart((c) => c.map((l) => (l.product.id === id ? { ...l, ...v } : l))); }

  const lines = cart.map((l) => ({ ...l, q: parseDecimal(l.qty), p: parseDecimal(l.price), d: parseDecimal(l.discount || '0') }));
  const lineErrors = lines.map((l) => {
    if (!(l.q > 0)) return 'Quantidade inválida';
    if (!l.product.allows_decimal && !Number.isInteger(l.q)) return `"${l.product.unit_code}" não aceita fração`;
    if (Number.isNaN(l.p) || l.p < 0) return 'Preço inválido';
    if (Number.isNaN(l.d) || l.d < 0) return 'Desconto inválido';
    if (lineTotal(l.q, l.p, l.d) < 0) return 'Desconto maior que o item';
    return null;
  });
  const disc = parseDecimal(discount || '0');
  const totals = documentTotals(lines.map((l) => ({ quantity: l.q || 0, unit: l.p || 0, discount: l.d || 0 })), Number.isNaN(disc) ? 0 : disc);
  const discError = Number.isNaN(disc) || disc < 0 ? 'Desconto inválido' : disc > totals.subtotal ? 'Maior que o subtotal' : null;
  const canSubmit = cart.length > 0 && lineErrors.every((e) => !e) && !discError;

  async function submit() {
    try {
      const r = await create.mutateAsync({
        p_store: storeId, p_request_id: requestId,
        p_data: {
          payment_method: payment || null, discount: disc || 0, notes: notes || null,
          items: lines.map((l) => ({ product_id: l.product.id, quantity: l.q, unit_price: l.p, discount: l.d || 0 })),
        },
      });
      toast.success(`Venda #${r.number} registrada`, { description: `Total ${formatBRL(r.total)}. Estoque atualizado.` });
      navigate(`/vendas/${r.sale_id}`, { replace: true });
    } catch (e) {
      toast.error(errorMessage(e));
      setRequestId(newRequestId());
    }
  }

  return (
    <>
      <Link to="/vendas" className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-ink-muted hover:text-acai-700"><ArrowLeft className="h-4 w-4" />Vendas</Link>
      <PageHeader title="Lançar venda" description="Toque nos produtos para adicionar. O estoque é baixado ao confirmar." />
      <div className="grid gap-5 lg:grid-cols-[1fr_400px]">
        <Card>
          <div className="border-b border-line p-4">
            <SearchInput placeholder="Buscar produto (nome, SKU ou código de barras)" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar produto"
              onKeyDown={(e) => { if (e.key === 'Enter') { const ex = products.find((p) => p.active && (p.barcode === q.trim() || p.sku.toLowerCase() === q.trim().toLowerCase())); if (ex) { e.preventDefault(); add(ex); } else if (results[0]) { e.preventDefault(); add(results[0]); } } }} />
          </div>
          {results.length === 0 ? (
            <EmptyState icon={<ShoppingBag className="h-7 w-7" />} title={q ? 'Nenhum produto encontrado' : 'Nenhum produto à venda'}
              description={q ? undefined : 'Cadastre produtos com preço de venda (tipo “Produto acabado” ou “Revenda”).'} />
          ) : (
            <div className="grid grid-cols-2 gap-2 p-4 sm:grid-cols-3 xl:grid-cols-4">
              {results.map((p) => (
                <button key={p.id} onClick={() => add(p)}
                  className="flex min-h-[84px] flex-col justify-between rounded-xl border border-line bg-white p-3 text-left transition-colors hover:border-acai-300 hover:bg-acai-50/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acai-400 active:bg-acai-50">
                  <span className="line-clamp-2 text-[13.5px] font-medium leading-snug">{p.name}</span>
                  <span className="mt-1 flex items-end justify-between gap-1">
                    <span className="font-semibold text-acai-800">{p.sale_price != null ? formatBRL(p.sale_price) : 'sem preço'}</span>
                    {p.stock_mode === 'stock' && <span className={cn('text-[11.5px] tabular', p.quantity <= 0 ? 'text-red-600' : 'text-ink-muted')}>{formatQty(p.quantity, p.unit_code)}</span>}
                  </span>
                </button>
              ))}
            </div>
          )}
        </Card>

        <Card className="h-fit lg:sticky lg:top-20">
          <CardHeader title="Itens da venda" description={cart.length ? `${cart.length} item(ns)` : undefined} />
          <CardBody className="space-y-3">
            {cart.length === 0 ? <p className="rounded-xl bg-surface p-4 text-center text-sm text-ink-muted">Nenhum item adicionado.</p> : (
              <ul className="space-y-2">
                {lines.map((l, i) => {
                  const over = l.product.stock_mode === 'stock' && l.q > Number(l.product.quantity);
                  return (
                    <li key={l.product.id} className="rounded-xl border border-line p-3">
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-sm font-medium">{l.product.name}</span>
                        <button className="rounded p-1 text-ink-soft hover:text-red-600" aria-label={`Remover ${l.product.name}`} onClick={() => setCart((c) => c.filter((x) => x.product.id !== l.product.id))}><Trash2 className="h-4 w-4" /></button>
                      </div>
                      <div className="mt-2 grid grid-cols-[auto_1fr_1fr] items-end gap-2">
                        <div className="flex items-center rounded-xl border border-line">
                          <button className="p-2 text-ink-muted" aria-label="Diminuir" onClick={() => patch(l.product.id, { qty: numToInput(Math.max((l.q || 1) - 1, 1), 3) })}><Minus className="h-4 w-4" /></button>
                          <input aria-label="Quantidade" className="w-12 bg-transparent text-center text-sm font-semibold tabular focus:outline-none" inputMode="decimal" value={l.qty} onChange={(e) => patch(l.product.id, { qty: e.target.value })} />
                          <button className="p-2 text-ink-muted" aria-label="Aumentar" onClick={() => patch(l.product.id, { qty: numToInput((l.q || 0) + 1, 3) })}><Plus className="h-4 w-4" /></button>
                        </div>
                        <label className="text-[11.5px] text-ink-muted">Preço un.
                          <Input className="h-9" inputMode="decimal" value={l.price} onChange={(e) => patch(l.product.id, { price: e.target.value })} />
                        </label>
                        <label className="text-[11.5px] text-ink-muted">Desconto
                          <Input className="h-9" inputMode="decimal" placeholder="0,00" value={l.discount} onChange={(e) => patch(l.product.id, { discount: e.target.value })} />
                        </label>
                      </div>
                      <div className="mt-1.5 flex justify-between text-[12.5px]">
                        <span className={lineErrors[i] || over ? 'text-red-600' : 'text-ink-muted'}>
                          {lineErrors[i] ?? (over ? `Só há ${formatQty(l.product.quantity, l.product.unit_code)} em estoque` : '')}
                        </span>
                        <span className="font-semibold tabular">{formatBRL(lineErrors[i] ? 0 : lineTotal(l.q, l.p, l.d || 0))}</span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Desconto geral (R$)" error={discError ?? undefined}>
                {(a) => <Input {...a} inputMode="decimal" placeholder="0,00" value={discount} onChange={(e) => setDiscount(e.target.value)} />}
              </Field>
              <Field label="Pagamento">
                {(a) => (
                  <Select {...a} value={payment} onChange={(e) => setPayment(e.target.value as PaymentMethod | '')}>
                    <option value="">Não informado</option>
                    {Object.entries(PAYMENT_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </Select>
                )}
              </Field>
            </div>
            <Field label="Observações">{(a) => <Textarea {...a} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Opcional" />}</Field>
            <dl className="space-y-1 border-t border-line pt-3 text-sm">
              <div className="flex justify-between text-ink-muted"><dt>Subtotal</dt><dd className="tabular">{formatBRL(totals.subtotal)}</dd></div>
              {disc > 0 && !discError && <div className="flex justify-between text-ink-muted"><dt>Desconto</dt><dd className="tabular">− {formatBRL(disc)}</dd></div>}
              <div className="flex justify-between text-lg font-bold"><dt>Total</dt><dd className="tabular text-acai-900">{formatBRL(discError ? totals.subtotal : totals.total)}</dd></div>
            </dl>
            <Button size="lg" variant="success" className="w-full" disabled={!canSubmit} loading={create.isPending} onClick={submit}>Confirmar venda</Button>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
