import { randomBytes } from 'node:crypto';

const sessions = new Map();

function normalizeEmail(email) {
  return String(email ?? '').trim().toLowerCase();
}

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    roleLabel: user.roleLabel,
    ...(user.personnelId ? { personnelId: user.personnelId } : {}),
  };
}

export function authenticate(users, credentials) {
  const email = normalizeEmail(credentials?.email);
  const user = users.find(candidate => normalizeEmail(candidate.email) === email);

  if (!user || !user.active || user.password !== credentials?.password) return null;

  const token = randomBytes(32).toString('hex');
  const session = {
    token,
    userId: user.id,
    createdAt: new Date().toISOString(),
  };
  sessions.set(token, session);

  return { token, user: publicUser(user) };
}

export function getBearerToken(authorization = '') {
  const match = String(authorization).match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
}

export function resolveSession(users, authorization) {
  const token = getBearerToken(authorization);
  const session = token ? sessions.get(token) : null;
  if (!session) return null;

  const user = users.find(candidate => candidate.id === session.userId && candidate.active);
  return user ? { token, user: publicUser(user) } : null;
}

export function closeSession(authorization) {
  const token = getBearerToken(authorization);
  return token ? sessions.delete(token) : false;
}

export function resetSessionsForTests() {
  sessions.clear();
}
