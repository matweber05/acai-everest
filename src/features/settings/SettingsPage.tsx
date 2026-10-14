import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Database, ImagePlus, Plus, ShieldCheck, Trash2, UserPlus } from 'lucide-react';
import { useAuth, useStore } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { useAuditLogs, useCategories, useInvites, useMembers, useRpc, useUnits, useWrite } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { ROLE_LABEL } from '@/lib/labels';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Field, Input, Select, Switch } from '@/components/ui/form';
import { ConfirmDialog } from '@/components/ui/confirm';
import { PageHeader, Spinner } from '@/components/ui/misc';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import type { MemberRole } from '@/types/db';

type Tab = 'loja' | 'alertas' | 'cadastros' | 'usuarios' | 'perfil' | 'dados';

function StoreTab() {
  const { store, storeId, isAdmin } = useStore();
  const { refresh } = useAuth();
  const [form, setForm] = useState({ name: store.name, legal_name: store.legal_name ?? '', phone: store.phone ?? '', address: store.address ?? '', timezone: store.timezone });
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const save = useWrite((v: Record<string, unknown>) => supabase.from('stores').update(v).eq('id', storeId).select('id').single());
  const logoUrl = store.logo_path ? supabase.storage.from('store-assets').getPublicUrl(store.logo_path).data.publicUrl : '/brand/logo-mark.png';

  async function onSave() {
    if (form.name.trim().length < 2) return toast.error('Informe o nome da loja.');
    try { await save.mutateAsync({ ...form, name: form.name.trim(), legal_name: form.legal_name || null, phone: form.phone || null, address: form.address || null }); await refresh(); toast.success('Dados da loja salvos'); }
    catch (e) { toast.error(errorMessage(e)); }
  }
  async function onLogo(file: File) {
    if (file.size > 2 * 1024 * 1024) return toast.error('A imagem deve ter no máximo 2 MB.');
    setUploading(true);
    try {
      const path = `${storeId}/logo-${Date.now()}.${file.name.split('.').pop()?.toLowerCase() ?? 'png'}`;
      const { error } = await supabase.storage.from('store-assets').upload(path, file, { upsert: true, contentType: file.type });
      if (error) throw error;
      await save.mutateAsync({ logo_path: path });
      await refresh();
      toast.success('Logo atualizado');
    } catch (e) { toast.error(errorMessage(e)); } finally { setUploading(false); }
  }

  return (
    <Card>
      <CardHeader title="Dados da loja" description={isAdmin ? undefined : 'Somente administradores podem alterar.'} />
      <CardBody className="space-y-4">
        <div className="flex items-center gap-4">
          <img src={logoUrl} alt="Logo da loja" className="h-16 w-16 rounded-2xl object-cover ring-1 ring-line" />
          {isAdmin && (
            <>
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => e.target.files?.[0] && onLogo(e.target.files[0])} />
              <Button variant="secondary" onClick={() => fileRef.current?.click()} loading={uploading}><ImagePlus className="h-4 w-4" />Trocar logo</Button>
            </>
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nome da loja" required>{(a) => <Input {...a} disabled={!isAdmin} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />}</Field>
          <Field label="Razão social">{(a) => <Input {...a} disabled={!isAdmin} value={form.legal_name} onChange={(e) => setForm({ ...form, legal_name: e.target.value })} />}</Field>
          <Field label="Telefone">{(a) => <Input {...a} disabled={!isAdmin} inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />}</Field>
          <Field label="Fuso horário" hint="Datas são gravadas em UTC e exibidas neste fuso.">
            {(a) => (
              <Select {...a} disabled={!isAdmin} value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })}>
                <option value="America/Sao_Paulo">Brasília (America/Sao_Paulo)</option>
                <option value="America/Manaus">Manaus (America/Manaus)</option>
                <option value="America/Belem">Belém (America/Belem)</option>
                <option value="America/Fortaleza">Fortaleza (America/Fortaleza)</option>
                <option value="America/Cuiaba">Cuiabá (America/Cuiaba)</option>
              </Select>
            )}
          </Field>
          <Field label="Endereço" className="sm:col-span-2">{(a) => <Input {...a} disabled={!isAdmin} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />}</Field>
        </div>
        {isAdmin && <div className="flex justify-end"><Button onClick={onSave} loading={save.isPending}>Salvar</Button></div>}
      </CardBody>
    </Card>
  );
}

