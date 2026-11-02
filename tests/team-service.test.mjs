import test from 'node:test';
import assert from 'node:assert/strict';
import { createTeamHandler, authenticateActor, createTeamRepository, TeamError } from '../netlify/lib/team-service.mjs';
import { requestTeam } from '../app/src/team-api.js';
import { renderTeamManagement } from '../app/src/team-ui.js';
import { fakeClient, IDs } from './fake-client.mjs';

const admin = '44444444-4444-4444-8444-444444444444';
const env = { ASTURPOWER_APP_ENABLED: 'true', ASTURPOWER_TEAM_ENABLED: 'true', SUPABASE_URL: 'https://fixture.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fixture', SUPABASE_SECRET_KEY: 'sb_secret_fixture' };
const req = (body, headers = {}, method = body ? 'POST' : 'GET') => new Request('https://app.example.test/.netlify/functions/team', {
  method, headers: { Authorization: 'Bearer synthetic_test_token', ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}),
});
function setup(role = 'admin', id = admin) {
  const calls = []; let factories = 0;
  const repository = Object.fromEntries(['assignRole', 'propose', 'accept', 'revoke'].map(name => [name, async (...args) => { calls.push([name, ...args]); }]));
  repository.directory = async page => { calls.push(['directory', page]); return { people: [], morePeople: false }; };
  repository.relationships = async (actor, page) => { calls.push(['relationships', actor, page]); return { links: [], moreLinks: false }; };
  const handler = createTeamHandler({ env, authenticate: async () => ({ id, roles: Array.isArray(role) ? role : [role] }), repositoryFactory: () => { factories++; return repository; } });
  return { handler, calls, repository, factories: () => factories };
}

