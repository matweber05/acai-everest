import { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { MailCheck } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/errors';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';
import { zEmail } from '@/lib/validation';
import { AuthShell } from './AuthShell';

const schema = z.object({
  full_name: z.string().trim().min(2, 'Informe seu nome'),
  email: zEmail,
  password: z.string().min(8, 'Mínimo de 8 caracteres'),
  confirm: z.string(),
}).refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'As senhas não conferem' });

export function SignUpPage() {
  const { session } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) });

  async function onSubmit(v: z.infer<typeof schema>) {
    setError(null);
    const { data, error } = await supabase.auth.signUp({
      email: v.email, password: v.password,
      options: { data: { full_name: v.full_name }, emailRedirectTo: window.location.origin },
    });
    if (error) return setError(errorMessage(error));
    if (!data.session) setSent(true);
  }

  if (session) return <Navigate to="/" replace />;

  if (sent) {
    return (
      <AuthShell title="Confirme seu e-mail">
        <div className="rounded-2xl border border-line bg-white p-5 text-sm text-ink-muted">
          <MailCheck className="mb-3 h-8 w-8 text-leaf-500" />
          Enviamos um link de confirmação para o seu e-mail. Depois de confirmar, volte e faça login.
        </div>
        <Link to="/entrar" className="mt-4 inline-block text-sm font-medium text-acai-700 hover:underline">Voltar para o login</Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Criar conta" subtitle="Use o e-mail em que você recebeu o convite da loja.">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <Field label="Seu nome" error={errors.full_name?.message}>
          {(a) => <Input {...a} autoComplete="name" {...register('full_name')} />}
        </Field>
        <Field label="E-mail" error={errors.email?.message}>
          {(a) => <Input {...a} type="email" autoComplete="email" inputMode="email" {...register('email')} />}
        </Field>
        <Field label="Senha" error={errors.password?.message} hint="Pelo menos 8 caracteres">
          {(a) => <Input {...a} type="password" autoComplete="new-password" {...register('password')} />}
        </Field>
        <Field label="Confirmar senha" error={errors.confirm?.message}>
          {(a) => <Input {...a} type="password" autoComplete="new-password" {...register('confirm')} />}
        </Field>
        {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>Criar conta</Button>
        <p className="text-center text-sm text-ink-muted">Já tem conta? <Link to="/entrar" className="font-medium text-acai-700 hover:underline">Entrar</Link></p>
      </form>
    </AuthShell>
  );
}
