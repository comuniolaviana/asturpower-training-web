import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {mountTrainingPeaksAudit} from '../app/src/trainingpeaks-audit-ui.js';
const csv='WorkoutDay,WorkoutType,TssActual,TotalTime,TssCalculationMethod,Completed\n2026-11-06,Bike,78,1,Power,true';
const fixture={allowed:true,activities:[{id:'a',title:'Rodillo',sport:'cycling',started_at:'2026-11-06T17:00:00Z',duration_seconds:3600}],metrics:[]};
const flush=async()=>{for(let i=0;i<5;i++)await new Promise(r=>setTimeout(r,0));};
function setup(loader=async()=>fixture){
 const dom=new JSDOM('<main><div id="root"></div></main>'),root=dom.window.document.querySelector('#root');
 const cleanup=mountTrainingPeaksAudit({root,coachId:'coach',athletes:[{user_id:'a',display_name:'Deportista <img src=x>'}],loader});
 return {dom,root,cleanup,change:(sel)=>root.querySelector(sel).dispatchEvent(new dom.window.Event('change'))};
}
test('read-only audit displays missing Garmin TSS without writing and escapes names',async()=>{
 const t=setup();assert.equal(t.root.querySelector('img'),null);
 const picker=t.root.querySelector('[data-tp-athlete]');picker.value='a';t.change('[data-tp-athlete]');await flush();
 const f=t.root.querySelector('[data-tp-file]');assert.equal(f.disabled,false);
 Object.defineProperty(f,'files',{configurable:true,value:[{name:'trainingpeaks.csv',size:csv.length,text:async()=>csv}]});
 t.change('[data-tp-file]');await flush();
 assert.match(t.root.querySelector('[data-tp-status]').textContent,/Ningún TSS se ha importado/);
 assert.match(t.root.querySelector('[data-tp-result]').textContent,/1 sin TSS Garmin/);
 assert.equal(t.root.querySelectorAll('tbody tr').length,1);
 t.cleanup();t.dom.window.close();
});
test('permission denied leaves file input disabled and does not parse data',async()=>{
 const t=setup(async()=>({allowed:false,activities:[],metrics:[]}));
 t.root.querySelector('[data-tp-athlete]').value='a';t.change('[data-tp-athlete]');await flush();
 assert.equal(t.root.querySelector('[data-tp-file]').disabled,true);
 assert.match(t.root.querySelector('[data-tp-status]').textContent,/debe autorizar/);
 t.cleanup();t.dom.window.close();
});
test('changing athletes during async read invalidates old private result',async()=>{
 let resolveRead;const t=setup();
 t.root.querySelector('[data-tp-athlete]').value='a';t.change('[data-tp-athlete]');await flush();
 const f=t.root.querySelector('[data-tp-file]');
 Object.defineProperty(f,'files',{configurable:true,value:[{name:'tp.csv',size:csv.length,text:()=>new Promise(resolve=>{resolveRead=resolve;})}]});
 t.change('[data-tp-file]');t.root.querySelector('[data-tp-athlete]').value='';t.change('[data-tp-athlete]');
 resolveRead(csv);await flush();
 assert.equal(t.root.querySelector('[data-tp-result]').textContent,'');
 assert.equal(t.root.querySelector('[data-tp-file]').disabled,true);
 t.cleanup();t.dom.window.close();
});
