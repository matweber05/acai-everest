import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Dialog } from './dialog';
import { Button } from './button';
import { Field, Input, Textarea } from './form';

interface ConfirmProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  tone?: 'danger' | 'primary';
  /** pede um motivo obrigatório (ex.: estorno, cancelamento) */
  requireReason?: boolean;
  /** exige digitar exatamente esta palavra */
  typeToConfirm?: string;
  loading?: boolean;
  onConfirm: (reason: string) => void;
}

/** Confirmação para ações destrutivas ou irreversíveis. */
export function ConfirmDialog({ open, onOpenChange, title, message, confirmLabel = 'Confirmar', tone = 'danger', requireReason, typeToConfirm, loading, onConfirm }: ConfirmProps) {
  const [reason, setReason] = useState('');
  const [typed, setTyped] = useState('');
  useEffect(() => { if (open) { setReason(''); setTyped(''); } }, [open]);
  const blocked = (requireReason && reason.trim().length < 3) || (typeToConfirm && typed !== typeToConfirm);
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => !loading && onOpenChange(v)}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={loading}>Voltar</Button>
          <Button variant={tone} loading={loading} disabled={!!blocked} onClick={() => onConfirm(reason.trim())}>{confirmLabel}</Button>
        </>
      }
    >
      <div className="flex gap-3">
        <div className={tone === 'danger' ? 'rounded-full bg-red-50 p-2 text-red-600 h-fit' : 'rounded-full bg-acai-50 p-2 text-acai-700 h-fit'}>
          <AlertTriangle className="h-5 w-5" />
        </div>
        <div className="space-y-4 text-sm text-ink-muted">
          <div>{message}</div>
          {requireReason && (
            <Field label="Motivo" required hint="Fica registrado no histórico.">
              {(a) => <Textarea {...a} value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={300} autoFocus />}
            </Field>
          )}
          {typeToConfirm && (
            <Field label={<>Digite <b className="text-ink">{typeToConfirm}</b> para confirmar</>}>
              {(a) => <Input {...a} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />}
            </Field>
          )}
        </div>
      </div>
    </Dialog>
  );
}
