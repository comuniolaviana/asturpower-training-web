import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {mountGarminFullCatalog} from '../app/src/garmin-full-catalog-ui.js';

const owner='22222222-2222-4222-8222-222222222222';
test('catalogue search for .fit returns matching FIT entries and direct type filter works',async()=>{
 const dom=new JSDOM('<main id="app"></main>');
 const root=dom.window.document.querySelector('#app');
 const rows=[{pack_name:'DI_CONNECT/DI-Connect-Uploaded-Files/part1.zip',entries:[
  {name:'Activity_123.FIT',byte_size:765,kind:'FIT'},
  {name:'Activity_456.fit',byte_size:900,kind:'FIT'},
  {name:'Activity_789.tcx',byte_size:150,kind:'TCX'}
 ],indexed_at:'2026-11-06T09:00:00Z'}];
 const client={
  auth:{getUser:async()=>({data:{user:{id:owner}},error:null})},
  from(name){
   assert.equal(name,'garmin_original_catalog');
   const b={select(){return b;},eq(){return b;},order(){return b;},limit(){return b;},
    then(resolve){return Promise.resolve({data:rows,error:null}).then(resolve);}};
   return b;
  }
 };
 const stop=mountGarminFullCatalog({root,client,ownerId:owner,archiveId:'f'.repeat(64),onOpen:async()=>{}});
 try {
  await new Promise(resolve=>setTimeout(resolve,5));
  const search=root.querySelector('input[type=search]');
  const types=root.querySelector('select');
  const count=()=>root.querySelectorAll('.garmin-catalog-file').length;
  assert.equal(count(),3);
  search.value='.fit';search.dispatchEvent(new dom.window.Event('input'));
  assert.equal(count(),2);
  assert.match(root.textContent,/Resultados de búsqueda: 2/);
  assert.match(root.textContent,/Activity_123\.FIT/);
  assert.match(root.textContent,/Activity_456\.fit/);
  search.value='.FIT';search.dispatchEvent(new dom.window.Event('change'));
  assert.equal(count(),2);
  search.value='';search.dispatchEvent(new dom.window.Event('search'));
  assert.equal(count(),3);
  const shortcut=[...root.querySelectorAll('button')].find(x=>x.textContent==='Mostrar archivos FIT');
  assert.ok(shortcut);shortcut.click();
  assert.equal(types.value,'FIT');assert.equal(count(),2);
  types.value='TCX';types.dispatchEvent(new dom.window.Event('change'));
  assert.equal(count(),1);
 } finally { stop();dom.window.close(); }
});
