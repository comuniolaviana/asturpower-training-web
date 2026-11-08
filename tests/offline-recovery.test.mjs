import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../app/public/offline-recovery.js', import.meta.url), 'utf8');
function fixture(healthy) {
  const status = {textContent:'Not connected'};
  const button = {disabled:false, addEventListener(_, fn){this.onClick=fn;}};
  const store = new Map([['saved-session','keep-this']]);
  const actions = {unregistered:[],deleted:[],navigated:[],requested:[]};
  const registrations = [
    {scope:'https://app.example/',async unregister(){actions.unregistered.push('app');return true;}},
    {scope:'https://app.example/another/',async unregister(){actions.unregistered.push('other');return true;}}
  ];
  const document = {
    visibilityState:'hidden',
    querySelector(selector){return selector==='#connection-status'?status:selector==='#repair-access'?button:null;},
    addEventListener(){}
  };
  const context = {
    document,
    navigator:{serviceWorker:{async getRegistrations(){return registrations;}}},
    caches:{async keys(){return ['asturpower-static-old','other-app-keep'];},async delete(key){actions.deleted.push(key);return true;}},
    location:{origin:'https://app.example',replace(path){actions.navigated.push(path);}},
    localStorage:{getItem(key){return store.get(key);},clear(){throw Error('unsafe');},removeItem(){throw Error('unsafe');}},
    sessionStorage:{getItem(key){return store.get(key);},clear(){throw Error('unsafe');},removeItem(){throw Error('unsafe');}},
    fetch:async (path,options)=>{actions.requested.push([path,options.cache]);return {ok:healthy,async json(){return {service:'asturpower-garmin-app'};}};},
    AbortSignal,
    URL,
    Date,
    addEventListener(){},
    setInterval(){return 1;},
    clearInterval(){},
  };
  vm.runInNewContext(source, context);
  return {button,status,store,actions};
}
async function flush() {for(let i=0;i<6;i++) await new Promise(r=>setTimeout(r,0));}

test('offline recovery does not change anything when server is unreachable',async()=>{
  const f=fixture(false);
  f.button.onClick();await flush();
  assert.deepEqual(f.actions.unregistered,[]);
  assert.deepEqual(f.actions.deleted,[]);
  assert.deepEqual(f.actions.navigated,[]);
  assert.match(f.status.textContent,/no responde/i);
  assert.equal(f.store.get('saved-session'),'keep-this');
  assert.equal(f.button.disabled,false);
});

test('explicit repair only unregisters root worker and only deletes static versioned caches',async()=>{
  const f=fixture(true);
  assert.deepEqual(f.actions.unregistered,[]); // No repair until a real click.
  f.button.onClick();await flush();
  assert.deepEqual(f.actions.unregistered,['app']);
  assert.deepEqual(f.actions.deleted,['asturpower-static-old']);
  assert.equal(f.actions.navigated.length,1);
  assert.match(f.actions.navigated[0],/^\/\?recuperar=/);
  assert.deepEqual(f.actions.requested.map(([path,cache])=>[path,cache]),[['/health','no-store'],['/.netlify/functions/public-config','no-store']]);
  assert.equal(f.store.get('saved-session'),'keep-this');
  assert.equal(f.button.disabled,false);
});
