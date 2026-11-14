// Comparación explícita con valores introducidos manualmente por el entrenador.
// No implica API ni acceso a TrainingPeaks, ni guarda los datos de referencia.
const thresholds={
 np:{absolute:3,relative:.015,unit:'W',label:'Potencia normalizada (NP)'},
 if:{absolute:.015,relative:.02,unit:'',label:'Factor de intensidad (IF)'},
 tss:{absolute:3,relative:.05,unit:'',label:'Carga de entrenamiento (TSS)'}
};
const finitePositive=(v,allowZero=false)=>{
 if(v===null||v===undefined||String(v).trim()==='')return null;
 const n=Number(v);return Number.isFinite(n)&&(n>0||(allowZero&&n===0))?n:null;
};
export function compareToTrainingPeaks(report,manual={}){
 const data=new Map(report?.entries?.map(e=>[e.key,e.value])||[]);
 return Object.entries(thresholds).map(([key,rule])=>{
  const reference=finitePositive(manual[key],key==='tss');
  const calculated=finitePositive(data.get(key),key==='tss');
  const delta=reference!==null&&calculated!==null?Number((calculated-reference).toFixed(key==='if'?4:2)):null;
  const within=delta===null?null:Math.abs(delta)<=Math.max(rule.absolute,Math.abs(reference)*rule.relative);
  return {key,label:rule.label,unit:rule.unit,reference,calculated,delta,within,
   state:reference===null?'sin_referencia':calculated===null?'sin_dato':within?'aproximado':'diferente'};
 });
}
