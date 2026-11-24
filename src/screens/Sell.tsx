import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import type { CartLine, Customer, Payment, PaymentMethod, Product, Sale } from '../types';
import { calcTotals, formatMoney, lineTotal, paidAmount, parseMoney, quickTenders } from '../lib/money';
import { audit, completeSale, currentShift, openShift } from '../lib/actions';
import { uid } from '../lib/id';
import { Field, Modal, useApproval, useToast } from '../components/ui';
import { Receipt } from '../components/Receipt';
import { Icon } from '../components/Icon';
import { chargeCard, DEFAULT_TERMINAL, useBarcodeScanner } from '../lib/devices';

const FAV = '★ Favourites';

export function Sell() {
  const { state, update, user } = useStore();
  const toast = useToast();
  const approve = useApproval();
  const m = (c: number) => formatMoney(c, state.settings.currency);

  const [cart, setCart] = useState<CartLine[]>([]);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [cartDiscount, setCartDiscount] = useState(0);
  const [selected, setSelected] = useState<number>(-1);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState(FAV);
  const [modal, setModal] = useState<null | 'pay' | 'customer' | 'recall' | 'discount' | 'lineedit'>(null);
  const [lastSale, setLastSale] = useState<Sale | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const shift = currentShift(state);
  const totals = useMemo(() => calcTotals(cart, state.settings.vatRate, cartDiscount), [cart, state.settings.vatRate, cartDiscount]);
  const customer = state.customers.find((c) => c.id === customerId);

  const products = state.products.filter((p) => p.active);
  const categories = [FAV, ...Array.from(new Set(products.map((p) => p.category))).sort()];

  const q = query.replace(/^\d+\*/, '').trim().toLowerCase();
  const visible = q
    ? products.filter((p) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q) || p.barcode.includes(q))
    : products.filter((p) => (category === FAV ? p.favourite : p.category === category));

  const focusSearch = () => setTimeout(() => searchRef.current?.focus(), 0);
  const [removeMode, setRemoveMode] = useState(false);

  // Hardware scanner (Mindeo etc.): works even when the search box isn't focused. "3*" typed first still multiplies.
  useBarcodeScanner(
    (code) => {
      const hit = products.find((p) => p.barcode === code || p.sku.toLowerCase() === code.toLowerCase());
      if (!hit) return toast(`No product with barcode ${code}`, 'error');
      if (removeMode) return removeProduct(hit);
      const mult = searchRef.current?.value.match(/^(\d+)\*$/);
      addProduct(hit, mult ? Math.max(1, parseInt(mult[1], 10)) : 1);
    },
    { enabled: !modal && !!shift, suffix: state.settings.scannerSuffix ?? 'Enter' },
  );

  const addProduct = useCallback(
    (p: Product, qty = 1) => {
      setCart((c) => {
        const i = c.findIndex((l) => l.productId === p.id && l.discountPct === 0 && l.unitPrice === p.price);
        if (i >= 0) {
          const next = [...c];
          next[i] = { ...next[i], qty: next[i].qty + qty };
          setSelected(i);
          return next;
        }
        setSelected(c.length);
        return [...c, { productId: p.id, name: p.name, unitPrice: p.price, qty, discountPct: 0, vatExempt: p.vatExempt }];
      });
      if (p.stock - qty < 0) toast(`${p.name}: stock is now negative — check inventory`, 'info');
      setQuery('');
      focusSearch();
    },
    [toast],
  );

  /** Enter in search: "3*6001000000011" adds 3; exact barcode/SKU match adds instantly; otherwise first result. */
  const onSearchEnter = () => {
    const mult = query.match(/^(\d+)\*/);
    const qty = mult ? Math.max(1, parseInt(mult[1], 10)) : 1;
    const term = query.replace(/^\d+\*/, '').trim();
    if (!term) return;
    const exact = products.find((p) => p.barcode === term || p.sku.toLowerCase() === term.toLowerCase());
    const hit = exact ?? (visible.length === 1 ? visible[0] : undefined);
    if (hit && removeMode) removeProduct(hit);
    else if (hit) addProduct(hit, qty);
    else if (visible.length > 1) toast(`${visible.length} matches — tap one`, 'info');
    else toast(`No product for "${term}"`, 'error');
  };

  /** Remove mode: scan or tap an item to take ONE of it off the sale, then go back to adding. */
  const removeProduct = (p: Product) => {
    setRemoveMode(false);
    const i = cart.map((l) => l.productId).lastIndexOf(p.id);
    if (i < 0) {
      toast(`${p.name} isn't in this sale`, 'error');
      return focusSearch();
    }
    setQty(i, cart[i].qty - 1);
    setQuery('');
    toast(`Removed 1 × ${p.name}`);
    focusSearch();
  };

  const logRemoval = (l: CartLine, qty: number) =>
    update((s) => audit(s, user!.id, 'item_removed', `${qty} × ${l.name} (${lineTotal({ ...l, qty })})`));

  const setQty = (i: number, qty: number) => {
    if (qty <= 0) return removeLine(i);
    const line = cart[i];
    if (line && qty < line.qty) logRemoval(line, line.qty - qty);
    setCart((c) => c.map((l, j) => (j === i ? { ...l, qty } : l)));
  };
  const removeLine = (i: number) => {
    const line = cart[i];
    if (line && !(line.qty <= 0)) logRemoval(line, line.qty);
    setCart((c) => c.filter((_, j) => j !== i));
    setSelected((s) => Math.min(s, cart.length - 2));
  };

  const clearCart = async () => {
    if (!cart.length) return;
    const ok = await approve(`Void the whole sale (${m(totals.total)})`, 'supervisor');
    if (!ok) return;
    update((s) => audit(s, ok.id, 'void_sale', `${cart.length} lines, ${totals.total}`));
    resetSale();
    toast('Sale voided');
  };

  const resetSale = () => {
    setCart([]);
    setCustomerId(null);
    setCartDiscount(0);
    setSelected(-1);
    focusSearch();
  };

  const park = () => {
    if (!cart.length) return toast('Nothing to park', 'info');
    if (!user) return;
    update((s) => {
      s.parked.unshift({
        id: uid(),
        label: customer?.name ?? `Sale ${new Date().toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })}`,
        createdAt: new Date().toISOString(),
        staffId: user.id,
        customerId,
        lines: cart,
      });
    });
    resetSale();
    toast('Sale parked — press F9 to recall');
  };

  const recall = (id: string) => {
    const ps = state.parked.find((p) => p.id === id);
    if (!ps) return;
    if (cart.length) return toast('Finish or park the current sale first', 'error');
    setCart(ps.lines);
    setCustomerId(ps.customerId);
    update((s) => {
      s.parked = s.parked.filter((p) => p.id !== id);
    });
    setModal(null);
    focusSearch();
  };

  const startPay = () => {
    if (!cart.length) return toast('Cart is empty', 'info');
    setModal('pay');
  };

  // Global keyboard shortcuts for speed at the till
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (modal) return;
      const keys: Record<string, () => void> = {
        F2: focusSearch,
        F3: () => (cart.length ? setRemoveMode((r) => !r) : toast('Nothing to remove', 'info')),
        F4: () => setModal('customer'),
        F6: () => cart.length && setModal('discount'),
        F8: park,
        F9: () => setModal('recall'),
        F12: startPay,
      };
      if (keys[e.key]) {
        e.preventDefault();
        keys[e.key]();
      } else if (e.key === 'Escape' && removeMode) {
        setRemoveMode(false);
      } else if (e.key === 'Delete' && selected >= 0 && document.activeElement === searchRef.current && !query) {
        removeLine(selected);
      } else if (e.key === '+' && selected >= 0 && !query) {
        e.preventDefault();
        setQty(selected, cart[selected].qty + 1);
      } else if (e.key === '-' && selected >= 0 && !query) {
        e.preventDefault();
        setQty(selected, cart[selected].qty - 1);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });

  useEffect(() => {
    focusSearch();
  }, []);

  if (!shift) return <OpenShift />;

  return (
    <div className="sell">
      <section className="sell-left">
        {removeMode && (
          <div className="remove-banner" role="status">
            <span>
              <b>Remove item</b> — scan or tap the product to take it off the sale
            </span>
            <button className="btn small-btn" onClick={() => (setRemoveMode(false), focusSearch())}>
              Cancel (Esc)
            </button>
          </div>
        )}
        <div className="search-row">
          <Icon name="search" size={20} className="search-icon" />
          <input
            ref={searchRef}
            className={`search ${removeMode ? 'removing' : ''}`}
            placeholder={removeMode ? 'Scan the item to remove' : 'Scan or search products'}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onSearchEnter()}
            aria-label="Search products"
          />
        </div>
        {!q && (
          <div className="chips">
            {categories.map((c) => (
              <button key={c} className={`chip ${c === category ? 'active' : ''}`} onClick={() => setCategory(c)}>
                {c}
              </button>
            ))}
          </div>
        )}
        <div className={`grid ${removeMode ? 'removing' : ''}`}>
          {visible.map((p) => (
            <button key={p.id} className="tile" onClick={() => (removeMode ? removeProduct(p) : addProduct(p))}>
              <span className="tile-name">{p.name}</span>
              <span className="tile-price">{m(p.price)}</span>
              <span className={`tile-stock ${p.stock <= p.reorderLevel ? 'low' : ''}`}>{p.stock} in stock</span>
            </button>
          ))}
          {visible.length === 0 && <p className="muted">No products here.</p>}
        </div>
        <div className="shortcut-bar">
          <span><kbd>F2</kbd> Search</span>
          <span><kbd>F3</kbd> Remove item</span>
          <span><kbd>F4</kbd> Customer</span>
          <span><kbd>F6</kbd> Discount</span>
          <span><kbd>F8</kbd> Park</span>
          <span><kbd>F9</kbd> Recall ({state.parked.length})</span>
          <span><kbd>F12</kbd> Pay</span>
          <span><kbd>+</kbd>/<kbd>-</kbd> Qty</span>
        </div>
      </section>

      <section className="sell-right">
        <div className="cart-head">
          <button className="btn customer-btn" onClick={() => setModal('customer')}>
            <Icon name="person" size={20} />
            {customer ? (
              <>
                {customer.name} <span className="muted small">· {customer.loyaltyPoints} pts</span>
              </>
            ) : (
              <span className="muted">Add customer</span>
            )}
          </button>
          {customer && (
            <button className="icon-btn" onClick={() => setCustomerId(null)} aria-label="Remove customer">
              <Icon name="close" size={16} />
            </button>
          )}
        </div>

        <div className="cart">
          {cart.length === 0 && (
            <div className="cart-empty">
              <Icon name="cart" size={44} />
              <div>Scan or tap a product to start a sale</div>
              <div className="small">Tip: type 3* then scan to add 3</div>
            </div>
          )}
          {cart.map((l, i) => (
            <SwipeToDelete key={`${l.productId}-${i}`} onDelete={() => removeLine(i)}>
            <div className={`cart-line ${i === selected ? 'sel' : ''}`} onClick={() => setSelected(i)}>
              <div className="cl-main">
                <div className="cl-name">{l.name}</div>
                <div className="muted small">
                  {m(l.unitPrice)}
                  {l.discountPct > 0 && <span className="disc"> −{l.discountPct}%</span>}
                </div>
              </div>
              <div className="qty">
                <button aria-label="Decrease" onClick={(e) => (e.stopPropagation(), setQty(i, l.qty - 1))}>
                  <Icon name="minus" size={16} />
                </button>
                <span>{l.qty}</span>
                <button aria-label="Increase" onClick={(e) => (e.stopPropagation(), setQty(i, l.qty + 1))}>
                  <Icon name="plus" size={16} />
                </button>
              </div>
              <div className="cl-total">{m(lineTotal(l))}</div>
              <div className="cl-btns">
                <button
                  className="icon-btn"
                  aria-label="Edit line"
                  onClick={(e) => (e.stopPropagation(), setSelected(i), setModal('lineedit'))}
                >
                  <Icon name="pencil" size={16} />
                </button>
                <button
                  className="icon-btn trash"
                  aria-label={`Remove ${l.name}`}
                  onClick={(e) => (e.stopPropagation(), removeLine(i), focusSearch())}
                >
                  <Icon name="trash" size={16} />
                </button>
              </div>
            </div>
            </SwipeToDelete>
          ))}
        </div>

        <div className="totals">
          <div className="t-row muted">
            <span>Items</span>
            <span>{cart.reduce((a, l) => a + l.qty, 0)}</span>
          </div>
          {totals.discount > 0 && (
            <div className="t-row disc">
              <span>Discount{cartDiscount ? ` (${cartDiscount}% on sale)` : ''}</span>
              <span>−{m(totals.discount)}</span>
            </div>
          )}
          <div className="t-row muted">
            <span>VAT incl.</span>
            <span>{m(totals.vat)}</span>
          </div>
          <div className="t-row grand">
            <span>Total</span>
            <span>{m(totals.total)}</span>
          </div>
        </div>

        <div className="cart-actions">
          <button className="btn" onClick={park}>Park</button>
          <button className="btn" onClick={() => setModal('recall')}>Recall ({state.parked.length})</button>
          <button className="btn" onClick={() => cart.length && setModal('discount')}>Discount</button>
          <button
            className={`btn ${removeMode ? 'remove-on' : ''}`}
            onClick={() => (cart.length ? (setRemoveMode(!removeMode), focusSearch()) : toast('Nothing to remove', 'info'))}
          >
            Remove
          </button>
          <button className="btn danger-outline" onClick={clearCart}>Void</button>
        </div>
        <button className="btn pay" onClick={startPay} disabled={!cart.length}>
          Pay {m(totals.total)}
        </button>
      </section>

      {modal === 'customer' && (
        <CustomerPicker
          onPick={(c) => {
            setCustomerId(c.id);
            setModal(null);
            focusSearch();
          }}
          onClose={() => (setModal(null), focusSearch())}
        />
      )}

      {modal === 'recall' && (
        <Modal title="Parked sales" onClose={() => (setModal(null), focusSearch())}>
          {state.parked.length === 0 && <p className="muted">No parked sales.</p>}
          <div className="list">
            {state.parked.map((p) => (
              <button key={p.id} className="list-item" onClick={() => recall(p.id)}>
                <span>
                  <b>{p.label}</b>
                  <div className="muted small">
                    {p.lines.length} lines · parked by {state.staff.find((s) => s.id === p.staffId)?.name} at{' '}
                    {new Date(p.createdAt).toLocaleTimeString('en-ZA')}
                  </div>
                </span>
                <span>{m(calcTotals(p.lines, state.settings.vatRate).total)}</span>
              </button>
            ))}
          </div>
        </Modal>
      )}

      {modal === 'discount' && (
        <DiscountModal
          title="Discount whole sale"
          current={cartDiscount}
          onApply={(pct) => {
            setCartDiscount(pct);
            setModal(null);
            focusSearch();
          }}
          onClose={() => setModal(null)}
        />
      )}

      {modal === 'lineedit' && cart[selected] && (
        <LineEditModal
          line={cart[selected]}
          onSave={(l) => {
            setCart((c) => c.map((x, j) => (j === selected ? l : x)));
            setModal(null);
            focusSearch();
          }}
          onRemove={() => {
            removeLine(selected);
            setModal(null);
            focusSearch();
          }}
          onClose={() => setModal(null)}
        />
      )}

      {modal === 'pay' && (
        <PaymentModal
          total={totals.total}
          customer={customer}
          onClose={() => (setModal(null), focusSearch())}
          onComplete={(payments) => {
            try {
              const sale = update((s) =>
                completeSale(s, { staffId: user!.id, customerId, lines: cart, payments, cartDiscountPct: cartDiscount }),
              );
              setModal(null);
              setLastSale(sale);
              resetSale();
            } catch (e) {
              toast((e as Error).message, 'error');
            }
          }}
        />
      )}

      {lastSale && <ReceiptModal sale={lastSale} onClose={() => (setLastSale(null), focusSearch())} />}
    </div>
  );
}

