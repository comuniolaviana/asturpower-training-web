// Actual PostgreSQL engine in WebAssembly. No hosted credentials or external requests.
import { PGlite } from '@electric-sql/pglite';
import { readFile,readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const root=new URL('../',import.meta.url);
const read=path=>readFile(new URL(path,root),'utf8');
const db=new PGlite();
try{
  await db.exec(await read('tests/fixtures/garmin-auth-scaffold.sql'));
  await db.exec(await read('database/esquema-inicial-aplicado.sql'));
  await db.exec(await read('database/cambio-multirrol-aplicado.sql'));
  await db.exec(await read('tests/fixtures/garmin-sport-schema.sql'));
  const migrations=(await readdir(new URL('supabase/migrations/',root))).filter(f=>f.endsWith('_garmin_sync.sql'));
  assert.equal(migrations.length,1,'one canonical synchronization migration');
  await db.exec(await read('supabase/migrations/'+migrations[0]));
  const results=await db.exec(await read('database/tests/garmin-sync.sql'));
  const assertions=results.flatMap(r=>r.rows||[]).find(r=>r.jsonb_build_object)?.jsonb_build_object;
  assert.ok(assertions?.sql_assertions_passed>=25);
  const after=await db.query(`SELECT (SELECT count(*)::int FROM auth.users) AS users,
    (SELECT count(*)::int FROM public.activities) AS activities,
    (SELECT count(*)::int FROM public.garmin_connections) AS connections,
    (SELECT count(*)::int FROM public.garmin_webhook_inbox) AS deliveries`);
  assert.deepEqual(after.rows[0],{users:0,activities:0,connections:0,deliveries:0});
  console.log(JSON.stringify({engine:'PostgreSQL/PGlite',...assertions,afterRollback:after.rows[0]},null,2));
}finally{await db.close();}
