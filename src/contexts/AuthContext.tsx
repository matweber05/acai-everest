import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import type { MemberRole, Profile, Store } from '@/types/db';

interface Membership { store: Store; role: MemberRole }

interface AuthState {
  loading: boolean;
  session: Session | null;
  profile: Profile | null;
  memberships: Membership[];
  store: Store | null;
  role: MemberRole | null;
  isAdmin: boolean;
  recovering: boolean;
  setStoreId: (id: string) => void;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);
const STORE_KEY = 'acai.currentStore';

function readStoreKey() { try { return localStorage.getItem(STORE_KEY); } catch { return null; } }
function writeStoreKey(v: string) { try { localStorage.setItem(STORE_KEY, v); } catch { /* sem armazenamento */ } }

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [storeId, setStoreIdState] = useState<string | null>(readStoreKey());
  const [recovering, setRecovering] = useState(false);

  const loadUserData = useCallback(async (s: Session | null) => {
    if (!s) { setProfile(null); setMemberships([]); return; }
    const [{ data: prof }, { data: mem, error }] = await Promise.all([
      supabase.from('profiles').select('id, full_name, email').eq('id', s.user.id).maybeSingle(),
      supabase.from('store_members').select('role, stores(*)').eq('user_id', s.user.id).eq('active', true),
    ]);
    if (error) throw error;
    setProfile(prof as Profile | null);
    const list = ((mem ?? []) as unknown as { role: MemberRole; stores: Store }[])
      .filter((m) => m.stores)
      .map((m) => ({ store: m.stores, role: m.role }))
      .sort((a, b) => a.store.name.localeCompare(b.store.name));
    setMemberships(list);
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured) { setLoading(false); return; }
    let alive = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!alive) return;
      setSession(data.session);
      try { await loadUserData(data.session); } finally { if (alive) setLoading(false); }
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'PASSWORD_RECOVERY') setRecovering(true);
      if (event === 'TOKEN_REFRESHED') { setSession(s); return; }
      setSession(s);
      // fora do callback para não travar o cliente de auth
      setTimeout(() => { loadUserData(s).catch(() => undefined); }, 0);
    });
    return () => { alive = false; sub.subscription.unsubscribe(); };
  }, [loadUserData]);

  const current = memberships.find((m) => m.store.id === storeId) ?? memberships[0] ?? null;

  const value = useMemo<AuthState>(() => ({
    loading,
    session,
    profile,
    memberships,
    store: current?.store ?? null,
    role: current?.role ?? null,
    isAdmin: current?.role === 'admin',
    recovering,
    setStoreId: (id) => { writeStoreKey(id); setStoreIdState(id); },
    refresh: () => loadUserData(session),
    signOut: async () => { await supabase.auth.signOut(); setRecovering(false); },
  }), [loading, session, profile, memberships, current, recovering, loadUserData]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth fora do AuthProvider');
  return v;
}

/** Loja atual (garantida dentro das rotas protegidas). */
export function useStore() {
  const { store, role, isAdmin } = useAuth();
  if (!store) throw new Error('Nenhuma loja selecionada');
  return { store, storeId: store.id, role: role!, isAdmin };
}

/** Linhas por página preferidas (Configurações > Alertas e regras). */
export function usePageSize(fallback = 25) {
  const ctx = useContext(Ctx);
  return ctx?.store?.display_prefs?.page_size ?? fallback;
}
