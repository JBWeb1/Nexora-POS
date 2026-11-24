import { useState } from 'react';
import { useStore } from '../store';
import { formatMoney, parseMoney } from '../lib/money';
import { addPettyCash, can, PETTY_CATEGORIES, pettyBalance } from '../lib/actions';
import { Field, Modal, downloadCsv, useApproval, useToast } from '../components/ui';

/** Petty cash box: small business expenses kept separate from the till so cash-ups stay clean. */
export function PettyCash() {
  const { state, user } = useStore();
  const m = (c: number) => formatMoney(c, state.settings.currency);
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [form, setForm] = useState<null | 'expense' | 'top_up'>(null);

  const balance = pettyBalance(state);
  const entries = state.pettyCash.filter((e) => !month || e.at.slice(0, 7) === month);
  const spent = entries.filter((e) => e.type === 'expense').reduce((a, e) => a + e.amount, 0);
  const added = entries.filter((e) => e.type === 'top_up').reduce((a, e) => a + e.amount, 0);
  const byCat = new Map<string, number>();
  for (const e of entries) if (e.type === 'expense') byCat.set(e.category, (byCat.get(e.category) ?? 0) + e.amount);
  const name = (id?: string) => state.staff.find((s) => s.id === id)?.name ?? '';

  return (
    <div className="page">
      <div className="page-head">
        <h1>Petty Cash</h1>
        <div className="row">
          <button
            className="btn"
            onClick={() =>
              downloadCsv(`petty-cash-${month || 'all'}.csv`, [
                ['Date', 'Type', 'Category', 'Description', 'Slip #', 'Amount', 'By', 'Approved by'],
                ...entries.map((e) => [
                  new Date(e.at).toLocaleString('en-ZA'), e.type === 'expense' ? 'Expense' : 'Top-up', e.category, e.description,
                  e.reference, (e.type === 'expense' ? -e.amount : e.amount) / 100, name(e.staffId), name(e.approvedBy),
                ]),
              ])
            }
          >
            Export CSV
          </button>
          {can(user, 'manager') && <button className="btn" onClick={() => setForm('top_up')}>Top up</button>}
          <button className="btn primary" onClick={() => setForm('expense')}>Record expense</button>
        </div>
      </div>

      <div className="stats">
        <div className={`stat ${balance < 20000 ? 'warn' : ''}`}><div className="muted small">Cash in petty cash box</div><b>{m(balance)}</b></div>
        <div className="stat"><div className="muted small">Spent this period</div><b>{m(spent)}</b></div>
        <div className="stat"><div className="muted small">Topped up this period</div><b>{m(added)}</b></div>
      </div>

      <div className="row">
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Month" />
        <button className="btn" onClick={() => setMonth('')}>All time</button>
      </div>

      <div className="two-col petty-cols">
        <div className="table-wrap">
          <table>
            <thead><tr><th>Date</th><th>What</th><th>Category</th><th>By</th><th className="num">Amount</th></tr></thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td className="small">{new Date(e.at).toLocaleDateString('en-ZA')}</td>
                  <td>{e.description || (e.type === 'top_up' ? 'Top-up' : '')}{e.reference && <div className="muted small">Slip {e.reference}</div>}</td>
                  <td>{e.type === 'top_up' ? <span className="tag">Top-up</span> : e.category}</td>
                  <td className="small">{name(e.staffId)}{e.approvedBy && e.approvedBy !== e.staffId && <div className="muted">ok'd by {name(e.approvedBy)}</div>}</td>
                  <td className={`num ${e.type === 'top_up' ? 'ok-text' : ''}`}>{e.type === 'top_up' ? '+' : '−'}{m(e.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {entries.length === 0 && <p className="muted pad">No petty cash activity for this period.</p>}
        </div>
        <div className="card">
          <h3>Spending by category</h3>
          {[...byCat.entries()].sort((a, b) => b[1] - a[1]).map(([c, v]) => (
            <div key={c} className="t-row"><span>{c}</span><span>{m(v)}</span></div>
          ))}
          {byCat.size === 0 && <p className="muted">Nothing spent yet.</p>}
        </div>
      </div>

      {form && <EntryForm type={form} balance={balance} onClose={() => setForm(null)} />}
    </div>
  );
}

function EntryForm({ type, balance, onClose }: { type: 'expense' | 'top_up'; balance: number; onClose: () => void }) {
  const { state, update, user } = useStore();
  const approve = useApproval();
  const toast = useToast();
  const [amt, setAmt] = useState('');
  const [category, setCategory] = useState(type === 'top_up' ? 'Top-up' : PETTY_CATEGORIES[0]);
  const [description, setDescription] = useState('');
  const [reference, setReference] = useState('');

  const save = async () => {
    const amount = parseMoney(amt);
    if (isNaN(amount) || amount <= 0) return toast('Enter an amount', 'error');
    // Cashiers can record expenses but a supervisor must okay them.
    const ok = type === 'expense' ? await approve(`Petty cash expense of ${formatMoney(amount)}: ${description || category}`, 'supervisor') : user;
    if (!ok) return;
    try {
      update((s) => addPettyCash(s, { type, amount, category, description: description.trim(), reference: reference.trim(), staffId: user!.id, approvedBy: ok.id }));
      toast(type === 'expense' ? 'Expense recorded' : 'Petty cash topped up');
      onClose();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  return (
    <Modal title={type === 'expense' ? 'Record expense' : 'Top up petty cash'} onClose={onClose}>
      <p className="muted small">Available in the box: <b>{formatMoney(balance, state.settings.currency)}</b></p>
      <Field label="Amount (R)">
        <input autoFocus inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value)} />
      </Field>
      {type === 'expense' && (
        <>
          <div className="chips">
            {PETTY_CATEGORIES.map((c) => (
              <button key={c} className={`chip ${category === c ? 'active' : ''}`} onClick={() => setCategory(c)}>{c}</button>
            ))}
          </div>
          <Field label="What was bought">
            <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Milk and sugar for staff" />
          </Field>
          <Field label="Slip / invoice number (optional)">
            <input value={reference} onChange={(e) => setReference(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} />
          </Field>
        </>
      )}
      {type === 'top_up' && (
        <Field label="Note (optional)">
          <input value={description} onChange={(e) => setDescription(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} placeholder="e.g. Withdrawn from bank" />
        </Field>
      )}
      <button className="btn primary big" onClick={save}>Save</button>
    </Modal>
  );
}
