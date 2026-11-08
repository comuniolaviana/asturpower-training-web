import { encryptedSecret, decryptedSecret } from './garmin-oauth-service.mjs';
import { withGarminLease } from './garmin-training-service.mjs';
import { createGarminRepository } from './garmin-repository.mjs';
import { GarminError, demand, boundedJson, digest, isGarminIp, json, failure } from './garmin-protocol.mjs';
import {validateOriginalCallback} from './garmin-original-file.mjs';

const SUMMARY_FIELDS=['summaryId','activityId','activityType','activityName','startTimeInSeconds',
  'durationInSeconds','distanceInMeters','totalElevationGainInMeters','averageHeartRateInBeatsPerMinute'];
const TYPES=['deregistrations','userPermissionsChange','activities','manuallyUpdatedActivities','activityDetails','activityFiles'];
const validProviderId=value=>typeof value==='string'&&/^[-a-zA-Z0-9_]{4,128}$/.test(value);

export function minimizeGarminNotification(body){
  demand(body&&typeof body==='object'&&!Array.isArray(body),'invalid_notification');
  demand(Object.keys(body).length&&Object.keys(body).every(k=>TYPES.includes(k)),'unsupported_notification',422);
  const events=[];
  for(const type of TYPES){
    if(!Object.hasOwn(body,type))continue;
    demand(Array.isArray(body[type])&&body[type].length<=500,'invalid_notification');
    for(const item of body[type]){
      demand(item&&typeof item==='object'&&validProviderId(item.userId),'invalid_notification');
      if(type==='deregistrations'){events.push({type,userId:item.userId});continue;}
      if(type==='activityFiles'){
        const callback=validateOriginalCallback(item.callbackURL);
        demand(['FIT','TCX','GPX'].includes(item.fileType),'invalid_activity_file',422);
        demand((Number.isSafeInteger(item.activityId)&&item.activityId>0)||(typeof item.activityId==='string'&&/^[0-9]{1,20}$/.test(item.activityId)),'invalid_activity_id',422);
        demand(Number.isSafeInteger(item.startTimeInSeconds)&&item.startTimeInSeconds>=0,'invalid_activity_file',422);
        events.push({type,userId:item.userId,callbackURL:callback.toString(),fileType:item.fileType,
          summary:{activityId:String(item.activityId),startTimeInSeconds:item.startTimeInSeconds,activityName:String(item.activityName||'Actividad Garmin').slice(0,160),activityType:String(item.activityType||'OTHER').slice(0,80)}});
        continue;
      }
      if(type==='userPermissionsChange'){
        demand(Array.isArray(item.permissions)&&item.permissions.length<=30
          &&item.permissions.every(p=>typeof p==='string'&&/^[A-Z_]{2,60}$/.test(p))
          &&Number.isSafeInteger(item.changeTimeInSeconds)&&item.changeTimeInSeconds>=0,'invalid_permissions_notification');
        events.push({type,userId:item.userId,permissions:[...new Set(item.permissions)].sort(),changeTimeInSeconds:item.changeTimeInSeconds});
        continue;
      }
      const summary=type==='activityDetails'?item.summary:item;
      demand(summary&&typeof summary==='object'&&!Array.isArray(summary),'invalid_activity_summary');
      const clean={};
      for(const field of SUMMARY_FIELDS){
        const value=item[field]??summary[field];
        if(value!==undefined){
          demand(['string','number'].includes(typeof value)&&String(value).length<=512,'invalid_activity_summary');
          clean[field]=value;
        }
      }
      events.push({type,userId:item.userId,summary:clean});
    }
  }
  demand(events.length>0&&events.length<=500,'invalid_notification');
  // File callbacks survive only inside the encrypted inbox; never log or expose them.
  return events;
}
function optionalNumber(value,min,max,integer=false){
  if(value===undefined||value===null)return null;
  demand(typeof value==='number'&&Number.isFinite(value)&&value>=min&&value<=max&&(!integer||Number.isInteger(value)),
    'invalid_activity_value',422);
  return value;
}
export function toActivityRecord(event,athleteId){
  const value=event.summary;
  const id=value.activityId??value.summaryId;
  demand((typeof id==='string'&&id.length>0&&id.length<=172)
    ||(Number.isSafeInteger(id)&&id>0),'invalid_activity_id',422);
  const start=optionalNumber(value.startTimeInSeconds,0,4102444800,true);
  const duration=optionalNumber(value.durationInSeconds,1,172800,true);
  demand(start!==null&&duration!==null,'invalid_activity_value',422);
  demand(typeof value.activityType==='string'&&value.activityType.length<=80,'invalid_activity_sport',422);
  const type=value.activityType;
  const sport=/CYCLING|BIKING/.test(type)?'cycling':/RUNNING/.test(type)?'running':/SWIMMING/.test(type)?'swimming'
    :/WALKING|HIKING/.test(type)?'walking':/STRENGTH/.test(type)?'strength':'other';
  return {athlete_id:athleteId,source:'garmin_api',external_id:String(id),
    started_at:new Date(start*1000).toISOString(),sport,
    title:typeof value.activityName==='string'&&value.activityName.trim()?value.activityName.trim().slice(0,160):'Actividad Garmin',
    duration_seconds:duration,distance_meters:optionalNumber(value.distanceInMeters,0,10000000),
    elevation_gain_meters:optionalNumber(value.totalElevationGainInMeters,0,100000),
    avg_heart_rate:optionalNumber(value.averageHeartRateInBeatsPerMinute,25,250,true),
    // Activity 2.1 summaries do not document average power. Do not invent this metric.
    avg_power_watts:null};
}
export function createGarminWebhookHandler({env=process.env,repositoryFactory=createGarminRepository}={}){
  return async (request,context={})=>{
    try{
      demand(request.method==='POST','method_not_allowed',405);
      demand(env.ASTURPOWER_GARMIN_ACTIVITY_ENABLED==='true','garmin_activity_not_enabled',503);
      demand(isGarminIp(context.ip),'sender_not_allowed',403);
      const events=minimizeGarminNotification(await boundedJson(request,1048576));
      const serialized=JSON.stringify(events),id=digest(serialized);
      const repo=repositoryFactory(env);
      await repo.enqueue({id,payload_ciphertext:encryptedSecret(serialized,env.GARMIN_TOKEN_ENCRYPTION_KEY,'inbox:'+id),
        received_at:new Date().toISOString(),status:'pending',attempts:0});
      // Durable enqueue only. Garmin requires HTTP 200 before processing the events.
      return json({accepted:true});
    }catch(error){return failure(error);}
  };
}
export async function processGarminEvents(events,receivedAt,repo,{start=0,deadline=Infinity,onProgress=async()=>{}}={}){
  const priority=event=>event.type==='deregistrations'?0:event.type==='userPermissionsChange'?1:2;
  const ordered=[...events].sort((a,b)=>priority(a)-priority(b)||(a.changeTimeInSeconds||0)-(b.changeTimeInSeconds||0));
  for(let cursor=start;cursor<ordered.length;cursor++){
    if(cursor-start>=25||Date.now()>=deadline)return {cursor,complete:false};
    const event=ordered[cursor];
    const found=await repo.byGarminId(event.userId);
    if(found)await withGarminLease(repo,found.athlete_id,async()=>{
      const connection=await repo.byGarminId(event.userId);
      if(!connection||connection.athlete_id!==found.athlete_id)return;
      // A delayed, queued delivery must never cross to a newer account association.
      if(Date.parse(connection.connected_at)>Date.parse(receivedAt))return;
      if(event.type==='deregistrations'){await repo.deregister(event.userId);return;}
      if(event.type==='userPermissionsChange'){
        await repo.permissions(event.userId,event.permissions,event.changeTimeInSeconds);return;
      }
      if(!connection.permissions?.includes('ACTIVITY_EXPORT'))return;
      if(event.type==='activityFiles'){await repo.importFile(event,connection,receivedAt);return;}
      await repo.importActivity(toActivityRecord(event,connection.athlete_id),receivedAt);
    });
    await onProgress(cursor+1);
  }
  return {cursor:ordered.length,complete:true};
}
export async function processGarminInbox({env=process.env,repositoryFactory=createGarminRepository}={}){
  if(env.ASTURPOWER_GARMIN_ACTIVITY_ENABLED!=='true')return {enabled:false,processed:0,failed:0};
  const repo=repositoryFactory(env),deadline=Date.now()+45000;
  repo.deadline?.(deadline+2000);
  const records=await repo.claimInbox();
  let processed=0,failed=0;
  for(const record of records){
    try{
      const events=JSON.parse(decryptedSecret(record.payload_ciphertext,env.GARMIN_TOKEN_ENCRYPTION_KEY,'inbox:'+record.id));
      const result=await processGarminEvents(events,record.received_at,repo,{start:record.cursor||0,deadline,
        onProgress:cursor=>repo.progressInbox(record.id,cursor)});
      if(result.complete){await repo.finishInbox(record.id);processed++;}
      else await repo.deferInbox(record,result.cursor);
    }catch(error){
      await repo.failInbox(record,error instanceof GarminError?error.code:'processing_failed');failed++;
    }
  }
  await repo.resumeFiles?.();
  return {enabled:true,processed,failed};
}
