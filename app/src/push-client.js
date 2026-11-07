// Push uses a separate worker so PWA updates never interrupt an active FIT import.
export const PUSH_URL='https://drnefgxdrultneeodtsy.supabase.co/functions/v1/asturpower-push';
export const supportsPush=win=>Boolean(win.isSecureContext&&win.Notification&&win.PushManager&&win.navigator.serviceWorker);
const b64bytes=text=>Uint8Array.from(atob(text.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-text.length%4)%4)),c=>c.charCodeAt(0));
let bindingTicket=0;
export async function bindPush(win,uid){
 const ticket=++bindingTicket;
 if(!win.navigator.serviceWorker)return;
 const reg=await win.navigator.serviceWorker.getRegistration('/push/');
 if(ticket!==bindingTicket)return;
 reg?.active?.postMessage({type:'ACCOUNT',uid:uid||null});
 if(!uid)for(const n of await reg?.getNotifications?.()||[])n.close();
}
export async function pushStatus(win,client,uid){
 if(!supportsPush(win))return 'unsupported';
 if(win.Notification.permission==='denied')return 'denied';
 const reg=await win.navigator.serviceWorker.getRegistration('/push/');
 const sub=await reg?.pushManager.getSubscription();if(!sub)return 'disabled';
 const {data,error}=await client.from('app_push_subscriptions').select('enabled').eq('owner_id',uid).eq('endpoint',sub.endpoint).maybeSingle();
 if(error)throw Error('No se pudo comprobar el estado.');return data?.enabled?'enabled':'disabled';
}
export async function enablePush(win,client,uid){
 if(!supportsPush(win))throw Error('Este navegador no permite avisos push. En iPhone, abre la app instalada desde la pantalla de inicio.');
 const permission=await win.Notification.requestPermission();
 if(permission!=='granted')throw Error('Los avisos no se han activado. Puedes permitirlos en los ajustes del navegador.');
 const reg=await win.navigator.serviceWorker.register('/push-sw.js',{scope:'/push/',updateViaCache:'none'});
 if(!reg.active)await new Promise((resolve,reject)=>{const worker=reg.installing||reg.waiting;if(!worker)return reject(Error('Vuelve a intentar activar los avisos.'));const timer=setTimeout(()=>reject(Error('Vuelve a intentarlo.')),15000);worker.addEventListener('statechange',()=>{if(worker.state==='activated'){clearTimeout(timer);resolve();}});});
 const response=await win.fetch(PUSH_URL,{cache:'no-store'});if(!response.ok)throw Error('El servicio de avisos no está disponible.');
 const {publicKey}=await response.json();
 const sub=await reg.pushManager.getSubscription()||await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:b64bytes(publicKey)});
 const auth=await client.auth.getUser();if(auth.error||auth.data?.user?.id!==uid)throw Error('La sesión ha cambiado.');
 const json=sub.toJSON();
 // A browser endpoint may have been used by a previous account; worker binding prevents cross-account display.
 const {error}=await client.from('app_push_subscriptions').upsert({owner_id:uid,endpoint:json.endpoint,p256dh:json.keys.p256dh,auth:json.keys.auth,enabled:true},{onConflict:'owner_id,endpoint'});
 if(error)throw Error('No se pudo guardar la activación de este móvil.');
 const again=await client.auth.getUser();if(again.error||again.data?.user?.id!==uid)throw Error('La sesión ha cambiado.');
 await bindPush(win,uid);
}
export async function disablePush(win,client,uid){
 const reg=await win.navigator.serviceWorker.getRegistration('/push/'),sub=await reg?.pushManager.getSubscription();
 if(sub){const {error}=await client.from('app_push_subscriptions').update({enabled:false}).eq('owner_id',uid).eq('endpoint',sub.endpoint);if(error)throw Error('No se pudo guardar el cambio.');await sub.unsubscribe();}
 await bindPush(win,null);
}
export async function testPush(client){const session=await client.auth.getSession();const token=session.data?.session?.access_token;if(!token)throw Error('Vuelve a entrar.');const r=await fetch(PUSH_URL,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({action:'test'})});if(!r.ok)throw Error(r.status===429?'Espera cinco minutos antes de repetir la prueba.':'No se pudo enviar la prueba.');}
