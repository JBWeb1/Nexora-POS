import { useMemo, useState } from 'react';
import { useStore } from '../store';
import { formatMoney, lineTotal } from '../lib/money';

type Range = 'today' | '7d' | '30d';

export function Reports() {
  const { state } = useStore();
  const m = (c: number) => formatMoney(c, state.settings.currency);
  const [range, setRange] = useState<Range>('today');

  const data = useMemo(() => {
    const now = new Date();
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    if (range === '7d') start.setDate(start.getDate() - 6);
    if (range === '30d') start.setDate(start.getDate() - 29);
    const sales = state.sales.filter((s) => new Date(s.createdAt) >= start);
    const cost = new Map(state.products.map((p) => [p.id, p.cost]));

    let revenue = 0, exVat = 0, cogs = 0, count = 0;
    const byProduct = new Map<string, { name: string; qty: number; total: number }>();
    const byHour = new Array(24).fill(0) as number[];
    const byDay = new Map<string, number>();
    const byStaff = new Map<string, number>();

    for (const s of sales) {
      revenue += s.totals.total;
      exVat += s.totals.exVat;
      if (!s.refundOf) count++;
      const d = new Date(s.createdAt);
      byHour[d.getHours()] += s.totals.total;
      const key = s.createdAt.slice(0, 10);
      byDay.set(key, (byDay.get(key) ?? 0) + s.totals.total);
      byStaff.set(s.staffId, (byStaff.get(s.staffId) ?? 0) + s.totals.total);
      for (const l of s.lines) {
        cogs += (cost.get(l.productId) ?? 0) * l.qty;
        const e = byProduct.get(l.productId) ?? { name: l.name, qty: 0, total: 0 };
        e.qty += l.qty;
        e.total += lineTotal(l);
        byProduct.set(l.productId, e);
      }
    }
    const top = [...byProduct.values()].sort((a, b) => b.total - a.total).slice(0, 10);
    const days: [string, number][] = [];
    for (let d = new Date(start); d <= now; d.setDate(d.getDate() + 1)) {
      const k = d.toISOString().slice(0, 10);
      days.push([k, byDay.get(k) ?? 0]);
    }
    return { revenue, exVat, cogs, count, top, byHour, days, byStaff };
  }, [state, range]);

  const gp = data.exVat - data.cogs;
  const maxHour = Math.max(1, ...data.byHour);
  const maxDay = Math.max(1, ...data.days.map((d) => d[1]));
  const low = state.products.filter((p) => p.active && p.stock <= p.reorderLevel);

  return (
    <div className="page">
      <div className="page-head">
        <h1>Dashboard</h1>
        <div className="chips">
          {(['today', '7d', '30d'] as Range[]).map((r) => (
            <button key={r} className={`chip ${range === r ? 'active' : ''}`} onClick={() => setRange(r)}>
              {r === 'today' ? 'Today' : r === '7d' ? 'Last 7 days' : 'Last 30 days'}
            </button>
          ))}
        </div>
      </div>

      <div className="stats">
        <div className="stat"><div className="muted small">Takings (incl. VAT)</div><b>{m(data.revenue)}</b></div>
        <div className="stat"><div className="muted small">Transactions</div><b>{data.count}</b></div>
        <div className="stat"><div className="muted small">Average sale</div><b>{m(data.count ? Math.round(data.revenue / data.count) : 0)}</b></div>
        <div className="stat"><div className="muted small">Gross profit (ex VAT)</div><b>{m(gp)}</b>
          <div className="muted small">{data.exVat ? Math.round((gp / data.exVat) * 100) : 0}% margin</div></div>
      </div>

      <div className="two-col">
        <div className="card">
          <h3>{range === 'today' ? 'Sales by hour' : 'Sales by day'}</h3>
          <div className="bars">
            {range === 'today'
              ? data.byHour.map((v, h) =>
                  h >= 6 && h <= 21 ? (
                    <div key={h} className="bar-col" title={`${h}:00 — ${m(v)}`}>
                      <div className="bar" style={{ height: `${(v / maxHour) * 100}%` }} />
                      <span>{h}</span>
                    </div>
                  ) : null,
                )
              : data.days.map(([d, v]) => (
                  <div key={d} className="bar-col" title={`${d} — ${m(v)}`}>
                    <div className="bar" style={{ height: `${(v / maxDay) * 100}%` }} />
                    <span>{d.slice(8)}</span>
                  </div>
                ))}
          </div>
        </div>
        <div className="card">
          <h3>Top sellers</h3>
          {data.top.length === 0 && <p className="muted">No sales yet in this period.</p>}
          {data.top.map((t) => (
            <div key={t.name} className="t-row">
              <span>{t.name} <span className="muted small">× {t.qty}</span></span>
              <span>{m(t.total)}</span>
            </div>
          ))}
        </div>
        <div className="card">
          <h3>Sales by staff</h3>
          {[...data.byStaff.entries()].map(([id, v]) => (
            <div key={id} className="t-row">
              <span>{state.staff.find((s) => s.id === id)?.name ?? 'Unknown'}</span>
              <span>{m(v)}</span>
            </div>
          ))}
          {data.byStaff.size === 0 && <p className="muted">—</p>}
        </div>
        <div className="card">
          <h3>Needs reordering</h3>
          {low.length === 0 && <p className="muted">All stock levels healthy ✓</p>}
          {low.map((p) => (
            <div key={p.id} className="t-row">
              <span>{p.name}</span>
              <span className="warn-text">{p.stock} left</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
