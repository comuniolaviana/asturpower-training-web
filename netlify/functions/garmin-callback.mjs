// Punto de retorno reservado para Garmin Connect OAuth2 PKCE.
// Hasta activar el flujo completo en el servidor, NO procesa códigos ni tokens.
// No registrar en logs request.url o parámetros OAuth.
const endpoint = '/.netlify/functions/garmin-callback';
const headers = {
  'Cache-Control': 'no-store, max-age=0',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex, nofollow',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};

export default async function handler(request) {
  if (request.method !== 'GET') {
    return new Response('Método no permitido', {
      status: 405,
      headers: { ...headers, 'Content-Type': 'text/plain; charset=utf-8', Allow: 'GET' },
    });
  }

  // Eliminar cualquier código OAuth de la URL visible sin leerlo ni conservarlo.
  if (new URL(request.url).search) {
    return new Response(null, {
      status: 303,
      headers: { ...headers, Location: endpoint },
    });
  }

  const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Garmin Connect · AsturPower Training</title>
<style>body{font-family:system-ui,sans-serif;background:#0a1517;color:#f2f7f1;min-height:100vh;display:grid;place-items:center;margin:0;padding:24px;box-sizing:border-box}main{max-width:560px;border:1px solid #355143;border-radius:20px;padding:30px;background:#142327}h1{color:#cef17b;font-size:1.6rem}p{line-height:1.7;color:#c9d8d0}a{color:#cef17b}</style>
</head>
<body><main><h1>Conexión Garmin en preparación</h1><p>La autorización de Garmin Connect todavía no está habilitada en AsturPower Training. No hemos conectado ninguna cuenta ni guardado códigos o datos de Garmin.</p><p>Vuelve a <a href="https://asturpower-training-dev.netlify.app/">AsturPower Training</a>.</p></main></body>
</html>`;
  return new Response(html, {
    status: 200,
    headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' },
  });
}
