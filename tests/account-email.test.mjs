import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {requestAccountEmail,mountAccountEmail} from '../app/src/account-email.js';
const user={id:'fixture-coach',email:'old@example.test'};
test('email changes use the own-session Auth API only, with no role, password or ID writes',async()=>{
 let sent;
 const client={auth:{getUser:async()=>({data:{user}}),updateUser:async payload=>{sent=payload;return{data:{user:{...user,new_email:payload.email}}};}}};
 assert.match(await requestAccountEmail(client,user,' NEW@example.test ','new@example.test'),/Solicitud enviada/);assert.deepEqual(sent,{email:'new@example.test'});
 for(const [email,confirm] of [['invalid','invalid'],['new@example.test','other@example.test'],[user.email,user.email]])await assert.rejects(requestAccountEmail(client,user,email,confirm));
});
test('changed sessions and provider failures cannot report successful changes',async()=>{
 let calls=0;const client={auth:{getUser:async()=>({data:{user:{...user,id:'different'}}}),updateUser:async()=>{calls++;}}};
 await assert.rejects(requestAccountEmail(client,user,'new@example.test','new@example.test'),/sesión ha cambiado/);assert.equal(calls,0);
 client.auth.getUser=async()=>({data:{user}});client.auth.updateUser=async()=>({error:{status:429}});await assert.rejects(requestAccountEmail(client,user,'new@example.test','new@example.test'),/Demasiados intentos/);
 client.auth.updateUser=async()=>({error:{code:'email_address_not_authorized'}});await assert.rejects(requestAccountEmail(client,user,'new@example.test','new@example.test'),/SMTP/);
});
test('profile email form displays the current account and reports pending confirmation rather than completion',async()=>{
 const dom=new JSDOM('<section id="email"></section>'),root=dom.window.document.querySelector('#email');let notify='';
 const client={auth:{getUser:async()=>({data:{user}}),updateUser:async()=>({data:{user}})}};
 mountAccountEmail({root,client,user,onRequested:message=>notify=message});assert.match(root.textContent,/old@example.test/);
 root.querySelector('[name=new_email]').value='new@example.test';root.querySelector('[name=confirm_email]').value='new@example.test';root.querySelector('form').dispatchEvent(new dom.window.Event('submit',{cancelable:true}));
 for(let i=0;i<4;i++)await new Promise(r=>setTimeout(r,0));assert.match(notify,/confirmaciones/);assert.match(root.textContent,/Solicitud enviada/);
});
