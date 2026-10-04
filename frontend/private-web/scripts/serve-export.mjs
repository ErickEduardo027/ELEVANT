import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('../out/', import.meta.url)));
const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'], ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'], ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'], ['.svg', 'image/svg+xml'], ['.webp', 'image/webp'],
  ['.woff', 'font/woff'], ['.woff2', 'font/woff2'], ['.mjs', 'text/javascript; charset=utf-8'],
]);
const port = Number(process.env.PORT || 3000);

createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const safePath = path.resolve(root, `.${pathname}`);
    if (safePath !== root && !safePath.startsWith(`${root}${path.sep}`)) {
      response.writeHead(403).end('Forbidden');
      return;
    }
    let file = safePath;
    if ((await stat(file).catch(() => null))?.isDirectory()) file = path.join(file, 'index.html');
    if (!(await stat(file).catch(() => null))?.isFile()) file = `${safePath}.html`;
    const body = await readFile(file);
    response.writeHead(200, { 'content-type': contentTypes.get(path.extname(file)) || 'application/octet-stream' });
    response.end(body);
  } catch {
    response.writeHead(404).end('Not found');
  }
}).listen(port, '127.0.0.1', () => process.stdout.write(`Static export listening on http://localhost:${port}\n`));
