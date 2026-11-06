
/* Calendario MVP; la autorización definitiva la aplica Supabase RLS. */
import { validateSteps, stepsTotalSeconds, describeStep } from './structured-steps.js';
import { createStepsEditor } from './structured-steps-ui.js';
import { publishWorkoutToGarmin } from './garmin-api.js';
const SPORTS = { cycling: 'Ciclismo', running: 'Carrera', swimming: 'Natación', strength: 'Fuerza', other: 'Otro' };
const WEEKDAYS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

export function isoDate(date) {
  return [date.getFullYear(), String(date.getMonth()+1).padStart(2,'0'), String(date.getDate()).padStart(2,'0')].join('-');
}

export function calendarDays(year, month) {
  const offset=(new Date(year,month,1).getDay()+6)%7;
  const length=new Date(year,month+1,0).getDate();
  return Array.from({length:Math.ceil((offset+length)/7)*7},(_,i)=> {
    const d=i-offset+1;
    return d<1||d>length ? null : isoDate(new Date(year,month,d));
  });
}

export function validateWorkout(values) {
  const title=String(values.title||'').trim();
  const duration=Number(values.duration_minutes);
  const scheduled_date=String(values.scheduled_date||'');
  const sport=String(values.sport||'cycling');
  const intensity_target=String(values.intensity_target||'').trim();
  const coach_notes=String(values.coach_notes||'').trim();
  if(!title || title.length>160)throw new Error('El título debe tener entre 1 y 160 caracteres.');
  if(!Number.isInteger(duration)||duration<1||duration>1440)throw new Error('Indica una duración de 1 a 1.440 minutos.');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(scheduled_date))throw new Error('Selecciona una fecha válida.');
  const [year,month,day]=scheduled_date.split('-').map(Number);
  const dt=new Date(year,month-1,day);
  if(dt.getFullYear()!==year||dt.getMonth()!==month-1||dt.getDate()!==day)throw new Error('Selecciona una fecha válida.');
  if(!Object.prototype.hasOwnProperty.call(SPORTS,sport))throw new Error('Deporte no válido.');
  if(intensity_target.length>180||coach_notes.length>3000)throw new Error('Reduce la longitud de las indicaciones.');
  const hasSteps=Object.prototype.hasOwnProperty.call(values,'steps');
  const steps=hasSteps ? validateSteps(values.steps) : undefined;
  const total=steps ? Math.ceil(stepsTotalSeconds(steps)/60) : duration;
  const result={title,duration_minutes:total,scheduled_date,sport,intensity_target:intensity_target||null,coach_notes:coach_notes||null};
  if(hasSteps)result.steps=steps;
  return result;
}

function node(tag,cls,text) {
  const element=document.createElement(tag);
  if(cls)element.className=cls;
  if(text!==undefined)element.textContent=String(text);
  return element;
}
function button(label,cls,action) {
  const element=node('button',cls,label);
  element.type='button';
  element.addEventListener('click',action);
  return element;
}
function labelled(label,input) {
  const element=node('label','ap-field');
  element.append(node('span','',label),input);
  return element;
}
function fieldInput(name,type,placeholder,maxlength) {
  const input=node('input','ap-input');
  input.name=name;
  input.type=type;
  if(placeholder)input.placeholder=placeholder;
  if(maxlength)input.maxLength=maxlength;
  return input;
}
function assertResult(result) {
  if(result.error)throw new Error('No se ha podido acceder al calendario. Revisa tu sesión o vuelve a intentarlo.');
  return result.data||[];
}


/* Nunca usar service_role en navegador. Supabase RLS valida entrenador y vinculación activa. */
export async function updatePlannedWorkout(client,coachId,workoutId,values){
  if(!coachId||!workoutId)throw new Error('No se ha identificado la sesión.');
  const payload=validateWorkout(values);
  const result=await client.from('planned_workouts')
    .update(payload).eq('id',workoutId).eq('coach_id',coachId)
    .select('id').single();
  const saved=assertResult(result);
  if(!saved?.id)throw new Error('No se ha podido actualizar el entrenamiento.');
  return saved;
}

export async function deletePlannedWorkout(client,coachId,workoutId){
  if(!coachId||!workoutId)throw new Error('No se ha identificado la sesión.');
  const result=await client.from('planned_workouts')
    .delete().eq('id',workoutId).eq('coach_id',coachId)
    .select('id');
  const removed=assertResult(result);
  if(!Array.isArray(removed)||removed.length!==1||removed[0].id!==workoutId){
    throw new Error('No se ha podido eliminar el entrenamiento.');
  }
  return removed[0];
}

