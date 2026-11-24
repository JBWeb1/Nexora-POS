import type { AppState, CartLine, Payment, PettyCashEntry, Role, Sale, Shift, Staff } from '../types';
import { bakeCartDiscount, calcTotals, paidAmount } from './money';
import { uid } from './id';

/** All action helpers mutate a draft state (a deep clone made by the store). */

export const ROLE_RANK: Record<Role, number> = { cashier: 1, supervisor: 2, manager: 3 };

export function can(staff: Staff | undefined, min: Role): boolean {
  return !!staff && ROLE_RANK[staff.role] >= ROLE_RANK[min];
}

export function audit(s: AppState, staffId: string, action: string, detail: string) {
  s.audit.unshift({ id: uid(), at: new Date().toISOString(), staffId, action, detail });
  if (s.audit.length > 2000) s.audit.length = 2000;
}

export function currentShift(s: AppState): Shift | undefined {
  return s.shifts.find((sh) => !sh.closedAt);
}

export function openShift(s: AppState, staffId: string, openingFloat: number): Shift {
  if (currentShift(s)) throw new Error('A shift is already open');
  const shift: Shift = {
    id: uid(),
    openedAt: new Date().toISOString(),
    openedBy: staffId,
    openingFloat,
    movements: [],
  };
  s.shifts.unshift(shift);
  audit(s, staffId, 'shift_open', `Float ${openingFloat}`);
  return shift;
}

export interface ShiftSummary {
  salesCount: number;
  grossSales: number;
  refunds: number;
  vat: number;
  byMethod: Record<string, number>;
  payouts: number;
  cashIn: number;
  expectedCash: number;
}

export function summariseShift(s: AppState, shift: Shift): ShiftSummary {
  const sales = s.sales.filter((x) => x.shiftId === shift.id);
  const byMethod: Record<string, number> = { cash: 0, card: 0, eft: 0, account: 0 };
  let grossSales = 0;
  let refunds = 0;
  let vat = 0;
  let salesCount = 0;
  for (const sale of sales) {
    for (const p of sale.payments) byMethod[p.method] = (byMethod[p.method] ?? 0) + p.amount;
    // Change is given in cash
    byMethod.cash -= sale.change;
    vat += sale.totals.vat;
    if (sale.refundOf) refunds += -sale.totals.total;
    else {
      grossSales += sale.totals.total;
      salesCount++;
    }
  }
  const payouts = shift.movements.filter((m) => m.type === 'payout').reduce((a, m) => a + m.amount, 0);
  const cashIn = shift.movements.filter((m) => m.type === 'cash_in').reduce((a, m) => a + m.amount, 0);
  return {
    salesCount,
    grossSales,
    refunds,
    vat,
    byMethod,
    payouts,
    cashIn,
    expectedCash: shift.openingFloat + byMethod.cash - payouts + cashIn,
  };
}

export function closeShift(s: AppState, staffId: string, countedCash: number) {
  const shift = currentShift(s);
  if (!shift) throw new Error('No open shift');
  const sum = summariseShift(s, shift);
  shift.closedAt = new Date().toISOString();
  shift.closedBy = staffId;
  shift.countedCash = countedCash;
  shift.expectedCash = sum.expectedCash;
  audit(s, staffId, 'shift_close', `Expected ${sum.expectedCash}, counted ${countedCash}`);
}

export interface CompleteSaleInput {
  staffId: string;
  customerId: string | null;
  lines: CartLine[];
  payments: Payment[];
  cartDiscountPct: number;
  note?: string;
}

export function completeSale(s: AppState, input: CompleteSaleInput): Sale {
  const shift = currentShift(s);
  if (!shift) throw new Error('Open a shift before selling');
  if (input.lines.length === 0) throw new Error('Cart is empty');

  // Bake the cart discount into each line so receipts and refunds stay consistent.
  const lines = bakeCartDiscount(input.lines, input.cartDiscountPct);
  const totals = calcTotals(lines, s.settings.vatRate);
  const paid = paidAmount(input.payments);
  if (paid < totals.total) throw new Error('Payment is short');

  const nonCash = input.payments.filter((p) => p.method !== 'cash').reduce((a, p) => a + p.amount, 0);
  if (nonCash > totals.total) throw new Error('Card/EFT/account cannot exceed the total');
  const change = paid - totals.total;

  const accountPay = input.payments.find((p) => p.method === 'account');
  if (accountPay) {
    const c = s.customers.find((x) => x.id === input.customerId);
    if (!c) throw new Error('Select a customer to charge to account');
    if (c.accountBalance + accountPay.amount > c.accountLimit) throw new Error('Customer account limit exceeded');
    c.accountBalance += accountPay.amount;
  }

  for (const l of lines) {
    const prod = s.products.find((x) => x.id === l.productId);
    if (prod) prod.stock -= l.qty;
  }

  if (input.customerId) {
    const c = s.customers.find((x) => x.id === input.customerId);
    if (c) c.loyaltyPoints += Math.floor(totals.total / (s.settings.loyaltyRandPerPoint * 100));
  }

  const sale: Sale = {
    id: uid(),
    number: s.nextSaleNumber++,
    createdAt: new Date().toISOString(),
    staffId: input.staffId,
    customerId: input.customerId,
    shiftId: shift.id,
    lines,
    totals,
    payments: input.payments,
    change,
    status: 'completed',
    note: input.note,
  };
  s.sales.unshift(sale);
  audit(s, input.staffId, 'sale', `#${sale.number} ${totals.total}`);
  return sale;
}

