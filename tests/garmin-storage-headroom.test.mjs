import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';

const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');
const MIGRATION='supabase/migrations/20261115175000_garmin_storage_guarded_900mib.sql';
const A='a5555555-0000-4000-8000-000000000001';
const HASH='a'.repeat(64);

test('Garmin headroom: preflight prevents unsafe cap increases; exact three budgets adjust atomically and ACLs survive',async()=>{
 const db=new PGlite();
 try{
  for(const path of [
   'tests/fixtures/garmin-auth-scaffold.sql',
   'database/esquema-inicial-aplicado.sql',
   'database/cambio-multirrol-aplicado.sql',
   'tests/fixtures/garmin-sport-schema.sql',
  ])await db.exec(await read(path));
  await db.exec(`create schema storage;
   create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
   create table storage.objects(bucket_id text,name text,metadata jsonb,primary key(bucket_id,name));
   alter table storage.objects enable row level security;
   grant usage on schema storage to anon,authenticated,service_role;
   grant select,insert,update,delete on storage.objects to authenticated,service_role;`);
  for(const name of [
   '20261105182658_garmin_original_archives.sql',
   '20261105182926_garmin_original_rpc_boundary.sql',
   '20261106083345_import_garmin_export_summaries.sql',
   '20261106091521_garmin_full_original_catalog.sql',
   '20261106110526_garmin_fit_sport_analysis.sql',
   '20261106134409_coach_fit_metrics_explicit_consent.sql',
   '20261106134834_protect_fit_original_filenames_from_coach.sql',
   '20261106164038_garmin_sports_series_and_diagnostics.sql',
   '20261106195749_garmin_recorded_session_load.sql',
  ])await db.exec(await read('supabase/migrations/'+name));
  await db.exec(`create schema extensions;
   create function extensions.hmac(bytea,bytea,text) returns bytea language sql
    as $$select decode(repeat('a',64),'hex')$$;
   create schema net;
   create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer)
    returns bigint language sql as $$select 1::bigint$$;
   create table asturpower_private.push_config(singleton boolean primary key,hook_secret text);
   insert into asturpower_private.push_config values(true,'fake-for-test-only');`);
  await db.exec(await read('supabase/migrations/20261108083319_automatic_garmin_files.sql'));

  const budgetQuery=`select pg_get_functiondef('public.start_garmin_api_file(uuid,text,text,text,text,timestamptz,jsonb)'::regprocedure) as definition`;
  const base=(await db.query(budgetQuery)).rows[0].definition;
  assert.match(base,/if used\+56623104>838860800 then/);

  // A high physical usage estimate must abort before touching any RPC definition.
  await db.query(`insert into storage.objects(bucket_id,name,metadata)
    values('test-extra','size',jsonb_build_object('size',$1::bigint))`,[901*1024*1024]);
  await assert.rejects(db.exec(await read(MIGRATION)),/garmin_headroom_preflight_storage_exceeds_cap/);
  assert.equal((await db.query(budgetQuery)).rows[0].definition,base);

  // Controlled test with 820 MiB in the store. Existing 800-MiB budget blocks this,
  // but 900 MiB leaves the 54-MiB one-time callback reservation headroom.
  await db.query(`update storage.objects set metadata=jsonb_build_object('size',$1::bigint)
    where bucket_id='test-extra'`,[820*1024*1024]);
  await db.exec(await read(MIGRATION));

  for(const [name,find] of [
   ['asturpower_private.reserve_activity_series(uuid,text,integer)',/if total\+p_bytes>943718400 then/],
   ['asturpower_private.reserve_garmin_original(text,text,bigint,jsonb,boolean)',/if total\+p_byte_size>943718400 then/],
   ['public.start_garmin_api_file(uuid,text,text,text,text,timestamptz,jsonb)',/if used\+56623104>943718400 then/],
  ]){
   const def=(await db.query(`select pg_get_functiondef($1::regprocedure) as definition`,[name])).rows[0].definition;
   assert.match(def,find,name+' has 900 MiB guard');
  }
  const original=(await db.query(`select pg_get_functiondef(
    'asturpower_private.reserve_garmin_original(text,text,bigint,jsonb,boolean)'::regprocedure) as definition`)).rows[0].definition;
  assert.match(original,/p_byte_size not between 1 and 838860800/,'retain per-archive safety bound');
  assert.equal((await db.query(`select has_function_privilege('anon',
    'public.start_garmin_api_file(uuid,text,text,text,text,timestamptz,jsonb)','EXECUTE') as allowed`)).rows[0].allowed,false);

  await db.query('insert into auth.users(id) values($1)',[A]);
  await db.query('insert into public.profiles(user_id,display_name) values($1,$2)',[A,'Ficticio']);
  await db.query("insert into public.user_roles(user_id,role) values($1,'athlete')",[A]);
  await db.query(`insert into public.garmin_connections(
    athlete_id,garmin_user_id,access_token_ciphertext,refresh_token_ciphertext,
    access_expires_at,refresh_expires_at,permissions,connected_at)
    values($1,'provider-test','ciphertext','ciphertext',now()+interval '1 day',
      now()+interval '2 days',array['ACTIVITY_EXPORT'],'2026-11-01')`,[A]);
  const start=id=>db.query(`select public.start_garmin_api_file(
    $1,'provider-test',$2,$3,'FIT','2026-11-15',jsonb_build_object('activityId',$2)) as result`,
  [A,id,HASH]);
  assert.equal((await start('12345')).rows[0].result.download,true);

  // The new cap must still block another 54-MiB reservation near 900 MiB.
  await db.query(`update storage.objects set metadata=jsonb_build_object('size',$1::bigint)
    where bucket_id='test-extra'`,[870*1024*1024]);
  await assert.rejects(start('12346'),/api_file_storage_budget_exceeded/);
 }finally{await db.close();}
});
