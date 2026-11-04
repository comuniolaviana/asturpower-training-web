-- Test-only snapshot of the four Garmin/sport tables and policies, read 2026-11-04.
-- No production records. Auth scaffolding below is solely for PostgreSQL policy tests.
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,aud text,role text);
GRANT USAGE ON SCHEMA auth TO anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION auth.uid()
 RETURNS uuid
 LANGUAGE sql
 STABLE
AS $function$
  select
  coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$function$;