/** Refund selected quantities from a sale back to a single tender. */
export function refundSale(
  s: AppState,
  staffId: string,
  saleId: string,
  qtys: Record<string, number>,
  method: Payment['method'],
  reason: string,
): Sale {
  const shift = currentShift(s);
  if (!shift) throw new Error('Open a shift before refunding');
  const orig = s.sales.find((x) => x.id === saleId);
  if (!orig || orig.refundOf) throw new Error('Sale not found');

  const already = alreadyRefunded(s, orig.id);
  const lines: CartLine[] = [];
  for (const l of orig.lines) {
    const q = qtys[l.productId] ?? 0;
    if (q <= 0) continue;
    if (q > l.qty - (already[l.productId] ?? 0)) throw new Error(`Too many ${l.name} refunded`);
    lines.push({ ...l, qty: -q });
  }
  if (!lines.length) throw new Error('Nothing selected to refund');

  const totals = calcTotals(lines, s.settings.vatRate);
  if (method === 'account') {
    const c = s.customers.find((x) => x.id === orig.customerId);
    if (!c) throw new Error('Original sale has no customer account');
    c.accountBalance += totals.total;
  }
  for (const l of lines) {
    const prod = s.products.find((x) => x.id === l.productId);
    if (prod) prod.stock -= l.qty; // qty negative → stock goes up
  }

  const refund: Sale = {
    id: uid(),
    number: s.nextSaleNumber++,
    createdAt: new Date().toISOString(),
    staffId,
    customerId: orig.customerId,
    shiftId: shift.id,
    lines,
    totals,
    payments: [{ method, amount: totals.total }],
    change: 0,
    status: 'completed',
    refundOf: orig.id,
    note: reason,
  };
  s.sales.unshift(refund);

  const after = alreadyRefunded(s, orig.id);
  const fully = orig.lines.every((l) => (after[l.productId] ?? 0) >= l.qty);
  orig.status = fully ? 'refunded' : 'partially_refunded';
  audit(s, staffId, 'refund', `#${refund.number} of #${orig.number}: ${reason}`);
  return refund;
}

export function alreadyRefunded(s: AppState, saleId: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of s.sales) {
    if (r.refundOf !== saleId) continue;
    for (const l of r.lines) out[l.productId] = (out[l.productId] ?? 0) - l.qty;
  }
  return out;
}

export function receiveStock(s: AppState, staffId: string, productId: string, qty: number, note: string) {
  const prod = s.products.find((x) => x.id === productId);
  if (!prod) throw new Error('Product not found');
  prod.stock += qty;
  audit(s, staffId, qty >= 0 ? 'stock_receive' : 'stock_adjust', `${prod.name} ${qty > 0 ? '+' : ''}${qty} ${note}`);
}

export const PETTY_CATEGORIES = ['Cleaning', 'Stationery', 'Refreshments', 'Transport', 'Maintenance', 'Postage', 'Other'];

export function pettyBalance(s: AppState): number {
  return s.pettyCash.reduce((a, e) => a + (e.type === 'top_up' ? e.amount : -e.amount), 0);
}

export function addPettyCash(s: AppState, entry: Omit<PettyCashEntry, 'id' | 'at'>): PettyCashEntry {
  if (!(entry.amount > 0)) throw new Error('Amount must be more than zero');
  if (entry.type === 'expense') {
    if (!entry.description.trim()) throw new Error('Say what the money was spent on');
    if (entry.amount > pettyBalance(s)) throw new Error('Not enough money in petty cash — top it up first');
  }
  const e: PettyCashEntry = { ...entry, id: uid(), at: new Date().toISOString() };
  s.pettyCash.unshift(e);
  audit(s, entry.staffId, entry.type === 'expense' ? 'petty_expense' : 'petty_top_up', `${entry.amount} ${entry.category} ${entry.description}`);
  return e;
}
