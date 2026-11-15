import test from 'node:test';
import assert from 'node:assert/strict';
import {receiveGarminFile} from '../netlify/lib/garmin-file-receiver.mjs';

const event={
 userId:'user-test',
 callbackURL:'https://apis.garmin.com/wellness-api/rest/activityFile?id=fake&token=fake',
 fileType:'FIT',
 summary:{activityId:'12345',startTimeInSeconds:1794740400,activityType:'CYCLING'},
};
const connection={athlete_id:'a5555555-0000-4000-8000-000000000001'};

test('un presupuesto de Garmin agotado se informa como falta de capacidad, no como fallo indeterminado',async()=>{
 let downloads=0;
 const db={rpc:async()=>({data:null,error:{message:'api_file_storage_budget_exceeded',code:'P0001'}})};
 await assert.rejects(
  receiveGarminFile({db,event,connection,receivedAt:'2026-11-15T00:00:00Z',
   accessToken:'fake-authorization-access-token',
   fetcher:async()=>{downloads++;throw Error('should not be called');}}),
  err=>err.code==='garmin_storage_budget_exceeded'&&err.status===507
 );
 assert.equal(downloads,0,'never consume a one-time Garmin download when quota is full');
});

test('otros errores de base de datos siguen diferenciados de la cuota local',async()=>{
 const db={rpc:async()=>({data:null,error:{message:'connection_failed',code:'PGRST504'}})};
 await assert.rejects(
  receiveGarminFile({db,event,connection,receivedAt:'2026-11-15T00:00:00Z',
   accessToken:'fake-authorization-access-token'}),
  err=>err.code==='file_storage_unavailable'
 );
});
