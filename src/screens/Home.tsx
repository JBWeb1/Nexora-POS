import { useState } from 'react';
import { useStore } from '../store';
import { Icon } from '../components/Icon';
import { formatMoney } from '../lib/money';
import { currentShift, pettyBalance } from '../lib/actions';

export interface AppTile {
  id: string;
  label: string;
  icon: string;
  /** iOS-style gradient for the app icon */
  colors: [string, string];
}

const orderKey = (staffId: string) => `nexora-home-order-${staffId}`;

export function loadOrder(staffId: string, tiles: AppTile[]): AppTile[] {
  let saved: string[] = [];
  try {
    saved = JSON.parse(localStorage.getItem(orderKey(staffId)) ?? '[]');
  } catch {
    /* ignore */
  }
  const byId = new Map(tiles.map((t) => [t.id, t]));
  const ordered = saved.map((id) => byId.get(id)).filter((t): t is AppTile => !!t);
  return [...ordered, ...tiles.filter((t) => !saved.includes(t.id))];
}

function saveOrder(staffId: string, tiles: AppTile[]) {
  try {
    localStorage.setItem(orderKey(staffId), JSON.stringify(tiles.map((t) => t.id)));
  } catch {
    /* ignore */
  }
}

/** Springboard-style home screen. "Arrange Icons" lets each staff member order their apps. */
export function Home({ tiles, onOpen }: { tiles: AppTile[]; onOpen: (id: string) => void }) {
  const { state, user } = useStore();
  const [order, setOrder] = useState(() => loadOrder(user!.id, tiles));
  const [arranging, setArranging] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const m = (c: number) => formatMoney(c, state.settings.currency);

  const commit = (next: AppTile[]) => {
    setOrder(next);
    saveOrder(user!.id, next);
  };
  const moveTo = (fromId: string, toId: string) => {
    if (fromId === toId) return;
    const next = [...order];
    const from = next.findIndex((t) => t.id === fromId);
    const [item] = next.splice(from, 1);
    next.splice(next.findIndex((t) => t.id === toId), 0, item);
    commit(next);
  };
  const nudge = (id: string, dir: -1 | 1) => {
    const i = order.findIndex((t) => t.id === id);
    const j = i + dir;
    if (j < 0 || j >= order.length) return;
    const next = [...order];
    [next[i], next[j]] = [next[j], next[i]];
    commit(next);
  };

  const today = new Date().toISOString().slice(0, 10);
  const todaySales = state.sales.filter((s) => s.createdAt.slice(0, 10) === today);
  const takings = todaySales.reduce((a, s) => a + s.totals.total, 0);
  const shift = currentShift(state);
  const low = state.products.filter((p) => p.active && p.stock <= p.reorderLevel).length;
  const hour = new Date().getHours();

  return (
    <div className="page home">
      <div className="page-head">
        <div>
          <div className="muted">{new Date().toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
          <h1>Good {hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening'}, {user!.name}</h1>
        </div>
        <div className="row">
          {arranging && (
            <>
              <button className="btn" onClick={() => commit([...order].sort((a, b) => a.label.localeCompare(b.label)))}>Sort A–Z</button>
              <button className="btn" onClick={() => commit(tiles)}>Reset</button>
            </>
          )}
          <button className={`btn ${arranging ? 'primary' : ''}`} onClick={() => setArranging(!arranging)}>
            {arranging ? 'Done' : 'Arrange Icons'}
          </button>
        </div>
      </div>

      <div className="widgets">
        <div className="stat"><div className="muted small">Today's takings</div><b>{m(takings)}</b><div className="muted small">{todaySales.filter((s) => !s.refundOf).length} sales</div></div>
        <div className="stat"><div className="muted small">Till</div><b className={shift ? 'ok-text' : ''}>{shift ? 'Open' : 'Closed'}</b>
          <div className="muted small">{shift ? `since ${new Date(shift.openedAt).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })}` : 'open it from Sell'}</div></div>
        <div className={`stat ${low ? 'warn' : ''}`}><div className="muted small">Low stock items</div><b>{low}</b></div>
        <div className="stat"><div className="muted small">Petty cash</div><b>{m(pettyBalance(state))}</b></div>
      </div>

      <div className={`springboard ${arranging ? 'arranging' : ''}`}>
        {order.map((t, i) => (
          <div
            key={t.id}
            className={`app-icon ${dragId === t.id ? 'dragging' : ''}`}
            draggable={arranging}
            onDragStart={() => setDragId(t.id)}
            onDragEnd={() => setDragId(null)}
            onDragOver={(e) => {
              e.preventDefault();
              if (dragId) moveTo(dragId, t.id);
            }}
            style={{ animationDelay: `${(i % 3) * -0.08}s` }}
          >
            <button
              className="app-glyph"
              style={{ background: `linear-gradient(160deg, ${t.colors[0]}, ${t.colors[1]})` }}
              onClick={() => !arranging && onOpen(t.id)}
              aria-label={t.label}
            >
              <Icon name={t.icon} size={34} />
            </button>
            <span className="app-label">{t.label}</span>
            {arranging && (
              <div className="nudge">
                <button className="icon-btn" aria-label={`Move ${t.label} left`} onClick={() => nudge(t.id, -1)}><Icon name="back" size={14} /></button>
                <button className="icon-btn flip" aria-label={`Move ${t.label} right`} onClick={() => nudge(t.id, 1)}><Icon name="back" size={14} /></button>
              </div>
            )}
          </div>
        ))}
      </div>
      {arranging && <p className="muted small center">Drag icons to rearrange them, or use the arrows. Your layout is saved for you only.</p>}
    </div>
  );
}
