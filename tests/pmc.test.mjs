import test from 'node:test';
import assert from 'node:assert/strict';
import {buildPMC,plannedLoad} from '../app/src/pmc.js';
import {addDays} from '../app/src/performance.js';
import {validateWorkout} from '../app/src/planning.js';
const today='2026-11-07';
const activity=(id,day)=>({id,started_at:day+'T12:00:00Z',title:'Entreno',sport:'cycling'});
test('known constant daily stress converges to its steady state and form uses previous day',()=>{
 const activities=Array.from({length:500},(_,i)=>activity(String(i),addDays(today,i-499))),metrics=activities.map(a=>({activity_id:a.id,tss:100}));
 const result=buildPMC({activities,metrics,today,futureDays:1});
 assert.ok(Math.abs(result.today.ctl-100)<.001);assert.ok(Math.abs(result.today.atl-100)<.001);
 assert.equal(result.target.tsb,result.today.ctl-result.today.atl);
 assert.ok(Math.abs(result.target.ctl-result.today.ctl*(41/42))<1e-9);
 assert.ok(result.target.atl<result.today.atl);
});
test('changing visible window preserves warmup, same-day loads sum and midnight uses Madrid',()=>{
 const activities=[activity('a','2025-01-01'),activity('b',today),{id:'c',started_at:'2026-11-06T23:30:00Z'}],metrics=[{activity_id:'a',tss:200},{activity_id:'b',tss:30},{activity_id:'c',tss:40}];
 const a=buildPMC({activities,metrics,today,historyDays:30}),b=buildPMC({activities,metrics,today,historyDays:365});
 assert.equal(a.today.ctl,b.today.ctl);assert.equal(a.today.load,70);
 assert.equal(a.target.tsb,b.target.tsb);
});
test('missing actual and future TSS remain unknown; rest is an explicit scenario; cancelled/completed/today plans excluded',()=>{
 const activities=[activity('a',today)],workouts=[{id:'w',scheduled_date:addDays(today,1),status:'planned',sport:'strength',title:'Pesas'},...['completed','cancelled'].map(status=>({id:status,scheduled_date:addDays(today,1),status,estimated_tss:999})),{scheduled_date:today,status:'planned',estimated_tss:999}];
 const r=buildPMC({activities,workouts,today});
 assert.equal(r.missingHistory,1);assert.equal(r.missingFuture,1);assert.equal(r.plannedCount,1);assert.equal(r.today.hasKnown,false);assert.equal(r.target.partial,true);assert.equal(r.target.items.length,0);
 assert.equal(buildPMC({activities,workouts,today,mode:'rest'}).plannedCount,0);
});
test('future calendar changes change projection without counting planned sessions as completed history',()=>{
 const base={activities:[activity('a',today)],metrics:[{activity_id:'a',tss:80}],today};
 const rest=buildPMC(base),loaded=buildPMC({...base,workouts:[{id:'w',scheduled_date:addDays(today,1),status:'planned',estimated_tss:100}]});
 assert.equal(rest.today.ctl,loaded.today.ctl);assert.ok(loaded.target.ctl>rest.target.ctl);assert.equal(loaded.series.find(r=>r.date===addDays(today,1)).load,100);
 assert.throws(()=>buildPMC({...base,futureDays:0}));
});
test('planned stress: manual zero overrides blocks, unknown pulse stays unknown, historical FTP applies by date',()=>{
 const steps=[{duration_seconds:3600,target_type:'ftp_pct',low:80,high:80}];
 assert.ok(Math.abs(plannedLoad({sport:'cycling',steps}).load-64)<1e-9);
 assert.equal(plannedLoad({sport:'cycling',steps,estimated_tss:0}).load,0);
 assert.equal(plannedLoad({sport:'cycling',steps:[...steps,{duration_seconds:600,target_type:'free'}]}).load,null);
 assert.equal(plannedLoad({sport:'running',steps}).load,null);
 const w={sport:'cycling',scheduled_date:today,steps:[{duration_seconds:3600,target_type:'watts',low:200,high:200}]};
 const physiology=[{sport:'cycling',effective_date:'2026-01-01',ftp:250},{sport:'cycling',effective_date:'2027-01-01',ftp:400}];
 assert.ok(Math.abs(plannedLoad(w,physiology).load-64)<1e-9);assert.equal(plannedLoad({...w,scheduled_date:'2025-01-01'},physiology).load,null);
});
test('planned load validates edits without clearing existing load from older callers',()=>{
 const w={title:'Entreno',duration_minutes:60,scheduled_date:today};
 assert.equal(Object.hasOwn(validateWorkout(w),'estimated_tss'),false);
 assert.equal(validateWorkout({...w,estimated_tss:''}).estimated_tss,null);
 assert.equal(validateWorkout({...w,estimated_tss:'0'}).estimated_tss,0);
 for(const v of [-1,5001,'abc',Infinity])assert.throws(()=>validateWorkout({...w,estimated_tss:v}),/carga prevista/);
});
