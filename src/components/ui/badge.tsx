import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type Tone = 'neutral' | 'acai' | 'success' | 'warning' | 'danger' | 'info';
const tones: Record<Tone, string> = {
  neutral: 'bg-gray-100 text-gray-700',
  acai: 'bg-acai-100 text-acai-800',
  success: 'bg-leaf-100 text-leaf-700',
  warning: 'bg-mango-100 text-mango-700',
  danger: 'bg-red-50 text-red-700',
  info: 'bg-turq-50 text-turq-700',
};

export function Badge({ tone = 'neutral', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px] font-semibold', tones[tone], className)}>
      {children}
    </span>
  );
}
