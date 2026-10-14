import { useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import * as D from '@radix-ui/react-dialog';
import {
  ArrowDownToLine, ArrowUpFromLine, BarChart3, Boxes, ChevronDown, LayoutDashboard, LogOut, Menu, Package, Plus,
  ReceiptText, Settings, ShoppingCart, Truck, X, History,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useQuickActions } from '@/contexts/QuickActions';
import { ROLE_LABEL } from '@/lib/labels';
import { cn } from '@/lib/utils';

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/estoque', label: 'Estoque', icon: Boxes },
  { to: '/produtos', label: 'Produtos e insumos', icon: Package },
  { to: '/movimentacoes', label: 'Movimentações', icon: History },
  { to: '/vendas', label: 'Vendas', icon: ReceiptText },
  { to: '/compras', label: 'Compras', icon: ShoppingCart },
  { to: '/fornecedores', label: 'Fornecedores', icon: Truck },
  { to: '/relatorios', label: 'Relatórios', icon: BarChart3 },
  { to: '/configuracoes', label: 'Usuários e configurações', icon: Settings },
];

function Brand({ compact }: { compact?: boolean }) {
  const { store } = useAuth();
  return (
    <div className="flex items-center gap-3">
      <img src="/brand/logo-mark.png" alt="Açaí Everest" className={cn('rounded-xl ring-1 ring-white/15', compact ? 'h-9 w-9' : 'h-11 w-11')} />
      <div className="min-w-0 leading-tight">
        <div className="truncate text-[15px] font-bold text-white">{store?.name ?? 'Açaí Everest'}</div>
        <div className="text-[11.5px] font-medium uppercase tracking-wider text-acai-200">Gestão da loja</div>
      </div>
    </div>
  );
}

function NavItems({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="space-y-0.5" aria-label="Menu principal">
      {NAV.map((n) => (
        <NavLink
          key={n.to}
          to={n.to}
          end={n.end}
          onClick={onNavigate}
          className={({ isActive }) => cn(
            'flex items-center gap-3 rounded-xl px-3 py-2.5 text-[14px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mango-400',
            isActive ? 'bg-white/10 text-white shadow-[inset_3px_0_0_theme(colors.mango.400)]' : 'text-acai-100/80 hover:bg-white/5 hover:text-white',
          )}
        >
          <n.icon className="h-[18px] w-[18px] shrink-0" aria-hidden />
          {n.label}
        </NavLink>
      ))}
    </nav>
  );
}

