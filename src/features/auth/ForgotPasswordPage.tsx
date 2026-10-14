import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/errors';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';
import { zEmail } from '@/lib/validation';
import { AuthShell } from './AuthShell';

const schema = z.object({ email: zEmail });

export function ForgotPasswordPage() {
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) });

  async function onSubmit(v: z.infer<typeof schema>) {
    setError(null);
    const { error } = await supabase.auth.resetPasswordForEmail(v.email, { redirectTo: `${window.location.origin}/redefinir-senha` });
    if (error) return setError(errorMessage(error));
    setDone(true);
  }

  return (
    <AuthShell title="Recuperar senha" subtitle="Enviaremos um link para você criar uma nova senha.">
      {done ? (
        <div className="rounded-2xl border border-line bg-white p-5 text-sm text-ink-muted">
          Se este e-mail estiver cadastrado, você receberá o link em alguns minutos. Confira também a caixa de spam.
        </div>
      ) : (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <Field label="E-mail" error={errors.email?.message}>
            {(a) => <Input {...a} type="email" autoComplete="email" inputMode="email" {...register('email')} />}
          </Field>
          {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>Enviar link</Button>
        </form>
      )}
      <Link to="/entrar" className="mt-4 inline-block text-sm font-medium text-acai-700 hover:underline">Voltar para o login</Link>
    </AuthShell>
  );
}
