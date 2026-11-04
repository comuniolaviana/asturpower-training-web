import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { mountPlanner,isoDate } from '../app/src/planning.js';
import {garminFixture,IDs} from './garmin-fixture.mjs';
import {loadGarminActivities} from '../app/src/garmin-api.js';

test('calendar sends the selected workout through the authenticated backend and shows calendar receipt',async()=>{
  const dom=new JSDOM('<main id="planner"></main>'),previousDocument=globalThis.document,previousFetch=globalThis.fetch;
  globalThis.document=dom.window.document;
  const fixture=garminFixture(),workout={...fixture.workout,scheduled_date:isoDate(new Date()),duration_minutes:35};
  const client={auth:{getSession:async()=>({data:{session:{access_token:'simulated-session'}}})},from(table){
    const result=table==='planned_workouts'?[workout]:table==='coach_athletes'?[{athlete_id:IDs.athlete}]:[{user_id:IDs.athlete,display_name:'Ciclista ficticio'}];
    const builder={select(){return this;},eq(){return this;},in(){return this;},gte(){return this;},lt(){return this;},
      order(){return this;},then(resolve){return Promise.resolve({data:result,error:null}).then(resolve);}};
    return builder;
  }};
  let requested;
  globalThis.fetch=async(url,options)=>{
    requested={url,body:JSON.parse(options.body),authorization:options.headers.Authorization};
    return Response.json({status:'scheduled',already_sent:false,device_sync_confirmed:false});
  };
  try{
    const root=document.getElementById('planner');await mountPlanner({root,client,user:{id:IDs.coach},role:'coach'});
    const send=[...root.querySelectorAll('button')].find(b=>b.textContent==='Enviar a Garmin');assert.ok(send);
    send.click();assert.equal(send.disabled,true);
    await new Promise(resolve=>setTimeout(resolve,0));
    assert.deepEqual(requested.body,{workout_id:IDs.workout});assert.equal(requested.authorization,'Bearer simulated-session');
    assert.match(root.textContent,/Programado en Garmin Connect/);assert.match(root.textContent,/Sincroniza tu dispositivo/);
    assert.doesNotMatch(root.textContent,/simulated-session/);assert.equal(send.disabled,false);
  }finally{globalThis.document=previousDocument;globalThis.fetch=previousFetch;dom.window.close();}
});
test('activity listing filters own athlete and official source and requests only summary fields',async()=>{
  const calls=[],builder={select(fields){calls.push(fields);return this;},eq(...args){calls.push(args);return this;},
    order(){return this;},limit(n){assert.equal(n,10);return Promise.resolve({data:[],error:null});}};
  await loadGarminActivities({from(table){assert.equal(table,'activities');return builder;}},IDs.athlete);
  assert.deepEqual(calls.slice(1),[['athlete_id',IDs.athlete],['source','garmin_api']]);
  assert.doesNotMatch(calls[0],/token|latitude|longitude|ciphertext/);
});
