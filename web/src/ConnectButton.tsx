import { useState } from 'react';
import { api, ApiError, type PairingLink } from './api';
import { Button } from './components/Button';

export function ConnectButton() {
  const [pairing, setPairing] = useState<PairingLink | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      // Fetched on tap, not on render: the code is only valid for about three minutes.
      const link = await api.pairingLink('Artemis');
      setPairing(link);
      location.assign(link.link);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <Button onClick={() => void connect()} disabled={busy}>
        {busy ? 'Opening…' : 'Connect'}
      </Button>
      {error && <p className="text-sm text-amber">{error}</p>}
      {pairing && (
        <div className="flex flex-col gap-1 text-sm text-gray-400">
          <span>If Artemis didn&rsquo;t open, add the PC manually and pair with:</span>
          <span>
            PIN <b className="font-display text-base text-neon">{pairing.pin}</b> · passphrase{' '}
            <b className="font-display text-base text-neon">{pairing.passphrase}</b>
          </span>
          <span className="text-xs">
            Expires in {Math.round(pairing.expiresInSeconds / 60)} minutes. Press Connect again for a new code.
          </span>
        </div>
      )}
    </div>
  );
}
