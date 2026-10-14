import { describe, expect, it } from 'vitest';
import { documentTotals, grossMargin, landedUnitCost, lineTotal, sumMoney } from './money';
import { parseDecimal, formatBRL, formatDate, formatQty } from './format';
import { toCSV } from './csv';

describe('cálculos monetários', () => {
  it('evita erro de ponto flutuante', () => {
    expect(sumMoney([0.1, 0.2])).toBe(0.3);
    expect(lineTotal(3, 0.35)).toBe(1.05);
    expect(lineTotal(3, 22, 2)).toBe(64);
  });
  it('calcula totais de venda como o banco (2×3,50 + 3×22 − 2 = 71)', () => {
    const t = documentTotals([{ quantity: 2, unit: 3.5 }, { quantity: 3, unit: 22, discount: 2 }]);
    expect(t.total).toBe(71);
  });
  it('calcula totais de compra com desconto e frete (48 + 190 − 10 + 20 = 248)', () => {
    const t = documentTotals([{ quantity: 48, unit: 1 }, { quantity: 10, unit: 19 }], 10, 20);
    expect(t.subtotal).toBe(238);
    expect(t.total).toBe(248);
  });
  it('rateia frete − desconto no custo unitário', () => {
    expect(landedUnitCost(48, 48, 238, 20, 10)).toBeCloseTo((48 + (10 * 48) / 238) / 48, 4);
  });
  it('margem bruta só existe com custo completo', () => {
    expect(grossMargin(100, 40, false)).toBeNull();
    expect(grossMargin(100, 40, true)).toEqual({ value: 60, pct: 60 });
    expect(grossMargin(0, 0, true)).toBeNull();
  });
});

describe('formatação brasileira', () => {
  it('interpreta números digitados', () => {
    expect(parseDecimal('1.234,56')).toBe(1234.56);
    expect(parseDecimal('0,35')).toBe(0.35);
    expect(parseDecimal('12.5')).toBe(12.5);
    expect(parseDecimal('R$ 3,50')).toBe(3.5);
    expect(parseDecimal('abc')).toBeNaN();
    expect(parseDecimal('')).toBeNaN();
  });
  it('formata moeda, datas e quantidades', () => {
    expect(formatBRL(1234.5).replace(/\s/g, ' ')).toBe('R$ 1.234,50');
    expect(formatDate('2026-10-13')).toBe('13/10/2026');
    expect(formatDate('2026-10-13T02:30:00Z')).toBe('12/10/2026'); // 23h30 em São Paulo
    expect(formatQty(1.05, 'kg')).toBe('1,05 kg');
  });
  it('gera CSV com ; e escapa aspas', () => {
    const csv = toCSV([{ a: 'Açaí "top"', b: 1.5 }], [{ header: 'Nome', value: (r) => r.a }, { header: 'Valor', value: (r) => r.b }]);
    expect(csv).toBe('Nome;Valor\r\n"Açaí ""top""";1,5');
  });
});
