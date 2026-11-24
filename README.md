# Nexora POS

A fast, simple point of sale for South African retail: easier to learn than traditional back-office-heavy systems, and built around how a shop actually works during the day.

- **iPhone-style interface**: clean type, big touch targets, passcode lock screen, home screen of app icons.
- **Desktop app for Windows / Mac / Linux** with a real **SQLite database** on the PC and automatic daily backups.
- **Works offline**. No internet is needed to sell.

## What's inside

| Area | What it does |
| --- | --- |
| **Home** | Today's takings, till status, low stock and petty cash at a glance. **Arrange Icons** (drag, or sort A–Z), saved per staff member. |
| **Sell** | One-screen checkout. Scan or tap (box barcodes sell the whole box), quick-cash buttons with the change worked out for you, split payments (cash / card / EFT / account / gift voucher), park & recall sales, **easy item removal** (press F3 / Remove then scan or tap the item, swipe a line left, or tap the bin; every removal is audit-logged), line and whole-sale discounts, customers and loyalty points, 80mm receipts. |
| **Sales** | Find any receipt, reprint, and do partial or full refunds that put the stock back. |
| **Stock Checker** | Scan any item: price, stock on hand, sold in the last 30 days, how many days of stock are left. Supervisors can correct the count on the spot. |
| **Lay-bys** | Start one from Sell (scan items → Pay → *Put on lay-by instead*), pick or add the customer, take a deposit (minimum 10%). Items are reserved straight away. Take instalments in cash/card/EFT. When it's fully paid it becomes a normal tax-invoice sale. Cancelling returns the stock and refunds the payments minus a 10% fee. Overdue tracking and printable slips. |
| **Vouchers** | Sell gift vouchers to anyone (pick or add a person). Each gets a code like `NX-ABCD-EFGH` and is valid for 3 years (CPA). Customers pay with *Voucher* at the till and can spend it in parts; the balance is tracked. |
| **Receive Stock** | Scan deliveries. **Scanning a box barcode adds the whole box** (e.g. 24) automatically. A barcode the system doesn't know is linked once ("box of 12 Coke"), then works by itself from then on. *Auto add* puts every scan straight into stock (with Undo), or use *Review first*. Also takes a supplier CSV upload (`barcode,qty,cost`), with box barcodes multiplied out. |
| **Petty Cash** | A separate cash box for small expenses (cleaning, stationery, refreshments…) with top-ups, slip numbers, supervisor approval, spend by category and CSV export. Keeps till cash-ups clean. |
| **Till** | Open with a float, record cash paid out or added, a guided count by note and coin (R200 … 10c), over/short calculated, and a Z-report. |
| **Back Office** | Dashboard (takings, profit, top sellers, staff sales), Products & stock (receive deliveries, stock counts, reorder list), Customers (accounts, credit limits, payments), Devices, Settings (staff & PINs, VAT, receipts, backups, audit log). |
| **Tile / Cascade** | Show two screens side by side (e.g. Sell + Stock Checker) or one full screen. |

**Built-in controls:** three roles (cashier, supervisor, manager). Voids, refunds, price changes, large discounts, payouts and petty-cash spends need a supervisor PIN, and everything goes into the audit log. The till auto-locks after 10 minutes idle.

**Keyboard:** `F2` search · `F3` remove item (then scan) · `F4` customer · `F6` discount · `F8` park · `F9` recall · `F12` pay · `+`/`-` quantity · type `3*` then scan to add 3.

Demo PINs: Manager **1234**, Supervisor **2222**, Cashier **1111**. Change them in Back Office → Settings.

## Install on your PC