function AlertsTab() {
  const { store, storeId, isAdmin } = useStore();
  const { refresh } = useAuth();
  const [days, setDays] = useState(store.expiry_alert_days.join(', '));
  const [lowAlerts, setLowAlerts] = useState(store.low_stock_alerts);
  const [negative, setNegative] = useState(store.allow_negative_stock);
  const [pageSize, setPageSize] = useState(String(store.display_prefs?.page_size ?? 25));
  const [confirmNeg, setConfirmNeg] = useState(false);
  const save = useWrite((v: Record<string, unknown>) => supabase.from('stores').update(v).eq('id', storeId).select('id').single());

  async function onSave() {
    const list = [...new Set(days.split(/[,;\s]+/).map((d) => parseInt(d, 10)).filter((d) => d > 0 && d < 366))].sort((a, b) => a - b);
    if (!list.length || list.length > 5) return toast.error('Informe de 1 a 5 prazos em dias (ex.: 7, 15, 30).');
    try {
      await save.mutateAsync({ expiry_alert_days: list, low_stock_alerts: lowAlerts, allow_negative_stock: negative, display_prefs: { ...store.display_prefs, page_size: Number(pageSize) } });
      await refresh();
      setDays(list.join(', '));
      toast.success('Preferências salvas');
    } catch (e) { toast.error(errorMessage(e)); }
  }

  return (
    <Card>
      <CardHeader title="Alertas e regras de estoque" description={isAdmin ? undefined : 'Somente administradores podem alterar.'} />
      <CardBody className="space-y-5">
        <Field label="Alertar vencimento com antecedência de (dias)" hint="Separe por vírgula. Padrão: 7, 15, 30.">
          {(a) => <Input {...a} disabled={!isAdmin} value={days} onChange={(e) => setDays(e.target.value)} className="max-w-xs" />}
        </Field>
        <Switch disabled={!isAdmin} checked={lowAlerts} onChange={setLowAlerts} label="Alertas de estoque mínimo" description="Destaca no painel os itens abaixo do mínimo." />
        <div className={cn('rounded-xl p-3', negative ? 'bg-red-50' : 'bg-surface')}>
          <Switch disabled={!isAdmin} checked={negative} onChange={(v) => (v ? setConfirmNeg(true) : setNegative(false))}
            label="Permitir estoque negativo (exceção)" description="Por padrão, saídas maiores que o saldo são bloqueadas. Se ativar, cada saída que deixar o saldo negativo fica registrada na auditoria." />
        </div>
        <Field label="Linhas por página nas tabelas">
          {(a) => <Select {...a} disabled={!isAdmin} value={pageSize} onChange={(e) => setPageSize(e.target.value)} className="max-w-[160px]"><option>20</option><option>25</option><option>50</option></Select>}
        </Field>
        {isAdmin && <div className="flex justify-end"><Button onClick={onSave} loading={save.isPending}>Salvar preferências</Button></div>}
      </CardBody>
      <ConfirmDialog open={confirmNeg} onOpenChange={setConfirmNeg} title="Permitir estoque negativo?"
        message="Isso pode esconder erros de lançamento. Use apenas temporariamente (ex.: mercadoria chegou e a nota será lançada depois). Todas as ocorrências ficam auditadas."
        confirmLabel="Permitir" onConfirm={() => { setNegative(true); setConfirmNeg(false); }} />
    </Card>
  );
}

