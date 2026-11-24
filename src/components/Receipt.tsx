import type { Sale } from '../types';
import { useStore } from '../store';
import { formatMoney, lineTotal } from '../lib/money';

const METHOD_LABEL = { cash: 'Cash', card: 'Card', eft: 'EFT', account: 'Account' } as const;

export function Receipt({ sale }: { sale: Sale }) {
  const { state } = useStore();
  const { settings } = state;
  const m = (c: number) => formatMoney(c, settings.currency);
  const staff = state.staff.find((s) => s.id === sale.staffId);
  const customer = state.customers.find((c) => c.id === sale.customerId);
  const orig = sale.refundOf ? state.sales.find((s) => s.id === sale.refundOf) : undefined;

  return (
    <div className="receipt" id="print-receipt">
      <div className="center">
        <b>{settings.businessName}</b>
        <div>{settings.address}</div>
        <div>VAT No: {settings.vatNumber}</div>
        <div className="r-title">{sale.refundOf ? 'REFUND' : 'TAX INVOICE'}</div>
      </div>
      <div className="r-row">
        <span>#{sale.number}</span>
        <span>{new Date(sale.createdAt).toLocaleString('en-ZA')}</span>
      </div>
      <div>Served by: {staff?.name ?? '—'}</div>
      {customer && <div>Customer: {customer.name}</div>}
      {orig && <div>Refund of #{orig.number}</div>}
      <hr />
      {sale.lines.map((l, i) => (
        <div key={i}>
          <div>
            {l.name}
            {l.vatExempt ? ' (Z)' : ''}
          </div>
          <div className="r-row">
            <span>
              {l.qty} × {m(l.unitPrice)}
              {l.discountPct > 0 ? ` −${+l.discountPct.toFixed(1)}%` : ''}
            </span>
            <span>{m(lineTotal(l))}</span>
          </div>
        </div>
      ))}
      <hr />
      {sale.totals.discount !== 0 && (
        <div className="r-row">
          <span>Discount</span>
          <span>{m(-sale.totals.discount)}</span>
        </div>
      )}
      <div className="r-row r-total">
        <span>TOTAL</span>
        <span>{m(sale.totals.total)}</span>
      </div>
      <div className="r-row">
        <span>Incl. VAT @ {settings.vatRate}%</span>
        <span>{m(sale.totals.vat)}</span>
      </div>
      <hr />
      {sale.payments.map((p, i) => (
        <div className="r-row" key={i}>
          <span>
            {METHOD_LABEL[p.method]}
            {p.reference ? ` (${p.reference})` : ''}
          </span>
          <span>{m(p.amount)}</span>
        </div>
      ))}
      {sale.change > 0 && (
        <div className="r-row">
          <span>Change</span>
          <span>{m(sale.change)}</span>
        </div>
      )}
      {customer && !sale.refundOf && <div>Loyalty points balance: {customer.loyaltyPoints}</div>}
      {sale.note && <div>Note: {sale.note}</div>}
      <div className="center r-footer">{settings.receiptFooter}</div>
      <div className="center muted small">(Z) = zero-rated / VAT exempt</div>
    </div>
  );
}
