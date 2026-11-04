// Contracts checked against Garmin OAuth2 PKCE 2.0, Training V2 2.0 and Activity 2.1.
// No real credentials or user data belong in this module.
import { createHash } from 'node:crypto';
import { validateSteps } from '../../app/src/structured-steps.js';

export const GARMIN = Object.freeze({
  token: 'https://diauth.garmin.com/di-oauth2-service/oauth/token',
  permissions: 'https://apis.garmin.com/partner-gateway/rest/user/permissions',
  // The create path differs from retrieve/update in Training V2 2.0, section 3.3.
  createWorkout: 'https://apis.garmin.com/workoutportal/workout/v2',
  schedules: 'https://apis.garmin.com/training-api/schedule/',
});
export class GarminError extends Error {
  constructor(code, status=503, {retryAfter=0, uncertain=false}={}) {
    super(code); Object.assign(this,{code,status,retryAfter,uncertain});
  }
}
export const demand=(ok,code='invalid_request',status=400)=>{if(!ok)throw new GarminError(code,status);};
export const digest=value=>createHash('sha256').update(value).digest('hex');
export const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
export const positiveId=value=>Number.isSafeInteger(value)&&value>0;
export const json=(body,status=200,extra={})=>new Response(JSON.stringify(body),{status,headers:{
  'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store, max-age=0',
  'Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff',...extra,
}});
export function failure(error) {
  const known=error instanceof GarminError;
  return json({error:known?error.code:'temporarily_unavailable'},known?error.status:503,
    known&&error.retryAfter?{'Retry-After':String(error.retryAfter)}:{});
}
export async function boundedJson(request,limit=4096) {
  demand(request.headers.get('content-type')?.split(';')[0]==='application/json','json_required',415);
  demand(!request.headers.get('content-encoding'),'encoding_not_supported',415);
  const reader=request.body?.getReader(); demand(reader,'invalid_request');
  const chunks=[];let length=0;
  try {
    while(true){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;
      if(length>limit){await reader.cancel();throw new GarminError('request_too_large',413);}chunks.push(value);}
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch(error){if(error instanceof GarminError)throw error;throw new GarminError('invalid_json',400);}
  finally{reader.releaseLock();}
}
export function validDay(value) {
  if(typeof value!=='string'||!/^20\d\d-\d{2}-\d{2}$/.test(value))return false;
  const date=new Date(value+'T12:00:00Z');
  return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;
}
export function toGarminWorkout(workout) {
  demand(workout&&['cycling','running'].includes(workout.sport),'sport_not_supported',422);
  demand(typeof workout.title==='string'&&workout.title.trim().length>0&&workout.title.length<=160,'invalid_title',422);
  demand(validDay(workout.scheduled_date),'invalid_date',422);
  let steps;try{steps=validateSteps(workout.steps);}catch{throw new GarminError('invalid_steps',422);}
  demand(steps?.length,'structured_steps_required',422);
  const sport=workout.sport==='cycling'?'CYCLING':'RUNNING';
  demand(!(sport==='RUNNING'&&steps.some(s=>['watts','ftp_pct'].includes(s.target_type))),'target_not_supported',422);
  const phases={warmup:'WARMUP',work:'ACTIVE',recovery:'RECOVERY',cooldown:'COOLDOWN'};
  const mapped=steps.map((step,index)=>{
    const power=['ftp_pct','watts'].includes(step.target_type),hr=step.target_type==='hr_bpm';
    return {type:'WorkoutStep',stepOrder:index+1,intensity:phases[step.phase],
      durationType:'TIME',durationValue:step.duration_seconds,
      targetType:power?'POWER':hr?'HEART_RATE':'OPEN',
      ...(power||hr?{targetValueLow:step.low,targetValueHigh:step.high,
        ...(step.target_type==='ftp_pct'?{targetValueType:'PERCENT'}:{})}:{}),
      ...(step.target_type==='rpe'?{description:`Esfuerzo percibido (RPE): ${step.low}–${step.high}/10`}:{}),
    };
  });
  return {workoutName:workout.title.trim(),description:String(workout.coach_notes||'').slice(0,1024),sport,
    workoutProvider:'AsturPower Training',workoutSourceId:'AsturPower Training',
    isSessionTransitionEnabled:false,segments:[{segmentOrder:1,sport,steps:mapped}]};
}
export function retrySeconds(header,now=Date.now()) {
  let seconds=/^\d+$/.test(header||'')?Number(header):Math.ceil((Date.parse(header||'')-now)/1000);
  return Number.isFinite(seconds)?Math.max(1,Math.min(86400,seconds)):60;
}
export function createGarminTransport({fetcher=fetch,reserve=async()=>{},timeoutMs=8000}={}) {
  return async (url,{token,method='GET',body,athleteId,oauth=false,headers={}}={})=>{
    demand(Object.values(GARMIN).includes(url)||
      (url.startsWith('https://apis.garmin.com/training-api/schedule?')&&new URL(url).origin==='https://apis.garmin.com'),
      'endpoint_not_allowed',503);
    await reserve(athleteId,oauth);
    let response;
    try{response=await fetcher(url,{method,redirect:'error',signal:AbortSignal.timeout(timeoutMs),
      headers:{Accept:'application/json',...(token?{Authorization:`Bearer ${token}`} : {}),
        ...(body?{'Content-Type':oauth?'application/x-www-form-urlencoded':'application/json'}:{}),...headers},
      ...(body?{body:oauth?body:JSON.stringify(body)}:{})});}
    catch{throw new GarminError('garmin_transport_failed',503,{uncertain:method==='POST'&&!oauth});}
    if(!response.ok){
      if(response.status===429)throw new GarminError('garmin_rate_limited',429,{retryAfter:retrySeconds(response.headers?.get('retry-after'))});
      if([401,403,412].includes(response.status))throw new GarminError('garmin_permission_or_token_rejected',403);
      throw new GarminError('garmin_request_failed',response.status>=500?503:422,{uncertain:response.status>=500&&method==='POST'&&!oauth});
    }
    if(response.status===204)return null;
    try{
      // Bound the provider response as well. Never echo its body or error messages.
      if(typeof response.text==='function'){
        const text=await response.text();demand(Buffer.byteLength(text)<=1048576,'garmin_response_too_large');
        return text?JSON.parse(text):null;
      }
      return await response.json();
    }catch{throw new GarminError('invalid_garmin_response',503,{uncertain:method==='POST'&&!oauth});}
  };
}

// Official Activity 2.1 egress ranges. The adapter must supply a trusted platform IP,
// never a caller-controlled X-Forwarded-For header. IPv6 outside mapped IPv4 fails closed.
const ranges=['204.77.162.0/23','204.77.163.0/24','98.199.124.0/23','185.132.79.0/24',
  '208.65.206.0/23','185.207.94.0/23','198.233.176.0/24'];
function ipv4(value){
  if(typeof value!=='string'||!/^\d{1,3}(\.\d{1,3}){3}$/.test(value))return null;
  const parts=value.split('.').map(Number);if(parts.some(p=>p>255))return null;
  return parts.reduce((n,p)=>(n*256+p)>>>0,0);
}
export function isGarminIp(value){
  const n=ipv4(String(value||'').replace(/^::ffff:/i,''));if(n===null)return false;
  return ranges.some(range=>{const [base,bits]=range.split('/'),mask=(0xffffffff<<(32-Number(bits)))>>>0;
    return (n&mask)===(ipv4(base)&mask);});
}
