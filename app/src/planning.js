
/* Calendario MVP; la autorización definitiva la aplica Supabase RLS. */
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
  return {title,duration_minutes:duration,scheduled_date,sport,intensity_target:intensity_target||null,coach_notes:coach_notes||null};
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

export async function mountPlanner({root,client,user,role}) {
  if(!root||!client?.from||!user?.id||!['coach','athlete'].includes(role))return;
  let month=new Date();
  month=new Date(month.getFullYear(),month.getMonth(),1);
  let day=isoDate(new Date());
  let workouts=[],athletes=[],notice='',busy=false;
  const range=()=>[isoDate(month),isoDate(new Date(month.getFullYear(),month.getMonth()+1,1))];

  async function load() {
    notice='Cargando sesiones…';
    paint();
    try {
      const [start,end]=range();
      const result=await client.from('planned_workouts')
        .select('id,coach_id,athlete_id,scheduled_date,sport,title,duration_minutes,intensity_target,coach_notes,status')
        .eq(role==='coach'?'coach_id':'athlete_id',user.id)
        .gte('scheduled_date',start).lt('scheduled_date',end)
        .order('scheduled_date',{ascending:true});
      workouts=assertResult(result);
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
      workouts=[];athletes=[];
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
    heading.append(
      button('‹','ap-nav',()=>move(-1)),
      node('h3','',title),
      button('›','ap-nav',()=>move(1))
    );
    wrap.append(heading);
    const grid=node('div','ap-grid');
    grid.setAttribute('aria-label','Calendario de '+title);
    for(const label of WEEKDAYS)grid.append(node('span','ap-dayname',label));
    for(const date of calendarDays(month.getFullYear(),month.getMonth())){
      if(!date){grid.append(node('span','ap-blank'));continue;}
      const count=workouts.filter(w=>w.scheduled_date===date).length;
      const cell=button(String(Number(date.slice(-2)))+(count?' ·'+count:''),'ap-day'+(date===day?' chosen':''),()=>{day=date;paint();});
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
      list.append(card);
    }
    wrap.append(list);
    if(role==='coach')wrap.append(workoutForm());
    root.append(wrap);
  }

  function move(step) {
    month=new Date(month.getFullYear(),month.getMonth()+step,1);
    day=isoDate(month);
    void load();
  }

  function workoutForm(){
    const form=node('form','ap-box ap-form');
    form.append(node('h3','','Programar entrenamiento'));
    if(!athletes.length){
      form.append(node('p','ap-muted','Todavía no tienes deportistas vinculados activamente.'));
      return form;
    }
    const athlete=node('select','ap-input');
    athlete.name='athlete_id';
    for(const person of athletes){
      const option=node('option','',person.name);
      option.value=person.id;
      athlete.append(option);
    }
    const date=fieldInput('scheduled_date','date');date.value=day;date.required=true;
    const name=fieldInput('title','text','Rodaje de resistencia',160);name.required=true;
    const duration=fieldInput('duration_minutes','number');duration.min='1';duration.max='1440';duration.value='90';duration.required=true;
    const sport=node('select','ap-input');sport.name='sport';
    for(const [value,label] of Object.entries(SPORTS)){
      const option=node('option','',label);option.value=value;sport.append(option);
    }
    const target=fieldInput('intensity_target','text','Zona 2 de potencia',180);
    const notes=node('textarea','ap-input');notes.name='coach_notes';notes.maxLength=3000;notes.rows=3;notes.placeholder='Indicaciones del entrenador…';
    const save=node('button','ap-save','Guardar entrenamiento');save.type='submit';
    const status=node('p','ap-status');status.setAttribute('role','status');
    form.append(labelled('Deportista',athlete),labelled('Fecha',date),labelled('Título',name),labelled('Duración (minutos)',duration),labelled('Deporte',sport),labelled('Objetivo',target),labelled('Indicaciones',notes),save,status);
    form.addEventListener('submit',async event=>{
      event.preventDefault();
      if(busy)return;
      busy=true;save.disabled=true;status.textContent='Guardando…';
      try{
        const payload=validateWorkout({title:name.value,scheduled_date:date.value,duration_minutes:duration.value,sport:sport.value,intensity_target:target.value,coach_notes:notes.value});
        const response=await client.from('planned_workouts')
          .insert({...payload,coach_id:user.id,athlete_id:athlete.value,status:'planned'})
          .select('id').single();
        assertResult(response);
        const [yy,mm]=date.value.split('-').map(Number);
        month=new Date(yy,mm-1,1);day=date.value;
        await load();
        notice='Entrenamiento guardado correctamente.';
        paint();
      }catch(error){
        status.textContent=error?.message||'No se ha podido guardar la sesión.';
      }finally{busy=false;save.disabled=false;}
    });
    return form;
  }

  await load();
}
