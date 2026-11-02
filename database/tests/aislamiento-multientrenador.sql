-- AsturPower: aislamiento con dos entrenadores y una identidad con dos roles.
-- Solo pruebas: sin credenciales, correos, identidades de login o sesiones.
-- Todas las filas ficticias se descartan con ROLLBACK.
begin;
do $tests$
declare c1 uuid:=gen_random_uuid(); c2 uuid:=gen_random_uuid();
 x uuid:=gen_random_uuid(); y uuid:=gen_random_uuid(); z uuid:=gen_random_uuid(); p uuid:=gen_random_uuid();
 n bigint; passed integer:=0;
begin
 insert into auth.users(id) values(c1),(c2),(x),(y),(z),(p);
 execute 'set local role service_role';
 insert into public.profiles(user_id,display_name) values(c1,'Coach A ficticio'),(c2,'Coach B ficticio'),(x,'Athlete X ficticio'),(y,'Athlete Y ficticio'),(z,'Shared athlete ficticio'),(p,'Revoked athlete ficticio');
 insert into public.user_roles(user_id,role) values(c1,'coach'),(c1,'athlete'),(c2,'coach'),(x,'athlete'),(y,'athlete'),(z,'athlete'),(p,'athlete');
 insert into public.coach_athletes(coach_id,athlete_id,status) values(c1,x,'active'),(c2,y,'active'),(c2,c1,'active'),(c1,z,'pending'),(c2,z,'active'),(c1,p,'revoked');
