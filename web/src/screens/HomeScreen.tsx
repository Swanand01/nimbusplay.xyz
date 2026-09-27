import type { PairingLink, Session } from '../api';
import { Button } from '../components/Button';
import { Instructions } from '../components/Instructions';
import { Panel } from '../components/Panel';
import { StatusLine } from '../components/StatusLine';
import { ConnectButton } from '../components/ConnectButton';

const STATUS_TEXT: Record<Session['status'], string> = {
  starting: 'Booting…',
  ready: 'Ready — press connect',
  stopping: 'Shutting down…',
  stopped: 'Player 1 ready',
  failed: 'Game over'
};

export function HomeScreen({
  session,
  error,
  pairing,
  pairingError,
  connecting,
  onStart,
  onStop,
  onConnect,
  onSignOut
}: {
  session: Session | null;
  error: string | null;
  pairing: PairingLink | null;
  pairingError: string | null;
  connecting: boolean;
  onStart: () => void;
  onStop: () => void;
  onConnect: () => void;
  onSignOut: () => void;
}) {
  const status = session?.status ?? 'stopped';

  return (
    <>
      <Panel>
        <StatusLine text={STATUS_TEXT[status] ?? status} tone={status === 'failed' ? 'amber' : 'neon'} />
        {status === 'failed' && session?.error && <p className="text-sm text-gray-300">{session.error}</p>}
        {status === 'starting' && (
          <p className="text-sm text-gray-400">
            Your PC is starting. This takes a few minutes the first time. You can leave this page open;
            Stop appears once it&rsquo;s ready.
          </p>
        )}
        {status === 'stopped' && (
          <p className="text-sm text-gray-400">Your PC is off. Start it when you want to play.</p>
        )}
        {status === 'ready' && session?.publicIp && (
          <p className="text-sm text-gray-400">Streaming to this device at {session.publicIp}.</p>
        )}
        <div className="flex flex-col gap-3">
          {(status === 'stopped' || status === 'failed') && (
            <Button onClick={onStart}>{status === 'failed' ? 'Try again' : 'Start gaming'}</Button>
          )}
          {status === 'ready' && (
            <ConnectButton pairing={pairing} error={pairingError} busy={connecting} onConnect={onConnect} />
          )}
          {/* Only once the VM is up: EC2 refuses to stop one that is still starting. */}
          {status === 'ready' && (
            <Button variant="danger" onClick={onStop}>
              Stop
            </Button>
          )}
        </div>
        {error && <p className="text-sm text-amber">{error}</p>}
      </Panel>
      {status !== 'ready' && <Instructions />}
      <Button variant="ghost" onClick={onSignOut}>
        Log out
      </Button>
    </>
  );
}
