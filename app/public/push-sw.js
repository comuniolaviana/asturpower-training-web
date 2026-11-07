// No fetch handler and no caching of authenticated pages or sports information.
const ORIGIN='https://asturpower-garmin-dev.asturpower-training.workers.dev';
function database(){return new Promise((resolve,reject)=>{const r=indexedDB.open('asturpower-push-binding',1);r.onupgradeneeded=()=>r.result.createObjectStore('binding');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
async function binding(uid,write=false){const db=await database();try{return await new Promise((resolve,reject)=>{const tx=db.transaction('binding',write?'readwrite':'readonly'),store=tx.objectStore('binding');const r=write?store.put(uid,'account'):store.get('account');tx.oncomplete=()=>resolve(write?uid:r.result);tx.onerror=()=>reject(tx.error);});}finally{db.close();}}
self.addEventListener('message',event=>{if(event.data?.type==='ACCOUNT'&&event.source?.url?.startsWith(ORIGIN+'/'))event.waitUntil(binding(event.data.uid||null,true));});
self.addEventListener('push',event=>event.waitUntil((async()=>{
 let payload;try{payload=event.data.json();}catch{return;}
 if(!payload?.recipient||await binding()!==payload.recipient)return;
 await self.registration.showNotification('AsturPower Training',{body:'Tienes novedades en tu espacio.',icon:'/icons/asturpower-192.png',badge:'/icons/asturpower-192.png',tag:'asturpower-news',data:{recipient:payload.recipient}});
 for(const client of await self.clients.matchAll({type:'window',includeUncontrolled:true}))if(client.url.startsWith(ORIGIN+'/'))client.postMessage({type:'ASTURPOWER_NEWS'});
})()));
self.addEventListener('notificationclick',event=>{event.notification.close();event.waitUntil((async()=>{if(await binding()!==event.notification.data?.recipient)return;for(const c of await self.clients.matchAll({type:'window',includeUncontrolled:true})){if(c.url.startsWith(ORIGIN+'/')){await c.focus();c.postMessage({type:'ASTURPOWER_OPEN_NEWS'});return;}}await self.clients.openWindow(ORIGIN+'/?view=news');})());});
