import { AuthShell } from './AuthShell';

/** Exibida quando o app foi publicado sem as variáveis do Supabase. */
export function SetupMissingPage() {
  return (
    <AuthShell title="Configuração pendente" subtitle="O sistema ainda não está conectado ao banco de dados.">
      <div className="space-y-3 rounded-2xl border border-line bg-white p-5 text-sm text-ink-muted">
        <p>Defina as variáveis <code className="rounded bg-surface px-1">VITE_SUPABASE_URL</code> e <code className="rounded bg-surface px-1">VITE_SUPABASE_ANON_KEY</code> no arquivo <code className="rounded bg-surface px-1">.env.local</code> (ou no painel da hospedagem) e gere o app novamente.</p>
        <p>O passo a passo completo está no arquivo <b>README.md</b>, seção “Configurar o Supabase”.</p>
      </div>
    </AuthShell>
  );
}
