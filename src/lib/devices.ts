import { useEffect, useRef } from 'react';

/* ---------------- Barcode scanners (Mindeo, Honeywell, Zebra, Datalogic, generic) ----------------
 * Almost every USB / Bluetooth scanner — including Mindeo models — ships in "USB HID keyboard" mode:
 * it "types" the barcode very fast and presses Enter. We tell a scanner apart from a person by speed,
 * so a scan works even when the search box isn't focused.
 */

export interface ScannerOptions {
  /** Max average ms between characters to count as a scanner (people type ~100ms+). */
  maxInterval?: number;
  minLength?: number;
  /** Character the scanner sends after the code ('Enter' default; some are set to 'Tab'). */
  suffix?: 'Enter' | 'Tab';
  enabled?: boolean;
}

/** Listens globally for scanner bursts and calls onScan(code). */
export function useBarcodeScanner(onScan: (code: string) => void, opts: ScannerOptions = {}) {
  const { maxInterval = 35, minLength = 4, suffix = 'Enter', enabled = true } = opts;
  const buf = useRef<{ chars: string; first: number; last: number }>({ chars: '', first: 0, last: 0 });
  const cb = useRef(onScan);
  cb.current = onScan;

  useEffect(() => {
    if (!enabled) return;
    const h = (e: KeyboardEvent) => {
      const now = performance.now();
      const b = buf.current;
      if (e.key === suffix) {
        const avg = b.chars.length > 1 ? (b.last - b.first) / (b.chars.length - 1) : Infinity;
        if (b.chars.length >= minLength && avg <= maxInterval) {
          e.preventDefault();
          e.stopPropagation();
          // If the scan landed in a text field, take it back out of the field.
          const el = document.activeElement as HTMLInputElement | null;
          if (el && 'value' in el && typeof el.value === 'string' && el.value.endsWith(b.chars)) {
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
            setter?.call(el, el.value.slice(0, -b.chars.length));
            el.dispatchEvent(new Event('input', { bubbles: true }));
          }
          cb.current(b.chars);
        }
        buf.current = { chars: '', first: 0, last: 0 };
        return;
      }
      if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return;
      if (b.chars && now - b.last > 120) b.chars = ''; // too slow: a person is typing, start over
      if (!b.chars) b.first = now;
      b.chars += e.key;
      b.last = now;
    };
    // Capture phase so we see the burst before inputs handle Enter.
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, [enabled, maxInterval, minLength, suffix]);
}

/* ---------------- Card terminals ----------------
 * A CardTerminal takes an amount and resolves when the customer's card is approved or declined.
 * "standalone" works with ANY terminal (Verifone, Yoco, Ingenico, PAX, bank speedpoints): the cashier keys
 * the amount on the terminal and confirms the result in Nexora, so declined cards are never rung up as paid.
 * Integrated drivers (e.g. Verifone semi-integrated) plug in here once the provider issues API access.
 */

export type TerminalProvider = 'standalone' | 'simulator' | 'verifone';

export interface TerminalConfig {
  provider: TerminalProvider;
  /** IP / hostname of an integrated terminal or its local gateway */
  host: string;
  port: number;
  terminalId: string;
}

export interface CardResult {
  approved: boolean;
  /** Auth code, last 4 digits etc, printed on the receipt */
  reference?: string;
  message?: string;
}

export const DEFAULT_TERMINAL: TerminalConfig = { provider: 'standalone', host: '', port: 0, terminalId: '' };

export const PROVIDERS: { id: TerminalProvider; name: string; blurb: string; ready: boolean }[] = [
  {
    id: 'standalone',
    name: 'Standalone terminal (any brand)',
    blurb: 'Verifone, Yoco, Ingenico, PAX or your bank speedpoint. Key the amount on the terminal, then confirm Approved / Declined here.',
    ready: true,
  },
  {
    id: 'verifone',
    name: 'Verifone — integrated',
    blurb: 'Sends the amount straight to the Verifone terminal. Needs Verifone semi-integration access from your Verifone reseller or bank; until it is set up, payments fall back to standalone confirmation.',
    ready: false,
  },
  { id: 'simulator', name: 'Test simulator', blurb: 'Practice and training mode: approves after 1.5s. Amounts ending in .13 are declined.', ready: true },
];

export async function chargeCard(cfg: TerminalConfig, amountCents: number): Promise<CardResult | 'confirm'> {
  switch (cfg.provider) {
    case 'simulator':
      await new Promise((r) => setTimeout(r, 1500));
      return amountCents % 100 === 13
        ? { approved: false, message: 'Declined (simulated)' }
        : { approved: true, reference: `SIM${Math.floor(100000 + Math.random() * 900000)}` };
    case 'verifone':
    case 'standalone':
    default:
      // Not yet integrated: the cashier confirms what the terminal says.
      return 'confirm';
  }
}
