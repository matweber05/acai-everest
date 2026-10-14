import { useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { useStore } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { useCategories, useSuppliers, useUnits, useWrite } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { ITEM_TYPE_LABEL } from '@/lib/labels';
import { numToInput, optionalNumber, zDecimal, zOptionalDecimal } from '@/lib/validation';
import { parseDecimal } from '@/lib/format';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Field, FormSection, Input, Select, Switch, Textarea } from '@/components/ui/form';
import type { ItemType, Product, StockMode } from '@/types/db';

const schema = z.object({
  name: z.string().trim().min(2, 'Informe o nome (mín. 2 letras)').max(160),
  sku: z.string().trim().max(40).regex(/^[\w.\-/]*$/, 'Use letras, números, ponto, hífen ou barra (sem espaços)'),
  barcode: z.string().trim().max(32).optional().refine((v) => !v || /^\d{4,32}$/.test(v), 'Somente números (4 a 32 dígitos)'),
  description: z.string().max(1000).optional(),
  category_id: z.string().optional(),
  item_type: z.enum(['resale', 'ingredient', 'packaging', 'consumable', 'finished']),
  stock_mode: z.enum(['stock', 'recipe']),
  unit_id: z.string().min(1, 'Escolha a unidade'),
  min_stock: zDecimal({ min: 0 }),
  max_stock: zOptionalDecimal({ min: 0 }),
  cost_price: zDecimal({ min: 0 }),
  sale_price: zOptionalDecimal({ min: 0 }),
  default_supplier_id: z.string().optional(),
  track_lots: z.boolean(),
  track_expiry: z.boolean(),
  active: z.boolean(),
}).refine((v) => !v.max_stock || parseDecimal(v.max_stock) >= parseDecimal(v.min_stock), { path: ['max_stock'], message: 'O máximo deve ser maior ou igual ao mínimo' })
  .refine((v) => v.stock_mode === 'stock' || v.item_type === 'finished', { path: ['stock_mode'], message: 'Só produtos acabados podem baixar por ficha técnica' });

type FormValues = z.infer<typeof schema>;

interface Props { open: boolean; onOpenChange: (v: boolean) => void; product?: Product | null; onSaved?: (id: string) => void }

function suggestSku(name: string) {
  const base = name.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9 ]/g, '').trim().split(/\s+/).slice(0, 3).map((w) => w.slice(0, 4)).join('-');
  return base || `ITEM-${Date.now().toString().slice(-6)}`;
}

