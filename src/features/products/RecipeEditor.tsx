import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, Utensils } from 'lucide-react';
import { toast } from 'sonner';
import { useStore } from '@/contexts/AuthContext';
import { useRecipe, useRpc, useStockPosition } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { formatBRL, formatCost, formatQty, parseDecimal } from '@/lib/format';
import { numToInput } from '@/lib/validation';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/form';
import { EmptyState, Spinner } from '@/components/ui/misc';
import { ProductPicker } from '@/components/ProductPicker';
import type { StockPosition } from '@/types/db';
import { newRequestId } from '@/lib/utils';

interface Line { key: string; ingredient_id: string | null; quantity: string; loss_pct: string }

/** Ficha técnica: quanto de cada ingrediente uma porção consome. */
export function RecipeEditor({ product }: { product: StockPosition }) {
  const { storeId, isAdmin } = useStore();
  const { data, isLoading } = useRecipe(storeId, product.id);
  const { data: all = [] } = useStockPosition(storeId);
  const save = useRpc<Record<string, unknown>>('save_recipe');
  const ingredients = useMemo(() => all.filter((p) => p.stock_mode === 'stock' && p.active && p.id !== product.id), [all, product.id]);
  const [editing, setEditing] = useState(false);
  const [yieldQty, setYieldQty] = useState('1');
  const [lines, setLines] = useState<Line[]>([]);

  useEffect(() => {
    if (!data) return;
    setYieldQty(numToInput(data.recipe?.yield_qty ?? 1, 3));
    setLines(data.items.map((i) => ({ key: i.id, ingredient_id: i.ingredient_id, quantity: numToInput(i.quantity, 3), loss_pct: numToInput(i.loss_pct, 2) })));
  }, [data]);

  const byId = useMemo(() => new Map(all.map((p) => [p.id, p])), [all]);
  const y = parseDecimal(yieldQty) || 1;
  const cost = lines.reduce((acc, l) => {
    const ing = l.ingredient_id ? byId.get(l.ingredient_id) : undefined;
    const q = parseDecimal(l.quantity) || 0;
    const loss = parseDecimal(l.loss_pct) || 0;
    return acc + (ing ? (q * (1 + loss / 100) * ing.unit_cost) / y : 0);
  }, 0);
  const missingCost = lines.some((l) => l.ingredient_id && !(byId.get(l.ingredient_id)?.unit_cost));

  async function onSave() {
    const items = lines.filter((l) => l.ingredient_id);
    if (!items.length) return toast.error('Adicione pelo menos um ingrediente.');
    if (items.some((l) => !(parseDecimal(l.quantity) > 0))) return toast.error('Informe a quantidade de todos os ingredientes.');
    try {
      await save.mutateAsync({
        p_store: storeId, p_product: product.id, p_yield: y, p_notes: null,
        p_items: items.map((l) => ({ ingredient_id: l.ingredient_id, quantity: parseDecimal(l.quantity), loss_pct: parseDecimal(l.loss_pct) || 0 })),
      });
      toast.success('Ficha técnica salva');
      setEditing(false);
    } catch (e) { toast.error(errorMessage(e)); }
  }

  const header = (
    <CardHeader
      title="Ficha técnica"
      description="Ao vender 1 unidade, o sistema baixa estes ingredientes do estoque."
      action={isAdmin && !editing && data?.recipe ? <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>Editar</Button> : undefined}
    />
  );

  if (isLoading) return <Card>{header}<Spinner /></Card>;

  if (!editing) {
    return (
      <Card>
        {header}
        <CardBody>
          {!data?.recipe ? (
            <EmptyState icon={<Utensils className="h-6 w-6" />} title="Ficha técnica não cadastrada"
              description="Sem a ficha, este produto não pode ser vendido. Informe as quantidades reais usadas pela loja."
              action={isAdmin ? <Button onClick={() => { setLines([{ key: newRequestId(), ingredient_id: null, quantity: '', loss_pct: '' }]); setEditing(true); }}><Plus className="h-4 w-4" />Cadastrar ficha</Button> : undefined} />
          ) : (
            <>
              <ul className="divide-y divide-line rounded-xl border border-line">
                {data.items.map((i) => {
                  const ing = byId.get(i.ingredient_id);
                  return (
                    <li key={i.id} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
                      <span className="min-w-0 truncate font-medium">{ing?.name ?? 'Ingrediente'}</span>
                      <span className="shrink-0 tabular text-ink-muted">
                        {formatQty(i.quantity, ing?.unit_code)}{Number(i.loss_pct) > 0 ? ` + ${formatQty(i.loss_pct)}% perda` : ''}
                      </span>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-3 text-sm text-ink-muted">
                Rendimento: <b className="text-ink">{formatQty(data.recipe.yield_qty)} porção(ões)</b> · Custo estimado por porção: <b className="text-ink">{formatCost(cost)}</b>
                {product.sale_price ? <> · Margem estimada: <b className="text-ink">{formatBRL(product.sale_price - cost)}</b></> : null}
                {missingCost && <span className="block text-mango-700">Algum ingrediente está sem custo; o custo estimado está incompleto.</span>}
              </p>
            </>
          )}
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      {header}
      <CardBody className="space-y-3">
        <div className="max-w-[200px]">
          <Label htmlFor="yield">Rendimento (porções)</Label>
          <Input id="yield" value={yieldQty} onChange={(e) => setYieldQty(e.target.value)} inputMode="decimal" />
        </div>
        {lines.map((l, idx) => {
          const ing = l.ingredient_id ? byId.get(l.ingredient_id) : undefined;
          return (
            <div key={l.key} className="grid grid-cols-[1fr_auto] gap-2 rounded-xl border border-line p-3 sm:grid-cols-[1fr_130px_110px_auto] sm:items-end">
              <div className="col-span-2 sm:col-span-1">
                <Label htmlFor={`ing-${l.key}`}>Ingrediente {idx + 1}</Label>
                <ProductPicker id={`ing-${l.key}`} products={ingredients} value={l.ingredient_id}
                  onChange={(id) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, ingredient_id: id } : x)))} />
              </div>
              <label className="block text-[13px] font-medium text-ink">
                Qtd. {ing ? `(${ing.unit_code})` : ''}
                <Input className="mt-1.5" value={l.quantity} inputMode="decimal" onChange={(e) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, quantity: e.target.value } : x)))} />
              </label>
              <label className="block text-[13px] font-medium text-ink">
                Perda (%)
                <Input className="mt-1.5" value={l.loss_pct} inputMode="decimal" placeholder="0" onChange={(e) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, loss_pct: e.target.value } : x)))} />
              </label>
              <Button variant="ghost" size="icon" aria-label="Remover ingrediente" className="self-end" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          );
        })}
        <Button variant="secondary" size="sm" onClick={() => setLines((ls) => [...ls, { key: newRequestId(), ingredient_id: null, quantity: '', loss_pct: '' }])}>
          <Plus className="h-4 w-4" />Adicionar ingrediente
        </Button>
        <p className="text-sm text-ink-muted">Custo estimado por porção: <b className="text-ink">{formatCost(cost)}</b></p>
        <div className="flex justify-end gap-2 border-t border-line pt-3">
          <Button variant="secondary" onClick={() => setEditing(false)} disabled={save.isPending}>Cancelar</Button>
          <Button onClick={onSave} loading={save.isPending}>Salvar ficha</Button>
        </div>
      </CardBody>
    </Card>
  );
}
