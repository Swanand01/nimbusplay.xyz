import https from 'node:https';
import { config } from './config';

type ApolloPinResponse = {
  status?: boolean;
  error?: string;
  [key: string]: unknown;
};

type ApolloResponse<T> = {
  headers: Record<string, string | string[] | undefined>;
  body: T;
};

export type ApolloClient = {
  uuid: string;
  name: string;
  display_mode?: string;
  perm: number | string;
  do?: unknown[];
  undo?: unknown[];
  allow_client_commands?: boolean;
  enable_legacy_ordering?: boolean;
  always_use_virtual_display?: boolean;
};

type ApolloClientsResponse = {
  status?: boolean;
  named_certs?: ApolloClient[];
};

export type ApolloCredentials = {
  username: string;
  password: string;
};

const FULL_PERMISSION_MASK = 0x071f1f00;

export function requireDefaultApolloCredentials(): ApolloCredentials {
  if (!config.apollo.apiUsername || !config.apollo.apiPassword) {
    throw new Error('Missing APOLLO_API_USERNAME or APOLLO_API_PASSWORD');
  }

  return {
    username: config.apollo.apiUsername,
    password: config.apollo.apiPassword
  };
}

function postApollo<T>(
  host: string,
  path: string,
  payload: unknown,
  headers: Record<string, string> = {}
): Promise<ApolloResponse<T>> {
  const body = JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const request = https.request(
      {
        hostname: host,
        port: config.apollo.apiPort,
        path,
        method: 'POST',
        rejectUnauthorized: config.apollo.rejectUnauthorized,
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
          ...headers
        }
      },
      (response) => {
        let responseBody = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          responseBody += chunk;
        });
        response.on('end', () => {
          let parsed: T;
          try {
            parsed = responseBody ? JSON.parse(responseBody) : ({} as T);
          } catch {
            parsed = { error: responseBody || response.statusMessage } as T;
          }

          if (!response.statusCode || response.statusCode >= 400) {
            const errorBody = parsed as { error?: string };
            reject(new Error(errorBody.error || `Apollo request to ${path} failed with HTTP ${response.statusCode}`));
            return;
          }

          resolve({
            headers: response.headers,
            body: parsed
          });
        });
      }
    );

    request.on('error', reject);
    request.write(body);
    request.end();
  });
}

function getApollo<T>(
  host: string,
  path: string,
  headers: Record<string, string> = {}
): Promise<ApolloResponse<T>> {
  return new Promise((resolve, reject) => {
    const request = https.request(
      {
        hostname: host,
        port: config.apollo.apiPort,
        path,
        method: 'GET',
        rejectUnauthorized: config.apollo.rejectUnauthorized,
        headers
      },
      (response) => {
        let responseBody = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          responseBody += chunk;
        });
        response.on('end', () => {
          let parsed: T;
          try {
            parsed = responseBody ? JSON.parse(responseBody) : ({} as T);
          } catch {
            parsed = { error: responseBody || response.statusMessage } as T;
          }

          if (!response.statusCode || response.statusCode >= 400) {
            const errorBody = parsed as { error?: string };
            reject(new Error(errorBody.error || `Apollo request to ${path} failed with HTTP ${response.statusCode}`));
            return;
          }

          resolve({
            headers: response.headers,
            body: parsed
          });
        });
      }
    );

    request.on('error', reject);
    request.end();
  });
}

function extractAuthCookie(headers: Record<string, string | string[] | undefined>): string {
  const setCookie = headers['set-cookie'];
  const values = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  const authCookie = values.find((cookie) => cookie.startsWith('auth='));

  if (!authCookie) {
    throw new Error('Apollo login did not return auth cookie');
  }

  return authCookie.split(';')[0];
}

function normalizeClientName(value: string): string {
  return value.trim().toLowerCase();
}

function isMatchingClientName(clientName: string, requestedName: string): boolean {
  const normalizedClientName = normalizeClientName(clientName);
  const normalizedRequestedName = normalizeClientName(requestedName);

  return normalizedClientName === normalizedRequestedName ||
    normalizedClientName.startsWith(`${normalizedRequestedName} (`);
}

async function grantFullPermissionsToClient(host: string, authCookie: string, name: string): Promise<void> {
  const clientsResponse = await getApollo<ApolloClientsResponse>(
    host,
    '/api/clients/list',
    { cookie: authCookie }
  );

  const clients = clientsResponse.body.named_certs ?? [];
  const matchingClients = clients.filter((client) => isMatchingClientName(client.name, name));

  for (const client of matchingClients) {
    if (Number(client.perm) === FULL_PERMISSION_MASK) {
      continue;
    }

    await postApollo(
      host,
      '/api/clients/update',
      {
        uuid: client.uuid,
        name: client.name,
        display_mode: client.display_mode ?? '',
        perm: FULL_PERMISSION_MASK,
        allow_client_commands: client.allow_client_commands ?? true,
        enable_legacy_ordering: client.enable_legacy_ordering ?? true,
        always_use_virtual_display: client.always_use_virtual_display ?? false,
        do: client.do ?? [],
        undo: client.undo ?? []
      },
      { cookie: authCookie }
    );
  }
}

async function loginToApollo(host: string, credentials: ApolloCredentials): Promise<string> {
  const login = await postApollo<Record<string, never>>(host, '/api/login', credentials);
  return extractAuthCookie(login.headers);
}

export async function updateApolloCredentials(
  host: string,
  currentCredentials: ApolloCredentials,
  newCredentials: ApolloCredentials
): Promise<void> {
  const authCookie = await loginToApollo(host, currentCredentials);
  await postApollo(
    host,
    '/api/password',
    {
      currentUsername: currentCredentials.username,
      currentPassword: currentCredentials.password,
      newUsername: newCredentials.username,
      newPassword: newCredentials.password,
      confirmNewPassword: newCredentials.password
    },
    { cookie: authCookie }
  );
}

export async function listApolloClients(host: string, credentials: ApolloCredentials): Promise<ApolloClient[]> {
  const authCookie = await loginToApollo(host, credentials);
  const clientsResponse = await getApollo<ApolloClientsResponse>(
    host,
    '/api/clients/list',
    { cookie: authCookie }
  );

  return clientsResponse.body.named_certs ?? [];
}

export async function submitApolloPin(
  host: string,
  credentials: ApolloCredentials,
  pin: string,
  name: string
): Promise<ApolloPinResponse> {
  const authCookie = await loginToApollo(host, credentials);
  const pinResponse = await postApollo<ApolloPinResponse>(
    host,
    '/api/pin',
    { pin, name },
    { cookie: authCookie }
  );

  if (pinResponse.body.status === true) {
    await grantFullPermissionsToClient(host, authCookie, name);
  }

  return pinResponse.body;
}

function probeApollo(host: string, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const request = https.request(
      {
        hostname: host,
        port: config.apollo.apiPort,
        path: '/',
        method: 'GET',
        rejectUnauthorized: config.apollo.rejectUnauthorized,
        timeout: timeoutMs
      },
      (response) => {
        response.resume();
        resolve(true);
      }
    );

    request.on('timeout', () => request.destroy(new Error('Apollo probe timed out')));
    request.on('error', () => resolve(false));
    request.end();
  });
}

// Any HTTP response means Apollo's web server is up; connection errors mean it's still booting.
export async function waitForApollo(host: string, timeoutMs = 5 * 60 * 1000, intervalMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probeApollo(host, intervalMs)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(`Apollo on ${host} did not become reachable within ${Math.round(timeoutMs / 1000)}s`);
}
