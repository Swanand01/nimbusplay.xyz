import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from './api';

function mockFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status < 400,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body)
  });
}

describe('api', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('sends cookies and never stores a token', async () => {
    const fetchMock = mockFetch(200, { userId: 'a@b.test', token: 'secret-token' });
    vi.stubGlobal('fetch', fetchMock);

    await api.login('a@b.test', 'password123');

    const [, init] = fetchMock.mock.calls[0];
    expect(init.credentials).toBe('include');
    expect(JSON.stringify(localStorage)).not.toContain('secret-token');
  });

  it('returns null when the user has no session', async () => {
    vi.stubGlobal('fetch', mockFetch(404, { error: 'No active session' }));
    await expect(api.currentSession()).resolves.toBeNull();
  });

  it('throws ApiError with the status and server message', async () => {
    vi.stubGlobal('fetch', mockFetch(409, { error: 'VM is not ready for pairing' }));
    await expect(api.pairingLink('Artemis')).rejects.toMatchObject({
      status: 409,
      message: 'VM is not ready for pairing'
    });
  });

  it('reports a network failure as a readable error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(api.me()).rejects.toBeInstanceOf(ApiError);
    await expect(api.me()).rejects.toMatchObject({ status: 0, message: "Couldn't reach the server" });
  });
});
