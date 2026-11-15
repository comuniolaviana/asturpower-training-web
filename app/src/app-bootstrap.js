const AUTH_STORAGE_KEY = 'asturpower-dev-auth';

// A tab-only session is lost when the installed PWA/browser closes. Prefer
// durable same-origin storage, while retaining a private-mode fallback.
export function authStorage(win) {
  try {
    const local = win.localStorage;
    const probe = 'asturpower-auth-storage-test';
    local.setItem(probe, '1');
    local.removeItem(probe);
    try {
      const previous = win.sessionStorage?.getItem(AUTH_STORAGE_KEY);
      if (previous && !local.getItem(AUTH_STORAGE_KEY)) local.setItem(AUTH_STORAGE_KEY, previous);
      // Avoid reviving a signed-out account from a stale tab-only copy.
      win.sessionStorage?.removeItem(AUTH_STORAGE_KEY);
    } catch { /* Legacy storage may be unavailable on some devices. */ }
    return local;
  } catch {
    try { return win.sessionStorage; } catch { return undefined; }
  }
}

// Recovery ends as soon as the app starts: do not remount private sessions or uploads.
export function bootstrapApp({root,createClient,mountApp,win=window,fetcher=fetch}){
 let running=false,started=false,failed=false,attempts=0,timer=null;
 const doc=root.ownerDocument;
 const retryWhenVisible=()=>{if(failed&&doc.visibilityState!=='hidden')void start();};
 const stop=()=>{if(timer!==null)win.clearTimeout(timer);win.removeEventListener('online',retryWhenVisible);win.removeEventListener('pageshow',retryWhenVisible);doc.removeEventListener('visibilitychange',retryWhenVisible);};
 function showRetry(){
  root.innerHTML='<main class="unavailable"><div class="unavailable-card"><span class="eyebrow">ASTURPOWER TRAINING</span><h1>No hemos podido abrir tu espacio</h1><p>La conexión con AsturPower no está disponible en este momento. Puede ser temporal aunque tengas Internet. Tus datos siguen guardados.</p><button type="button" class="button primary" data-retry-access>Volver a intentar</button><p class="subtle" role="status">Reintentaremos la conexión automáticamente.</p></div></main>';
  root.querySelector('[data-retry-access]').addEventListener('click',()=>{attempts=0;void start();});
 }
 async function start(){
  if(started||running)return;running=true;if(timer!==null)win.clearTimeout(timer);
  try{
   const response=await fetcher('/.netlify/functions/public-config',{cache:'no-store',credentials:'same-origin',signal:AbortSignal.timeout(12000)});
   if(!response.ok)throw Error('access_unavailable');const config=await response.json();
   if(!config.supabaseUrl||!config.publishableKey?.startsWith('sb_publishable_'))throw Error('configuration_unavailable');
   const client=createClient(config.supabaseUrl,config.publishableKey,{auth:{storage:authStorage(win),storageKey:AUTH_STORAGE_KEY,persistSession:true,autoRefreshToken:true,detectSessionInUrl:false,flowType:'pkce'}});
   mountApp(root,client);started=true;failed=false;stop();
  }catch{
   failed=true;showRetry();if(++attempts<=6)timer=win.setTimeout(retryWhenVisible,10000);
  }finally{running=false;}
 }
 win.addEventListener('online',retryWhenVisible);win.addEventListener('pageshow',retryWhenVisible);doc.addEventListener('visibilitychange',retryWhenVisible);
 void start();return stop;
}
