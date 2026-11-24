import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Role, Staff } from '../types';
import { useStore } from '../store';
import { ROLE_RANK } from '../lib/actions';
import { Icon } from './Icon';

export function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="close" size={16} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

/* ---------- Toasts ---------- */

type ToastKind = 'ok' | 'error' | 'info';
interface ToastMsg {
  id: number;
  kind: ToastKind;
  text: string;
}
const ToastCtx = createContext<(text: string, kind?: ToastKind) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

/* ---------- Manager approval (PIN override) ---------- */

interface ApprovalReq {
  reason: string;
  min: Role;
  resolve: (s: Staff | null) => void;
}
const ApprovalCtx = createContext<(reason: string, min?: Role) => Promise<Staff | null>>(async () => null);

/**
 * Ask for approval. If the logged-in user already has the required role, approve instantly
 * (no annoying popups for managers) — otherwise prompt for a supervisor/manager PIN.
 */
export const useApproval = () => useContext(ApprovalCtx);

export function UiProvider({ children }: { children: ReactNode }) {
  const { user } = useStore();
  const [toasts, setToasts] = useState<ToastMsg[]>([]);
  const [req, setReq] = useState<ApprovalReq | null>(null);
  const nextId = useRef(1);

  const toast = useCallback((text: string, kind: ToastKind = 'ok') => {
    const id = nextId.current++;
    setToasts((t) => [...t, { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 5000 : 2500);
  }, []);

  const approve = useCallback(
    (reason: string, min: Role = 'supervisor') => {
      if (user && ROLE_RANK[user.role] >= ROLE_RANK[min]) return Promise.resolve(user);
      return new Promise<Staff | null>((resolve) => setReq({ reason, min, resolve }));
    },
    [user],
  );

  return (
    <ToastCtx.Provider value={toast}>
      <ApprovalCtx.Provider value={approve}>
        {children}
        {req && (
          <ApprovalModal
            req={req}
            onDone={(s) => {
              req.resolve(s);
              setReq(null);
            }}
          />
        )}
        <div className="toasts" aria-live="polite">
          {toasts.map((t) => (
            <div key={t.id} className={`toast toast-${t.kind}`}>
              {t.text}
            </div>
          ))}
        </div>
      </ApprovalCtx.Provider>
    </ToastCtx.Provider>
  );
}

function ApprovalModal({ req, onDone }: { req: ApprovalReq; onDone: (s: Staff | null) => void }) {
  const { state } = useStore();
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');
  const submit = (p = pin) => {
    const s = state.staff.find((x) => x.active && x.pin === p);
    if (s && ROLE_RANK[s.role] >= ROLE_RANK[req.min]) onDone(s);
    else {
      setErr(s ? `${s.name} is not allowed to approve this` : 'Wrong PIN');
      setPin('');
    }
  };
  return (
    <Modal title="Approval needed" onClose={() => onDone(null)}>
      <p className="muted">{req.reason}</p>
      <p>
        A <b>{req.min}</b> or higher must enter their PIN.
      </p>
      <PinPad value={pin} onChange={setPin} onSubmit={submit} />
      {err && <p className="error">{err}</p>}
    </Modal>
  );
}

export function PinPad({
  value,
  onChange,
  onSubmit,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: (v: string) => void;
}) {
  // Keep the latest value in a ref so fast typing never drops digits between renders.
  const latest = useRef(value);
  latest.current = value;
  const set = useCallback(
    (v: string) => {
      latest.current = v;
      onChange(v);
    },
    [onChange],
  );
  const press = useCallback(
    (k: string) => {
      if (k === '⌫') set(latest.current.slice(0, -1));
      else if (k === 'OK') onSubmit(latest.current);
      else set((latest.current + k).slice(0, 8));
    },
    [set, onSubmit],
  );
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') press('⌫');
      else if (e.key === 'Enter') press('OK');
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [press]);
  return (
    <div className="pinpad">
      <div className="pin-display" aria-label={`${value.length} digits entered`}>
        {Array.from({ length: Math.max(4, value.length) }, (_, i) => (
          <span key={i} className={`pin-dot ${i < value.length ? 'on' : ''}`} />
        ))}
      </div>
      <div className="pin-grid">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', 'OK'].map((k) => (
          <button
            key={k}
            className={`pin-key ${k === '⌫' || k === 'OK' ? 'text' : ''}`}
            onClick={() => press(k)}
            aria-label={k === '⌫' ? 'Delete' : k === 'OK' ? 'Enter' : k}
          >
            {k === '⌫' ? 'Delete' : k === 'OK' ? 'Enter' : k}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

export function downloadCsv(filename: string, rows: (string | number)[][]) {
  const csv = rows
    .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
    .join('\n');
  downloadFile(filename, csv, 'text/csv');
}

export function downloadFile(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
