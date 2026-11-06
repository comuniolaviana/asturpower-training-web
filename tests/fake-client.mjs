// Synthetic fixture client. Only imported from tests; no connection to Supabase.
export const IDs = { coach: '11111111-1111-4111-8111-111111111111', a: '22222222-2222-4222-8222-222222222222', b: '33333333-3333-4333-8333-333333333333' };
export function fakeClient({ role = 'coach', profile = true, signedIn = true, name = 'Álex Prueba', fail = false, delay = 0, roles = role ? [role] : [] } = {}) {
  const user = { id: role === 'athlete' ? IDs.a : IDs.coach, email: 'pruebas@example.test', user_metadata: { role: 'admin' } };
  const own = profile ? { user_id: user.id, display_name: name, created_at: '2026-11-02T12:00:00Z' } : null;
  const state = {
    signedIn, user, writes: [],
    tables: {
      profiles: [own, { user_id: IDs.a, display_name: 'Lucía Ejemplo' }, { user_id: IDs.b, display_name: 'Diego Prueba' }].filter(Boolean).filter((v, i, all) => all.findIndex(a => a.user_id === v.user_id) === i),
      user_roles: roles.map(role => ({ user_id: user.id, role })),
      coach_athletes: [
        { coach_id: IDs.coach, athlete_id: IDs.a, status: 'active', created_at: '2026-11-01T12:00:00Z' },
        { coach_id: IDs.coach, athlete_id: IDs.b, status: 'active', created_at: '2026-11-02T12:00:00Z' },
        { coach_id: IDs.coach, athlete_id: 'pending-example', status: 'pending', created_at: '2026-11-02T12:00:00Z' },
      ],
    },
  };
  const listeners = new Set();
  const emit = (event, session = state.signedIn ? { user } : null) => listeners.forEach(fn => fn(event, session));
  state.emitAuth = emit;
  const client = {
    state,
    auth: {
      async getUser() { return { data: { user: state.signedIn ? user : null }, error: null }; },
      async signInWithPassword({ password }) {
        if (password === 'invalid-test-input') return { error: { code: 'invalid_credentials' } };
        state.signedIn = true; emit('SIGNED_IN'); return { data: { user }, error: null };
      },
      async signOut() { state.signedIn = false; emit('SIGNED_OUT'); return { error: null }; },
      onAuthStateChange(fn) { listeners.add(fn); return { data: { subscription: { unsubscribe() { listeners.delete(fn); } } } }; },
    },
    from(table) {
      const filters = []; let write = null, value = null, one = false;
      const builder = {
        select() { return builder; },
        eq(key, v) { filters.push(row => row[key] === v); return builder; },
        in(key, vs) { filters.push(row => vs.includes(row[key])); return builder; },
        order() { return builder; },
        maybeSingle() { one = true; return builder; },
        single() { one = true; return builder; },
        insert(v) { write = 'insert'; value = v; return builder; },
        update(v) { write = 'update'; value = v; return builder; },
        async then(resolve, reject) {
          try {
            if (delay) await new Promise(r => setTimeout(r, delay));
            if (fail) return resolve({ data: null, error: { message: 'Database unreachable' } });
            let rows = state.tables[table].filter(row => filters.every(fn => fn(row)));
            if (write) {
              state.writes.push({ table, operation: write, value });
              if (write === 'insert') { rows = [{ ...value, created_at: '2026-11-02T12:00:00Z' }]; state.tables[table].push(...rows); }
              else rows.forEach(row => Object.assign(row, value));
            }
            resolve({ data: one ? rows[0] || null : rows.map(row => ({ ...row })), error: null });
          } catch (e) { reject(e); }
        },
      };
      return builder;
    },
  };
  return client;
}
