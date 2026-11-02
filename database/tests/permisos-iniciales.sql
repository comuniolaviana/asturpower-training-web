-- ASTURPOWER TRAINING — SOLO ENTORNO DE DESARROLLO
-- Ejecutar con conexión privilegiada en el proyecto independiente de AsturPower.
-- Verifica permisos como anon, authenticated y service_role.
-- Las filas ficticias en auth.users carecen de credenciales/identidades y nunca se confirman.
-- Ante un fallo se debe descartar la transacción (ROLLBACK) en la misma sesión.
-- Resultado verificado el 2026-11-02: 36/36; recuentos finales cero; 0 avisos de seguridad.
-- Prueba transaccional. No crea credenciales, identidades ni sesiones de acceso.
-- Las filas ficticias de auth.users y todas sus relaciones se revierten al finalizar.
begin;
do $tests$
declare
 c uuid:=gen_random_uuid(); c2 uuid:=gen_random_uuid();
 a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid();
 p uuid:=gen_random_uuid(); r uuid:=gen_random_uuid(); u uuid:=gen_random_uuid();
 n bigint; completed integer:=0;
begin
 insert into auth.users(id) values(c),(c2),(a),(b),(p),(r),(u);
 execute 'set local role service_role';
 insert into public.profiles(user_id,display_name) values(c,'Coach 1'),(c2,'Coach 2'),(a,'Athlete active'),(b,'Athlete unrelated'),(p,'Athlete pending'),(r,'Athlete revoked');
 insert into public.user_roles(user_id,role) values(c,'coach'),(c2,'coach'),(a,'athlete'),(b,'athlete'),(p,'athlete'),(r,'athlete');
 insert into public.coach_athletes(coach_id,athlete_id,status) values(c,a,'active'),(c,p,'pending'),(c,r,'revoked'),(c2,b,'active');
 -- anon_no_profiles
