import { useState } from 'react';
import { useStore } from '../store';
import type { PaymentMethod, Sale } from '../types';
import { formatMoney } from '../lib/money';
import { alreadyRefunded, refundSale } from '../lib/actions';
import { Field, Modal, downloadCsv, useApproval, useToast } from '../components/ui';
import { Receipt } from '../components/Receipt';

export function SalesHistory() {
  const { state } = useStore();
  const m = (c: number) => formatMoney(c, state.settings.currency);
  const [q, setQ] = useState('');
  const [day, setDay] = useState(new Date().toISOString().slice(0, 10));
  const [viewing, setViewing] = useState<Sale | null>(null);
  const [refunding, setRefunding] = useState<Sale | null>(null);

  const list = state.sales.filter((s) => {
    if (q) {
      const cust = state.customers.find((c) => c.id === s.customerId)?.name ?? '';
      return `${s.number} ${cust}`.toLowerCase().includes(q.toLowerCase());
    }
    return !day || s.createdAt.slice(0, 10) === day;
  });

  const exportCsv = () =>
    downloadCsv(`sales-${day || 'all'}.csv`, [
      ['Number', 'Date', 'Staff', 'Customer', 'Total', 'VAT', 'Payments', 'Type'],
      ...list.map((s) => [
        s.number,
        new Date(s.createdAt).toLocaleString('en-ZA'),
        state.staff.find((x) => x.id === s.staffId)?.name ?? '',
        state.customers.find((c) => c.id === s.customerId)?.name ?? '',
        s.totals.total / 100,
        s.totals.vat / 100,
        s.payments.map((p) => `${p.method}:${p.amount / 100}`).join(' '),
        s.refundOf ? 'Refund' : 'Sale',
      ]),
    ]);

  return (
    <div className="page">
      <div className="page-head">
        <h1>Sales history</h1>
        <button className="btn" onClick={exportCsv}>Export CSV</button>
      </div>
      <div className="row">
        <input className="search" placeholder="Find by receipt # or customer…" value={q} onChange={(e) => setQ(e.target.value)} />
        <input type="date" value={day} onChange={(e) => setDay(e.target.value)} disabled={!!q} />
        <button className="btn" onClick={() => setDay('')}>All dates</button>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>#</th><th>Time</th><th>Staff</th><th>Customer</th><th>Paid by</th><th className="num">Total</th><th>Status</th><th></th></tr>
          </thead>
          <tbody>
            {list.map((s) => (
              <tr key={s.id} className={s.refundOf ? 'refund-row' : ''}>
                <td>{s.number}</td>
                <td className="small">{new Date(s.createdAt).toLocaleString('en-ZA')}</td>
                <td>{state.staff.find((x) => x.id === s.staffId)?.name}</td>
                <td>{state.customers.find((c) => c.id === s.customerId)?.name ?? <span className="muted">—</span>}</td>
                <td className="small">{[...new Set(s.payments.map((p) => p.method))].join(', ')}</td>
                <td className="num">{m(s.totals.total)}</td>
                <td>
                  {s.refundOf ? <span className="tag">Refund</span> : s.status === 'completed' ? '' : <span className="tag warn">{s.status.replace('_', ' ')}</span>}
                </td>
                <td className="actions">
                  <button className="btn small-btn" onClick={() => setViewing(s)}>Receipt</button>
                  {!s.refundOf && s.status !== 'refunded' && (
                    <button className="btn small-btn" onClick={() => setRefunding(s)}>Refund</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {list.length === 0 && <p className="muted pad">No sales for this filter.</p>}
      </div>

      {viewing && (
        <Modal title={`Receipt #${viewing.number}`} onClose={() => setViewing(null)}>
          <Receipt sale={viewing} />
          <button className="btn" onClick={() => window.print()}>Reprint</button>
        </Modal>
      )}
      {refunding && <RefundModal sale={refunding} onClose={() => setRefunding(null)} />}
    </div>
  );
}

function RefundModal({ sale, onClose }: { sale: Sale; onClose: () => void }) {
  const { state, update } = useStore();
  const approve = useApproval();
  const toast = useToast();
  const done = alreadyRefunded(state, sale.id);
  const [qtys, setQtys] = useState<Record<string, number>>({});
  const [method, setMethod] = useState<PaymentMethod>(sale.payments[0]?.method ?? 'cash');
  const [reason, setReason] = useState('');

  const submit = async () => {
    if (!reason.trim()) return toast('Enter a reason for the refund', 'error');
    const ok = await approve(`Refund on receipt #${sale.number}`, 'supervisor');
    if (!ok) return;
    try {
      update((s) => refundSale(s, ok.id, sale.id, qtys, method, reason.trim()));
      toast('Refund processed');
      onClose();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  return (
    <Modal title={`Refund receipt #${sale.number}`} onClose={onClose} wide>
      <table>
        <thead><tr><th>Item</th><th className="num">Bought</th><th className="num">Refunded</th><th className="num">Refund now</th></tr></thead>
        <tbody>
          {sale.lines.map((l) => {
            const max = l.qty - (done[l.productId] ?? 0);
            return (
              <tr key={l.productId}>
                <td>{l.name}</td>
                <td className="num">{l.qty}</td>
                <td className="num">{done[l.productId] ?? 0}</td>
                <td className="num">
                  <input
                    type="number"
                    min={0}
                    max={max}
                    disabled={max <= 0}
                    className="qty-input"
                    value={qtys[l.productId] ?? 0}
                    onChange={(e) => setQtys({ ...qtys, [l.productId]: Math.min(max, Math.max(0, parseInt(e.target.value || '0', 10))) })}
                  />
                  {max > 0 && <button className="btn small-btn" onClick={() => setQtys({ ...qtys, [l.productId]: max })}>All</button>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="form-grid">
        <Field label="Refund to">
          <select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
            <option value="cash">Cash</option>
            <option value="card">Card</option>
            <option value="eft">EFT</option>
            {sale.customerId && <option value="account">Customer account</option>}
          </select>
        </Field>
        <Field label="Reason">
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. damaged, wrong size" />
        </Field>
      </div>
      <button className="btn primary" onClick={submit}>Process refund</button>
    </Modal>
  );
}
