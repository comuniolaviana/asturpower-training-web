// Used by the encrypted inbox after a durable single-attempt reservation.
// Activity API 2.1 §6.4: callback token is single-use, expires after 24 hours,
// and is NOT the person's OAuth access token. A durable one-attempt ledger and
// storage reservation must exist BEFORE any production download is enabled.
export class GarminFileError extends Error{
 constructor(code){super(code);this.name='GarminFileError';this.code=code;}
}
export function validateOriginalCallback(value){
 try{
  if(typeof value!=='string'||value.length>8192)throw 0;
  const u=new URL(value);
  if(u.origin!=='https://apis.garmin.com'||u.pathname!=='/wellness-api/rest/activityFile'||u.username||u.password||u.hash)throw 0;
  if([...u.searchParams.keys()].some(k=>!['id','token'].includes(k)))throw 0;
  for(const key of ['id','token'])if(u.searchParams.getAll(key).length!==1||!u.searchParams.get(key)||u.searchParams.get(key).length>4096||/[\r\n]/.test(u.searchParams.get(key)))throw 0;
  return u;
 }catch{throw new GarminFileError('garmin_file_invalid_callback');}
}
export async function fetchGarminOriginalOnce(callback,{fetcher=fetch,signal,maxBytes=50*1024*1024,accessToken}={}){
 const u=validateOriginalCallback(callback);
 // Garmin Developer Program Activity API uses the athlete's OAuth2 Bearer token
 // in addition to the single-use file URL. Never reuse the callback token as OAuth.
 // Validate authorization before making the one irreversible provider request.
 if(typeof accessToken!=='string'||accessToken.length<10||accessToken.length>20000||/\s|[\x00-\x1f\x7f]/.test(accessToken))
  throw new GarminFileError('garmin_file_access_token_required');
 if(!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>50*1024*1024)throw new GarminFileError('garmin_file_invalid_limit');
 let response;
 try{
  response=await fetcher(u.toString(),{method:'GET',redirect:'manual',credentials:'omit',
   signal:AbortSignal.any([AbortSignal.timeout(20000),...(signal?[signal]:[])]),
   headers:{Accept:'application/octet-stream',Authorization:'Bearer '+accessToken}});
 }catch{throw new GarminFileError('garmin_file_download_outcome_uncertain');}
 if(response.status>=300&&response.status<400)throw new GarminFileError('garmin_file_redirect_rejected');
 if(response.status===410)throw new GarminFileError('garmin_file_unavailable');
 // Persist only a fixed HTTP status category. Never store the one-time URL,
 // callback token, response headers or Garmin response body.
 // No retry: an already consumed callback must be treated as indeterminate.
 if(!response.ok){
  const visible=[400,401,403,404,409,412,429,500,502,503,504].includes(response.status)?response.status:'other';
  throw new GarminFileError('garmin_file_http_'+visible);
 }
 const declared=response.headers.get('content-length');
 if(declared&&(!/^\d+$/.test(declared)||Number(declared)>maxBytes))throw new GarminFileError('garmin_file_too_large');
 if(!response.body)throw new GarminFileError('garmin_file_empty');
 const reader=response.body.getReader(),parts=[];let size=0;
 try{
  for(;;){const item=await reader.read();if(item.done)break;size+=item.value.length;if(size>maxBytes)throw new GarminFileError('garmin_file_too_large');parts.push(item.value);}
 }catch(error){throw error instanceof GarminFileError?error:new GarminFileError('garmin_file_download_outcome_uncertain');}
 finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
 if(!size)throw new GarminFileError('garmin_file_empty');
 const bytes=new Uint8Array(size);let position=0;for(const part of parts){bytes.set(part,position);position+=part.length;}
 return bytes;
}
