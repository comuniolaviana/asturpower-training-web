import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { loadDashboard, saveProfile, validateName, messageFor } from '../app/src/data.js';
import { mountApp, showUnavailable } from '../app/src/ui.js';
import { fakeClient, IDs } from './fake-client.mjs';
import handler, { resolvePublicConfig } from '../netlify/functions/public-config.mjs';

const flush = async () => { for (let i = 0; i < 4; i++) await new Promise(r => setTimeout(r, 0)); };
const setup = options => {
  const dom = new JSDOM('<div id="app"></div>', { url: 'https://app.example.test' });
  const root = dom.window.document.querySelector('#app');
  const client = fakeClient(options);
  const dispose = mountApp(root, client);
  return { dom, root, client, dispose };
};

test('public config is disabled by default and accepts only publishable keys', () => {
  assert.equal(resolvePublicConfig({}), null);
  const env = { ASTURPOWER_APP_ENABLED: 'true', SUPABASE_URL: 'https://testproject.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fixture' };
  assert.deepEqual(Object.keys(resolvePublicConfig(env)).sort(), ['publishableKey', 'supabaseUrl']);
  for (const key of ['sb_secret_private', 'eyJhbGci.secret.jwt', '', 'sb_publishable_foo\n']) assert.equal(resolvePublicConfig({ ...env, SUPABASE_PUBLISHABLE_KEY: key }), null);
  for (const url of ['http://testproject.supabase.co', 'https://supabase.co.attacker.test', 'https://private@testproject.supabase.co', 'https://testproject.supabase.co/?secret=x', 'https://testproject.supabase.co/auth']) assert.equal(resolvePublicConfig({ ...env, SUPABASE_URL: url }), null);
});

