import { useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertTriangle, ArrowDownToLine, ArrowUpFromLine, Boxes, CalendarClock, CircleDollarSign, PackageX, Package, ReceiptText,
  ShoppingCart, TrendingUp, Wallet,
} from 'lucide-react';
import {
  Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { useStore } from '@/contexts/AuthContext';
import { useQuickActions } from '@/contexts/QuickActions';
import { useDashboard } from '@/lib/api';
import { formatBRL, formatDate, formatDateTime, formatInt, formatPct, formatQty, shortDayLabel } from '@/lib/format';
import { periodFromPreset, PERIOD_LABEL, type PeriodPreset } from '@/lib/period';
import { grossMargin } from '@/lib/money';
import { REASON_LABEL } from '@/lib/labels';
import { cn } from '@/lib/utils';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/form';
import { EmptyState, ErrorState, PageHeader, Segmented, Skeleton } from '@/components/ui/misc';

// Paleta validada (scripts/validate_palette.js): entradas × saídas
const C_IN = '#6A9E38';
const C_OUT = '#91219F';
const C_MAIN = '#91219F';
const GRID = '#ECEDF0';
const AXIS = { fontSize: 12, fill: '#5B6170' };

function Stat({ icon, label, value, hint, tone = 'acai', to }: { icon: ReactNode; label: string; value: ReactNode; hint?: ReactNode; tone?: 'acai' | 'leaf' | 'mango' | 'red' | 'turq'; to?: string }) {
  const tones = {
    acai: 'bg-acai-50 text-acai-700', leaf: 'bg-leaf-50 text-leaf-700', mango: 'bg-mango-50 text-mango-700',
    red: 'bg-red-50 text-red-600', turq: 'bg-turq-50 text-turq-700',
  };
  const body = (
    <Card className={cn('h-full p-4 transition-shadow', to && 'hover:shadow-pop')}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-[12.5px] font-medium text-ink-muted">{label}</p>
        <span className={cn('rounded-lg p-1.5', tones[tone])} aria-hidden>{icon}</span>
      </div>
      <div className="mt-1.5 text-[22px] font-bold tracking-tight text-ink tabular">{value}</div>
      {hint && <div className="mt-0.5 text-[12px] text-ink-muted">{hint}</div>}
    </Card>
  );
  return to ? <Link to={to} className="block rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acai-400">{body}</Link> : body;
}

function ChartTooltip({ active, payload, label, money = true }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string; money?: boolean }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-line bg-white px-3 py-2 text-[12.5px] shadow-pop">
      {label && <div className="mb-1 font-semibold text-ink">{/^\d{4}-\d{2}-\d{2}$/.test(label) ? formatDate(label) : label}</div>}
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-2 text-ink-muted">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
          {p.name}: <b className="text-ink">{money ? formatBRL(p.value) : formatInt(p.value)}</b>
        </div>
      ))}
    </div>
  );
}

const plural = (n: number, one: string, many: string) => `${formatInt(n)} ${n === 1 ? one : many}`;

const moneyTick = (v: number) => (Math.abs(v) >= 1000 ? `R$ ${(v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil` : `R$ ${v.toLocaleString('pt-BR')}`);

