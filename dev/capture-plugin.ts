import fs from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';

/**
 * Dev-server only: POST /__capture?name=foo with a PNG body writes review/captures/foo.png.
 * The page's capture mode (?capture) posts its canvas here, so screenshots come from the real GPU
 * path in the browser and land where the review tooling can read them.
 */
export function capturePlugin(): Plugin {
  return {
    name: 'glass-capture',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__capture', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end();
          return;
        }
        const url = new URL(req.url ?? '/', 'http://localhost');
        const name = (url.searchParams.get('name') ?? 'capture').replace(/[^a-z0-9_-]/gi, '') || 'capture';
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => {
          const dir = path.resolve(server.config.root, 'review/captures');
          fs.mkdirSync(dir, { recursive: true });
          const file = path.join(dir, `${name}.png`);
          fs.writeFileSync(file, Buffer.concat(chunks));
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ ok: true, file }));
        });
      });
    },
  };
}
