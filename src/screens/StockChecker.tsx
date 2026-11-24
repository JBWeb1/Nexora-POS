import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import type { Product } from '../types';
import { formatMoney } from '../lib/money';
import { can, receiveStock } from '../lib/actions';
import { Icon } from '../components/Icon';
import { useToast } from '../components/ui';
import { useBarcodeScanner } from '../lib/devices';

/** Scan anything to instantly see price, stock and how fast it sells. Usable by every role. */
export function StockChecker() {
  const { state, update, user } = useStore();
  const toast = useToast();
  const m = (c: number) => formatMoney(c, state.settings.currency);
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<Product | null>(null);
  const [count, setCount] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.focus(), []);

  const products = state.products.filter((p) => p.active);
  const term = q.trim().toLowerCase();
  const matches = term
    ? products.filter((p) => p.barcode === term || p.sku.toLowerCase() === term || p.name.toLowerCase().includes(term)).slice(0, 8)
    : [];
  const product = picked ? state.products.find((p) => p.id === picked.id) ?? null : null;

  const stats = useMemo(() => {
    if (!product) return null;
    const since = Date.now() - 30 * 864e5;
    let sold30 = 0;
    let lastSold: string | null = null;
    for (const s of state.sales) {
      for (const l of s.lines) {
        if (l.productId !== product.id) continue;
        if (new Date(s.createdAt).getTime() >= since) sold30 += l.qty;
        if (l.qty > 0 && (!lastSold || s.createdAt > lastSold)) lastSold = s.createdAt;
      }
    }
    const perDay = sold30 / 30;
    const daysLeft = perDay > 0 ? Math.floor(Math.max(0, product.stock) / perDay) : null;
    return { sold30, lastSold, daysLeft };
  }, [product, state.sales]);

  useBarcodeScanner(
    (code) => {
      const hit = products.find((p) => p.barcode === code || p.sku.toLowerCase() === code.toLowerCase());
      if (hit) choose(hit);
      else toast(`No product with barcode ${code}`, 'error');
    },
    { suffix: state.settings.scannerSuffix ?? 'Enter' },
  );

  const choose = (p: Product) => {
    setPicked(p);
    setQ('');
    setCount('');
    inputRef.current?.focus();
  };

  const onEnter = () => {
    const exact = products.find((p) => p.barcode === q.trim() || p.sku.toLowerCase() === term);
    const hit = exact ?? (matches.length === 1 ? matches[0] : undefined);
    if (hit) choose(hit);
    else if (!matches.length) toast(`Nothing found for "${q}"`, 'error');
  };

  const saveCount = () => {
    if (!product) return;
    const n = parseInt(count, 10);
    if (isNaN(n) || n < 0) return toast('Enter the number on the shelf', 'error');
    update((s) => receiveStock(s, user!.id, product.id, n - product.stock, '(stock checker count)'));
    toast(n === product.stock ? 'Count matches ✓' : `Stock corrected ${product.stock} → ${n}`);
    setCount('');
    inputRef.current?.focus();
  };

  const status = !product
    ? null
    : product.stock <= 0
      ? { label: 'Out of stock', cls: 'bad' }
      : product.stock <= product.reorderLevel
        ? { label: 'Low — reorder', cls: 'over' }
        : { label: 'In stock', cls: 'ok' };

  return (
    <div className="page checker">
      <h1>Stock Checker</h1>
      <div className="search-row">
        <Icon name="search" size={20} className="search-icon" />
        <input
          ref={inputRef}
          className="search"
          placeholder="Scan a barcode or type a product name"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onEnter()}
          aria-label="Find product"
        />
      </div>
      {matches.length > 0 && (
        <div className="list" style={{ marginTop: 8 }}>
          {matches.map((p) => (
            <button key={p.id} className="list-item" onClick={() => choose(p)}>
              <span>
                <b>{p.name}</b>
                <div className="muted small">{p.barcode} · {p.category}</div>
              </span>
              <span className="muted">{p.stock} in stock</span>
            </button>
          ))}
        </div>
      )}

      {product && stats && status && (
        <div className="checker-card">
          <div className="checker-top">
            <div>
              <div className="muted small">{product.category} · {product.sku}</div>
              <div className="checker-name">{product.name}</div>
              <div className="checker-price">{m(product.price)}</div>
            </div>
            <div className={`variance ${status.cls}`}>{status.label}</div>
          </div>
          <div className="stats">
            <div className="stat"><div className="muted small">On hand</div><b>{product.stock}</b></div>
            <div className="stat"><div className="muted small">Reorder at</div><b>{product.reorderLevel}</b></div>
            <div className="stat"><div className="muted small">Sold (30 days)</div><b>{stats.sold30}</b></div>
            <div className="stat">
              <div className="muted small">Lasts about</div>
              <b>{stats.daysLeft === null ? '—' : `${stats.daysLeft} days`}</b>
            </div>
          </div>
          <div className="muted small">
            Barcode {product.barcode || '—'} · Last sold {stats.lastSold ? new Date(stats.lastSold).toLocaleString('en-ZA') : 'never'}
            {product.vatExempt && ' · Zero-rated'}
          </div>
          {can(user, 'supervisor') && (
            <div className="pay-input">
              <input
                inputMode="numeric"
                placeholder="Counted on shelf"
                value={count}
                onChange={(e) => setCount(e.target.value.replace(/\D/g, ''))}
                onKeyDown={(e) => e.key === 'Enter' && saveCount()}
                aria-label="Shelf count"
              />
              <button className="btn primary" onClick={saveCount}>Save count</button>
            </div>
          )}
        </div>
      )}

      {!product && !matches.length && (
        <div className="cart-empty">
          <Icon name="search" size={44} />
          <div>Scan any item to check its price and stock</div>
        </div>
      )}
    </div>
  );
}
