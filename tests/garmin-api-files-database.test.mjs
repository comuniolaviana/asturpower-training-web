import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
const read=p=>readFile(new URL('../'+p,import.meta.url),'utf8');
const A='a5555555-0000-4000-8000-000000000001',B='a5555555-0000-4000-8000-000000000002',HASH='a'.repeat(64),ARCHIVE='b'.repeat(64);
test('automatic file ledger is service-only, reserves quota before GET, cannot retry spent callbacks and finalizes only full storage',async()=>{
 const db=new PGlite();try{
  for(const p of ['tests/fixtures/garmin-auth-scaffold.sql','database/esquema-inicial-aplicado.sql','database/cambio-multirrol-aplicado.sql','tests/fixtures/garmin-sport-schema.sql'])await db.exec(await read(p));
  await db.exec(`create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(bucket_id text,name text,metadata jsonb,primary key(bucket_id,name));alter table storage.objects enable row level security;grant usage on schema storage to anon,authenticated,service_role;grant select,insert,update,delete on storage.objects to authenticated,service_role;`);
  for(const p of ['20261105182658_garmin_original_archives.sql','20261105182926_garmin_original_rpc_boundary.sql','20261106083345_import_garmin_export_summaries.sql','20261106091521_garmin_full_original_catalog.sql','20261106110526_garmin_fit_sport_analysis.sql','20261106134409_coach_fit_metrics_explicit_consent.sql','20261106134834_protect_fit_original_filenames_from_coach.sql','20261106164038_garmin_sports_series_and_diagnostics.sql','20261106195749_garmin_recorded_session_load.sql'])await db.exec(await read('supabase/migrations/'+p));
  await db.exec(`create schema extensions;create function extensions.hmac(bytea,bytea,text) returns bytea language sql as $$ select decode(repeat('a',64),'hex') $$;create schema net;create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) returns bigint language sql as $$ select 1::bigint $$;create table asturpower_private.push_config(singleton boolean primary key,hook_secret text);insert into asturpower_private.push_config values(true,'test-only');`);
  await db.exec(await read('supabase/migrations/20261108083319_automatic_garmin_files.sql'));
  for(const id of [A,B]){await db.query('insert into auth.users(id) values($1)',[id]);await db.query('insert into public.profiles(user_id,display_name) values($1,$2)',[id,'Prueba']);await db.query("insert into public.user_roles(user_id,role) values($1,'athlete')",[id]);}
  await db.query("insert into public.garmin_connections(athlete_id,garmin_user_id,access_token_ciphertext,refresh_token_ciphertext,access_expires_at,refresh_expires_at,permissions,connected_at) values($1,'provider-1','ciphertext','ciphertext',now()+interval '1 day',now()+interval '2 day',array['ACTIVITY_EXPORT'],'2026-11-01')",[A]);
  const start=owner=>db.query("select public.start_garmin_api_file($1,'provider-1','12345',$2,'FIT','2026-11-08','{\"activityId\":\"12345\"}') as result",[owner,HASH]);
  assert.equal((await start(B)).rows[0].result.download,false);const job=(await start(A)).rows[0].result;assert.equal(job.download,true);assert.equal((await start(A)).rows[0].result.download,false);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[A]);await db.exec('set role authenticated');await assert.rejects(start(A),/permission denied/);assert.equal((await db.query('select id,status from public.garmin_api_files')).rows.length,1);await assert.rejects(db.query('select callback_sha from public.garmin_api_files'),/permission denied/);
  await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[B]);await db.exec('set role authenticated');assert.equal((await db.query('select id,status from public.garmin_api_files')).rows.length,0);await db.exec('reset role');
  const chunks=[{sha256:HASH,size:3}];await db.query('select public.stage_garmin_api_original($1,$2)',[job.id,{archive_id:ARCHIVE,byte_size:3,chunks}]);await assert.rejects(db.query('select public.finish_garmin_api_original($1)',[job.id]),/incomplete/);
  await db.query("insert into storage.objects values('garmin-originals',$1,'{\"size\":3}')",[A+'/'+ARCHIVE+'/000000-'+HASH+'.bin']);
  await db.query('select public.finish_garmin_api_original($1)',[job.id]);assert.equal((await db.query('select status from public.garmin_api_files')).rows[0].status,'stored');
  assert.ok((await db.query('select public.claim_garmin_api_file($1) as job',[job.id])).rows[0].job.lease_token);assert.equal((await db.query('select public.claim_garmin_api_file($1) as job',[job.id])).rows[0].job,null);
 }finally{await db.close();}
});
