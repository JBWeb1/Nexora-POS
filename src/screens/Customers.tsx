import { useState } from 'react';
import { useStore } from '../store';
import type { Customer } from '../types';
import { formatMoney, parseMoney } from '../lib/money';
import { audit, can } from '../lib/actions';
import { uid } from '../lib/id';
import { Field, Modal, downloadCsv, useToast } from '../components/ui';

export function Customers() {
  const { state, user } = useStore();
  const m = (c: number) => formatMoney(c, state.settings.currency);
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Customer | null>(null);
  const [paying, setPaying] = useState<Customer | null>(null);

  const list = state.customers
    .filter((c) => `${c.name} ${c.phone} ${c.email}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name));
  const owed = state.customers.reduce((a, c) => a + c.accountBalance, 0);

  const spend = (id: string) =>
    state.sales.filter((s) => s.customerId === id).reduce((a, s) => a + s.totals.total, 0);

  return (
    <div className="page">
      <div className="page-head">
        <h1>Customers</h1>
        <div className="row">
          <button
            className="btn"
            onClick={() =>
              downloadCsv('customers.csv', [
                ['Name', 'Phone', 'Email', 'Points', 'Account balance', 'Limit'],
                ...state.customers.map((c) => [c.name, c.phone, c.email, c.loyaltyPoints, c.accountBalance / 100, c.accountLimit / 100]),
              ])
            }
          >
            Export CSV
          </button>
          <button className="btn primary" onClick={() => setEditing({ id: '', name: '', phone: '', email: '', loyaltyPoints: 0, accountBalance: 0, accountLimit: 0, notes: '' })}>
            + New customer
          </button>
        </div>
      </div>

      <div className="stats">
        <div className="stat"><div className="muted small">Customers</div><b>{state.customers.length}</b></div>
        <div className="stat"><div className="muted small">Owed on accounts</div><b>{m(owed)}</b></div>
      </div>

      <input className="search" placeholder="Search name, phone or email…" value={q} onChange={(e) => setQ(e.target.value)} />

      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Name</th><th>Contact</th><th className="num">Lifetime spend</th><th className="num">Points</th><th className="num">Account</th><th></th></tr>
          </thead>
          <tbody>
            {list.map((c) => (
              <tr key={c.id}>
                <td>{c.name}{c.notes && <div className="muted small">{c.notes}</div>}</td>
                <td className="small">{c.phone}<br /><span className="muted">{c.email}</span></td>
                <td className="num">{m(spend(c.id))}</td>
                <td className="num">{c.loyaltyPoints}</td>
                <td className={`num ${c.accountBalance > 0 ? 'warn-text' : ''}`}>
                  {m(c.accountBalance)}
                  {c.accountLimit > 0 && <div className="muted small">limit {m(c.accountLimit)}</div>}
                </td>
                <td className="actions">
                  {c.accountBalance > 0 && <button className="btn small-btn" onClick={() => setPaying(c)}>Receive payment</button>}
                  <button className="btn small-btn" onClick={() => setEditing(c)}>Edit</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && <CustomerForm customer={editing} canSetLimit={can(user, 'manager')} onClose={() => setEditing(null)} />}
      {paying && <AccountPayment customer={paying} onClose={() => setPaying(null)} />}
    </div>
  );
}

function CustomerForm({ customer, canSetLimit, onClose }: { customer: Customer; canSetLimit: boolean; onClose: () => void }) {
  const { update } = useStore();
  const toast = useToast();
  const [c, setC] = useState(customer);
  const [limit, setLimit] = useState((customer.accountLimit / 100).toFixed(2));
  const save = () => {
    if (!c.name.trim()) return toast('Name is required', 'error');
    const lim = parseMoney(limit);
    update((s) => {
      const next = { ...c, accountLimit: canSetLimit && !isNaN(lim) ? lim : c.accountLimit };
      if (!c.id) s.customers.push({ ...next, id: uid() });
      else s.customers = s.customers.map((x) => (x.id === c.id ? next : x));
    });
    toast('Customer saved');
    onClose();
  };
  return (
    <Modal title={c.id ? 'Edit customer' : 'New customer'} onClose={onClose}>
      <Field label="Name"><input autoFocus value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} /></Field>
      <Field label="Phone"><input value={c.phone} onChange={(e) => setC({ ...c, phone: e.target.value })} /></Field>
      <Field label="Email"><input value={c.email} onChange={(e) => setC({ ...c, email: e.target.value })} /></Field>
      <Field label={`Account credit limit (R)${canSetLimit ? '' : ' — manager only'}`}>
        <input disabled={!canSetLimit} value={limit} onChange={(e) => setLimit(e.target.value)} />
      </Field>
      <Field label="Notes"><input value={c.notes} onChange={(e) => setC({ ...c, notes: e.target.value })} /></Field>
      <button className="btn primary" onClick={save}>Save</button>
    </Modal>
  );
}

function AccountPayment({ customer, onClose }: { customer: Customer; onClose: () => void }) {
  const { update, user } = useStore();
  const toast = useToast();
  const [amt, setAmt] = useState((customer.accountBalance / 100).toFixed(2));
  const save = () => {
    const c = parseMoney(amt);
    if (isNaN(c) || c <= 0 || c > customer.accountBalance) return toast('Enter a valid amount', 'error');
    update((s) => {
      const x = s.customers.find((y) => y.id === customer.id)!;
      x.accountBalance -= c;
      audit(s, user!.id, 'account_payment', `${x.name} paid ${c}`);
    });
    toast('Payment recorded');
    onClose();
  };
  return (
    <Modal title={`Account payment — ${customer.name}`} onClose={onClose}>
      <p>Balance owed: <b>{formatMoney(customer.accountBalance)}</b></p>
      <Field label="Amount received (R)">
        <input autoFocus value={amt} onChange={(e) => setAmt(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} />
      </Field>
      <button className="btn primary" onClick={save}>Record payment</button>
    </Modal>
  );
}
