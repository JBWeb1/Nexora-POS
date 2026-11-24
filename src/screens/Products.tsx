import { useState } from 'react';
import { useStore } from '../store';
import type { Product } from '../types';
import { formatMoney, parseMoney } from '../lib/money';
import { can, receiveStock } from '../lib/actions';
import { uid } from '../lib/id';
import { Field, Modal, downloadCsv, useToast } from '../components/ui';

type Filter = 'all' | 'low' | 'inactive';

export function Products() {
  const { state, user } = useStore();
  const m = (c: number) => formatMoney(c, state.settings.currency);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [editing, setEditing] = useState<Product | null>(null);
  const [receiving, setReceiving] = useState<Product | null>(null);
  const canEdit = can(user, 'supervisor');

  const low = state.products.filter((p) => p.active && p.stock <= p.reorderLevel);
  const list = state.products
    .filter((p) => (filter === 'low' ? p.active && p.stock <= p.reorderLevel : filter === 'inactive' ? !p.active : p.active))
    .filter((p) => `${p.name} ${p.sku} ${p.barcode} ${p.category}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));

  const stockValue = state.products.filter((p) => p.active).reduce((a, p) => a + Math.max(0, p.stock) * p.cost, 0);

  const exportCsv = () =>
    downloadCsv('products.csv', [
      ['SKU', 'Barcode', 'Name', 'Category', 'Price', 'Cost', 'Stock', 'Reorder level', 'VAT exempt'],
      ...state.products.map((p) => [p.sku, p.barcode, p.name, p.category, p.price / 100, p.cost / 100, p.stock, p.reorderLevel, p.vatExempt ? 'Y' : 'N']),
    ]);

  const reorderCsv = () =>
    downloadCsv('reorder-list.csv', [
      ['SKU', 'Name', 'In stock', 'Reorder level', 'Suggested order qty'],
      ...low.map((p) => [p.sku, p.name, p.stock, p.reorderLevel, Math.max(p.reorderLevel * 2 - p.stock, 1)]),
    ]);

  return (
    <div className="page">
      <div className="page-head">
        <h1>Products & Stock</h1>
        <div className="row">
          <button className="btn" onClick={exportCsv}>Export CSV</button>
          {canEdit && (
            <button className="btn primary" onClick={() => setEditing(blankProduct())}>
              + New product
            </button>
          )}
        </div>
      </div>

      <div className="stats">
        <div className="stat"><div className="muted small">Active products</div><b>{state.products.filter((p) => p.active).length}</b></div>
        <div className="stat"><div className="muted small">Stock value (cost)</div><b>{m(stockValue)}</b></div>
        <button className={`stat stat-btn ${low.length ? 'warn' : ''}`} onClick={() => setFilter('low')}>
          <div className="muted small">Low stock — needs reorder</div><b>{low.length}</b>
        </button>
      </div>

      <div className="row">
        <input className="search" placeholder="Search products…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="chips">
          {(['all', 'low', 'inactive'] as Filter[]).map((f) => (
            <button key={f} className={`chip ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)}>
              {f === 'all' ? 'Active' : f === 'low' ? 'Low stock' : 'Archived'}
            </button>
          ))}
        </div>
        {filter === 'low' && low.length > 0 && <button className="btn" onClick={reorderCsv}>Download reorder list</button>}
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th><th>Category</th><th>SKU / Barcode</th><th className="num">Price</th>
              <th className="num">Margin</th><th className="num">Stock</th><th></th>
            </tr>
          </thead>
          <tbody>
            {list.map((p) => {
              const exVat = p.vatExempt ? p.price : p.price / (1 + state.settings.vatRate / 100);
              const margin = exVat > 0 ? Math.round(((exVat - p.cost) / exVat) * 100) : 0;
              return (
                <tr key={p.id}>
                  <td>{p.favourite && '★ '}{p.name}{p.vatExempt && <span className="tag">Zero-rated</span>}</td>
                  <td>{p.category}</td>
                  <td className="muted small">{p.sku}<br />{p.barcode}</td>
                  <td className="num">{m(p.price)}</td>
                  <td className={`num ${margin < 20 ? 'warn-text' : ''}`}>{margin}%</td>
                  <td className={`num ${p.stock <= p.reorderLevel ? 'warn-text' : ''}`}>{p.stock}</td>
                  <td className="actions">
                    {canEdit && <button className="btn small-btn" onClick={() => setReceiving(p)}>Receive</button>}
                    {canEdit && <button className="btn small-btn" onClick={() => setEditing(p)}>Edit</button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {list.length === 0 && <p className="muted pad">Nothing to show.</p>}
      </div>

      {editing && <ProductForm product={editing} onClose={() => setEditing(null)} />}
      {receiving && <ReceiveForm product={receiving} onClose={() => setReceiving(null)} />}
    </div>
  );
}

function blankProduct(): Product {
  return {
    id: '', sku: '', barcode: '', name: '', category: '', price: 0, cost: 0, stock: 0,
    reorderLevel: 5, vatExempt: false, favourite: false, active: true,
  };
}

function ProductForm({ product, onClose }: { product: Product; onClose: () => void }) {
  const { state, update, user } = useStore();
  const toast = useToast();
  const [p, setP] = useState(product);
  const [price, setPrice] = useState((product.price / 100).toFixed(2));
  const [cost, setCost] = useState((product.cost / 100).toFixed(2));
  const categories = Array.from(new Set(state.products.map((x) => x.category))).sort();
  const set = <K extends keyof Product>(k: K, v: Product[K]) => setP({ ...p, [k]: v });

  const save = () => {
    const pr = parseMoney(price);
    const co = parseMoney(cost);
    if (!p.name.trim() || !p.category.trim()) return toast('Name and category are required', 'error');
    if (isNaN(pr) || isNaN(co)) return toast('Enter valid prices', 'error');
    const dup = state.products.find((x) => x.id !== p.id && ((p.barcode && x.barcode === p.barcode) || (p.sku && x.sku === p.sku)));
    if (dup) return toast(`Barcode/SKU already used by ${dup.name}`, 'error');
    update((s) => {
      const next = { ...p, price: pr, cost: co, name: p.name.trim(), category: p.category.trim() };
      if (!p.id) {
        next.id = uid();
        if (!next.sku) next.sku = `SKU-${s.products.length + 1}`;
        s.products.push(next);
      } else {
        s.products = s.products.map((x) => (x.id === p.id ? next : x));
      }
      s.audit.unshift({ id: uid(), at: new Date().toISOString(), staffId: user!.id, action: p.id ? 'product_edit' : 'product_add', detail: next.name });
    });
    toast('Product saved');
    onClose();
  };

  return (
    <Modal title={p.id ? `Edit ${product.name}` : 'New product'} onClose={onClose} wide>
      <div className="form-grid">
        <Field label="Name"><input autoFocus value={p.name} onChange={(e) => set('name', e.target.value)} /></Field>
        <Field label="Category">
          <input list="cats" value={p.category} onChange={(e) => set('category', e.target.value)} />
          <datalist id="cats">{categories.map((c) => <option key={c} value={c} />)}</datalist>
        </Field>
        <Field label="Barcode"><input value={p.barcode} onChange={(e) => set('barcode', e.target.value)} placeholder="Scan into this box" /></Field>
        <Field label="SKU"><input value={p.sku} onChange={(e) => set('sku', e.target.value)} placeholder="Auto if blank" /></Field>
        <Field label="Selling price incl. VAT (R)"><input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} /></Field>
        <Field label="Cost price excl. VAT (R)"><input inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} /></Field>
        {!p.id && <Field label="Opening stock"><input inputMode="numeric" value={p.stock} onChange={(e) => set('stock', parseInt(e.target.value || '0', 10))} /></Field>}
        <Field label="Reorder when stock ≤"><input inputMode="numeric" value={p.reorderLevel} onChange={(e) => set('reorderLevel', parseInt(e.target.value || '0', 10))} /></Field>
      </div>
      <div className="checks">
        <label><input type="checkbox" checked={p.favourite} onChange={(e) => set('favourite', e.target.checked)} /> Show on Favourites quick-keys</label>
        <label><input type="checkbox" checked={p.vatExempt} onChange={(e) => set('vatExempt', e.target.checked)} /> Zero-rated / VAT exempt</label>
        <label><input type="checkbox" checked={p.active} onChange={(e) => set('active', e.target.checked)} /> Active (uncheck to archive)</label>
      </div>
      <div className="row-between">
        <span />
        <button className="btn primary" onClick={save}>Save product</button>
      </div>
    </Modal>
  );
}

function ReceiveForm({ product, onClose }: { product: Product; onClose: () => void }) {
  const { update, user } = useStore();
  const toast = useToast();
  const [qty, setQty] = useState('');
  const [note, setNote] = useState('');
  const [mode, setMode] = useState<'receive' | 'count'>('receive');
  const save = () => {
    const n = parseInt(qty, 10);
    if (isNaN(n)) return toast('Enter a number', 'error');
    const delta = mode === 'receive' ? n : n - product.stock;
    update((s) => receiveStock(s, user!.id, product.id, delta, mode === 'count' ? `(stock count) ${note}` : note));
    toast(`${product.name}: stock ${delta >= 0 ? '+' : ''}${delta}`);
    onClose();
  };
  return (
    <Modal title={`Stock: ${product.name}`} onClose={onClose}>
      <p className="muted">Currently in stock: <b>{product.stock}</b></p>
      <div className="quick-row">
        <button className={`btn ${mode === 'receive' ? 'primary' : ''}`} onClick={() => setMode('receive')}>Receive delivery</button>
        <button className={`btn ${mode === 'count' ? 'primary' : ''}`} onClick={() => setMode('count')}>Stock count</button>
      </div>
      <Field label={mode === 'receive' ? 'Quantity received' : 'Quantity counted on shelf'}>
        <input autoFocus inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} />
      </Field>
      <Field label="Note (supplier, invoice no, reason)">
        <input value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <button className="btn primary" onClick={save}>Save</button>
    </Modal>
  );
}
