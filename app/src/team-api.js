const messages = {
  sign_in_required: 'Vuelve a iniciar sesión para continuar.',
  access_denied: 'Tu cuenta no tiene permiso para esta operación.',
  state_conflict: 'El estado ha cambiado o ya existe esta vinculación. Actualiza la página.',
  invalid_request: 'Revisa los datos de la solicitud.',
  team_not_enabled: 'La gestión de vinculaciones aún no está habilitada.',
  invite_invalid: 'Este código no es válido, ha caducado o ya se ha utilizado. Pide otro al entrenador.',
  invite_limit: 'Ya tienes cinco invitaciones pendientes. Espera a que se utilicen o caduquen.',
  already_linked: 'Ya estás vinculado con este entrenador.',
};
export async function requestTeam(client, body = null, page = 0, fetcher = fetch, workspace = null) {
  const { data, error } = await client.auth.getSession();
  if (error || !data.session?.access_token) throw new Error(messages.sign_in_required);
  const params = new URLSearchParams({ page: String(page) });
  if (workspace) params.set('view', workspace);
  const response = await fetcher(`/.netlify/functions/team${body ? '' : `?${params}`}`, {
    method: body ? 'POST' : 'GET', cache: 'no-store', credentials: 'same-origin',
    headers: { Authorization: `Bearer ${data.session.access_token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(messages[payload.error] || 'No se ha podido completar la operación. Vuelve a intentarlo.');
  return payload;
}
