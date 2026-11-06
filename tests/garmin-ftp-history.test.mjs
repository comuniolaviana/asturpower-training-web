import test from 'node:test';
import assert from 'node:assert/strict';
import {extractFtpHistory} from '../app/src/garmin-export-ftp.js';
const sample=(date,ftp,version)=>({
 metaData:{calendarDate:date+'T10:30:00.000'},
 functionalThresholdPower:ftp,
 version,
});
test('historical Garmin biometric changes create dated FTP versions without applying modern FTP to earlier years',()=>{
 const rows=[
  sample('2020-03-11',200,1583951171095),
  sample('2020-03-12',200,1584041171095),
  sample('2021-04-12',265,1618249681136),
  sample('2021-04-23',305,1619214470356),
  sample('2021-04-24',265,1619264150922),
  sample('2021-04-24',305,1619294995861),
  sample('2023-06-07',305,1686143893831),
  {version:1686143893832,metaData:{calendarDate:'2023-06-07T10:00:00'},weight:68},
 ];
 const result=extractFtpHistory(rows);
 assert.equal(result.records,7);
 assert.deepEqual(result.changes,[
  {effective_date:'2020-03-11',ftp:200},
  {effective_date:'2021-04-12',ftp:265},
  {effective_date:'2021-04-23',ftp:305}
 ]);
 assert.deepEqual(result.conflicts,['2021-04-24']);
});
test('malformed, undated, impossible FTP samples never become historical thresholds',()=>{
 const data=[
  {version:1583951171095,functionalThresholdPower:300},
  sample('2020-03-11',0,1583951171095),
  sample('2020-03-11',null,1583951171096),
  sample('2020-03-11',250,1583951171097),
  sample('2020-03-11',250,1583951171098),
 ];
 const result=extractFtpHistory(data);
 assert.deepEqual(result.changes,[{effective_date:'2020-03-11',ftp:250}]);
 assert.equal(result.records,2);
});
