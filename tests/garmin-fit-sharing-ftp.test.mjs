import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {extractFtpCandidates} from '../app/src/garmin-export-ftp.js';
import {listActiveCoaches,setCoachFitSharing,mountCoachFitSharing} from '../app/src/garmin-fit-sharing.js';
const ATHLETE='22222222-2222-4222-8222-222222222222';
const COACH='33333333-3333-4333-8333-333333333333';
function clientFixture(){
 let grants=[],user=ATHLETE;
 const client={auth:{getUser:async()=>({data:{user:{id:user}},error:null})},
 from(name){
  let filters={};
  const b={select(){return b;},eq(k,v){filters[k]=v;return b;},in(){return b;},limit(){return b;},
   then(resolve){
    const rows=name==='coach_athletes'?[{coach_id:COACH}]:
     name==='athlete_coach_fit_sharing'?grants:
     name==='profiles'?[{user_id:COACH,display_name:'Entrenador de pruebas'}]:[];
    return Promise.resolve({data:rows,error:null}).then(resolve);
   },
   async insert(row){
    if(name!=='athlete_coach_fit_sharing')throw Error('table');
    grants.push(row);return {error:null};
   },
   delete(){
    if(name!=='athlete_coach_fit_sharing')throw Error('table');
    const del={eq(k,v){filters[k]=v;return del;},then(resolve){
     grants=grants.filter(g=>!(g.athlete_id===filters.athlete_id&&g.coach_id===filters.coach_id));
     return Promise.resolve({error:null}).then(resolve);
    }};return del;
   }
  };return b;
 }};
 return {client,grants:()=>grants,setUser:id=>{user=id}};
}
test('Garmin exported FTP snapshot is extracted without fabricating an effective date',()=>{
 assert.deepEqual(extractFtpCandidates([{functionalThresholdPower:305},{functionalThresholdPower:305.0}]),[305]);
 assert.deepEqual(extractFtpCandidates([{functionalThresholdPower:null},{functionalThresholdPower:'unknown'}]),[]);
 assert.deepEqual(extractFtpCandidates([{functionalThresholdPower:305},{functionalThresholdPower:240}]),[305,240]);
});
test('athlete must deliberately grant and can revoke a coach access',async()=>{
 const f=clientFixture();
 assert.equal((await listActiveCoaches(f.client,ATHLETE))[0].shared,false);
 await setCoachFitSharing(f.client,ATHLETE,COACH,true);
 assert.equal((await listActiveCoaches(f.client,ATHLETE))[0].shared,true);
 await setCoachFitSharing(f.client,ATHLETE,COACH,false);
 assert.equal((await listActiveCoaches(f.client,ATHLETE))[0].shared,false);
 f.setUser(COACH);
 await assert.rejects(setCoachFitSharing(f.client,ATHLETE,COACH,true),/sesión/i);
});
test('share controls initialize with no consent and never disclose file names',async()=>{
 const d=new JSDOM('<div id="root"></div>'),root=d.window.document.getElementById('root'),f=clientFixture();
 const stop=mountCoachFitSharing({root,client:f.client,athleteId:ATHLETE});
 try{
  await new Promise(r=>setTimeout(r,10));
  assert.equal(root.querySelectorAll('input[type=checkbox]').length,2);
  assert.equal(root.querySelector('input[type=checkbox]').checked,false);
  assert.match(root.textContent,/archivos FIT/);
  assert.match(root.textContent,/GPS/);
 }finally{stop();d.window.close();}
});
