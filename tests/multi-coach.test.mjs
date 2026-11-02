import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { normalizeRoles, chooseWorkspace } from '../shared/roles.mjs';
import { loadDashboard } from '../app/src/data.js';
import { mountApp } from '../app/src/ui.js';
import { authenticateActor, createTeamHandler, createTeamRepository } from '../netlify/lib/team-service.mjs';
import { fakeClient, IDs } from './fake-client.mjs';

const otherCoach = '44444444-4444-4444-8444-444444444444';
const otherAthlete = '55555555-5555-4555-8555-555555555555';
const env = { ASTURPOWER_APP_ENABLED: 'true', ASTURPOWER_TEAM_ENABLED: 'true', SUPABASE_URL: 'https://fixture.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fixture', SUPABASE_SECRET_KEY: 'sb_secret_fixture' };
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise(r => setTimeout(r, 0)); };
function multiClient() {
  const client = fakeClient({ roles: ['coach', 'athlete'] });
  client.state.tables.profiles.push({ user_id: otherCoach, display_name: 'Entrenador B ficticio' }, { user_id: otherAthlete, display_name: 'Deportista ajeno ficticio' });
  client.state.tables.coach_athletes.push({ coach_id: otherCoach, athlete_id: otherAthlete, status: 'active' }, { coach_id: otherCoach, athlete_id: IDs.coach, status: 'active' });
  return client;
}
test('roles are a set of known memberships; preference never grants privileges', () => {
  assert.deepEqual(normalizeRoles([{ role: 'athlete' }, { role: 'coach' }, { role: 'owner' }, { role: 'coach' }]), ['coach', 'athlete']);
  assert.equal(chooseWorkspace(['coach', 'athlete'], 'admin'), 'coach');
  assert.equal(chooseWorkspace(['coach', 'athlete'], 'athlete'), 'athlete');
  assert.equal(chooseWorkspace([], 'admin'), null);
});
test('dual coach view never loads another coach portfolio or incoming athlete links', async () => {
  const client = multiClient();
  const result = await loadDashboard(client, client.state.user, 'coach');
  assert.deepEqual(result.roles, ['coach', 'athlete']);
  assert.ok(result.relationships.every(r => r.coach_id === IDs.coach));
  assert.ok(result.athletes.every(p => p.user_id !== otherAthlete));
  assert.equal(result.athletes.length, 2);
});
test('dual athlete view contains only own incoming relationships', async () => {
  const client = multiClient();
  const result = await loadDashboard(client, client.state.user, 'athlete');
  assert.equal(result.role, 'athlete'); assert.deepEqual(result.athletes, []);
  assert.equal(result.relationships.length, 1);
  assert.equal(result.relationships[0].coach_id, otherCoach);
  assert.equal(result.relationships[0].athlete_id, IDs.coach);
});
test('switching workspaces clears previous roster and exposes only granted views', async () => {
  const dom = new JSDOM('<div id="app"></div>');
  const root = dom.window.document.querySelector('#app');
  const dispose = mountApp(root, multiClient()); await flush();
  const select = root.querySelector('#workspace-role');
  assert.deepEqual([...select.options].map(o => o.value), ['coach', 'athlete']);
  assert.equal(root.querySelectorAll('.athlete-card').length, 2);
  select.value = 'athlete'; select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  await flush();
  assert.equal(root.querySelector('#workspace-role').value, 'athlete');
  assert.equal(root.querySelector('[data-view=team]'), null);
  assert.equal(root.querySelectorAll('.athlete-card').length, 0);
  assert.ok(root.textContent.includes('Mis vinculaciones'));
  assert.ok(!root.textContent.includes('Deportista ajeno ficticio'));
  dispose();
});
test('server verifies and returns multiple memberships without choosing admin implicitly', async () => {
  const client = multiClient();
  const actor = await authenticateActor('fixture_token', { supabaseUrl: env.SUPABASE_URL, publishableKey: env.SUPABASE_PUBLISHABLE_KEY }, () => client);
  assert.deepEqual(actor, { id: IDs.coach, roles: ['coach', 'athlete'] });
});
function handlerFixture(roles) {
  const calls = [];
  const handler = createTeamHandler({ env,
    authenticate: async () => ({ id: IDs.coach, roles }),
    repositoryFactory: () => ({
      relationships: async actor => { calls.push(actor); return { links: [], moreLinks: false }; },
      directory: async () => { calls.push('directory'); return { people: [], morePeople: false }; },
      accept: async (...args) => { calls.push(['accept', ...args]); },
    }),
  });
  const request = (view, body) => new Request(`https://app.example.test/.netlify/functions/team${view ? `?view=${view}` : ''}`, {
    method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer fixture_access_token', ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { handler, calls, request };
}
test('server refuses a forged workspace before privileged data access', async () => {
  const t = handlerFixture(['coach', 'athlete']);
  assert.equal((await t.handler(t.request('admin'))).status, 403);
  assert.deepEqual(t.calls, []);
});
test('server scopes dual identities to the requested authorized workspace', async () => {
  const t = handlerFixture(['coach', 'athlete']);
  const response = await t.handler(t.request('athlete'));
  assert.equal(response.status, 200); assert.equal((await response.json()).view, 'athlete');
  assert.deepEqual(t.calls, [{ id: IDs.coach, role: 'athlete' }]);
});
test('admin membership does not reveal directory in a coach workspace', async () => {
  const t = handlerFixture(['admin', 'coach']);
  await t.handler(t.request('coach')); assert.ok(!t.calls.includes('directory'));
  await t.handler(t.request('admin')); assert.ok(t.calls.includes('directory'));
});
test('dual identity accepts only as itself, not another athlete', async () => {
  const t = handlerFixture(['coach', 'athlete']);
  const body = { action: 'accept', coachId: otherCoach, consent: true };
  assert.equal((await t.handler(t.request(null, body))).status, 200);
  assert.deepEqual(t.calls, [['accept', otherCoach, IDs.coach]]);
  assert.equal((await t.handler(t.request(null, { ...body, athleteId: otherAthlete }))).status, 400);
});
test('server repository applies coach ID filter and hides pending athlete names', async () => {
  const requested = [];
  const links = [{ coach_id: IDs.coach, athlete_id: IDs.a, status: 'active' }, { coach_id: IDs.coach, athlete_id: IDs.b, status: 'pending' }];
  const service = { from(table) {
    const q = { select() { return q; }, order() { return q; }, eq(key, value) { requested.push(['eq', table, key, value]); return q; },
      async range() { return { data: links, error: null }; },
      async in(key, values) { requested.push(['in', table, key, values]); return { data: [{ user_id: IDs.a, display_name: 'Visible' }], error: null }; },
    }; return q;
  } };
  const repository = createTeamRepository({ supabaseUrl: env.SUPABASE_URL }, 'fixture', () => service);
  const result = await repository.relationships({ id: IDs.coach, role: 'coach' }, 0);
  assert.ok(requested.some(c => c[0] === 'eq' && c[2] === 'coach_id' && c[3] === IDs.coach));
  assert.deepEqual(requested.find(c => c[0] === 'in')[3], [IDs.a]);
  assert.equal(result.links[1].athlete_name, null);
});
