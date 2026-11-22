import { and, eq, gt, isNull } from 'drizzle-orm';
import type { NextFunction, Request, Response } from 'express';
import dns from 'node:dns/promises';
import net from 'node:net';
import { db } from '../db/index.js';
import { apiKeys, sessions, users } from '../db/schema.js';
import { sha256Hex } from './crypto.js';
import type { AuthUser } from '../shared/types.js';

export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
  sessionToken?: string;
}

export interface ApiKeyRequest extends Request {
  apiKey?: {
    id: string;
    userId: string;
    name: string;
    scopes: string[];
  };
}

export async function resolveUserFromToken(token: string): Promise<AuthUser | null> {
  if (!token) return null;
  const tokenHash = sha256Hex(token);
  const now = new Date();
  const rows = await db
    .select({
      userId: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, now)))
    .limit(1);

  if (rows.length === 0) return null;
  return {
    id: rows[0].userId,
    email: rows[0].email,
    name: rows[0].name,
    role: rows[0].role,
  };
}

export async function requireUserAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

  if (!token) {
    res.status(401).json({ error: 'Authentication required. Provide Authorization: Bearer <token>.' });
    return;
  }

  try {
    const user = await resolveUserFromToken(token);
    if (!user) {
      res.status(401).json({ error: 'Invalid or expired session token.' });
      return;
    }
    req.user = user;
    req.sessionToken = token;
    next();
  } catch (err) {
    next(err);
  }
}

export async function requireApiKeyAuth(
  req: ApiKeyRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const headerKey = typeof req.headers['x-api-key'] === 'string' ? req.headers['x-api-key'].trim() : '';
  const authHeader = req.headers.authorization;
  const apiKeyAuth = authHeader?.startsWith('ApiKey ') ? authHeader.slice(7).trim() : '';
  const rawKey = headerKey || apiKeyAuth;

  if (!rawKey) {
    res.status(401).json({
      error: 'Ingest API key required. Supply X-API-Key header or Authorization: ApiKey <key>.',
    });
    return;
  }

  try {
    const keyHash = sha256Hex(rawKey);
    const rows = await db
      .select()
      .from(apiKeys)
      .where(and(eq(apiKeys.keyHash, keyHash), isNull(apiKeys.revokedAt)))
      .limit(1);

    if (rows.length === 0) {
      res.status(403).json({ error: 'Invalid or revoked API key.' });
      return;
    }

    const record = rows[0];
    await db
      .update(apiKeys)
      .set({ lastUsedAt: new Date() })
      .where(eq(apiKeys.id, record.id));

    req.apiKey = {
      id: record.id,
      userId: record.userId,
      name: record.name,
      scopes: record.scopes,
    };
    next();
  } catch (err) {
    next(err);
  }
}

function isPrivateOrBlockedIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    const [a, b] = parts;
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 127) return true; // 127.0.0.0/8 loopback
    if (a === 0) return true; // 0.0.0.0/8
    if (a === 169 && b === 254) return true; // link-local / cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    return false;
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    if (lower === '::1' || lower === '::') return true;
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // unique local
    if (lower.startsWith('fe80')) return true; // link-local
    if (lower.startsWith('::ffff:')) {
      return isPrivateOrBlockedIp(lower.replace('::ffff:', ''));
    }
    return false;
  }
  return true;
}

export async function assertSafeOutboundUrl(rawUrl: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid URL: ${rawUrl}`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Unsupported URL scheme "${parsed.protocol}". Only http/https allowed.`);
  }

  const hostname = parsed.hostname.toLowerCase();
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.internal') ||
    hostname === 'metadata.google.internal'
  ) {
    throw new Error(`Blocked outbound request to restricted host "${hostname}".`);
  }

  if (net.isIP(hostname)) {
    if (isPrivateOrBlockedIp(hostname)) {
      throw new Error(`Blocked outbound request to private/loopback IP "${hostname}".`);
    }
    return parsed;
  }

  try {
    const resolved = await dns.lookup(hostname, { all: true });
    for (const entry of resolved) {
      if (isPrivateOrBlockedIp(entry.address)) {
        throw new Error(`Blocked outbound request resolving to private IP (${entry.address}).`);
      }
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Blocked outbound')) {
      throw err;
    }
    // Allow fetch to surface clean DNS error if hostname cannot resolve
  }

  return parsed;
}
