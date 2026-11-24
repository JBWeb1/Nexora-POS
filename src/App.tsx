import { useEffect, useState, type ReactNode } from 'react';
import { useStore } from './store';
import { can } from './lib/actions';
import { PinPad, useToast } from './components/ui';
import { Sell } from './screens/Sell';
import { SalesHistory } from './screens/SalesHistory';
import { ShiftScreen } from './screens/Shift';
import { StockChecker } from './screens/StockChecker';
import { PettyCash } from './screens/PettyCash';
import { BackOffice } from './screens/BackOffice';
import { Laybys } from './screens/Laybys';
import { Vouchers } from './screens/Vouchers';
import { ReceiveStock } from './screens/ReceiveStock';
import { Home, loadOrder, type AppTile } from './screens/Home';
import { InstallButton } from './components/InstallButton';
import { Icon } from './components/Icon';
import type { Role } from './types';

type Screen = 'home' | 'sell' | 'sales' | 'checker' | 'laybys' | 'vouchers' | 'receive' | 'petty' | 'shift' | 'backoffice';
type Layout = 'single' | 'tile';

const APPS: (AppTile & { id: Screen; min: Role })[] = [
  { id: 'sell', label: 'Sell', icon: 'cart', min: 'cashier', colors: ['#5ee27f', '#28b44d'] },
  { id: 'sales', label: 'Sales', icon: 'receipt', min: 'cashier', colors: ['#5ac8fa', '#007aff'] },
  { id: 'checker', label: 'Stock Checker', icon: 'scan', min: 'cashier', colors: ['#ffb340', '#ff8a00'] },
  { id: 'laybys', label: 'Lay-bys', icon: 'bag', min: 'cashier', colors: ['#64d2ff', '#0a84ff'] },
  { id: 'vouchers', label: 'Vouchers', icon: 'gift', min: 'cashier', colors: ['#ffd60a', '#ff9f0a'] },
  { id: 'receive', label: 'Receive Stock', icon: 'truck', min: 'supervisor', colors: ['#8e8e93', '#48484a'] },
  { id: 'petty', label: 'Petty Cash', icon: 'wallet', min: 'cashier', colors: ['#ff7aa8', '#ff2d55'] },
  { id: 'shift', label: 'Till', icon: 'cash', min: 'cashier', colors: ['#7bdcb5', '#00a389'] },
  { id: 'backoffice', label: 'Back Office', icon: 'building', min: 'supervisor', colors: ['#a78bfa', '#5856d6'] },
];

