import { randomBytes } from 'node:crypto';
import Fastify from 'fastify';
import { z } from 'zod';
import {
  listApolloClients,
  requireDefaultApolloCredentials,
  submitApolloPin,
  updateApolloCredentials,
  waitForApollo,
  type ApolloCredentials
} from './apollo';
import { createToken, getAuthenticatedUserId, hashPassword, normalizeEmail, verifyPassword } from './auth';
import { config } from './config';
import { prisma } from './db';
import { AwsProvider } from './providers/aws';
import { Store } from './store';
import type { SessionRecord } from './types';

const authBodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(8)
});

const pairingPinSchema = z.object({
  pin: z.string().regex(/^\d{4}$/),
  name: z.string().min(1).max(80).default('Artemis')
});

const app = Fastify({ logger: true });
const store = new Store();
const cloud = new AwsProvider();

function authError(reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } }, message = 'Unauthorized') {
  return reply.code(401).send({ error: message });
}

async function refreshSessionFromInstance(session: SessionRecord): Promise<{ session: SessionRecord; instanceState?: string }> {
  if (!session.instanceId) {
    return { session };
  }

  const instance = await cloud.describeInstance(session.instanceId);
  session.publicIp = instance.publicIp ?? session.publicIp;
  session.privateIp = instance.privateIp ?? session.privateIp;
  session.artemisHost = session.publicIp;

  if (instance.state === 'stopped' || instance.state === 'terminated' || instance.state === 'shutting-down') {
    session.status = 'stopped';
    session.stoppedAt = new Date().toISOString();
  }

  await store.updateSession(session);
  return { session, instanceState: instance.state };
}

function generateApolloPassword(): string {
  return randomBytes(24).toString('base64url');
}

async function ensureVmApolloCredentials(userId: string, apolloHost: string): Promise<ApolloCredentials> {
  const user = await store.getUser(userId);
  if (!user) {
    throw new Error(`User not found: ${userId}`);
  }

  if (user.apolloUsername && user.apolloPassword) {
    return {
      username: user.apolloUsername,
      password: user.apolloPassword
    };
  }

  const defaultCredentials = requireDefaultApolloCredentials();
  const rotatedCredentials = {
    username: defaultCredentials.username,
    password: generateApolloPassword()
  };

  await updateApolloCredentials(apolloHost, defaultCredentials, rotatedCredentials);

  user.apolloUsername = rotatedCredentials.username;
  user.apolloPassword = rotatedCredentials.password;
  user.apolloCredentialsRotatedAt = new Date().toISOString();
  await store.updateUser(user);

  return rotatedCredentials;
}

// Serializes /sessions/start per user so concurrent requests can't launch two VMs.
// In-process only: the backend runs as a single process.
const startLocks = new Map<string, Promise<unknown>>();

async function withStartLock<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  const previous = startLocks.get(userId) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(fn);
  startLocks.set(userId, current);
  try {
    return await current;
  } finally {
    if (startLocks.get(userId) === current) {
      startLocks.delete(userId);
    }
  }
}

async function startSessionInBackground(userId: string, sessionId: string): Promise<void> {
  const user = await store.ensureUser(userId);
  const session = await store.getSession(sessionId);
  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  try {
    const volume = await cloud.ensureGameVolume(user);
    user.gameVolumeId = volume.volumeId;
    user.gameVolumeAz = volume.availabilityZone;
    await store.updateUser(user);

    const result = await cloud.startInstance(user, session, volume.volumeId, async (instanceId) => {
      user.instanceId = instanceId;
      await store.updateUser(user);
      session.instanceId = instanceId;
      await store.updateSession(session);
    });
    session.instanceId = result.instanceId;
    session.publicIp = result.publicIp;
    session.privateIp = result.privateIp;
    session.artemisHost = result.publicIp;
    session.gameVolumeId = result.gameVolumeId;
    user.instanceId = result.instanceId;
    user.elasticIpAllocationId = result.elasticIpAllocationId;
    user.elasticIp = result.publicIp;
    user.privateIp = result.privateIp;
    await store.updateUser(user);

    const apolloHost = config.apollo.usePrivateIp ? result.privateIp : result.publicIp;
    if (!apolloHost) {
      throw new Error('Apollo host is not available after VM start');
    }
    await waitForApollo(apolloHost);
    await ensureVmApolloCredentials(userId, apolloHost);

    session.status = 'ready';
    await store.updateSession(session);
  } catch (err: unknown) {
    session.status = 'failed';
    session.error = err instanceof Error ? err.message : String(err);
    await store.updateSession(session);
    app.log.error(err);
  }
}

async function createReadySessionForRunningVm(userId: string): Promise<SessionRecord | undefined> {
  const user = await store.getUser(userId);
  if (!user?.instanceId) {
    return undefined;
  }

  const instance = await cloud.describeInstance(user.instanceId);
  if (instance.state !== 'running') {
    return undefined;
  }

  const session = await store.createSession(userId);
  session.status = 'ready';
  session.instanceId = user.instanceId;
  session.publicIp = instance.publicIp ?? user.elasticIp;
  session.privateIp = instance.privateIp ?? user.privateIp;
  session.artemisHost = session.publicIp;
  session.gameVolumeId = user.gameVolumeId;

  user.elasticIp = session.publicIp;
  user.privateIp = session.privateIp;

  await store.updateUser(user);
  await store.updateSession(session);
  return session;
}