test('config endpoint rejects writes and caches no configuration', async () => {
  const response = await handler(new Request('https://app.example.test/config', { method: 'POST' }));
  assert.equal(response.status, 405);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('role comes from database, never editable auth metadata', async () => {
  const client = fakeClient({ role: null });
  const dashboard = await loadDashboard(client, client.state.user);
  assert.equal(client.state.user.user_metadata.role, 'admin');
  assert.equal(dashboard.role, null);
  assert.deepEqual(dashboard.athletes, []);
});

test('coach loads names only for active relationships', async () => {
  const client = fakeClient();
  const result = await loadDashboard(client, client.state.user);
  assert.equal(result.relationships.length, 3);
  assert.equal(result.athletes.length, 2);
  assert.ok(result.athletes.every(a => [IDs.a, IDs.b].includes(a.user_id)));
});

test('athlete does not query names of coaches or other athletes', async () => {
  const client = fakeClient({ role: 'athlete' });
  const result = await loadDashboard(client, client.state.user);
  assert.equal(result.relationships.length, 1);
  assert.deepEqual(result.athletes, []);
});

test('profile updates contain only display_name and target the current user', async () => {
  const client = fakeClient();
  await saveProfile(client, client.state.user, '  Nombre nuevo  ', true);
  assert.deepEqual(client.state.writes[0], { table: 'profiles', operation: 'update', value: { display_name: 'Nombre nuevo' } });
  assert.equal(client.state.tables.profiles[0].display_name, 'Nombre nuevo');
  assert.equal(client.state.tables.profiles[1].display_name, 'Lucía Ejemplo');
});

test('profile creation cannot include role or timestamp', async () => {
  const client = fakeClient({ profile: false, role: null });
  await saveProfile(client, client.state.user, 'Nueva persona', false);
  assert.deepEqual(client.state.writes[0].value, { user_id: client.state.user.id, display_name: 'Nueva persona' });
  assert.throws(() => validateName('   '));
  assert.throws(() => validateName('x'.repeat(101)));
});

test('login presents no role selector or public registration', async () => {
  const t = setup({ signedIn: false }); await flush();
  assert.ok(t.root.querySelector('#login-form'));
  assert.equal(t.root.querySelector('select'), null);
  assert.equal(t.root.querySelector('[name=role]'), null);
  assert.ok(!t.root.textContent.includes('Lucía Ejemplo'));
  t.dispose();
});

test('coach dashboard supports search and escapes user text', async () => {
  const t = setup({ name: '<img src=x onerror=alert(1)>' }); await flush();
  assert.ok(t.root.textContent.includes('<img src=x onerror=alert(1)>'));
  assert.equal(t.root.querySelector('img'), null);
  assert.equal(t.root.querySelectorAll('.athlete-card').length, 2);
  const search = t.root.querySelector('#athlete-search'); search.value = 'lucía';
  search.dispatchEvent(new t.dom.window.Event('input', { bubbles: true }));
  assert.equal(t.root.querySelectorAll('.athlete-card').length, 1);
  assert.ok(t.root.querySelector('.athlete-card').textContent.includes('Lucía'));
  search.value = 'no existe'; search.dispatchEvent(new t.dom.window.Event('input', { bubbles: true }));
  assert.ok(t.root.textContent.includes('No encontramos ese nombre'));
  t.dispose();
});

test('unassigned account stays pending despite forged metadata', async () => {
  const t = setup({ role: null }); await flush();
  assert.ok(t.root.textContent.includes('pendiente de asignación'));
  assert.equal(t.root.querySelector('[data-view=team]'), null);
  t.dispose();
});

test('profile onboarding saves and moves to pending approval', async () => {
  const t = setup({ role: null, profile: false }); await flush();
  assert.ok(t.root.textContent.includes('¿Cómo te llamamos?'));
  t.root.querySelector('#display-name').value = 'Andrea Ejemplo';
  t.root.querySelector('#profile-form').dispatchEvent(new t.dom.window.Event('submit', { bubbles: true, cancelable: true }));
  await flush();
  assert.ok(t.root.textContent.includes('pendiente de asignación'));
  assert.ok(t.root.textContent.includes('Perfil guardado'));
  t.dispose();
});

test('logout immediately removes all private data', async () => {
  const t = setup({}); await flush();
  t.root.querySelector('[data-logout]').click(); await flush();
  assert.ok(t.root.querySelector('#login-form'));
  assert.ok(!t.root.textContent.includes('Lucía Ejemplo'));
  assert.equal(t.client.state.signedIn, false);
  t.dispose();
});

test('invalid login stays signed out and clears the password field', async () => {
  const t = setup({ signedIn: false }); await flush();
  t.root.querySelector('#email').value = 'fixture@example.test';
  t.root.querySelector('#password').value = 'invalid-test-input';
  t.root.querySelector('#login-form').dispatchEvent(new t.dom.window.Event('submit', { bubbles: true, cancelable: true }));
  await flush();
  assert.ok(t.root.querySelector('#login-message').textContent.includes('correo y la contraseña'));
  assert.equal(t.root.querySelector('#password').value, '');
  assert.equal(t.client.state.signedIn, false);
  t.dispose();
});

test('successful login opens the dashboard without granting a role', async () => {
  const t = setup({ signedIn: false, role: null }); await flush();
  t.root.querySelector('#email').value = 'fixture@example.test';
  t.root.querySelector('#password').value = 'synthetic-input-only';
  t.root.querySelector('#login-form').dispatchEvent(new t.dom.window.Event('submit', { bubbles: true, cancelable: true }));
  await flush();
  assert.ok(t.root.textContent.includes('pendiente de asignación'));
  assert.deepEqual(t.client.state.writes, []);
  t.dispose();
});

test('late in-flight load cannot restore data after logout', async () => {
  const t = setup({ delay: 20 });
  for (let attempt = 0; attempt < 30 && !t.root.querySelector('[data-refresh]'); attempt++) await new Promise(r => setTimeout(r, 10));
  assert.ok(t.root.querySelector('[data-refresh]'), 'Initial dashboard should have loaded');
  t.root.querySelector('[data-refresh]').click();
  // Auth SIGNED_OUT can arrive while database requests are still in flight.
  await t.client.auth.signOut();
  await new Promise(r => setTimeout(r, 100));
  assert.ok(t.root.querySelector('#login-form'));
  assert.ok(!t.root.textContent.includes('Lucía Ejemplo'));
  t.dispose();
});

test('failed logout removes private views and offers an explicit retry', async () => {
  const t = setup({}); await flush();
  t.client.auth.signOut = async () => ({ error: { message: 'Network unavailable' } });
  t.root.querySelector('[data-logout]').click(); await flush();
  assert.ok(t.root.querySelector('#login-form'));
  assert.ok(t.root.querySelector('[data-logout]').textContent.includes('Reintentar'));
  assert.ok(!t.root.textContent.includes('Lucía Ejemplo'));
  t.client.state.emitAuth('TOKEN_REFRESHED');
  await flush();
  assert.ok(t.root.querySelector('#login-form'), 'A failed logout must not silently restore the previous private view');
  t.dispose();
});

test('network error renders retry and never shows cached private rows', async () => {
  const t = setup({ fail: true }); await flush();
  assert.ok(t.root.textContent.includes('No hemos podido cargar tu espacio'));
  assert.ok(t.root.querySelector('[data-refresh]'));
  assert.ok(!t.root.textContent.includes('Lucía Ejemplo'));
  t.dispose();
});

test('same-account refresh and returning to the app preserve a running history import; normal refresh resumes afterwards', async () => {
  const t = setup({}); await flush();
  const importer = t.dom.window.document.createElement('section');
  importer.dataset.garminImportRunning = 'true'; t.root.append(importer);
  for (const event of ['TOKEN_REFRESHED', 'SIGNED_IN']) {
    t.client.state.emitAuth(event); await flush();
    assert.ok(importer.isConnected, event + ' must not discard the import');
  }
  Object.defineProperty(t.dom.window.document, 'visibilityState', { configurable: true, value: 'visible' });
  t.dom.window.document.dispatchEvent(new t.dom.window.Event('visibilitychange')); await flush();
  assert.ok(importer.isConnected, 'Returning from another app must preserve the importer');
  importer.dataset.garminImportRunning = 'false';
  t.client.state.emitAuth('TOKEN_REFRESHED'); await flush();
  assert.equal(importer.isConnected, false, 'Dashboard refresh resumes after the import');
  t.dispose();
});

test('active history import never prevents sign-out or a changed-account refresh', async () => {
  for (const changedAccount of [false, true]) {
    const t = setup({}); await flush();
    const importer = t.dom.window.document.createElement('section');
    importer.dataset.garminImportRunning = 'true'; t.root.append(importer);
    if (changedAccount) {
      const nextUser = {...t.client.state.user, id: IDs.b};
      t.client.auth.getUser = async () => ({data: {user: nextUser}, error: null});
      t.client.state.emitAuth('SIGNED_IN', {user: nextUser});
    }
    else await t.client.auth.signOut();
    await flush();
    assert.equal(importer.isConnected, false);
    if (!changedAccount) assert.ok(t.root.querySelector('#login-form'));
    t.dispose();
  }
});

test('backend errors are not exposed in user messages', () => {
  assert.ok(!messageFor({ message: 'private details', status: 500 }).includes('private details'));
  assert.ok(messageFor({ code: 'invalid_credentials' }).includes('correo y la contraseña'));
  assert.ok(messageFor({ status: 429 }).includes('Demasiados intentos'));
});

test('unconfigured app offers contact rather than a broken login', () => {
  const dom = new JSDOM('<main></main>'); const root = dom.window.document.querySelector('main');
  showUnavailable(root);
  assert.equal(root.querySelector('form'), null);
  assert.ok(root.textContent.includes('aún no está disponible'));
});
