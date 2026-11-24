import type { AppState, CartLine, Layby, Payment, PaymentMethod, PettyCashEntry, Product, Role, Sale, Shift, Staff, TillEntry, Voucher } from '../types';
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
  laybyAndVouchers: number;
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
  const byMethod: Record<string, number> = { cash: 0, card: 0, eft: 0, account: 0, voucher: 0 };
  let grossSales = 0;
  let refunds = 0;
  let vat = 0;
  let salesCount = 0;
  for (const sale of sales) {
    // 'layby' settles money already taken as instalments, so it is not new money in the till.
    for (const p of sale.payments) if (p.method !== 'layby') byMethod[p.method] = (byMethod[p.method] ?? 0) + p.amount;
    // Change is given in cash
    byMethod.cash -= sale.change;
    vat += sale.totals.vat;
    if (sale.refundOf) refunds += -sale.totals.total;
    else {
      grossSales += sale.totals.total;
      salesCount++;
    }
  }
  let laybyAndVouchers = 0;
  for (const t of s.tillEntries ?? []) {
    if (t.shiftId !== shift.id) continue;
    byMethod[t.method] = (byMethod[t.method] ?? 0) + t.amount;
    laybyAndVouchers += t.amount;
  }
  const payouts = shift.movements.filter((m) => m.type === 'payout').reduce((a, m) => a + m.amount, 0);
  const cashIn = shift.movements.filter((m) => m.type === 'cash_in').reduce((a, m) => a + m.amount, 0);
  return {
    laybyAndVouchers,
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

  for (const p of input.payments) {
    if (p.method === 'layby') throw new Error('Lay-by is not a payment method at the till');
    if (p.method !== 'voucher') continue;
    const v = findVoucher(s, p.reference ?? '');
    checkVoucher(v, p.amount);
  }

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
  for (const p of input.payments) {
    if (p.method !== 'voucher') continue;
    const v = findVoucher(s, p.reference ?? '')!;
    v.balance -= p.amount;
    v.redemptions.push({ at: sale.createdAt, amount: p.amount, saleId: sale.id });
  }
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

/* ---------------- Barcodes: single items and boxes ---------------- */

/** Find what a scanned code refers to: an item barcode, SKU, or a box barcode (with its pack quantity). */
export function findByCode(products: Product[], code: string): { product: Product; qty: number; isPack: boolean } | undefined {
  const c = code.trim();
  if (!c) return undefined;
  for (const p of products) {
    if (!p.active) continue;
    if (p.barcode === c || p.sku.toLowerCase() === c.toLowerCase()) return { product: p, qty: 1, isPack: false };
  }
  for (const p of products) {
    if (!p.active) continue;
    const pack = p.packs?.find((k) => k.barcode === c);
    if (pack) return { product: p, qty: pack.qty, isPack: true };
  }
  return undefined;
}

/** Remember an unknown barcode: either the item's own barcode (qty 1) or a box of N. */
export function linkBarcode(s: AppState, staffId: string, productId: string, barcode: string, qty: number) {
  const code = barcode.trim();
  if (!code) throw new Error('No barcode');
  if (!(qty >= 1)) throw new Error('Quantity per box must be at least 1');
  const used = findByCode(s.products, code);
  if (used) throw new Error(`That barcode already belongs to ${used.product.name}`);
  const p = s.products.find((x) => x.id === productId);
  if (!p) throw new Error('Product not found');
  if (qty === 1 && !p.barcode) p.barcode = code;
  else (p.packs ??= []).push({ barcode: code, qty });
  audit(s, staffId, 'barcode_link', `${code} → ${p.name}${qty > 1 ? ` (box of ${qty})` : ''}`);
}

export interface ReceiveLine {
  productId: string;
  qty: number;
  /** New cost price excl. VAT per unit, optional */
  cost?: number;
}

/** Post a delivery into stock in one go. */
export function postDelivery(s: AppState, staffId: string, lines: ReceiveLine[], supplier: string, invoice: string) {
  if (!lines.length) throw new Error('Nothing to receive');
  const note = [supplier && `from ${supplier}`, invoice && `inv ${invoice}`].filter(Boolean).join(' ');
  for (const l of lines) {
    if (!l.qty) continue;
    receiveStock(s, staffId, l.productId, l.qty, note);
    if (l.cost !== undefined && !isNaN(l.cost)) {
      const p = s.products.find((x) => x.id === l.productId);
      if (p) p.cost = l.cost;
    }
  }
  audit(s, staffId, 'delivery', `${lines.length} lines ${note}`);
}

/* ---------------- Till entries (non-sale money) ---------------- */

function tillEntry(s: AppState, e: Omit<TillEntry, 'id' | 'at' | 'shiftId'>) {
  const shift = currentShift(s);
  if (!shift) throw new Error('Open the till first');
  const t: TillEntry = { ...e, id: uid(), at: new Date().toISOString(), shiftId: shift.id };
  s.tillEntries.unshift(t);
  return t;
}

const TILL_METHODS: PaymentMethod[] = ['cash', 'card', 'eft'];

/* ---------------- Lay-bys ---------------- */

export const laybyPaid = (l: Layby) => l.payments.reduce((a, p) => a + p.amount, 0);
export const laybyBalance = (l: Layby) => l.total - laybyPaid(l);
export const laybyOverdue = (l: Layby) => l.status === 'open' && new Date(l.dueDate).getTime() < Date.now();

export interface CreateLaybyInput {
  staffId: string;
  customerId: string;
  lines: CartLine[];
  cartDiscountPct: number;
  deposit: number;
  method: PaymentMethod;
}

/** Reserve the goods (stock comes off the shelf now) and take the deposit. */
export function createLayby(s: AppState, input: CreateLaybyInput): Layby {
  const shift = currentShift(s);
  if (!shift) throw new Error('Open the till first');
  if (!input.lines.length) throw new Error('Add items to the lay-by');
  const customer = s.customers.find((c) => c.id === input.customerId);
  if (!customer) throw new Error('Choose the customer for this lay-by');
  if (!customer.phone.trim()) throw new Error('A phone number is needed for lay-by customers');
  if (!TILL_METHODS.includes(input.method)) throw new Error('Deposit must be cash, card or EFT');
  const lines = bakeCartDiscount(input.lines, input.cartDiscountPct);
  const total = calcTotals(lines, s.settings.vatRate).total;
  const minDeposit = Math.ceil((total * (s.settings.laybyMinDepositPct ?? 10)) / 100);
  if (input.deposit < minDeposit) throw new Error(`Deposit must be at least ${(minDeposit / 100).toFixed(2)}`);
  if (input.deposit > total) throw new Error('Deposit is more than the lay-by total');

  for (const l of lines) {
    const p = s.products.find((x) => x.id === l.productId);
    if (p) p.stock -= l.qty;
  }
  const due = new Date();
  due.setMonth(due.getMonth() + (s.settings.laybyMonths ?? 3));
  const layby: Layby = {
    id: uid(),
    number: s.nextLaybyNumber++,
    customerId: customer.id,
    createdAt: new Date().toISOString(),
    staffId: input.staffId,
    dueDate: due.toISOString(),
    lines,
    total,
    payments: [{ at: new Date().toISOString(), method: input.method, amount: input.deposit, staffId: input.staffId, shiftId: shift.id }],
    status: 'open',
  };
  s.laybys.unshift(layby);
  tillEntry(s, { staffId: input.staffId, kind: 'layby_payment', method: input.method, amount: input.deposit, reference: `LB${layby.number}` });
  audit(s, input.staffId, 'layby_open', `LB${layby.number} ${customer.name} total ${total} deposit ${input.deposit}`);
  if (input.deposit === total) finishLayby(s, layby, input.staffId);
  return layby;
}

export function payLayby(s: AppState, staffId: string, laybyId: string, amount: number, method: PaymentMethod): Layby {
  const l = s.laybys.find((x) => x.id === laybyId);
  if (!l || l.status !== 'open') throw new Error('This lay-by is not open');
  if (!TILL_METHODS.includes(method)) throw new Error('Pay with cash, card or EFT');
  if (!(amount > 0)) throw new Error('Enter an amount');
  if (amount > laybyBalance(l)) throw new Error('That is more than what is owed');
  const t = tillEntry(s, { staffId, kind: 'layby_payment', method, amount, reference: `LB${l.number}` });
  l.payments.push({ at: t.at, method, amount, staffId, shiftId: t.shiftId });
  audit(s, staffId, 'layby_payment', `LB${l.number} ${amount}`);
  if (laybyBalance(l) === 0) finishLayby(s, l, staffId);
  return l;
}

/** Fully paid: the goods are handed over and it becomes a normal (tax invoice) sale. */
function finishLayby(s: AppState, l: Layby, staffId: string) {
  const shift = currentShift(s)!;
  const sale: Sale = {
    id: uid(),
    number: s.nextSaleNumber++,
    createdAt: new Date().toISOString(),
    staffId,
    customerId: l.customerId,
    shiftId: shift.id,
    lines: l.lines,
    totals: calcTotals(l.lines, s.settings.vatRate),
    payments: [{ method: 'layby', amount: l.total, reference: `LB${l.number}` }],
    change: 0,
    status: 'completed',
    note: `Lay-by LB${l.number} collected`,
  };
  s.sales.unshift(sale);
  l.status = 'completed';
  l.saleId = sale.id;
  l.closedAt = sale.createdAt;
  const c = s.customers.find((x) => x.id === l.customerId);
  if (c) c.loyaltyPoints += Math.floor(l.total / (s.settings.loyaltyRandPerPoint * 100));
  audit(s, staffId, 'layby_complete', `LB${l.number} → sale #${sale.number}`);
}

/** Cancel: goods go back on the shelf, customer is refunded what they paid minus the cancellation fee. */
export function cancelLayby(s: AppState, staffId: string, laybyId: string, method: PaymentMethod): { refund: number; fee: number } {
  const l = s.laybys.find((x) => x.id === laybyId);
  if (!l || l.status !== 'open') throw new Error('This lay-by is not open');
  if (!TILL_METHODS.includes(method)) throw new Error('Refund with cash, card or EFT');
  const paid = laybyPaid(l);
  const fee = Math.min(paid, Math.round((l.total * (s.settings.laybyCancelFeePct ?? 10)) / 100));
  const refund = paid - fee;
  for (const line of l.lines) {
    const p = s.products.find((x) => x.id === line.productId);
    if (p) p.stock += line.qty;
  }
  if (refund > 0) tillEntry(s, { staffId, kind: 'layby_refund', method, amount: -refund, reference: `LB${l.number}` });
  l.status = 'cancelled';
  l.cancelFee = fee;
  l.closedAt = new Date().toISOString();
  audit(s, staffId, 'layby_cancel', `LB${l.number} refund ${refund} fee ${fee}`);
  return { refund, fee };
}

/* ---------------- Gift vouchers ---------------- */

export function findVoucher(s: AppState, code: string): Voucher | undefined {
  const c = code.trim().toUpperCase().replace(/\s/g, '');
  return s.vouchers.find((v) => v.code.replace(/-/g, '') === c.replace(/-/g, ''));
}

export function checkVoucher(v: Voucher | undefined, amount: number) {
  if (!v) throw new Error('Voucher not found');
  if (v.status !== 'active') throw new Error('This voucher has been cancelled');
  if (new Date(v.expiresAt).getTime() < Date.now()) throw new Error('This voucher has expired');
  if (amount > v.balance) throw new Error(`Voucher only has ${(v.balance / 100).toFixed(2)} left`);
}

function voucherCode(s: AppState): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (;;) {
    let c = 'NX';
    for (let i = 0; i < 8; i++) c += (i % 4 === 0 ? '-' : '') + chars[Math.floor(Math.random() * chars.length)];
    if (!findVoucher(s, c)) return c;
  }
}

