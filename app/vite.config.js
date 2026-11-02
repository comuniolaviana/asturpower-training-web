import { defineConfig, loadEnv } from 'vite';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { resolvePublicConfig } from '../netlify/functions/public-config.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
const project = fileURLToPath(new URL('..', import.meta.url));
export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, project, ''), ...process.env };
  return {
    root,
    build: { outDir: '../dist-app', emptyOutDir: true, sourcemap: false },
    server: { allowedHosts: ['terminal.local'], fs: { allow: [project] } },
    plugins: [{
      name: 'asturpower-development-config',
      configureServer(server) {
        server.middlewares.use('/.netlify/functions/public-config', (req, res) => {
          const config = resolvePublicConfig(env);
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Cache-Control', 'no-store');
          if (req.method !== 'GET') { res.statusCode = 405; res.end('{}'); return; }
          res.statusCode = config ? 200 : 503;
          res.end(JSON.stringify(config || { error: 'Access unavailable' }));
        });
        // Fixture preview is development-only and explicitly enabled. Never bundled.
        if (env.ASTURPOWER_QA === 'true') server.middlewares.use('/__qa', async (req, res, next) => {
          const pathname = new URL(req.url || '/', 'http://local').pathname;
          if (!['/', '/mobile'].includes(pathname)) return next();
          const html = await readFile(new URL(pathname === '/mobile' ? '../tests/mobile-preview.html' : '../tests/preview.html', import.meta.url), 'utf8');
          res.setHeader('Content-Type', 'text/html');
          res.end(await server.transformIndexHtml('/__qa/', html.replace('__TEST_ENTRY__', `/@fs${fileURLToPath(new URL('../tests/preview.mjs', import.meta.url))}`)));
        });
      },
    }],
  };
});
