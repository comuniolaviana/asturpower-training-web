import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import {
  createPkce, encryptedSecret, decryptedSecret,
  createGarminStartHandler, createGarminStatusHandler, createGarminCallbackHandler
} from '../netlify/lib/garmin-oauth-service.mjs';

test('Garmin PKCE verifier and SHA256 code challenge',()=>{
  const flow=createPkce();
  assert.equal(flow.verifier.length,43);
  assert.equal(flow.state.length,43);
  assert.equal(flow.challenge,createHash('sha256').update(flow.verifier).digest('base64url'));
});
test('Garmin token encryption is authenticated and context dependent',()=>{
  const key=randomBytes(32).toString('base64url');
  const sealed=encryptedSecret('example-value',key,'context-a');
  assert.equal(decryptedSecret(sealed,key,'context-a'),'example-value');
  assert.throws(()=>decryptedSecret(sealed,key,'context-b'));
});
test('unconfigured Garmin start fails closed',async()=>{
  const h=createGarminStartHandler({env:{ASTURPOWER_GARMIN_ENABLED:'false'}});
  const response=await h(new Request('https://example.org/.netlify/functions/garmin-start',{method:'POST'}));
  assert.equal(response.status,503);
  assert.equal((await response.json()).error,'garmin_not_configured');
});
test('unconfigured Garmin status does not pretend a connection',async()=>{
  const h=createGarminStatusHandler({env:{}});
  const response=await h(new Request('https://example.org/.netlify/functions/garmin-status'));
  assert.deepEqual(await response.json(),{configured:false,connected:false});
});
test('unconfigured callback never exposes OAuth code',async()=>{
  const h=createGarminCallbackHandler({env:{}});
  const response=await h(new Request('https://example.org/.netlify/functions/garmin-callback?code=should_not_echo&state=should_not_echo'));
  assert.equal(response.status,303);
  assert.doesNotMatch(response.headers.get('location'),/should_not_echo/);
});