You need [Node.js 20+](https://nodejs.org) to build the installer once.

```bash
npm install
```

```bash
npm run dist
```

This creates `release/Nexora POS Setup 0.1.0.exe`. Run it to install Nexora POS with a desktop shortcut. Use `npm run dist:mac` or `npm run dist:linux` on those systems.

To try it without installing:

```bash
npm run app
```

**Browser / PWA option:** host the `dist` folder (or run `npm run dev`), open it in Chrome or Edge and click **Install** in the sidebar. In browser mode data is stored in that browser only. Use the desktop app for the SQLite database.

## Your data (SQLite)

The desktop app keeps everything in `nexora.db`:

- Windows: `%APPDATA%\Nexora POS\nexora.db`
- macOS: `~/Library/Application Support/Nexora POS/nexora.db`
- Linux: `~/.config/Nexora POS/nexora.db`

A copy is made into `backups/` every day and kept for 30 days. You can open the file in any SQLite tool (e.g. *DB Browser for SQLite*). The tables are `products`, `customers`, `sales`, `sale_lines`, `payments`, `shifts`, `cash_movements`, `petty_cash`, `parked_sales`, `staff`, `audit_log`, `meta`. Money columns are in cents. Back Office → Settings also has a JSON backup/restore.

## Devices

- **Barcode scanners: Mindeo**, Honeywell, Zebra, Datalogic and any USB/Bluetooth scanner in *keyboard (HID)* mode, which is the factory default. Plug in and scan. Test it in Back Office → Devices. If a Mindeo scanner shows nothing, scan the "USB HID Keyboard" and "Add Enter suffix" codes in its quick-start guide.
- **Card machines: Verifone**, Yoco, Ingenico, PAX or bank speedpoints work in **standalone** mode. The cashier keys the amount on the terminal and taps *Approved* or *Declined* in Nexora, and can record the auth code on the receipt. A declined card is never recorded as paid.
  - *Verifone integrated* (the amount goes straight to the terminal) has its settings screen and driver slot ready in `src/lib/devices.ts`. It needs Verifone semi-integration API access from your Verifone reseller or bank before it can be switched on. A **test simulator** is included for training.
- **Receipt printers / cash drawers**: any 80mm or 58mm printer installed in Windows. Turn on "open cash drawer" in the printer driver.

## AI assistant connector (MCP)

Nexora includes a **read-only** [Model Context Protocol](https://modelcontextprotocol.io) server, so Claude (or any MCP client) can answer questions such as *"How much did we sell this week?"*, *"What must I reorder?"* or *"Who owes us money?"*.

Tools: `sales_summary`, `top_products`, `search_products`, `low_stock`, `customer_lookup`, `petty_cash_summary`, `till_shifts`, `run_sql` (SELECT only).

It works on an in-memory copy of the database, so it **cannot change anything**, and staff PINs are hidden from it.

The easiest setup is Back Office → Devices → **Copy config**, pasted into Claude Desktop → Settings → Developer → Edit Config. Or run it from the repo:

```json
{
  "mcpServers": {
    "nexora-pos": { "command": "node", "args": ["C:\\path\\to\\Nexora-POS\\mcp\\server.mjs"] }
  }
}
```

## Development

```bash
npm run dev
```

```bash
npm test
```

```bash
npm run build
```

Stack: React 18 + TypeScript + Vite, Electron, sql.js (SQLite in WebAssembly, so no native build steps). Business rules live in `src/lib/actions.ts` (pure functions with unit tests). The SQLite layer is in `electron/db.cjs`.

## Roadmap: ideas from other POS systems

| Idea | Seen in |
| --- | --- |
| Purchase orders & supplier management, auto reorder from the low-stock list | Lightspeed, IQ |
| Product variants (size / colour) and modifiers (extra shot, no sugar) | Lightspeed, Square, Toast |
| Promotions: buy 2 get 1, combo deals, happy hour pricing | Shopify POS, Square |
| Multi-till / multi-branch with cloud sync and stock transfers | Shopify POS, Lightspeed |
| Customer-facing display & WhatsApp / email receipts | Loyverse, Square |
| Integrated card payments (Verifone, Yoco, Adumo) | Yoco, Square |
| Accounting export to Sage / Xero / QuickBooks | IQ, Lightspeed |
| Weighing-scale integration and shelf-label printing | IQ, Loyverse |
| Staff clock-in / timesheets | Square |
