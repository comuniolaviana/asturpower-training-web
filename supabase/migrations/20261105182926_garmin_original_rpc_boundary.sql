-- Exposed RPCs are invokers. Privileged quota/completeness checks live outside
-- the Data API schema, retain explicit auth.uid()/own-row checks, and expose no
-- other person's metadata. No roles, existing policies, or OAuth data change.
begin;
create schema asturpower_private;
revoke all on schema asturpower_private from public,anon,authenticated;
grant usage on schema asturpower_private to authenticated;
alter function public.reserve_garmin_original(text,text,bigint,jsonb,boolean) set schema asturpower_private;
alter function public.complete_garmin_original(text) set schema asturpower_private;

create function public.reserve_garmin_original(p_archive_id text,p_filename text,p_byte_size bigint,p_chunks jsonb,p_consent boolean)
 returns jsonb language sql security invoker set search_path='' as $$
 select asturpower_private.reserve_garmin_original(p_archive_id,p_filename,p_byte_size,p_chunks,p_consent);
$$;
create function public.complete_garmin_original(p_archive_id text)
 returns jsonb language sql security invoker set search_path='' as $$
 select asturpower_private.complete_garmin_original(p_archive_id);
$$;
revoke all on function public.reserve_garmin_original(text,text,bigint,jsonb,boolean) from public,anon,authenticated,service_role;
revoke all on function public.complete_garmin_original(text) from public,anon,authenticated,service_role;
grant execute on function public.reserve_garmin_original(text,text,bigint,jsonb,boolean) to authenticated;
grant execute on function public.complete_garmin_original(text) to authenticated;
commit;
