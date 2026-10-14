import { addDaysISO, todayISO } from './format';

export type PeriodPreset = 'today' | '7d' | '30d' | 'custom';
export interface Period { preset: PeriodPreset; from: string; to: string }

export const PERIOD_LABEL: Record<PeriodPreset, string> = {
  today: 'Hoje', '7d': '7 dias', '30d': '30 dias', custom: 'Personalizado',
};

export function periodFromPreset(preset: PeriodPreset, custom?: { from: string; to: string }): Period {
  const today = todayISO();
  switch (preset) {
    case 'today': return { preset, from: today, to: today };
    case '7d': return { preset, from: addDaysISO(today, -6), to: today };
    case '30d': return { preset, from: addDaysISO(today, -29), to: today };
    default: return { preset, from: custom?.from ?? addDaysISO(today, -29), to: custom?.to ?? today };
  }
}
