#!/usr/bin/env node
// Nexora POS MCP connector — lets AI assistants (Claude Desktop, Claude Code, etc.) answer questions
// about your shop: "How much did we sell this week?", "What needs reordering?", "Who owes us money?".
//
// READ-ONLY by design: the database file is loaded into memory and never written back,
// and staff PINs are blanked before any query runs.
//
// Usage:  node mcp/server.mjs [path/to/nexora.db]      (or set NEXORA_DB)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const require = createRequire(import.meta.url);
const initSqlJs = require('sql.js');

function defaultDbPath() {
  const app = 'Nexora POS';
  if (process.platform === 'win32') return path.join(process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'), app, 'nexora.db');
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', app, 'nexora.db');
  return path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'), app, 'nexora.db');
}

const DB_PATH = process.argv[2] ?? process.env.NEXORA_DB ?? defaultDbPath();
const SQL = await initSqlJs();

/** Open a fresh, private, in-memory copy of the database for every request (always current, never written). */
function openDb() {
  if (!fs.existsSync(DB_PATH)) throw new Error(`Nexora database not found at ${DB_PATH}. Open the Nexora POS desktop app once, or pass the path as an argument.`);
  const db = new SQL.Database(fs.readFileSync(DB_PATH));
  db.run("UPDATE staff SET pin = '****'");
  return db;
}

function query(sql, params = []) {
  const db = openDb();
  try {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
  } finally {
    db.close();
  }
}

const rand = (cents) => Math.round(Number(cents ?? 0)) / 100;
const json = (data) => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] });
const dateRange = {
  from: z.string().optional().describe('Start date YYYY-MM-DD (inclusive). Default: today'),
  to: z.string().optional().describe('End date YYYY-MM-DD (inclusive). Default: same as from'),
};
function range({ from, to }) {
  const f = from ?? new Date().toISOString().slice(0, 10);
  return [f, `${to ?? f}T23:59:59.999Z`];
}

const server = new McpServer({ name: 'nexora-pos', version: '0.1.0' });

server.registerTool(
  'sales_summary',
  {
    description: 'Takings, number of sales, refunds, VAT and payment-method split for a date range (amounts in Rand, VAT inclusive).',
    inputSchema: dateRange,
  },
  async (args) => {
    const [f, t] = range(args);
    const [tot] = query(
      `SELECT COUNT(CASE WHEN refund_of IS NULL THEN 1 END) AS sales, SUM(total_cents) AS takings,
              SUM(CASE WHEN refund_of IS NOT NULL THEN -total_cents ELSE 0 END) AS refunds, SUM(vat_cents) AS vat
       FROM sales WHERE created_at BETWEEN ? AND ?`, [f, t]);
    const methods = query(
      `SELECT p.method, SUM(p.amount_cents) AS amount FROM payments p JOIN sales s ON s.id = p.sale_id
       WHERE s.created_at BETWEEN ? AND ? GROUP BY p.method`, [f, t]);
    // Change is always handed back in cash.
    const [{ change }] = query('SELECT COALESCE(SUM(change_cents), 0) AS change FROM sales WHERE created_at BETWEEN ? AND ?', [f, t]);
    for (const m of methods) if (m.method === 'cash') m.amount -= change;
    const days = query(
      `SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS transactions, SUM(total_cents) AS takings
       FROM sales WHERE created_at BETWEEN ? AND ? GROUP BY day ORDER BY day`, [f, t]);
    return json({
      from: f, to: t.slice(0, 10), sales: tot.sales ?? 0, takings: rand(tot.takings), refunds: rand(tot.refunds), vat: rand(tot.vat),
      averageSale: tot.sales ? rand((tot.takings ?? 0) / tot.sales) : 0,
      byPaymentMethod: Object.fromEntries(methods.map((m) => [m.method, rand(m.amount)])),
      byDay: days.map((d) => ({ ...d, takings: rand(d.takings) })),
    });
  },
);

server.registerTool(
  'top_products',
  {
    description: 'Best-selling products by revenue for a date range, with quantity sold and estimated gross profit.',
    inputSchema: { ...dateRange, limit: z.number().int().min(1).max(100).optional().describe('How many (default 10)') },
  },
  async (args) => {
    const [f, t] = range(args);
    const rows = query(
      `SELECT l.name, SUM(l.qty) AS qty,
              SUM(ROUND(l.unit_price_cents * l.qty * (1 - l.discount_pct / 100.0))) AS revenue,
              SUM(l.qty * COALESCE(p.cost_cents, 0)) AS cost, MAX(l.vat_exempt) AS vat_exempt
       FROM sale_lines l JOIN sales s ON s.id = l.sale_id LEFT JOIN products p ON p.id = l.product_id
       WHERE s.created_at BETWEEN ? AND ? GROUP BY l.product_id ORDER BY revenue DESC LIMIT ?`, [f, t, args.limit ?? 10]);
    const [{ value: settingsJson } = {}] = query("SELECT value FROM meta WHERE key = 'settings'");
    const vatRate = settingsJson ? JSON.parse(settingsJson).vatRate : 15;
    return json(rows.map((r) => {
      const exVat = r.vat_exempt ? r.revenue : r.revenue / (1 + vatRate / 100);
      return { product: r.name, qtySold: r.qty, revenue: rand(r.revenue), grossProfitExVat: rand(exVat - r.cost) };
    }));
  },
);

