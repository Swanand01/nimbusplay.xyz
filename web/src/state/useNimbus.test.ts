import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../api';
import { useNimbus } from './useNimbus';

vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api');
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

describe('useNimbus', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reports signed-in with no session once both checks succeed', async () => {
    mocked.me.mockResolvedValue({ userId: 'a@b.test' });
    mocked.currentSession.mockResolvedValue(null);

    const { result } = renderHook(() => useNimbus());

    await waitFor(() => expect(result.current.sessionKnown).toBe(true));
    expect(result.current.auth).toBe('signed-in');
    expect(result.current.session).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('separates "server unreachable" from "signed out"', async () => {
    mocked.me.mockRejectedValue(new ApiError(0, "Couldn't reach the server"));

    const { result } = renderHook(() => useNimbus());

    await waitFor(() => expect(result.current.auth).toBe('unreachable'));
    expect(result.current.error).toBe("Couldn't reach the server");
  });

  it('fetches a pairing code only when connect is called, then opens it', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { assign });
    mocked.me.mockResolvedValue({ userId: 'a@b.test' });
    mocked.currentSession.mockResolvedValue({ id: 's1', status: 'ready', publicIp: '1.2.3.4' });
    mocked.pairingLink.mockResolvedValue({
      link: 'art://1.2.3.4:47989?pin=1234&passphrase=abcd1234&name=PC',
      pin: '1234',
      passphrase: 'abcd1234',
      expiresInSeconds: 180
    });

    const { result } = renderHook(() => useNimbus());
    await waitFor(() => expect(result.current.sessionKnown).toBe(true));
    expect(mocked.pairingLink).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.connect();
    });

    expect(assign).toHaveBeenCalledWith(expect.stringContaining('art://'));
    expect(result.current.pairing?.pin).toBe('1234');
  });

  it('drops a stale pairing code when a later attempt fails', async () => {
    vi.stubGlobal('location', { assign: vi.fn() });
    mocked.me.mockResolvedValue({ userId: 'a@b.test' });
    mocked.currentSession.mockResolvedValue({ id: 's1', status: 'ready' });
    mocked.pairingLink
      .mockResolvedValueOnce({ link: 'art://x', pin: '1234', passphrase: 'abcd1234', expiresInSeconds: 180 })
      .mockRejectedValue(new ApiError(409, 'VM is not ready for pairing'));

    const { result } = renderHook(() => useNimbus());
    await waitFor(() => expect(result.current.sessionKnown).toBe(true));

    await act(async () => {
      await result.current.connect();
    });
    expect(result.current.pairing?.pin).toBe('1234');

    await act(async () => {
      await result.current.connect();
    });
    expect(result.current.pairing).toBeNull();
    expect(result.current.pairingError).toBe('VM is not ready for pairing');
  });

  it('keeps the user signed in when logout fails', async () => {
    mocked.me.mockResolvedValue({ userId: 'a@b.test' });
    mocked.currentSession.mockResolvedValue(null);
    mocked.logout.mockRejectedValue(new ApiError(0, "Couldn't reach the server"));

    const { result } = renderHook(() => useNimbus());
    await waitFor(() => expect(result.current.sessionKnown).toBe(true));

    await act(async () => {
      await result.current.signOut();
    });

    expect(result.current.auth).toBe('signed-in');
    expect(result.current.error).toBe("Couldn't reach the server");
  });
});
