import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {chartPreview,measuredMinutes,OVERLAY_METRICS} from '../app/src/garmin-fit-charts.js';
import {mountFitCharts} from '../app/src/garmin-fit-chart-ui.js';

test('averages measured samples by elapsed minute and retains zero watts and missing cadence',()=>{
 const start=Date.parse('2026-11-06T18:00:00Z');
 const r=[
  {timestamp:new Date(start).toISOString(),heartRate:100,power:0,cadence:80},
  {timestamp:new Date(start+10000).toISOString(),heartRate:120,power:200,cadence:null},
  {timestamp:new Date(start+61000).toISOString(),heartRate:140,power:null,cadence:90},
  {timestamp:new Date(start+241000).toISOString(),heartRate:150,power:250,cadence:91},
 ];
 const minutes=measuredMinutes(r,new Date(start).toISOString());
 assert.deepEqual(minutes.map(row=>row.minute),[0,1,4]);
 assert.equal(minutes[0].heartRate,110);
 assert.equal(minutes[0].power,100);
 assert.equal(minutes[0].cadence,80);
 assert.equal(minutes[0].counts.cadence,1);
 assert.equal(minutes[1].power,null);
 assert.equal(minutes[1].counts.power,0);
 assert.equal(minutes[2].power,250);
 assert.equal(measuredMinutes([{timestamp:'invalid',power:200}]).length,0);
});

test('coach sees a combined minute overlay with independent scales and no fake values across gaps',()=>{
 const start=Date.parse('2026-11-06T18:00:00Z');
 const rec=(sec,heartRate,power,cadence)=>({timestamp:new Date(start+sec*1000).toISOString(),heartRate,power,cadence});
 const records=[rec(0,100,0,80),rec(20,110,180,82),rec(65,120,220,90),rec(245,130,260,96)];
 const dom=new JSDOM('<div id="root"></div>'),root=dom.window.document.getElementById('root');
 try{
  mountFitCharts(root,chartPreview(records),{records,startTime:new Date(start).toISOString()});
  const overlay=root.querySelector('.garmin-minute-overlay');
  assert.ok(overlay);
  assert.match(overlay.textContent,/pulso, potencia y cadencia/i);
  assert.equal(overlay.querySelectorAll('polyline[data-metric="heartRate"]').length,1);
  assert.equal(overlay.querySelectorAll('circle[data-metric="heartRate"]').length,1);
  const input=overlay.querySelector('[data-minute-control]');
  input.value='0';input.dispatchEvent(new dom.window.Event('input'));
  assert.match(overlay.querySelector('[data-minute-readout]').textContent,/Potencia: 90 W/);
  input.value='2';input.dispatchEvent(new dom.window.Event('input'));
  assert.match(overlay.querySelector('[data-minute-readout]').textContent,/no hay muestras registradas/i);
  input.value='1';input.dispatchEvent(new dom.window.Event('input'));
  assert.match(overlay.querySelector('[data-minute-readout]').textContent,/Cadencia: 90 rpm/);
 }finally{dom.window.close();}
});

test('metric without samples stays absent from overlay, not transformed into zero',()=>{
 const start=Date.parse('2026-11-06T18:00:00Z');
 const records=[{timestamp:new Date(start).toISOString(),heartRate:95},
   {timestamp:new Date(start+61000).toISOString(),heartRate:100}];
 const dom=new JSDOM('<div id="root"></div>'),root=dom.window.document.getElementById('root');
 try{
  mountFitCharts(root,chartPreview(records),{records});
  const overlay=root.querySelector('.garmin-minute-overlay');
  assert.ok(overlay);
  assert.equal(overlay.querySelectorAll('[data-metric="power"]').length,0);
  assert.match(overlay.textContent,/Pulso/);
  assert.doesNotMatch(overlay.textContent,/Potencia \(W\): 0/);
 }finally{dom.window.close();}
});


test('coach chooses sport metrics, overlays only those selected, and sees their per-minute measurements',()=>{
 const t=Date.parse('2026-11-07T12:00:00Z');
 const records=[
  {timestamp:new Date(t).toISOString(),heartRate:110,power:0,cadence:80,temperature:15,grade:-4,distance:10},
  {timestamp:new Date(t+45000).toISOString(),heartRate:130,power:210,cadence:82,temperature:17,grade:2,distance:220},
  {timestamp:new Date(t+60000).toISOString(),heartRate:145,power:180,cadence:null,temperature:16,grade:-1,distance:290},
  {timestamp:new Date(t+180000).toISOString(),heartRate:150,power:240,temperature:13,distance:500},
 ];
 const dom=new JSDOM('<div id="root"></div>'),root=dom.window.document.getElementById('root');
 try{
  mountFitCharts(root,chartPreview(records),{records,startTime:new Date(t).toISOString()});
  const overlay=root.querySelector('.garmin-minute-overlay');
  assert.ok(overlay.querySelector('[data-metric-toggle="temperature"]'));
  assert.ok(overlay.querySelector('[data-metric-toggle="grade"]'));
  assert.equal(overlay.querySelectorAll('[data-metric="temperature"]').length,0,'off by default');
  const temperature=overlay.querySelector('[data-metric-toggle="temperature"]');
  temperature.checked=true;temperature.dispatchEvent(new dom.window.Event('change'));
  assert.equal(overlay.querySelectorAll('[data-metric="temperature"]').length,2,'nonconsecutive minute 3 remains isolated');
  const selected=overlay.querySelector('[data-metric-toggle="power"]');
  selected.checked=false;selected.dispatchEvent(new dom.window.Event('change'));
  assert.equal(overlay.querySelectorAll('[data-metric="power"]').length,0);
  const minute=overlay.querySelector('[data-minute-control]');minute.value='0';minute.dispatchEvent(new dom.window.Event('input'));
  assert.match(overlay.querySelector('[data-minute-readout]').textContent,/Temperatura: 16 °C/);
  assert.doesNotMatch(overlay.querySelector('[data-minute-readout]').textContent,/Potencia:/);
  const details=overlay.querySelector('details');details.open=true;details.dispatchEvent(new dom.window.Event('toggle'));
  assert.match(details.textContent,/Temperatura/);
  assert.doesNotMatch(details.textContent,/Potencia \(W\)/);
  assert.match(details.querySelector('table').textContent,/16 °C/);
 }finally{dom.window.close();}
});

test('minute series preserves negative grades, physical zero, last cumulative distance, and rejects unknown sensor fields',()=>{
 const t=Date.parse('2026-11-07T12:00:00Z');
 const metrics=OVERLAY_METRICS.filter(m=>['power','grade','distance','temperature'].includes(m.key));
 const items=[
  {timestamp:new Date(t).toISOString(),power:0,grade:-5,temperature:-2,distance:12},
  {timestamp:new Date(t+35000).toISOString(),power:200,grade:5,temperature:4,distance:400},
  {timestamp:new Date(t+61000).toISOString(),power:null,distance:450},
 ];
 const minutes=measuredMinutes(items,new Date(t).toISOString(),metrics);
 assert.equal(minutes[0].power,100);
 assert.equal(minutes[0].grade,0);
 assert.equal(minutes[0].temperature,1);
 assert.equal(minutes[0].distance,400);
 assert.equal(minutes[1].distance,450);
 assert.equal(minutes[1].power,null);
 assert.equal(minutes[1].counts.power,0);
 assert.deepEqual(measuredMinutes(items,null,[{key:'positionLat',label:'GPS',unit:'deg'}]),[]);
});
