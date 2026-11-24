import { describe, expect, it } from 'vitest';
import { createRequire } from 'module';
import { mkdtempSync, existsSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { seedState } from './seed';
import { addPettyCash, completeSale, openShift, refundSale } from './actions';

const require = createRequire(import.meta.url);
const { PosDatabase } = require('../../electron/db.cjs');

describe('SQLite database (desktop app)', () => {
  it('saves and reloads the full state from a .db file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nexora-'));
    const file = join(dir, 'nexora.db');

    const s = seedState();
    openShift(s, 'staff-csh', 50000);
    const p = s.products[0];
    const sale = completeSale(s, {
      staffId: 'staff-csh',
      customerId: s.customers[0].id,
      lines: [{ productId: p.id, name: p.name, unitPrice: p.price, qty: 2, discountPct: 0, vatExempt: false }],
      payments: [{ method: 'cash', amount: 10000 }],
      cartDiscountPct: 10,
    });
    refundSale(s, 'staff-mgr', sale.id, { [p.id]: 1 }, 'cash', 'test');
    s.shifts[0].movements.push({ id: 'mv1', at: new Date().toISOString(), type: 'payout', amount: 500, reason: 'milk', staffId: 'staff-mgr' });
    s.parked.push({ id: 'pk1', label: 'Table 4', createdAt: new Date().toISOString(), staffId: 'staff-csh', customerId: null, lines: sale.lines });

    addPettyCash(s, { type: 'top_up', amount: 100000, category: 'Float', description: 'Monthly', reference: '', staffId: 'staff-mgr' });
    addPettyCash(s, { type: 'expense', amount: 4599, category: 'Cleaning', description: 'Mop', reference: 'INV1', staffId: 'staff-sup', approvedBy: 'staff-sup' });

    const db = await PosDatabase.open(file);
    expect(db.load()).toBeNull();
    db.save(s);
    db.close();
    expect(existsSync(file)).toBe(true);

    const db2 = await PosDatabase.open(file);
    const loaded = db2.load();
    expect(loaded).toEqual(JSON.parse(JSON.stringify(s)));

    // Real SQL works against the file
    const rows = db2.rows("SELECT p.name, SUM(l.qty) AS sold FROM sale_lines l JOIN products p ON p.id = l.product_id GROUP BY p.name");
    expect(rows).toEqual([{ name: p.name, sold: 1 }]);

    db2.dailyBackup(join(dir, 'backups'));
    expect(readdirSync(join(dir, 'backups'))).toHaveLength(1);
    db2.close();
  });
});
