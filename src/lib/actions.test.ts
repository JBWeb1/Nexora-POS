import { describe, expect, it } from 'vitest';
import { seedState } from './seed';
import { addPettyCash, closeShift, completeSale, currentShift, openShift, pettyBalance, refundSale, summariseShift } from './actions';
import type { AppState, CartLine } from '../types';

function setup(): AppState {
  const s = seedState();
  openShift(s, 'staff-csh', 50000);
  return s;
}

function cartOf(s: AppState, name: string, qty: number): CartLine {
  const p = s.products.find((x) => x.name === name)!;
  return { productId: p.id, name: p.name, unitPrice: p.price, qty, discountPct: 0, vatExempt: p.vatExempt };
}

describe('sales workflow', () => {
  it('requires an open shift', () => {
    const s = seedState();
    expect(() =>
      completeSale(s, { staffId: 'x', customerId: null, lines: [cartOf(s, 'Croissant', 1)], payments: [], cartDiscountPct: 0 }),
    ).toThrow(/shift/);
  });

  it('completes a cash sale with change and reduces stock', () => {
    const s = setup();
    const before = s.products.find((p) => p.name === 'Croissant')!.stock;
    const sale = completeSale(s, {
      staffId: 'staff-csh',
      customerId: null,
      lines: [cartOf(s, 'Croissant', 2)],
      payments: [{ method: 'cash', amount: 10000 }],
      cartDiscountPct: 0,
    });
    expect(sale.totals.total).toBe(5000);
    expect(sale.change).toBe(5000);
    expect(s.products.find((p) => p.name === 'Croissant')!.stock).toBe(before - 2);
  });

  it('rejects short payment and card overpayment', () => {
    const s = setup();
    const lines = [cartOf(s, 'Croissant', 1)];
    expect(() =>
      completeSale(s, { staffId: 'a', customerId: null, lines, payments: [{ method: 'cash', amount: 100 }], cartDiscountPct: 0 }),
    ).toThrow(/short/);
    expect(() =>
      completeSale(s, { staffId: 'a', customerId: null, lines, payments: [{ method: 'card', amount: 9999 }], cartDiscountPct: 0 }),
    ).toThrow(/exceed/);
  });

  it('enforces customer account limits', () => {
    const s = setup();
    const c = s.customers[1];
    c.accountLimit = c.accountBalance + 1000;
    expect(() =>
      completeSale(s, {
        staffId: 'a',
        customerId: c.id,
        lines: [cartOf(s, 'Biltong 100g', 1)],
        payments: [{ method: 'account', amount: 6500 }],
        cartDiscountPct: 0,
      }),
    ).toThrow(/limit/);
  });

  it('partially then fully refunds, restoring stock', () => {
    const s = setup();
    const sale = completeSale(s, {
      staffId: 'staff-csh',
      customerId: null,
      lines: [cartOf(s, 'Croissant', 3)],
      payments: [{ method: 'card', amount: 7500 }],
      cartDiscountPct: 0,
    });
    const pid = sale.lines[0].productId;
    const stockAfterSale = s.products.find((p) => p.id === pid)!.stock;
    refundSale(s, 'staff-mgr', sale.id, { [pid]: 1 }, 'card', 'stale');
    expect(s.sales.find((x) => x.id === sale.id)!.status).toBe('partially_refunded');
    expect(() => refundSale(s, 'staff-mgr', sale.id, { [pid]: 3 }, 'card', 'x')).toThrow(/Too many/);
    refundSale(s, 'staff-mgr', sale.id, { [pid]: 2 }, 'card', 'stale');
    expect(s.sales.find((x) => x.id === sale.id)!.status).toBe('refunded');
    expect(s.products.find((p) => p.id === pid)!.stock).toBe(stockAfterSale + 3);
  });

  it('calculates expected cash at cash-up', () => {
    const s = setup();
    completeSale(s, {
      staffId: 'staff-csh',
      customerId: null,
      lines: [cartOf(s, 'Cappuccino', 1)],
      payments: [{ method: 'cash', amount: 5000 }],
      cartDiscountPct: 0,
    });
    currentShift(s)!.movements.push({ id: 'm', at: '', type: 'payout', amount: 1000, reason: 'milk', staffId: 'x' });
    const sum = summariseShift(s, currentShift(s)!);
    expect(sum.byMethod.cash).toBe(3200);
    expect(sum.expectedCash).toBe(50000 + 3200 - 1000);
    closeShift(s, 'staff-mgr', 52200);
    expect(currentShift(s)).toBeUndefined();
    expect(s.shifts[0].expectedCash).toBe(52200);
  });

  it('tracks petty cash and blocks overspending', () => {
    const s = seedState();
    const base = { category: 'Cleaning', reference: '', staffId: 'staff-mgr' };
    expect(() => addPettyCash(s, { ...base, type: 'expense', amount: 100, description: 'soap' })).toThrow(/Not enough/);
    addPettyCash(s, { ...base, type: 'top_up', amount: 50000, description: 'float' });
    addPettyCash(s, { ...base, type: 'expense', amount: 1250, description: 'soap' });
    expect(pettyBalance(s)).toBe(48750);
    expect(() => addPettyCash(s, { ...base, type: 'expense', amount: 500, description: '  ' })).toThrow(/spent on/);
  });
});