server.registerTool(
  'search_products',
  {
    description: 'Find products by name, SKU, barcode or category. Returns price (Rand, VAT incl.), cost, stock on hand and reorder level.',
    inputSchema: { query: z.string().describe('Text to search for') },
  },
  async ({ query: q }) => {
    const like = `%${q}%`;
    const rows = query(
      `SELECT name, sku, barcode, category, price_cents, cost_cents, stock, reorder_level, active FROM products
       WHERE name LIKE ? OR sku LIKE ? OR barcode LIKE ? OR category LIKE ? ORDER BY name LIMIT 50`, [like, like, like, like]);
    return json(rows.map((r) => ({ ...r, price: rand(r.price_cents), cost: rand(r.cost_cents), price_cents: undefined, cost_cents: undefined, active: !!r.active })));
  },
);

server.registerTool(
  'low_stock',
  { description: 'Active products at or below their reorder level, with a suggested order quantity.', inputSchema: {} },
  async () => {
    const rows = query('SELECT name, sku, stock, reorder_level FROM products WHERE active = 1 AND stock <= reorder_level ORDER BY stock');
    return json(rows.map((r) => ({ ...r, suggestedOrder: Math.max(r.reorder_level * 2 - r.stock, 1) })));
  },
);

server.registerTool(
  'customer_lookup',
  {
    description: 'Find customers by name or phone; shows loyalty points, account balance owed, credit limit and lifetime spend. Use query "" with owing=true to list everyone who owes money.',
    inputSchema: { query: z.string().describe('Name or phone (can be empty)'), owing: z.boolean().optional().describe('Only customers with a balance owing') },
  },
  async ({ query: q, owing }) => {
    const like = `%${q}%`;
    const rows = query(
      `SELECT c.name, c.phone, c.email, c.loyalty_points, c.account_balance_cents, c.account_limit_cents,
              (SELECT COALESCE(SUM(total_cents), 0) FROM sales s WHERE s.customer_id = c.id) AS spend
       FROM customers c WHERE (c.name LIKE ? OR c.phone LIKE ?) ${owing ? 'AND c.account_balance_cents > 0' : ''} ORDER BY c.name LIMIT 50`, [like, like]);
    return json(rows.map((r) => ({
      name: r.name, phone: r.phone, email: r.email, loyaltyPoints: r.loyalty_points,
      owes: rand(r.account_balance_cents), creditLimit: rand(r.account_limit_cents), lifetimeSpend: rand(r.spend),
    })));
  },
);

server.registerTool(
  'petty_cash_summary',
  {
    description: 'Petty cash box balance, plus spending by category and the entries for a month.',
    inputSchema: { month: z.string().optional().describe('YYYY-MM, default current month') },
  },
  async ({ month }) => {
    const m = month ?? new Date().toISOString().slice(0, 7);
    const [{ bal }] = query("SELECT COALESCE(SUM(CASE WHEN type = 'top_up' THEN amount_cents ELSE -amount_cents END), 0) AS bal FROM petty_cash");
    const cats = query("SELECT category, SUM(amount_cents) AS spent FROM petty_cash WHERE type = 'expense' AND substr(at, 1, 7) = ? GROUP BY category ORDER BY spent DESC", [m]);
    const entries = query('SELECT at, type, category, description, reference, amount_cents FROM petty_cash WHERE substr(at, 1, 7) = ? ORDER BY at', [m]);
    return json({
      balance: rand(bal), month: m,
      byCategory: cats.map((c) => ({ category: c.category, spent: rand(c.spent) })),
      entries: entries.map((e) => ({ ...e, amount: rand(e.amount_cents), amount_cents: undefined })),
    });
  },
);

server.registerTool(
  'till_shifts',
  { description: 'Recent till shifts with opening float, expected vs counted cash and over/short.', inputSchema: { limit: z.number().int().min(1).max(100).optional() } },
  async ({ limit }) => {
    const rows = query('SELECT opened_at, closed_at, opening_float_cents, expected_cash_cents, counted_cash_cents FROM shifts ORDER BY opened_at DESC LIMIT ?', [limit ?? 10]);
    return json(rows.map((r) => ({
      openedAt: r.opened_at, closedAt: r.closed_at, float: rand(r.opening_float_cents),
      expected: r.expected_cash_cents == null ? null : rand(r.expected_cash_cents),
      counted: r.counted_cash_cents == null ? null : rand(r.counted_cash_cents),
      overShort: r.closed_at ? rand((r.counted_cash_cents ?? 0) - (r.expected_cash_cents ?? 0)) : null,
    })));
  },
);

server.registerTool(
  'run_sql',
  {
    description:
      'Run a read-only SQL SELECT against the Nexora SQLite database for questions the other tools do not cover. ' +
      'Tables: products, product_packs (box barcodes), customers, sales, sale_lines, payments, shifts, cash_movements, till_entries, petty_cash, ' +
      'laybys, layby_payments, vouchers, voucher_redemptions, parked_sales, staff, audit_log, meta. ' +
      'Money columns end in _cents (divide by 100 for Rand). Dates are ISO-8601 text in UTC.',
    inputSchema: { sql: z.string().describe('A single SELECT (or WITH ... SELECT) statement') },
  },
  async ({ sql }) => {
    const s = sql.trim().replace(/;\s*$/, '');
    if (!/^(select|with)\b/i.test(s) || s.includes(';')) throw new Error('Only a single SELECT statement is allowed');
    const rows = query(s);
    return json({ rowCount: rows.length, rows: rows.slice(0, 500), truncated: rows.length > 500 });
  },
);

await server.connect(new StdioServerTransport());
console.error(`Nexora POS MCP connector ready (database: ${DB_PATH})`);
