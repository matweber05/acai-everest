import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { ArrowLeft, Save, CheckCircle2 } from 'lucide-react';
import { useStore } from '@/contexts/AuthContext';
import { useCategories, useInventoryCount, useRpc, useStockPosition } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { formatDateTime, formatQty, parseDecimal } from '@/lib/format';
import { numToInput } from '@/lib/validation';
import { newRequestId, cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input, Select, Textarea, Label } from '@/components/ui/form';
import { ConfirmDialog } from '@/components/ui/confirm';
import { ErrorState, PageHeader, SearchInput, Spinner } from '@/components/ui/misc';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { matchesProduct } from '@/components/ProductPicker';

interface Entry { counted: string; reason: string }

export default function InventoryCountPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { storeId } = useStore();
  const { data, isLoading, error, refetch } = useInventoryCount(id);
  const { data: products = [] } = useStockPosition(storeId);
  const { data: categories = [] } = useCategories(storeId);
  const save = useRpc<Record<string, unknown>>('save_inventory_count');
  const confirmRpc = useRpc<Record<string, unknown>, { adjustments: number }>('confirm_inventory_count');
  const cancelRpc = useRpc<Record<string, unknown>>('cancel_inventory_count');
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const [notes, setNotes] = useState('');
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [onlyCounted, setOnlyCounted] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!data) return;
    setNotes(data.count.notes ?? '');
    setEntries(Object.fromEntries(data.items.map((i) => [i.product_id, { counted: numToInput(i.counted_qty, 3), reason: i.reason ?? '' }])));
    setDirty(false);
  }, [data]);

  const open = data?.count.status === 'open';
  const stockItems = useMemo(() => products.filter((p) => p.stock_mode === 'stock' && (p.active || entries[p.id])), [products, entries]);
  const rows = useMemo(() => stockItems.filter((p) => matchesProduct(p, q) && (!cat || p.category_id === cat) && (!onlyCounted || entries[p.id]?.counted)), [stockItems, q, cat, onlyCounted, entries]);
  const itemById = useMemo(() => new Map((data?.items ?? []).map((i) => [i.product_id, i])), [data]);

  const counted = Object.entries(entries).filter(([, e]) => e.counted.trim() !== '');
  const invalid = counted.some(([, e]) => Number.isNaN(parseDecimal(e.counted)) || parseDecimal(e.counted) < 0);
  const diffs = counted.map(([pid, e]) => {
    const p = products.find((x) => x.id === pid);
    return { p, diff: p ? parseDecimal(e.counted) - Number(p.quantity) : 0 };
  }).filter((d) => d.p && Math.abs(d.diff) > 0.0005);

  function setEntry(pid: string, patch: Partial<Entry>) {
    setEntries((s) => ({ ...s, [pid]: { ...(s[pid] ?? { counted: '', reason: '' }), ...patch } }));
    setDirty(true);
  }

  async function persist() {
    if (invalid) throw new Error('Há quantidades inválidas. Use números maiores ou iguais a zero.');
    await save.mutateAsync({
      p_store: storeId, p_count: id, p_notes: notes,
      p_items: counted.map(([pid, e]) => ({ product_id: pid, counted_qty: parseDecimal(e.counted), reason: e.reason || null })),
      p_request_id: newRequestId(),
    });
    setDirty(false);
  }

  async function onSave() {
    try { await persist(); toast.success('Contagem salva. Você pode continuar depois.'); } catch (e) { toast.error(errorMessage(e)); }
  }
  async function onConfirm() {
    try {
      await persist();
      const r = await confirmRpc.mutateAsync({ p_store: storeId, p_count: id, p_request_id: newRequestId() });
      toast.success('Inventário confirmado', { description: `${r.adjustments} ajuste(s) de estoque gerado(s).` });
      setConfirmOpen(false);
    } catch (e) { toast.error(errorMessage(e)); setConfirmOpen(false); }
  }
  async function onCancel() {
    try { await cancelRpc.mutateAsync({ p_store: storeId, p_count: id }); toast.success('Contagem cancelada'); navigate('/estoque/inventario'); }
    catch (e) { toast.error(errorMessage(e)); }
  }

  if (isLoading) return <Spinner />;
  if (error || !data) return <Card><ErrorState error={error} onRetry={() => refetch()} /></Card>;

  return (
    <>
      <Link to="/estoque/inventario" className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-ink-muted hover:text-acai-700"><ArrowLeft className="h-4 w-4" />Inventário</Link>
      <PageHeader
        title={`Contagem #${data.count.number}`}
        description={open ? 'Digite a quantidade contada de cada item. Deixe vazio o que não foi contado.' : `Confirmada em ${formatDateTime(data.count.confirmed_at)}`}
        actions={open ? (
          <>
            <Button variant="ghost" onClick={() => setCancelOpen(true)}>Cancelar contagem</Button>
            <Button variant="secondary" onClick={onSave} loading={save.isPending && !confirmOpen} disabled={!dirty}><Save className="h-4 w-4" />Salvar rascunho</Button>
            <Button onClick={() => setConfirmOpen(true)} disabled={!counted.length || invalid}><CheckCircle2 className="h-4 w-4" />Confirmar inventário</Button>
          </>
        ) : <Badge tone={data.count.status === 'confirmed' ? 'success' : 'neutral'}>{data.count.status === 'confirmed' ? 'Confirmado' : 'Cancelado'}</Badge>}
      />

      <Card>
        <div className="flex flex-col gap-2 border-b border-line p-4 lg:flex-row lg:items-center">
          <SearchInput className="flex-1" placeholder="Buscar item" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar item" />
          <Select className="lg:w-56" value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Categoria">
            <option value="">Todas as categorias</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
          <label className="flex h-10 items-center gap-2 whitespace-nowrap rounded-xl border border-line px-3 text-sm">
            <input type="checkbox" checked={onlyCounted} onChange={(e) => setOnlyCounted(e.target.checked)} className="h-4 w-4 accent-acai-700" />Só contados
          </label>
          <span className="text-[13px] text-ink-muted">{counted.length} contado(s) · {diffs.length} com diferença</span>
        </div>
        <Table>
          <THead><tr>
            <TH>Item</TH><TH className="text-right">{open ? 'Saldo no sistema' : 'Teórico'}</TH><TH className="w-36">Contado</TH>
            <TH className="text-right">Diferença</TH><TH className="hidden md:table-cell">Motivo</TH>
          </tr></THead>
          <TBody>
            {rows.map((p) => {
              const e = entries[p.id];
              const rec = itemById.get(p.id);
              const theo = open ? Number(p.quantity) : rec?.theoretical_qty ?? null;
              const c = e?.counted ? parseDecimal(e.counted) : NaN;
              const diff = open ? (Number.isNaN(c) ? null : c - Number(theo)) : rec?.difference ?? null;
              if (!open && !rec) return null;
              return (
                <TR key={p.id}>
                  <TD><div className="font-medium">{p.name}</div><div className="text-[12px] text-ink-muted">{p.sku}</div></TD>
                  <TD className="text-right tabular">{formatQty(theo, p.unit_code)}</TD>
                  <TD>
                    {open ? (
                      <Input aria-label={`Quantidade contada de ${p.name}`} inputMode="decimal" value={e?.counted ?? ''} placeholder="—"
                        onChange={(ev) => setEntry(p.id, { counted: ev.target.value })}
                        aria-invalid={e?.counted && (Number.isNaN(c) || c < 0) ? true : undefined} className="h-9" />
                    ) : <span className="tabular">{formatQty(rec?.counted_qty, p.unit_code)}</span>}
                  </TD>
                  <TD className={cn('text-right font-semibold tabular', diff == null || Math.abs(diff) < 0.0005 ? 'text-ink-muted' : diff > 0 ? 'text-leaf-700' : 'text-red-600')}>
                    {diff == null ? '—' : `${diff > 0 ? '+' : ''}${formatQty(diff)}`}
                  </TD>
                  <TD className="hidden md:table-cell">
                    {open ? (
                      <Input aria-label={`Motivo da diferença de ${p.name}`} value={e?.reason ?? ''} placeholder="Opcional" className="h-9"
                        onChange={(ev) => setEntry(p.id, { reason: ev.target.value })} />
                    ) : <span className="text-ink-muted">{rec?.reason ?? '—'}</span>}
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
        <div className="border-t border-line p-4">
          <Label htmlFor="inv-notes">Observações</Label>
          <Textarea id="inv-notes" value={notes} disabled={!open} onChange={(e) => { setNotes(e.target.value); setDirty(true); }} rows={2} />
        </div>
      </Card>

      <ConfirmDialog
        open={confirmOpen} onOpenChange={setConfirmOpen} tone="primary" title="Confirmar inventário?"
        confirmLabel="Confirmar e ajustar estoque" loading={save.isPending || confirmRpc.isPending} onConfirm={onConfirm}
        message={
          <div className="space-y-2">
            <p>{counted.length} item(ns) contado(s). {diffs.length ? `${diffs.length} diferença(s) gerarão ajustes de estoque:` : 'Nenhuma diferença encontrada.'}</p>
            {diffs.length > 0 && (
              <ul className="max-h-48 overflow-y-auto rounded-lg border border-line text-[13px]">
                {diffs.map((d) => (
                  <li key={d.p!.id} className="flex justify-between gap-2 border-b border-line px-3 py-1.5 last:border-0">
                    <span className="truncate text-ink">{d.p!.name}</span>
                    <span className={d.diff > 0 ? 'text-leaf-700' : 'text-red-600'}>{d.diff > 0 ? '+' : ''}{formatQty(d.diff, d.p!.unit_code)}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-[12.5px]">O saldo teórico é recalculado no momento da confirmação. Esta ação não pode ser desfeita (só por estorno).</p>
          </div>
        }
      />
      <ConfirmDialog open={cancelOpen} onOpenChange={setCancelOpen} title="Cancelar contagem?" message="Nenhum ajuste será feito. A contagem fica registrada como cancelada."
        confirmLabel="Cancelar contagem" loading={cancelRpc.isPending} onConfirm={onCancel} />
    </>
  );
}
