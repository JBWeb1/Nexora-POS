import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { audit } from '../lib/actions';
import { chargeCard, DEFAULT_TERMINAL, PROVIDERS, useBarcodeScanner, type TerminalConfig } from '../lib/devices';
import { desktop } from '../lib/persistence';
import { Field, useToast } from '../components/ui';

/** Hardware & integrations: barcode scanners, card terminals, receipt printer and the AI (MCP) connector. */
export function Devices() {
  const { state, update, user } = useStore();
  const toast = useToast();
  const [term, setTerm] = useState<TerminalConfig>(state.settings.terminal ?? DEFAULT_TERMINAL);
  const [suffix, setSuffix] = useState<'Enter' | 'Tab'>(state.settings.scannerSuffix ?? 'Enter');
  const [lastScan, setLastScan] = useState<{ code: string; at: Date } | null>(null);
  const [testing, setTesting] = useState(false);
  const [mcpJson, setMcpJson] = useState('');

  useBarcodeScanner((code) => setLastScan({ code, at: new Date() }), { suffix });

  useEffect(() => {
    if (desktop) {
      desktop.mcpConfig().then((c) => setMcpJson(JSON.stringify({ mcpServers: { 'nexora-pos': c } }, null, 2)));
    } else {
      setMcpJson(
        JSON.stringify(
          { mcpServers: { 'nexora-pos': { command: 'node', args: ['C:\\path\\to\\Nexora-POS\\mcp\\server.mjs', 'C:\\path\\to\\nexora.db'] } } },
          null,
          2,
        ),
      );
    }
  }, []);

  const save = () => {
    update((s) => {
      s.settings.terminal = term;
      s.settings.scannerSuffix = suffix;
      audit(s, user!.id, 'devices', `Terminal ${term.provider}, scanner suffix ${suffix}`);
    });
    toast('Device settings saved');
  };

  const testTerminal = async () => {
    setTesting(true);
    const r = await chargeCard(term, 100);
    setTesting(false);
    if (r === 'confirm') toast('Standalone mode: cashiers confirm Approved / Declined on each card payment', 'info');
    else toast(r.approved ? `Approved ${r.reference}` : r.message ?? 'Declined', r.approved ? 'ok' : 'error');
  };

  const scanned = lastScan && state.products.find((p) => p.barcode === lastScan.code || p.sku === lastScan.code);

  return (
    <div className="page">
      <h1>Devices & Integrations</h1>
      <div className="two-col">
        <div className="card">
          <h3>Barcode scanner</h3>
          <p className="small">
            Works with <b>Mindeo</b>, Honeywell, Zebra, Datalogic and any USB or Bluetooth scanner in <b>keyboard (HID) mode</b>, which is the
            factory default. Just plug it in. Scans are recognised anywhere on the Sell and Stock Checker screens.
          </p>
          <div className="scan-test">
            {lastScan ? (
              <>
                <div className="checker-price">{lastScan.code}</div>
                <div className={scanned ? 'ok-text' : 'warn-text'}>{scanned ? `✓ ${scanned.name}` : 'Scanner works — no product has this barcode yet'}</div>
              </>
            ) : (
              <div className="muted">Scan any barcode now to test your scanner</div>
            )}
          </div>
          <Field label="Scanner sends after each code">
            <select value={suffix} onChange={(e) => setSuffix(e.target.value as 'Enter' | 'Tab')}>
              <option value="Enter">Enter (default)</option>
              <option value="Tab">Tab</option>
            </select>
          </Field>
          <p className="muted small">
            Mindeo tip: if nothing appears, the scanner may be in USB-COM (serial) mode. Scan the “USB HID Keyboard” and “Add Enter suffix”
            setup codes in the Mindeo quick-start guide.
          </p>
        </div>

        <div className="card">
          <h3>Card machine</h3>
          <div className="list">
            {PROVIDERS.map((p) => (
              <label key={p.id} className="list-item provider">
                <span>
                  <b>{p.name}</b> {!p.ready && <span className="tag warn">needs setup</span>}
                  <div className="muted small">{p.blurb}</div>
                </span>
                <input type="checkbox" checked={term.provider === p.id} onChange={() => setTerm({ ...term, provider: p.id })} aria-label={p.name} />
              </label>
            ))}
          </div>
          {term.provider === 'verifone' && (
            <div className="form-grid">
              <Field label="Terminal IP address"><input value={term.host} onChange={(e) => setTerm({ ...term, host: e.target.value })} placeholder="192.168.1.50" /></Field>
              <Field label="Port"><input inputMode="numeric" value={term.port || ''} onChange={(e) => setTerm({ ...term, port: parseInt(e.target.value || '0', 10) })} /></Field>
              <Field label="Terminal ID"><input value={term.terminalId} onChange={(e) => setTerm({ ...term, terminalId: e.target.value })} /></Field>
            </div>
          )}
          <div className="row-between">
            <button className="btn" onClick={testTerminal} disabled={testing}>{testing ? 'Waiting for terminal…' : 'Test R1.00 payment'}</button>
          </div>
        </div>

        <div className="card">
          <h3>Receipt printer & cash drawer</h3>
          <p className="small">
            Any 80mm or 58mm slip printer installed in Windows (Epson TM, Star, Xprinter, Mindeo printers…). Receipts are sized for 80mm paper.
            Set it as the default printer and turn on “open cash drawer” in the printer’s driver settings so the drawer pops on every receipt.
          </p>
          <button className="btn" onClick={() => window.print()}>Print test page</button>
        </div>

        <div className="card">
          <h3>AI assistant connector (MCP)</h3>
          <p className="small">
            Let Claude or other AI assistants answer questions like “How much did we sell this week?” or “What must I reorder?”. The connector is{' '}
            <b>read-only</b>: it cannot change sales or stock, and staff PINs are hidden from it.
          </p>
          <p className="muted small">Add this to Claude Desktop → Settings → Developer → Edit Config (claude_desktop_config.json), then restart Claude:</p>
          <pre className="code">{mcpJson}</pre>
          <button
            className="btn"
            onClick={() => navigator.clipboard?.writeText(mcpJson).then(() => toast('Copied'), () => toast('Copy failed — select the text instead', 'error'))}
          >
            Copy config
          </button>
          {!desktop && <p className="muted small">Running in a browser: install the desktop app for the SQLite database the connector reads.</p>}
        </div>
      </div>
      <button className="btn primary big save-devices" onClick={save}>Save device settings</button>
    </div>
  );
}
