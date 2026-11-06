import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {mountInstallApp} from '../app/src/pwa.js';

function browser(installed=false){
 const dom=new JSDOM('<!doctype html><div id="app">Historial</div>',{url:'https://app.example/'});
 dom.window.matchMedia=()=>({matches:installed,addEventListener(){}});return dom;
}
test('installation requires an explicit click and hides only after acceptance',async()=>{
 const dom=browser(),win=dom.window;mountInstallApp(win);
 let calls=0;const event=new win.Event('beforeinstallprompt',{cancelable:true});
 event.prompt=async()=>{calls++;};event.userChoice=Promise.resolve({outcome:'accepted'});
 win.dispatchEvent(event);assert.equal(event.defaultPrevented,true);assert.equal(calls,0);
 win.document.querySelector('.app-install .button').click();await new Promise(r=>setTimeout(r,0));
 assert.equal(calls,1);assert.equal(win.document.querySelector('.app-install'),null);dom.window.close();
});
test('already installed app has no installation banner; unavailable prompts give manual instructions',()=>{
 const installed=browser(true);mountInstallApp(installed.window);assert.equal(installed.window.document.querySelector('.app-install'),null);installed.window.close();
 const dom=browser();mountInstallApp(dom.window);dom.window.document.querySelector('.app-install .button').click();
 assert.match(dom.window.document.querySelector('.app-install p').textContent,/Instalar/);
 dom.window.dispatchEvent(new dom.window.Event('appinstalled'));assert.equal(dom.window.document.querySelector('.app-install'),null);dom.window.close();
});
test('optional installation works without matchMedia or when the browser blocks it',()=>{
 const missing=browser();missing.window.matchMedia=undefined;
 assert.doesNotThrow(()=>mountInstallApp(missing.window));
 assert.ok(missing.window.document.querySelector('.app-install'));
 missing.window.close();
 const blocked=browser();blocked.window.matchMedia=()=>{throw new Error('Unsupported browser context');};
 assert.doesNotThrow(()=>mountInstallApp(blocked.window));
 assert.ok(blocked.window.document.querySelector('.app-install'));
 blocked.window.close();
});
async function worker(){
 const listeners={},stored=new Map(),requests=[],deleted=[];
 const cache={async addAll(paths){for(const path of paths)stored.set(path,new Response(path));},async match(path){return stored.get(path);},async put(path,response){stored.set(path,response);}};
 const source=(await readFile(new URL('../scripts/pwa-worker-template.js',import.meta.url),'utf8')).replace('__BUILD_ID__','fixture').replace('__STATIC_FILES__',JSON.stringify(['/offline.html','/assets/app-hash.js']));
 const context={self:{location:{origin:'https://app.example'},addEventListener(type,fn){listeners[type]=fn;}},caches:{async open(){return cache;},async keys(){return ['asturpower-static-old','unrelated'];},async delete(key){deleted.push(key);}},URL,fetch:async request=>{requests.push(request);throw new Error('offline');}};
 vm.runInNewContext(source,context);
 let installation;listeners.install({waitUntil(p){installation=p;}});await installation;
 return {listeners,stored,requests,deleted};
}
test('worker bypasses API, OAuth, external services, authenticated requests and writes',async()=>{
 const w=await worker();
 for(const [path,method,mode,headers] of [['/.netlify/functions/garmin-callback?code=x','GET','navigate',{}],['/garmin/activities','GET','navigate',{}],['/health','GET','cors',{}],['https://db.example/file','GET','cors',{}],['/assets/app-hash.js','POST','cors',{}],['/assets/app-hash.js','GET','cors',{authorization:'Bearer private'}],['/assets/app-hash.js?v=private','GET','cors',{}],['/unknown.json','GET','cors',{}]]){
  const request={url:new URL(path,'https://app.example').href,method,mode,headers:new Headers(headers)};
  w.listeners.fetch({request,respondWith(){assert.fail('private or non-static request intercepted');}});
 }
 assert.equal(w.requests.length,0);
});
test('offline navigation is explicit and public static files work offline; updates do not force reload',async()=>{
 const w=await worker();let response;
 w.listeners.fetch({request:{url:'https://app.example/calendar',method:'GET',mode:'navigate',headers:new Headers()},respondWith(p){response=p;}});
 assert.equal(await (await response).text(),'/offline.html');
 w.listeners.fetch({request:{url:'https://app.example/assets/app-hash.js',method:'GET',mode:'cors',headers:new Headers()},respondWith(p){response=p;}});
 assert.equal(await (await response).text(),'/assets/app-hash.js');assert.equal(w.requests.length,1);
 let activation;w.listeners.activate({waitUntil(p){activation=p;}});await activation;
 assert.deepEqual(w.deleted,['asturpower-static-old']);
 // The worker fixture deliberately has no skipWaiting or clients methods.
});
