import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {chartPreview} from '../app/src/garmin-fit-charts.js';
import {mountFitCharts} from '../app/src/garmin-fit-chart-ui.js';
test('minute inspection reads actual full records, retains zero watts and uses elapsed time rather than sample index',()=>{
 const start=new Date('2021-01-01T10:00:00Z');
 const records=[0,1,60,61].map((sec,i)=>({timestamp:new Date(+start+sec*1000).toISOString(),power:i===2?0:200+i,heartRate:i===2?null:140+i,cadence:80+i}));
 const dom=new JSDOM('<div id="root"></div>'),root=dom.window.document.querySelector('#root');
 try{
  mountFitCharts(root,chartPreview(records),{records,startTime:start.toISOString()});
  const minute=root.querySelector('input[type=number]');minute.value='1';minute.dispatchEvent(new dom.window.Event('input'));
  const text=root.querySelector('[role=status]').textContent;assert.match(text,/00:01:00/);assert.match(text,/Potencia: 0 W/);assert.match(text,/Cadencia: 82 rpm/);assert.doesNotMatch(text,/Frecuencia cardíaca: 0/);
  const points=root.querySelector('polyline').getAttribute('points').split(' ').map(p=>p.split(',').map(Number));assert.ok(points[1][0]-points[0][0]<20);assert.ok(points[2][0]-points[1][0]>500);
  const selected=root.querySelector('select');selected.value='1';selected.dispatchEvent(new dom.window.Event('change'));assert.match(root.querySelector('[role=status]').textContent,/Frecuencia cardíaca: sin dato/);
 }finally{dom.window.close();}
});
test('inspector can read a value omitted from the simplified drawing without inventing a sample in a time gap',()=>{
 const start=Date.parse('2021-01-01T10:00Z');const records=Array.from({length:90},(_,i)=>({timestamp:new Date(start+(i<45?i:i+100)*1000).toISOString(),power:i%3===0?100:i%3===1?300:200}));
 const chart=chartPreview(records,20);assert.equal(chart[0].points.some(p=>p.index===2),false);
 const dom=new JSDOM('<div id="root"></div>'),root=dom.window.document.querySelector('#root');
 try{
  mountFitCharts(root,chart,{records});const slider=root.querySelector('input[type=range]');slider.value='2';slider.dispatchEvent(new dom.window.Event('input'));assert.match(root.querySelector('[role=status]').textContent,/Potencia: 200 W/);
  const minute=root.querySelector('input[type=number]');minute.value='1';minute.dispatchEvent(new dom.window.Event('input'));assert.match(root.querySelector('[role=status]').textContent,/Registro de 00:00:44/);assert.doesNotMatch(root.querySelector('[role=status]').textContent,/Registro de 00:01:00/);
 }finally{dom.window.close();}
});
