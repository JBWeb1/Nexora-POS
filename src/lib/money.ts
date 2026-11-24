import type { CartLine, Payment, SaleTotals } from '../types';

/** All money is stored as integer cents to avoid floating point drift. */
export function formatMoney(cents: number, currency = 'R'): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const rands = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const c = (abs % 100).toString().padStart(2, '0');
  return `${sign}${currency} ${rands}.${c}`;
}

/** Parse user input like "12.50", "12,50", "R 1 200" into cents. Returns NaN if invalid. */
export function parseMoney(input: string): number {
  const cleaned = input.replace(/[R\s]/gi, '').replace(',', '.');
  if (cleaned === '' || !/^-?\d*\.?\d{0,2}$/.test(cleaned)) return NaN;
  return Math.round(parseFloat(cleaned) * 100);
}

export function lineTotal(line: CartLine): number {
  const gross = line.unitPrice * line.qty;
  return gross - Math.round((gross * line.discountPct) / 100);
}

/** Fold a whole-cart discount into each line's discount so every total is computed one way. */
export function bakeCartDiscount(lines: CartLine[], cartDiscountPct: number): CartLine[] {
  if (!cartDiscountPct) return lines;
  return lines.map((l) => ({
    ...l,
    discountPct: Math.min(100, 100 - (100 - l.discountPct) * (1 - cartDiscountPct / 100)),
  }));
}

/** Prices are VAT inclusive (standard in SA retail). */
export function calcTotals(lines: CartLine[], vatRate: number, cartDiscountPct = 0): SaleTotals {
  let subtotal = 0;
  let total = 0;
  let vat = 0;
  for (const line of bakeCartDiscount(lines, cartDiscountPct)) {
    subtotal += line.unitPrice * line.qty;
    const lt = lineTotal(line);
    total += lt;
    if (!line.vatExempt) vat += lt - Math.round(lt / (1 + vatRate / 100));
  }
  return { subtotal, discount: subtotal - total, total, vat, exVat: total - vat };
}

export function paidAmount(payments: Payment[]): number {
  return payments.reduce((s, p) => s + p.amount, 0);
}

/** Suggest quick cash tender amounts (exact + next round notes). */
export function quickTenders(total: number): number[] {
  const notes = [1000, 2000, 5000, 10000, 20000];
  const out = new Set<number>([total]);
  for (const n of notes) {
    const rounded = Math.ceil(total / n) * n;
    if (rounded > total) out.add(rounded);
  }
  return [...out].sort((a, b) => a - b).slice(0, 5);
}
