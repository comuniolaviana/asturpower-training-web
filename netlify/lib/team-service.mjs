import { normalizeRoles, chooseWorkspace } from '../../shared/roles.mjs';
import { createClient } from '@supabase/supabase-js';
import { resolvePublicConfig } from '../functions/public-config.mjs';

export class TeamError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}
const requireValue = (ok, status = 400, code = 'invalid_request') => { if (!ok) throw new TeamError(status, code); };
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
function result(value) {
  if (value.error) {
    if (['23505', '23503', '23514'].includes(value.error.code)) throw new TeamError(409, 'state_conflict');
    throw new TeamError(503, 'temporarily_unavailable');
  }
  return value.data;
}

export async function authenticateActor(token, config, clientFactory = createClient) {
  const client = clientFactory(config.supabaseUrl, config.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const verified = await client.auth.getUser(token);
  requireValue(!verified.error && verified.data?.user, 401, 'sign_in_required');
  const user = verified.data.user;
  requireValue(!user.is_anonymous, 403, 'access_denied');
  const roles = normalizeRoles(result(await client.from('user_roles').select('role').eq('user_id', user.id)));
  requireValue(roles.length, 403, 'access_denied');
  return { id: user.id, roles };
}

export function createTeamRepository(config, secret, clientFactory = createClient) {
  // Separate server client: it never inherits a caller's Authorization header.
  const service = clientFactory(config.supabaseUrl, secret, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return {
    async directory(page) {
      const rows = result(await service.from('profiles').select('user_id,display_name,user_roles(role)')
        .order('user_id').range(page * 50, page * 50 + 50)) || [];
      return { people: rows.slice(0, 50).map(p => ({ id: p.user_id, name: p.display_name,
        roles: normalizeRoles(Array.isArray(p.user_roles) ? p.user_roles : p.user_roles ? [p.user_roles] : []) })), morePeople: rows.length > 50 };
    },
    async relationships(actor, page) {
      let query = service.from('coach_athletes').select('coach_id,athlete_id,status,created_at').order('coach_id').order('athlete_id');
      if (actor.role !== 'admin') query = query.eq(actor.role === 'coach' ? 'coach_id' : 'athlete_id', actor.id);
      const rows = result(await query.range(page * 50, page * 50 + 50)) || [];
      const links = rows.slice(0, 50);
      // Only an admin or the athlete sees the coach name for pending approval.
      // Coaches see an athlete name only while their relationship is active.
      const ids = [...new Set(links.flatMap(r => actor.role === 'coach'
        ? (r.status === 'active' ? [r.athlete_id] : [])
        : actor.role === 'athlete' ? [r.coach_id] : [r.coach_id, r.athlete_id]))];
      const profiles = ids.length ? result(await service.from('profiles').select('user_id,display_name').in('user_id', ids)) || [] : [];
      const names = new Map(profiles.map(p => [p.user_id, p.display_name]));
      return { links: links.map(r => ({ ...r, coach_name: names.get(r.coach_id) || null, athlete_name: names.get(r.athlete_id) || null })), moreLinks: rows.length > 50 };
    },
    async assignRole(userId, role) {
      result(await service.from('user_roles').insert({ user_id: userId, role }));
    },
    async propose(coachId, athleteId) {
      const previous = result(await service.from('coach_athletes').select('status').eq('coach_id', coachId).eq('athlete_id', athleteId).maybeSingle());
      if (!previous) { result(await service.from('coach_athletes').insert({ coach_id: coachId, athlete_id: athleteId, status: 'pending' })); return; }
      requireValue(previous.status === 'revoked', 409, 'state_conflict');
      const changed = result(await service.from('coach_athletes').update({ status: 'pending' })
        .eq('coach_id', coachId).eq('athlete_id', athleteId).eq('status', 'revoked').select('status').maybeSingle());
      requireValue(changed, 409, 'state_conflict');
    },
    async accept(coachId, athleteId) {
      const changed = result(await service.from('coach_athletes').update({ status: 'active' })
        .eq('coach_id', coachId).eq('athlete_id', athleteId).eq('status', 'pending').select('status').maybeSingle());
      requireValue(changed, 409, 'state_conflict');
    },
    async revoke(coachId, athleteId) {
      const changed = result(await service.from('coach_athletes').update({ status: 'revoked' })
        .eq('coach_id', coachId).eq('athlete_id', athleteId).in('status', ['pending', 'active']).select('status').maybeSingle());
      requireValue(changed, 409, 'state_conflict');
    },
  };
}

function validateBody(body) {
  requireValue(body && typeof body === 'object' && !Array.isArray(body));
  const allowed = {
    assign_role: ['action', 'userId', 'role'],
    propose: ['action', 'coachId', 'athleteId'],
    accept: ['action', 'coachId', 'consent'],
    revoke: ['action', 'coachId', 'athleteId'],
  };
  requireValue(Object.hasOwn(allowed, body.action));
  requireValue(Object.keys(body).every(key => allowed[body.action].includes(key)));
  if (body.action === 'assign_role') requireValue(uuid(body.userId) && ['coach', 'athlete'].includes(body.role));
  else {
    requireValue(uuid(body.coachId));
    if (body.action === 'accept') requireValue(body.consent === true);
    else requireValue(uuid(body.athleteId) && body.coachId !== body.athleteId);
  }
}

export function createTeamHandler({ env = process.env, authenticate = authenticateActor, repositoryFactory = createTeamRepository } = {}) {
  return async request => {
    const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
    try {
      requireValue(['GET', 'POST'].includes(request.method), 405, 'method_not_allowed');
      const config = resolvePublicConfig(env);
      requireValue(config && env.ASTURPOWER_TEAM_ENABLED === 'true' && /^sb_secret_[A-Za-z0-9_-]+$/.test(env.SUPABASE_SECRET_KEY || ''), 503, 'team_not_enabled');
      const origin = request.headers.get('origin');
      requireValue(!origin || origin === new URL(request.url).origin, 403, 'access_denied');
      requireValue(request.headers.get('sec-fetch-site') !== 'cross-site', 403, 'access_denied');
      const match = /^Bearer ([A-Za-z0-9._-]{10,20000})$/.exec(request.headers.get('authorization') || '');
      requireValue(match, 401, 'sign_in_required');
      const actor = await authenticate(match[1], config);
      const roles = normalizeRoles(actor.roles);
      requireValue(uuid(actor.id) && roles.length, 403, 'access_denied');
      const requestedView = new URL(request.url).searchParams.get('view');
      requireValue(!requestedView || roles.includes(requestedView), 403, 'access_denied');
      const view = chooseWorkspace(roles, requestedView);
      let body = null;
      if (request.method === 'POST') {
        requireValue(request.headers.get('content-type')?.split(';')[0] === 'application/json');
        const text = await request.text(); requireValue(text.length <= 4096, 413, 'request_too_large');
        try { body = JSON.parse(text); } catch { throw new TeamError(400, 'invalid_request'); }
        validateBody(body);
        if (['assign_role', 'propose'].includes(body.action)) requireValue(roles.includes('admin'), 403, 'access_denied');
        if (body.action === 'accept') requireValue(roles.includes('athlete'), 403, 'access_denied');
        if (body.action === 'revoke') requireValue(roles.includes('admin')
          || (roles.includes('coach') && actor.id === body.coachId)
          || (roles.includes('athlete') && actor.id === body.athleteId), 403, 'access_denied');
      }
      const repository = repositoryFactory(config, env.SUPABASE_SECRET_KEY);
      if (!body) {
        const pageString = new URL(request.url).searchParams.get('page') || '0';
        requireValue(/^\d{1,4}$/.test(pageString));
        const page = Number(pageString);
        const relations = await repository.relationships({ id: actor.id, role: view }, page);
        const directory = view === 'admin' ? await repository.directory(page) : { people: [], morePeople: false };
        return new Response(JSON.stringify({ ...directory, ...relations, page, view }), { headers });
      }
      if (body.action === 'assign_role') await repository.assignRole(body.userId, body.role);
      if (body.action === 'propose') await repository.propose(body.coachId, body.athleteId);
      if (body.action === 'accept') await repository.accept(body.coachId, actor.id);
      if (body.action === 'revoke') await repository.revoke(body.coachId, body.athleteId);
      return new Response(JSON.stringify({ ok: true }), { headers });
    } catch (error) {
      const status = error instanceof TeamError ? error.status : 503;
      const code = error instanceof TeamError ? error.code : 'temporarily_unavailable';
      return new Response(JSON.stringify({ error: code }), { status, headers });
    }
  };
}
