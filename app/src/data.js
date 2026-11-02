import { ROLE_LABELS, normalizeRoles, chooseWorkspace } from '../../shared/roles.mjs';
export { ROLE_LABELS };
export const STATUS_LABELS = { active: 'Activa', pending: 'Pendiente', revoked: 'Revocada' };

function checked(result) {
  if (result.error) throw result.error;
  return result.data;
}

export function validateName(value) {
  const name = value.trim();
  if (!name || [...name].length > 100) throw new Error('Escribe un nombre de entre 1 y 100 caracteres.');
  return name;
}

// RLS is the authority. Roles always come from user_roles, never user_metadata.
export async function loadDashboard(client, user, preferredRole = null) {
  const [profileResult, roleResult] = await Promise.all([
    client.from('profiles').select('user_id,display_name,created_at').eq('user_id', user.id).maybeSingle(),
    client.from('user_roles').select('role').eq('user_id', user.id),
  ]);
  const profile = checked(profileResult);
  const roles = normalizeRoles(checked(roleResult));
  const role = chooseWorkspace(roles, preferredRole);
  if (!profile || !role || role === 'admin') return { profile, role, roles, relationships: [], athletes: [] };
  const relationships = checked(await client.from('coach_athletes')
    .select('coach_id,athlete_id,status,created_at')
    .eq(role === 'coach' ? 'coach_id' : 'athlete_id', user.id)
    .order('created_at', { ascending: false })) || [];
  const ids = role === 'coach' ? relationships.filter(r => r.status === 'active').map(r => r.athlete_id) : [];
  const athletes = ids.length ? checked(await client.from('profiles')
    .select('user_id,display_name').in('user_id', ids).order('display_name')) || [] : [];
  return { profile, role, roles, relationships, athletes };
}

export async function saveProfile(client, user, value, exists) {
  const display_name = validateName(value);
  const query = exists
    ? client.from('profiles').update({ display_name }).eq('user_id', user.id)
    : client.from('profiles').insert({ user_id: user.id, display_name });
  const row = checked(await query.select('user_id,display_name,created_at').single());
  if (!row || row.user_id !== user.id) throw new Error('No se ha podido guardar el perfil.');
  return row;
}

export function messageFor(error) {
  if (error?.code === 'invalid_credentials') return 'No hemos podido iniciar sesión. Revisa el correo y la contraseña.';
  if (error?.code === 'email_not_confirmed') return 'Confirma tu correo antes de entrar.';
  if (error?.status === 429 || error?.code === 'over_request_rate_limit') return 'Demasiados intentos. Espera un momento antes de volver a probar.';
  return 'No hemos podido completar la operación. Comprueba tu conexión y vuelve a intentarlo.';
}
