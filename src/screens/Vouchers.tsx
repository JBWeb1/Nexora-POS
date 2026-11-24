import { useState } from 'react';
import { useStore } from '../store';
import type { Customer, PaymentMethod, Voucher } from '../types';
import { formatMoney, parseMoney } from '../lib/money';
import { can, currentShift, issueVoucher, voidVoucher } from '../lib/actions';
import { Field, Modal, downloadCsv, useApproval, useToast } from '../components/ui';
import { CustomerPicker } from './Sell';
import { Icon } from '../components/Icon';

type Filter = 'active' | 'used' | 'all';

export function Vouchers() {
  const { state, user } = useStore();
  const m = (c: number) => formatMoney(c, state.settings.currency);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('active');
  const [issuing, setIssuing] = useState(false);
  const [view, setView] = useState<string | null>(null);

  const now = Date.now();
  const isLive = (v: Voucher) => v.status === 'active' && v.balance > 0 && new Date(v.expiresAt).getTime() > now;
  const list = state.vouchers
    .filter((v) => (filter === 'active' ? isLive(v) : filter === 'used' ? !isLive(v) : true))
    .filter((v) => `${v.code} ${v.code.replace(/-/g, '')} ${v.holderName} ${v.holderPhone}`.toLowerCase().includes(q.toLowerCase().trim()));
  const outstanding = state.vouchers.filter(isLive).reduce((a, v) => a + v.balance, 0);
  const selected = state.vouchers.find((v) => v.id === view);

  return (
    <div className="page">
      <div className="page-head">
        <h1>Gift Vouchers</h1>
        <div className="row">
          <button
            className="btn"
            onClick={() =>
              downloadCsv('vouchers.csv', [
                ['Code', 'For', 'Phone', 'Issued', 'Expires', 'Value', 'Balance', 'Status'],
                ...state.vouchers.map((v) => [v.code, v.holderName, v.holderPhone, v.createdAt.slice(0, 10), v.expiresAt.slice(0, 10), v.initial / 100, v.balance / 100, v.status]),
              ])
            }
          >
            Export CSV
          </button>
          <button className="btn primary" onClick={() => setIssuing(true)}>Sell a voucher</button>
        </div>
      </div>

      <div className="stats">
        <div className="stat"><div className="muted small">Live vouchers</div><b>{state.vouchers.filter(isLive).length}</b></div>
        <div className="stat"><div className="muted small">Value still to be spent</div><b>{m(outstanding)}</b></div>
      </div>

      <div className="row">
        <input className="search" placeholder="Scan or type a voucher code, or search a name" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="segmented">
          {(['active', 'used', 'all'] as Filter[]).map((f) => (
            <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>
              {f === 'active' ? 'Live' : f === 'used' ? 'Used / expired' : 'All'}
            </button>
          ))}
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead><tr><th>Code</th><th>For</th><th>Expires</th><th className="num">Value</th><th className="num">Balance</th><th></th></tr></thead>
          <tbody>
            {list.map((v) => (
              <tr key={v.id} className="click-row" onClick={() => setView(v.id)}>
                <td><code className="voucher-code">{v.code}</code>{v.status === 'void' && <span className="tag warn">void</span>}</td>
                <td>{v.holderName}<div className="muted small">{v.holderPhone}</div></td>
                <td className="small">{new Date(v.expiresAt).toLocaleDateString('en-ZA')}</td>
                <td className="num">{m(v.initial)}</td>
                <td className="num"><b>{m(v.balance)}</b></td>
                <td className="actions"><button className="btn small-btn">View</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {list.length === 0 && <p className="muted pad">No vouchers here.</p>}
      </div>

      {issuing && <IssueVoucher onClose={() => setIssuing(false)} onIssued={(id) => (setIssuing(false), setView(id))} />}
      {selected && <VoucherDetail voucher={selected} canVoid={can(user, 'manager')} onClose={() => setView(null)} />}
    </div>
  );
}

function IssueVoucher({ onClose, onIssued }: { onClose: () => void; onIssued: (id: string) => void }) {
  const { state, update, user } = useStore();
  const toast = useToast();
  const [value, setValue] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [picking, setPicking] = useState(false);
  const shiftOpen = !!currentShift(state);

  if (picking) {
    return (
      <CustomerPicker
        onPick={(c: Customer) => {
          setName(c.name);
          setPhone(c.phone);
          setPicking(false);
        }}
        onClose={() => setPicking(false)}
      />
    );
  }

  const issue = () => {
    try {
      const v = update((s) => issueVoucher(s, { staffId: user!.id, value: parseMoney(value), holderName: name, holderPhone: phone, method }));
      toast(`Voucher ${v.code} issued`);
      onIssued(v.id);
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  return (
    <Modal title="Sell a gift voucher" onClose={onClose}>
      {!shiftOpen && <p className="warn-text small">Open the till first (Sell screen) to take the payment.</p>}
      <div className="quick-row">
        {[10000, 20000, 50000, 100000].map((v) => (
          <button key={v} className={`btn tender ${parseMoney(value) === v ? 'primary' : ''}`} onClick={() => setValue((v / 100).toFixed(2))}>
            {formatMoney(v, state.settings.currency).replace('.00', '')}
          </button>
        ))}
      </div>
      <Field label="Value (R)">
        <input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder="Or type any amount" />
      </Field>
      <div className="form-grid">
        <Field label="For (name)"><input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Phone (optional)"><input value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
      </div>
      <button className="btn" onClick={() => setPicking(true)}>
        <Icon name="person" size={18} /> Pick or add a customer
      </button>
      <div className="method-tabs three">
        {(['cash', 'card', 'eft'] as PaymentMethod[]).map((x) => (
          <button key={x} className={`btn ${method === x ? 'primary' : ''}`} onClick={() => setMethod(x)}>
            {x === 'eft' ? 'EFT' : x[0].toUpperCase() + x.slice(1)}
          </button>
        ))}
      </div>
      <p className="muted small">Valid for 3 years, as required by the Consumer Protection Act. Can be spent in parts.</p>
      <button className="btn primary big" onClick={issue} disabled={!shiftOpen}>Take payment & issue voucher</button>
    </Modal>
  );
}

function VoucherDetail({ voucher: v, canVoid, onClose }: { voucher: Voucher; canVoid: boolean; onClose: () => void }) {
  const { state, update } = useStore();
  const approve = useApproval();
  const toast = useToast();
  const m = (c: number) => formatMoney(c, state.settings.currency);
  return (
    <Modal title="Gift voucher" onClose={onClose}>
      <div className="receipt" id="print-receipt">
        <div className="center">
          <b>{state.settings.businessName}</b>
          <div className="r-title">GIFT VOUCHER</div>
          <div className="voucher-value">{m(v.initial)}</div>
          <div>For: {v.holderName}</div>
          <div className="voucher-big-code">{v.code}</div>
          <div className="small">Valid until {new Date(v.expiresAt).toLocaleDateString('en-ZA')}</div>
        </div>
        <hr />
        <div className="r-row"><span>Balance left</span><b>{m(v.balance)}</b></div>
        {v.redemptions.map((r, i) => (
          <div key={i} className="r-row small">
            <span>Used {new Date(r.at).toLocaleDateString('en-ZA')} · #{state.sales.find((s) => s.id === r.saleId)?.number}</span>
            <span>−{m(r.amount)}</span>
          </div>
        ))}
        <div className="center small r-footer">Give this code at the till. Can be used in parts.</div>
      </div>
      <div className="row-between">
        <button className="btn" onClick={() => window.print()}>Print voucher</button>
        {canVoid && v.status === 'active' && (
          <button
            className="btn danger-outline"
            onClick={async () => {
              const reason = prompt('Why is this voucher being cancelled?') ?? '';
              if (!reason.trim()) return;
              const ok = await approve(`Cancel voucher ${v.code} with ${m(v.balance)} left`, 'manager');
              if (!ok) return;
              update((s) => voidVoucher(s, ok.id, v.id, reason));
              toast('Voucher cancelled');
            }}
          >
            Cancel voucher
          </button>
        )}
      </div>
    </Modal>
  );
}
