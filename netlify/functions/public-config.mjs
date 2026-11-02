// Public configuration only. No service_role, JWT or Garmin secrets are accepted.
export function resolvePublicConfig(env) {
  if (env.ASTURPOWER_APP_ENABLED !== 'true') return null;
  try {
    const url = new URL(env.SUPABASE_URL);
    const key = env.SUPABASE_PUBLISHABLE_KEY || '';
    if (url.protocol !== 'https:' || !/^[a-z0-9]+\.supabase\.co$/.test(url.hostname)
      || url.username || url.password || url.port || url.search || url.hash
      || url.pathname !== '/' || !/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) return null;
    return { supabaseUrl: url.origin, publishableKey: key };
  } catch { return null; }
}

export default async function handler(request) {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
  if (request.method !== 'GET') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { ...headers, Allow: 'GET' } });
  const config = resolvePublicConfig(process.env);
  return new Response(JSON.stringify(config || { error: 'Access unavailable' }), { status: config ? 200 : 503, headers });
}
