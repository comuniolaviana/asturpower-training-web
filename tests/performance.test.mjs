import test from 'node:test';
import assert from 'node:assert/strict';
import {validDate,validatePhysiology,physiologyAt,estimatedLoad,parseScenario,simulatePMC} from '../app/src/performance.js';
import {savePhysiology} from '../app/src/performance-data.js';
const valid={sport:'cycling',effective_date:'2026-11-05',ftp:'250'};
test('physiological snapshots preserve unknowns and reject inconsistent inputs',()=>{
 const p=validatePhysiology(valid);assert.equal(p.ftp,250);assert.equal(p.weight_kg,null);assert.equal(p.power_zone_bounds,null);
 assert.deepEqual(validatePhysiology({...valid,power_zone_bounds:'55, 75, 90, 105, 120'}).power_zone_bounds,[55,75,90,105,120]);
 for(const values of [{...valid,hr_rest:90,lthr:80},{...valid,lthr:180,hr_max:170},{...valid,ftp:'NaN'},{...valid,weight_kg:0},{...valid,power_zone_bounds:'55,55,90'},{...valid,hr_zone_bounds:'55,,80'},{sport:'cycling',effective_date:valid.effective_date},{...valid,sport:'__proto__'}])assert.throws(()=>validatePhysiology(values));
 for(const date of ['2026-02-30','2026-99-99','2025-02-29','','1899-12-31'])assert.equal(validDate(date),false);
 assert.equal(validDate('2024-02-29'),true);
});
test('historical thresholds use effective dates, latest revision, and explicit cleared values',()=>{
 const rows=[{id:'a',sport:'cycling',effective_date:'2026-01-01',created_at:'2026-01-01T10:00Z',ftp:200},{id:'b',sport:'cycling',effective_date:'2026-02-01',created_at:'2026-02-01T10:00Z',ftp:250},{id:'c',sport:'cycling',effective_date:'2026-02-01',created_at:'2026-02-02T10:00Z',ftp:null},{id:'d',sport:'running',effective_date:'2026-01-01',created_at:'2026-01-01T10:00Z',ftp:300}];
 assert.equal(physiologyAt(rows,'cycling','2026-01-20').ftp,200);assert.equal(physiologyAt(rows,'cycling','2026-02-20').ftp,null);assert.equal(physiologyAt(rows,'cycling','2025-12-31'),null);
});
test('cycling constant-effort load is duration weighted with explicit invalid-input handling',()=>{
 assert.equal(estimatedLoad(60,100).load,100);assert.equal(estimatedLoad(60,85).load,72.24999999999999);assert.equal(estimatedLoad(120,50).load,50);
 for(const args of [[0,85],['',85],[60,''],[60,Infinity],[60,301],[-1,80]])assert.throws(()=>estimatedLoad(...args));
});
test('PMC uses prior-day TSB, calendar rest days, summed sessions and stable daily recursion',()=>{
 const loads=parseScenario('2026-11-05; 70\n2026-11-05; 30','2026-11-05',7);
 const rows=simulatePMC({start:'2026-11-05',days:7,ctl:42,atl:70,loads});
 assert.equal(rows[0].tsb,-28);assert.equal(rows[0].load,100);assert.equal(rows[0].ctl,42+58/42);assert.equal(rows[0].atl,70+30/7);
 assert.equal(rows[1].load,0);assert.equal(rows[1].tsb,rows[0].ctl-rows[0].atl);assert.equal(rows[1].ctl,rows[0].ctl*(41/42));
 const constant=simulatePMC({start:'2026-11-05',days:7,ctl:100,atl:100,loads:new Map(Array.from({length:7},(_,i)=>[`2026-11-${5+i<10?'0':''}${5+i}`,100]))});assert.ok(constant.every(r=>r.ctl===100&&r.atl===100&&r.tsb===0));
 assert.throws(()=>parseScenario('2026-11-01; 10','2026-11-05',7));assert.throws(()=>parseScenario('2026-11-05; 10,5','2026-11-05',7));assert.throws(()=>simulatePMC({start:'2026-11-05',days:7,ctl:'',atl:0,loads}));
});
test('saving rechecks current identity and sends only validated snapshot fields',async()=>{
 let written;
 const client={auth:{getUser:async()=>({data:{user:{id:'coach-a'}}})},from:()=>({insert:v=>{written=v;return{select:()=>({single:async()=>({data:{...v,id:'new-id'}})})};}})};
 const result=await savePhysiology(client,'coach-a','athlete-a',{...valid,id:'forged',created_at:'forged',created_by:'other'});
 assert.equal(result.id,'new-id');assert.equal(written.created_by,'coach-a');assert.equal(written.created_at,undefined);
 written=null;await assert.rejects(savePhysiology(client,'coach-b','athlete-a',valid),/sesión ha cambiado/);assert.equal(written,null);
});
