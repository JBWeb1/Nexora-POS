import { useRef, useState } from 'react';
import { useStore } from '../store';
import type { Product } from '../types';
import { findByCode, linkBarcode, postDelivery, receiveStock } from '../lib/actions';
import { useBarcodeScanner } from '../lib/devices';
import { formatMoney, parseMoney } from '../lib/money';
import { uid } from '../lib/id';
import { Field, Modal, useToast } from '../components/ui';
import { Icon } from '../components/Icon';

interface Line {
  key: string;
  productId: string;
  qty: number;
  /** Cost excl. VAT per unit (cents), from a CSV upload */
  cost?: number;
  posted: boolean;
}

/**
 * Receive deliveries by scanning. Scanning a BOX barcode adds the whole box (e.g. 24) automatically.
 * Unknown barcodes are linked to a product once and remembered for next time.
 */
export function ReceiveStock() {
  const { state, update, user } = useStore();
  const toast = useToast();
  const [lines, setLines] = useState<Line[]>([]);
  const [auto, setAuto] = useState(true);
  const [supplier, setSupplier] = useState('');
  const [invoice, setInvoice] = useState('');
  const [unknown, setUnknown] = useState<string[]>([]);
  const [last, setLast] = useState<{ name: string; qty: number; box: boolean } | null>(null);
  const [search, setSearch] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const product = (id: string) => state.products.find((p) => p.id === id);

  const add = (p: Product, qty: number, box: boolean, cost?: number) => {
    setLast({ name: p.name, qty, box });
    if (auto) {
      // Straight into stock, one line per scan so it can be undone.
      update((s) => receiveStock(s, user!.id, p.id, qty, `scan${supplier ? ` from ${supplier}` : ''}${invoice ? ` inv ${invoice}` : ''}`));
      setLines((ls) => [{ key: uid(), productId: p.id, qty, cost, posted: true }, ...ls]);
    } else {
      setLines((ls) => {
        const i = ls.findIndex((l) => !l.posted && l.productId === p.id);
        if (i < 0) return [{ key: uid(), productId: p.id, qty, cost, posted: false }, ...ls];
        const next = [...ls];
        next[i] = { ...next[i], qty: next[i].qty + qty, cost: cost ?? next[i].cost };
        return next;
      });
    }
  };

  const handle = (code: string) => {
    const found = findByCode(state.products, code);
    if (!found) {
      setUnknown((u) => (u.includes(code) ? u : [...u, code]));
      return;
    }
    add(found.product, found.qty, found.isPack);
  };

  useBarcodeScanner(handle, { enabled: unknown.length === 0, suffix: state.settings.scannerSuffix ?? 'Enter' });

  const onSearchEnter = () => {
    const term = search.trim();
    if (!term) return;
    const exact = findByCode(state.products, term);
    if (exact) {
      add(exact.product, exact.qty, exact.isPack);
    } else {
      const matches = state.products.filter((p) => p.active && p.name.toLowerCase().includes(term.toLowerCase()));
      if (matches.length === 1) add(matches[0], 1, false);
      else if (/^\d{6,}$/.test(term)) setUnknown((u) => [...u, term]);
      else return toast(matches.length ? `${matches.length} matches — be more specific` : 'Nothing found', 'error');
    }
    setSearch('');
  };

  /** CSV: barcode,qty[,cost] — box barcodes are multiplied out automatically. */
  const uploadCsv = async (file: File) => {
    const text = await file.text();
    let added = 0;
    const missing: string[] = [];
    for (const raw of text.split(/\r?\n/)) {
      const cols = raw.split(/[,;\t]/).map((c) => c.replace(/^"|"$/g, '').trim());
      if (!cols[0] || /barcode|code|sku/i.test(cols[0])) continue;
      const qty = parseInt(cols[1] || '1', 10);
      if (isNaN(qty)) continue;
      const found = findByCode(state.products, cols[0]);
      if (!found) {
        missing.push(cols[0]);
        continue;
      }
      const cost = cols[2] ? parseMoney(cols[2]) : undefined;
      // A cost given for a box is spread over the units in it.
      add(found.product, qty * found.qty, found.isPack, cost !== undefined && !isNaN(cost) ? Math.round(cost / found.qty) : undefined);
      added++;
    }
    if (missing.length) setUnknown((u) => [...new Set([...u, ...missing])]);
    toast(`${added} lines loaded${missing.length ? `, ${missing.length} barcodes need linking` : ''}`, missing.length ? 'info' : 'ok');
  };

  const pending = lines.filter((l) => !l.posted);
  const postAll = () => {
    try {
      update((s) =>
        postDelivery(s, user!.id, pending.map((l) => ({ productId: l.productId, qty: l.qty, cost: l.cost })), supplier, invoice),
      );
      setLines((ls) => ls.map((l) => ({ ...l, posted: true })));
      toast(`${pending.reduce((a, l) => a + l.qty, 0)} units added to stock`);
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  const undo = (l: Line) => {
    if (l.posted) update((s) => receiveStock(s, user!.id, l.productId, -l.qty, '(undo receive)'));
    setLines((ls) => ls.filter((x) => x.key !== l.key));
  };

  const totalUnits = lines.reduce((a, l) => a + l.qty, 0);

  return (
    <div className="page">
      <div className="page-head">
        <h1>Receive Stock</h1>
        <div className="row">
          <button className="btn" onClick={() => fileRef.current?.click()}>Upload CSV</button>
          <input ref={fileRef} type="file" accept=".csv,text/csv,text/plain" hidden onChange={(e) => (e.target.files?.[0] && uploadCsv(e.target.files[0]), (e.target.value = ''))} />
          <div className="segmented" title="Auto: every scan goes into stock immediately. Review: check the list, then post it.">
            <button className={auto ? 'on' : ''} onClick={() => setAuto(true)}>Auto add</button>
            <button className={!auto ? 'on' : ''} onClick={() => setAuto(false)}>Review first</button>
          </div>
        </div>
      </div>

      <div className="form-grid">
        <Field label="Supplier (optional)"><input value={supplier} onChange={(e) => setSupplier(e.target.value)} /></Field>
        <Field label="Invoice / delivery note no. (optional)"><input value={invoice} onChange={(e) => setInvoice(e.target.value)} /></Field>
      </div>

      <div className={`scan-zone ${last ? 'hit' : ''}`} key={lines.length}>
        {last ? (
          <>
            <div className="scan-plus">+{last.qty}</div>
            <div className="checker-name">{last.name}</div>
            <div className="muted">{last.box ? `Box of ${last.qty} scanned` : 'Single item scanned'} · {auto ? 'added to stock' : 'added to list'}</div>
          </>
        ) : (
          <>
            <Icon name="truck" size={44} />
            <div className="checker-name">Scan box or item barcodes</div>
            <div className="muted">Box barcodes add the whole box. New barcodes are learnt the first time.</div>
          </>
        )}
      </div>
      <div className="search-row" style={{ margin: '12px 0' }}>
        <Icon name="search" size={20} className="search-icon" />
        <input
          className="search"
          placeholder="No scanner? Type a barcode or product name and press Enter"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onSearchEnter()}
        />
      </div>

      {lines.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Product</th><th className="num">Qty</th><th className="num">Stock now</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {lines.map((l) => {
                const p = product(l.productId);
                return (
                  <tr key={l.key}>
                    <td>{p?.name}<div className="muted small">{p?.barcode}{l.cost !== undefined && ` · cost ${formatMoney(l.cost)}`}</div></td>
                    <td className="num">
                      {l.posted ? (
                        <b>+{l.qty}</b>
                      ) : (
                        <input className="qty-input" inputMode="numeric" value={l.qty}
                          onChange={(e) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, qty: parseInt(e.target.value || '0', 10) || 0 } : x)))} />
                      )}
                    </td>
                    <td className="num">{p?.stock}</td>
                    <td>{l.posted ? <span className="tag">In stock</span> : <span className="tag warn">Not posted</span>}</td>
                    <td className="actions"><button className="btn small-btn" onClick={() => undo(l)}>{l.posted ? 'Undo' : 'Remove'}</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="row-between">
        <span className="muted">{lines.length} lines · {totalUnits} units this delivery</span>
        {pending.length > 0 && <button className="btn primary" onClick={postAll}>Add {pending.reduce((a, l) => a + l.qty, 0)} units to stock</button>}
      </div>
      <p className="muted small">CSV format: <code>barcode,qty,cost</code> per line (cost optional, excl. VAT). Box barcodes in the file are multiplied out automatically.</p>

      {unknown.length > 0 && (
        <LinkBarcode
          code={unknown[0]}
          remaining={unknown.length - 1}
          onSkip={() => setUnknown((u) => u.slice(1))}
          onLinked={(p, qty) => {
            setUnknown((u) => u.slice(1));
            add(p, qty, qty > 1);
          }}
        />
      )}
    </div>
  );
}

/** First time a barcode is seen: say what it is, once. */
function LinkBarcode({ code, remaining, onSkip, onLinked }: { code: string; remaining: number; onSkip: () => void; onLinked: (p: Product, qty: number) => void }) {
  const { state, update, user } = useStore();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [pick, setPick] = useState<Product | null>(null);
  const [kind, setKind] = useState<'single' | 'box'>(code.length >= 14 ? 'box' : 'single');
  const [boxQty, setBoxQty] = useState('12');
  const [creating, setCreating] = useState(false);
  const [np, setNp] = useState({ name: '', category: '', price: '', cost: '' });
  const matches = state.products.filter((p) => p.active && `${p.name} ${p.sku} ${p.category}`.toLowerCase().includes(q.toLowerCase())).slice(0, 6);
  const qty = kind === 'single' ? 1 : parseInt(boxQty, 10);
  const categories = Array.from(new Set(state.products.map((x) => x.category))).sort();

  const link = () => {
    try {
      let target = pick;
      if (creating) {
        const price = parseMoney(np.price);
        const cost = parseMoney(np.cost || '0');
        if (!np.name.trim() || !np.category.trim() || isNaN(price)) throw new Error('Name, category and selling price are needed');
        const created: Product = {
          id: uid(), sku: `SKU-${state.products.length + 1}`, barcode: '', name: np.name.trim(), category: np.category.trim(),
          price, cost: isNaN(cost) ? 0 : cost, stock: 0, reorderLevel: 5, vatExempt: false, favourite: false, active: true,
        };
        update((s) => {
          s.products.push(created);
          linkBarcode(s, user!.id, created.id, code, qty);
        });
        target = created;
      } else {
        if (!target) throw new Error('Choose the product this barcode belongs to');
        update((s) => linkBarcode(s, user!.id, target!.id, code, qty));
      }
      toast(`Barcode learnt: ${kind === 'box' ? `box of ${qty}` : 'single'} ${target!.name}`);
      onLinked(target!, qty);
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  return (
    <Modal title="New barcode" onClose={onSkip}>
      <div className="scan-test">
        <div className="checker-price">{code}</div>
        <div className="muted small">Tell Nexora what this is, once. Next time it's added automatically.{remaining > 0 && ` (${remaining} more to do)`}</div>
      </div>
      <div className="segmented full">
        <button className={kind === 'single' ? 'on' : ''} onClick={() => setKind('single')}>Single item</button>
        <button className={kind === 'box' ? 'on' : ''} onClick={() => setKind('box')}>Box / case</button>
      </div>
      {kind === 'box' && (
        <Field label="How many items in the box?">
          <input inputMode="numeric" value={boxQty} onChange={(e) => setBoxQty(e.target.value.replace(/\D/g, ''))} />
        </Field>
      )}
      {!creating ? (
        <>
          <input autoFocus className="search" placeholder="Which product is it?" value={q} onChange={(e) => (setQ(e.target.value), setPick(null))} />
          <div className="list">
            {matches.map((p) => (
              <button key={p.id} className={`list-item ${pick?.id === p.id ? 'picked' : ''}`} onClick={() => setPick(p)}>
                <span><b>{p.name}</b><div className="muted small">{p.category} · {p.barcode || 'no barcode yet'}</div></span>
                {pick?.id === p.id && <span className="ok-text">✓</span>}
              </button>
            ))}
          </div>
          <button className="btn" onClick={() => setCreating(true)}>+ It's a new product</button>
        </>
      ) : (
        <div className="form-grid">
          <Field label="Product name"><input autoFocus value={np.name} onChange={(e) => setNp({ ...np, name: e.target.value })} /></Field>
          <Field label="Category">
            <input list="rcv-cats" value={np.category} onChange={(e) => setNp({ ...np, category: e.target.value })} />
            <datalist id="rcv-cats">{categories.map((c) => <option key={c} value={c} />)}</datalist>
          </Field>
          <Field label="Selling price each, incl. VAT (R)"><input inputMode="decimal" value={np.price} onChange={(e) => setNp({ ...np, price: e.target.value })} /></Field>
          <Field label="Cost each, excl. VAT (R)"><input inputMode="decimal" value={np.cost} onChange={(e) => setNp({ ...np, cost: e.target.value })} /></Field>
        </div>
      )}
      <div className="row-between">
        <button className="btn" onClick={onSkip}>Skip</button>
        <button className="btn primary" onClick={link} disabled={kind === 'box' && !(qty >= 2)}>
          Save & add {kind === 'box' && qty >= 2 ? `${qty} to stock` : 'to stock'}
        </button>
      </div>
    </Modal>
  );
}
