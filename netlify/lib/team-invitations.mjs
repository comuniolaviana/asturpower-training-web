// Codigos de invitacion seguros: 128 bits de entropia, SHA-256 en el servidor.
const CODE_PATTERN = /^[0-9a-f]{32}$/i;
export function normalizeInvitationCode(value) {
  const code = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return CODE_PATTERN.test(code) ? code : null;
}
export function generateInvitationCode() {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map(b => b.toString(16).padStart(2,'0')).join('');
}
export async function hashInvitationCode(code) {
  const normalized = normalizeInvitationCode(code);
  if (!normalized) throw new Error('invalid_invitation_code');
  const digest = await globalThis.crypto.subtle.digest('SHA-256',new TextEncoder().encode(normalized));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2,'0')).join('');
}
