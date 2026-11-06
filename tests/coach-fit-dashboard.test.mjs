import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {loadCoachFitDetails,mountCoachFitDashboard} from '../app/src/coach-fit-dashboard.js';
const COACH='33333333-3333-4333-8333-333333333333';
const ATHLETE='22222222-2222-4222-8222-222222222222';
const DATE='2026-05-01T10:00:00Z';
function makeClient({consent=false,linked=true,ftp=null}={}){
 let queries=[];
 const client={auth:{getUser:async()=>({data:{user:{id:COACH}},error:null})},
 from(table){
  const q={filters:[],select(cols){queries.push({table,cols});return q;},eq(key,value){q.filters.push([key,value]);return q;},
   order(){return q;},limit(){return q;},
   range(from,to){const rows=rowsFor(table);return Promise.resolve({data:rows.slice(from,to+1),error:null});},
   then(resolve){return Promise.resolve({data:rowsFor(table),error:null}).then(resolve);}
  };
  function rowsFor(which){
   switch(which){
    case 'coach_athletes':return linked?[{athlete_id:ATHLETE}]:[];
    case 'athlete_coach_fit_sharing':return consent?[{athlete_id:ATHLETE}]:[];
    case 'activities':return [{id:'a',athlete_id:ATHLETE,started_at:DATE,title:'Prueba ciclismo',sport:'cycling',duration_seconds:3600,distance_meters:30000,avg_heart_rate:135,avg_power_watts:200,source:'garmin_export',elevation_gain_meters:250}];
    case 'garmin_fit_analysis':return [{activity_id:'a',sport:'cycling',fit_started_at:DATE,duration_seconds:3600,normalized_power_watts:220,power_coverage:0.98,sample_count:3600,measurement_source:'unverified'}];
    case 'athlete_physiology':return ftp?[{sport:'cycling',ftp,effective_date:'2026-01-01'}]:[];
    default:throw new Error('unexpected '+which);
   }
  }
  return q;
 }};return {client,queries};
}
test('without athlete consent the coach never requests FIT or activity data',async()=>{
 const f=makeClient({consent:false}),result=await loadCoachFitDetails(f.client,COACH,ATHLETE);
 assert.equal(result.allowed,false);
 assert.deepEqual(f.queries.map(q=>q.table),['coach_athletes','athlete_coach_fit_sharing']);
});
test('with consent coach sees safe FIT metrics and real TSS using dated FTP',async()=>{
 const f=makeClient({consent:true,ftp:250}),result=await loadCoachFitDetails(f.client,COACH,ATHLETE);
 assert.equal(result.allowed,true);
 assert.equal(result.metrics.length,1);
 assert.equal(result.metrics[0].normalized_power_watts,220);
 assert.equal(result.metrics[0].tss,77.44);
 const safe=f.queries.find(q=>q.table==='garmin_fit_analysis').cols;
 assert.doesNotMatch(safe,/file_name|pack_name|gps|latitude|longitude/i);
 assert.equal(result.activities[0].title,'Prueba ciclismo');
});
test('without a confirmed historical FTP trainer sees NP but no invented TSS',async()=>{
 const f=makeClient({consent:true}),result=await loadCoachFitDetails(f.client,COACH,ATHLETE);
 assert.equal(result.metrics[0].normalized_power_watts,220);
 assert.equal(result.metrics[0].tss,null);
});
test('dashboard filters years and renders no content before consent',async()=>{
 const dom=new JSDOM('<div id="mount"></div>'),root=dom.window.document.getElementById('mount');
 try{
  mountCoachFitDashboard({root,client:makeClient({consent:false}).client,coachId:COACH,athletes:[{user_id:ATHLETE,display_name:'Ciclista de pruebas'}]});
  const choice=root.querySelector('[data-detailed-athlete]');
  choice.value=ATHLETE;choice.dispatchEvent(new dom.window.Event('change'));await new Promise(r=>setTimeout(r,20));
  assert.match(root.textContent,/todavía no ha autorizado/);
  assert.equal(root.querySelectorAll('table tbody tr').length,0);
 }finally{dom.window.close();}
});
