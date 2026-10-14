import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { MovementDialog } from '@/features/movements/MovementDialog';
import type { Direction } from '@/types/db';

interface QuickActionsApi { openMovement: (direction: Direction, productId?: string) => void }
const Ctx = createContext<QuickActionsApi | null>(null);

/** Disponibiliza "Registrar entrada/saída" em qualquer tela. */
export function QuickActionsProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ open: boolean; direction: Direction; productId?: string }>({ open: false, direction: 'in' });
  const openMovement = useCallback((direction: Direction, productId?: string) => setState({ open: true, direction, productId }), []);
  const api = useMemo(() => ({ openMovement }), [openMovement]);
  return (
    <Ctx.Provider value={api}>
      {children}
      <MovementDialog open={state.open} direction={state.direction} productId={state.productId}
        onOpenChange={(open) => setState((s) => ({ ...s, open }))} />
    </Ctx.Provider>
  );
}

export function useQuickActions() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useQuickActions fora do provider');
  return v;
}
