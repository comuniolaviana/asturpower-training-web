import {validatePhysiology} from './performance.js';
const COLUMNS='id,athlete_id,sport,effective_date,ftp,lthr,hr_max,hr_rest,weight_kg,threshold_pace_seconds,power_zone_bounds,hr_zone_bounds,created_at';
export async function requirePerformanceSession(client,userId) {
  const auth=await client.auth.getUser();
  if(auth.error||!auth.data?.user||auth.data.user.id!==userId)throw new Error('La sesión ha cambiado. Vuelve a entrar.');
}
export async function loadPhysiology(client,userId,athleteId) {
  await requirePerformanceSession(client,userId);
  const result=await client.from('athlete_physiology').select(COLUMNS).eq('athlete_id',athleteId).order('effective_date',{ascending:false}).order('created_at',{ascending:false}).order('id',{ascending:false}).limit(501);
  if(result.error)throw new Error('No se ha podido cargar la ficha. Revisa tu sesión o la vinculación.');
  return {rows:(result.data||[]).slice(0,500),truncated:(result.data||[]).length>500};
}
export async function savePhysiology(client,userId,athleteId,values) {
  const payload=validatePhysiology(values);
  await requirePerformanceSession(client,userId);
  const result=await client.from('athlete_physiology').insert({...payload,athlete_id:athleteId,created_by:userId}).select(COLUMNS).single();
  if(result.error||!result.data?.id)throw new Error('No se ha guardado la ficha. Comprueba que la vinculación sigue activa y vuelve a intentarlo.');
  return result.data;
}