execute 'set local role anon'; begin perform 1 from public.profiles; raise exception 'Expected permission denied'; exception when insufficient_privilege then null; end;
completed:=completed+1;
-- anon_no_roles
begin perform 1 from public.user_roles; raise exception 'Expected permission denied'; exception when insufficient_privilege then null; end;
completed:=completed+1;
-- anon_no_relationships
begin perform 1 from public.coach_athletes; raise exception 'Expected permission denied'; exception when insufficient_privilege then null; end;
completed:=completed+1;
-- create_own_profile
execute 'set local role authenticated'; perform set_config('request.jwt.claim.sub',u::text,true); perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true); insert into public.profiles(user_id,display_name) values(u,'Usuario de prueba');
completed:=completed+1;
-- read_own_profile_only
select count(*) into n from public.profiles; if not (n=1) then raise exception 'Own profile isolation failed'; end if;
completed:=completed+1;
-- update_own_display_name
update public.profiles set display_name='Nombre actualizado' where user_id=u; get diagnostics n=row_count; if not (n=1) then raise exception 'Own profile update failed'; end if;
completed:=completed+1;
-- cannot_create_others_profile
begin insert into public.profiles(user_id,display_name) values(c,'Impersonation'); raise exception 'Expected permission denied'; exception when insufficient_privilege then null; end;
completed:=completed+1;
-- cannot_set_creation_time
begin insert into public.profiles(user_id,display_name,created_at) values(u,'Invalid',now()); raise exception 'Expected permission denied'; exception when insufficient_privilege then null; end;
completed:=completed+1;
-- cannot_change_identity
begin update public.profiles set user_id=c where user_id=u; raise exception 'Expected permission denied'; exception when insufficient_privilege then null; end;
completed:=completed+1;
-- cannot_change_creation_time
begin update public.profiles set created_at=now() where user_id=u; raise exception 'Expected permission denied'; exception when insufficient_privilege then null; end;
completed:=completed+1;
-- cannot_assign_admin
begin insert into public.user_roles(user_id,role) values(u,'admin'); raise exception 'Expected permission denied'; exception when insufficient_privilege then null; end;
completed:=completed+1;
-- cannot_update_roles
begin update public.user_roles set role='admin' where user_id=u; raise exception 'Expected permission denied'; exception when insufficient_privilege then null; end;
completed:=completed+1;
-- cannot_create_relationship
begin insert into public.coach_athletes(coach_id,athlete_id) values(c,u); raise exception 'Expected permission denied'; exception when insufficient_privilege then null; end;
completed:=completed+1;
-- cannot_update_relationship
begin update public.coach_athletes set status='active'; raise exception 'Expected permission denied'; exception when insufficient_privilege then null; end;
completed:=completed+1;
-- cannot_delete_relationship
begin delete from public.coach_athletes; raise exception 'Expected permission denied'; exception when insufficient_privilege then null; end;
completed:=completed+1;
-- cannot_delete_profile
begin delete from public.profiles where user_id=u; raise exception 'Expected permission denied'; exception when insufficient_privilege then null; end;
completed:=completed+1;
-- invalid_name_rejected
begin update public.profiles set display_name='   ' where user_id=u; raise exception 'Invalid name accepted'; exception when check_violation then null; end;
completed:=completed+1;
-- coach_sees_self_and_active_athlete
execute 'set local role authenticated'; perform set_config('request.jwt.claim.sub',c::text,true); perform set_config('request.jwt.claims',jsonb_build_object('sub',c,'role','authenticated')::text,true); select count(*) into n from public.profiles; if not (n=2) then raise exception 'Coach profile isolation failed'; end if; if not (exists(select 1 from public.profiles where user_id=a)) then raise exception 'Active athlete invisible'; end if;
completed:=completed+1;
-- coach_sees_only_own_role
select count(*) into n from public.user_roles; if not (n=1 and exists(select 1 from public.user_roles where user_id=c and role='coach')) then raise exception 'Coach role isolation failed'; end if;
completed:=completed+1;
-- coach_sees_only_own_relationships
select count(*) into n from public.coach_athletes; if not (n=3) then raise exception 'Relationship isolation failed'; end if;
completed:=completed+1;
-- coach_cannot_update_athlete
update public.profiles set display_name='Unauthorized' where user_id=a; get diagnostics n=row_count; if not (n=0) then raise exception 'Coach changed athlete profile'; end if;
completed:=completed+1;
-- pending_and_revoked_not_visible
if not (not exists(select 1 from public.profiles where user_id in (p,r))) then raise exception 'Pending or revoked profile leaked'; end if;
completed:=completed+1;
-- athlete_sees_self_only
execute 'set local role authenticated'; perform set_config('request.jwt.claim.sub',a::text,true); perform set_config('request.jwt.claims',jsonb_build_object('sub',a,'role','authenticated')::text,true); select count(*) into n from public.profiles; if not (n=1 and exists(select 1 from public.profiles where user_id=a)) then raise exception 'Athlete profile isolation failed'; end if;
completed:=completed+1;
-- athlete_sees_own_relationship
select count(*) into n from public.coach_athletes; if not (n=1) then raise exception 'Athlete relationship isolation failed'; end if;
completed:=completed+1;
-- athlete_cannot_update_coach
update public.profiles set display_name='Unauthorized' where user_id=c; get diagnostics n=row_count; if not (n=0) then raise exception 'Athlete changed coach profile'; end if;
completed:=completed+1;
-- server_can_revoke
execute 'set local role service_role'; update public.coach_athletes set status='revoked' where coach_id=c and athlete_id=a; get diagnostics n=row_count; if not (n=1) then raise exception 'Server cannot revoke relationship'; end if;
completed:=completed+1;
-- revocation_removes_coach_access
execute 'set local role authenticated'; perform set_config('request.jwt.claim.sub',c::text,true); perform set_config('request.jwt.claims',jsonb_build_object('sub',c,'role','authenticated')::text,true); select count(*) into n from public.profiles; if not (n=1) then raise exception 'Revoked access remains'; end if;
completed:=completed+1;
-- coach_role_fk_enforced
execute 'set local role service_role'; begin insert into public.coach_athletes(coach_id,athlete_id) values(a,b); raise exception 'Athlete accepted as coach'; exception when foreign_key_violation then null; end;
completed:=completed+1;
-- athlete_role_fk_enforced
begin insert into public.coach_athletes(coach_id,athlete_id) values(c2,c); raise exception 'Coach accepted as athlete'; exception when foreign_key_violation then null; end;
completed:=completed+1;
-- self_relationship_rejected
begin insert into public.coach_athletes(coach_id,athlete_id) values(c,c); raise exception 'Self relationship accepted'; exception when check_violation then null; end;
completed:=completed+1;
-- invalid_status_rejected
begin insert into public.coach_athletes(coach_id,athlete_id,status) values(c2,a,'invalid'); raise exception 'Invalid status accepted'; exception when check_violation then null; end;
completed:=completed+1;
-- duplicate_relationship_rejected
begin insert into public.coach_athletes(coach_id,athlete_id) values(c,a); raise exception 'Duplicate accepted'; exception when unique_violation then null; end;
completed:=completed+1;
-- role_change_cannot_break_relationship
begin update public.user_roles set role='athlete' where user_id=c; raise exception 'Invalid role change accepted'; exception when foreign_key_violation then null; end;
completed:=completed+1;
-- missing_identity_sees_no_rows
execute 'set local role authenticated'; perform set_config('request.jwt.claim.sub','',true); perform set_config('request.jwt.claims','{}',true); select count(*) into n from public.profiles; if not (n=0) then raise exception 'Missing identity accessed profiles'; end if;
completed:=completed+1;
-- user_metadata_cannot_grant_admin
execute 'set local role authenticated'; perform set_config('request.jwt.claim.sub',u::text,true); perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true); perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated','user_metadata',jsonb_build_object('role','admin'))::text,true); select count(*) into n from public.profiles; if not (n=1) then raise exception 'User metadata elevated access'; end if; select count(*) into n from public.user_roles; if not (n=0) then raise exception 'Role assigned by metadata'; end if;
completed:=completed+1;
-- auth_delete_cascades
execute 'reset role'; delete from auth.users where id=c2; if not (not exists(select 1 from public.profiles where user_id=c2) and not exists(select 1 from public.user_roles where user_id=c2) and not exists(select 1 from public.coach_athletes where coach_id=c2)) then raise exception 'Cascade deletion failed'; end if;
completed:=completed+1;
 if completed<>36 then raise exception 'Test suite incomplete'; end if;
end $tests$;
rollback;
select jsonb_build_object('passed',36,'fixtures','rolled back','tests','["anon_no_profiles","anon_no_roles","anon_no_relationships","create_own_profile","read_own_profile_only","update_own_display_name","cannot_create_others_profile","cannot_set_creation_time","cannot_change_identity","cannot_change_creation_time","cannot_assign_admin","cannot_update_roles","cannot_create_relationship","cannot_update_relationship","cannot_delete_relationship","cannot_delete_profile","invalid_name_rejected","coach_sees_self_and_active_athlete","coach_sees_only_own_role","coach_sees_only_own_relationships","coach_cannot_update_athlete","pending_and_revoked_not_visible","athlete_sees_self_only","athlete_sees_own_relationship","athlete_cannot_update_coach","server_can_revoke","revocation_removes_coach_access","coach_role_fk_enforced","athlete_role_fk_enforced","self_relationship_rejected","invalid_status_rejected","duplicate_relationship_rejected","role_change_cannot_break_relationship","missing_identity_sees_no_rows","user_metadata_cannot_grant_admin","auth_delete_cascades"]'::jsonb) as test_result;