function CatalogTab() {
  const { storeId, isAdmin } = useStore();
  const { data: categories = [] } = useCategories(storeId);
  const { data: units = [] } = useUnits(storeId);
  const [cat, setCat] = useState('');
  const [unit, setUnit] = useState({ code: '', name: '', allows_decimal: true });
  const write = useWrite((fn: () => PromiseLike<{ data: unknown; error: unknown }>) => fn());

  async function run(fn: () => PromiseLike<{ data: unknown; error: unknown }>, ok: string) {
    try { await write.mutateAsync(fn); toast.success(ok); return true; } catch (e) { toast.error(errorMessage(e)); return false; }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card>
        <CardHeader title="Categorias" description="Organizam produtos e relatórios." />
        <CardBody className="space-y-3">
          {isAdmin && (
            <form className="flex gap-2" onSubmit={async (e) => { e.preventDefault(); if (cat.trim().length < 1) return; if (await run(() => supabase.from('categories').insert({ store_id: storeId, name: cat.trim(), sort_order: categories.length + 1 }).select('id'), 'Categoria criada')) setCat(''); }}>
              <Input placeholder="Nova categoria" value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Nome da nova categoria" />
              <Button type="submit" disabled={!cat.trim()}><Plus className="h-4 w-4" />Adicionar</Button>
            </form>
          )}
          <ul className="divide-y divide-line rounded-xl border border-line">
            {categories.map((c) => (
              <li key={c.id} className="flex items-center gap-2 px-3 py-2">
                <span className="h-3 w-3 rounded-full" style={{ background: c.color ?? '#A3A3A3' }} aria-hidden />
                {isAdmin ? (
                  <input defaultValue={c.name} aria-label={`Nome da categoria ${c.name}`} className="flex-1 rounded-md bg-transparent px-1 py-1 text-sm focus:bg-white focus:outline-none focus:ring-2 focus:ring-acai-100"
                    onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== c.name) run(() => supabase.from('categories').update({ name: v }).eq('id', c.id).select('id'), 'Categoria renomeada'); }} />
                ) : <span className="flex-1 text-sm">{c.name}</span>}
                {!c.active && <Badge>Inativa</Badge>}
                {isAdmin && <Button size="sm" variant="ghost" onClick={() => run(() => supabase.from('categories').update({ active: !c.active }).eq('id', c.id).select('id'), c.active ? 'Categoria inativada' : 'Categoria reativada')}>{c.active ? 'Inativar' : 'Reativar'}</Button>}
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Unidades de medida" description="“Aceita fração” permite quantidades como 0,350 kg." />
        <CardBody className="space-y-3">
          {isAdmin && (
            <form className="grid grid-cols-[90px_1fr_auto] gap-2" onSubmit={async (e) => { e.preventDefault(); if (!unit.code.trim() || !unit.name.trim()) return; if (await run(() => supabase.from('units').insert({ store_id: storeId, ...unit, code: unit.code.trim(), name: unit.name.trim() }).select('id'), 'Unidade criada')) setUnit({ code: '', name: '', allows_decimal: true }); }}>
              <Input placeholder="Sigla" value={unit.code} onChange={(e) => setUnit({ ...unit, code: e.target.value })} aria-label="Sigla da unidade" maxLength={12} />
              <Input placeholder="Nome (ex.: Balde)" value={unit.name} onChange={(e) => setUnit({ ...unit, name: e.target.value })} aria-label="Nome da unidade" />
              <Button type="submit" disabled={!unit.code.trim() || !unit.name.trim()}><Plus className="h-4 w-4" /></Button>
              <label className="col-span-3 flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-acai-700" checked={unit.allows_decimal} onChange={(e) => setUnit({ ...unit, allows_decimal: e.target.checked })} />Aceita fração</label>
            </form>
          )}
          <ul className="divide-y divide-line rounded-xl border border-line">
            {units.map((u) => (
              <li key={u.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                <span><b className="inline-block w-12">{u.code}</b>{u.name}</span>
                <span className="flex items-center gap-2">
                  <Badge tone={u.allows_decimal ? 'info' : 'neutral'}>{u.allows_decimal ? 'Fracionada' : 'Inteira'}</Badge>
                  {!u.active && <Badge>Inativa</Badge>}
                  {isAdmin && <Button size="sm" variant="ghost" onClick={() => run(() => supabase.from('units').update({ active: !u.active }).eq('id', u.id).select('id'), u.active ? 'Unidade inativada' : 'Unidade reativada')}>{u.active ? 'Inativar' : 'Reativar'}</Button>}
                </span>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}

function UsersTab() {
  const { storeId, isAdmin } = useStore();
  const { session } = useAuth();
  const { data: members = [], isLoading } = useMembers(storeId);
  const { data: invites = [] } = useInvites(storeId, isAdmin);
  const invite = useRpc<Record<string, unknown>, string>('invite_member');
  const write = useWrite((fn: () => PromiseLike<{ data: unknown; error: unknown }>) => fn());
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<MemberRole>('operator');

  async function onInvite(e: React.FormEvent) {
    e.preventDefault();
    try {
      const r = await invite.mutateAsync({ p_store: storeId, p_email: email, p_role: role });
      toast.success(r === 'added' ? 'Usuário adicionado à loja' : 'Convite registrado', {
        description: r === 'added' ? 'A pessoa já pode entrar com o e-mail e senha dela.' : 'Peça para a pessoa abrir o app e tocar em “Criar conta” usando este e-mail.',
      });
      setEmail('');
    } catch (err) { toast.error(errorMessage(err)); }
  }
  async function run(fn: () => PromiseLike<{ data: unknown; error: unknown }>, ok: string) {
    try { await write.mutateAsync(fn); toast.success(ok); } catch (e) { toast.error(errorMessage(e)); }
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title="Perfis de acesso" />
        <CardBody className="grid gap-3 text-sm sm:grid-cols-2">
          <div className="rounded-xl bg-acai-50 p-3"><b className="text-acai-800">Administrador(a)</b><p className="mt-1 text-ink-muted">Acesso completo: cadastros, preços, estornos, cancelamentos, configurações e usuários.</p></div>
          <div className="rounded-xl bg-surface p-3"><b>Operador(a)</b><p className="mt-1 text-ink-muted">Registra entradas, saídas, vendas, compras e inventário; consulta estoque e relatórios. Não altera cadastros, preços nem configurações.</p></div>
        </CardBody>
      </Card>
      {isAdmin && (
        <Card>
          <CardHeader title="Adicionar pessoa" description="Se a pessoa ainda não tem conta, ela entra na loja automaticamente ao se cadastrar com este e-mail." />
          <CardBody>
            <form onSubmit={onInvite} className="grid gap-2 sm:grid-cols-[1fr_200px_auto]">
              <Input type="email" placeholder="email@exemplo.com" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="E-mail" required />
              <Select value={role} onChange={(e) => setRole(e.target.value as MemberRole)} aria-label="Perfil">
                <option value="operator">Operador(a)</option><option value="admin">Administrador(a)</option>
              </Select>
              <Button type="submit" loading={invite.isPending}><UserPlus className="h-4 w-4" />Adicionar</Button>
            </form>
          </CardBody>
        </Card>
      )}
      <Card>
        <CardHeader title="Usuários da loja" />
        <CardBody className="px-0 pb-0">
          {isLoading ? <Spinner /> : (
            <Table>
              <THead><tr><TH>Pessoa</TH><TH>Perfil</TH><TH>Situação</TH>{isAdmin && <TH className="text-right">Ações</TH>}</tr></THead>
              <TBody>
                {members.map((m) => {
                  const me = m.user_id === session?.user.id;
                  return (
                    <TR key={m.user_id}>
                      <TD><div className="font-medium">{m.profiles?.full_name ?? '—'}{me && <Badge tone="acai" className="ml-1.5">você</Badge>}</div><div className="text-[12px] text-ink-muted">{m.profiles?.email}</div></TD>
                      <TD>
                        {isAdmin && !me ? (
                          <Select className="h-9 w-44" value={m.role} aria-label="Perfil"
                            onChange={(e) => run(() => supabase.from('store_members').update({ role: e.target.value }).eq('store_id', storeId).eq('user_id', m.user_id).select('user_id'), 'Perfil alterado')}>
                            <option value="operator">Operador(a)</option><option value="admin">Administrador(a)</option>
                          </Select>
                        ) : ROLE_LABEL[m.role]}
                      </TD>
                      <TD><Badge tone={m.active ? 'success' : 'neutral'}>{m.active ? 'Ativo' : 'Sem acesso'}</Badge></TD>
                      {isAdmin && (
                        <TD className="text-right">
                          {!me && <Button size="sm" variant="ghost" onClick={() => run(() => supabase.from('store_members').update({ active: !m.active }).eq('store_id', storeId).eq('user_id', m.user_id).select('user_id'), m.active ? 'Acesso removido' : 'Acesso liberado')}>{m.active ? 'Remover acesso' : 'Liberar acesso'}</Button>}
                        </TD>
                      )}
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          )}
          {isAdmin && invites.length > 0 && (
            <div className="border-t border-line p-4">
              <h3 className="mb-2 text-sm font-semibold">Convites pendentes</h3>
              <ul className="space-y-1">
                {invites.map((i) => (
                  <li key={i.id} className="flex items-center justify-between text-sm">
                    <span>{i.email} <span className="text-ink-muted">· {ROLE_LABEL[i.role]}</span></span>
                    <Button size="sm" variant="ghost" aria-label={`Cancelar convite de ${i.email}`} onClick={() => run(() => supabase.from('store_invites').delete().eq('id', i.id).select('id'), 'Convite cancelado')}><Trash2 className="h-4 w-4" /></Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function ProfileTab() {
  const { profile, session, refresh } = useAuth();
  const [name, setName] = useState(profile?.full_name ?? '');
  const [pwd, setPwd] = useState({ a: '', b: '' });
  const [busy, setBusy] = useState<'name' | 'pwd' | null>(null);
  useEffect(() => { setName(profile?.full_name ?? ''); }, [profile]);

  async function saveName() {
    setBusy('name');
    const { error } = await supabase.from('profiles').update({ full_name: name.trim() }).eq('id', session!.user.id);
    setBusy(null);
    if (error) return toast.error(errorMessage(error));
    await refresh(); toast.success('Nome atualizado');
  }
  async function savePwd() {
    if (pwd.a.length < 8) return toast.error('A senha precisa ter pelo menos 8 caracteres.');
    if (pwd.a !== pwd.b) return toast.error('As senhas não conferem.');
    setBusy('pwd');
    const { error } = await supabase.auth.updateUser({ password: pwd.a });
    setBusy(null);
    if (error) return toast.error(errorMessage(error));
    setPwd({ a: '', b: '' }); toast.success('Senha alterada');
  }

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card>
        <CardHeader title="Meus dados" description={session?.user.email} />
        <CardBody className="space-y-3">
          <Field label="Nome">{(a) => <Input {...a} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
          <div className="flex justify-end"><Button onClick={saveName} loading={busy === 'name'} disabled={name.trim().length < 2}>Salvar</Button></div>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Alterar senha" />
        <CardBody className="space-y-3">
          <Field label="Nova senha" hint="Mínimo de 8 caracteres">{(a) => <Input {...a} type="password" autoComplete="new-password" value={pwd.a} onChange={(e) => setPwd({ ...pwd, a: e.target.value })} />}</Field>
          <Field label="Confirmar nova senha">{(a) => <Input {...a} type="password" autoComplete="new-password" value={pwd.b} onChange={(e) => setPwd({ ...pwd, b: e.target.value })} />}</Field>
          <div className="flex justify-end"><Button onClick={savePwd} loading={busy === 'pwd'}>Alterar senha</Button></div>
        </CardBody>
      </Card>
    </div>
  );
}

function DataTab() {
  const { storeId } = useStore();
  const seed = useRpc<Record<string, unknown>, number>('seed_demo_data');
  const clear = useRpc<Record<string, unknown>, { products: number; sales: number; purchases: number }>('clear_demo_data');
  const rebuild = useRpc<Record<string, unknown>, number>('rebuild_stock_balances');
  const { data: logs = [], isLoading } = useAuditLogs(storeId, true);
  const [clearOpen, setClearOpen] = useState(false);
  const [check, setCheck] = useState<{ running: boolean; result: { product_name: string; cached: number; computed: number }[] | null }>({ running: false, result: null });

  async function runCheck() {
    setCheck({ running: true, result: null });
    const { data, error } = await supabase.rpc('check_stock_integrity', { p_store: storeId });
    if (error) { toast.error(errorMessage(error)); return setCheck({ running: false, result: null }); }
    setCheck({ running: false, result: (data ?? []) as never });
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title="Dados de demonstração" description="Para treinar antes de usar de verdade. Itens DEMO não têm estoque, preço nem custo." />
        <CardBody className="flex flex-wrap gap-2">
          <Button variant="secondary" loading={seed.isPending} onClick={async () => { try { const n = await seed.mutateAsync({ p_store: storeId }); toast.success(`${n} itens de demonstração criados`); } catch (e) { toast.error(errorMessage(e)); } }}>
            <Database className="h-4 w-4" />Criar itens de demonstração
          </Button>
          <Button variant="danger" onClick={() => setClearOpen(true)}><Trash2 className="h-4 w-4" />Limpar dados de demonstração</Button>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Conferência do estoque" description="Compara o saldo guardado com a soma de todas as movimentações." />
        <CardBody className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={runCheck} loading={check.running}><ShieldCheck className="h-4 w-4" />Verificar consistência</Button>
            <Button variant="ghost" loading={rebuild.isPending} onClick={async () => { try { const n = await rebuild.mutateAsync({ p_store: storeId }); toast.success(`Saldos recalculados (${n} itens)`); } catch (e) { toast.error(errorMessage(e)); } }}>Recalcular saldos</Button>
          </div>
          {check.result && (check.result.length === 0
            ? <p className="rounded-xl bg-leaf-50 px-3 py-2 text-sm text-leaf-700">Tudo certo: todos os saldos batem com as movimentações.</p>
            : <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{check.result.length} item(ns) com diferença: {check.result.map((r) => r.product_name).join(', ')}. Use “Recalcular saldos”.</p>)}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Auditoria" description="Últimas 200 ações registradas (cadastros, cancelamentos, estornos, exceções)." />
        <CardBody className="px-0 pb-0">
          {isLoading ? <Spinner /> : logs.length === 0 ? <p className="px-5 pb-4 text-sm text-ink-muted">Nenhum registro.</p> : (
            <div className="max-h-[420px] overflow-y-auto">
              <Table>
                <THead><tr><TH>Data/hora</TH><TH>Ação</TH><TH>Onde</TH><TH>Detalhes</TH></tr></THead>
                <TBody>
                  {logs.map((l) => (
                    <TR key={l.id}>
                      <TD className="whitespace-nowrap">{formatDateTime(l.created_at)}</TD>
                      <TD>{l.action}</TD>
                      <TD className="text-ink-muted">{l.entity}</TD>
                      <TD className="max-w-[360px] truncate text-[12px] text-ink-muted" title={JSON.stringify(l.details)}>{JSON.stringify(l.details)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
          )}
        </CardBody>
      </Card>
      <ConfirmDialog open={clearOpen} onOpenChange={setClearOpen} typeToConfirm="LIMPAR" title="Limpar dados de demonstração?"
        message="Apaga todos os itens marcados como DEMO e tudo que os envolve: movimentações, lotes, e vendas/compras/inventários que contenham itens DEMO. Os saldos dos itens reais são recalculados. Não pode ser desfeito."
        confirmLabel="Limpar" loading={clear.isPending}
        onConfirm={async () => { try { const r = await clear.mutateAsync({ p_store: storeId, p_confirmation: 'LIMPAR' }); toast.success(`Removidos: ${r.products} itens, ${r.sales ?? 0} vendas, ${r.purchases ?? 0} compras`); setClearOpen(false); } catch (e) { toast.error(errorMessage(e)); } }} />
    </div>
  );
}

export default function SettingsPage() {
  const { isAdmin } = useStore();
  const tabs: { id: Tab; label: string; admin?: boolean }[] = [
    { id: 'loja', label: 'Loja' }, { id: 'alertas', label: 'Alertas e regras' }, { id: 'cadastros', label: 'Categorias e unidades' },
    { id: 'usuarios', label: 'Usuários' }, { id: 'perfil', label: 'Meu perfil' }, { id: 'dados', label: 'Dados e auditoria', admin: true },
  ];
  const [tab, setTab] = useState<Tab>(isAdmin ? 'loja' : 'perfil');
  return (
    <>
      <PageHeader title="Usuários e configurações" />
      <div className="mb-5 flex gap-1 overflow-x-auto border-b border-line" role="tablist">
        {tabs.filter((t) => !t.admin || isAdmin).map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
            className={cn('-mb-px whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acai-400',
              tab === t.id ? 'border-acai-700 text-acai-800' : 'border-transparent text-ink-muted hover:text-ink')}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'loja' && <StoreTab />}
      {tab === 'alertas' && <AlertsTab />}
      {tab === 'cadastros' && <CatalogTab />}
      {tab === 'usuarios' && <UsersTab />}
      {tab === 'perfil' && <ProfileTab />}
      {tab === 'dados' && isAdmin && <DataTab />}
    </>
  );
}