export interface IssueVoucherInput {
  staffId: string;
  value: number;
  holderName: string;
  holderPhone: string;
  method: PaymentMethod;
}

/** Sell a gift voucher. Valid for 3 years (the minimum under the SA Consumer Protection Act). */
export function issueVoucher(s: AppState, input: IssueVoucherInput): Voucher {
  if (!(input.value > 0)) throw new Error('Enter the voucher value');
  if (!input.holderName.trim()) throw new Error('Enter who the voucher is for');
  if (!TILL_METHODS.includes(input.method)) throw new Error('Pay with cash, card or EFT');
  const now = new Date();
  const exp = new Date(now);
  exp.setFullYear(exp.getFullYear() + 3);
  const v: Voucher = {
    id: uid(),
    code: voucherCode(s),
    initial: input.value,
    balance: input.value,
    createdAt: now.toISOString(),
    expiresAt: exp.toISOString(),
    holderName: input.holderName.trim(),
    holderPhone: input.holderPhone.trim(),
    status: 'active',
    staffId: input.staffId,
    redemptions: [],
  };
  tillEntry(s, { staffId: input.staffId, kind: 'voucher_sale', method: input.method, amount: input.value, reference: v.code });
  s.vouchers.unshift(v);
  audit(s, input.staffId, 'voucher_issue', `${v.code} ${input.value} for ${v.holderName}`);
  return v;
}

export function voidVoucher(s: AppState, staffId: string, id: string, reason: string) {
  const v = s.vouchers.find((x) => x.id === id);
  if (!v) throw new Error('Voucher not found');
  v.status = 'void';
  audit(s, staffId, 'voucher_void', `${v.code} balance ${v.balance}: ${reason}`);
}
