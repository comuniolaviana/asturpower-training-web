// Only repair public PWA files after an explicit action and a healthy server check.
// Never clear authentication, personal storage, uploads or original FIT archives.
const statusNode = document.querySelector('#connection-status');
const repairButton = document.querySelector('#repair-access');
let checking = false, repairing = false, tries = 0;
async function serverAvailable() {
  try {
    const response = await fetch('/health', {cache:'no-store',signal:AbortSignal.timeout(8000)});
    if (!response.ok) return false;
    const body = await response.json();
    if (body?.service !== 'asturpower-garmin-app') return false;
    // A healthy Worker alone is not enough if login configuration is missing.
    const config = await fetch('/.netlify/functions/public-config', {cache:'no-store',signal:AbortSignal.timeout(8000)});
    return config.ok;
  } catch { return false; }
}
async function reconnect() {
  if (checking || repairing || document.visibilityState === 'hidden') return;
  checking = true;
  try { if (await serverAvailable() && !repairing) location.replace('/'); }
  finally { checking = false; }
}
async function repairAccess() {
  if (repairing) return;
  repairing = true;
  repairButton.disabled = true;
  statusNode.textContent = 'Comprobando que el servidor responde antes de reparar…';
  try {
    if (!await serverAvailable()) {
      statusNode.textContent = 'AsturPower no responde desde este dispositivo. No hemos cambiado nada. Prueba otra red antes de reparar.';
      return;
    }
    // Unregister only this application's root-scope service worker.
    if (navigator.serviceWorker?.getRegistrations) {
      const ownScope = new URL('/', location.origin).href;
      for (const registration of await navigator.serviceWorker.getRegistrations()) {
        if (registration.scope === ownScope) await registration.unregister();
      }
    }
    // Only the app's versioned public asset caches. Never local/session storage.
    if (typeof caches !== 'undefined' && caches.keys) {
      for (const key of await caches.keys()) {
        if (key.startsWith('asturpower-static-')) await caches.delete(key);
      }
    }
    statusNode.textContent = 'Versión guardada reparada. Abriendo AsturPower…';
    location.replace('/?recuperar=' + Date.now());
  } catch {
    statusNode.textContent = 'No se ha podido completar la reparación. No hemos borrado tus datos personales.';
  } finally {
    repairing = false;
    repairButton.disabled = false;
  }
}
repairButton?.addEventListener('click', () => { void repairAccess(); });
addEventListener('online', reconnect);
addEventListener('pageshow', reconnect);
document.addEventListener('visibilitychange', reconnect);
const timer = setInterval(() => {
  if (++tries > 12) { clearInterval(timer); return; }
  void reconnect();
}, 10000);
void reconnect();
