import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {mountGarminPanel} from '../app/src/garmin-connect.js';
import {mountPlanner} from '../app/src/planning.js';
import {loadActivityDetail} from '../app/src/activity-detail.js';
import {prepareCalendarHistory,mountHistoryHub} from '../app/src/garmin-history-hub.js';
import {originalIdentity} from '../app/src/garmin-original-vault.js';
import {simpleGarminClient,attachSimpleSeries,PERSON,COACH,ACTIVITY} from './garmin-simple-fixture.mjs';
const flush=()=>new Promise(r=>setTimeout(r,10));

test('Garmin is settings only: archive explorer stays unmounted; activities open in calendar',async()=>{
 const dom=new JSDOM('<div id="root"></div>',{url:'https://app.example/'}),oldDocument=globalThis.document,oldFetch=globalThis.fetch;
 globalThis.document=dom.window.document;const f=simpleGarminClient(),root=document.querySelector('#root');let route=null;
 globalThis.fetch=async()=>Response.json({configured:true,connected:true,permissions:['ACTIVITY_EXPORT','WORKOUT_IMPORT'],training_enabled:true,activity_enabled:true});
 try{
  await mountGarminPanel({root,client:f.client,user:{id:PERSON},role:'athlete',onNavigate:v=>{route=v;}});await flush();
  assert.match(root.textContent,/Garmin conectado/);assert.match(root.textContent,/1 actividades en tu calendario/);
  assert.equal(root.querySelector('.garmin-recent'),null);assert.equal(root.querySelector('.garmin-originals'),null);
  assert.equal(f.calls.includes('garmin_original_catalog'),false);assert.equal(f.calls.includes('garmin_fit_analysis'),false);
  assert.equal(root.querySelector('.garmin-advanced').open,false);assert.equal(f.writes.length,0);
  const calendar=[...root.querySelectorAll('button')].find(b=>b.textContent==='Ver actividades en Calendario');calendar.click();assert.equal(route,'calendar');
  const imports=[...root.querySelectorAll('details')].find(d=>d.querySelector('summary')?.textContent==='Importar historial');
  assert.equal(imports.open,false);assert.equal(imports.querySelector('button').disabled,true);assert.equal(root.textContent.includes('exportacion_privada.zip'),false);
  [...root.querySelectorAll('button')].find(b=>b.textContent==='Gestionar vinculaciones').click();assert.equal(route,'team');
 }finally{root.remove();await flush();globalThis.document=oldDocument;globalThis.fetch=oldFetch;dom.window.close();}
});
test('athlete and coach open a completed activity by clicking its calendar card',async()=>{
 const oldDocument=globalThis.document;
 try{for(const actor of [PERSON,COACH]){
  const dom=new JSDOM('<div id="calendar"></div>'),root=dom.window.document.querySelector('#calendar');globalThis.document=dom.window.document;
  const f=simpleGarminClient({actor});await mountPlanner({root,client:f.client,user:{id:actor},role:actor===COACH?'coach':'athlete'});
  assert.equal(root.querySelector('.ap-activity-dialog').open,false);
  const card=root.querySelector('[data-activity-id]');assert.ok(card);card.click();await flush();
  const dialog=root.querySelector('.ap-activity-dialog');assert.equal(dialog.open,true);assert.match(dialog.textContent,/Salida de prueba/);assert.match(dialog.textContent,/32 km/);assert.match(dialog.textContent,/137 lpm/);assert.match(dialog.textContent,/El resumen ya está disponible/);
  assert.equal(f.calls.includes('garmin_original_archives'),false);assert.equal(f.writes.length,0);root.remove();dom.window.close();
 }}finally{globalThis.document=oldDocument;}
});
test('activity detail cannot read an unavailable activity or changed session',async()=>{
 const denied=simpleGarminClient({actor:COACH,denied:true});await assert.rejects(loadActivityDetail(denied.client,COACH,ACTIVITY),/permiso/);
 assert.equal(denied.calls.includes('garmin_activity_series'),false);
 const f=simpleGarminClient();f.setActor(COACH);await assert.rejects(loadActivityDetail(f.client,PERSON,ACTIVITY),/sesión/);assert.equal(f.calls.length,0);
});
test('coach opens actual stored sports curves in the calendar, with historical FTP and without the original archive',async()=>{
 const dom=new JSDOM('<div id="calendar"></div>'),old=globalThis.document;globalThis.document=dom.window.document;
 try{
  const f=await attachSimpleSeries(simpleGarminClient({actor:COACH,series:true})),root=document.querySelector('#calendar');
  await mountPlanner({root,client:f.client,user:{id:COACH},role:'coach'});root.querySelector('[data-activity-id]').click();await new Promise(r=>setTimeout(r,50));
  const dialog=root.querySelector('.ap-activity-dialog');assert.ok(dialog.querySelector('svg'));assert.match(dialog.textContent,/180 registros/);assert.match(dialog.textContent,/FTP 240 W/);assert.equal(f.calls.includes('garmin_original_archives'),false);
 }finally{globalThis.document=old;dom.window.close();}
});
test('one-step import still requires explicit consent, and respects cancellation before accessing files',async()=>{
 const f=simpleGarminClient();await assert.rejects(prepareCalendarHistory(f.client,PERSON,{archiveId:'anything'}),/autorización/);
 const abort=new AbortController();abort.abort();await assert.rejects(prepareCalendarHistory(f.client,PERSON,{archiveId:'anything',consent:true,signal:abort.signal}),{name:'AbortError'});
 assert.equal(f.calls.length,0);assert.equal(f.writes.length,0);
});
test('history import marks only its active lifetime, including cleanup after a failed download',async()=>{
 const dom=new JSDOM('<div id="history"></div>'),f=simpleGarminClient(),root=dom.window.document.querySelector('#history');
 const chunks=[{sha256:'b'.repeat(64),size:100}];
 Object.assign(f.tables.garmin_original_archives[0],{byte_size:100,chunks,archive_id:await originalIdentity(chunks,100)});
 let finishDownload;
 f.client.storage={from:()=>({download:()=>new Promise(resolve=>{finishDownload=resolve;})})};
 const dispose=mountHistoryHub({root,client:f.client,user:{id:PERSON}});await flush();
 const section=root.querySelector('section'),check=root.querySelector('input[type="checkbox"]');
 assert.equal(section.dataset.garminImportRunning,'false');
 check.checked=true;check.dispatchEvent(new dom.window.Event('change'));
 [...root.querySelectorAll('button')].find(b=>b.textContent==='Preparar historial guardado').click();await flush();
 assert.equal(section.dataset.garminImportRunning,'true');
 finishDownload({data:null,error:{message:'synthetic network failure'}});await flush();
 assert.equal(section.dataset.garminImportRunning,'false');
 dispose();dom.window.close();
});