test('team endpoint fails closed until explicitly enabled', async () => {
  let touched = false;
  const handler = createTeamHandler({ env: {}, authenticate: async () => { touched = true; } });
  assert.equal((await handler(req())).status, 503); assert.equal(touched, false);
});
test('no token or cross-origin request never reaches privileged repository', async () => {
  const t = setup();
  assert.equal((await t.handler(req(null, { Authorization: '' }))).status, 401);
  assert.equal((await t.handler(req(null, { Origin: 'https://attacker.example.test' }))).status, 403);
  assert.equal((await t.handler(req(null, { 'Sec-Fetch-Site': 'cross-site' }))).status, 403);
  assert.equal(t.factories(), 0);
});
test('verifies access token remotely and reads role from database', async () => {
  const client = fakeClient({ role: 'coach' }); let tokenSeen;
  client.auth.getUser = async token => { tokenSeen = token; return { data: { user: client.state.user }, error: null }; };
  const actor = await authenticateActor('synthetic_test_token', { supabaseUrl: env.SUPABASE_URL, publishableKey: env.SUPABASE_PUBLISHABLE_KEY }, () => client);
  assert.equal(tokenSeen, 'synthetic_test_token'); assert.deepEqual(actor.roles, ['coach']);
  assert.equal(client.state.user.user_metadata.role, 'admin');
});
test('invalid or anonymous identity and unassigned role are denied', async () => {
  const config = { supabaseUrl: env.SUPABASE_URL, publishableKey: env.SUPABASE_PUBLISHABLE_KEY };
  const unassigned = fakeClient({ role: null });
  await assert.rejects(() => authenticateActor('fixture', config, () => unassigned), e => e.status === 403);
  unassigned.auth.getUser = async () => ({ data: { user: null }, error: { message: 'Invalid token' } });
  await assert.rejects(() => authenticateActor('fixture', config, () => unassigned), e => e.status === 401);
  unassigned.auth.getUser = async () => ({ data: { user: { id: IDs.a, is_anonymous: true } }, error: null });
  await assert.rejects(() => authenticateActor('fixture', config, () => unassigned), e => e.status === 403);
});
test('admin can assign only coach or athlete, never admin or arbitrary fields', async () => {
  const t = setup();
  assert.equal((await t.handler(req({ action: 'assign_role', userId: IDs.a, role: 'athlete' }))).status, 200);
  assert.deepEqual(t.calls[0], ['assignRole', IDs.a, 'athlete']);
  assert.equal((await t.handler(req({ action: 'assign_role', userId: IDs.a, role: 'admin' }))).status, 400);
  assert.equal((await t.handler(req({ action: 'assign_role', userId: IDs.a, role: 'coach', extra: 'ignored?' }))).status, 400);
});
test('coach and athlete cannot assign roles or propose relationships', async () => {
  for (const role of ['coach', 'athlete']) {
    const t = setup(role, IDs.a);
    assert.equal((await t.handler(req({ action: 'assign_role', userId: IDs.b, role: 'coach' }))).status, 403);
    assert.equal((await t.handler(req({ action: 'propose', coachId: IDs.coach, athleteId: IDs.a }))).status, 403);
    assert.equal(t.factories(), 0);
  }
});
test('admin proposal cannot set an active status', async () => {
  const t = setup();
  assert.equal((await t.handler(req({ action: 'propose', coachId: IDs.coach, athleteId: IDs.a }))).status, 200);
  assert.deepEqual(t.calls[0], ['propose', IDs.coach, IDs.a]);
  assert.equal((await t.handler(req({ action: 'propose', coachId: IDs.coach, athleteId: IDs.a, status: 'active' }))).status, 400);
});
test('acceptance requires the athlete identity and explicit consent', async () => {
  const t = setup('athlete', IDs.a);
  assert.equal((await t.handler(req({ action: 'accept', coachId: IDs.coach, consent: false }))).status, 400);
  assert.equal((await t.handler(req({ action: 'accept', coachId: IDs.coach, consent: true }))).status, 200);
  assert.deepEqual(t.calls[0], ['accept', IDs.coach, IDs.a]);
  assert.equal((await t.handler(req({ action: 'accept', coachId: IDs.coach, athleteId: IDs.b, consent: true }))).status, 400);
  for (const role of ['admin', 'coach']) assert.equal((await setup(role).handler(req({ action: 'accept', coachId: IDs.coach, consent: true }))).status, 403);
});
test('revocation can only target an own relationship or an admin request', async () => {
  for (const [role, id] of [['coach', IDs.coach], ['athlete', IDs.a], ['admin', admin]]) {
    const t = setup(role, id);
    assert.equal((await t.handler(req({ action: 'revoke', coachId: IDs.coach, athleteId: IDs.a }))).status, 200);
  }
  const stranger = setup('athlete', IDs.b);
  assert.equal((await stranger.handler(req({ action: 'revoke', coachId: IDs.coach, athleteId: IDs.a }))).status, 403);
  assert.equal(stranger.factories(), 0);
});
test('non-admin list never returns a user directory', async () => {
  const t = setup('athlete', IDs.a);
  const response = await t.handler(req()); const body = await response.json();
  assert.deepEqual(body.people, []); assert.ok(!t.calls.some(c => c[0] === 'directory'));
  assert.deepEqual(t.calls[0][1], { id: IDs.a, role: 'athlete' });
});
test('invalid identity, malformed body and bad methods are rejected', async () => {
  const t = setup();
  assert.equal((await t.handler(req({ action: 'propose', coachId: 'not-a-uuid', athleteId: IDs.a }))).status, 400);
  assert.equal((await t.handler(req({ action: 'propose', coachId: IDs.a, athleteId: IDs.a }))).status, 400);
  assert.equal((await t.handler(req(null, {}, 'DELETE'))).status, 405);
  assert.equal((await t.handler(req({ action: 'anything', padding: 'x'.repeat(5000) }))).status, 413);
});
test('conflicts and unexpected exceptions expose no secrets or database details', async () => {
  const t = setup();
  t.repository.assignRole = async () => { throw new Error('private-secret-details'); };
  const response = await t.handler(req({ action: 'assign_role', userId: IDs.a, role: 'coach' }));
  assert.equal(response.status, 503); assert.ok(!(await response.text()).includes('private-secret-details'));
  t.repository.assignRole = async () => { throw new TeamError(409, 'state_conflict'); };
  assert.equal((await t.handler(req({ action: 'assign_role', userId: IDs.a, role: 'coach' }))).status, 409);
});
test('repository acceptance is a conditional pending-to-active update', async () => {
  const calls = [];
  const query = { update(value) { calls.push(['update', value]); return query; }, eq(...args) { calls.push(['eq', ...args]); return query; }, select() { return query; }, async maybeSingle() { return { data: { status: 'active' }, error: null }; } };
  const repository = createTeamRepository({ supabaseUrl: env.SUPABASE_URL }, 'synthetic-test-only', () => ({ from() { return query; } }));
  await repository.accept(IDs.coach, IDs.a);
  assert.deepEqual(calls, [['update', { status: 'active' }], ['eq', 'coach_id', IDs.coach], ['eq', 'athlete_id', IDs.a], ['eq', 'status', 'pending']]);
  query.maybeSingle = async () => ({ data: null, error: null });
  await assert.rejects(() => repository.accept(IDs.coach, IDs.a), e => e.status === 409);
});
test('client API transmits only user authorization and requested action', async () => {
  const client = { auth: { getSession: async () => ({ data: { session: { access_token: 'synthetic_test_token' } }, error: null }) } };
  let sent;
  await requestTeam(client, { action: 'accept', coachId: IDs.coach, consent: true }, 0, async (url, options) => { sent = { url, options }; return new Response('{"ok":true}'); });
  assert.equal(sent.options.headers.Authorization, 'Bearer synthetic_test_token');
  assert.equal(sent.options.method, 'POST'); assert.equal(sent.options.cache, 'no-store');
  assert.ok(!sent.options.body.includes('access_token'));
});
test('management UI shows consent review to athlete, not admin activation', () => {
  const team = { people: [], links: [{ coach_id: IDs.coach, athlete_id: IDs.a, coach_name: '<script>bad</script>', status: 'pending' }], page: 0, moreLinks: false, morePeople: false };
  const athlete = renderTeamManagement({ role: 'athlete', team });
  assert.ok(athlete.includes('Revisar propuesta')); assert.ok(!athlete.includes('<script>'));
  const adminView = renderTeamManagement({ role: 'admin', team });
  assert.ok(!adminView.includes('data-team-accept')); assert.ok(adminView.includes('Proponer relación'));
});
