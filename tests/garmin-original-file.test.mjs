import test from 'node:test';
import assert from 'node:assert/strict';
import {validateOriginalCallback,fetchGarminOriginalOnce} from '../netlify/lib/garmin-original-file.mjs';
const url='https://apis.garmin.com/wellness-api/rest/activityFile?id=fixture-id&token=synthetic-test-only';
const accessToken='synthetic-oauth-bearer-token-not-a-real-secret';
test('file callback accepts only the exact official HTTPS resource and never other hosts or duplicate tokens',()=>{
 assert.equal(validateOriginalCallback(url).hostname,'apis.garmin.com');
 for(const bad of [url.replace('https:','http:'),url.replace('apis.garmin.com','apis.garmin.com.attacker.test'),url+'&token=other',url+'&next=https://attacker.test',url+'#fragment',url.replace('activityFile','user/id'),url.replace('apis.garmin.com','user:pass@apis.garmin.com')])assert.throws(()=>validateOriginalCallback(bad),/invalid_callback/);
});
test('single-use FIT GET sends only the authorized athlete bearer token to the exact official host; no cookies or redirects',async()=>{
 let calls=0;
 const bytes=await fetchGarminOriginalOnce(url,{accessToken,fetcher:async(_url,options)=>{
  calls++;assert.equal(options.redirect,'manual');assert.equal(options.credentials,'omit');assert.equal(options.headers.Authorization,'Bearer '+accessToken);assert.equal(options.headers.Accept,'application/octet-stream');
  return new Response(new Uint8Array([0,1,2,255]));
 }});assert.equal(calls,1);assert.deepEqual(bytes,new Uint8Array([0,1,2,255]));
 calls=0;await assert.rejects(fetchGarminOriginalOnce(url,{accessToken,fetcher:async()=>{calls++;throw new Error('opaque callback token must not escape');}}),/outcome_uncertain/);assert.equal(calls,1);
});
test('redirect, one-shot expiry and oversized file have fixed errors and are never retried',async()=>{
 for(const [status,code] of [[302,'redirect_rejected'],[410,'unavailable'],[400,'http_400'],[401,'http_401'],[403,'http_403'],[404,'http_404'],[412,'http_412'],[429,'http_429'],[503,'http_503']]){
  await assert.rejects(fetchGarminOriginalOnce(url,{accessToken,fetcher:async()=>new Response(null,{status,headers:{'X-Secret':'never-log'}})}),
   e=>e.code==='garmin_file_'+code&&!JSON.stringify(e).includes('synthetic-test-only')&&!JSON.stringify(e).includes('never-log'));
 }
 await assert.rejects(fetchGarminOriginalOnce(url,{accessToken,maxBytes:2,fetcher:async()=>new Response(new Uint8Array([1,2,3]))}),/too_large/);
});

test('missing or malformed OAuth tokens fail closed before the one-use callback request',async()=>{
 let calls=0;
 const fetcher=async()=>{calls++;throw Error('must not fetch');};
 for(const token of [undefined,'', 'short', 'synthetic\\r\\nHeader: evil']){
  await assert.rejects(fetchGarminOriginalOnce(url,{accessToken:token,fetcher}),/garmin_file_access_token_required/);
 }
 assert.equal(calls,0);
});
