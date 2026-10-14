import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { ArrowDownToLine, ArrowLeft, ArrowUpFromLine, Pencil, Power, Trash2 } from 'lucide-react';
import { useStore } from '@/contexts/AuthContext';
import { useQuickActions } from '@/contexts/QuickActions';
import { useLots, useMovements, useProduct, useWrite } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/errors';
import { ITEM_TYPE_LABEL, REASON_LABEL, STOCK_MODE_LABEL } from '@/lib/labels';
import { formatBRL, formatCost, formatDate, formatDateTime, formatQty } from '@/lib/format';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ui/confirm';
import { ErrorState, Spinner } from '@/components/ui/misc';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { StockBadge } from '@/components/StockBadge';
import { ProductFormDialog } from './ProductFormDialog';
import { RecipeEditor } from './RecipeEditor';

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[12px] font-medium text-ink-muted">{label}</dt>
      <dd className="mt-0.5 text-sm text-ink">{children}</dd>
    </div>
  );
}

export default function ProductDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { storeId, isAdmin } = useStore();
  const { openMovement } = useQuickActions();
  const { data: p, isLoading, error, refetch } = useProduct(storeId, id);
  const { data: lots = [] } = useLots(storeId, { productId: id });
  const { data: movs } = useMovements(storeId, { productId: id }, 1);
  const [editOpen, setEditOpen] = useState(false);
  const [confirm, setConfirm] = useState<'toggle' | 'delete' | null>(null);
  const toggle = useWrite((active: boolean) => supabase.from('products').update({ active }).eq('id', id!).select('id').single());
  const remove = useWrite(() => supabase.from('products').delete().eq('id', id!).select('id'));

  if (isLoading) return <Spinner />;
  if (error || !p) return <Card><ErrorState error={error ?? new Error('Produto não encontrado')} onRetry={() => refetch()} /></Card>;

  async function onToggle() {
    try {
      await toggle.mutateAsync(!p!.active);
      toast.success(p!.active ? 'Produto inativado' : 'Produto reativado');
      setConfirm(null);
    } catch (e) { toast.error(errorMessage(e)); }
  }
  async function onDelete() {
    try {
      const rows = (await remove.mutateAsync(undefined)) as unknown[];
      if (!rows?.length) throw new Error('Você não tem permissão para excluir este item.');
      toast.success('Produto excluído');
      navigate('/produtos', { replace: true });
    } catch (e) { toast.error(errorMessage(e)); setConfirm(null); }
  }

  const isStock = p.stock_mode === 'stock';

  return (
    <>
      <Link to="/produtos" className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-ink-muted hover:text-acai-700"><ArrowLeft className="h-4 w-4" />Produtos</Link>
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-acai-950">{p.name}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-ink-muted">
            <span>{p.sku}</span>{p.barcode && <span>· {p.barcode}</span>}
            <StockBadge p={p} />{p.is_demo && <Badge tone="warning">DEMO</Badge>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {isStock && p.active && (
            <>
              <Button variant="success" onClick={() => openMovement('in', p.id)}><ArrowDownToLine className="h-4 w-4" />Entrada</Button>
              <Button onClick={() => openMovement('out', p.id)}><ArrowUpFromLine className="h-4 w-4" />Saída</Button>
            </>
          )}
          {isAdmin && (
            <>
              <Button variant="secondary" onClick={() => setEditOpen(true)}><Pencil className="h-4 w-4" />Editar</Button>
              <Button variant="secondary" onClick={() => setConfirm('toggle')}><Power className="h-4 w-4" />{p.active ? 'Inativar' : 'Reativar'}</Button>
              <Button variant="ghost" onClick={() => setConfirm('delete')} aria-label="Excluir"><Trash2 className="h-4 w-4" /></Button>
            </>
          )}
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader title="Saldo" />
          <CardBody>
            {isStock ? (
              <>
                <div className="text-3xl font-bold tracking-tight tabular text-acai-900">{formatQty(p.quantity, p.unit_code)}</div>
                <p className="mt-1 text-sm text-ink-muted">Mínimo {formatQty(p.min_stock, p.unit_code)}{p.max_stock != null ? ` · Máximo ${formatQty(p.max_stock, p.unit_code)}` : ''}</p>
                <dl className="mt-4 grid grid-cols-2 gap-3">
                  <Info label="Custo médio">{formatCost(p.unit_cost)}</Info>
                  <Info label="Valor em estoque">{formatBRL(p.stock_value)}</Info>
                  <Info label="Última movimentação">{formatDateTime(p.last_movement_at)}</Info>
                  {p.next_expiry && <Info label="Próximo vencimento">{formatDate(p.next_expiry)}</Info>}
                </dl>
              </>
            ) : (
              <p className="text-sm text-ink-muted">Este produto não tem saldo próprio: cada venda baixa os ingredientes da ficha técnica.</p>
            )}
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Cadastro" />
          <CardBody>
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Info label="Tipo">{ITEM_TYPE_LABEL[p.item_type]}</Info>
              <Info label="Categoria">{p.category_name ?? '—'}</Info>
              <Info label="Unidade">{p.unit_code}</Info>
              <Info label="Controle de estoque">{STOCK_MODE_LABEL[p.stock_mode]}</Info>
              <Info label="Custo de referência">{formatCost(p.cost_price)}</Info>
              <Info label="Preço de venda">{formatBRL(p.sale_price)}</Info>
              <Info label="Fornecedor principal">{p.supplier_name ?? '—'}</Info>
              <Info label="Lote / validade">{p.track_lots ? 'Controla lote' : 'Sem lote'}{p.track_expiry ? ' e validade' : ''}</Info>
              <Info label="Atualizado em">{formatDateTime(p.updated_at)}</Info>
            </dl>
            {p.description && <p className="mt-4 text-sm text-ink-muted">{p.description}</p>}
          </CardBody>
        </Card>

        {!isStock && <div className="lg:col-span-3"><RecipeEditor product={p} /></div>}

        {isStock && (p.track_lots || p.track_expiry || lots.length > 0) && (
          <Card className="lg:col-span-3">
            <CardHeader title="Lotes em estoque" description="Ordem sugerida de uso: primeiro o que vence antes (FEFO)." />
            <CardBody className="px-0 pb-0">
              {lots.length === 0 ? <p className="px-5 pb-4 text-sm text-ink-muted">Nenhum lote com saldo.</p> : (
                <Table>
                  <THead><tr><TH>Ordem</TH><TH>Lote</TH><TH>Entrada</TH><TH>Validade</TH><TH className="text-right">Restante</TH><TH className="text-right">Custo</TH><TH>Fornecedor</TH></tr></THead>
                  <TBody>
                    {lots.map((l, i) => (
                      <TR key={l.id}>
                        <TD className="tabular">{i + 1}º</TD>
                        <TD>{l.lot_code ?? '—'}</TD>
                        <TD>{formatDate(l.received_at)}</TD>
                        <TD>
                          {l.expiry_date ? formatDate(l.expiry_date) : '—'}{' '}
                          {l.days_to_expiry != null && (l.days_to_expiry < 0 ? <Badge tone="danger">Vencido</Badge> : l.days_to_expiry <= 7 ? <Badge tone="warning">{l.days_to_expiry} dia(s)</Badge> : null)}
                        </TD>
                        <TD className="text-right tabular">{formatQty(l.remaining_qty, l.unit_code)} <span className="text-ink-soft">/ {formatQty(l.received_qty)}</span></TD>
                        <TD className="text-right tabular">{formatCost(l.unit_cost)}</TD>
                        <TD className="text-ink-muted">{l.supplier_name ?? '—'}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </CardBody>
          </Card>
        )}

        {isStock && (
          <Card className="lg:col-span-3">
            <CardHeader title="Últimas movimentações" action={<Link to={`/movimentacoes?produto=${p.id}`} className="text-[13px] font-medium text-acai-700 hover:underline">Ver histórico completo</Link>} />
            <CardBody className="px-0 pb-0">
              {!movs?.rows.length ? <p className="px-5 pb-4 text-sm text-ink-muted">Nenhuma movimentação. Registre o estoque inicial com “Entrada”.</p> : (
                <Table>
                  <THead><tr><TH>Data</TH><TH>Motivo</TH><TH className="text-right">Quantidade</TH><TH className="text-right">Saldo após</TH><TH>Responsável</TH></tr></THead>
                  <TBody>
                    {movs.rows.slice(0, 10).map((m) => (
                      <TR key={m.id}>
                        <TD className="whitespace-nowrap">{formatDateTime(m.occurred_at)}</TD>
                        <TD>{REASON_LABEL[m.reason]}{m.reversed_by_movement_id && <Badge tone="neutral" className="ml-1.5">Estornada</Badge>}</TD>
                        <TD className={`text-right font-semibold tabular ${m.direction === 'in' ? 'text-leaf-700' : 'text-acai-700'}`}>{m.direction === 'in' ? '+' : '−'}{formatQty(m.quantity, m.unit_code)}</TD>
                        <TD className="text-right tabular">{formatQty(m.balance_after, m.unit_code)}</TD>
                        <TD className="text-ink-muted">{m.created_by_name ?? '—'}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </CardBody>
          </Card>
        )}
      </div>

      <ProductFormDialog open={editOpen} onOpenChange={setEditOpen} product={p} />
      <ConfirmDialog
        open={confirm === 'toggle'} onOpenChange={(v) => !v && setConfirm(null)} tone={p.active ? 'danger' : 'primary'}
        title={p.active ? 'Inativar produto?' : 'Reativar produto?'}
        message={p.active ? 'O item deixa de aparecer para novas movimentações e vendas. Todo o histórico é mantido e você pode reativá-lo depois.' : 'O item voltará a aparecer para movimentações e vendas.'}
        confirmLabel={p.active ? 'Inativar' : 'Reativar'} loading={toggle.isPending} onConfirm={onToggle}
      />
      <ConfirmDialog
        open={confirm === 'delete'} onOpenChange={(v) => !v && setConfirm(null)}
        title="Excluir produto?"
        message="A exclusão só é permitida para itens sem nenhum histórico (movimentações, compras, vendas ou fichas). Se houver histórico, inative o item."
        confirmLabel="Excluir definitivamente" loading={remove.isPending} onConfirm={onDelete}
      />
    </>
  );
}
