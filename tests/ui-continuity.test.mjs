import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {mountApp} from '../app/src/ui.js';
import {fakeClient,IDs} from './fake-client.mjs';
import {readPreference,savePreference,clearPreferences} from '../app/src/view-preferences.js';

const flush=async()=>{for(let i=0;i<7;i++)await new Promise(resolve=>setTimeout(resolve,0));};

test('returning from another tab preserves the same DOM and coach filters',async()=>{
 const dom=new JSDOM('<div id="app"></div>',{url:'https://app.example',pretendToBeVisual:true});
 const {window:win}=dom,root=win.document.querySelector('#app'),client=fakeClient();
 const getUser=client.auth.getUser;let calls=0;
 client.auth.getUser=async()=>{calls++;return getUser();};
 const dispose=mountApp(root,client);await flush();
 root.querySelector('.nav-item[data-view="team"]').click();
 const search=root.querySelector('#athlete-search');search.value='Lucía';
 search.dispatchEvent(new win.Event('input',{bubbles:true}));
 assert.equal(root.querySelectorAll('.athlete-card').length,1);
 const before=calls,selectedNode=root.querySelector('#athlete-search');
 win.document.dispatchEvent(new win.Event('visibilitychange'));await flush();
 assert.equal(calls,before,'tab focus must not trigger another dashboard read');
 assert.equal(root.querySelector('#athlete-search'),selectedNode,'tab focus must not remount the panel');
 assert.equal(root.querySelector('#athlete-search').value,'Lucía');
 dispose();win.close();
});

test('workspace and search survive a new mount, and explicit logout clears preferences',async()=>{
 const dom=new JSDOM('<div id="app"></div>',{url:'https://app.example',pretendToBeVisual:true});
 const {window:win}=dom,root=win.document.querySelector('#app'),client=fakeClient();
 let dispose=mountApp(root,client);await flush();
 root.querySelector('.nav-item[data-view="team"]').click();
 const search=root.querySelector('#athlete-search');search.value='Lucía';
 search.dispatchEvent(new win.Event('input',{bubbles:true}));
 assert.equal(readPreference(win,IDs.coach,'shell').view,'team');
 dispose();
 dispose=mountApp(root,client);await flush();
 assert.equal(root.querySelector('.nav-item[data-view="team"]').getAttribute('aria-current'),'page');
 assert.equal(root.querySelector('#athlete-search').value,'Lucía');
 assert.equal(root.querySelectorAll('.athlete-card').length,1);
 root.querySelector('[data-logout]').click();await flush();
 assert.deepEqual(readPreference(win,IDs.coach,'shell'),{});
 dispose();win.close();
});

test('saved UI choices belong to one account, cannot mix other athletes or roles',()=>{
 const dom=new JSDOM('',{url:'https://app.example'}),win=dom.window;
 savePreference(win,IDs.coach,'shell',{view:'team',query:'Lucía'});
 assert.equal(readPreference(win,IDs.coach,'shell').view,'team');
 assert.deepEqual(readPreference(win,IDs.a,'shell'),{});
 savePreference(win,IDs.a,'calendar-athlete',{month:'2026-11',day:'2026-11-15'});
 clearPreferences(win,IDs.coach);
 assert.deepEqual(readPreference(win,IDs.coach,'shell'),{});
 assert.equal(readPreference(win,IDs.a,'calendar-athlete').month,'2026-11');
 win.close();
});
