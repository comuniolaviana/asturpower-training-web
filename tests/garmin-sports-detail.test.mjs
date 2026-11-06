import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {Encoder,Profile} from '@garmin/fitsdk';
import {buildSportSeries,renderSportSeries} from '../app/src/garmin-sports-series.js';
import {decodeSportXml} from '../app/src/garmin-xml-sports.js';
import {analyzeFitBytes,analyzeFitDecoded,ftpForDate,resolveHistoricalTss,activityCalendarDate} from '../app/src/garmin-fit-analysis.js';
test('all measured sport samples, zeros, missing fields, laps and timing survive, without account identity or location',()=>{
 const decoded={messages:{recordMesgs:Array.from({length:230},(_,i)=>({timestamp:new Date(1700000000000+i*1000),power:i===0?0:i,heartRate:i%2?130:undefined,positionLat:1234,positionLong:5678,serialNumber:999,temperature:21})),lapMesgs:[{totalTimerTime:230,totalDistance:3000,startPositionLat:1234}]}};
 const series=buildSportSeries(decoded);assert.equal(series.rows.length,230);assert.ok(series.fields.includes('temperature'));assert.equal(series.rows[0][series.fields.indexOf('power')],0);assert.equal(series.rows[0][series.fields.indexOf('heartRate')],null);assert.doesNotMatch(JSON.stringify(series),/position|serialNumber/);
 const dom=new JSDOM('<div id="root"></div>'),root=dom.window.document.querySelector('#root');renderSportSeries(root,series,{ftp:200,bounds:[55,75,90,105,120]});assert.ok(root.querySelector('svg'));assert.match(root.textContent,/230 registros/);root.querySelector('summary').click();assert.equal(root.querySelectorAll('tbody tr').length,100);dom.window.close();
});
test('NP recorded by the device is retained for irregular samples without manufacturing missing measurements',()=>{
 const start=new Date('2022-05-01T10:00Z'),e=new Encoder();e.onMesg(Profile.MesgNum.FILE_ID,{type:'activity',manufacturer:'development',product:1,timeCreated:start});e.onMesg(Profile.MesgNum.SESSION,{startTime:start,totalTimerTime:120,totalElapsedTime:120,normalizedPower:235,sport:'cycling'});
 for(let i=0;i<120;i+=5)e.onMesg(Profile.MesgNum.RECORD,{timestamp:new Date(+start+i*1000),power:200});
 const fit=analyzeFitBytes(new Uint8Array(e.close()));assert.equal(fit.np_method,'device');assert.equal(fit.normalized_power_watts,235);assert.equal(fit.sample_count,24);
});
test('dated thresholds change by actual effective dates and a cleared later FTP does not resurrect an old one',()=>{
 const history=[{sport:'cycling',effective_date:'2021-01-01',ftp:200},{sport:'cycling',effective_date:'2022-01-01',ftp:250},{sport:'cycling',effective_date:'2023-01-01',ftp:null}];
 const row={sport:'cycling',normalized_power_watts:200,duration_seconds:3600};
 assert.equal(resolveHistoricalTss({...row,fit_started_at:'2021-06-01T10:00Z'},history).tss,100);
 assert.equal(resolveHistoricalTss({...row,fit_started_at:'2022-06-01T10:00Z'},history).tss,64);
 assert.equal(ftpForDate(history,'2023-02-01'),null);assert.equal(resolveHistoricalTss({...row,fit_started_at:'2023-06-01T10:00Z'},history).tss,null);
 assert.equal(activityCalendarDate('2021-12-31T23:30:00Z'),'2022-01-01');
});
test('TCX restores a running session with measured pulse/cadence and no invented power',()=>{
 const dom=new JSDOM(''),Parser=dom.window.DOMParser;
 const xml='<TrainingCenterDatabase><Activities><Activity Sport="Running"><Id>2022-04-01T10:00:00Z</Id><Lap StartTime="2022-04-01T10:00:00Z"><TotalTimeSeconds>60</TotalTimeSeconds><DistanceMeters>200</DistanceMeters><Track><Trackpoint><Time>2022-04-01T10:00:00Z</Time><HeartRateBpm><Value>135</Value></HeartRateBpm><Cadence>80</Cadence></Trackpoint><Trackpoint><Time>2022-04-01T10:01:00Z</Time><HeartRateBpm><Value>140</Value></HeartRateBpm></Trackpoint></Track></Lap></Activity></Activities></TrainingCenterDatabase>';
 const decoded=decodeSportXml(new TextEncoder().encode(xml),'TCX',Parser),fit=analyzeFitDecoded(decoded);assert.equal(fit.sport,'running');assert.equal(fit.sample_count,2);assert.equal(fit.normalized_power_watts,null);assert.equal(fit.distance_meters,200);
 assert.throws(()=>decodeSportXml(new TextEncoder().encode('<!DOCTYPE data><x/>'),'TCX',Parser));dom.window.close();
});
