import { z } from 'zod';
import { parseDecimal } from './format';

/** Número digitado no padrão brasileiro ("1.234,5"), validado em português. */
export const zDecimal = (opts: { min?: number; positive?: boolean; max?: number; label?: string } = {}) =>
  z.string({ required_error: 'Campo obrigatório' })
    .trim()
    .min(1, 'Campo obrigatório')
    .refine((v) => !Number.isNaN(parseDecimal(v)), 'Número inválido')
    .refine((v) => !opts.positive || parseDecimal(v) > 0, 'Deve ser maior que zero')
    .refine((v) => opts.min === undefined || parseDecimal(v) >= opts.min, `Mínimo: ${opts.min}`)
    .refine((v) => opts.max === undefined || parseDecimal(v) <= opts.max, `Máximo: ${opts.max}`);

export const zOptionalDecimal = (opts: { min?: number } = {}) =>
  z.string().trim().optional()
    .refine((v) => !v || !Number.isNaN(parseDecimal(v)), 'Número inválido')
    .refine((v) => !v || opts.min === undefined || parseDecimal(v) >= opts.min, `Mínimo: ${opts.min}`);

export const optionalNumber = (v?: string | null) => (v == null || v.trim() === '' ? null : parseDecimal(v));

/** Converte número em texto editável no padrão brasileiro */
export const numToInput = (v: number | null | undefined, maxDecimals = 4) =>
  v == null ? '' : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: maxDecimals, useGrouping: false });

export const zEmail = z.string().trim().email('E-mail inválido');
