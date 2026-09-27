import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { api, ApiError } from './api';

vi.mock('./api', async () => {
  const actual = await vi.importActual<typeof import('./api')>('./api');
  return {
    ...actual,
    api: {
      me: vi.fn(),
      currentSession: vi.fn(),
      startSession: vi.fn(),
      stopSession: vi.fn(),
      logout: vi.fn(),
      login: vi.fn(),
      register: vi.fn(),
      pairingLink: vi.fn()
    }
  };
});

const mocked = api as unknown as Record<string, ReturnType<typeof vi.fn>>;

describe('App', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows the login screen when signed out', async () => {
    mocked.me.mockRejectedValue(new ApiError(401, 'Unauthorized'));
    render(<App />);
    expect(await screen.findByRole('button', { name: /^log in$/i })).toBeInTheDocument();
    // How to play belongs on the home screen, where the buttons it mentions exist.
    expect(screen.queryByText(/how to play/i)).not.toBeInTheDocument();
  });

  it('shows Start gaming when signed in with no session', async () => {
    mocked.me.mockResolvedValue({ id: 'a@b.test' });
    mocked.currentSession.mockResolvedValue(null);
    render(<App />);
    expect(await screen.findByRole('button', { name: /start gaming/i })).toBeInTheDocument();
  });

  it('moves back to idle when a ready VM turns out to be stopped', async () => {
    mocked.me.mockResolvedValue({ id: 'a@b.test' });
    mocked.currentSession
      .mockResolvedValueOnce({ id: 's1', status: 'ready', publicIp: '1.2.3.4' })
      .mockResolvedValue({ id: 's1', status: 'stopped' });
    render(<App />);
    expect(await screen.findByRole('button', { name: /connect/i })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: /start gaming/i })).toBeInTheDocument(), {
      timeout: 10000
    });
  }, 15000);

  it('keeps the session state when the network drops mid-poll', async () => {
    mocked.me.mockResolvedValue({ id: 'a@b.test' });
    mocked.currentSession
      .mockResolvedValueOnce({ id: 's1', status: 'starting' })
      .mockRejectedValue(new ApiError(0, "Couldn't reach the server"));
    render(<App />);
    expect(await screen.findByText(/booting/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/couldn't reach the server/i)).toBeInTheDocument(), {
      timeout: 10000
    });
    expect(screen.getByText(/booting/i)).toBeInTheDocument();
  }, 15000);

  it('stays signed in and explains when logout fails', async () => {
    mocked.me.mockResolvedValue({ userId: 'a@b.test' });
    mocked.currentSession.mockResolvedValue(null);
    mocked.logout.mockRejectedValue(new ApiError(0, "Couldn't reach the server"));
    render(<App />);
    // Wait for the idle screen: the loading screen has its own Log out button.
    await screen.findByRole('button', { name: /start gaming/i });
    screen.getByRole('button', { name: /log out/i }).click();
    expect(await screen.findByText(/couldn't reach the server/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /start gaming/i })).toBeInTheDocument();
  });

  it('offers a retry instead of the login form when the server is unreachable at load', async () => {
    mocked.me.mockRejectedValue(new ApiError(0, "Couldn't reach the server"));
    render(<App />);
    expect(await screen.findByText(/couldn't reach the server/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^log in$/i })).not.toBeInTheDocument();
  });

  it('offers a retry when the first session check fails, instead of claiming the PC is off', async () => {
    mocked.me.mockResolvedValue({ userId: 'a@b.test' });
    mocked.currentSession.mockRejectedValue(new ApiError(0, "Couldn't reach the server"));
    render(<App />);
    expect(await screen.findByRole('button', { name: /retry/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /start gaming/i })).not.toBeInTheDocument();
  });

  it('clears the previous session and explains when the token expires mid-poll', async () => {
    mocked.me.mockResolvedValue({ userId: 'a@b.test' });
    mocked.currentSession
      .mockResolvedValueOnce({ id: 's1', status: 'ready', publicIp: '1.2.3.4' })
      .mockRejectedValue(new ApiError(401, 'Unauthorized'));
    render(<App />);
    expect(await screen.findByRole('button', { name: /connect/i })).toBeInTheDocument();
    expect(await screen.findByText(/please log in again/i, undefined, { timeout: 10000 })).toBeInTheDocument();
    expect(screen.queryByText(/1\.2\.3\.4/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /connect/i })).not.toBeInTheDocument();
  }, 15000);

  it('shows the backend error for a failed session', async () => {
    mocked.me.mockResolvedValue({ id: 'a@b.test' });
    mocked.currentSession.mockResolvedValue({ id: 's1', status: 'failed', error: 'Apollo did not become reachable' });
    render(<App />);
    expect(await screen.findByText(/apollo did not become reachable/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });
});
