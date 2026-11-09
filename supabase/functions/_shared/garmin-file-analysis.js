import {decodeCompleteFit} from '../../../app/src/garmin-full-fit.js';
import {analyzeFitDecoded,derivedFitRow} from '../../../app/src/garmin-fit-analysis.js';
import {buildSportSeries} from '../../../shared/garmin-sport-data.mjs';
import {sha256,originalIdentity,originalChunkPath} from '../../../app/src/garmin-original-vault.js';
const checked=r=>{if(r.error)throw Error('storage_unavailable');return r.data;};
// Validate the provider's immutable activity identity before creating or joining
// a calendar row. A similar timestamp alone is never a sufficient match.
function summarySport(type){
 const text=String(type||'').toUpperCase();
 if(/CYCLING|BIKING/.test(text))return 'cycling';
 if(/RUNNING/.test(text))return 'running';
 if(/SWIMMING/.test(text))return 'swimming';
 if(/WALKING|HIKING/.test(text))return 'walking';
 if(/STRENGTH/.test(text))return 'strength';
 return null;
}
export function assertGarminApiFileIdentity(fit,job,activity=null){
 const started=Date.parse(fit?.started_at||'');
 const notifiedStart=job?.summary?.startTimeInSeconds;
 if(!Number.isFinite(started)||!Number.isSafeInteger(notifiedStart)||notifiedStart<0||
    Math.abs(started-notifiedStart*1000)>300000||
    !job?.external_id||String(job?.summary?.activityId)!==String(job.external_id))
   throw Error('file_activity_mismatch');
 const expected=summarySport(job.summary?.activityType);
 if(expected&&fit.sport!==expected)throw Error('file_activity_mismatch');
 if(activity){
   const existingStart=Date.parse(activity.started_at||'');
   if(!Number.isFinite(existingStart)||Math.abs(existingStart-started)>300000||
      (activity.sport&&activity.sport!=='other'&&activity.sport!==fit.sport))
     throw Error('file_activity_mismatch');
 }
 return true;
}
export function decodeApiFit(bytes,job){
 if(job.source_format!=='FIT')throw Error('source_format_requires_review');
 const decoded=decodeCompleteFit(bytes),session=decoded.messages.sessionMesgs?.[0];
 if(decoded.messages.sessionMesgs?.length!==1||!session)throw Error('session_requires_review');
 const start=session.startTime instanceof Date?session.startTime.getTime():Date.parse(session.startTime),duration=Number(session.totalTimerTime);
 if(!Number.isFinite(start)||!Number.isFinite(duration)||duration<1||duration>172800||Math.abs(start/1000-Number(job.summary.startTimeInSeconds))>300)throw Error('file_activity_mismatch');
 const fit=analyzeFitDecoded(decoded)||{started_at:new Date(start).toISOString(),sport:'other',timer_seconds:duration,sample_count:decoded.messages.recordMesgs?.length||0,power_seconds:0,power_coverage:0,normalized_power_watts:null};
 assertGarminApiFileIdentity(fit,job);
 return {decoded,fit,series:buildSportSeries(decoded,{allowSummary:true})};
}
export async function processApiFile(db,job){
 const owner=job.athlete_id;
 const permitted=async()=>{
  const connection=checked(await db.from('garmin_connections').select('garmin_user_id,permissions,connected_at').eq('athlete_id',owner).maybeSingle());
  if(!connection||connection.garmin_user_id!==job.garmin_user_id||!connection.permissions?.includes('ACTIVITY_EXPORT')||Date.parse(connection.connected_at)>Date.parse(job.received_at))throw Error('connection_changed');
 };
 await permitted();
 const archive=checked(await db.from('garmin_original_archives').select('archive_id,byte_size,chunks,status').eq('owner_id',owner).eq('archive_id',job.archive_id).single());
 if(archive.status!=='ready'||archive.byte_size>50*1024*1024||await originalIdentity(archive.chunks,archive.byte_size)!==archive.archive_id)throw Error('original_manifest_invalid');
 const bytes=new Uint8Array(archive.byte_size);let at=0;
 for(let i=0;i<archive.chunks.length;i++){
  const part=archive.chunks[i],path=originalChunkPath(owner,archive.archive_id,i,part.sha256),blob=checked(await db.storage.from('garmin-originals').download(path));
  const raw=new Uint8Array(await blob.arrayBuffer());if(raw.length!==part.size||await sha256(raw)!==part.sha256)throw Error('original_integrity_failed');bytes.set(raw,at);at+=raw.length;
 }
 if(at!==archive.byte_size)throw Error('original_integrity_failed');
 const {decoded,fit,series}=decodeApiFit(bytes,job),session=decoded.messages.sessionMesgs[0];
 // The provider's activity ID, not approximate matching, determines the owner and activity.
 let activity=checked(await db.from('activities').select('id,started_at,sport').eq('athlete_id',owner).eq('source','garmin_api').eq('external_id',job.external_id).maybeSingle());
 if(!activity){
  const n=(v,min,max)=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max?v:null;
  const record={athlete_id:owner,source:'garmin_api',external_id:job.external_id,started_at:fit.started_at,sport:fit.sport,title:job.summary.activityName||'Actividad Garmin',duration_seconds:Math.round(fit.timer_seconds),distance_meters:n(session.totalDistance,0,10000000),elevation_gain_meters:n(session.totalAscent,0,100000),avg_heart_rate:n(session.avgHeartRate,25,250),avg_power_watts:n(session.avgPower,0,3500)};
  checked(await db.rpc('upsert_garmin_activity',{p_activity:record,p_received_at:job.received_at}));
  activity=checked(await db.from('activities').select('id,started_at,sport').eq('athlete_id',owner).eq('source','garmin_api').eq('external_id',job.external_id).single());
 }
 assertGarminApiFileIdentity(fit,job,activity);
 const physiology=checked(await db.from('athlete_physiology').select('id,sport,effective_date,ftp,created_at').eq('athlete_id',owner).eq('sport','cycling').order('effective_date',{ascending:false}).limit(500))||[];
 const row=derivedFitRow(fit,{activity,offset_seconds:Math.round(Math.abs(Date.parse(activity.started_at)-Date.parse(fit.started_at))/1000),method:'garmin_api_activity_id'},physiology,{athleteId:owner,archiveId:job.archive_id,packName:'garmin-api',fileName:job.external_id+'.fit'});
 if(!row)throw Error('analysis_requires_review');
 await permitted();
 // An imported historical detail is never replaced by a new automatic delivery.
 const prior=checked(await db.from('garmin_fit_analysis').select('archive_id').eq('activity_id',activity.id).maybeSingle());
 if(prior&&prior.archive_id!==job.archive_id)throw Error('existing_detail_requires_review');
 checked(await db.from('garmin_fit_analysis').upsert(row,{onConflict:'activity_id'}));
 const json=JSON.stringify(series);if(new TextEncoder().encode(json).length>64*1024*1024)throw Error('series_size_limit');
 const compressed=new Uint8Array(await new Response(new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
 if(compressed.length>4*1024*1024)throw Error('series_size_limit');const sha=await sha256(compressed);
 // The job already reserves the complete 4 MiB series allocation.
 const existing=checked(await db.from('garmin_activity_series').select('sha256,status').eq('athlete_id',owner).eq('activity_id',activity.id).maybeSingle());
 if(existing&&existing.sha256!==sha)throw Error('existing_series_requires_review');
 if(!existing)checked(await db.from('garmin_activity_series').insert({athlete_id:owner,activity_id:activity.id,sha256:sha,byte_size:compressed.length,status:'uploading'}));
 const path=owner+'/'+activity.id+'/'+sha+'.gz',sent=await db.storage.from('garmin-sports-series').upload(path,compressed,{contentType:'application/octet-stream',upsert:false});
 if(sent.error){const prior=checked(await db.storage.from('garmin-sports-series').download(path));if(await sha256(await prior.arrayBuffer())!==sha)throw Error('series_integrity_failed');}
 await permitted();
 checked(await db.from('garmin_activity_series').update({status:'ready'}).eq('athlete_id',owner).eq('activity_id',activity.id).eq('sha256',sha));
 if(typeof session.avgPower==='number'&&Number.isFinite(session.avgPower)&&session.avgPower>=0&&session.avgPower<=3500)checked(await db.from('activities').update({avg_power_watts:Math.round(session.avgPower)}).eq('athlete_id',owner).eq('id',activity.id));
 checked(await db.from('garmin_api_files').update({status:'ready',activity_id:activity.id,last_error:null,reserved_bytes:0,lease_token:null,lease_until:null,updated_at:new Date().toISOString()}).eq('id',job.id).eq('lease_token',job.lease_token));
 return {records:series.rows.length,laps:series.laps.length};
}