export function ProductFormDialog({ open, onOpenChange, product, onSaved }: Props) {
  const { storeId } = useStore();
  const { data: units = [] } = useUnits(storeId);
  const { data: categories = [] } = useCategories(storeId);
  const { data: suppliers = [] } = useSuppliers(storeId);
  const editing = !!product;
  const save = useWrite((values: Record<string, unknown>) =>
    editing
      ? supabase.from('products').update(values).eq('id', product!.id).select('id').single()
      : supabase.from('products').insert({ ...values, store_id: storeId }).select('id').single());

  const defaults = useMemo<FormValues>(() => ({
    name: product?.name ?? '', sku: product?.sku ?? '', barcode: product?.barcode ?? '', description: product?.description ?? '',
    category_id: product?.category_id ?? '', item_type: (product?.item_type ?? 'ingredient') as ItemType,
    stock_mode: (product?.stock_mode ?? 'stock') as StockMode, unit_id: product?.unit_id ?? '',
    min_stock: numToInput(product?.min_stock ?? 0, 3), max_stock: numToInput(product?.max_stock, 3),
    cost_price: numToInput(product?.cost_price ?? 0), sale_price: numToInput(product?.sale_price, 2),
    default_supplier_id: product?.default_supplier_id ?? '', track_lots: product?.track_lots ?? false,
    track_expiry: product?.track_expiry ?? false, active: product?.active ?? true,
  }), [product]);

  const { register, handleSubmit, reset, watch, setValue, formState: { errors } } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: defaults });
  useEffect(() => { if (open) reset(defaults); }, [open, defaults, reset]);

  const itemType = watch('item_type');
  const stockMode = watch('stock_mode');
  const trackLots = watch('track_lots');
  const trackExpiry = watch('track_expiry');
  const isRecipe = stockMode === 'recipe';

  async function onSubmit(v: FormValues) {
    const payload = {
      name: v.name.trim(), sku: v.sku.trim() || suggestSku(v.name), barcode: v.barcode?.trim() || null, description: v.description?.trim() || null,
      category_id: v.category_id || null, item_type: v.item_type, stock_mode: v.stock_mode, unit_id: v.unit_id,
      min_stock: isRecipe ? 0 : parseDecimal(v.min_stock), max_stock: isRecipe ? null : optionalNumber(v.max_stock),
      cost_price: parseDecimal(v.cost_price), sale_price: optionalNumber(v.sale_price),
      default_supplier_id: v.default_supplier_id || null,
      track_lots: isRecipe ? false : v.track_lots, track_expiry: isRecipe ? false : v.track_expiry, active: v.active,
    };
    try {
      const res = (await save.mutateAsync(payload)) as { id: string };
      toast.success(editing ? 'Produto atualizado' : 'Produto cadastrado', {
        description: !editing && !isRecipe ? 'Agora registre o estoque inicial em “Registrar entrada”.' : undefined,
      });
      onOpenChange(false);
      onSaved?.(res.id);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => !save.isPending && onOpenChange(v)}
      title={editing ? `Editar: ${product!.name}` : 'Adicionar produto'}
      description="Produtos, insumos e embalagens. O saldo é calculado pelas movimentações."
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={save.isPending}>Cancelar</Button>
          <Button loading={save.isPending} onClick={handleSubmit(onSubmit)}>{editing ? 'Salvar alterações' : 'Cadastrar'}</Button>
        </>
      }
    >
      <form className="space-y-6" onSubmit={handleSubmit(onSubmit)} noValidate>
        <FormSection title="Identificação">
          <Field label="Nome" required error={errors.name?.message}>
            {(a) => <Input {...a} {...register('name')} placeholder="Ex.: Polpa de açaí 10 kg" autoFocus />}
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="SKU / código interno" error={errors.sku?.message} hint={editing ? 'Único na loja' : 'Deixe vazio para gerar automaticamente'}>
              {(a) => <Input {...a} {...register('sku')} autoCapitalize="characters" placeholder={suggestSku(watch('name') ?? '') || 'Automático'} />}
            </Field>
            <Field label="Código de barras" error={errors.barcode?.message}>
              {(a) => <Input {...a} {...register('barcode')} inputMode="numeric" placeholder="Opcional" />}
            </Field>
          </div>
          <Field label="Descrição">
            {(a) => <Textarea {...a} {...register('description')} rows={2} placeholder="Opcional" />}
          </Field>
        </FormSection>

        <FormSection title="Classificação">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Tipo de item" required>
              {(a) => (
                <Select {...a} {...register('item_type')} onChange={(e) => { register('item_type').onChange(e); if (e.target.value !== 'finished') setValue('stock_mode', 'stock'); }}>
                  {Object.entries(ITEM_TYPE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </Select>
              )}
            </Field>
            <Field label="Categoria">
              {(a) => (
                <Select {...a} {...register('category_id')}>
                  <option value="">Sem categoria</option>
                  {categories.filter((c) => c.active || c.id === product?.category_id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              )}
            </Field>
            <Field label="Unidade de medida" required error={errors.unit_id?.message}>
              {(a) => (
                <Select {...a} {...register('unit_id')}>
                  <option value="">Selecione…</option>
                  {units.filter((u) => u.active || u.id === product?.unit_id).map((u) => <option key={u.id} value={u.id}>{u.name} ({u.code})</option>)}
                </Select>
              )}
            </Field>
            {itemType === 'finished' && (
              <Field label="Como o estoque é controlado" error={errors.stock_mode?.message}
                hint={isRecipe ? 'Ao vender, o sistema baixa os ingredientes da ficha técnica (o produto não tem saldo próprio).' : 'O produto tem saldo próprio: você registra entradas dele já pronto.'}>
                {(a) => editing ? (
                  <div id={a.id} className="flex h-10 items-center rounded-xl border border-line bg-surface px-3 text-sm text-ink-muted">
                    {isRecipe ? 'Baixa pela ficha técnica' : 'Estoque próprio'} (não pode ser alterado)
                  </div>
                ) : (
                  <Select {...a} {...register('stock_mode')}>
                    <option value="stock">Estoque próprio (produzido/comprado pronto)</option>
                    <option value="recipe">Baixa pela ficha técnica (montado na hora)</option>
                  </Select>
                )}
              </Field>
            )}
          </div>
        </FormSection>

        <FormSection title="Valores" description="Custo de referência; o custo médio real é calculado pelas entradas.">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Custo unitário (R$)" required error={errors.cost_price?.message}>
              {(a) => <Input {...a} {...register('cost_price')} inputMode="decimal" />}
            </Field>
            <Field label="Preço de venda (R$)" error={errors.sale_price?.message} hint="Deixe vazio se o item não é vendido">
              {(a) => <Input {...a} {...register('sale_price')} inputMode="decimal" placeholder="—" />}
            </Field>
          </div>
        </FormSection>

        {!isRecipe && (
          <FormSection title="Estoque">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Estoque mínimo" required error={errors.min_stock?.message} hint="Abaixo disso, o sistema alerta">
                {(a) => <Input {...a} {...register('min_stock')} inputMode="decimal" />}
              </Field>
              <Field label="Estoque máximo" error={errors.max_stock?.message}>
                {(a) => <Input {...a} {...register('max_stock')} inputMode="decimal" placeholder="Opcional" />}
              </Field>
              <Field label="Fornecedor principal" className="sm:col-span-2">
                {(a) => (
                  <Select {...a} {...register('default_supplier_id')}>
                    <option value="">Nenhum</option>
                    {suppliers.filter((s) => s.active || s.id === product?.default_supplier_id).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </Select>
                )}
              </Field>
            </div>
            <div className="space-y-3 rounded-xl bg-surface p-3">
              <Switch checked={trackExpiry} onChange={(v) => { setValue('track_expiry', v); if (v) setValue('track_lots', true); }}
                label="Controlar validade" description="Exige a data de validade em cada entrada e gera alertas de vencimento." />
              <Switch checked={trackLots} onChange={(v) => { setValue('track_lots', v); if (!v) setValue('track_expiry', false); }}
                label="Controlar lotes" description="Separa o estoque por lote e sugere a baixa pelo que vence primeiro (FEFO)." />
            </div>
          </FormSection>
        )}

        {editing && (
          <FormSection title="Situação">
            <Switch checked={watch('active')} onChange={(v) => setValue('active', v)} label="Produto ativo"
              description="Itens inativos não aparecem para novas movimentações, mas o histórico é mantido." />
          </FormSection>
        )}
        <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
      </form>
    </Dialog>
  );
}
