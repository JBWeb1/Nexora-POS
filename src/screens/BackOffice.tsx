import { useState, type ReactNode } from 'react';
import { useStore } from '../store';
import { can } from '../lib/actions';
import type { Role } from '../types';
import { Reports } from './Reports';
import { Products } from './Products';
import { Customers } from './Customers';
import { Settings } from './Settings';
import { Devices } from './Devices';

type Tab = 'dashboard' | 'products' | 'customers' | 'devices' | 'settings';

const TABS: { id: Tab; label: string; min: Role }[] = [
  { id: 'dashboard', label: 'Dashboard', min: 'supervisor' },
  { id: 'products', label: 'Products', min: 'supervisor' },
  { id: 'customers', label: 'Customers', min: 'supervisor' },
  { id: 'devices', label: 'Devices', min: 'manager' },
  { id: 'settings', label: 'Settings', min: 'manager' },
];

/** Everything managers need, kept away from the busy counter screens. */
export function BackOffice() {
  const { user } = useStore();
  const [tab, setTab] = useState<Tab>('dashboard');
  const tabs = TABS.filter((t) => can(user, t.min));
  const views: Record<Tab, ReactNode> = {
    dashboard: <Reports />,
    products: <Products />,
    customers: <Customers />,
    devices: <Devices />,
    settings: <Settings />,
  };
  return (
    <div>
      <div className="backoffice-bar">
        <span className="bo-title">Back Office</span>
        <div className="segmented" role="tablist">
          {tabs.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
      </div>
      {views[tab]}
    </div>
  );
}
