import { useEffect, useMemo, useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { ArrowDownToLine, ArrowUpFromLine } from 'lucide-react';
import { useStore } from '@/contexts/AuthContext';
import { useLots, useRpc, useStockPosition, useSuppliers } from '@/lib/api';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { Segmented } from '@/components/ui/misc';
import { ProductPicker } from '@/components/ProductPicker';
import { ENTRY_REASONS, EXIT_REASONS, REASON_LABEL } from '@/lib/labels';
import { formatCost, formatDate, formatQty, localInputToISO, nowLocalInput, parseDecimal } from '@/lib/format';
import { errorMessage } from '@/lib/errors';
import { newRequestId } from '@/lib/utils';
import { numToInput, zDecimal } from '@/lib/validation';
import type { Direction, MovementReason } from '@/types/db';

const schema = z.object({
  product_id: z.string({ required_error: 'Escolha um item' }).min(1, 'Escolha um item'),
  quantity: zDecimal({ positive: true }),
  reason: z.string().min(1, 'Escolha o motivo'),
  unit_cost: z.string().optional(),
  supplier_id: z.string().optional(),
  occurred_at: z.string().min(1, 'Informe a data'),
  document_ref: z.string().max(80).optional(),
  lot_code: z.string().max(40).optional(),
  expiry: z.string().optional(),
  lot_id: z.string().optional(),
  notes: z.string().max(500).optional(),
});
type FormValues = z.infer<typeof schema>;

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  direction: Direction;
  productId?: string;
}

