import type { AppState, Product } from '../types';
import { uid } from './id';

const p = (
  sku: string,
  barcode: string,
  name: string,
  category: string,
  price: number,
  cost: number,
  stock: number,
  extra: Partial<Product> = {},
): Product => ({
  id: uid(),
  sku,
  barcode,
  name,
  category,
  price,
  cost,
  stock,
  reorderLevel: 5,
  vatExempt: false,
  favourite: false,
  active: true,
  ...extra,
});

export function seedState(): AppState {
  return {
    version: 1,
    settings: {
      businessName: 'Nexora Demo Store',
      vatNumber: '4000000000',
      address: '1 Main Road, Cape Town',
      receiptFooter: 'Thank you for shopping with us!',
      vatRate: 15,
      currency: 'R',
      cashierMaxDiscount: 10,
      loyaltyRandPerPoint: 10,
      laybyMinDepositPct: 10,
      laybyMonths: 3,
      laybyCancelFeePct: 10,
    },
    staff: [
      { id: 'staff-mgr', name: 'Manager', pin: '1234', role: 'manager', active: true },
      { id: 'staff-sup', name: 'Supervisor', pin: '2222', role: 'supervisor', active: true },
      { id: 'staff-csh', name: 'Cashier', pin: '1111', role: 'cashier', active: true },
    ],
    products: [
      p('COF-001', '6001000000011', 'Cappuccino', 'Coffee', 3200, 900, 999, { favourite: true }),
      p('COF-002', '6001000000028', 'Americano', 'Coffee', 2800, 700, 999, { favourite: true }),
      p('COF-003', '6001000000035', 'Flat White', 'Coffee', 3400, 950, 999, { favourite: true }),
      p('BAK-001', '6001000000042', 'Croissant', 'Bakery', 2500, 1000, 24, { favourite: true }),
      p('BAK-002', '6001000000059', 'Blueberry Muffin', 'Bakery', 2900, 1100, 3),
      p('BAK-003', '6001000000066', 'Brown Bread Loaf', 'Bakery', 1899, 1200, 15, { vatExempt: true }),
      p('DRK-001', '6001000000073', 'Still Water 500ml', 'Drinks', 1500, 500, 48, { favourite: true, packs: [{ barcode: '16001000000070', qty: 24 }] }),
      p('DRK-002', '6001000000080', 'Orange Juice 330ml', 'Drinks', 2400, 1100, 30),
      p('DRK-003', '6001000000097', 'Cola 330ml', 'Drinks', 1800, 800, 2),
      p('GRO-001', '6001000000103', 'Fresh Milk 1L', 'Groceries', 2199, 1400, 20, { vatExempt: true }),
      p('GRO-002', '6001000000110', 'Eggs (6)', 'Groceries', 3299, 2200, 12, { vatExempt: true }),
      p('GRO-003', '6001000000127', 'Rooibos Tea 80s', 'Groceries', 5499, 3300, 9),
      p('SNK-001', '6001000000134', 'Biltong 100g', 'Snacks', 6500, 4000, 14, { favourite: true }),
      p('SNK-002', '6001000000141', 'Potato Chips 125g', 'Snacks', 2199, 1200, 40),
      p('SNK-003', '6001000000158', 'Chocolate Bar', 'Snacks', 1699, 900, 60),
    ],
    customers: [
      {
        id: uid(),
        name: 'Thandi Mokoena',
        phone: '0821234567',
        email: 'thandi@example.com',
        loyaltyPoints: 120,
        accountBalance: 0,
        accountLimit: 200000,
        notes: '',
      },
      {
        id: uid(),
        name: 'Pieter van Wyk',
        phone: '0839876543',
        email: '',
        loyaltyPoints: 40,
        accountBalance: 15000,
        accountLimit: 100000,
        notes: 'Pays account monthly',
      },
    ],
    sales: [],
    parked: [],
    shifts: [],
    audit: [],
    pettyCash: [],
    laybys: [],
    vouchers: [],
    tillEntries: [],
    nextSaleNumber: 1001,
    nextLaybyNumber: 1,
  };
}

/** Upgrade data saved by older versions so new features always find their fields. */
export function migrate(s: AppState): AppState {
  s.pettyCash ??= [];
  s.parked ??= [];
  s.audit ??= [];
  s.laybys ??= [];
  s.vouchers ??= [];
  s.tillEntries ??= [];
  s.nextLaybyNumber ??= 1;
  s.settings.laybyMinDepositPct ??= 10;
  s.settings.laybyMonths ??= 3;
  s.settings.laybyCancelFeePct ??= 10;
  return s;
}
