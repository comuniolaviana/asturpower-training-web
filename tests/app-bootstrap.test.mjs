import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {bootstrapApp} from '../app/src/app-bootstrap.js';
const flush=async()=>{for(let i=0;i<4;i++)await new Promise(r=>setTimeout(r,0));};
test('installed mobile app recovers from a transient startup failure without clearing auth or remounting an active app',async()=>{
 const dom=new JSDOM('<div id="app"></div>',{url:'https://app.example'}),win=dom.window,root=win.document.querySelector('#app');
 win.sessionStorage.setItem('asturpower-dev-auth','existing-session');let online=false,calls=0,mounts=0,clientOptions;
 const stop=bootstrapApp({root,win,fetcher:async()=>{calls++;if(!online)throw Error('temporary failure');return Response.json({supabaseUrl:'https://example.supabase.co',publishableKey:'sb_publishable_fixture'});},createClient:(_u,_k,opts)=>{clientOptions=opts;return {};},mountApp:()=>{mounts++;root.textContent='Equipo';}});
 await flush();assert.ok(root.querySelector('[data-retry-access]'));assert.equal(win.sessionStorage.getItem('asturpower-dev-auth'),'existing-session');
 online=true;win.dispatchEvent(new win.Event('online'));await flush();assert.equal(mounts,1);assert.equal(clientOptions.auth.storage,win.sessionStorage);assert.equal(root.textContent,'Equipo');
 const count=calls;win.dispatchEvent(new win.Event('online'));win.dispatchEvent(new win.Event('pageshow'));await flush();assert.equal(calls,count);assert.equal(mounts,1);
 stop();win.close();
});
test('a server error offers retry and overlapping retries never duplicate app startup',async()=>{
 const dom=new JSDOM('<div id="app"></div>',{url:'https://app.example'}),root=dom.window.document.querySelector('#app');let accept,calls=0,mounts=0;
 const stop=bootstrapApp({root,win:dom.window,fetcher:async()=>{calls++;if(calls===1)return new Response('',{status:503});return new Promise(r=>accept=r);},createClient:()=>({}),mountApp:()=>mounts++});
 await flush();root.querySelector('button').click();root.querySelector('button').click();await flush();assert.equal(calls,2);
 accept(Response.json({supabaseUrl:'https://example.supabase.co',publishableKey:'sb_publishable_fixture'}));await flush();assert.equal(mounts,1);stop();dom.window.close();
});
