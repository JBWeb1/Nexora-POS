// SQLite storage for the desktop app (sql.js = SQLite compiled to WebAssembly, no native build needed).
// The database is a normal .db file you can open in any SQLite tool (e.g. "DB Browser for SQLite").
const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

const SCHEMA_VERSION = 1;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS staff (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, pin TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('cashier','supervisor','manager')),
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY, sku TEXT, barcode TEXT, name TEXT NOT NULL, category TEXT NOT NULL,
  price_cents INTEGER NOT NULL, cost_cents INTEGER NOT NULL, stock INTEGER NOT NULL, reorder_level INTEGER NOT NULL,
  vat_exempt INTEGER NOT NULL, favourite INTEGER NOT NULL, active INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);
CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, phone TEXT, email TEXT, loyalty_points INTEGER NOT NULL,
  account_balance_cents INTEGER NOT NULL, account_limit_cents INTEGER NOT NULL, notes TEXT
);
CREATE TABLE IF NOT EXISTS shifts (
  id TEXT PRIMARY KEY, opened_at TEXT NOT NULL, opened_by TEXT NOT NULL, opening_float_cents INTEGER NOT NULL,
  closed_at TEXT, closed_by TEXT, counted_cash_cents INTEGER, expected_cash_cents INTEGER
);
CREATE TABLE IF NOT EXISTS cash_movements (
  id TEXT PRIMARY KEY, shift_id TEXT NOT NULL REFERENCES shifts(id), at TEXT NOT NULL, type TEXT NOT NULL,
  amount_cents INTEGER NOT NULL, reason TEXT, staff_id TEXT
);
CREATE TABLE IF NOT EXISTS sales (
  id TEXT PRIMARY KEY, number INTEGER NOT NULL UNIQUE, created_at TEXT NOT NULL, staff_id TEXT NOT NULL,
  customer_id TEXT, shift_id TEXT NOT NULL, subtotal_cents INTEGER NOT NULL, discount_cents INTEGER NOT NULL,
  total_cents INTEGER NOT NULL, vat_cents INTEGER NOT NULL, ex_vat_cents INTEGER NOT NULL, change_cents INTEGER NOT NULL,
  status TEXT NOT NULL, refund_of TEXT, note TEXT
);
CREATE INDEX IF NOT EXISTS idx_sales_created ON sales(created_at);
CREATE INDEX IF NOT EXISTS idx_sales_customer ON sales(customer_id);
CREATE TABLE IF NOT EXISTS sale_lines (
  sale_id TEXT NOT NULL REFERENCES sales(id), line_no INTEGER NOT NULL, product_id TEXT NOT NULL, name TEXT NOT NULL,
  unit_price_cents INTEGER NOT NULL, qty INTEGER NOT NULL, discount_pct REAL NOT NULL, vat_exempt INTEGER NOT NULL,
  PRIMARY KEY (sale_id, line_no)
);
CREATE INDEX IF NOT EXISTS idx_lines_product ON sale_lines(product_id);
CREATE TABLE IF NOT EXISTS payments (
  sale_id TEXT NOT NULL REFERENCES sales(id), seq INTEGER NOT NULL, method TEXT NOT NULL, amount_cents INTEGER NOT NULL,
  reference TEXT,
  PRIMARY KEY (sale_id, seq)
);
CREATE TABLE IF NOT EXISTS parked_sales (
  id TEXT PRIMARY KEY, label TEXT, created_at TEXT NOT NULL, staff_id TEXT, customer_id TEXT, lines_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS petty_cash (
  id TEXT PRIMARY KEY, at TEXT NOT NULL, type TEXT NOT NULL CHECK (type IN ('top_up','expense')), amount_cents INTEGER NOT NULL,
  category TEXT, description TEXT, reference TEXT, staff_id TEXT, approved_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_petty_at ON petty_cash(at);
CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY, at TEXT NOT NULL, staff_id TEXT, action TEXT NOT NULL, detail TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log(at);
`;

const TABLES = ['staff', 'products', 'customers', 'cash_movements', 'shifts', 'payments', 'sale_lines', 'sales', 'parked_sales', 'audit_log', 'petty_cash', 'meta'];

class PosDatabase {
  /** @param {string} file path of the .db file */
  static async open(file) {
    const SQL = await initSqlJs();
    const db = fs.existsSync(file) ? new SQL.Database(fs.readFileSync(file)) : new SQL.Database();
    db.run(SCHEMA);
    PosDatabase.upgrade(db);
    return new PosDatabase(db, file);
  }

  /** Add columns introduced after a database was first created. */
  static upgrade(db) {
    const cols = (t) => (db.exec(`PRAGMA table_info(${t})`)[0]?.values ?? []).map((r) => r[1]);
    if (!cols('payments').includes('reference')) db.run('ALTER TABLE payments ADD COLUMN reference TEXT');
  }

  constructor(db, file) {
    this.db = db;
    this.file = file;
  }

  isEmpty() {
    const r = this.db.exec("SELECT value FROM meta WHERE key = 'nextSaleNumber'");
    return r.length === 0;
  }

  rows(sql) {
    const stmt = this.db.prepare(sql);
    const out = [];
    while (stmt.step()) out.push(stmt.getAsObject());
    stmt.free();
    return out;
  }

  /** Read the whole database into the app's state shape. Returns null for a brand new database. */
  load() {
    if (this.isEmpty()) return null;
    const meta = Object.fromEntries(this.rows('SELECT key, value FROM meta').map((r) => [r.key, r.value]));
    const linesBySale = groupBy(this.rows('SELECT * FROM sale_lines ORDER BY sale_id, line_no'), 'sale_id');
    const paysBySale = groupBy(this.rows('SELECT * FROM payments ORDER BY sale_id, seq'), 'sale_id');
    const movesByShift = groupBy(this.rows('SELECT * FROM cash_movements ORDER BY rowid'), 'shift_id');
    const opt = (v) => (v === null || v === undefined ? undefined : v);

    return {
      version: Number(meta.version ?? 1),
      settings: JSON.parse(meta.settings),
      nextSaleNumber: Number(meta.nextSaleNumber),
      staff: this.rows('SELECT * FROM staff ORDER BY rowid').map((r) => ({ id: r.id, name: r.name, pin: r.pin, role: r.role, active: !!r.active })),
      products: this.rows('SELECT * FROM products ORDER BY rowid').map((r) => ({
        id: r.id, sku: r.sku, barcode: r.barcode, name: r.name, category: r.category, price: r.price_cents, cost: r.cost_cents,
        stock: r.stock, reorderLevel: r.reorder_level, vatExempt: !!r.vat_exempt, favourite: !!r.favourite, active: !!r.active,
      })),
      customers: this.rows('SELECT * FROM customers ORDER BY rowid').map((r) => ({
        id: r.id, name: r.name, phone: r.phone ?? '', email: r.email ?? '', loyaltyPoints: r.loyalty_points,
        accountBalance: r.account_balance_cents, accountLimit: r.account_limit_cents, notes: r.notes ?? '',
      })),
      sales: this.rows('SELECT * FROM sales ORDER BY rowid').map((r) => ({
        id: r.id, number: r.number, createdAt: r.created_at, staffId: r.staff_id, customerId: r.customer_id ?? null, shiftId: r.shift_id,
        lines: (linesBySale[r.id] ?? []).map((l) => ({
          productId: l.product_id, name: l.name, unitPrice: l.unit_price_cents, qty: l.qty, discountPct: l.discount_pct, vatExempt: !!l.vat_exempt,
        })),
        totals: { subtotal: r.subtotal_cents, discount: r.discount_cents, total: r.total_cents, vat: r.vat_cents, exVat: r.ex_vat_cents },
        payments: (paysBySale[r.id] ?? []).map((p) => ({ method: p.method, amount: p.amount_cents, reference: opt(p.reference) })),
        change: r.change_cents, status: r.status, refundOf: opt(r.refund_of), note: opt(r.note),
      })),
      parked: this.rows('SELECT * FROM parked_sales ORDER BY rowid').map((r) => ({
        id: r.id, label: r.label, createdAt: r.created_at, staffId: r.staff_id, customerId: r.customer_id ?? null, lines: JSON.parse(r.lines_json),
      })),
      shifts: this.rows('SELECT * FROM shifts ORDER BY rowid').map((r) => ({
        id: r.id, openedAt: r.opened_at, openedBy: r.opened_by, openingFloat: r.opening_float_cents, closedAt: opt(r.closed_at),
        closedBy: opt(r.closed_by), countedCash: opt(r.counted_cash_cents), expectedCash: opt(r.expected_cash_cents),
        movements: (movesByShift[r.id] ?? []).map((m) => ({
          id: m.id, at: m.at, type: m.type, amount: m.amount_cents, reason: m.reason ?? '', staffId: m.staff_id,
        })),
      })),
      pettyCash: this.rows('SELECT * FROM petty_cash ORDER BY rowid').map((r) => ({
        id: r.id, at: r.at, type: r.type, amount: r.amount_cents, category: r.category ?? '', description: r.description ?? '',
        reference: r.reference ?? '', staffId: r.staff_id, approvedBy: opt(r.approved_by),
      })),
      audit: this.rows('SELECT * FROM audit_log ORDER BY rowid').map((r) => ({
        id: r.id, at: r.at, staffId: r.staff_id, action: r.action, detail: r.detail ?? '',
      })),
    };
  }

  /** Write the full app state in one transaction, then flush to disk atomically. */
  save(s) {
    const db = this.db;
    const ins = (sql, rows, map) => {
      const stmt = db.prepare(sql);
      for (const r of rows) stmt.run(map(r));
      stmt.free();
    };
    const b = (v) => (v ? 1 : 0);
    const n = (v) => (v === undefined ? null : v);

    db.run('BEGIN');
    try {
      for (const t of TABLES) db.run(`DELETE FROM ${t}`);
      ins('INSERT INTO meta VALUES (?, ?)', [
        ['schemaVersion', String(SCHEMA_VERSION)], ['version', String(s.version)],
        ['nextSaleNumber', String(s.nextSaleNumber)], ['settings', JSON.stringify(s.settings)],
      ], (r) => r);
      ins('INSERT INTO staff VALUES (?,?,?,?,?)', s.staff, (x) => [x.id, x.name, x.pin, x.role, b(x.active)]);
      ins('INSERT INTO products VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', s.products, (p) => [
        p.id, p.sku, p.barcode, p.name, p.category, p.price, p.cost, p.stock, p.reorderLevel, b(p.vatExempt), b(p.favourite), b(p.active),
      ]);
      ins('INSERT INTO customers VALUES (?,?,?,?,?,?,?,?)', s.customers, (c) => [
        c.id, c.name, c.phone, c.email, c.loyaltyPoints, c.accountBalance, c.accountLimit, c.notes,
      ]);
      ins('INSERT INTO shifts VALUES (?,?,?,?,?,?,?,?)', s.shifts, (x) => [
        x.id, x.openedAt, x.openedBy, x.openingFloat, n(x.closedAt), n(x.closedBy), n(x.countedCash), n(x.expectedCash),
      ]);
      ins('INSERT INTO cash_movements VALUES (?,?,?,?,?,?,?)', s.shifts.flatMap((sh) => sh.movements.map((m) => ({ ...m, shiftId: sh.id }))), (m) => [
        m.id, m.shiftId, m.at, m.type, m.amount, m.reason, m.staffId,
      ]);
      ins('INSERT INTO sales VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', s.sales, (x) => [
        x.id, x.number, x.createdAt, x.staffId, x.customerId, x.shiftId, x.totals.subtotal, x.totals.discount, x.totals.total,
        x.totals.vat, x.totals.exVat, x.change, x.status, n(x.refundOf), n(x.note),
      ]);
      ins('INSERT INTO sale_lines VALUES (?,?,?,?,?,?,?,?)', s.sales.flatMap((x) => x.lines.map((l, i) => ({ ...l, saleId: x.id, i }))), (l) => [
        l.saleId, l.i, l.productId, l.name, l.unitPrice, l.qty, l.discountPct, b(l.vatExempt),
      ]);
      ins('INSERT INTO payments (sale_id, seq, method, amount_cents, reference) VALUES (?,?,?,?,?)', s.sales.flatMap((x) => x.payments.map((p, i) => ({ ...p, saleId: x.id, i }))), (p) => [
        p.saleId, p.i, p.method, p.amount, n(p.reference),
      ]);
      ins('INSERT INTO parked_sales VALUES (?,?,?,?,?,?)', s.parked, (p) => [
        p.id, p.label, p.createdAt, p.staffId, p.customerId, JSON.stringify(p.lines),
      ]);
      ins('INSERT INTO petty_cash VALUES (?,?,?,?,?,?,?,?,?)', s.pettyCash ?? [], (e) => [
        e.id, e.at, e.type, e.amount, e.category, e.description, e.reference, e.staffId, n(e.approvedBy),
      ]);
      ins('INSERT INTO audit_log VALUES (?,?,?,?,?)', s.audit, (a) => [a.id, a.at, a.staffId, a.action, a.detail]);
      db.run('COMMIT');
    } catch (e) {
      db.run('ROLLBACK');
      throw e;
    }
    this.flush();
  }

  flush() {
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, Buffer.from(this.db.export()));
    fs.renameSync(tmp, this.file);
  }

  /** Keep one copy of the database per day, deleting copies older than `keep` days. */
  dailyBackup(dir, keep = 30) {
    if (!fs.existsSync(this.file)) return;
    fs.mkdirSync(dir, { recursive: true });
    const today = new Date().toISOString().slice(0, 10);
    const target = path.join(dir, `nexora-${today}.db`);
    if (!fs.existsSync(target)) fs.copyFileSync(this.file, target);
    const files = fs.readdirSync(dir).filter((f) => /^nexora-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort();
    for (const f of files.slice(0, Math.max(0, files.length - keep))) fs.unlinkSync(path.join(dir, f));
  }

  close() {
    this.db.close();
  }
}

function groupBy(rows, key) {
  const out = {};
  for (const r of rows) (out[r[key]] ??= []).push(r);
  return out;
}

module.exports = { PosDatabase };