/** Entrada ou saída de estoque em uma única tela (pensado para o celular). */
export function MovementDialog({ open, onOpenChange, direction: initialDirection, productId }: Props) {
  const { storeId, store } = useStore();
  const [direction, setDirection] = useState<Direction>(initialDirection);
  const [requestId, setRequestId] = useState(newRequestId());
  const { data: products = [] } = useStockPosition(storeId);
  const { data: suppliers = [] } = useSuppliers(storeId);
  const entry = useRpc<Record<string, unknown>, { balance_after: number }>('register_entry');
  const exit = useRpc<Record<string, unknown>, { balance_after: number }>('register_exit');
  const busy = entry.isPending || exit.isPending;

  const stockProducts = useMemo(() => products.filter((p) => p.active && p.stock_mode === 'stock'), [products]);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { product_id: '', quantity: '', reason: '', occurred_at: nowLocalInput(), notes: '' },
  });
  const { register, handleSubmit, control, watch, setValue, reset, formState: { errors } } = form;

  useEffect(() => {
    if (!open) return;
    setDirection(initialDirection);
    setRequestId(newRequestId());
    reset({
      product_id: productId ?? '', quantity: '', reason: initialDirection === 'in' ? 'manual_entry' : '',
      occurred_at: nowLocalInput(), notes: '', unit_cost: '', supplier_id: '', document_ref: '', lot_code: '', expiry: '', lot_id: '',
    });
  }, [open, initialDirection, productId, reset]);

  useEffect(() => { setValue('reason', direction === 'in' ? 'manual_entry' : ''); }, [direction, setValue]);

  const pid = watch('product_id');
  const product = stockProducts.find((p) => p.id === pid) ?? null;
  const { data: lots = [] } = useLots(storeId, { productId: pid || undefined });
  const qty = parseDecimal(watch('quantity') ?? '');
  const tracksLots = !!product && (product.track_lots || product.track_expiry);

  // ao escolher produto em uma entrada, sugere custo e fornecedor
  useEffect(() => {
    if (product && direction === 'in') {
      setValue('unit_cost', numToInput(product.unit_cost));
      setValue('supplier_id', product.default_supplier_id ?? '');
    }
  }, [product?.id, direction]); // eslint-disable-line react-hooks/exhaustive-deps

  async function onSubmit(v: FormValues) {
    if (!product) return;
    if (!product.allows_decimal && !Number.isInteger(parseDecimal(v.quantity))) {
      form.setError('quantity', { message: `A unidade "${product.unit_code}" não aceita frações` });
      return;
    }
    try {
      let res: { balance_after: number };
      if (direction === 'in') {
        const cost = parseDecimal(v.unit_cost ?? '');
        if (Number.isNaN(cost) || cost < 0) { form.setError('unit_cost', { message: 'Informe o custo (pode ser 0)' }); return; }
        if (product.track_expiry && !v.expiry) { form.setError('expiry', { message: 'Este item exige validade' }); return; }
        res = await entry.mutateAsync({
          p_store: storeId, p_product: product.id, p_quantity: parseDecimal(v.quantity), p_unit_cost: cost,
          p_supplier: v.supplier_id || null, p_occurred_at: localInputToISO(v.occurred_at), p_document_ref: v.document_ref || null,
          p_lot_code: v.lot_code || null, p_expiry: v.expiry || null, p_notes: v.notes || null,
          p_reason: v.reason as MovementReason, p_request_id: requestId,
        });
      } else {
        res = await exit.mutateAsync({
          p_store: storeId, p_product: product.id, p_quantity: parseDecimal(v.quantity), p_reason: v.reason as MovementReason,
          p_notes: v.notes || null, p_lot_id: v.lot_id || null, p_occurred_at: localInputToISO(v.occurred_at), p_request_id: requestId,
        });
      }
      toast.success(direction === 'in' ? 'Entrada registrada' : 'Saída registrada', {
        description: `${product.name}: novo saldo ${formatQty(res.balance_after, product.unit_code)}`,
      });
      onOpenChange(false);
    } catch (e) {
      toast.error(errorMessage(e));
      // um erro de validação do servidor permite nova tentativa com novo id
      setRequestId(newRequestId());
    }
  }

  const afterQty = product && !Number.isNaN(qty) ? (direction === 'in' ? product.quantity + qty : product.quantity - qty) : null;
  const willBeNegative = afterQty != null && afterQty < 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => !busy && onOpenChange(v)}
      title={direction === 'in' ? 'Registrar entrada' : 'Registrar saída'}
      description={direction === 'in' ? 'Mercadoria que chegou na loja' : 'Mercadoria que saiu do estoque'}
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>Cancelar</Button>
          <Button variant={direction === 'in' ? 'success' : 'primary'} loading={busy} onClick={handleSubmit(onSubmit)}>
            {direction === 'in' ? 'Confirmar entrada' : 'Confirmar saída'}
          </Button>
        </>
      }
    >
      <form className="space-y-4" onSubmit={handleSubmit(onSubmit)} noValidate>
        <Segmented
          className="w-full [&>button]:flex-1"
          ariaLabel="Tipo de movimentação"
          value={direction}
          onChange={setDirection}
          options={[
            { value: 'in', label: <span className="inline-flex items-center gap-1.5"><ArrowDownToLine className="h-4 w-4" />Entrada</span> },
            { value: 'out', label: <span className="inline-flex items-center gap-1.5"><ArrowUpFromLine className="h-4 w-4" />Saída</span> },
          ]}
        />

        <Field label="Item" required error={errors.product_id?.message}>
          {(a) => (
            <Controller
              control={control}
              name="product_id"
              render={({ field }) => (
                <ProductPicker id={a.id} invalid={!!a['aria-invalid']} products={stockProducts} value={field.value || null}
                  onChange={(id) => field.onChange(id ?? '')} autoFocus={!productId} />
              )}
            />
          )}
        </Field>

        {product && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl bg-surface px-3 py-2 text-[13px] text-ink-muted">
            <span>Saldo atual: <b className="text-ink tabular">{formatQty(product.quantity, product.unit_code)}</b></span>
            {afterQty != null && <span>Após: <b className={willBeNegative ? 'text-red-600' : 'text-ink'}>{formatQty(afterQty, product.unit_code)}</b></span>}
            <span>Custo médio: <b className="text-ink">{formatCost(product.unit_cost)}</b></span>
          </div>
        )}
        {willBeNegative && !store.allow_negative_stock && (
          <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-[13px] text-red-700">A quantidade é maior que o saldo disponível. A saída será bloqueada.</p>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label={`Quantidade${product ? ` (${product.unit_code})` : ''}`} required error={errors.quantity?.message}>
            {(a) => <Input {...a} {...register('quantity')} inputMode="decimal" placeholder="0" className="text-lg font-semibold" />}
          </Field>
          <Field label="Motivo" required error={errors.reason?.message}>
            {(a) => (
              <Select {...a} {...register('reason')}>
                {direction === 'out' && <option value="">Selecione…</option>}
                {(direction === 'in' ? ENTRY_REASONS : EXIT_REASONS).map((r) => <option key={r} value={r}>{REASON_LABEL[r]}</option>)}
              </Select>
            )}
          </Field>
        </div>

        {direction === 'in' && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Custo unitário (R$)" required error={errors.unit_cost?.message} hint="Valor pago por unidade">
                {(a) => <Input {...a} {...register('unit_cost')} inputMode="decimal" placeholder="0,00" />}
              </Field>
              <Field label="Fornecedor">
                {(a) => (
                  <Select {...a} {...register('supplier_id')}>
                    <option value="">Nenhum</option>
                    {suppliers.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </Select>
                )}
              </Field>
            </div>
            {tracksLots && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Lote">
                  {(a) => <Input {...a} {...register('lot_code')} placeholder="Opcional" />}
                </Field>
                <Field label="Validade" required={product?.track_expiry} error={errors.expiry?.message}>
                  {(a) => <Input {...a} type="date" {...register('expiry')} />}
                </Field>
              </div>
            )}
            <Field label="Nota fiscal / referência">
              {(a) => <Input {...a} {...register('document_ref')} placeholder="Opcional" />}
            </Field>
          </>
        )}

        {direction === 'out' && tracksLots && lots.length > 0 && (
          <Field label="Lote" hint="Se não escolher, o sistema baixa primeiro o lote que vence antes (FEFO).">
            {(a) => (
              <Select {...a} {...register('lot_id')}>
                <option value="">Automático (FEFO)</option>
                {lots.map((l) => (
                  <option key={l.id} value={l.id}>
                    {(l.lot_code || 'Sem código')} — {formatQty(l.remaining_qty, l.unit_code)}{l.expiry_date ? ` — vence ${formatDate(l.expiry_date)}` : ''}
                    {l.days_to_expiry != null && l.days_to_expiry < 0 ? ' (VENCIDO)' : ''}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}

        <Field label="Data e hora" required error={errors.occurred_at?.message}>
          {(a) => <Input {...a} type="datetime-local" max={nowLocalInput()} {...register('occurred_at')} />}
        </Field>
        <Field label="Observações">
          {(a) => <Textarea {...a} {...register('notes')} rows={2} placeholder="Opcional" />}
        </Field>
        <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
      </form>
    </Dialog>
  );
}
