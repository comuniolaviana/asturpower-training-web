import {loadCoachFitDetails} from './coach-fit-dashboard.js';
import {requirePerformanceSession} from './performance-data.js';
export async function loadPMCData(client,coachId,athleteId){
 const detail=await loadCoachFitDetails(client,coachId,athleteId,{includeSeries:false});
 if(!detail.allowed)return detail;
 const workouts=[];
 for(let offset=0;offset<10000;offset+=500){
  const response=await client.from('planned_workouts').select('id,athlete_id,coach_id,scheduled_date,title,sport,status,steps,estimated_tss')
   .eq('athlete_id',athleteId).eq('coach_id',coachId).eq('status','planned').order('scheduled_date').order('id').range(offset,offset+499);
  if(response.error||!Array.isArray(response.data))throw new Error('No se pudo cargar la planificación. Pulsa Actualizar para reintentarlo.');
  workouts.push(...response.data);
  if(response.data.length<500){
   // Revalidate session and explicit consent after all private requests settle.
   await requirePerformanceSession(client,coachId);
   const [link,share]=await Promise.all([
    client.from('coach_athletes').select('athlete_id').eq('coach_id',coachId).eq('athlete_id',athleteId).eq('status','active').limit(1),
    client.from('athlete_coach_fit_sharing').select('athlete_id').eq('coach_id',coachId).eq('athlete_id',athleteId).limit(1)
   ]);
   if(link.error||share.error||link.data?.length!==1||share.data?.length!==1)throw new Error('La vinculación o el permiso deportivo han cambiado.');
   return {...detail,workouts};
  }
 }
 throw new Error('La planificación supera el límite de consulta.');
}
