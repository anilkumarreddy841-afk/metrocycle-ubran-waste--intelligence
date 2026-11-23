import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import type { UserRole } from './types.ts';

const SESSION_SECRET =
  process.env.SESSION_SECRET ||
  crypto.createHash('sha256').update(process.cwd() + ':metrocycle-secret-key').digest('hex');

const COOKIE_NAME = 'mc_session';
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

export interface SessionPayload {
  userId: number;
  email: string;
  fullName: string;
  role: UserRole;
  exp: number;
}

declare global {
  namespace Express {
    interface Request {
      user?: SessionPayload;
    }
  }
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, keyHex] = parts;
  if (!salt || !keyHex) return false;
  const derived = crypto.scryptSync(password, salt, 64);
  const storedBuf = Buffer.from(keyHex, 'hex');
  if (derived.length !== storedBuf.length) return false;
  return crypto.timingSafeEqual(derived, storedBuf);
}

export function signSessionToken(payload: Omit<SessionPayload, 'exp'>): string {
  const fullPayload: SessionPayload = {
    ...payload,
    exp: Date.now() + TOKEN_TTL_MS,
  };
  const encoded = Buffer.from(JSON.stringify(fullPayload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

export function verifySessionToken(token: string): SessionPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [encoded, sig] = parts;
    if (!encoded || !sig) return null;
    const expectedSig = crypto
      .createHmac('sha256', SESSION_SECRET)
      .update(encoded)
      .digest('base64url');
    const a = Buffer.from(sig);
    const b = Buffer.from(expectedSig);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as SessionPayload;
    if (!parsed.exp || Date.now() > parsed.exp) return null;
    return parsed;
  } catch {
    return null;
  }
}

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

export function extractToken(req: Request): string | null {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) {
    return auth.slice(7).trim();
  }
  const cookies = parseCookies(req.headers.cookie);
  return cookies[COOKIE_NAME] || null;
}

export function setSessionCookie(res: Response, token: string, req: Request): void {
  const isHttps =
    req.secure || req.headers['x-forwarded-proto'] === 'https' || process.env.NODE_ENV === 'production';
  const flags = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    `Max-Age=${Math.floor(TOKEN_TTL_MS / 1000)}`,
    isHttps ? 'SameSite=None; Secure' : 'SameSite=Lax',
  ];
  res.setHeader('Set-Cookie', flags.join('; '));
}

export function clearSessionCookie(res: Response, req: Request): void {
  const isHttps =
    req.secure || req.headers['x-forwarded-proto'] === 'https' || process.env.NODE_ENV === 'production';
  const flags = [
    `${COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'Max-Age=0',
    isHttps ? 'SameSite=None; Secure' : 'SameSite=Lax',
  ];
  res.setHeader('Set-Cookie', flags.join('; '));
}

export function createAuthMiddleware(db: DatabaseSync) {
  return function requireAuth(req: Request, res: Response, next: NextFunction) {
    const token = extractToken(req);
    if (!token) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    const payload = verifySessionToken(token);
    if (!payload) {
      res.status(401).json({ error: 'Session expired or invalid' });
      return;
    }
    // Verify user still exists in DB and fetch current role
    const row = db
      .prepare('SELECT id, email, full_name, role FROM users WHERE id = ?')
      .get(payload.userId) as
      | { id: number; email: string; full_name: string; role: UserRole }
      | undefined;
    if (!row) {
      res.status(401).json({ error: 'User account no longer exists' });
      return;
    }
    req.user = {
      userId: row.id,
      email: row.email,
      fullName: row.full_name,
      role: row.role,
      exp: payload.exp,
    };
    next();
  };
}

export function requireRole(allowedRoles: UserRole[]) {
  return function roleGuard(req: Request, res: Response, next: NextFunction) {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    if (!allowedRoles.includes(req.user.role)) {
      res.status(403).json({
        error: `Insufficient permissions. Required role: ${allowedRoles.join(' or ')}`,
      });
      return;
    }
    next();
  };
}

// Simple sliding-window rate limiter
const rateBuckets = new Map<string, number[]>();

export function rateLimit(maxRequests: number, windowMs: number) {
  return function limiter(req: Request, res: Response, next: NextFunction) {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const key = `${req.path}:${ip}`;
    const now = Date.now();
    const history = (rateBuckets.get(key) || []).filter((t) => now - t < windowMs);
    if (history.length >= maxRequests) {
      res.status(429).json({ error: 'Too many requests. Please slow down and try again shortly.' });
      return;
    }
    history.push(now);
    rateBuckets.set(key, history);
    next();
  };
}

export function logAudit(
  db: DatabaseSync,
  user: SessionPayload | undefined,
  action: string,
  entityType: string,
  entityId: string | number,
  details: string
): void {
  try {
    db.prepare(
      `INSERT INTO audit_logs (user_id, user_email, action, entity_type, entity_id, details, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      user?.userId ?? null,
      user?.email ?? 'system',
      action,
      entityType,
      String(entityId),
      details,
      new Date().toISOString()
    );
  } catch {
    // Non-fatal audit logging guard
  }
}
