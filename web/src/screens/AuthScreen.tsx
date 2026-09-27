import { useState, type FormEvent } from 'react';
import { api, ApiError } from '../api';
import { Button } from '../components/Button';
import { Panel } from '../components/Panel';

export function AuthScreen({ onSignedIn }: { onSignedIn: () => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await (mode === 'login' ? api.login(email, password) : api.register(email, password));
      onSignedIn();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title={mode === 'login' ? 'Log in' : 'Sign up'}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5 text-sm text-gray-400">
          Email
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="min-h-12 rounded-2xl border border-white/10 bg-void px-4 text-base text-gray-200 outline-none focus:border-neon"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm text-gray-400">
          Password
          <input
            id="password"
            type="password"
            required
            minLength={8}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="min-h-12 rounded-2xl border border-white/10 bg-void px-4 text-base text-gray-200 outline-none focus:border-neon"
          />
        </label>
        {error && <p className="text-sm text-amber">{error}</p>}
        <Button type="submit" disabled={busy}>
          {busy ? 'Please wait' : mode === 'login' ? 'Log in' : 'Sign up'}
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            setMode(mode === 'login' ? 'register' : 'login');
            setError(null);
          }}
        >
          {mode === 'login' ? 'Need an account? Sign up' : 'Already have an account? Log in'}
        </Button>
      </form>
    </Panel>
  );
}