export default function DashboardPage() {
  const { storeId, store, isAdmin } = useStore();
  const { openMovement } = useQuickActions();
  const navigate = useNavigate();
  const [preset, setPreset] = useState<PeriodPreset>('7d');
  const [custom, setCustom] = useState(() => { const p = periodFromPreset('30d'); return { from: p.from, to: p.to }; });
  const period = useMemo(() => periodFromPreset(preset, custom), [preset, custom]);
  const { data, isLoading, error, refetch, isFetching } = useDashboard(storeId, period.from, period.to);

  const k = data?.kpis;
  const margin = k ? grossMargin(k.revenue, k.cogs, k.cost_complete) : null;
  const isEmpty = k && k.active_skus === 0;
  const hasMovements = !!data?.daily.some((d) => d.in_count + d.out_count > 0);

  return (
    <>
      <PageHeader
        title="Visão geral"
        description={isFetching && !isLoading ? 'Atualizando…' : `${store.name} · ${formatDate(period.from)} a ${formatDate(period.to)}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Segmented ariaLabel="Período" value={preset} onChange={setPreset}
              options={(['today', '7d', '30d', 'custom'] as PeriodPreset[]).map((p) => ({ value: p, label: PERIOD_LABEL[p] }))} />
            {preset === 'custom' && (
              <div className="flex items-center gap-1.5">
                <Input type="date" aria-label="Data inicial" value={custom.from} max={custom.to} onChange={(e) => e.target.value && setCustom((c) => ({ ...c, from: e.target.value }))} className="h-9 w-[150px]" />
                <span className="text-ink-muted">a</span>
                <Input type="date" aria-label="Data final" value={custom.to} min={custom.from} onChange={(e) => e.target.value && setCustom((c) => ({ ...c, to: e.target.value }))} className="h-9 w-[150px]" />
              </div>
            )}
          </div>
        }
      />

      {/* Atalhos */}
      <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-4 [&>button]:h-auto [&>button]:min-h-12 [&>button]:whitespace-normal [&>button]:py-2 [&>button]:text-[13.5px] sm:[&>button]:text-[15px]">
        {isAdmin && <Button variant="secondary" size="lg" onClick={() => navigate('/produtos?novo=1')}><Package className="h-5 w-5 shrink-0 text-turq-700" />Adicionar produto</Button>}
        <Button variant="secondary" size="lg" onClick={() => openMovement('in')}><ArrowDownToLine className="h-5 w-5 shrink-0 text-leaf-600" />Registrar entrada</Button>
        <Button variant="secondary" size="lg" onClick={() => openMovement('out')}><ArrowUpFromLine className="h-5 w-5 shrink-0 text-acai-600" />Registrar saída</Button>
        <Button variant="secondary" size="lg" onClick={() => navigate('/vendas/nova')}><ReceiptText className="h-5 w-5 shrink-0 text-mango-600" />Lançar venda</Button>
      </div>

      {error ? <Card><ErrorState error={error} onRetry={() => refetch()} /></Card> : isLoading || !k || !data ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-[104px] rounded-2xl" />)}</div>
      ) : isEmpty ? (
        <Card>
          <EmptyState
            icon={<Boxes className="h-7 w-7" />}
            title="Vamos começar o seu estoque"
            description={<>1. Cadastre os produtos, insumos e embalagens. 2. Registre o estoque inicial de cada um (motivo “Estoque inicial”). 3. A partir daí, lance compras, vendas e saídas — o painel se atualiza sozinho.</>}
            action={isAdmin ? <Button onClick={() => navigate('/produtos?novo=1')}><Package className="h-4 w-4" />Cadastrar primeiro produto</Button> : undefined}
          />
        </Card>
      ) : (
        <div className="space-y-5">
          {/* Indicadores de estoque */}
          <section aria-label="Indicadores de estoque" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat icon={<Package className="h-4 w-4" />} label="SKUs ativos" value={formatInt(k.active_skus)} hint={`${formatInt(k.stock_skus)} com estoque próprio`} to="/produtos" />
            <Stat icon={<Wallet className="h-4 w-4" />} label="Valor do estoque (custo)" value={formatBRL(k.stock_value)} tone="turq" to="/estoque" />
            <Stat icon={<AlertTriangle className="h-4 w-4" />} label="Abaixo do mínimo" value={formatInt(k.below_min)} tone={k.below_min ? 'mango' : 'leaf'} hint={k.below_min ? 'precisam de reposição' : 'tudo em dia'} to="/estoque?status=low" />
            <Stat icon={<PackageX className="h-4 w-4" />} label="Sem estoque" value={formatInt(k.out_of_stock)} tone={k.out_of_stock ? 'red' : 'leaf'} to="/estoque?status=out" />
          </section>

          <Card className="p-4">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
              <span className="text-[12.5px] font-medium text-ink-muted">Quantidade em estoque por unidade:</span>
              {k.qty_by_unit.length === 0 ? <span className="text-sm text-ink-muted">—</span> : k.qty_by_unit.map((u) => (
                <span key={u.unit} className="text-sm"><b className="tabular text-ink">{formatQty(u.quantity, u.unit)}</b> <span className="text-ink-muted">({u.skus} {u.skus === 1 ? 'item' : 'itens'})</span></span>
              ))}
            </div>
          </Card>

          {/* Indicadores do período */}
          <section aria-label="Indicadores do período" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat icon={<ReceiptText className="h-4 w-4" />} label="Receita bruta" value={formatBRL(k.revenue)} hint={`${plural(k.sales_count, 'venda', 'vendas')} · ticket médio ${formatBRL(k.avg_ticket)}`} tone="mango" to="/vendas" />
            <Stat icon={<CircleDollarSign className="h-4 w-4" />} label="Custo dos produtos vendidos" value={k.sales_count ? formatBRL(k.cogs) : '—'}
              hint={k.sales_missing_cost ? `${k.sales_missing_cost} venda(s) com item sem custo` : 'pelo custo médio'} />
            <Stat icon={<TrendingUp className="h-4 w-4" />} label="Margem bruta estimada" tone="leaf"
              value={margin ? formatBRL(margin.value) : '—'}
              hint={margin ? `${formatPct(margin.pct)} da receita · não é lucro líquido` : k.sales_count ? 'dados de custo insuficientes' : 'sem vendas no período'} />
            <Stat icon={<ShoppingCart className="h-4 w-4" />} label="Compras recebidas" value={formatBRL(k.purchases_total)} hint={plural(k.purchases_count, 'compra recebida', 'compras recebidas')} tone="turq" to="/compras" />
          </section>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card>
              <CardHeader title="Entradas × saídas por dia" description="Valor movimentado, a preço de custo" />
              <CardBody>
                {hasMovements ? (
                  <div className="h-64" role="img" aria-label="Gráfico de barras de entradas e saídas por dia">
                    <ResponsiveContainer>
                      <BarChart data={data.daily} barGap={2} margin={{ left: 0, right: 8, top: 4 }}>
                        <CartesianGrid vertical={false} stroke={GRID} />
                        <XAxis dataKey="day" tickFormatter={shortDayLabel} tick={AXIS} axisLine={false} tickLine={false} minTickGap={12} />
                        <YAxis tickFormatter={moneyTick} tick={AXIS} axisLine={false} tickLine={false} width={72} />
                        <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(145,33,159,0.06)' }} />
                        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12.5 }} />
                        <Bar dataKey="in_value" name="Entradas" fill={C_IN} radius={[4, 4, 0, 0]} maxBarSize={22} />
                        <Bar dataKey="out_value" name="Saídas" fill={C_OUT} radius={[4, 4, 0, 0]} maxBarSize={22} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ) : <EmptyState title="Sem movimentações no período" description="Registre entradas e saídas para ver o gráfico." />}
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Evolução das vendas" description="Receita bruta por dia" />
              <CardBody>
                {k.sales_count > 0 ? (
                  <div className="h-64" role="img" aria-label="Gráfico de vendas por dia">
                    <ResponsiveContainer>
                      <BarChart data={data.daily} margin={{ left: 0, right: 8, top: 4 }}>
                        <CartesianGrid vertical={false} stroke={GRID} />
                        <XAxis dataKey="day" tickFormatter={shortDayLabel} tick={AXIS} axisLine={false} tickLine={false} minTickGap={12} />
                        <YAxis tickFormatter={moneyTick} tick={AXIS} axisLine={false} tickLine={false} width={72} />
                        <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(145,33,159,0.06)' }} />
                        <Bar dataKey="revenue" name="Receita" fill={C_MAIN} radius={[4, 4, 0, 0]} maxBarSize={28} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ) : <EmptyState title="Nenhuma venda no período" description="Lance vendas em “Lançar venda”." />}
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Produtos mais vendidos" description="Por receita no período" />
              <CardBody>
                {data.top_products.length ? (
                  <div style={{ height: Math.max(160, data.top_products.length * 40) }} role="img" aria-label="Gráfico dos produtos mais vendidos">
                    <ResponsiveContainer>
                      <BarChart data={data.top_products} layout="vertical" margin={{ left: 0, right: 16 }}>
                        <CartesianGrid horizontal={false} stroke={GRID} />
                        <XAxis type="number" tickFormatter={moneyTick} tick={AXIS} axisLine={false} tickLine={false} />
                        <YAxis type="category" dataKey="name" tick={AXIS} width={130} axisLine={false} tickLine={false} />
                        <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(145,33,159,0.06)' }} />
                        <Bar dataKey="revenue" name="Receita" fill={C_MAIN} radius={[0, 4, 4, 0]} maxBarSize={22} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ) : <EmptyState title="Ainda sem vendas" />}
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Estoque por categoria" description="Valor a preço de custo" />
              <CardBody>
                {data.by_category.some((c) => c.value > 0) ? (
                  <div style={{ height: Math.max(160, data.by_category.length * 40) }} role="img" aria-label="Gráfico de valor do estoque por categoria">
                    <ResponsiveContainer>
                      <BarChart data={data.by_category} layout="vertical" margin={{ left: 0, right: 16 }}>
                        <CartesianGrid horizontal={false} stroke={GRID} />
                        <XAxis type="number" tickFormatter={moneyTick} tick={AXIS} axisLine={false} tickLine={false} />
                        <YAxis type="category" dataKey="category" tick={AXIS} width={130} axisLine={false} tickLine={false} />
                        <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(145,33,159,0.06)' }} />
                        <Bar dataKey="value" name="Valor" fill="#21A99A" radius={[0, 4, 4, 0]} maxBarSize={22} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ) : <EmptyState title="Sem valor em estoque" description="Os valores aparecem após registrar entradas com custo." />}
              </CardBody>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader title="Evolução do valor do estoque" description="Valor a custo no fim de cada dia" />
              <CardBody>
                {hasMovements || k.stock_value > 0 ? (
                  <div className="h-56" role="img" aria-label="Gráfico da evolução do valor do estoque">
                    <ResponsiveContainer>
                      <LineChart data={data.daily} margin={{ left: 0, right: 8, top: 8 }}>
                        <CartesianGrid vertical={false} stroke={GRID} />
                        <XAxis dataKey="day" tickFormatter={shortDayLabel} tick={AXIS} axisLine={false} tickLine={false} minTickGap={12} />
                        <YAxis tickFormatter={moneyTick} tick={AXIS} axisLine={false} tickLine={false} width={72} />
                        <Tooltip content={<ChartTooltip />} />
                        <Line type="monotone" dataKey="stock_value" name="Valor do estoque" stroke={C_MAIN} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                ) : <EmptyState title="Sem histórico ainda" />}
              </CardBody>
            </Card>
          </div>

          {/* Seções operacionais */}
          <div className="grid gap-5 lg:grid-cols-3">
            <Card>
              <CardHeader title="Precisam de reposição" action={<Link to="/estoque?status=low" className="text-[13px] font-medium text-acai-700 hover:underline">Ver todos</Link>} />
              <CardBody className="px-0 pb-2">
                {data.critical.length === 0 ? <p className="px-5 pb-3 text-sm text-ink-muted">Nenhum item abaixo do mínimo.</p> : (
                  <ul className="divide-y divide-line">
                    {data.critical.map((c) => (
                      <li key={c.id}><Link to={`/produtos/${c.id}`} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm hover:bg-surface">
                        <span className="min-w-0 truncate font-medium">{c.name}</span>
                        <span className="shrink-0 text-right">
                          <Badge tone={c.status === 'out' ? 'danger' : 'warning'}>{formatQty(c.quantity, c.unit)}</Badge>
                          <span className="ml-1.5 text-[12px] text-ink-muted">mín. {formatQty(c.min_stock)}</span>
                        </span>
                      </Link></li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Validade" description={`Alertas: ${store.expiry_alert_days.join(', ')} dias`} action={<Link to="/estoque?aba=lotes" className="text-[13px] font-medium text-acai-700 hover:underline">Ver lotes</Link>} />
              <CardBody className="px-0 pb-2">
                {k.expired_lots > 0 && (
                  <p className="mx-5 mb-2 flex items-center gap-2 rounded-xl bg-red-50 px-3 py-2 text-[13px] text-red-700"><CalendarClock className="h-4 w-4" />{k.expired_lots} lote(s) vencido(s) — registre a baixa.</p>
                )}
                {data.expiring.length === 0 ? <p className="px-5 pb-3 text-sm text-ink-muted">Nenhum lote próximo do vencimento.</p> : (
                  <ul className="divide-y divide-line">
                    {data.expiring.map((l) => (
                      <li key={l.lot_id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{l.name}</span>
                          <span className="text-[12px] text-ink-muted">{l.lot_code ? `Lote ${l.lot_code} · ` : ''}{formatQty(l.remaining, l.unit)}</span>
                        </span>
                        <Badge tone={l.days < 0 ? 'danger' : l.days <= 7 ? 'warning' : 'info'}>
                          {l.days < 0 ? `Venceu ${formatDate(l.expiry_date)}` : l.days === 0 ? 'Vence hoje' : `${l.days} dia(s)`}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Últimas movimentações" action={<Link to="/movimentacoes" className="text-[13px] font-medium text-acai-700 hover:underline">Histórico</Link>} />
              <CardBody className="px-0 pb-2">
                {data.recent.length === 0 ? <p className="px-5 pb-3 text-sm text-ink-muted">Nenhuma movimentação ainda.</p> : (
                  <ul className="divide-y divide-line">
                    {data.recent.map((m) => (
                      <li key={m.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                        <span className={cn('rounded-lg p-1.5', m.direction === 'in' ? 'bg-leaf-50 text-leaf-700' : 'bg-acai-50 text-acai-700')} aria-label={m.direction === 'in' ? 'Entrada' : 'Saída'}>
                          {m.direction === 'in' ? <ArrowDownToLine className="h-3.5 w-3.5" /> : <ArrowUpFromLine className="h-3.5 w-3.5" />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{m.product}</span>
                          <span className="text-[12px] text-ink-muted">{REASON_LABEL[m.reason]} · {formatDateTime(m.occurred_at)}{m.user ? ` · ${m.user}` : ''}</span>
                        </span>
                        <span className="shrink-0 font-semibold tabular">{m.direction === 'in' ? '+' : '−'}{formatQty(m.quantity, m.unit)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
