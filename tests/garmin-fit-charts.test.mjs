import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {chartPreview} from '../app/src/garmin-fit-charts.js';
import {mountFitCharts} from '../app/src/garmin-fit-chart-ui.js';

test('graph points preserve peaks while all original FIT samples remain available',()=>{
 const records=Array.from({length:1600},(_,i)=>({power:200,heartRate:120+i%30,cadence:85}));
 records[81].power=915;records[82].power=15;
 const graphs=chartPreview(records,200),power=graphs.find(g=>g.key==='power');
 assert.equal(power.observed,1600);
 assert.equal(power.total,1600);
 assert.ok(power.points.length<=400);
 assert.ok(power.points.some(p=>p.index===81&&p.value===915));
 assert.ok(power.points.some(p=>p.index===82&&p.value===15));
 assert.equal(records[81].power,915);
 assert.equal(chartPreview([{power:null},{power:NaN}],25).length,0);
});
test('curve UI is accessible and never executes untrusted metric labels',()=>{
 const dom=new JSDOM('<div id="mount"></div>'),root=dom.window.document.getElementById('mount');
 try{
  const charts=chartPreview(Array.from({length:50},(_,i)=>({power:120+i,heartRate:90+i})));
  mountFitCharts(root,charts);
  assert.ok(root.querySelector('svg[role="img"]'));
  assert.equal(root.querySelectorAll('polyline').length,1);
  assert.match(root.textContent,/Todos los registros FIT/);
  assert.equal(root.querySelector('select').options.length,2);
  root.querySelector('select').value='1';root.querySelector('select').dispatchEvent(new dom.window.Event('change'));
  assert.match(root.textContent,/lpm/);
 }finally{dom.window.close();}
});
