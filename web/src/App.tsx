import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api, ApiError, type Session } from './api';
import { AuthScreen } from './AuthScreen';
import { ConnectButton } from './ConnectButton';
import { Button } from './components/Button';
import { Instructions } from './components/Instructions';
import { Panel } from './components/Panel';
import { StatusLine } from './components/StatusLine';
import { usePolling } from './usePolling';

type Auth = 'unknown' | 'signed-out' | 'signed-in';

const STATUS_TEXT: Record<Session['status'], string> = {
  starting: 'Booting…',
  ready: 'Ready — press connect',
  stopping: 'Shutting down…',
  stopped: 'Player 1 ready',
  failed: 'Game over'
};

export function App() {
  const [auth, setAuth] = useState<Auth>('unknown');
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setSession(await api.currentSession());
      setError(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setAuth('signed-out');
        return;
      }
      // Keep the state we had: a dropped mobile connection shouldn't reset the screen.
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
    }
  }, []);

  useEffect(() => {
    api
      .me()
      .then(() => setAuth('signed-in'))
      .catch(() => setAuth('signed-out'));
  }, []);

  useEffect(() => {
    if (auth === 'signed-in') {
      void refresh();
    }
  }, [auth, refresh]);

  const status = session?.status ?? 'stopped';
  const inFlight = status === 'starting' || status === 'stopping';
  // Poll while the VM is moving, and while it is ready so a VM stopped elsewhere shows up.
  usePolling(() => void refresh(), auth === 'signed-in' && (inFlight || status === 'ready') ? 5000 : null);

  async function act(action: () => Promise<Session>) {
    setError(null);
    try {
      setSession(await action());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
    }
  }

  async function signOut() {
    try {
      await api.logout();
    } finally {
      setSession(null);
      setAuth('signed-out');
    }
  }

  if (auth === 'unknown') {
    return (
      <Shell>
        <StatusLine text="Loading" />
      </Shell>
    );
  }

  if (auth === 'signed-out') {
    return (
      <Shell>
        <AuthScreen onSignedIn={() => setAuth('signed-in')} />
      </Shell>
    );
  }

  return (
    <Shell>
      <Panel>
        <StatusLine text={STATUS_TEXT[status]} tone={status === 'failed' ? 'amber' : 'neon'} />
        {status === 'failed' && session?.error && <p className="text-sm text-gray-300">{session.error}</p>}
        {status === 'starting' && (
          <p className="text-sm text-gray-400">
            Your PC is starting. This takes a few minutes the first time. You can leave this page open.
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
            <Button onClick={() => void act(api.startSession)}>
              {status === 'failed' ? 'Try again' : 'Start gaming'}
            </Button>
          )}
          {status === 'ready' && <ConnectButton />}
          {(status === 'ready' || status === 'starting') && (
            <Button variant="danger" onClick={() => void act(api.stopSession)}>
              Stop
            </Button>
          )}
        </div>
        {error && <p className="text-sm text-amber">{error}</p>}
      </Panel>
      {status !== 'ready' && <Instructions />}
      <Button variant="ghost" onClick={() => void signOut()}>
        Log out
      </Button>
    </Shell>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-dvh px-4 py-8">
      <div className="mx-auto flex w-full max-w-[420px] flex-col gap-5">
        <header>
          <h1 className="font-display text-3xl font-bold tracking-tight text-neon">
            NIMBUS<span className="text-magenta"> PLAY</span>
          </h1>
          <p className="text-sm text-gray-400">Your gaming PC, in the cloud.</p>
        </header>
        {children}
      </div>
    </main>
  );
}