-- coach_a_cannot_see_coach_b_athlete
execute 'set local role authenticated'; perform set_config('request.jwt.claim.sub',c1::text,true); perform set_config('request.jwt.claims',jsonb_build_object('sub',c1,'role','authenticated')::text,true); if not (not exists(select 1 from public.profiles where user_id=y)) then raise exception 'Coach A saw B athlete'; end if;
passed:=passed+1;
-- coach_a_sees_own_active_athlete
if not (exists(select 1 from public.profiles where user_id=x)) then raise exception 'Coach A cannot see own active athlete'; end if;
passed:=passed+1;
-- coach_a_cannot_see_pending_or_revoked
if not (not exists(select 1 from public.profiles where user_id in(z,p))) then raise exception 'Pending or revoked data leaked'; end if;
passed:=passed+1;
-- coach_a_sees_no_other_coach_relationships
if not (not exists(select 1 from public.coach_athletes where coach_id=c2 and athlete_id<>c1)) then raise exception 'Foreign portfolio relationships leaked'; end if;
passed:=passed+1;
-- dual_user_sees_both_own_roles
select count(*) into n from public.user_roles; if not (n=2) then raise exception 'Dual membership missing'; end if;
passed:=passed+1;
-- dual_user_separates_coach_workspace
select count(*) into n from public.coach_athletes where coach_id=c1; if not (n=3) then raise exception 'Coach workspace mixed incoming links'; end if;
passed:=passed+1;
-- dual_user_separates_athlete_workspace
select count(*) into n from public.coach_athletes where athlete_id=c1; if not (n=1) then raise exception 'Athlete workspace mixed outgoing links'; end if;
passed:=passed+1;
-- coach_cannot_edit_own_athlete_profile
update public.profiles set display_name='Unauthorized' where user_id=x; get diagnostics n=row_count; if not (n=0) then raise exception 'Coach changed athlete profile'; end if;
passed:=passed+1;
-- client_cannot_assign_roles
begin insert into public.user_roles(user_id,role) values(c1,'admin'); raise exception 'Expected permission denied'; exception when insufficient_privilege then null; end;
passed:=passed+1;
-- client_cannot_activate_relationship
begin update public.coach_athletes set status='active' where coach_id=c1 and athlete_id=z; raise exception 'Expected permission denied'; exception when insufficient_privilege then null; end;
passed:=passed+1;
-- coach_b_sees_only_authorized_portfolio
execute 'set local role authenticated'; perform set_config('request.jwt.claim.sub',c2::text,true); perform set_config('request.jwt.claims',jsonb_build_object('sub',c2,'role','authenticated')::text,true); if not (not exists(select 1 from public.profiles where user_id=x)) then raise exception 'Coach B saw A athlete'; end if; select count(*) into n from public.profiles; if not (n=4) then raise exception 'Coach B portfolio incomplete'; end if;
passed:=passed+1;
-- coach_b_cannot_self_add_athlete_role
begin insert into public.user_roles(user_id,role) values(c2,'athlete'); raise exception 'Expected permission denied'; exception when insufficient_privilege then null; end;
passed:=passed+1;
-- athlete_identity_independent_of_coach
execute 'set local role authenticated'; perform set_config('request.jwt.claim.sub',x::text,true); perform set_config('request.jwt.claims',jsonb_build_object('sub',x,'role','authenticated')::text,true); select count(*) into n from public.profiles; if not (n=1 and exists(select 1 from public.profiles where user_id=x)) then raise exception 'Athlete identity leaked or disappeared'; end if;
passed:=passed+1;
-- athlete_cannot_see_other_athletes
if not (not exists(select 1 from public.profiles where user_id in(y,z))) then raise exception 'Athlete saw others'; end if;
passed:=passed+1;
-- anonymous_denied
execute 'set local role anon'; begin perform 1 from public.profiles; raise exception 'Expected permission denied'; exception when insufficient_privilege then null; end;
passed:=passed+1;
-- duplicate_role_rejected
execute 'set local role service_role'; begin insert into public.user_roles(user_id,role) values(c1,'athlete'); raise exception 'Duplicate role accepted'; exception when unique_violation then null; end;
passed:=passed+1;
-- roles_enforced_on_relationships
begin insert into public.coach_athletes(coach_id,athlete_id) values(c1,c2); raise exception 'Coach without athlete role accepted'; exception when foreign_key_violation then null; end;
passed:=passed+1;
-- shared_athlete_requires_authorized_link
update public.coach_athletes set status='active' where coach_id=c1 and athlete_id=z; execute 'set local role authenticated'; perform set_config('request.jwt.claim.sub',c1::text,true); perform set_config('request.jwt.claims',jsonb_build_object('sub',c1,'role','authenticated')::text,true); if not (exists(select 1 from public.profiles where user_id=z)) then raise exception 'Authorized shared athlete missing'; end if;
passed:=passed+1;
-- revocation_is_per_coach
execute 'set local role service_role'; update public.coach_athletes set status='revoked' where coach_id=c1 and athlete_id=z; execute 'set local role authenticated'; perform set_config('request.jwt.claim.sub',c1::text,true); perform set_config('request.jwt.claims',jsonb_build_object('sub',c1,'role','authenticated')::text,true); if not (not exists(select 1 from public.profiles where user_id=z)) then raise exception 'A still sees revoked shared athlete'; end if; execute 'set local role authenticated'; perform set_config('request.jwt.claim.sub',c2::text,true); perform set_config('request.jwt.claims',jsonb_build_object('sub',c2,'role','authenticated')::text,true); if not (exists(select 1 from public.profiles where user_id=z)) then raise exception 'B lost valid shared relationship'; end if;
passed:=passed+1;
-- removing_coach_role_preserves_athlete_identity
execute 'set local role service_role'; delete from public.user_roles where user_id=c1 and role='coach'; if not (exists(select 1 from public.profiles where user_id=c1) and exists(select 1 from public.user_roles where user_id=c1 and role='athlete')) then raise exception 'Role removal deleted athlete identity'; end if; if not (exists(select 1 from public.coach_athletes where coach_id=c2 and athlete_id=c1)) then raise exception 'Incoming relationship removed with outgoing role'; end if;
passed:=passed+1;
-- removed_coach_role_loses_outgoing_portfolio
execute 'set local role authenticated'; perform set_config('request.jwt.claim.sub',c1::text,true); perform set_config('request.jwt.claims',jsonb_build_object('sub',c1,'role','authenticated')::text,true); if not (not exists(select 1 from public.profiles where user_id=x) and not exists(select 1 from public.coach_athletes where coach_id=c1)) then raise exception 'Removed coach kept access'; end if;
passed:=passed+1;
-- disconnect_does_not_delete_athlete_account
execute 'set local role service_role'; update public.coach_athletes set status='revoked' where coach_id=c2 and athlete_id=c1; execute 'set local role authenticated'; perform set_config('request.jwt.claim.sub',c1::text,true); perform set_config('request.jwt.claims',jsonb_build_object('sub',c1,'role','authenticated')::text,true); if not (exists(select 1 from public.profiles where user_id=c1)) then raise exception 'Disconnect deleted athlete'; end if; execute 'set local role authenticated'; perform set_config('request.jwt.claim.sub',c2::text,true); perform set_config('request.jwt.claims',jsonb_build_object('sub',c2,'role','authenticated')::text,true); if not (not exists(select 1 from public.profiles where user_id=c1)) then raise exception 'Coach retained revoked athlete'; end if;
passed:=passed+1;
 if passed<>22 then raise exception 'Incomplete suite'; end if;
end $tests$;
rollback;
select jsonb_build_object('passed',22,'fixtures','rolled back','tests','["coach_a_cannot_see_coach_b_athlete","coach_a_sees_own_active_athlete","coach_a_cannot_see_pending_or_revoked","coach_a_sees_no_other_coach_relationships","dual_user_sees_both_own_roles","dual_user_separates_coach_workspace","dual_user_separates_athlete_workspace","coach_cannot_edit_own_athlete_profile","client_cannot_assign_roles","client_cannot_activate_relationship","coach_b_sees_only_authorized_portfolio","coach_b_cannot_self_add_athlete_role","athlete_identity_independent_of_coach","athlete_cannot_see_other_athletes","anonymous_denied","duplicate_role_rejected","roles_enforced_on_relationships","shared_athlete_requires_authorized_link","revocation_is_per_coach","removing_coach_role_preserves_athlete_identity","removed_coach_role_loses_outgoing_portfolio","disconnect_does_not_delete_athlete_account"]'::jsonb) as multicoach_test_result;

