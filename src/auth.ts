import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { FastifyRequest } from 'fastify';
import { config } from './config';
import { prisma } from './db';

const scrypt = promisify(scryptCallback);

type TokenPayload = {
  sub: string;
  exp: number;
  ver: number;
};

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function sign(value: string): string {
  return createHmac('sha256', config.auth.tokenSecret).update(value).digest('base64url');
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('base64url');
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt$${salt}$${derived.toString('base64url')}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const [scheme, salt, hash] = storedHash.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) {
    return false;
  }

  const expected = Buffer.from(hash, 'base64url');
  const actual = (await scrypt(password, salt, expected.length)) as Buffer;

  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function createToken(userId: string, tokenVersion = 0): string {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload: TokenPayload = {
    sub: userId,
    exp: Math.floor(Date.now() / 1000) + config.auth.tokenTtlSeconds,
    ver: tokenVersion
  };
  const body = base64url(JSON.stringify(payload));
  const signature = sign(`${header}.${body}`);

  return `${header}.${body}.${signature}`;
}

export function verifyToken(token: string): TokenPayload {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid token');
  }

  const [header, body, signature] = parts;
  const expected = sign(`${header}.${body}`);
  const actualBuffer = Buffer.from(signature, 'base64url');
  const expectedBuffer = Buffer.from(expected, 'base64url');

  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) {
    throw new Error('Invalid token signature');
  }

  const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as TokenPayload;
  if (!payload.sub || !payload.exp || payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error('Expired token');
  }

  return payload;
}

export async function getAuthenticatedUserId(request: FastifyRequest): Promise<string> {
  const authHeader = request.headers.authorization;
  const headerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : undefined;
  // The browser app sends an httpOnly cookie; scripts and future mobile clients send the header.
  const token = headerToken ?? request.cookies?.session;
  if (!token) {
    throw new Error('Missing bearer token');
  }

  const payload = verifyToken(token);
  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!user) {
    throw new Error('User not found');
  }

  // Logout bumps tokenVersion, so tokens issued before it no longer verify.
  if ((payload.ver ?? 0) !== user.tokenVersion) {
    throw new Error('Token revoked');
  }

  return user.id;
}
