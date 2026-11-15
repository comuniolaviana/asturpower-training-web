// Only non-sensitive UI choices. Authentication tokens are managed by Supabase.
const PREFIX = 'asturpower:ui:v1:';
const valid = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
const key = (userId, section) => valid(userId) && valid(section) ? PREFIX + userId + ':' + section : null;

export function readPreference(win, userId, section) {
  const name = key(userId, section);
  if (!name) return {};
  try {
    const raw = win?.localStorage?.getItem(name);
    if (!raw || raw.length > 4096) return {};
    const value = JSON.parse(raw);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch { return {}; }
}

export function savePreference(win, userId, section, patch) {
  const name = key(userId, section);
  if (!name || !patch || typeof patch !== 'object' || Array.isArray(patch)) return;
  try {
    const value = JSON.stringify({ ...readPreference(win, userId, section), ...patch });
    if (value.length <= 4096) win?.localStorage?.setItem(name, value);
  } catch { /* Browsers can block local storage; the application must still work. */ }
}

export function clearPreferences(win, userId) {
  if (!valid(userId)) return;
  try {
    const storage = win?.localStorage;
    const prefix = PREFIX + userId + ':';
    for (let i = storage.length - 1; i >= 0; i--) {
      const name = storage.key(i);
      if (name?.startsWith(prefix)) storage.removeItem(name);
    }
  } catch { /* Private mode must never block sign-out. */ }
}
