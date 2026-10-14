// Tratamento centralizado de erros: transforma erros técnicos em mensagens claras.
// Nunca expõe detalhes sensíveis (tokens, SQL) ao usuário.

interface PgLikeError { message?: string; code?: string; details?: string; hint?: string; status?: number }

const KNOWN: { test: (e: PgLikeError) => boolean; msg: string }[] = [
  { test: (e) => e.code === '23505' && /sku/i.test(e.message ?? ''), msg: 'Já existe um item com este SKU/código.' },
  { test: (e) => e.code === '23505' && /barcode/i.test(e.message ?? ''), msg: 'Já existe um item com este código de barras.' },
  { test: (e) => e.code === '23505' && /categories/i.test(e.message ?? ''), msg: 'Já existe uma categoria com este nome.' },
  { test: (e) => e.code === '23505' && /units/i.test(e.message ?? ''), msg: 'Já existe uma unidade com este código.' },
  { test: (e) => e.code === '23505', msg: 'Este registro já existe.' },
  { test: (e) => e.code === '23503', msg: 'Este registro está em uso e não pode ser removido.' },
  { test: (e) => e.code === '23514', msg: 'Algum valor informado é inválido. Revise os campos.' },
  { test: (e) => e.code === '42501' && /row-level security/i.test(e.message ?? ''), msg: 'Você não tem permissão para esta operação.' },
  { test: (e) => /permission denied/i.test(e.message ?? ''), msg: 'Você não tem permissão para esta operação.' },
  { test: (e) => /JWT|token is expired|refresh_token/i.test(e.message ?? ''), msg: 'Sua sessão expirou. Entre novamente.' },
  { test: (e) => /Invalid login credentials/i.test(e.message ?? ''), msg: 'E-mail ou senha incorretos.' },
  { test: (e) => /Email not confirmed/i.test(e.message ?? ''), msg: 'Confirme seu e-mail pelo link enviado antes de entrar.' },
  { test: (e) => /User already registered/i.test(e.message ?? ''), msg: 'Este e-mail já tem cadastro. Use "Entrar" ou "Esqueci minha senha".' },
  { test: (e) => /Password should be/i.test(e.message ?? ''), msg: 'A senha precisa ter pelo menos 8 caracteres.' },
  { test: (e) => /rate limit|too many/i.test(e.message ?? ''), msg: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.' },
  { test: (e) => /Failed to fetch|NetworkError|Load failed|network/i.test(e.message ?? ''), msg: 'Sem conexão com o servidor. Verifique a internet e tente novamente.' },
];

/** Mensagens de regra de negócio lançadas pelo banco já estão em português. */
const BUSINESS_CODES = new Set(['P0001', 'P0002', '22023', '28000', '42501']);

export function errorMessage(err: unknown): string {
  if (!err) return 'Ocorreu um erro inesperado.';
  const e = (typeof err === 'object' ? err : { message: String(err) }) as PgLikeError;
  const msg = e.message ?? '';
  if (e.code && BUSINESS_CODES.has(e.code) && msg && !/row-level|permission denied/i.test(msg)) return msg;
  for (const k of KNOWN) if (k.test(e)) return k.msg;
  if (e.message && /[áéíóúãõçÁÉÍÓÚ]/.test(e.message) && e.message.length < 300) return e.message;
  if (import.meta.env?.DEV) console.error('[erro]', e.code, e.message);
  return 'Não foi possível concluir a operação. Tente novamente.';
}

export function isNetworkError(err: unknown) {
  const m = (err as PgLikeError)?.message ?? '';
  return /Failed to fetch|NetworkError|Load failed/i.test(m);
}
