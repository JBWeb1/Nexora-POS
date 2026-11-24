import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import type { AppState, Role, Settings as S, Staff } from '../types';
import { audit } from '../lib/actions';
import { uid } from '../lib/id';
import { Field, Modal, downloadFile, useApproval, useToast } from '../components/ui';
import { desktop } from '../lib/persistence';
import { migrate } from '../lib/seed';

export function Settings() {
  const { state, update, user, reset, replace, storage } = useStore();
  const [dbPath, setDbPath] = useState('');
  useEffect(() => {
    desktop?.info().then((i) => setDbPath(i.path));
  }, []);
  const toast = useToast();
  const approve = useApproval();
  const [s, setS] = useState<S>(state.settings);
  const [editing, setEditing] = useState<Staff | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const save = () => {
    update((d) => {
      d.settings = { ...s, vatRate: Number(s.vatRate), cashierMaxDiscount: Number(s.cashierMaxDiscount), loyaltyRandPerPoint: Math.max(1, Number(s.loyaltyRandPerPoint)) };
      audit(d, user!.id, 'settings', 'Updated settings');
    });
    toast('Settings saved');
  };

  const backup = () => {
    downloadFile(`nexora-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(state, null, 2), 'application/json');
  };

  const restore = async (file: File) => {
    try {
      const data = JSON.parse(await file.text()) as AppState;
      if (!Array.isArray(data.products) || !Array.isArray(data.sales) || !data.settings) throw new Error('bad');
      const ok = await approve('Restore backup — this replaces ALL current data', 'manager');
      if (!ok) return;
      replace(migrate(data));
      toast('Backup restored');
    } catch {
      toast('That file is not a valid Nexora backup', 'error');
    }
  };

  return (
    <div className="page">
      <h1>Settings</h1>

      <div className="two-col">
        <div className="card">
          <h3>Business & receipts</h3>
          <Field label="Business name"><input value={s.businessName} onChange={(e) => setS({ ...s, businessName: e.target.value })} /></Field>
          <Field label="Address"><input value={s.address} onChange={(e) => setS({ ...s, address: e.target.value })} /></Field>
          <Field label="VAT number"><input value={s.vatNumber} onChange={(e) => setS({ ...s, vatNumber: e.target.value })} /></Field>
          <Field label="Receipt footer"><input value={s.receiptFooter} onChange={(e) => setS({ ...s, receiptFooter: e.target.value })} /></Field>
          <div className="form-grid">
            <Field label="VAT rate %"><input inputMode="decimal" value={s.vatRate} onChange={(e) => setS({ ...s, vatRate: e.target.value as unknown as number })} /></Field>
            <Field label="Cashier max discount %"><input inputMode="decimal" value={s.cashierMaxDiscount} onChange={(e) => setS({ ...s, cashierMaxDiscount: e.target.value as unknown as number })} /></Field>
            <Field label="Rand spent per loyalty point"><input inputMode="numeric" value={s.loyaltyRandPerPoint} onChange={(e) => setS({ ...s, loyaltyRandPerPoint: e.target.value as unknown as number })} /></Field>
          </div>
          <button className="btn primary" onClick={save}>Save settings</button>
        </div>

        <div className="card">
          <div className="row-between">
            <h3>Staff & PINs</h3>
            <button className="btn small-btn" onClick={() => setEditing({ id: '', name: '', pin: '', role: 'cashier', active: true })}>+ Add staff</button>
          </div>
          {state.staff.map((st) => (
            <div key={st.id} className="t-row">
              <span>
                {st.name} <span className="tag">{st.role}</span> {!st.active && <span className="tag warn">disabled</span>}
              </span>
              <button className="btn small-btn" onClick={() => setEditing(st)}>Edit</button>
            </div>
          ))}
          <p className="muted small">
            <b>Cashier</b>: sell, park, customers. <b>Supervisor</b>: approve voids, refunds, price changes, big discounts, close till, edit products.
            <b> Manager</b>: everything incl. staff, settings, credit limits.
          </p>
        </div>

        <div className="card">
          <h3>Data & backup</h3>
          {storage === 'sqlite' ? (
            <>
              <p className="small">
                Saved in an <b>SQLite database</b> on this PC, with an automatic daily copy kept for 30 days.
              </p>
              <p className="muted small" style={{ wordBreak: 'break-all' }}>{dbPath}</p>
              <button className="btn" onClick={() => desktop?.openDataFolder()}>Open data folder</button>
            </>
          ) : (
            <p className="muted small">
              Running in a browser: data is kept in this browser only. Install the desktop app to use the SQLite database.
            </p>
          )}
          <p className="muted small">Also download a backup regularly and keep it off this computer (USB / cloud).</p>
          <div className="row">
            <button className="btn" onClick={backup}>Download backup</button>
            <button className="btn" onClick={() => fileRef.current?.click()}>Restore backup…</button>
            <input ref={fileRef} type="file" accept="application/json" hidden onChange={(e) => e.target.files?.[0] && restore(e.target.files[0])} />
          </div>
          <hr />
          <button
            className="btn danger-outline"
            onClick={async () => {
              if (!confirm('Erase everything and reload the demo data?')) return;
              const ok = await approve('Factory reset — erases all sales, products and customers', 'manager');
              if (ok) reset();
            }}
          >
            Factory reset (demo data)
          </button>
        </div>

        <div className="card">
          <h3>Audit log</h3>
          <div className="audit">
            {state.audit.slice(0, 50).map((a) => (
              <div key={a.id} className="small t-row">
                <span>
                  <b>{a.action.replace(/_/g, ' ')}</b> · {state.staff.find((x) => x.id === a.staffId)?.name} · <span className="muted">{a.detail}</span>
                </span>
                <span className="muted">{new Date(a.at).toLocaleString('en-ZA')}</span>
              </div>
            ))}
            {state.audit.length === 0 && <p className="muted">Nothing logged yet.</p>}
          </div>
        </div>
      </div>

      {editing && <StaffForm staff={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function StaffForm({ staff, onClose }: { staff: Staff; onClose: () => void }) {
  const { state, update, user } = useStore();
  const toast = useToast();
  const [st, setSt] = useState(staff);
  const save = () => {
    if (!st.name.trim()) return toast('Name required', 'error');
    if (!/^\d{4,8}$/.test(st.pin)) return toast('PIN must be 4–8 digits', 'error');
    if (state.staff.some((x) => x.id !== st.id && x.pin === st.pin)) return toast('That PIN is already in use', 'error');
    const managers = state.staff.filter((x) => x.role === 'manager' && x.active && x.id !== st.id);
    if (staff.role === 'manager' && (st.role !== 'manager' || !st.active) && managers.length === 0)
      return toast('You need at least one active manager', 'error');
    update((d) => {
      if (!st.id) d.staff.push({ ...st, id: uid() });
      else d.staff = d.staff.map((x) => (x.id === st.id ? st : x));
      audit(d, user!.id, 'staff', `${st.id ? 'Edited' : 'Added'} ${st.name} (${st.role})`);
    });
    toast('Staff saved');
    onClose();
  };
  return (
    <Modal title={st.id ? `Edit ${staff.name}` : 'Add staff member'} onClose={onClose}>
      <Field label="Name"><input autoFocus value={st.name} onChange={(e) => setSt({ ...st, name: e.target.value })} /></Field>
      <Field label="PIN (4–8 digits)"><input inputMode="numeric" value={st.pin} onChange={(e) => setSt({ ...st, pin: e.target.value.replace(/\D/g, '') })} /></Field>
      <Field label="Role">
        <select value={st.role} onChange={(e) => setSt({ ...st, role: e.target.value as Role })}>
          <option value="cashier">Cashier</option>
          <option value="supervisor">Supervisor</option>
          <option value="manager">Manager</option>
        </select>
      </Field>
      <label><input type="checkbox" checked={st.active} onChange={(e) => setSt({ ...st, active: e.target.checked })} /> Active</label>
      <div className="row-between"><span /><button className="btn primary" onClick={save}>Save</button></div>
    </Modal>
  );
}
