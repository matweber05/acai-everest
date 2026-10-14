import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';

export const STORE_TZ = 'America/Sao_Paulo';

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const brlCost = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 4 });
const num = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 });
const int = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const pct = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });

export const formatBRL = (v: number | null | undefined) => (v == null ? '—' : brl.format(Number(v)));
export const formatCost = (v: number | null | undefined) => (v == null ? '—' : brlCost.format(Number(v)));
export const formatQty = (v: number | null | undefined, unit?: string) =>
  v == null ? '—' : `${num.format(Number(v))}${unit ? ` ${unit}` : ''}`;
export const formatInt = (v: number | null | undefined) => (v == null ? '—' : int.format(Number(v)));
export const formatPct = (v: number | null | undefined) => (v == null ? '—' : `${pct.format(Number(v))}%`);

/** Converte "1.234,56" / "1234,56" / "1234.56" em número. Retorna NaN se inválido. */
export function parseDecimal(input: string | number | null | undefined): number {
  if (typeof input === 'number') return input;
  if (input == null) return NaN;
  let s = String(input).trim().replace(/\s|R\$/g, '');
  if (s === '') return NaN;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  if (!/^-?\d*(\.\d+)?$/.test(s)) return NaN;
  return Number(s);
}

/** Partes da data/hora no fuso da loja (padrão America/Sao_Paulo) */
function tzParts(date: Date, tz = STORE_TZ) {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  return { y: p.year, m: p.month, d: p.day, h: p.hour === '24' ? '00' : p.hour, min: p.minute };
}

/** DD/MM/AAAA (para timestamps, no fuso da loja) */
export function formatDate(value: string | Date | null | undefined, tz = STORE_TZ) {
  if (!value) return '—';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split('-');
    return `${d}/${m}/${y}`;
  }
  const p = tzParts(typeof value === 'string' ? new Date(value) : value, tz);
  return `${p.d}/${p.m}/${p.y}`;
}

/** DD/MM/AAAA HH:mm no fuso da loja */
export function formatDateTime(value: string | Date | null | undefined, tz = STORE_TZ) {
  if (!value) return '—';
  const p = tzParts(typeof value === 'string' ? new Date(value) : value, tz);
  return `${p.d}/${p.m}/${p.y} ${p.h}:${p.min}`;
}

/** Data de hoje (AAAA-MM-DD) no fuso da loja */
export function todayISO(tz = STORE_TZ) {
  const p = tzParts(new Date(), tz);
  return `${p.y}-${p.m}-${p.d}`;
}

export function addDaysISO(iso: string, days: number) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

export function shortDayLabel(iso: string) {
  return format(parseISO(iso), 'dd/MM', { locale: ptBR });
}

export function weekdayLabel(iso: string) {
  return format(parseISO(iso), "EEE dd/MM", { locale: ptBR });
}

/** "AAAA-MM-DDTHH:mm" (input datetime-local) no fuso da loja -> ISO UTC */
export function localInputToISO(value: string) {
  // America/Sao_Paulo não tem horário de verão desde 2019: UTC-3 fixo.
  return new Date(`${value}:00-03:00`).toISOString();
}
export function nowLocalInput(tz = STORE_TZ) {
  const p = tzParts(new Date(), tz);
  return `${p.y}-${p.m}-${p.d}T${p.h}:${p.min}`;
}
