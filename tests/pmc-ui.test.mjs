import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {mountPMC} from '../app/src/pmc-ui.js';
import {loadPMCData} from '../app/src/pmc-data.js';
import {fakeClient,IDs} from './fake-client.mjs';
const flush=async()=>{for(let i=0;i<6;i++)await new Promise(r=>setTimeout(r,0));};
const data={allowed:true,activities:[{id:'old',title:'Primer historial',started_at:'2025-12-01T10:00:00Z'},{id:'a',title:'Real',started_at:'2026-11-07T10:00:00Z'}],metrics:[{activity_id:'old',tss:45,tss_source:'garmin_recorded'},{activity_id:'a',tss:70,tss_source:'garmin_recorded'}],physiology:[],workouts:[{id:'w',title:'<img src=x>',scheduled_date:'2026-11-08',status:'planned',estimated_tss:80}]};
function setup(loader=async()=>data){
 const dom=new JSDOM('<div id="root"></div>'),root=dom.window.document.querySelector('#root');
 mountPMC({root,coachId:'c',athletes:[{user_id:'a',display_name:'<img src=x>'},{user_id:'b',display_name:'Otra'}],loader,clock:()=>new Date('2026-11-07T15:00:00Z')});
 const change=(selector,value,type='change')=>{const e=root.querySelector(selector);e.value=value;e.dispatchEvent(new dom.window.Event(type));};
 return {root,dom,change};
}
test('trainer chart shows present and target; date selection shows sessions, missing loads are flagged and input changes recalculate',async()=>{
 const t=setup();t.change('[data-pmc-athlete]','a');await flush();
 assert.equal(t.root.querySelector('[data-pmc-content]').hidden,false);assert.equal(t.root.querySelectorAll('.pmc-line').length,6);assert.match(t.root.querySelector('[data-pmc-current]').textContent,/Carga/);
 t.change('[data-pmc-date]','2026-11-08');assert.match(t.root.querySelector('[data-pmc-day]').textContent,/80 TSS/);assert.equal(t.root.querySelector('img'),null);
 t.change('[data-pmc-future]','30','input');assert.match(t.root.querySelector('[data-pmc-target-title]').textContent,/30 días/);
 t.change('[data-pmc-mode]','rest');assert.match(t.root.querySelector('[data-pmc-quality]').textContent,/descanso completo/);
 t.change('[data-pmc-future]','','input');assert.equal(t.root.querySelector('[data-pmc-content]').hidden,true);
 t.change('[data-pmc-future]','21','input');assert.equal(t.root.querySelector('[data-pmc-content]').hidden,false);
 t.dom.window.close();
});
test('changing athlete clears private chart immediately and late results cannot overwrite current or detached panel',async()=>{
 const pending={};const t=setup((c,u,a)=>new Promise(r=>pending[a]=r));
 t.change('[data-pmc-athlete]','a');t.change('[data-pmc-athlete]','b');pending.b({allowed:false});await flush();pending.a(data);await flush();
 assert.equal(t.root.querySelector('[data-pmc-content]').hidden,true);assert.match(t.root.textContent,/debe autorizar/);
 t.change('[data-pmc-athlete]','a');t.root.remove();t.root.replaceChildren();pending.a(data);await flush();assert.equal(t.root.textContent,'');t.dom.window.close();
});
test('PMC reads respect active link and consent and query only that coach and athlete, without downloading series',async()=>{
 const client=fakeClient();
 client.state.tables.athlete_coach_fit_sharing=[{coach_id:IDs.coach,athlete_id:IDs.a,series_enabled:true}];
 client.state.tables.planned_workouts=[{coach_id:IDs.coach,athlete_id:IDs.a,status:'planned',id:'ok'},{coach_id:'another',athlete_id:IDs.a,status:'planned',id:'forbidden'}];
 const result=await loadPMCData(client,IDs.coach,IDs.a);
 assert.deepEqual(result.workouts.map(w=>w.id),['ok']);assert.equal(result.allowed,true);
 client.state.tables.athlete_coach_fit_sharing=[];assert.equal((await loadPMCData(client,IDs.coach,IDs.a)).allowed,false);
 client.state.tables.coach_athletes=[];await assert.rejects(loadPMCData(client,IDs.coach,IDs.a),/vinculado/);
});


test('unknown Garmin TSS hides all CTL/ATL/TSB numbers and chart, but preserves the daily list and missing source',async()=>{
 const incomplete={...data,activities:[...data.activities,{id:'missing',title:'<img src=x onerror=alert(1)> Rodillo sin potencia',sport:'cycling',started_at:'2026-11-06T10:00:00Z'}]};
 const t=setup(async()=>incomplete);t.change('[data-pmc-athlete]','a');await flush();
 assert.equal(t.root.querySelectorAll('.pmc-line').length,0);
 assert.match(t.root.querySelector('[data-pmc-graph]').textContent,/Gráfica retirada/);
 assert.equal(t.root.querySelector('[data-pmc-current]').textContent.includes('—'),true);
 assert.equal(t.root.querySelector('[data-pmc-target]').textContent.includes('—'),true);
 assert.match(t.root.querySelector('[data-pmc-quality]').textContent,/1 de 2 actividades/);
 assert.match(t.root.querySelector('[data-pmc-audit]').textContent,/Rodillo sin potencia/);
 assert.equal(t.root.querySelector('img'),null);
 t.change('[data-pmc-date]','2026-11-06');
 assert.match(t.root.querySelector('[data-pmc-day]').textContent,/carga total desconocida/);
 t.dom.window.close();
});
test('unknown planned TSS keeps the historical curve but suppresses forecast and future figures',async()=>{
 const pending={...data,workouts:[...data.workouts,{id:'unknown',title:'Fuerza',sport:'strength',scheduled_date:'2026-11-09',status:'planned',estimated_tss:null}]};
 const t=setup(async()=>pending);t.change('[data-pmc-athlete]','a');await flush();
 assert.equal(t.root.querySelectorAll('.pmc-line').length,3);
 assert.equal(t.root.querySelector('[data-pmc-current]').textContent.includes('—'),false);
 assert.equal(t.root.querySelector('[data-pmc-target]').textContent.includes('—'),true);
 assert.match(t.root.querySelector('[data-pmc-quality]').textContent,/Previsión oculta/);
 t.dom.window.close();
});
