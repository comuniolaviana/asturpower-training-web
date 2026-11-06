import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
const read=p=>readFile(new URL('../'+p,import.meta.url),'utf8');
const A='a5555555-0000-4000-8000-000000000001',B='a5555555-0000-4000-8000-000000000002',C='c5555555-0000-4000-8000-000000000001',D='c5555555-0000-4000-8000-000000000002',ACT='e5555555-0000-4000-8000-000000000001',ID='a'.repeat(64),HASH='b'.repeat(64);
test('sports series enforce explicit revocable consent, storage isolation, complete uploads, immutable content and a joint free quota',async()=>{
 const db=new PGlite();
 try{
  for(const p of ['tests/fixtures/garmin-auth-scaffold.sql','database/esquema-inicial-aplicado.sql','database/cambio-multirrol-aplicado.sql','tests/fixtures/garmin-sport-schema.sql'])await db.exec(await read(p));
  await db.exec(`create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(bucket_id text,name text,metadata jsonb,primary key(bucket_id,name));alter table storage.objects enable row level security;grant usage on schema storage to anon,authenticated,service_role;grant select,insert,update,delete on storage.objects to authenticated;`);
  for(const p of ['20261105182658_garmin_original_archives.sql','20261105182926_garmin_original_rpc_boundary.sql','20261106083345_import_garmin_export_summaries.sql','20261106091521_garmin_full_original_catalog.sql','20261106110526_garmin_fit_sport_analysis.sql','20261106134409_coach_fit_metrics_explicit_consent.sql','20261106134834_protect_fit_original_filenames_from_coach.sql','20261106164038_garmin_sports_series_and_diagnostics.sql'])await db.exec(await read('supabase/migrations/'+p));
  for(const [id,role] of [[A,'athlete'],[B,'athlete'],[C,'coach'],[D,'coach']]){await db.query('insert into auth.users(id) values($1)',[id]);await db.query('insert into public.profiles(user_id,display_name) values($1,$2)',[id,'Fixture '+role]);await db.query('insert into public.user_roles(user_id,role) values($1,$2)',[id,role]);}
  await db.query("insert into public.coach_athletes(coach_id,athlete_id,status) values($1,$2,'active'),($3,$4,'active')",[C,A,D,B]);
  await db.query("insert into public.activities(id,athlete_id,source,external_id,started_at,sport,title,duration_seconds) values($1,$2,'garmin_export','fixture','2022-01-01T10:00Z','cycling','Synthetic fixture',120)",[ACT,A]);
  await db.query("insert into public.garmin_original_archives(owner_id,archive_id,filename,byte_size,chunks,status) values($1,$2,'private.zip',3,$3::jsonb,'ready')",[A,ID,JSON.stringify([{sha256:HASH,size:3}])]);
  await db.query("insert into public.garmin_original_catalog(owner_id,archive_id,pack_name,entries) values($1,$2,'pack.zip',$3::jsonb)",[A,ID,JSON.stringify([{name:'private.fit',kind:'FIT',byte_size:100}])]);
  await db.query("insert into public.garmin_fit_analysis(athlete_id,activity_id,archive_id,pack_name,file_name,fit_started_at,sport,duration_seconds,sample_count,power_seconds,normalized_power_watts,match_offset_seconds) values($1,$2,$3,'pack.zip','private.fit','2022-01-01T10:00Z','cycling',120,120,120,200,0)",[A,ACT,ID]);
  const as=async id=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec('set role authenticated');};
  const reserve=()=>db.query('select public.reserve_activity_series($1,$2,3) path',[ACT,HASH]);
  await as(B);await assert.rejects(reserve(),/owned_fit_required/);
  await as(A);const path=(await reserve()).rows[0].path;assert.equal(path,A+'/'+ACT+'/'+HASH+'.gz');
  await assert.rejects(db.query('select public.complete_activity_series($1,$2)',[ACT,HASH]),/series_upload_incomplete/);
  // Storage performs an INSERT authorization probe before size metadata exists.
  await db.query("insert into storage.objects values('garmin-sports-series',$1,null)",[path]);
  await db.exec('reset role');await db.query("update storage.objects set metadata='{\"size\":3}' where name=$1",[path]);
  await as(A);await db.query('select public.complete_activity_series($1,$2)',[ACT,HASH]);
  await db.query('insert into public.athlete_coach_fit_sharing(athlete_id,coach_id) values($1,$2)',[A,C]);
  await as(C);assert.equal((await db.query('select count(activity_id)::int n from public.garmin_fit_analysis')).rows[0].n,1);assert.equal((await db.query('select count(*)::int n from public.garmin_activity_series')).rows[0].n,0);assert.equal((await db.query('select count(*)::int n from storage.objects')).rows[0].n,0);
  assert.equal((await db.query('update public.athlete_coach_fit_sharing set series_enabled=true returning coach_id')).rows.length,0);
  await as(A);await db.query('update public.athlete_coach_fit_sharing set series_enabled=true where coach_id=$1',[C]);
  for(const id of [C,B,D]){await as(id);const expected=id===C?1:0;assert.equal((await db.query('select count(*)::int n from public.garmin_activity_series')).rows[0].n,expected);assert.equal((await db.query('select count(*)::int n from storage.objects')).rows[0].n,expected);}
  await as(C);await assert.rejects(db.query('select file_name from public.garmin_fit_analysis'),/permission denied/);await assert.rejects(reserve(),/owned_fit_required/);
  await as(A);assert.equal((await db.query('delete from storage.objects returning name')).rows.length,0);await assert.rejects(db.query("update public.garmin_activity_series set sha256=$1",['f'.repeat(64)]),/permission denied/);
  await db.query('delete from public.athlete_coach_fit_sharing where coach_id=$1',[C]);await as(C);assert.equal((await db.query('select count(*)::int n from storage.objects')).rows[0].n,0);
  // Pending series reservations must count against future original-file allocation.
  await db.exec('reset role');await db.query("delete from storage.objects where bucket_id='garmin-sports-series'");await db.query("update public.garmin_activity_series set status='uploading'");await db.query('update public.garmin_original_archives set byte_size=838860797');
  await as(A);await assert.rejects(db.query('select public.reserve_garmin_original($1,$2,1,$3::jsonb,true)',['c'.repeat(64),'another.zip',JSON.stringify([{sha256:HASH,size:1}])]),/original_storage_budget_exceeded/);
  await db.exec('reset role;set role anon');await assert.rejects(db.query('select * from public.garmin_activity_series'),/permission denied/);
 }finally{await db.close();}
});