function UserBox() {
  const { profile, role, signOut, memberships, store, setStoreId } = useAuth();
  return (
    <div className="space-y-2 border-t border-white/10 pt-3">
      {memberships.length > 1 && (
        <label className="block">
          <span className="sr-only">Loja</span>
          <div className="relative">
            <select
              value={store?.id}
              onChange={(e) => setStoreId(e.target.value)}
              className="w-full appearance-none rounded-lg bg-white/10 px-3 py-2 pr-8 text-[13px] text-white focus:outline-none focus:ring-2 focus:ring-mango-400"
            >
              {memberships.map((m) => <option key={m.store.id} value={m.store.id} className="text-ink">{m.store.name}</option>)}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-white/60" />
          </div>
        </label>
      )}
      <div className="flex items-center gap-3 px-1">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-mango-400 text-sm font-bold text-acai-950">
          {(profile?.full_name || profile?.email || '?').slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate text-[13px] font-semibold text-white">{profile?.full_name || profile?.email}</div>
          <div className="text-[11.5px] text-acai-200">{role ? ROLE_LABEL[role] : ''}</div>
        </div>
        <button onClick={signOut} className="rounded-lg p-2 text-acai-200 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mango-400" aria-label="Sair" title="Sair">
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

/** Ações rápidas: entrada, saída, venda, produto */
function QuickSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { openMovement } = useQuickActions();
  const { isAdmin } = useAuth();
  const navigate = useNavigate();
  const items = [
    { label: 'Registrar entrada', desc: 'Chegou mercadoria', icon: ArrowDownToLine, tone: 'bg-leaf-100 text-leaf-700', run: () => openMovement('in') },
    { label: 'Registrar saída', desc: 'Consumo, perda, vencido…', icon: ArrowUpFromLine, tone: 'bg-acai-100 text-acai-700', run: () => openMovement('out') },
    { label: 'Lançar venda', desc: 'Registrar uma venda', icon: ReceiptText, tone: 'bg-mango-100 text-mango-700', run: () => navigate('/vendas/nova') },
    ...(isAdmin ? [{ label: 'Adicionar produto', desc: 'Novo item no cadastro', icon: Package, tone: 'bg-turq-50 text-turq-700', run: () => navigate('/produtos?novo=1') }] : []),
  ];
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-acai-950/40 data-[state=open]:animate-[fadeIn_120ms_ease-out]" />
        <D.Content className="fixed inset-x-0 bottom-0 z-50 rounded-t-2xl bg-white px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3 shadow-pop data-[state=open]:animate-[sheetUp_180ms_ease-out] focus:outline-none">
          <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-gray-300" aria-hidden />
          <D.Title className="mb-2 px-1 text-[15px] font-semibold">O que você quer fazer?</D.Title>
          <D.Description className="sr-only">Ações rápidas</D.Description>
          <div className="grid grid-cols-2 gap-2">
            {items.map((i) => (
              <button key={i.label} onClick={() => { onOpenChange(false); i.run(); }}
                className="flex flex-col items-start gap-2 rounded-2xl border border-line p-3 text-left active:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acai-400">
                <span className={cn('rounded-xl p-2', i.tone)}><i.icon className="h-5 w-5" /></span>
                <span>
                  <span className="block text-[14px] font-semibold text-ink">{i.label}</span>
                  <span className="block text-[12px] text-ink-muted">{i.desc}</span>
                </span>
              </button>
            ))}
          </div>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

export function AppLayout() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const location = useLocation();
  const { openMovement } = useQuickActions();
  const navigate = useNavigate();

  const bottom = [
    { to: '/', label: 'Início', icon: LayoutDashboard, end: true },
    { to: '/estoque', label: 'Estoque', icon: Boxes },
    null,
    { to: '/vendas', label: 'Vendas', icon: ReceiptText },
  ];

  return (
    <div className="min-h-dvh lg:pl-64">
      <a href="#conteudo" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded-lg focus:bg-white focus:px-3 focus:py-2">Pular para o conteúdo</a>

      {/* Sidebar desktop */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col bg-acai-900 px-3 py-4 lg:flex">
        <div className="px-2 pb-5"><Brand /></div>
        <div className="flex-1 overflow-y-auto"><NavItems /></div>
        <UserBox />
      </aside>

      {/* Topo compacto */}
      <header className="sticky top-0 z-30 flex items-center justify-between bg-acai-900 px-4 pb-2.5 pt-[calc(0.625rem+env(safe-area-inset-top))] lg:hidden">
        <Brand compact />
        <button onClick={() => setMenuOpen(true)} className="rounded-lg p-2 text-white hover:bg-white/10" aria-label="Abrir menu">
          <Menu className="h-6 w-6" />
        </button>
      </header>

      {/* Barra de ações no desktop */}
      <div className="sticky top-0 z-20 hidden items-center justify-end gap-2 border-b border-line bg-surface/85 px-8 py-3 backdrop-blur lg:flex">
        <button onClick={() => openMovement('in')} className="inline-flex h-9 items-center gap-2 rounded-xl bg-leaf-500 px-3.5 text-[13px] font-semibold text-white hover:bg-leaf-600">
          <ArrowDownToLine className="h-4 w-4" />Registrar entrada
        </button>
        <button onClick={() => openMovement('out')} className="inline-flex h-9 items-center gap-2 rounded-xl bg-acai-700 px-3.5 text-[13px] font-semibold text-white hover:bg-acai-800">
          <ArrowUpFromLine className="h-4 w-4" />Registrar saída
        </button>
        <button onClick={() => navigate('/vendas/nova')} className="inline-flex h-9 items-center gap-2 rounded-xl bg-mango-400 px-3.5 text-[13px] font-semibold text-acai-950 hover:bg-[#EFBD33]">
          <ReceiptText className="h-4 w-4" />Lançar venda
        </button>
      </div>

      <main id="conteudo" key={location.pathname} className="mx-auto max-w-7xl px-4 pb-28 pt-5 sm:px-6 lg:px-8 lg:pb-12 lg:pt-6">
        <Outlet />
      </main>

      {/* Navegação inferior */}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden" aria-label="Navegação rápida">
        <div className="grid grid-cols-5">
          {bottom.map((b, i) => b ? (
            <NavLink key={b.to} to={b.to} end={b.end}
              className={({ isActive }) => cn('flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium', isActive ? 'text-acai-700' : 'text-ink-soft')}>
              <b.icon className="h-[22px] w-[22px]" />{b.label}
            </NavLink>
          ) : (
            <div key={i} className="flex justify-center">
              <button onClick={() => setQuickOpen(true)} aria-label="Ações rápidas"
                className="-mt-5 flex h-14 w-14 items-center justify-center rounded-full bg-acai-700 text-white shadow-pop ring-4 ring-white active:bg-acai-800">
                <Plus className="h-7 w-7" />
              </button>
            </div>
          ))}
          <button onClick={() => setMenuOpen(true)} className="flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium text-ink-soft">
            <Menu className="h-[22px] w-[22px]" />Menu
          </button>
        </div>
      </nav>

      {/* Menu lateral compacto */}
      <D.Root open={menuOpen} onOpenChange={setMenuOpen}>
        <D.Portal>
          <D.Overlay className="fixed inset-0 z-50 bg-acai-950/50 lg:hidden" />
          <D.Content className="fixed inset-y-0 right-0 z-50 flex w-[86%] max-w-xs flex-col bg-acai-900 px-3 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-[calc(1rem+env(safe-area-inset-top))] focus:outline-none lg:hidden">
            <div className="mb-4 flex items-center justify-between px-2">
              <D.Title className="text-sm font-semibold uppercase tracking-wider text-acai-200">Menu</D.Title>
              <D.Description className="sr-only">Navegação principal</D.Description>
              <D.Close className="rounded-lg p-1.5 text-white hover:bg-white/10" aria-label="Fechar menu"><X className="h-5 w-5" /></D.Close>
            </div>
            <div className="flex-1 overflow-y-auto"><NavItems onNavigate={() => setMenuOpen(false)} /></div>
            <UserBox />
          </D.Content>
        </D.Portal>
      </D.Root>

      <QuickSheet open={quickOpen} onOpenChange={setQuickOpen} />
    </div>
  );
}
