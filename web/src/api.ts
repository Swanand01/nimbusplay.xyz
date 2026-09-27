export type SessionStatus = 'starting' | 'ready' | 'stopping' | 'stopped' | 'failed';

export type Session = {
  id: string;
  status: SessionStatus;
  publicIp?: string;
  error?: string;
};

export type PairingLink = {
  link: string;
  pin: string;
  passphrase: string;
  expiresInSeconds: number;
};

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      // The session lives in an httpOnly cookie, so every call must carry credentials.
      credentials: 'include',
      headers: { 'content-type': 'application/json', ...(init.headers ?? {}) }
    });
  } catch {
    throw new ApiError(0, "Couldn't reach the server");
  }

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiError(response.status, (body as { error?: string }).error ?? `Request failed (${response.status})`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export const api = {
  register: (email: string, password: string) =>
    request<void>('/auth/register', { method: 'POST', body: JSON.stringify({ email, password }) }),
  login: (email: string, password: string) =>
    request<void>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  logout: () => request<void>('/auth/logout', { method: 'POST' }),
  me: () => request<{ id: string }>('/me'),
  currentSession: async (): Promise<Session | null> => {
    try {
      return await request<Session>('/sessions/current');
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        return null;
      }
      throw error;
    }
  },
  startSession: () => request<Session>('/sessions/start', { method: 'POST', body: '{}' }),
  stopSession: () => request<Session>('/sessions/stop', { method: 'POST' }),
  pairingLink: (name: string) =>
    request<PairingLink>('/pairing/link', { method: 'POST', body: JSON.stringify({ name }) })
};
