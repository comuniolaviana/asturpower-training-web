import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {mountApp} from '../app/src/ui.js';
import {fakeClient} from './fake-client.mjs';
const flush=async()=>{for(let i=0;i<4;i++)await new Promise(r=>setTimeout(r,0));};
const pause=ms=>new Promise(r=>setTimeout(r,ms));

test('a stalled saved-session lookup ends with recovery and late data cannot replace a subsequent logout',async()=>{
 const dom=new JSDOM('<div id="app"></div>',{url:'https://app.example'}),root=dom.window.document.querySelector('#app'),client=fakeClient();
 let finish;client.auth.getUser=()=>new Promise(r=>finish=r);
 const dispose=mountApp(root,client,{accessTimeoutMs:15});
 await pause(30);assert.ok(root.querySelector('[data-refresh]'));assert.match(root.textContent,/Tus datos siguen guardados/);assert.ok(root.querySelector('a[href^="/?recuperar="]'));
 root.querySelector('[data-logout]').click();await flush();
 finish({data:{user:client.state.user},error:null});await flush();
 assert.ok(root.querySelector('#login-form'));assert.ok(!root.textContent.includes('Lucía Ejemplo'));
 dispose();dom.window.close();
});

test('an optional stalled team API cannot prevent an authenticated athlete dashboard opening',async()=>{
 const dom=new JSDOM('<div id="app"></div>',{url:'https://app.example'}),root=dom.window.document.querySelector('#app');
 const dispose=mountApp(root,fakeClient({role:'athlete'}),{accessTimeoutMs:15,teamRequest:()=>new Promise(()=>{})});
 await pause(35);assert.ok(root.querySelector('[data-view="calendar"]'));assert.ok(root.textContent.includes('Mi perfil'));
 dispose();dom.window.close();
});

test('returning online retries failed access, but does not remount a working private page',async()=>{
 const dom=new JSDOM('<div id="app"></div>',{url:'https://app.example'}),root=dom.window.document.querySelector('#app'),client=fakeClient({role:'athlete'}),original=client.auth.getUser;
 client.auth.getUser=()=>new Promise(()=>{});
 const dispose=mountApp(root,client,{accessTimeoutMs:15,teamRequest:async()=>null});
 await pause(30);assert.ok(root.querySelector('[data-refresh]'));client.auth.getUser=original;
 dom.window.dispatchEvent(new dom.window.Event('online'));await flush();
 const content=root.firstElementChild;assert.ok(root.querySelector('[data-view="calendar"]'));
 dom.window.dispatchEvent(new dom.window.Event('online'));await flush();assert.equal(root.firstElementChild,content);
 dispose();dom.window.close();
});

test('a failed app module offers an independent fresh navigation without clearing authentication; a started app is left intact',async()=>{
 const source=await readFile(new URL('../app/public/startup-recovery.js',import.meta.url),'utf8');
 const dom=new JSDOM('<div id="app"><p data-boot-placeholder>Preparando</p></div>',{url:'https://app.example',runScripts:'outside-only'}),win=dom.window;
 win.sessionStorage.setItem('asturpower-dev-auth','retained-session');win.eval(source);
 win.dispatchEvent(new win.ErrorEvent('error',{error:new Error('module unavailable')}));
 assert.match(win.document.querySelector('#app').textContent,/Reabrir aplicación/);
 assert.equal(win.sessionStorage.getItem('asturpower-dev-auth'),'retained-session');
 assert.ok(win.document.querySelector('a').href.startsWith('https://app.example/?recuperar='));
 win.close();
 const active=new JSDOM('<div id="app"><p data-boot-placeholder>Preparando</p></div>',{url:'https://app.example',runScripts:'outside-only'});
 active.window.eval(source);active.window.document.querySelector('#app').innerHTML='<form>Importación activa</form>';
 active.window.dispatchEvent(new active.window.ErrorEvent('error',{error:new Error('unrelated')}));
 assert.equal(active.window.document.querySelector('#app').textContent,'Importación activa');active.window.close();
});