export function App() {
  const { user, setUserId, saveError } = useStore();
  const [panes, setPanes] = useState<Screen[]>(['home', 'checker']);
  const [layout, setLayout] = useState<Layout>('single');
  const [focus, setFocus] = useState(0);

  // Auto-lock after 10 minutes idle so the till isn't left logged in.
  useEffect(() => {
    if (!user) return;
    let t = setTimeout(() => setUserId(null), 10 * 60 * 1000);
    const bump = () => {
      clearTimeout(t);
      t = setTimeout(() => setUserId(null), 10 * 60 * 1000);
    };
    window.addEventListener('keydown', bump);
    window.addEventListener('pointerdown', bump);
    return () => {
      clearTimeout(t);
      window.removeEventListener('keydown', bump);
      window.removeEventListener('pointerdown', bump);
    };
  }, [user, setUserId]);

  if (!user) return <Login />;

  const apps = APPS.filter((a) => can(user, a.min));
  const allowed = (s: Screen) => s === 'home' || apps.some((a) => a.id === s);
  const visible = layout === 'tile' ? panes : [panes[0]];
  const safe = visible.map((s) => (allowed(s) ? s : 'home'));
  const active = safe[layout === 'tile' ? focus : 0];

  const open = (s: Screen) => {
    const i = layout === 'tile' ? focus : 0;
    setPanes((p) => p.map((x, j) => (j === i ? s : x)));
  };

  const render = (s: Screen): ReactNode => {
    switch (s) {
      case 'home': return <Home tiles={loadOrder(user.id, apps)} onOpen={(id) => open(id as Screen)} />;
      case 'sell': return <Sell />;
      case 'sales': return <SalesHistory />;
      case 'checker': return <StockChecker />;
      case 'laybys': return <Laybys />;
      case 'vouchers': return <Vouchers />;
      case 'receive': return <ReceiveStock />;
      case 'petty': return <PettyCash />;
      case 'shift': return <ShiftScreen />;
      case 'backoffice': return <BackOffice />;
    }
  };

  return (
    <div className="app">
      <nav className="nav">
        <div className="brand">N</div>
        <button className={`nav-btn ${active === 'home' ? 'active' : ''}`} onClick={() => open('home')}>
          <span className="nav-icon"><Icon name="home" /></span>
          <span>Home</span>
        </button>
        {apps.map((n) => (
          <button key={n.id} className={`nav-btn ${active === n.id ? 'active' : ''}`} onClick={() => open(n.id)}>
            <span className="nav-icon"><Icon name={n.icon} /></span>
            <span>{n.label}</span>
          </button>
        ))}
        <div className="nav-spacer" />
        <div className="window-switch" role="group" aria-label="Window layout">
          <button className={layout === 'single' ? 'on' : ''} title="Cascade — one full screen" aria-label="Cascade" onClick={() => setLayout('single')}>
            <Icon name="cascade" size={18} />
          </button>
          <button
            className={layout === 'tile' ? 'on' : ''}
            title="Tile — two screens side by side"
            aria-label="Tile"
            onClick={() => {
              setLayout('tile');
              setFocus(0);
            }}
          >
            <Icon name="tile" size={18} />
          </button>
        </div>
        <InstallButton />
        <div className="nav-user" title={`${user.name} (${user.role})`}>
          <span className="avatar">{user.name.slice(0, 1).toUpperCase()}</span>
          <span>{user.name}</span>
        </div>
        <button className="nav-btn" onClick={() => setUserId(null)}>
          <span className="nav-icon"><Icon name="lock" /></span>
          <span>Lock</span>
        </button>
      </nav>
      <div className={`workspace ${layout}`}>
        {saveError && <div className="save-error">Could not save to the database: {saveError}</div>}
        <div className="panes">
          {safe.map((s, i) => (
            <main
              key={i}
              className={`main ${layout === 'tile' && focus === i ? 'focused' : ''}`}
              onPointerDownCapture={() => setFocus(i)}
            >
              {layout === 'tile' && (
                <div className="pane-bar">
                  <select
                    value={s}
                    onChange={(e) => setPanes((p) => p.map((x, j) => (j === i ? (e.target.value as Screen) : x)))}
                    aria-label={`Pane ${i + 1} screen`}
                  >
                    <option value="home">Home</option>
                    {apps.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
                  </select>
                  <button
                    className="icon-btn"
                    title="Close this tile"
                    aria-label="Close tile"
                    onClick={() => {
                      // Keep the other pane as the full-screen view.
                      setPanes((p) => (i === 0 ? [p[1], p[0]] : p));
                      setFocus(0);
                      setLayout('single');
                    }}
                  >
                    <Icon name="close" size={14} />
                  </button>
                </div>
              )}
              <div className="pane-body">{render(s)}</div>
            </main>
          ))}
        </div>
      </div>
    </div>
  );
}

function Login() {
  const { state, setUserId } = useStore();
  const toast = useToast();
  const [pin, setPin] = useState('');
  const submit = (p: string) => {
    const s = state.staff.find((x) => x.active && x.pin === p);
    if (s) setUserId(s.id);
    else {
      toast('Wrong passcode', 'error');
      setPin('');
    }
  };
  return (
    <div className="login">
      <div className="login-card">
        <div className="brand big-brand">N</div>
        <h1>Nexora POS</h1>
        <p className="muted">{state.settings.businessName} · Enter your passcode</p>
        <PinPad value={pin} onChange={setPin} onSubmit={submit} />
        {state.sales.length === 0 && (
          <p className="muted small">Demo PINs — Manager 1234 · Supervisor 2222 · Cashier 1111</p>
        )}
      </div>
    </div>
  );
}
