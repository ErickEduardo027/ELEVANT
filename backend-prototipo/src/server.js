import { createServer } from 'node:http';
import { login, currentUser, logout } from './auth.js';
import { readStore, updateStore, resetStore, runtimePath } from './store.js';
import * as flow from './workflow.js';
import { excel, pdf } from './reports.js';

const port = Number(process.env.PROTOTYPE_PORT || 4310);
const host = process.env.PROTOTYPE_HOST || '0.0.0.0';
const readableCollections = new Set([
  'airlines', 'serviceRequests', 'contracts', 'contractServices', 'personnel',
  'hrAllocations', 'flights', 'assignments', 'operations', 'incidents',
  'executedServices', 'reviews', 'preinvoices', 'reconciliations',
  'documents', 'notifications', 'audit',
  'mobileSyncRecords',
]);

function send(res, status, value) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type, authorization',
    'access-control-allow-methods': 'GET,POST,PATCH,OPTIONS',
  });
  res.end(JSON.stringify(value));
}

async function body(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  try { return chunks.length ? JSON.parse(Buffer.concat(chunks)) : {}; }
  catch { throw Object.assign(new Error('JSON inválido.'), { status: 400 }); }
}

function requireRole(user, ...allowed) {
  if (!allowed.includes(user.role)) throw Object.assign(new Error('Acceso denegado.'), { status: 403 });
}

createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') return send(res, 204, {});
    const url = new URL(req.url, `http://${req.headers.host}`);
    const path = url.pathname.replace(/\/$/, '') || '/';

    if (path === '/health') return send(res, 200, { status: 'ok', runtimePath });
    if (path === '/api/auth/login') {
      const input = await body(req);
      const data = await readStore();
      const session = login(data.users, input.email, input.password);
      return session ? send(res, 200, session) : send(res, 401, { error: 'Credenciales inválidas.' });
    }
    if (path === '/api/auth/logout') {
      logout(req.headers.authorization);
      return send(res, 200, { ok: true });
    }
    if (path === '/api/airline/requests' && req.method === 'POST') {
      const input = await body(req);
      return send(res, 201, await updateStore(data => flow.submitRequest(data, input)));
    }

    const snapshot = await readStore();
    const user = currentUser(snapshot.users, req.headers.authorization);
    if (!user) return send(res, 401, { error: 'Autenticación requerida.' });
    if (path === '/api/bootstrap') return send(res, 200, { ...snapshot, users: undefined, currentUser: user, summary: flow.summary(snapshot) });

    let match;
    if ((match = path.match(/^\/api\/data\/([A-Za-z]+)$/))) {
      if (!readableCollections.has(match[1])) return send(res, 404, { error: 'Colección no disponible.' });
      return send(res, 200, snapshot[match[1]]);
    }
    if ((match = path.match(/^\/api\/requests\/([^/]+)\/review$/))) {
      requireRole(user, 'CONTRATOS');
      return send(res, 200, await updateStore(data => flow.reviewRequest(data, match[1], user)));
    }
    if ((match = path.match(/^\/api\/requests\/([^/]+)\/decision$/))) {
      requireRole(user, 'CONTRATOS');
      const input = await body(req);
      return send(res, 200, await updateStore(data => flow.decideRequest(data, match[1], input, user)));
    }
    if (path === '/api/hr/allocations') {
      requireRole(user, 'GESTION_HUMANA');
      const input = await body(req);
      return send(res, 201, await updateStore(data => flow.allocatePersonnel(data, input, user)));
    }
    if ((match = path.match(/^\/api\/flights\/([^/]+)\/assign$/))) {
      requireRole(user, 'ADMIN_OCC');
      const input = await body(req);
      return send(res, 201, await updateStore(data => flow.assignFlight(data, match[1], input, user)));
    }
    if ((match = path.match(/^\/api\/flights\/([^/]+)\/start$/))) {
      const input = await body(req);
      return send(res, 201, await updateStore(data => flow.startOperation(data, match[1], input, user)));
    }
    if ((match = path.match(/^\/api\/operations\/([^/]+)\/complete$/))) {
      const input = await body(req);
      return send(res, 200, await updateStore(data => flow.completeOperation(data, match[1], input, user)));
    }
    if (path === '/api/incidents') {
      const input = await body(req);
      return send(res, 201, await updateStore(data => flow.addIncident(data, input, user)));
    }
    if ((match = path.match(/^\/api\/operations\/([^/]+)\/review$/))) {
      requireRole(user, 'ADMIN_OCC');
      const input = await body(req);
      return send(res, 200, await updateStore(data => flow.reviewOperation(data, match[1], input, user)));
    }
    if (path === '/api/preinvoices') {
      requireRole(user, 'FINANZAS');
      const input = await body(req);
      return send(res, 201, await updateStore(data => flow.generatePreinvoice(data, input, user)));
    }
    if ((match = path.match(/^\/api\/preinvoices\/([^/]+)\/(approve|send)$/))) {
      requireRole(user, 'FINANZAS');
      return send(res, 200, await updateStore(data => flow.transitionPreinvoice(data, match[1], match[2], user)));
    }
    if (path === '/api/chats' && req.method === 'GET') {
      return send(res, 200, snapshot.chats.filter(chat => chat.participants.includes(user.role)).map(chat => ({ ...chat, messages: snapshot.messages.filter(message => message.chatId === chat.id) })));
    }
    if (path === '/api/chats' && req.method === 'POST') {
      const input = await body(req);
      return send(res, 201, await updateStore(data => flow.createChat(data, input, user)));
    }
    if ((match = path.match(/^\/api\/chats\/([^/]+)\/messages$/))) {
      const input = await body(req);
      return send(res, 201, await updateStore(data => flow.sendMessage(data, match[1], input, user)));
    }
    if (path === '/api/mobile/sync' && req.method === 'POST') {
      const input = await body(req);
      return send(res, 200, await updateStore(data => flow.synchronizeMobile(data, input.items, user)));
    }
    if (path === '/api/reports/export') {
      const format = url.searchParams.get('format');
      const buffer = format === 'excel' ? await excel(snapshot) : await pdf(snapshot);
      const extension = format === 'excel' ? 'xlsx' : 'pdf';
      res.writeHead(200, {
        'content-type': format === 'excel' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/pdf',
        'content-disposition': `attachment; filename=elevant.${extension}`,
      });
      return res.end(buffer);
    }
    if (path === '/api/admin/reset') {
      requireRole(user, 'ADMIN_OCC');
      return send(res, 200, await resetStore());
    }
    return send(res, 404, { error: 'Ruta no encontrada.' });
  } catch (error) {
    return send(res, error.status || 400, { error: error.message });
  }
}).listen(port, host, () => console.log(`ELEVANT backend prototipo: http://localhost:${port}`));
