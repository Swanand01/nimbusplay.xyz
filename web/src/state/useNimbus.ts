import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, type Session } from '../api';
import { usePolling } from '../usePolling';

export type AuthState = 'unknown' | 'signed-out' | 'signed-in' | 'unreachable';

export type Nimbus = {
  auth: AuthState;
  session: Session | null;
  /** False until a session check has succeeded: we don't know whether the PC is off. */
  sessionKnown: boolean;
  error: string | null;
  notice: string | null;
  pairing: PairingLink | null;
  pairingError: string | null;
  connecting: boolean;
  signIn: () => void;
  signOut: () => Promise<void>;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  retrySignIn: () => Promise<void>;
  retrySession: () => Promise<void>;
  /** Fetches a fresh pairing code and opens it in Artemis. */
  connect: () => Promise<void>;
};

const POLL_MS = 5000;

function messageOf(error: unknown): string {
  return error instanceof ApiError ? error.message : 'Something went wrong';
}

// Everything the app knows and every call it makes. The screens render what this returns.
export function useNimbus(): Nimbus {
  const [auth, setAuth] = useState<AuthState>('unknown');
  const [session, setSession] = useState<Session | null>(null);
  const [sessionKnown, setSessionKnown] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pairing, setPairing] = useState<PairingLink | null>(null);
  const [pairingError, setPairingError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setSession(await api.currentSession());
      setSessionKnown(true);
      setError(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        // Don't leave the previous session on screen for whoever logs in next.
        setSession(null);
        setSessionKnown(false);
        setAuth('signed-out');
        setNotice('Please log in again');
        return;
      }
      // Keep the state we had: a dropped mobile connection shouldn't reset the screen.
      setError(messageOf(err));
    }
  }, []);

  const checkSignIn = useCallback(async () => {
    setError(null);
    try {
      await api.me();
      setAuth('signed-in');
    } catch (err) {
      // Only an auth failure means signed out; anything else is the server being unreachable.
      if (err instanceof ApiError && err.status === 401) {
        setAuth('signed-out');
        return;
      }
      setError(messageOf(err));
      setAuth('unreachable');
    }
  }, []);

  useEffect(() => {
    void checkSignIn();
  }, [checkSignIn]);

  useEffect(() => {
    if (auth === 'signed-in') {
      void refresh();
    }
  }, [auth, refresh]);

  const status = session?.status ?? 'stopped';
  const moving = status === 'starting' || status === 'stopping';
  // Poll while the VM is moving, and while it is ready so a VM stopped elsewhere shows up.
  usePolling(() => void refresh(), auth === 'signed-in' && (moving || status === 'ready') ? POLL_MS : null);

  const act = useCallback(async (action: () => Promise<Session>) => {
    setError(null);
    try {
      setSession(await action());
      setSessionKnown(true);
    } catch (err) {
      setError(messageOf(err));
    }
  }, []);

  const connect = useCallback(async () => {
    setConnecting(true);
    setPairingError(null);
    try {
      // Fetched on tap, not ahead of time: the code is only valid for about three minutes.
      const link = await api.pairingLink('Artemis');
      setPairing(link);
      location.assign(link.link);
    } catch (err) {
      // Drop the previous code: it is either expired or for a PC that is no longer ready.
      setPairing(null);
      setPairingError(messageOf(err));
    } finally {
      setConnecting(false);
    }
  }, []);

  const signOut = useCallback(async () => {
    setError(null);
    try {
      await api.logout();
    } catch (err) {
      // A 401 means the session is already gone; on any other failure we are still signed
      // in, so don't show the login screen as though we weren't.
      if (!(err instanceof ApiError && err.status === 401)) {
        setError(messageOf(err));
        return;
      }
    }
    setSession(null);
    setSessionKnown(false);
    setAuth('signed-out');
  }, []);

  return {
    auth,
    session,
    sessionKnown,
    error,
    notice,
    pairing,
    pairingError,
    connecting,
    signIn: () => {
      setNotice(null);
      setAuth('signed-in');
    },
    signOut,
    start: () => act(api.startSession),
    stop: () => act(api.stopSession),
    retrySignIn: checkSignIn,
    retrySession: refresh,
    connect
  };
}
