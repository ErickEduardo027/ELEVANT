import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve('out');
const inlineScriptPattern = /<script\b(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script\s*>/gi;
const hashes = new Set();

async function visit(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await visit(file);
    else if (entry.isFile() && entry.name.endsWith('.html')) {
      const html = await readFile(file, 'utf8');
      for (const match of html.matchAll(inlineScriptPattern)) {
        if (match[1].trim()) {
          hashes.add(`'sha256-${createHash('sha256').update(match[1], 'utf8').digest('base64')}'`);
        }
      }
    }
  }
}

await visit(root);
await writeFile(path.join(root, '.csp-script-hashes'), [...hashes].sort().join(' ') || "'none'", 'utf8');
