import test from 'node:test';
import assert from 'node:assert/strict';

// Temporary, read-only external availability probe from GitHub Actions.
test('probe Cloudflare public endpoints outside this environment', async () => {
  if (process.env.GITHUB_HEAD_REF !== 'fix/pwa-recuperacion-segura-20261108') return;
  const origin = 'https://asturpower-garmin-dev.asturpower-training.workers.dev';
  const endpoints = ['/', '/health', '/offline.html', '/sw.js', '/startup-recovery.js'];
  const results = [];
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(origin + endpoint, {
        headers: {'Cache-Control': 'no-cache'},
        signal: AbortSignal.timeout(7000),
        redirect: 'manual',
      });
      const type = response.headers.get('content-type') || '';
      const record = {path: endpoint, status: response.status, type: type.split(';')[0]};
      if (endpoint === '/health' && response.ok) {
        const json = await response.json();
        record.service = json?.service === 'asturpower-garmin-app' ? 'expected' : 'unexpected';
        record.diagnosticVersion = json?.diagnostic_version ?? null;
        record.configReady = json?.configuration_format_ready === true;
      } else if (endpoint === '/offline.html' && response.ok) {
        const html = await response.text();
        record.offlineVersion = html.includes('Ahora no hay conexión') ? 'old' :
          html.includes('No hemos podido abrir AsturPower') ? 'new' : 'unknown';
      } else if (endpoint === '/startup-recovery.js' && response.ok) {
        const js = await response.text();
        record.startupRecoveryScriptPresent = js.includes('Reabrir aplicación');
      } else if (endpoint === '/' && response.ok) {
        const html = await response.text();
        record.appShellPresent = html.includes('AsturPower Training');
      }
      results.push(record);
    } catch (error) {
      results.push({path: endpoint, error: error?.name || 'unknown'});
    }
  }
  console.log('ASTURPOWER_PUBLIC_PROBE=' + JSON.stringify(results));
  assert.equal(results.length, endpoints.length);
});
