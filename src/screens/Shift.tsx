import { useState } from 'react';
import { useStore } from '../store';
import { formatMoney, parseMoney } from '../lib/money';
import { audit, closeShift, currentShift, summariseShift } from '../lib/actions';
import { uid } from '../lib/id';
import { Field, Modal, useApproval, useToast } from '../components/ui';

/** South African notes & coins, in cents, for the guided cash count. */
const DENOMS = [20000, 10000, 5000, 2000, 1000, 500, 200, 100, 50, 20, 10];

export function ShiftScreen() {
  const { state, update, user } = useStore();
  const approve = useApproval();
  const toast = useToast();
  const m = (c: number) => formatMoney(c, state.settings.currency);
  const shift = currentShift(state);
  const [counts, setCounts] = useState<Record<number, string>>({});
  const [movement, setMovement] = useState<null | 'payout' | 'cash_in'>(null);
  const [closedReport, setClosedReport] = useState<string | null>(null);

  if (!shift) {
    const history = state.shifts.filter((s) => s.closedAt).slice(0, 10);
    return (
      <div className="page">
        <h1>Till & cash-up</h1>
        <p className="muted">No shift is open. Go to <b>Sell</b> to open the till.</p>
        {closedReport && <ZReport shiftId={closedReport} />}
        <h3>Recent shifts</h3>
        <table>
          <thead><tr><th>Opened</th><th>Closed</th><th className="num">Expected</th><th className="num">Counted</th><th className="num">Over/short</th></tr></thead>
          <tbody>
            {history.map((s) => {
              const v = (s.countedCash ?? 0) - (s.expectedCash ?? 0);
              return (
                <tr key={s.id}>
                  <td className="small">{new Date(s.openedAt).toLocaleString('en-ZA')}</td>
                  <td className="small">{new Date(s.closedAt!).toLocaleString('en-ZA')}</td>
                  <td className="num">{m(s.expectedCash ?? 0)}</td>
                  <td className="num">{m(s.countedCash ?? 0)}</td>
                  <td className={`num ${v < 0 ? 'warn-text' : v > 0 ? 'ok-text' : ''}`}>{m(v)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  const sum = summariseShift(state, shift);
  const counted = DENOMS.reduce((a, d) => a + d * (parseInt(counts[d] || '0', 10) || 0), 0);
  const variance = counted - sum.expectedCash;

  const close = async () => {
    const ok = await approve(`Close the till with ${m(counted)} counted (${variance === 0 ? 'balanced' : `${variance > 0 ? 'over' : 'short'} ${m(Math.abs(variance))}`})`, 'supervisor');
    if (!ok) return;
    update((s) => closeShift(s, ok.id, counted));
    setClosedReport(shift.id);
    setCounts({});
    toast('Shift closed');
  };

  return (
    <div className="page">
      <div className="page-head">
        <h1>Till & cash-up</h1>
        <div className="row">
          <button className="btn" onClick={() => setMovement('payout')}>Cash paid out</button>
          <button className="btn" onClick={() => setMovement('cash_in')}>Cash added</button>
        </div>
      </div>
      <p className="muted">
        Shift opened {new Date(shift.openedAt).toLocaleString('en-ZA')} by {state.staff.find((s) => s.id === shift.openedBy)?.name}
        {user && ` · you are ${user.name}`}
      </p>

      <div className="stats">
        <div className="stat"><div className="muted small">Sales</div><b>{sum.salesCount}</b></div>
        <div className="stat"><div className="muted small">Takings</div><b>{m(sum.grossSales - sum.refunds)}</b></div>
        <div className="stat"><div className="muted small">Card</div><b>{m(sum.byMethod.card)}</b></div>
        <div className="stat"><div className="muted small">EFT</div><b>{m(sum.byMethod.eft)}</b></div>
        <div className="stat"><div className="muted small">On account</div><b>{m(sum.byMethod.account)}</b></div>
        <div className="stat"><div className="muted small">Lay-bys & vouchers</div><b>{m(sum.laybyAndVouchers)}</b></div>
      </div>

      <div className="two-col">
        <div className="card">
          <h3>Count the drawer</h3>
          <p className="muted small">Type how many of each note/coin. We do the maths.</p>
          <div className="denoms">
            {DENOMS.map((d) => (
              <label key={d} className="denom">
                <span>{d >= 100 ? `R${d / 100}` : `${d}c`}</span>
                <input inputMode="numeric" value={counts[d] ?? ''} onChange={(e) => setCounts({ ...counts, [d]: e.target.value.replace(/\D/g, '') })} />
                <span className="muted small">{m(d * (parseInt(counts[d] || '0', 10) || 0))}</span>
              </label>
            ))}
          </div>
        </div>
        <div className="card">
          <h3>Cash reconciliation</h3>
          <div className="t-row"><span>Opening float</span><span>{m(shift.openingFloat)}</span></div>
          <div className="t-row"><span>+ Cash sales, lay-by & voucher cash (less change & refunds)</span><span>{m(sum.byMethod.cash)}</span></div>
          <div className="t-row"><span>+ Cash added</span><span>{m(sum.cashIn)}</span></div>
          <div className="t-row"><span>− Paid out</span><span>{m(sum.payouts)}</span></div>
          <div className="t-row grand"><span>Expected in drawer</span><span>{m(sum.expectedCash)}</span></div>
          <div className="t-row grand"><span>Counted</span><span>{m(counted)}</span></div>
          {counted === 0 ? (
            <div className="variance muted">Enter your count to see if the till balances</div>
          ) : (
            <div className={`variance ${variance === 0 ? 'ok' : variance < 0 ? 'bad' : 'over'}`}>
              {variance === 0 ? '✓ Balanced' : variance < 0 ? `Short by ${m(-variance)}` : `Over by ${m(variance)}`}
            </div>
          )}
          {shift.movements.length > 0 && (
            <>
              <h4>Cash movements</h4>
              {shift.movements.map((mv) => (
                <div key={mv.id} className="t-row small">
                  <span>{mv.type === 'payout' ? 'Paid out' : 'Added'}: {mv.reason}</span>
                  <span>{m(mv.amount)}</span>
                </div>
              ))}
            </>
          )}
          <button className="btn primary big" onClick={close}>Close shift & print Z-report</button>
        </div>
      </div>

      {movement && (
        <MovementModal
          type={movement}
          onClose={() => setMovement(null)}
          onSave={async (amount, reason) => {
            if (movement === 'payout') {
              const ok = await approve(`Pay out ${m(amount)} from the till: ${reason}`);
              if (!ok) return;
            }
            update((s) => {
              currentShift(s)!.movements.push({ id: uid(), at: new Date().toISOString(), type: movement, amount, reason, staffId: user!.id });
              audit(s, user!.id, movement, `${amount} ${reason}`);
            });
            setMovement(null);
            toast('Recorded');
          }}
        />
      )}
    </div>
  );
}

function MovementModal({ type, onSave, onClose }: { type: 'payout' | 'cash_in'; onSave: (a: number, r: string) => void; onClose: () => void }) {
  const [amt, setAmt] = useState('');
  const [reason, setReason] = useState('');
  const toast = useToast();
  const save = () => {
    const c = parseMoney(amt);
    if (isNaN(c) || c <= 0 || !reason.trim()) return toast('Enter an amount and reason', 'error');
    onSave(c, reason.trim());
  };
  return (
    <Modal title={type === 'payout' ? 'Cash paid out of till' : 'Cash added to till'} onClose={onClose}>
      <Field label="Amount (R)"><input autoFocus value={amt} onChange={(e) => setAmt(e.target.value)} /></Field>
      <Field label="Reason"><input value={reason} onChange={(e) => setReason(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} placeholder={type === 'payout' ? 'e.g. bought milk' : 'e.g. extra change'} /></Field>
      <button className="btn primary" onClick={save}>Save</button>
    </Modal>
  );
}

function ZReport({ shiftId }: { shiftId: string }) {
  const { state } = useStore();
  const shift = state.shifts.find((s) => s.id === shiftId);
  if (!shift) return null;
  const sum = summariseShift(state, shift);
  const m = (c: number) => formatMoney(c, state.settings.currency);
  const v = (shift.countedCash ?? 0) - (shift.expectedCash ?? 0);
  return (
    <div className="card">
      <div className="receipt" id="print-receipt">
        <div className="center"><b>{state.settings.businessName}</b><div className="r-title">Z-REPORT</div></div>
        <div>Opened: {new Date(shift.openedAt).toLocaleString('en-ZA')}</div>
        <div>Closed: {new Date(shift.closedAt!).toLocaleString('en-ZA')}</div>
        <hr />
        <div className="r-row"><span>Sales ({sum.salesCount})</span><span>{m(sum.grossSales)}</span></div>
        <div className="r-row"><span>Refunds</span><span>{m(-sum.refunds)}</span></div>
        <div className="r-row"><span>VAT</span><span>{m(sum.vat)}</span></div>
        <hr />
        {Object.entries(sum.byMethod).map(([k, val]) => (
          <div key={k} className="r-row"><span>{k.toUpperCase()}</span><span>{m(val)}</span></div>
        ))}
        <hr />
        <div className="r-row"><span>Float</span><span>{m(shift.openingFloat)}</span></div>
        <div className="r-row"><span>Payouts</span><span>{m(sum.payouts)}</span></div>
        <div className="r-row"><span>Expected cash</span><span>{m(shift.expectedCash ?? 0)}</span></div>
        <div className="r-row"><span>Counted cash</span><span>{m(shift.countedCash ?? 0)}</span></div>
        <div className="r-row r-total"><span>Over / short</span><span>{m(v)}</span></div>
      </div>
      <button className="btn" onClick={() => window.print()}>Print Z-report</button>
    </div>
  );
}
