import { describe, expect, it } from 'vitest';
import { seedState } from './seed';
import { addPettyCash, cancelLayby, createLayby, findByCode, issueVoucher, laybyBalance, linkBarcode, payLayby, postDelivery, closeShift, completeSale, currentShift, openShift, pettyBalance, refundSale, summariseShift } from './actions';
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

  it('runs a lay-by from deposit to collection', () => {
    const s = setup();
    const c = s.customers[0];
    const biltong = s.products.find((p) => p.name === 'Biltong 100g')!;
    const before = biltong.stock;
    const lines = [cartOf(s, 'Biltong 100g', 2)]; // R130
    expect(() => createLayby(s, { staffId: 'staff-csh', customerId: c.id, lines, cartDiscountPct: 0, deposit: 500, method: 'cash' })).toThrow(/at least/);
    const l = createLayby(s, { staffId: 'staff-csh', customerId: c.id, lines, cartDiscountPct: 0, deposit: 3000, method: 'cash' });
    expect(biltong.stock).toBe(before - 2); // reserved
    expect(laybyBalance(l)).toBe(10000);
    expect(() => payLayby(s, 'staff-csh', l.id, 20000, 'card')).toThrow(/more than/);
    payLayby(s, 'staff-csh', l.id, 4000, 'card');
    payLayby(s, 'staff-csh', l.id, 6000, 'cash');
    const done = s.laybys.find((x) => x.id === l.id)!;
    expect(done.status).toBe('completed');
    const sale = s.sales.find((x) => x.id === done.saleId)!;
    expect(sale.totals.total).toBe(13000);
    expect(biltong.stock).toBe(before - 2); // not deducted twice
    const sum = summariseShift(s, currentShift(s)!);
    expect(sum.byMethod.cash).toBe(9000);
    expect(sum.byMethod.card).toBe(4000);
    expect(sum.laybyAndVouchers).toBe(13000);
  });

  it('cancels a lay-by with a fee and returns the stock', () => {
    const s = setup();
    const biltong = s.products.find((p) => p.name === 'Biltong 100g')!;
    const before = biltong.stock;
    const l = createLayby(s, { staffId: 'a', customerId: s.customers[0].id, lines: [cartOf(s, 'Biltong 100g', 2)], cartDiscountPct: 0, deposit: 5000, method: 'cash' });
    const r = cancelLayby(s, 'staff-mgr', l.id, 'cash');
    expect(r).toEqual({ fee: 1300, refund: 3700 });
    expect(biltong.stock).toBe(before);
    expect(summariseShift(s, currentShift(s)!).byMethod.cash).toBe(1300);
  });

  it('sells and redeems gift vouchers', () => {
    const s = setup();
    const v = issueVoucher(s, { staffId: 'a', value: 5000, holderName: 'Sipho', holderPhone: '', method: 'card' });
    expect(v.code).toMatch(/^NX-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    const sale = completeSale(s, {
      staffId: 'a',
      customerId: null,
      lines: [cartOf(s, 'Cappuccino', 1)],
      payments: [{ method: 'voucher', amount: 3200, reference: v.code.toLowerCase() }],
      cartDiscountPct: 0,
    });
    expect(s.vouchers[0].balance).toBe(1800);
    expect(s.vouchers[0].redemptions[0].saleId).toBe(sale.id);
    expect(() =>
      completeSale(s, { staffId: 'a', customerId: null, lines: [cartOf(s, 'Biltong 100g', 1)], payments: [{ method: 'voucher', amount: 6500, reference: v.code }], cartDiscountPct: 0 }),
    ).toThrow(/only has/);
    expect(summariseShift(s, currentShift(s)!).byMethod.card).toBe(5000);
  });

  it('receives a whole box from one scan of its barcode', () => {
    const s = setup();
    const water = s.products.find((p) => p.name === 'Still Water 500ml')!;
    expect(findByCode(s.products, '16001000000070')).toMatchObject({ qty: 24, isPack: true });
    linkBarcode(s, 'staff-mgr', water.id, '26001000000077', 12);
    expect(() => linkBarcode(s, 'staff-mgr', water.id, '26001000000077', 6)).toThrow(/already belongs/);
    const before = water.stock;
    postDelivery(s, 'staff-mgr', [{ productId: water.id, qty: 24 + 12, cost: 480 }], 'Acme', 'INV9');
    expect(water.stock).toBe(before + 36);
    expect(water.cost).toBe(480);
  });
});
