import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Clock } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/errors';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';
import { Spinner } from '@/components/ui/misc';
import { AuthShell } from './AuthShell';

const schema = z.object({
  name: z.string().trim().min(2, 'Informe o nome da loja'),
  phone: z.string().optional(),
  address: z.string().optional(),
});

/** Primeiro acesso: cria a loja (apenas o primeiro usuário) ou aguarda convite. */
export function OnboardingPage() {
  const { session, store, refresh, signOut, profile } = useAuth();
  const [canCreate, setCanCreate] = useState<boolean | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema), defaultValues: { name: 'Açaí Everest ABC' },
  });

  useEffect(() => {
    let alive = true;
    async function checkBootstrap() {
      setCheckError(null);
      const { data, error } = await supabase.rpc('can_bootstrap_store');
      if (!alive) return;
      if (error) {
        setCheckError(errorMessage(error));
        setCanCreate(false);
        return;
      }
      setCanCreate(Boolean(data));
    }
    checkBootstrap().catch(() => {
      if (!alive) return;
      setCheckError('Não foi possível verificar seu acesso agora.');
      setCanCreate(false);
    });
    return () => { alive = false; };
  }, []);

  if (!session) return <Navigate to="/entrar" replace />;
  if (store) return <Navigate to="/" replace />;
  if (canCreate === null) return <Spinner className="min-h-dvh" />;

  async function onSubmit(v: z.infer<typeof schema>) {
    const { error } = await supabase.rpc('create_store', { p_name: v.name, p_phone: v.phone || null, p_address: v.address || null });
    if (error) return toast.error(errorMessage(error));
    toast.success('Loja criada! Você é o(a) administrador(a).');
    await refresh();
  }

  if (!canCreate) {
    return (
      <AuthShell title="Aguardando acesso">
        {checkError && (
          <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700" role="alert">
            {checkError}
          </div>
        )}
        <div className="rounded-2xl border border-line bg-white p-5 text-sm text-ink-muted">
          <Clock className="mb-3 h-8 w-8 text-mango-600" />
          Sua conta (<b className="text-ink">{profile?.email ?? session.user.email}</b>) ainda não foi liberada em nenhuma loja.
          Peça à administradora para adicionar este e-mail em <b>Usuários e configurações</b>.
        </div>
        <div className="mt-4 flex gap-2">
          <Button variant="secondary" onClick={() => refresh()}>Verificar novamente</Button>
          <Button variant="ghost" onClick={signOut}>Sair</Button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Bem-vinda!" subtitle="Vamos configurar a loja. Você será a administradora.">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <Field label="Nome da loja" required error={errors.name?.message}>
          {(a) => <Input {...a} {...register('name')} />}
        </Field>
        <Field label="Telefone">
          {(a) => <Input {...a} inputMode="tel" placeholder="(11) 99999-9999" {...register('phone')} />}
        </Field>
        <Field label="Endereço">
          {(a) => <Input {...a} {...register('address')} />}
        </Field>
        <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>Criar loja</Button>
        <p className="text-[12.5px] text-ink-muted">Criaremos automaticamente as categorias e unidades de medida padrão. Nenhum produto ou estoque é inventado: você cadastra os dados reais.</p>
      </form>
    </AuthShell>
  );
}
