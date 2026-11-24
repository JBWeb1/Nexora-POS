import { describe, expect, it } from 'vitest';
import { calcTotals, formatMoney, parseMoney, quickTenders } from './money';
import type { CartLine } from '../types';

const line = (unitPrice: number, qty = 1, discountPct = 0, vatExempt = false): CartLine => ({
  productId: 'p',
  name: 'x',
  unitPrice,
  qty,
  discountPct,
  vatExempt,
});

describe('money', () => {
  it('formats rands with thousand separators', () => {
    expect(formatMoney(123456789)).toBe('R 1 234 567.89');
    expect(formatMoney(-550)).toBe('-R 5.50');
  });

  it('parses user input', () => {
    expect(parseMoney('12.50')).toBe(1250);
    expect(parseMoney('12,5')).toBe(1250);
    expect(parseMoney('R 200')).toBe(20000);
    expect(parseMoney('abc')).toBeNaN();
  });

  it('extracts 15% VAT from inclusive prices', () => {
    const t = calcTotals([line(11500)], 15);
    expect(t.total).toBe(11500);
    expect(t.vat).toBe(1500);
    expect(t.exVat).toBe(10000);
  });

  it('skips VAT on exempt lines', () => {
    const t = calcTotals([line(11500), line(2000, 1, 0, true)], 15);
    expect(t.total).toBe(13500);
    expect(t.vat).toBe(1500);
  });

  it('applies line and cart discounts', () => {
    const t = calcTotals([line(10000, 2, 10)], 15, 50);
    expect(t.subtotal).toBe(20000);
    expect(t.total).toBe(9000);
    expect(t.discount).toBe(11000);
  });

  it('suggests sensible cash tenders', () => {
    expect(quickTenders(4350)).toEqual([4350, 5000, 6000, 10000, 20000]);
  });
});
