export const ROLE_LABELS = Object.freeze({ coach: 'Entrenador', athlete: 'Deportista', admin: 'Administrador' });
export function normalizeRoles(rows) {
  const values = Array.isArray(rows) ? rows.map(row => typeof row === 'string' ? row : row?.role) : [];
  return Object.keys(ROLE_LABELS).filter(role => values.includes(role));
}
export function chooseWorkspace(roles, preferred) {
  const allowed = normalizeRoles(roles);
  return allowed.includes(preferred) ? preferred : allowed[0] || null;
}