async function getReadySessionForApollo(userId: string): Promise<{ session?: SessionRecord; apolloHost?: string; error?: string }> {
  const session = await store.getCurrentSession(userId);

  if (!session || session.status !== 'ready' || !session.artemisHost || !session.instanceId) {
    return { error: 'VM is not ready' };
  }

  const refreshed = await refreshSessionFromInstance(session);
  if (refreshed.instanceState !== 'running' || !refreshed.session.artemisHost) {
    return { error: `VM is not running: ${refreshed.instanceState ?? 'unknown'}` };
  }

  const apolloHost = config.apollo.usePrivateIp ?
    refreshed.session.privateIp :
    refreshed.session.artemisHost;

  if (!apolloHost) {
    return { error: 'Apollo host is not available' };
  }

  return { session: refreshed.session, apolloHost };
}

app.get('/health', async () => ({ ok: true }));

app.post('/auth/register', async (request, reply) => {
  const body = authBodySchema.parse(request.body);
  const email = normalizeEmail(body.email);
  const passwordHash = await hashPassword(body.password);

  const existing = await prisma.user.findUnique({ where: { id: email } });
  if (existing?.passwordHash) {
    return reply.code(409).send({ error: 'User already exists' });
  }

  await prisma.user.upsert({
    where: { id: email },
    create: { id: email, passwordHash },
    update: { passwordHash }
  });

  return {
    userId: email,
    token: createToken(email)
  };
});

app.post('/auth/login', async (request, reply) => {
  const body = authBodySchema.parse(request.body);
  const email = normalizeEmail(body.email);
  const user = await prisma.user.findUnique({ where: { id: email } });

  if (!user?.passwordHash || !(await verifyPassword(body.password, user.passwordHash))) {
    return authError(reply, 'Invalid email or password');
  }

  return {
    userId: email,
    token: createToken(email)
  };
});

app.get('/me', async (request, reply) => {
  try {
    const userId = await getAuthenticatedUserId(request);
    return { userId };
  } catch {
    return authError(reply);
  }
});

app.post('/sessions/start', async (request, reply) => {
  let userId: string;
  try {
    userId = await getAuthenticatedUserId(request);
  } catch {
    return authError(reply);
  }

  await store.ensureUser(userId);

  const result = await withStartLock(userId, async () => {
    const existing = await store.getCurrentSession(userId);
    if (existing) {
      return { session: existing, created: false };
    }

    const readySession = await createReadySessionForRunningVm(userId);
    if (readySession) {
      return { session: readySession, created: false };
    }

    const session = await store.createSession(userId);
    void startSessionInBackground(userId, session.id);
    return { session, created: true };
  });

  return result.created ? reply.code(202).send(result.session) : result.session;
});

app.get('/sessions/current', async (request, reply) => {
  let userId: string;
  try {
    userId = await getAuthenticatedUserId(request);
  } catch {
    return authError(reply);
  }

  const session = await store.getCurrentSession(userId);
  if (!session) {
    return reply.code(404).send({ error: 'No active session' });
  }

  await refreshSessionFromInstance(session);

  return session;
});

app.post('/pairing/pin', async (request, reply) => {
  let userId: string;
  try {
    userId = await getAuthenticatedUserId(request);
  } catch {
    return authError(reply);
  }

  const body = pairingPinSchema.parse(request.body);

  try {
    const ready = await getReadySessionForApollo(userId);
    if (!ready.apolloHost) {
      return reply.code(409).send({ error: ready.error ?? 'VM is not ready for pairing' });
    }

    const apolloCredentials = await ensureVmApolloCredentials(userId, ready.apolloHost);
    const result = await submitApolloPin(ready.apolloHost, apolloCredentials, body.pin, body.name);
    return {
      status: result.status === true,
      apollo: result
    };
  } catch (err: unknown) {
    request.log.error(err);
    return reply.code(502).send({
      error: err instanceof Error ? err.message : String(err)
    });
  }
});

app.get('/pairing/clients', async (request, reply) => {
  let userId: string;
  try {
    userId = await getAuthenticatedUserId(request);
  } catch {
    return authError(reply);
  }

  try {
    const ready = await getReadySessionForApollo(userId);
    if (!ready.apolloHost) {
      return reply.code(409).send({ error: ready.error ?? 'VM is not ready' });
    }

    const apolloCredentials = await ensureVmApolloCredentials(userId, ready.apolloHost);
    const clients = await listApolloClients(ready.apolloHost, apolloCredentials);
    return {
      clients,
      fullPermissionMask: 0x071f1f00
    };
  } catch (err: unknown) {
    request.log.error(err);
    return reply.code(502).send({
      error: err instanceof Error ? err.message : String(err)
    });
  }
});

app.post('/sessions/stop', async (request, reply) => {
  let userId: string;
  try {
    userId = await getAuthenticatedUserId(request);
  } catch {
    return authError(reply);
  }

  const session = await store.getCurrentSession(userId);

  if (!session) {
    return reply.code(404).send({ error: 'No active session' });
  }

  session.status = 'stopping';
  await store.updateSession(session);

  try {
    await cloud.stopInstance(session);
    session.status = 'stopped';
    session.stoppedAt = new Date().toISOString();
    await store.updateSession(session);
    return session;
  } catch (err: unknown) {
    session.status = 'failed';
    session.error = err instanceof Error ? err.message : String(err);
    await store.updateSession(session);
    request.log.error(err);
    return reply.code(500).send(session);
  }
});

async function main(): Promise<void> {
  await store.load();
  await app.listen({ host: config.host, port: config.port });
}

void main();