export async function mountPlanner({root,client,user,role}) {
  if(!root||!client?.from||!user?.id||!['coach','athlete'].includes(role))return;
  let month=new Date();
  month=new Date(month.getFullYear(),month.getMonth(),1);
  let day=isoDate(new Date());
  let workouts=[],activities=[],athletes=[],notice='',busy=false,editingId=null,deleteId=null;
  const localDay=timestamp=>isoDate(new Date(timestamp));
  const range=()=>[isoDate(month),isoDate(new Date(month.getFullYear(),month.getMonth()+1,1))];

  async function load() {
    notice='Cargando sesiones…';
    paint();
    try {
      const [start,end]=range();
      const result=await client.from('planned_workouts')
        .select('id,coach_id,athlete_id,scheduled_date,sport,title,duration_minutes,intensity_target,coach_notes,status,steps')
        .eq(role==='coach'?'coach_id':'athlete_id',user.id)
        .gte('scheduled_date',start).lt('scheduled_date',end)
        .order('scheduled_date',{ascending:true});
      workouts=assertResult(result);
      // RLS limits both athlete and coach to activities they are authorized to see.
      // Include adjacent UTC days so local dates close to midnight are not lost.
      const firstUtc=new Date(Date.UTC(month.getFullYear(),month.getMonth(),0)).toISOString();
      const lastUtc=new Date(Date.UTC(month.getFullYear(),month.getMonth()+1,2)).toISOString();
      let completed=client.from('activities')
        .select('id,athlete_id,started_at,sport,title,duration_seconds,distance_meters,avg_heart_rate,avg_power_watts')
        .gte('started_at',firstUtc).lt('started_at',lastUtc).order('started_at',{ascending:true}).limit(1000);
      if(role==='athlete')completed=completed.eq('athlete_id',user.id);
      activities=assertResult(await completed);
      athletes=[];
      if(role==='coach'){
        const links=assertResult(await client.from('coach_athletes')
          .select('athlete_id').eq('coach_id',user.id).eq('status','active'));
        if(links.length){
          const ids=links.map(link=>link.athlete_id);
          const profiles=assertResult(await client.from('profiles')
            .select('user_id,display_name').in('user_id',ids));
          const names=new Map(profiles.map(profile=>[profile.user_id,profile.display_name]));
          athletes=ids.map(id=>({id,name:names.get(id)||'Deportista sin nombre'}));
        }
      }
      notice='';
    } catch(error) {
      workouts=[];activities=[];athletes=[];
      notice=error?.message||'No hemos podido cargar el calendario.';
    }
    paint();
  }

  function paint() {
    root.replaceChildren();
    const wrap=node('div','ap-planner');
    wrap.append(node('h2','','Calendario de entrenamientos'));
    const message=node('p','ap-status',notice);
    message.setAttribute('role','status');
    message.setAttribute('aria-live','polite');
    wrap.append(message);
    const title=month.toLocaleDateString('es-ES',{month:'long',year:'numeric'});
    const heading=node('div','ap-month-header');
    const jump=node('input','ap-input');jump.type='month';
    jump.value=month.getFullYear()+'-'+String(month.getMonth()+1).padStart(2,'0');
    jump.setAttribute('aria-label','Ir a otro mes del historial');
    jump.addEventListener('change',()=>{
      if(!/^\\d{4}-\\d{2}$/.test(jump.value))return;
      const [y,m]=jump.value.split('-').map(Number);
      if(y<1990||y>new Date().getFullYear()+1||m<1||m>12)return;
      month=new Date(y,m-1,1);day=isoDate(month);editingId=null;deleteId=null;void load();
    });
    heading.append(
      button('‹','ap-nav',()=>move(-1)),
      node('h3','',title),jump,
      button('›','ap-nav',()=>move(1))
    );
    wrap.append(heading);
    const grid=node('div','ap-grid');
    grid.setAttribute('aria-label','Calendario de '+title);
    for(const label of WEEKDAYS)grid.append(node('span','ap-dayname',label));
    for(const date of calendarDays(month.getFullYear(),month.getMonth())){
      if(!date){grid.append(node('span','ap-blank'));continue;}
      const count=workouts.filter(w=>w.scheduled_date===date).length+activities.filter(a=>localDay(a.started_at)===date).length;
      const cell=button(String(Number(date.slice(-2)))+(count?' ·'+count:''),'ap-day'+(date===day?' chosen':''),()=>{day=date;editingId=null;deleteId=null;paint();});
      cell.setAttribute('aria-label',date+': '+count+' entrenamientos');
      cell.setAttribute('aria-pressed',String(date===day));
      grid.append(cell);
    }
    wrap.append(grid);
    const list=node('section','ap-box');
    list.append(node('h3','','Entrenamientos del '+day.split('-').reverse().join('/')));
    const selected=workouts.filter(w=>w.scheduled_date===day);
    if(!selected.length)list.append(node('p','ap-muted','No hay sesiones programadas para este día.'));
    for(const w of selected){
      const card=node('article','ap-workout');
      card.append(node('strong','',w.title));
      const name=athletes.find(a=>a.id===w.athlete_id)?.name;
      card.append(node('p','', (SPORTS[w.sport]||'Deporte')+' · '+w.duration_minutes+' min'+(name?' · '+name:'')));
      if(w.intensity_target)card.append(node('p','','Objetivo: '+w.intensity_target));
      if(w.coach_notes)card.append(node('p','','Indicaciones: '+w.coach_notes));
      if(Array.isArray(w.steps) && w.steps.length){
        const blocks=node('div','ap-workout-blocks');
        blocks.append(node('strong','','Bloques de la sesión'));
        for(const step of w.steps)blocks.append(node('p','',describeStep(step)));
        card.append(blocks);
        if(w.status==='planned'){
          const delivery=node('p','ap-status');delivery.setAttribute('role','status');
          const send=button('Enviar a Garmin','ap-action',async()=>{
            send.disabled=true;delivery.textContent='Comprobando permisos y enviando…';
            try{delivery.textContent=await publishWorkoutToGarmin(client,w.id);}
            catch(error){delivery.textContent=error.message;}
            finally{send.disabled=false;}
          });
          card.append(send,delivery);
        }
      }
      if(role==='coach'){
        const actions=node('div','ap-workout-actions');
        actions.append(
          button('Editar','ap-action',()=>{
            if(busy)return;
            editingId=w.id;deleteId=null;
            paint();
            root.querySelector('#ap-workout-form')?.scrollIntoView?.({behavior:'smooth',block:'nearest'});
          }),
          button('Eliminar','ap-action ap-danger',()=>{
            if(busy)return;
            deleteId=deleteId===w.id?null:w.id;
            editingId=null;
            paint();
          })
        );
        card.append(actions);
        if(deleteId===w.id){
          const confirm=node('div','ap-delete-confirm');
          confirm.append(node('p','','¿Eliminar definitivamente «'+w.title+'»? Esta acción no se puede deshacer.'));
          confirm.append(
            button('Sí, eliminar','ap-action ap-danger',()=>void deleteSelected(w)),
            button('Cancelar','ap-action',()=>{deleteId=null;paint();})
          );
          card.append(confirm);
        }
      }
      list.append(card);
    }
    wrap.append(list);
    const doneToday=activities.filter(a=>localDay(a.started_at)===day);
    if(doneToday.length){
      const done=node('section','ap-box');
      done.append(node('h3','','Actividades realizadas · '+day.split('-').reverse().join('/')));
      for(const activity of doneToday){
        const entry=node('article','ap-workout');entry.append(node('strong','',activity.title));
        const athlete=athletes.find(a=>a.id===activity.athlete_id)?.name;
        const km=activity.distance_meters===null?'':(' · '+(activity.distance_meters/1000).toLocaleString('es-ES',{maximumFractionDigits:2})+' km');
        const pulse=activity.avg_heart_rate===null?'':(' · '+activity.avg_heart_rate+' lpm');
        const watts=activity.avg_power_watts===null?'':(' · '+activity.avg_power_watts+' W');
        entry.append(node('p','',(SPORTS[activity.sport]||activity.sport)+' · '+Math.round(activity.duration_seconds/60)+' min'+km+pulse+watts+(athlete?' · '+athlete:'')));
        done.append(entry);
      }
      wrap.append(done);
    }
    if(role==='coach')wrap.append(workoutForm());
    root.append(wrap);
  }

  function move(step) {
    month=new Date(month.getFullYear(),month.getMonth()+step,1);
    day=isoDate(month);
    editingId=null;deleteId=null;
    void load();
  }


  async function deleteSelected(workout){
    if(busy||role!=='coach')return;
    busy=true;notice='Eliminando entrenamiento…';paint();
    try{
      await deletePlannedWorkout(client,user.id,workout.id);
      if(editingId===workout.id)editingId=null;
      deleteId=null;
      await load();
      notice='Entrenamiento eliminado correctamente.';
      paint();
    }catch(error){
      notice=error?.message||'No se ha podido eliminar el entrenamiento.';
      paint();
    }finally{busy=false;}
  }

  function workoutForm(){
    const current=editingId ? workouts.find(w=>w.id===editingId) : null;
    const form=node('form','ap-box ap-form');
    form.id='ap-workout-form';
    form.append(node('h3','',current?'Editar entrenamiento':'Programar entrenamiento'));
    if(!current && !athletes.length){
      form.append(node('p','ap-muted','Todavía no tienes deportistas vinculados activamente.'));
      return form;
    }
    const athlete=node('select','ap-input');
    athlete.name='athlete_id';
    const people=current
      ? [{id:current.athlete_id,name:athletes.find(a=>a.id===current.athlete_id)?.name||'Deportista'}]
      : athletes;
    for(const person of people){
      const option=node('option','',person.name);
      option.value=person.id;
      athlete.append(option);
    }
    if(current)athlete.disabled=true; // Cambiar el destinatario exige crear otra sesión.
    const date=fieldInput('scheduled_date','date');date.value=current?.scheduled_date||day;date.required=true;
    const name=fieldInput('title','text','Rodaje de resistencia',160);name.value=current?.title||'';name.required=true;
    const duration=fieldInput('duration_minutes','number');duration.min='1';duration.max='1440';duration.value=String(current?.duration_minutes||90);duration.required=true;
    const sport=node('select','ap-input');sport.name='sport';
    for(const [value,label] of Object.entries(SPORTS)){
      const option=node('option','',label);option.value=value;sport.append(option);
    }
    sport.value=current?.sport||'cycling';
    const target=fieldInput('intensity_target','text','Zona 2 de potencia',180);target.value=current?.intensity_target||'';
    const notes=node('textarea','ap-input');notes.name='coach_notes';notes.maxLength=3000;notes.rows=3;notes.placeholder='Indicaciones del entrenador…';notes.value=current?.coach_notes||'';
    const save=node('button','ap-save',current?'Guardar cambios':'Guardar entrenamiento');save.type='submit';
    const status=node('p','ap-status');status.setAttribute('role','status');
    const stepsEditor=createStepsEditor(form.ownerDocument,current?.steps||[],({count,seconds})=>{
      if(count){
        duration.value=String(Math.ceil(seconds/60));
        duration.readOnly=true;
        duration.title='Se calcula a partir de los bloques';
      }else{
        duration.readOnly=false;
        duration.title='';
      }
    });
    form.append(labelled('Deportista',athlete),labelled('Fecha',date),labelled('Título',name),labelled('Duración (minutos)',duration),labelled('Deporte',sport),labelled('Objetivo',target),labelled('Indicaciones',notes),stepsEditor.element,save,status);
    if(current)form.append(button('Cancelar edición','ap-action',()=>{editingId=null;paint();}));
    form.addEventListener('submit',async event=>{
      event.preventDefault();
      if(busy)return;
      busy=true;save.disabled=true;status.textContent='Guardando…';
      try{
        const payload=validateWorkout({title:name.value,scheduled_date:date.value,duration_minutes:duration.value,sport:sport.value,intensity_target:target.value,coach_notes:notes.value,steps:stepsEditor.getSteps()});
        if(current){
          await updatePlannedWorkout(client,user.id,current.id,payload);
        }else{
          const response=await client.from('planned_workouts')
            .insert({...payload,coach_id:user.id,athlete_id:athlete.value,status:'planned'})
            .select('id').single();
          const saved=assertResult(response);
          if(!saved?.id)throw new Error('No se ha podido confirmar el guardado.');
        }
        const [yy,mm]=date.value.split('-').map(Number);
        month=new Date(yy,mm-1,1);day=date.value;
        editingId=null;deleteId=null;
        await load();
        notice=current?'Entrenamiento actualizado correctamente.':'Entrenamiento guardado correctamente.';
        paint();
      }catch(error){
        status.textContent=error?.message||'No se ha podido guardar la sesión.';
      }finally{busy=false;save.disabled=false;}
    });
    return form;
  }

  await load();
}