function OpenShift() {
  const { update, user, state } = useStore();
  const [float, setFloat] = useState('500');
  const toast = useToast();
  const last = state.shifts.find((s) => s.closedAt);
  const open = () => {
    const c = parseMoney(float);
    if (isNaN(c) || c < 0) return toast('Enter a valid float amount', 'error');
    update((s) => openShift(s, user!.id, c));
    toast('Till opened — ready to sell');
  };
  return (
    <div className="center-card">
      <h2>Open the till</h2>
      <p className="muted">Count the cash in the drawer and enter the opening float to start selling.</p>
      {last && (
        <p className="muted small">
          Last shift closed {new Date(last.closedAt!).toLocaleString('en-ZA')} with {formatMoney(last.countedCash ?? 0)} counted.
        </p>
      )}
      <Field label="Opening float (R)">
        <input autoFocus value={float} onChange={(e) => setFloat(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && open()} />
      </Field>
      <button className="btn primary big" onClick={open}>
        Open till
      </button>
    </div>
  );
}

function CustomerPicker({ onPick, onClose }: { onPick: (c: Customer) => void; onClose: () => void }) {
  const { state, update } = useStore();
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const list = state.customers.filter(
    (c) => c.name.toLowerCase().includes(q.toLowerCase()) || c.phone.includes(q.replace(/\s/g, '')),
  );
  const add = () => {
    if (!name.trim()) return;
    const c: Customer = {
      id: uid(),
      name: name.trim(),
      phone: phone.trim(),
      email: '',
      loyaltyPoints: 0,
      accountBalance: 0,
      accountLimit: 0,
      notes: '',
    };
    update((s) => {
      s.customers.push(c);
    });
    onPick(c);
  };
  return (
    <Modal title="Customer" onClose={onClose}>
      {!adding ? (
        <>
          <input
            autoFocus
            className="search"
            placeholder="Search name or phone…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && list[0] && onPick(list[0])}
          />
          <div className="list">
            {list.slice(0, 8).map((c) => (
              <button key={c.id} className="list-item" onClick={() => onPick(c)}>
                <span>
                  <b>{c.name}</b>
                  <div className="muted small">{c.phone}</div>
                </span>
                <span className="muted small">{c.loyaltyPoints} pts</span>
              </button>
            ))}
          </div>
          <button
            className="btn"
            onClick={() => {
              setAdding(true);
              if (/^\d/.test(q)) setPhone(q);
              else setName(q);
            }}
          >
            + New customer
          </button>
        </>
      ) : (
        <>
          <Field label="Name">
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Phone">
            <input value={phone} onChange={(e) => setPhone(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
          </Field>
          <button className="btn primary" onClick={add}>
            Save & add to sale
          </button>
        </>
      )}
    </Modal>
  );
}

function DiscountModal({
  title,
  current,
  onApply,
  onClose,
}: {
  title: string;
  current: number;
  onApply: (pct: number) => void;
  onClose: () => void;
}) {
  const { state } = useStore();
  const approve = useApproval();
  const toast = useToast();
  const [val, setVal] = useState(String(current || ''));
  const apply = async (pct: number) => {
    if (isNaN(pct) || pct < 0 || pct > 100) return toast('Discount must be 0–100%', 'error');
    if (pct > state.settings.cashierMaxDiscount) {
      const ok = await approve(`Discount of ${pct}% (above the ${state.settings.cashierMaxDiscount}% cashier limit)`);
      if (!ok) return;
    }
    onApply(pct);
  };
  return (
    <Modal title={title} onClose={onClose}>
      <div className="quick-row">
        {[0, 5, 10, 15, 20].map((p) => (
          <button key={p} className="btn" onClick={() => apply(p)}>
            {p === 0 ? 'None' : `${p}%`}
          </button>
        ))}
      </div>
      <Field label="Custom %">
        <input
          autoFocus
          inputMode="decimal"
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && apply(parseFloat(val || '0'))}
        />
      </Field>
      <button className="btn primary" onClick={() => apply(parseFloat(val || '0'))}>
        Apply
      </button>
    </Modal>
  );
}

function LineEditModal({
  line,
  onSave,
  onRemove,
  onClose,
}: {
  line: CartLine;
  onSave: (l: CartLine) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const { state } = useStore();
  const approve = useApproval();
  const toast = useToast();
  const [qty, setQty] = useState(String(line.qty));
  const [price, setPrice] = useState((line.unitPrice / 100).toFixed(2));
  const [disc, setDisc] = useState(String(line.discountPct));

  const save = async () => {
    const q = parseInt(qty, 10);
    const p = parseMoney(price);
    const d = parseFloat(disc || '0');
    if (!(q > 0) || isNaN(p) || p < 0 || isNaN(d) || d < 0 || d > 100) return toast('Check the values', 'error');
    if (p !== line.unitPrice) {
      const ok = await approve(`Change price of ${line.name} to ${formatMoney(p)}`);
      if (!ok) return;
    }
    if (d > state.settings.cashierMaxDiscount && d !== line.discountPct) {
      const ok = await approve(`Discount of ${d}% on ${line.name}`);
      if (!ok) return;
    }
    onSave({ ...line, qty: q, unitPrice: p, discountPct: d });
  };

  return (
    <Modal title={line.name} onClose={onClose}>
      <div className="form-grid">
        <Field label="Quantity">
          <input autoFocus inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} />
        </Field>
        <Field label="Unit price (R)">
          <input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
        </Field>
        <Field label="Discount %">
          <input inputMode="decimal" value={disc} onChange={(e) => setDisc(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} />
        </Field>
      </div>
      <div className="row-between">
        <button className="btn danger-outline" onClick={onRemove}>
          Remove item
        </button>
        <button className="btn primary" onClick={save}>
          Save
        </button>
      </div>
    </Modal>
  );
}

const METHODS: { id: PaymentMethod; label: string }[] = [
  { id: 'cash', label: 'Cash' },
  { id: 'card', label: 'Card' },
  { id: 'eft', label: 'EFT' },
  { id: 'account', label: 'Account' },
];

function PaymentModal({
  total,
  customer,
  onComplete,
  onClose,
}: {
  total: number;
  customer: Customer | undefined;
  onComplete: (p: Payment[]) => void;
  onClose: () => void;
}) {
  const { state } = useStore();
  const toast = useToast();
  const m = (c: number) => formatMoney(c, state.settings.currency);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const paid = paidAmount(payments);
  const remaining = Math.max(0, total - paid);
  const [amount, setAmount] = useState((remaining / 100).toFixed(2));
  const [card, setCard] = useState<null | { cents: number; stage: 'waiting' | 'confirm' }>(null);
  const [authCode, setAuthCode] = useState('');
  const terminal = state.settings.terminal ?? DEFAULT_TERMINAL;
  const change = Math.max(0, paid - total);
  const done = paid >= total;

  useEffect(() => setAmount((remaining / 100).toFixed(2)), [remaining]);

  const record = (payment: Payment) => {
    const next = [...payments, payment];
    setPayments(next);
    // One-tap checkout: if this covers the bill, complete immediately.
    if (paidAmount(next) >= total) onComplete(next);
  };

  /** Card: never mark as paid until the terminal approves (integrated) or the cashier confirms it did. */
  const startCard = async (cents: number) => {
    setCard({ cents, stage: 'waiting' });
    const r = await chargeCard(terminal, cents);
    if (r === 'confirm') return setCard({ cents, stage: 'confirm' });
    setCard(null);
    if (r.approved) record({ method: 'card', amount: cents, reference: r.reference });
    else toast(r.message ?? 'Card declined', 'error');
  };

  const add = (method: PaymentMethod, cents: number) => {
    if (isNaN(cents) || cents <= 0) return toast('Enter an amount', 'error');
    if (method !== 'cash' && cents > remaining) return toast(`${method.toUpperCase()} cannot be more than what is owed`, 'error');
    if (method === 'account') {
      if (!customer) return toast('Add a customer to the sale first (F4)', 'error');
      if (customer.accountBalance + cents > customer.accountLimit)
        return toast(`Account limit reached (available ${m(customer.accountLimit - customer.accountBalance)})`, 'error');
    }
    if (method === 'card') return startCard(cents);
    record({ method, amount: cents });
  };

  if (card) {
    return (
      <Modal title="Card payment" onClose={() => card.stage === 'confirm' && setCard(null)}>
        <div className="pay-due">
          <div className="muted">Charge on card machine</div>
          <div className="pay-amount">{m(card.cents)}</div>
        </div>
        {card.stage === 'waiting' ? (
          <p className="center muted">Waiting for the customer to tap or insert their card…</p>
        ) : (
          <>
            <p className="center">Key <b>{m(card.cents)}</b> into the card machine. What did it say?</p>
            <Field label="Auth code / last 4 digits (optional)">
              <input autoFocus value={authCode} onChange={(e) => setAuthCode(e.target.value)} />
            </Field>
            <div className="quick-row">
              <button className="btn danger-outline" onClick={() => (setCard(null), toast('Card declined — try another payment', 'error'))}>Declined</button>
              <button
                className="btn primary"
                onClick={() => {
                  const c = card.cents;
                  setCard(null);
                  record({ method: 'card', amount: c, reference: authCode.trim() || undefined });
                  setAuthCode('');
                }}
              >
                Approved
              </button>
            </div>
          </>
        )}
      </Modal>
    );
  }

  return (
    <Modal title="Take payment" onClose={onClose} wide>
      <div className="pay-grid">
        <div>
          <div className="pay-due">
            <div className="muted">Amount due</div>
            <div className="pay-amount">{m(remaining)}</div>
            {payments.length > 0 && <div className="muted small">of {m(total)} total</div>}
          </div>
          <div className="method-tabs">
            {METHODS.map((x) => (
              <button key={x.id} className={`btn ${method === x.id ? 'primary' : ''}`} onClick={() => setMethod(x.id)}>
                {x.label}
              </button>
            ))}
          </div>
          {method === 'cash' && (
            <div className="quick-row">
              {quickTenders(remaining).map((t) => (
                <button key={t} className="btn tender" onClick={() => add('cash', t)}>
                  {t === remaining ? 'Exact' : m(t)}
                </button>
              ))}
            </div>
          )}
          <div className="pay-input">
            <input
              autoFocus
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && add(method, parseMoney(amount))}
              aria-label="Amount tendered"
            />
            <button className="btn primary" onClick={() => add(method, parseMoney(amount))}>
              {parseMoney(amount) < remaining ? 'Add part payment' : 'Complete sale'}
            </button>
          </div>
          {method === 'account' && customer && (
            <p className="muted small">
              {customer.name}: balance {m(customer.accountBalance)} / limit {m(customer.accountLimit)}
            </p>
          )}
        </div>
        <div className="pay-side">
          <h3>Payments</h3>
          {payments.length === 0 && <p className="muted small">Split across methods by entering part amounts.</p>}
          {payments.map((p, i) => (
            <div key={i} className="t-row">
              <span>{p.method.toUpperCase()}</span>
              <span>
                {m(p.amount)}{' '}
                <button className="icon-btn" aria-label="Remove payment" onClick={() => setPayments(payments.filter((_, j) => j !== i))}>
                  <Icon name="close" size={14} />
                </button>
              </span>
            </div>
          ))}
          {done && (
            <div className="t-row grand">
              <span>Change</span>
              <span>{m(change)}</span>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

function ReceiptModal({ sale, onClose }: { sale: Sale; onClose: () => void }) {
  const { state } = useStore();
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <Modal title="Sale complete" onClose={onClose}>
      {sale.change > 0 && (
        <div className="change-banner">
          Change due <b>{formatMoney(sale.change, state.settings.currency)}</b>
        </div>
      )}
      <Receipt sale={sale} />
      <div className="row-between">
        <button className="btn" onClick={() => window.print()}>
          Print receipt
        </button>
        <button className="btn primary" onClick={onClose}>
          New sale
        </button>
      </div>
    </Modal>
  );
}

/** iOS-style swipe left to delete a cart line (touch screens and mouse drag). */
function SwipeToDelete({ children, onDelete }: { children: React.ReactNode; onDelete: () => void }) {
  const [dx, setDx] = useState(0);
  const start = useRef<{ x: number; y: number; id: number } | null>(null);
  const THRESHOLD = 110;
  return (
    <div className="swipe-wrap">
      <div className="swipe-delete" aria-hidden="true" style={{ opacity: Math.min(1, -dx / THRESHOLD) }}>
        <Icon name="trash" size={18} /> Remove
      </div>
      <div
        className="swipe-front"
        style={{ transform: `translateX(${dx}px)`, transition: start.current ? 'none' : undefined }}
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest('button')) return;
          start.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
        }}
        onPointerMove={(e) => {
          const s = start.current;
          if (!s || s.id !== e.pointerId) return;
          const moveX = e.clientX - s.x;
          if (Math.abs(e.clientY - s.y) > 24 && Math.abs(moveX) < 12) return (start.current = null), setDx(0);
          if (moveX < -6) (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
          setDx(Math.min(0, Math.max(-180, moveX)));
        }}
        onPointerUp={() => {
          const del = dx <= -THRESHOLD;
          start.current = null;
          setDx(0);
          if (del) onDelete();
        }}
        onPointerCancel={() => ((start.current = null), setDx(0))}
      >
        {children}
      </div>
    </div>
  );
}
