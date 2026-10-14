// Cálculos monetários em CENTAVOS inteiros para evitar erros de ponto flutuante
// (ex.: 0,1 + 0,2). O banco recalcula e é a fonte final dos valores.

export const toCents = (v: number | null | undefined): number => Math.round((Number(v) || 0) * 100);
export const fromCents = (c: number): number => c / 100;

/** total da linha = quantidade × preço − desconto, arredondado ao centavo (igual ao banco). */
export function lineTotal(quantity: number, unitPrice: number, discount = 0): number {
  const gross = Math.round(Number(quantity) * Number(unitPrice) * 100 + Number.EPSILON);
  return fromCents(gross - toCents(discount));
}

export function sumMoney(values: number[]): number {
  return fromCents(values.reduce((acc, v) => acc + toCents(v), 0));
}

export interface DocTotals { subtotal: number; discount: number; freight: number; total: number }

export function documentTotals(
  lines: { quantity: number; unit: number; discount?: number }[],
  discount = 0,
  freight = 0,
): DocTotals {
  const subtotal = sumMoney(lines.map((l) => lineTotal(l.quantity, l.unit, l.discount ?? 0)));
  const total = fromCents(toCents(subtotal) - toCents(discount) + toCents(freight));
  return { subtotal, discount, freight, total };
}

/** Margem bruta só existe quando o custo é conhecido. */
export function grossMargin(revenue: number, cogs: number, costComplete: boolean) {
  if (!costComplete || revenue <= 0) return null;
  const value = fromCents(toCents(revenue) - toCents(cogs));
  return { value, pct: Math.round((value / revenue) * 1000) / 10 };
}

/** Rateio de frete/desconto no custo unitário (mesma regra de receive_purchase). */
export function landedUnitCost(itemTotal: number, quantity: number, subtotal: number, freight: number, discount: number) {
  const extra = freight - discount;
  const share = subtotal > 0 ? (extra * itemTotal) / subtotal : 0;
  return Math.max(Math.round(((itemTotal + share) / quantity) * 10000) / 10000, 0);
}
