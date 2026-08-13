import { randomBytes, timingSafeEqual } from 'node:crypto';

const sessions = new Map();
const ttl = 12 * 60 * 60 * 1000;
const safe = ({ password, ...user }) => user;
const equal = (a, b) => { const x = Buffer.from(String(a)); const y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y); };

export function login(users, email, password) {
  const user = users.find(item => item.enabled && item.email.toLowerCase() === String(email).trim().toLowerCase());
  if (!user || !equal(user.password, password)) return null;
  const token = randomBytes(32).toString('hex');
  sessions.set(token, { userId: user.id, expiresAt: Date.now() + ttl });
  return { token, user: safe(user) };
}

export function currentUser(users, authorization = '') {
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  const session = sessions.get(token);
  if (!session || session.expiresAt <= Date.now()) { if (token) sessions.delete(token); return null; }
  const user = users.find(item => item.id === session.userId && item.enabled);
  return user ? safe(user) : null;
}

export function logout(authorization = '') { if (authorization.startsWith('Bearer ')) sessions.delete(authorization.slice(7)); }
