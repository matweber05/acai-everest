import { AlertCircle, Loader2, RotateCw, Search } from 'lucide-react';
import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { errorMessage } from '@/lib/errors';
import { Button } from './button';

export function Spinner({ className, label = 'Carregando…' }: { className?: string; label?: string }) {
  return (
    <div role="status" className={cn('flex items-center justify-center gap-2 py-10 text-sm text-ink-muted', className)}>
      <Loader2 className="h-5 w-5 animate-spin text-acai-500" aria-hidden />
      <span>{label}</span>
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-lg bg-gray-200/70', className)} aria-hidden />;
}

export function EmptyState({ icon, title, description, action, className }: { icon?: ReactNode; title: string; description?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center px-6 py-12 text-center', className)}>
      {icon && <div className="mb-3 rounded-2xl bg-acai-50 p-3 text-acai-600">{icon}</div>}
      <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-[13.5px] text-ink-muted">{description}</p>}
      {action && <div className="mt-4 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center px-6 py-10 text-center">
      <div className="mb-3 rounded-2xl bg-red-50 p-3 text-red-600"><AlertCircle className="h-6 w-6" /></div>
      <h3 className="text-[15px] font-semibold text-ink">Não foi possível carregar</h3>
      <p className="mt-1 max-w-sm text-[13.5px] text-ink-muted">{errorMessage(error)}</p>
      {onRetry && (
        <Button className="mt-4" variant="secondary" onClick={onRetry}><RotateCw className="h-4 w-4" />Tentar novamente</Button>
      )}
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-[22px] font-bold tracking-tight text-acai-950 sm:text-2xl">{title}</h1>
        {description && <p className="mt-1 text-[13.5px] text-ink-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export const SearchInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...p }, ref) => (
  <div className={cn('relative', className)}>
    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft" aria-hidden />
    <input
      ref={ref}
      type="search"
      className="h-10 w-full rounded-xl border border-line bg-white pl-9 pr-3 text-[15px] placeholder:text-ink-soft focus:border-acai-400 focus:outline-none focus:ring-2 focus:ring-acai-100"
      {...p}
    />
  </div>
));
SearchInput.displayName = 'SearchInput';

export function Segmented<T extends string>({ value, onChange, options, className, ariaLabel }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; className?: string; ariaLabel?: string;
}) {
  return (
    <div role="tablist" aria-label={ariaLabel} className={cn('inline-flex max-w-full overflow-x-auto rounded-xl border border-line bg-white p-1', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          type="button"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'whitespace-nowrap rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acai-400',
            value === o.value ? 'bg-acai-700 text-white shadow-sm' : 'text-ink-muted hover:text-acai-800',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
