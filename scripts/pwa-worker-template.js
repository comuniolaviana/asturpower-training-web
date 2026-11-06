// Build injects only public static file paths. No API, auth, GPS or activity cache.
const CACHE='asturpower-static-__BUILD_ID__';
const FILES=__STATIC_FILES__;
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
 if(url.pathname.startsWith('/.netlify/')||url.pathname.startsWith('/garmin/')||url.pathname==='/health')return;
 if(request.mode==='navigate'){
  event.respondWith(fetch(request).catch(()=>caches.open(CACHE).then(c=>c.match('/offline.html'))));return;
 }
 if(!paths.has(url.pathname)||url.search||request.headers.has('authorization'))return;
 event.respondWith(caches.open(CACHE).then(async cache=>{
  const saved=await cache.match(url.pathname);if(saved)return saved;
  const response=await fetch(request);if(response.ok)await cache.put(url.pathname,response.clone());return response;
 }));
});
