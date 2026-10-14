import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** true quando as variáveis de ambiente do Supabase foram configuradas */
export const isSupabaseConfigured = Boolean(url && anonKey && !url.includes('SEU-PROJETO'));

const fallbackUrl = 'https://example.supabase.co';
const fallbackAnonKey = 'missing-key';

// Apenas a chave pública (anon). A service_role NUNCA deve ir para o app.
export const supabase = createClient(url ?? fallbackUrl, anonKey ?? fallbackAnonKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});
