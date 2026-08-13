import { createServer } from 'node:http';
import { authenticate, closeSession, resolveSession } from './auth.js';

function applyCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
}

function sendJson(res, statusCode, payload) {
  applyCors(res);
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return {};

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw Object.assign(new Error('El cuerpo debe contener JSON válido.'), { statusCode: 400 });
  }
}

export function createApp({ store }) {
  return createServer(async (req, res) => {
    try {
      if (req.method === 'OPTIONS') {
        applyCors(res);
        res.writeHead(204);
        return res.end();
      }

      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

      if (req.method === 'GET' && url.pathname === '/health') {
        const state = await store.read();
        return sendJson(res, 200, {
          status: 'ok',
          service: 'elevant-backend-prototipo',
          schemaVersion: state.schemaVersion,
          persistence: 'json-local',
          timestamp: new Date().toISOString(),
        });
      }

      if (req.method === 'GET' && url.pathname === '/api/system/info') {
        const state = await store.read();
        return sendJson(res, 200, {
          schemaVersion: state.schemaVersion,
          createdAt: state.createdAt,
          updatedAt: state.updatedAt,
        });
      }

      if (req.method === 'POST' && url.pathname === '/api/auth/login') {
        const state = await store.read();
        const credentials = await readJsonBody(req);
        const session = authenticate(state.users, credentials);

        if (!session) return sendJson(res, 401, { error: 'Credenciales inválidas.' });
        return sendJson(res, 200, session);
      }

      if (req.method === 'GET' && url.pathname === '/api/auth/session') {
        const state = await store.read();
        const session = resolveSession(state.users, req.headers.authorization);
        if (!session) return sendJson(res, 401, { error: 'Sesión inválida o finalizada.' });
        return sendJson(res, 200, session);
      }

      if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
        closeSession(req.headers.authorization);
        return sendJson(res, 200, { ok: true });
      }

      return sendJson(res, 404, { error: 'Ruta no encontrada.' });
    } catch (error) {
      console.error(error);
      return sendJson(res, error.statusCode ?? 500, {
        error: error.statusCode ? error.message : 'Error interno del prototipo.',
      });
    }
  });
}
