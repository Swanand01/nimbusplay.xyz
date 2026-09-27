import type { PairingLink } from '../api';
import { Button } from './Button';

export function ConnectButton({
  pairing,
  error,
  busy,
  onConnect
}: {
  pairing: PairingLink | null;
  error: string | null;
  busy: boolean;
  onConnect: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <Button onClick={onConnect} disabled={busy}>
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
