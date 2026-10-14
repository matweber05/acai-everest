import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useMemo, useState, type HTMLAttributes, type TdHTMLAttributes, type ThHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';
import { Button } from './button';
import { usePageSize } from '@/contexts/AuthContext';

export function Table({ className, ...p }: HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="-mx-px overflow-x-auto">
      <table className={cn('w-full border-collapse text-sm', className)} {...p} />
    </div>
  );
}
export const THead = (p: HTMLAttributes<HTMLTableSectionElement>) => <thead className="bg-surface/70 text-left" {...p} />;
export const TBody = (p: HTMLAttributes<HTMLTableSectionElement>) => <tbody className="divide-y divide-line" {...p} />;
export function TR({ className, ...p }: HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn('transition-colors hover:bg-acai-50/40', className)} {...p} />;
}
export function TH({ className, ...p }: ThHTMLAttributes<HTMLTableCellElement>) {
  return <th scope="col" className={cn('whitespace-nowrap border-b border-line px-4 py-2.5 text-[12px] font-semibold uppercase tracking-wide text-ink-muted', className)} {...p} />;
}
export function TD({ className, ...p }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn('px-4 py-3 align-middle text-ink', className)} {...p} />;
}

export function usePagination<T>(rows: T[]) {
  const pageSize = usePageSize();
  const [page, setPage] = useState(1);
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  useEffect(() => { if (page > pages) setPage(1); }, [pages, page]);
  const slice = useMemo(() => rows.slice((page - 1) * pageSize, page * pageSize), [rows, page, pageSize]);
  return { page, pages, setPage, slice, total: rows.length };
}

export function Pagination({ page, pages, total, onPage, label = 'registros' }: { page: number; pages: number; total: number; onPage: (p: number) => void; label?: string }) {
  if (total === 0) return null;
  return (
    <nav className="flex items-center justify-between gap-3 border-t border-line px-4 py-3 text-[13px] text-ink-muted" aria-label="Paginação">
      <span>{total.toLocaleString('pt-BR')} {label}</span>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="secondary" onClick={() => onPage(page - 1)} disabled={page <= 1} aria-label="Página anterior">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="tabular-nums">{page} de {pages}</span>
        <Button size="sm" variant="secondary" onClick={() => onPage(page + 1)} disabled={page >= pages} aria-label="Próxima página">
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </nav>
  );
}
