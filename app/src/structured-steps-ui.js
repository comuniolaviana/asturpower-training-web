import {STEP_PHASES,STEP_TARGETS,stepsTotalSeconds} from './structured-steps.js';
/* Editor ligero, sin credenciales ni privilegios. El backend conserva los permisos RLS. */
export function createStepsEditor(doc,initial=[],onChange=()=>{}){
  let steps=Array.isArray(initial)?initial.map(item=>({...item})):[];
  const elem=(tag,cls,text)=>{
    const e=doc.createElement(tag);
    if(cls)e.className=cls;
    if(text!==undefined)e.textContent=text;
    return e;
  };
  const makeButton=(label,fn,cls='ap-action')=>{
    const button=elem('button',cls,label);button.type='button';
    button.addEventListener('click',fn);return button;
  };
  const makeSelect=(options,value,onInput)=>{
    const select=elem('select','ap-input');
    for(const [key,label] of Object.entries(options)){
      const opt=elem('option','',label);opt.value=key;select.append(opt);
    }
    select.value=value;select.addEventListener('change',e=>onInput(e.target.value));
    return select;
  };
  const labelled=(label,control)=>{
    const l=elem('label','ap-field');l.append(elem('span','',label),control);return l;
  };
  const box=elem('section','ap-box ap-steps-editor');
  box.append(elem('h3','','Estructura por bloques (opcional)'));
  box.append(elem('p','ap-muted','Añade bloques en orden. Usa 0,5 minutos para 30 segundos. La duración total se calculará automáticamente; no se envía a Garmin todavía.'));
  const rows=elem('div','ap-steps-list'),summary=elem('p','ap-step-total');
  const actions=elem('div','ap-steps-actions');
  actions.append(makeButton('+ Añadir bloque',()=>{
    if(steps.length>=30)return;
    steps.push({phase:'work',duration_seconds:300,target_type:'free',low:null,high:null});
    paint();
  }));
  box.append(rows,actions,summary);
  function report(){
    const seconds=stepsTotalSeconds(steps);
    const minutes=Math.ceil(seconds/60);
    summary.textContent=steps.length
      ? steps.length+' bloque(s) · '+(seconds/60).toLocaleString('es-ES',{maximumFractionDigits:1})+' min en total · duración en calendario: '+minutes+' min'
      : 'Sin bloques: esta sesión se guarda como entrenamiento simple.';
    onChange({count:steps.length,seconds});
  }
  function paint(){
    rows.replaceChildren();
    steps.forEach((step,i)=>{
      const wrap=elem('div','ap-step-row');
      const heading=elem('div','ap-step-heading');
      heading.append(elem('strong','', 'Bloque '+(i+1)),makeButton('Quitar',()=>{steps.splice(i,1);paint();},'ap-action ap-danger'));
      wrap.append(heading);
      const grid=elem('div','ap-step-fields');
      grid.append(labelled('Fase',makeSelect(STEP_PHASES,step.phase,value=>{step.phase=value;report();})));
      const duration=elem('input','ap-input');duration.type='number';duration.min='0.5';duration.max='360';duration.step='0.5';duration.required=true;duration.value=String((Number(step.duration_seconds)||0)/60);
      duration.addEventListener('input',()=>{
        const number=Number(duration.value);
        step.duration_seconds=duration.value && Number.isFinite(number)?Math.round(number*60):0;
        report();
      });
      grid.append(labelled('Duración (minutos)',duration));
      grid.append(labelled('Objetivo',makeSelect(STEP_TARGETS,step.target_type,value=>{
        step.target_type=value;step.low=null;step.high=null;paint();
      })));
      if(step.target_type!=='free'){
        for(const key of ['low','high']){
          const input=elem('input','ap-input');input.type='number';input.step='1';input.value=step[key]??'';
          input.placeholder=key==='low'?'Mínimo':'Máximo';input.required=true;
          input.addEventListener('input',()=>{step[key]=input.value;});
          grid.append(labelled(key==='low'?'Mínimo':'Máximo',input));
        }
      }
      wrap.append(grid);
      const order=elem('div','ap-step-order');
      order.append(
        makeButton('↑ Subir',()=>{if(i>0){[steps[i-1],steps[i]]=[steps[i],steps[i-1]];paint();}}),
        makeButton('↓ Bajar',()=>{if(i<steps.length-1){[steps[i+1],steps[i]]=[steps[i],steps[i+1]];paint();}})
      );
      wrap.append(order);
      rows.append(wrap);
    });
    report();
  }
  paint();
  return {element:box,getSteps:()=>steps.map(step=>({...step}))};
}
