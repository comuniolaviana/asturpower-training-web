import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {mountPerformance} from '../app/src/performance-ui.js';
import {mountApp} from '../app/src/ui.js';
import {fakeClient} from './fake-client.mjs';
const flush=async()=>{for(let i=0;i<5;i++)await new Promise(r=>setTimeout(r,0));};
const setup=async({deferred=false}={})=>{
 const dom=new JSDOM('<div id="root"></div>',{url:'https://example.test'}),root=dom.window.document.querySelector('#root');let resolveRead;
 const state={rows:[],writes:[]},client={auth:{getUser:async()=>({data:{user:{id:'coach'}}})},from:()=>{
  let athlete,value;const b={select:()=>b,eq:(k,v)=>{athlete=v;return b;},order:()=>b,limit:()=>b,insert:v=>{value=v;return b;},single:()=>b,then:(resolve,reject)=>{
   const result=()=>{if(value){const saved={...value,id:String(state.rows.length),created_at:'2026-11-05T10:00:00Z'};state.writes.push(value);state.rows.push(saved);resolve({data:saved});}else resolve({data:state.rows.filter(r=>r.athlete_id===athlete)});};
   if(deferred&&!value)resolveRead=result;else result();
  }};return b;
 }};
 await mountPerformance({root,client,user:{id:'coach'},role:'coach',athletes:[{user_id:'a',display_name:'<img src=x>'},{user_id:'b',display_name:'Otro deportista'}]});
 const change=(selector,value)=>{const e=root.querySelector(selector);e.value=value;e.dispatchEvent(new dom.window.Event('change',{bubbles:true}));};
 const submit=selector=>root.querySelector(selector).dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));
 return{dom,root,state,change,submit,resolveRead:()=>resolveRead()};
};
test('coach has a working performance navigation; athlete and admin do not receive coach tools',async()=>{
 for(const role of ['coach','athlete','admin']){
  const dom=new JSDOM('<div id="root"></div>',{url:'https://example.test'}),root=dom.window.document.querySelector('#root'),dispose=mountApp(root,fakeClient({role}));await flush();
  const tab=root.querySelector('[data-view=performance]');assert.equal(Boolean(tab),role==='coach');if(tab){tab.click();assert.ok(root.querySelector('[data-perf-profile]'));}
  dispose();
 }
});
test('coach edits a dated snapshot and renders escaped athlete names and missing values',async()=>{
 const t=await setup();assert.equal(t.root.querySelector('img'),null);t.change('[data-perf-athlete]','a');await flush();
 assert.equal(t.root.querySelector('[data-perf-record]').hidden,false);
 const f=t.root.querySelector('[data-perf-profile]');f.elements.ftp.value='250';f.elements.effective_date.value='2026-11-05';t.submit('[data-perf-profile]');await flush();
 assert.equal(t.state.writes.length,1);assert.equal(t.state.writes[0].athlete_id,'a');assert.equal(t.state.writes[0].weight_kg,null);assert.match(t.root.textContent,/Ficha guardada/);assert.match(t.root.querySelector('[data-perf-history]').textContent,/250/);
 t.change('[data-perf-athlete]','b');await flush();assert.equal(f.elements.ftp.value,'');assert.doesNotMatch(t.root.querySelector('[data-perf-history]').textContent,/250/);
});
test('calculators require explicit values and update only local scenario output',async()=>{
 const t=await setup(),f=t.root.querySelector('[data-perf-calc]');f.elements.minutes.value='60';f.elements.percent.value='85';t.submit('[data-perf-calc]');assert.match(t.root.querySelector('[data-perf-calc-result]').textContent,/72,25/);
 const scenario=t.root.querySelector('[data-perf-scenario]');scenario.elements.ctl.value='42';scenario.elements.atl.value='70';t.submit('[data-perf-scenario]');assert.equal(t.root.querySelector('[data-perf-chart]').hidden,false);assert.ok(t.root.querySelector('svg.perf-chart'));assert.match(t.root.querySelector('[data-perf-days]').textContent,/-28/);assert.equal(t.state.writes.length,0);
 scenario.elements.ctl.dispatchEvent(new t.dom.window.Event('input',{bubbles:true}));assert.equal(t.root.querySelector('[data-perf-chart]').hidden,true);
});
test('late private read never repaints a detached panel after leaving the workspace',async()=>{
 const t=await setup({deferred:true});t.change('[data-perf-athlete]','a');await flush();t.root.remove();t.root.replaceChildren();t.resolveRead();await flush();assert.equal(t.root.textContent,'');
});
