export type Role = 'cashier' | 'supervisor' | 'manager';

export interface Staff {
  id: string;
  name: string;
  pin: string;
  role: Role;
  active: boolean;
}

export interface Product {
  id: string;
  sku: string;
  barcode: string;
  name: string;
  category: string;
  /** Selling price, VAT inclusive, in cents */
  price: number;
  /** Cost price, VAT exclusive, in cents */
  cost: number;
  stock: number;
  reorderLevel: number;
  vatExempt: boolean;
  favourite: boolean;
  active: boolean;
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  email: string;
  loyaltyPoints: number;
  /** Account balance owed, in cents */
  accountBalance: number;
  accountLimit: number;
  notes: string;
}

export interface CartLine {
  productId: string;
  name: string;
  unitPrice: number;
  qty: number;
  /** Line discount as percentage 0-100 */
  discountPct: number;
  vatExempt: boolean;
}

export type PaymentMethod = 'cash' | 'card' | 'eft' | 'account';

export interface Payment {
  method: PaymentMethod;
  amount: number;
  /** Card auth code / terminal reference */
  reference?: string;
}

export interface SaleTotals {
  subtotal: number;
  discount: number;
  total: number;
  vat: number;
  exVat: number;
}

export interface Sale {
  id: string;
  number: number;
  createdAt: string;
  staffId: string;
  customerId: string | null;
  shiftId: string;
  lines: CartLine[];
  totals: SaleTotals;
  payments: Payment[];
  change: number;
  status: 'completed' | 'refunded' | 'partially_refunded';
  refundOf?: string;
  note?: string;
}

export interface ParkedSale {
  id: string;
  label: string;
  createdAt: string;
  staffId: string;
  customerId: string | null;
  lines: CartLine[];
}

export interface CashMovement {
  id: string;
  at: string;
  type: 'payout' | 'cash_in';
  amount: number;
  reason: string;
  staffId: string;
}

export interface Shift {
  id: string;
  openedAt: string;
  openedBy: string;
  openingFloat: number;
  closedAt?: string;
  closedBy?: string;
  countedCash?: number;
  expectedCash?: number;
  movements: CashMovement[];
}

/** Petty cash box — separate from the till drawer, for small business expenses. */
export interface PettyCashEntry {
  id: string;
  at: string;
  type: 'top_up' | 'expense';
  amount: number;
  category: string;
  description: string;
  /** Slip / invoice number */
  reference: string;
  staffId: string;
  approvedBy?: string;
}

export interface AuditEntry {
  id: string;
  at: string;
  staffId: string;
  action: string;
  detail: string;
}

export interface Settings {
  businessName: string;
  vatNumber: string;
  address: string;
  receiptFooter: string;
  vatRate: number;
  currency: string;
  /** Max discount % a cashier can give without manager approval */
  cashierMaxDiscount: number;
  loyaltyRandPerPoint: number;
  terminal?: import('./lib/devices').TerminalConfig;
  scannerSuffix?: 'Enter' | 'Tab';
}

export interface AppState {
  version: number;
  settings: Settings;
  staff: Staff[];
  products: Product[];
  customers: Customer[];
  sales: Sale[];
  parked: ParkedSale[];
  shifts: Shift[];
  audit: AuditEntry[];
  pettyCash: PettyCashEntry[];
  nextSaleNumber: number;
}
