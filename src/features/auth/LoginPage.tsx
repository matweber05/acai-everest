import { useState } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/errors';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';
import { zEmail } from '@/lib/validation';
import { AuthShell } from './AuthShell';

const schema = z.object({ email: zEmail, password: z.string().min(1, 'Informe a senha') });

export function LoginPage() {
  const { session } = useAuth();
  const location = useLocation();
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) });

  if (session) return <Navigate to={(location.state as { from?: string })?.from ?? '/'} replace />;

  async function onSubmit(v: z.infer<typeof schema>) {
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email: v.email, password: v.password });
    if (error) setError(errorMessage(error));
  }

  return (
    <AuthShell title="Entrar" subtitle="Acesse o sistema da Açaí Everest">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <Field label="E-mail" error={errors.email?.message}>
          {(a) => <Input {...a} type="email" autoComplete="email" inputMode="email" {...register('email')} />}
        </Field>
        <Field label="Senha" error={errors.password?.message}>
          {(a) => <Input {...a} type="password" autoComplete="current-password" {...register('password')} />}
        </Field>
        {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>Entrar</Button>
        <div className="flex justify-between text-sm">
          <Link to="/esqueci-senha" className="font-medium text-acai-700 hover:underline">Esqueci minha senha</Link>
          <Link to="/criar-conta" className="font-medium text-acai-700 hover:underline">Criar conta</Link>
        </div>
      </form>
    </AuthShell>
  );
}
