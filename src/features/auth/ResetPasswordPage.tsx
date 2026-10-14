import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/errors';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';
import { Spinner } from '@/components/ui/misc';
import { AuthShell } from './AuthShell';

const schema = z.object({ password: z.string().min(8, 'Mínimo de 8 caracteres'), confirm: z.string() })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'As senhas não conferem' });

export function ResetPasswordPage() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) });

  async function onSubmit(v: z.infer<typeof schema>) {
    setError(null);
    const { error } = await supabase.auth.updateUser({ password: v.password });
    if (error) return setError(errorMessage(error));
    toast.success('Senha alterada com sucesso');
    navigate('/', { replace: true });
  }

  if (loading) return <Spinner className="min-h-dvh" />;

  return (
    <AuthShell title="Nova senha" subtitle={session ? 'Escolha uma nova senha para sua conta.' : undefined}>
      {!session ? (
        <p className="rounded-2xl border border-line bg-white p-5 text-sm text-ink-muted">
          Este link expirou ou já foi usado. Solicite um novo em “Esqueci minha senha”.
        </p>
      ) : (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <Field label="Nova senha" error={errors.password?.message}>
            {(a) => <Input {...a} type="password" autoComplete="new-password" {...register('password')} />}
          </Field>
          <Field label="Confirmar nova senha" error={errors.confirm?.message}>
            {(a) => <Input {...a} type="password" autoComplete="new-password" {...register('confirm')} />}
          </Field>
          {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>Salvar nova senha</Button>
        </form>
      )}
    </AuthShell>
  );
}
