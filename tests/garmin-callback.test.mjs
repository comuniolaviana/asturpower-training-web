import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../netlify/functions/garmin-callback.mjs';
const base = 'https://asturpower-training-dev.netlify.app/.netlify/functions/garmin-callback';

test('la dirección existe como página informativa sin habilitar OAuth', async () => {
  const res = await handler(new Request(base));
  assert.equal(res.status, 200);
  assert.match(await res.text(), /todavía no está habilitada/);
  assert.equal(res.headers.get('Cache-Control'), 'no-store, max-age=0');
});

test('si llega un código OAuth, se elimina de la URL sin usarlo', async () => {
  const res = await handler(new Request(base + '?code=NO_GUARDAR&state=NO_GUARDAR'));
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('Location'), '/.netlify/functions/garmin-callback');
  assert.doesNotMatch(res.headers.get('Location'), /NO_GUARDAR/);
});

test('rechaza otras peticiones y no acepta códigos por POST', async () => {
  const res = await handler(new Request(base, { method: 'POST' }));
  assert.equal(res.status, 405);
  assert.equal(res.headers.get('Allow'), 'GET');
});
