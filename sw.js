// Build injects only public static file paths. No API, auth, GPS or activity cache.
const CACHE='asturpower-static-9ab6a60e4f44d5968553';
const FILES=["/index.html","/offline.html","/offline.css","/offline-recovery.js","/startup-recovery.js","/manifest.webmanifest","/assets/garmin-full-fit-worker-DnVz_ae0.js","/assets/garmin-original-ui-BwyuD7Ln.js","/assets/index-C_pwyC51.css","/assets/index-Dt8fYJJa.js","/icons/asturpower-192.png","/icons/asturpower-512.png","/icons/asturpower-maskable-512.png"];
const paths=new Set(FILES);
self.addEventListener('install',event=>{
 event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(FILES)));
 // Let a new version wait while an older window is importing an archive.
});
self.addEventListener('activate',event=>{
 event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('asturpower-static-')&&k!==CACHE).map(k=>caches.delete(k)))));
});
self.addEventListener('fetch',event=>{
 const request=event.request,url=new URL(request.url);
 if(request.method!=='GET'||url.origin!==self.location.origin)return;
 // OAuth callbacks and APIs must retain their native network/error semantics.
 if(url.pathname.startsWith('/.netlify/')||url.pathname.startsWith('/api/')||url.pathname.startsWith('/garmin/')||url.pathname==='/health'||request.headers.has('authorization'))return;
 if(request.mode==='navigate'){
  // The app shell is public static HTML. Never cache a user, session or API response.
  // One failed navigation must not strand an installed app on the offline page.
  event.respondWith((async()=>{
   try{const response=await fetch(request);if(response.status<500)return response;}catch{}
   const cache=await caches.open(CACHE);
   return await cache.match('/index.html')||await cache.match('/offline.html');
  })());return;
 }
 if(!paths.has(url.pathname)||url.search||request.headers.has('authorization'))return;
 event.respondWith(caches.open(CACHE).then(async cache=>{
  const saved=await cache.match(url.pathname);if(saved)return saved;
  const response=await fetch(request);if(response.ok)await cache.put(url.pathname,response.clone());return response;
 }));
});
