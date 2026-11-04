import { randomUUID } from 'node:crypto';
import { demand } from './garmin-protocol.mjs';
export async function withGarminLease(repo,athleteId,operation){
  const key='athlete:'+athleteId,owner=randomUUID();
  demand(await repo.lease(key,owner),'garmin_operation_in_progress',409);
  try{return await operation();}finally{await repo.release(key,owner).catch(()=>{});}
}
