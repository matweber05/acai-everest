import { lazy, Suspense, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { QuickActionsProvider } from '@/contexts/QuickActions';
import { isSupabaseConfigured } from '@/lib/supabase';
import { isNetworkError } from '@/lib/errors';
import { AppLayout } from '@/components/layout/AppLayout';
import { Spinner } from '@/components/ui/misc';
import { LoginPage } from '@/features/auth/LoginPage';
import { SignUpPage } from '@/features/auth/SignUpPage';
import { ForgotPasswordPage } from '@/features/auth/ForgotPasswordPage';
import { ResetPasswordPage } from '@/features/auth/ResetPasswordPage';
import { OnboardingPage } from '@/features/auth/OnboardingPage';
import { SetupMissingPage } from '@/features/auth/SetupMissingPage';

const DashboardPage = lazy(() => import('@/features/dashboard/DashboardPage'));
const StockPage = lazy(() => import('@/features/stock/StockPage'));
const InventoryListPage = lazy(() => import('@/features/inventory/InventoryListPage'));
const InventoryCountPage = lazy(() => import('@/features/inventory/InventoryCountPage'));
const ProductsPage = lazy(() => import('@/features/products/ProductsPage'));
const ProductDetailPage = lazy(() => import('@/features/products/ProductDetailPage'));
const MovementsPage = lazy(() => import('@/features/movements/MovementsPage'));
const SalesPage = lazy(() => import('@/features/sales/SalesPage'));
const NewSalePage = lazy(() => import('@/features/sales/NewSalePage'));
const SaleDetailPage = lazy(() => import('@/features/sales/SaleDetailPage'));
const PurchasesPage = lazy(() => import('@/features/purchases/PurchasesPage'));
const PurchaseFormPage = lazy(() => import('@/features/purchases/PurchaseFormPage'));
const PurchaseDetailPage = lazy(() => import('@/features/purchases/PurchaseDetailPage'));
const SuppliersPage = lazy(() => import('@/features/suppliers/SuppliersPage'));
const ReportsPage = lazy(() => import('@/features/reports/ReportsPage'));
const SettingsPage = lazy(() => import('@/features/settings/SettingsPage'));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: true,
      // só tenta de novo quando o problema é de rede
      retry: (count, err) => isNetworkError(err) && count < 3,
    },
    mutations: { retry: false },
  },
});

function RequireAuth({ children }: { children: ReactNode }) {
  const { loading, session, store, recovering } = useAuth();
  const location = useLocation();
  if (loading) return <Spinner className="min-h-dvh" label="Abrindo o sistema…" />;
  if (!session) return <Navigate to="/entrar" replace state={{ from: location.pathname }} />;
  if (recovering) return <Navigate to="/redefinir-senha" replace />;
  if (!store) return <Navigate to="/bem-vindo" replace />;
  return <QuickActionsProvider>{children}</QuickActionsProvider>;
}

/** Rotas exclusivas de administrador (o banco também bloqueia). */
function AdminOnly({ children }: { children: ReactNode }) {
  const { isAdmin } = useAuth();
  if (!isAdmin) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export default function App() {
  if (!isSupabaseConfigured) return <SetupMissingPage />;
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Suspense fallback={<Spinner className="min-h-[50vh]" />}>
            <Routes>
              <Route path="/entrar" element={<LoginPage />} />
              <Route path="/criar-conta" element={<SignUpPage />} />
              <Route path="/esqueci-senha" element={<ForgotPasswordPage />} />
              <Route path="/redefinir-senha" element={<ResetPasswordPage />} />
              <Route path="/bem-vindo" element={<OnboardingPage />} />
              <Route element={<RequireAuth><AppLayout /></RequireAuth>}>
                <Route index element={<DashboardPage />} />
                <Route path="estoque" element={<StockPage />} />
                <Route path="estoque/inventario" element={<InventoryListPage />} />
                <Route path="estoque/inventario/:id" element={<InventoryCountPage />} />
                <Route path="produtos" element={<ProductsPage />} />
                <Route path="produtos/:id" element={<ProductDetailPage />} />
                <Route path="movimentacoes" element={<MovementsPage />} />
                <Route path="vendas" element={<SalesPage />} />
                <Route path="vendas/nova" element={<NewSalePage />} />
                <Route path="vendas/:id" element={<SaleDetailPage />} />
                <Route path="compras" element={<PurchasesPage />} />
                <Route path="compras/nova" element={<PurchaseFormPage />} />
                <Route path="compras/:id/editar" element={<PurchaseFormPage />} />
                <Route path="compras/:id" element={<PurchaseDetailPage />} />
                <Route path="fornecedores" element={<SuppliersPage />} />
                <Route path="relatorios" element={<ReportsPage />} />
                <Route path="configuracoes" element={<SettingsPage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            </Routes>
          </Suspense>
        </BrowserRouter>
        <Toaster position="top-center" richColors closeButton toastOptions={{ duration: 4500 }} />
      </AuthProvider>
    </QueryClientProvider>
  );
}

export { AdminOnly };
