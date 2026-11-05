// Pure calculations: estimates are kept separate from recorded activity data.
export const SPORTS = {cycling:'Ciclismo',running:'Carrera',swimming:'Natación'};
const LIMITS = {ftp:[1,2500],lthr:[30,250],hr_max:[30,250],hr_rest:[20,150],weight_kg:[15,400],threshold_pace_seconds:[30,3600]};
export function validDate(value) {
  const d=new Date(value+'T12:00:00Z');
  return typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && value>='1900-01-01' && value<='2100-12-31' && Number.isFinite(d.getTime()) && d.toISOString().slice(0,10)===value;
}
export function zoneBounds(value) {
  if(value===null || value===undefined || value==='')return null;
  const values=Array.isArray(value)?value:String(value).split(',').map(v=>v.trim());
  const result=values.map(Number);
  if(result.length<2 || result.length>9 || values.some(v=>v===''||v===null) || result.some((v,i)=>!Number.isFinite(v)||v<=0||v>300||(i>0&&v<=result[i-1])))throw new Error('Las zonas necesitan entre 2 y 9 límites ascendentes, separados por comas, entre 0 y 300 %.');
  return result;
}
export function validatePhysiology(values) {
  if(!Object.hasOwn(SPORTS,values.sport)||!validDate(values.effective_date))throw new Error('Selecciona un deporte y una fecha válidos.');
  const out={sport:values.sport,effective_date:values.effective_date};
  for(const [name,[min,max]] of Object.entries(LIMITS)) {
    const raw=values[name];out[name]=raw===null||raw===undefined||String(raw).trim()===''?null:Number(raw);
    if(out[name]!==null&&(!Number.isFinite(out[name])||out[name]<min||out[name]>max))throw new Error(`Revisa ${name}: debe estar entre ${min} y ${max}.`);
  }
  if(out.hr_rest!==null&&((out.hr_max!==null&&out.hr_rest>=out.hr_max)||(out.lthr!==null&&out.hr_rest>=out.lthr)))throw new Error('El pulso de reposo debe ser inferior al umbral y al máximo.');
  if(out.lthr!==null&&out.hr_max!==null&&out.lthr>out.hr_max)throw new Error('El pulso umbral no puede superar al máximo.');
  out.power_zone_bounds=zoneBounds(values.power_zone_bounds);out.hr_zone_bounds=zoneBounds(values.hr_zone_bounds);
  if(!Object.keys(LIMITS).some(k=>out[k]!==null)&&!out.power_zone_bounds&&!out.hr_zone_bounds)throw new Error('Introduce al menos un umbral, una medida o unas zonas.');
  return out;
}
// Every saved row is a complete snapshot; a cleared value means unknown from that date.
export function physiologyAt(rows,sport,date) {
  if(!validDate(date))throw new Error('Fecha no válida.');
  return rows.filter(r=>r.sport===sport&&r.effective_date<=date).sort((a,b)=>b.effective_date.localeCompare(a.effective_date)||String(b.created_at).localeCompare(String(a.created_at))||String(b.id).localeCompare(String(a.id)))[0]||null;
}
export function estimatedLoad(minutes,percent) {
  if(String(minutes).trim()===''||String(percent).trim()==='')throw new Error('Indica duración e intensidad.');
  const m=Number(minutes),p=Number(percent);
  if(!Number.isFinite(m)||m<=0||m>1440||!Number.isFinite(p)||p<=0||p>300)throw new Error('Duración: más de 0 y hasta 1.440 minutos. Intensidad: más de 0 y hasta 300 % del FTP.');
  return {intensityFactor:p/100,load:m/60*(p/100)**2*100};
}
export function parseScenario(text,start,days) {
  if(!validDate(start)||!Number.isInteger(days)||days<7||days>90)throw new Error('Elige fecha y horizonte de 7 a 90 días.');
  const loads=new Map();
  const lines=String(text).trim()?String(text).trim().split(/\r?\n/):[];
  if(lines.length>180)throw new Error('El escenario admite hasta 180 sesiones.');
  const last=addDays(start,days-1);
  for(const line of lines) {
    const parts=line.trim().split(/[;\s]+/);
    if(parts.length!==2||!validDate(parts[0])||!/^\d+(\.\d+)?$/.test(parts[1]))throw new Error('Usa una línea por sesión: AAAA-MM-DD; carga. Usa punto decimal.');
    const [date,raw]=parts,load=Number(raw);
    if(date<start||date>last||load>5000)throw new Error('Las sesiones deben estar dentro del horizonte y tener una carga de 0 a 5.000.');
    const total=(loads.get(date)||0)+load;
    if(total>5000)throw new Error('La carga total diaria no puede superar 5.000.');
    loads.set(date,total);
  }
  return loads;
}
export function addDays(date,days) {const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);}
export function simulatePMC({start,days,ctl,atl,loads}) {
  if(!validDate(start)||!Number.isInteger(days)||days<7||days>90||[ctl,atl].some(v=>v===null||v===undefined||String(v).trim()===''||!Number.isFinite(Number(v))||Number(v)<0||Number(v)>5000))throw new Error('Indica CTL y ATL iniciales de 0 a 5.000 y un horizonte válido.');
  if(!(loads instanceof Map))throw new Error('Escenario no válido.');
  let c=Number(ctl),a=Number(atl);const rows=[];
  for(let i=0;i<days;i++) {
    const date=addDays(start,i),load=loads.get(date)??0;
    if(typeof load!=='number'||!Number.isFinite(load)||load<0||load>5000)throw new Error('Carga diaria no válida.');
    const tsb=c-a;c+=(load-c)/42;a+=(load-a)/7;
    rows.push({date,load,ctl:c,atl:a,tsb});
  }
  return rows;
}
