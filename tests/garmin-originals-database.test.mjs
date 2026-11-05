// PostgreSQL RLS/privilege tests against synthetic identities, never hosted data.
import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
const root=new URL('../',import.meta.url),read=p=>readFile(new URL(p,root),'utf8');
const A='a9999999-0000-4000-8000-000000000001',B='a9999999-0000-4000-8000-000000000002',C='c9999999-0000-4000-8000-000000000001';
const ID='a'.repeat(64),HASH='b'.repeat(64),PATH=A+'/'+ID+'/000000-'+HASH+'.bin';
test('private original vault enforces owner access, complete manifests, immutable chunks and a shared free budget in PostgreSQL',async()=>{
 const db=new PGlite();
 try{
  await db.exec(await read('tests/fixtures/garmin-auth-scaffold.sql'));
  await db.exec(await read('database/esquema-inicial-aplicado.sql'));
  await db.exec(await read('database/cambio-multirrol-aplicado.sql'));
  await db.exec(`create schema storage;
   create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
   create table storage.objects(bucket_id text,name text,metadata jsonb,primary key(bucket_id,name));
   alter table storage.objects enable row level security;
   grant usage on schema storage to anon,authenticated,service_role;
   grant select,insert,update,delete on storage.objects to authenticated;
   insert into auth.users(id) values('${A}'),('${B}'),('${C}');
   insert into public.profiles(user_id,display_name) values('${A}','Athlete A fixture'),('${B}','Athlete B fixture'),('${C}','Coach fixture');
   insert into public.user_roles(user_id,role) values('${A}','athlete'),('${B}','athlete'),('${C}','coach');
   insert into public.coach_athletes(coach_id,athlete_id,status) values('${C}','${A}','active');`);
  await db.exec(await read('supabase/migrations/20261105182658_garmin_original_archives.sql'));
  await db.exec(await read('supabase/migrations/20261105182926_garmin_original_rpc_boundary.sql'));
  assert.equal((await db.query("select count(*)::int as n from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('reserve_garmin_original','complete_garmin_original') and p.prosecdef")).rows[0].n,0);
  const bucket=(await db.query("select public,file_size_limit from storage.buckets where id='garmin-originals'")).rows[0];
  assert.equal(bucket.public,false);assert.equal(Number(bucket.file_size_limit),4194304);
  for(const fn of ['reserve_garmin_original(text,text,bigint,jsonb,boolean)','complete_garmin_original(text)']){
   assert.equal((await db.query(`select has_function_privilege('anon','public.${fn}','EXECUTE') as allowed`)).rows[0].allowed,false);
  }
  const as=async id=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec('set role authenticated');};
  const reserve=async(id=ID,chunks=[{sha256:HASH,size:3}],size=3,consent=true)=>db.query('select public.reserve_garmin_original($1,$2,$3,$4::jsonb,$5) as result',[id,'full-export-fixture.zip',size,JSON.stringify(chunks),consent]);
  await as(C);await assert.rejects(reserve(),/athlete_required/);
  await as(A);await assert.rejects(reserve(ID,[{sha256:HASH,size:3}],3,false),/original_consent_required/);
  await assert.rejects(reserve(ID,[{sha256:HASH,size:2}],3),/invalid_original_manifest/);
  await assert.rejects(reserve(ID,[{sha256:HASH,size:'9999999999999999999999999999'}],3),/invalid_original_manifest/);
  const reserved=(await reserve()).rows[0].result;assert.equal(reserved.status,'uploading');
  assert.equal((await reserve()).rows[0].result.archive_id,ID);
  await assert.rejects(reserve(ID,[{sha256:'c'.repeat(64),size:3}],3),/original_manifest_conflict/);
  await assert.rejects(db.query('select public.complete_garmin_original($1)',[ID]),/original_upload_incomplete/);
  await assert.rejects(db.query("insert into storage.objects values('garmin-originals',$1,'{\"size\":3}')",[B+'/'+ID+'/000000-'+HASH+'.bin']),/row-level security/);
  await assert.rejects(db.query("insert into storage.objects values('garmin-originals',$1,'{\"size\":3}')",[A+'/'+ID+'/000001-'+HASH+'.bin']),/row-level security/);
  await assert.rejects(db.query("insert into storage.objects values('garmin-originals',$1,'{\"size\":4}')",[PATH]),/row-level security/);
  await db.query("insert into storage.objects values('garmin-originals',$1,'{\"size\":3}')",[PATH]);
  const completed=(await db.query('select public.complete_garmin_original($1) as result',[ID])).rows[0].result;assert.equal(completed.status,'ready');
  assert.equal((await db.query('select count(*)::int as n from public.garmin_original_archives')).rows[0].n,1);
  assert.equal((await db.query('select count(*)::int as n from storage.objects')).rows[0].n,1);
  const changed=await db.query("update storage.objects set metadata='{\"size\":4}' where name=$1 returning name",[PATH]);assert.equal(changed.rows.length,0);
  const removed=await db.query('delete from storage.objects where name=$1 returning name',[PATH]);assert.equal(removed.rows.length,0);
  await assert.rejects(db.query("update public.garmin_original_archives set status='uploading'"),/permission denied/);
  for(const other of [B,C]){
   await as(other);
   assert.equal((await db.query('select count(*)::int as n from public.garmin_original_archives')).rows[0].n,0);
   assert.equal((await db.query('select count(*)::int as n from storage.objects')).rows[0].n,0);
   await assert.rejects(db.query('select public.complete_garmin_original($1)',[ID]),/original_not_found/);
  }
  await as(B);
  const pieces=Array.from({length:200},(_,i)=>({sha256:HASH,size:i===199?3*1024*1024:4*1024*1024}));
  await reserve('d'.repeat(64),pieces,799*1024*1024);
  await as(A);await assert.rejects(reserve('e'.repeat(64),[{sha256:HASH,size:2*1024*1024}],2*1024*1024),/original_storage_budget_exceeded/);
  await db.exec('reset role;set role anon');await assert.rejects(db.query('select * from public.garmin_original_archives'),/permission denied/);
 }finally{await db.close();}
});
