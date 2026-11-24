import { useEffect, useState } from 'react';
import { useStore } from '../store';
import type { Layby, PaymentMethod } from '../types';
import { formatMoney, lineTotal, parseMoney } from '../lib/money';
import { cancelLayby, currentShift, laybyBalance, laybyOverdue, laybyPaid, payLayby } from '../lib/actions';
import { Field, Modal, downloadCsv, useApproval, useToast } from '../components/ui';
import { Icon } from '../components/Icon';

type Filter = 'open' | 'overdue' | 'completed' | 'cancelled';

export function Laybys() {
  const { state } = useStore();
  const m = (c: number) => formatMoney(c, state.settings.currency);
  const [filter, setFilter] = useState<Filter>('open');
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const cust = (id: string) => state.customers.find((c) => c.id === id);

  const list = state.laybys
    .filter((l) => (filter === 'overdue' ? laybyOverdue(l) : l.status === filter))
    .filter((l) => {
      const c = cust(l.customerId);
      return `LB${l.number} ${c?.name ?? ''} ${c?.phone ?? ''}`.toLowerCase().includes(q.toLowerCase());
    });
  const open = state.laybys.filter((l) => l.status === 'open');
  const owed = open.reduce((a, l) => a + laybyBalance(l), 0);
  const held = open.reduce((a, l) => a + laybyPaid(l), 0);
  const overdue = open.filter(laybyOverdue).length;
  const selected = state.laybys.find((l) => l.id === openId);

  return (
    <div className="page">
      <div className="page-head">
        <h1>Lay-bys</h1>
        <button
          className="btn"
          onClick={() =>
            downloadCsv('laybys.csv', [
              ['Lay-by', 'Customer', 'Phone', 'Opened', 'Due', 'Total', 'Paid', 'Balance', 'Status'],
              ...state.laybys.map((l) => [
                `LB${l.number}`, cust(l.customerId)?.name ?? '', cust(l.customerId)?.phone ?? '', l.createdAt.slice(0, 10), l.dueDate.slice(0, 10),
                l.total / 100, laybyPaid(l) / 100, (l.status === 'open' ? laybyBalance(l) : 0) / 100, l.status,
              ]),
            ])
          }
        >
          Export CSV
        </button>
      </div>
      <p className="muted small">
        To start a lay-by: on <b>Sell</b>, scan the items, press <b>Pay</b>, then choose <b>Put on lay-by instead</b>.
      </p>

      <div className="stats">
        <div className="stat"><div className="muted small">Open lay-bys</div><b>{open.length}</b></div>
        <div className="stat"><div className="muted small">Still owed by customers</div><b>{m(owed)}</b></div>
        <div className="stat"><div className="muted small">Deposits held</div><b>{m(held)}</b></div>
        <button className={`stat stat-btn ${overdue ? 'warn' : ''}`} onClick={() => setFilter('overdue')}>
          <div className="muted small">Overdue</div><b>{overdue}</b>
        </button>
      </div>

      <div className="row">
        <input className="search" placeholder="Search lay-by number, name or phone" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="segmented">
          {(['open', 'overdue', 'completed', 'cancelled'] as Filter[]).map((f) => (
            <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>
              {f[0].toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Lay-by</th><th>Customer</th><th>Due</th><th className="num">Total</th><th className="num">Paid</th><th className="num">Balance</th><th></th></tr>
          </thead>
          <tbody>
            {list.map((l) => {
              const c = cust(l.customerId);
              const pct = Math.round((laybyPaid(l) / l.total) * 100);
              return (
                <tr key={l.id} onClick={() => setOpenId(l.id)} className="click-row">
                  <td><b>LB{l.number}</b><div className="muted small">{l.lines.reduce((a, x) => a + x.qty, 0)} items</div></td>
                  <td>{c?.name}<div className="muted small">{c?.phone}</div></td>
                  <td className={laybyOverdue(l) ? 'warn-text' : 'small'}>{new Date(l.dueDate).toLocaleDateString('en-ZA')}</td>
                  <td className="num">{m(l.total)}</td>
                  <td className="num">
                    {m(laybyPaid(l))}
                    <div className="progress"><span style={{ width: `${pct}%` }} /></div>
                  </td>
                  <td className="num"><b>{l.status === 'open' ? m(laybyBalance(l)) : '—'}</b></td>
                  <td className="actions"><button className="btn small-btn">Open</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {list.length === 0 && <p className="muted pad">No lay-bys here.</p>}
      </div>

      {selected && <LaybyDetail layby={selected} onClose={() => setOpenId(null)} />}
    </div>
  );
}

function LaybyDetail({ layby, onClose }: { layby: Layby; onClose: () => void }) {
  const { state, update, user } = useStore();
  const toast = useToast();
  const approve = useApproval();
  const m = (c: number) => formatMoney(c, state.settings.currency);
  const balance = laybyBalance(layby);
  const [amt, setAmt] = useState((balance / 100).toFixed(2));
  // After each part-payment, pre-fill the new balance.
  useEffect(() => setAmt((balance / 100).toFixed(2)), [balance]);
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [mode, setMode] = useState<'view' | 'cancel'>('view');
  const shiftOpen = !!currentShift(state);
  const paid = laybyPaid(layby);
  const fee = Math.min(paid, Math.round((layby.total * (state.settings.laybyCancelFeePct ?? 10)) / 100));

  const pay = () => {
    const c = parseMoney(amt);
    try {
      const l = update((s) => payLayby(s, user!.id, layby.id, c, method));
      if (l.status === 'completed') toast(`LB${l.number} fully paid — hand over the goods`, 'ok');
      else toast(`Payment taken. ${m(laybyBalance(l))} still owed`);
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  const cancel = async () => {
    const ok = await approve(`Cancel lay-by LB${layby.number}: refund ${m(paid - fee)}, keep ${m(fee)} fee`, 'supervisor');
    if (!ok) return;
    try {
      const r = update((s) => cancelLayby(s, ok.id, layby.id, method));
      toast(`Cancelled. Refund ${m(r.refund)} · items back in stock`);
      setMode('view');
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  const methods = (['cash', 'card', 'eft'] as PaymentMethod[]).map((x) => (
    <button key={x} className={`btn ${method === x ? 'primary' : ''}`} onClick={() => setMethod(x)}>
      {x === 'eft' ? 'EFT' : x[0].toUpperCase() + x.slice(1)}
    </button>
  ));

  return (
    <Modal title={`Lay-by LB${layby.number}`} onClose={onClose} wide>
      <div className="pay-grid">
        <LaybySlip layby={layby} />
        <div className="layby-actions">
          {layby.status === 'open' && mode === 'view' && (
            <>
              <div className="pay-due">
                <div className="muted">Balance owed</div>
                <div className="pay-amount">{m(balance)}</div>
              </div>
              {!shiftOpen && <p className="warn-text small">Open the till to take payments.</p>}
              <Field label="Amount (R)">
                <input autoFocus inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && pay()} />
              </Field>
              <div className="method-tabs three">{methods}</div>
              <button className="btn primary big" onClick={pay} disabled={!shiftOpen}>Take payment</button>
              <div className="row-between">
                <button className="btn" onClick={() => window.print()}>Print slip</button>
                <button className="btn danger-outline" onClick={() => setMode('cancel')} disabled={!shiftOpen}>Cancel lay-by</button>
              </div>
            </>
          )}
          {layby.status === 'open' && mode === 'cancel' && (
            <>
              <h3>Cancel this lay-by?</h3>
              <div className="t-row"><span>Customer paid</span><span>{m(paid)}</span></div>
              <div className="t-row"><span>Cancellation fee ({state.settings.laybyCancelFeePct ?? 10}%)</span><span>−{m(fee)}</span></div>
              <div className="t-row grand"><span>Refund</span><span>{m(paid - fee)}</span></div>
              <p className="muted small">All items go back into stock.</p>
              <div className="method-tabs three">{methods}</div>
              <div className="row-between">
                <button className="btn" onClick={() => setMode('view')}>Back</button>
                <button className="btn danger-outline" onClick={cancel}>Cancel & refund</button>
              </div>
            </>
          )}
          {layby.status !== 'open' && (
            <div className={`variance ${layby.status === 'completed' ? 'ok' : 'bad'}`}>
              {layby.status === 'completed' ? '✓ Paid in full and collected' : `Cancelled — fee kept ${m(layby.cancelFee ?? 0)}`}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

export function LaybySlip({ layby }: { layby: Layby }) {
  const { state } = useStore();
  const m = (c: number) => formatMoney(c, state.settings.currency);
  const c = state.customers.find((x) => x.id === layby.customerId);
  const paid = laybyPaid(layby);
  return (
    <div className="receipt" id="print-receipt">
      <div className="center">
        <b>{state.settings.businessName}</b>
        <div>{state.settings.address}</div>
        <div className="r-title">LAY-BY LB{layby.number}</div>
      </div>
      <div>Customer: {c?.name}</div>
      <div>Phone: {c?.phone}</div>
      <div>Opened: {new Date(layby.createdAt).toLocaleDateString('en-ZA')}</div>
      <div>Collect by: <b>{new Date(layby.dueDate).toLocaleDateString('en-ZA')}</b></div>
      <hr />
      {layby.lines.map((l, i) => (
        <div key={i} className="r-row">
          <span>{l.qty} × {l.name}</span>
          <span>{m(lineTotal(l))}</span>
        </div>
      ))}
      <hr />
      <div className="r-row r-total"><span>TOTAL</span><span>{m(layby.total)}</span></div>
      {layby.payments.map((p, i) => (
        <div key={i} className="r-row">
          <span>{new Date(p.at).toLocaleDateString('en-ZA')} {p.method.toUpperCase()}</span>
          <span>{m(p.amount)}</span>
        </div>
      ))}
      <div className="r-row r-total"><span>{layby.status === 'open' ? 'BALANCE' : 'PAID'}</span><span>{m(layby.status === 'open' ? layby.total - paid : paid)}</span></div>
      <div className="center r-footer small">
        Goods are released once paid in full. Cancellation fee: {state.settings.laybyCancelFeePct ?? 10}% of the lay-by value.
      </div>
      {layby.status === 'open' && (
        <div className="center muted small" style={{ marginTop: 6 }}>
          <Icon name="bag" size={14} /> Keep this slip
        </div>
      )}
    </div>
  );
}
