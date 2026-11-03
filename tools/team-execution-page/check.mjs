// Real pages/components and in-memory RPC fixtures; every network request is intercepted.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { build } from "esbuild";
import puppeteer from "puppeteer-core";
const root = process.cwd();
const fixtures = `
import React from 'react';
if(!crypto.randomUUID)crypto.randomUUID=()=> '00000000-0000-4000-8000-000000000001';
import ar from '${path.join(root, 'client/src/i18n/ar.ts').replaceAll('\\','/')}';
const role=new URLSearchParams(location.search).get('role')||'technician';
const user={id:3,role,isActive:new URLSearchParams(location.search).has('inactive')?0:1};
let version=0;const listeners=new Set();const emit=()=>{version++;listeners.forEach(fn=>fn());};
const rows=Array.from({length:24},(_,n)=>({assignmentId:n+1,ticketId:100+n,ticketNumber:'MOCK-MT-'+(n+1),title:'مهمة الفريق '+(n+1),description:'تفاصيل المهمة '+(n+1),teamId:21,teamName:'فريق تجريبي',warehouseName:'مخزن الفريق',stage:'action_required',sourceStatus:'under_inspection',siteName:'موقع تجريبي',sectionName:'قسم تجريبي',executionInProgress:false,hasOpenVisit:false}));
const snapshots=new Map(rows.map(row=>[row.assignmentId,{users:[{id:3,name:'فني تجريبي',role,active:true}],warehouses:[{id:20,name:'مخزن الفريق',active:true}],catalog:[],locations:[],tickets:[],teams:[],memberships:[],assignments:[{id:row.assignmentId,ticketId:row.ticketId,ticketItemId:200+row.assignmentId,ticketNumber:row.ticketNumber,title:row.title,teamId:21,warehouseId:20,responsibleManagerId:9,location:{siteId:1,sectionId:2},stage:'action_required',revision:1,materialRound:1,assignedById:9}],actions:[],needs:[],deliveries:[],supplies:[],returns:[],operations:[],nextId:1000}]));
const empty=[];window.__calls=[];window.__reads=[];
function data(path,input){if(path==='ticketTeamAssignments.queue')return rows;if(path==='tickets.list')return empty;if(path==='ticketTeamExecution.details')return snapshots.get(input.assignmentId);if(path==='ticketTeamExecution.balances'||path==='ticketTeamExecution.catalog'||path==='ticketTeamExecution.units')return empty;return null;}
function query(path,input,options){React.useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn);},()=>version);const value=options?.enabled===false?undefined:data(path,input);if(options?.enabled!==false)window.__reads.push({path,input});return{data:value,isLoading:false,isFetching:false,error:null,refetch:async()=>{emit();return{data:data(path,input)};}};}
async function mutate(path,input){window.__calls.push({path,input});const s=snapshots.get(input.assignmentId),a=s?.assignments[0],r=rows.find(r=>r.assignmentId===input.assignmentId);if(!a)throw Error('Unknown fixture assignment');a.revision++;
 const kind=path.split('.').at(-1);const event={id:100+a.revision,assignmentId:a.id,actorId:3,revision:a.revision,operationKey:'fixture',at:new Date().toISOString()};
 if(kind==='startItem'||kind==='resumeItem'){s.actions.push({...event,kind:kind==='startItem'?'execution_started':'execution_resumed',note:JSON.stringify({version:1,visitKey:'visit-'+a.id})});r.executionInProgress=true;r.hasOpenVisit=true;}
 if(kind==='outcome'){s.actions.push({...event,kind:input.outcome,note:input.note});a.stage='awaiting_review';r.stage=a.stage;r.executionInProgress=false;}
 if(kind==='endVisit'){s.actions.push({...event,kind:'visit_ended',note:JSON.stringify({version:1,visitKey:'visit-'+a.id})});r.hasOpenVisit=false;}
 emit();return{};}
const proxy=(path='')=>new Proxy(()=>{},{get(_,key){if(key==='useUtils')return()=>utils;if(key==='useQuery')return(input,options)=>query(path,input,options);if(key==='invalidate')return async()=>{emit();};if(key==='mutate')return input=>mutate(path.replace('client.',''),input);return proxy(path?path+'.'+key:String(key));}});const utils=proxy();
export const trpc=proxy();export const useAuth=()=>({user,authenticatedUser:user,loading:false});export const useTranslation=()=>({language:'ar',dir:'rtl',t:ar});export const useLanguage=()=>({language:'ar',setLanguage:()=>{}});export const MaterialCostPanel=()=>null;export const ExternalRouteReviewPanel=()=>null;
`;
const entry = `import React from 'react';import{createRoot}from'react-dom/client';import MyTasksPage from './client/src/pages/pmv2/MyTasksPage';import Assigned from './client/src/pages/maintenance-teams/AssignedMaintenanceTickets';createRoot(document.getElementById('root')).render(location.pathname==='/maintenance-team-tickets'?<Assigned/>:<MyTasksPage/>);`;
const bundle = await build({stdin:{contents:entry,resolveDir:root,loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',alias:{'@':path.join(root,'client/src'),'@shared':path.join(root,'shared')},define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'offline-fixtures',setup(p){p.onResolve({filter:/^(?:@\/(?:lib\/trpc|_core\/hooks\/useAuth|contexts\/LanguageContext|components\/inventory\/MaterialCostPanel)|\.\.\/tickets\/ExternalRouteReviewPanel)$/},()=>({path:'fixtures',namespace:'offline'}));p.onLoad({filter:/.*/,namespace:'offline'},()=>({contents:fixtures,loader:'tsx',resolveDir:root}));}}]});
const css=fs.readdirSync('dist/public/assets').filter(name=>/^index-.*\.css$/.test(name)).map(name=>fs.readFileSync('dist/public/assets/'+name,'utf8')).join('\n');
const html=`<!doctype html><html dir="rtl"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}*{animation:none!important;transition:none!important}</style><div id="root"></div><script>${bundle.outputFiles[0].text.replaceAll('</script','<\\/script')}</script></html>`;
const browser=await puppeteer.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--no-sandbox','--disable-background-networking','--disable-sync','--no-first-run']});
fs.mkdirSync('tmp/team-execution-page',{recursive:true});
try{
 const page=await browser.newPage();page.setDefaultTimeout(7000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setRequestInterception(true);page.on('request',r=>r.isNavigationRequest()&&r.url().startsWith('http://fixture.local/')?r.respond({status:200,contentType:'text/html',body:html}):r.abort());
 const click=async text=>page.evaluate(text=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===text&&!b.disabled);if(!b)throw Error('Missing button: '+text);b.click();},text);
 const back=()=>click('العودة إلى مهام الفريق');
 const task=async n=>page.evaluate(n=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.includes('MOCK-MT-'+n)&&b.textContent.includes('مهمة الفريق '+n));if(!b)throw Error('Task missing '+n);b.click();},n);
 for(const width of [390,1280]){
  await page.setViewport({width,height:900});await page.goto('http://fixture.local/scheduled-maintenance/my-tasks?source=tickets&fixture='+width);await page.waitForSelector('button');
  await page.evaluate(()=>window.scrollTo(0,600));const y=await page.evaluate(()=>window.scrollY);
  await task(1);await page.waitForFunction(()=>new URLSearchParams(location.search).get('teamExecution')==='1');await page.waitForSelector('#ticket-selected-task');
  assert.equal(await page.$('[role="dialog"]'),null);assert.ok(!(await page.$eval('body',e=>e.textContent)).includes('MOCK-MT-2'));
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await page.screenshot({path:'tmp/team-execution-page/execution-'+width+'.png',fullPage:false});
  assert.equal(await page.evaluate(()=>window.__calls.length),0);
  await click('بدء التنفيذ');await page.waitForFunction(()=>!document.querySelector('textarea')?.disabled);
  await page.type('textarea','ملاحظات لم تحفظ');
  let prompt='';page.once('dialog',async d=>{prompt=d.message();await d.dismiss();});await back();await page.waitForFunction(()=>document.querySelector('textarea')?.value==='ملاحظات لم تحفظ');assert.ok(prompt.includes('غير محفوظة'));
  await click('تم الإصلاح');await page.waitForFunction(()=>document.body.textContent.includes('انتهى إجراء الفريق'));await back();await page.waitForFunction(()=>!new URLSearchParams(location.search).has('teamExecution'));
  await page.waitForFunction(y=>Math.abs(scrollY-y)<3,{},y);
  await task(2);await page.waitForSelector('#ticket-selected-task');await click('بدء التنفيذ');await page.waitForFunction(()=>!document.querySelector('textarea')?.disabled);await page.type('textarea','مسودة المهمة الثانية');
  page.once('dialog',d=>d.accept());await back();await page.waitForFunction(()=>!new URLSearchParams(location.search).has('teamExecution'));
  await task(1);await page.waitForSelector('#ticket-selected-task');assert.ok((await page.$eval('body',e=>e.textContent)).includes('ملاحظات لم تحفظ'));assert.ok(!(await page.$eval('body',e=>e.textContent)).includes('مسودة المهمة الثانية'));
  await back();await page.waitForFunction(()=>!new URLSearchParams(location.search).has('teamExecution'));
  await task(2);await page.waitForSelector('textarea');assert.equal(await page.$eval('textarea',e=>e.value),'');assert.ok((await page.$eval('body',e=>e.textContent)).includes('قيد التنفيذ'));
  assert.equal(await page.evaluate(()=>window.__calls.filter(c=>c.path.endsWith('outcome')).length),1);
  await back();await page.waitForFunction(()=>!new URLSearchParams(location.search).has('teamExecution'));await task(1);await page.waitForSelector('#ticket-selected-task');await click('إنهاء الزيارة');await page.waitForFunction(()=>![...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='إنهاء الزيارة'));await back();await page.waitForFunction(()=>!new URLSearchParams(location.search).has('teamExecution'));
  await click('تم تنفيذها1');await page.waitForFunction(()=>document.querySelector('[aria-pressed="true"]')?.textContent.includes('تم تنفيذها'));await task(1);await page.waitForSelector('#ticket-selected-task');await back();await page.waitForFunction(()=>document.querySelector('[aria-pressed="true"]')?.textContent.includes('تم تنفيذها'));
  console.log('PASS '+width+': isolated execution page; saved A, independent B; cancel/discard draft; back restores scroll and tab; reopening resumes saved stage');
 }
 // Foreign assignment and inactive account must not mount the execution reader.
 for(const suffix of ['teamExecution=999','teamExecution=1&inactive=1']){
  await page.goto('http://fixture.local/scheduled-maintenance/my-tasks?source=tickets&'+suffix);await page.waitForSelector('[role="alert"]');
  assert.equal(await page.evaluate(()=>window.__reads.filter(r=>r.path==='ticketTeamExecution.details').length),0);
 }
 await page.goto('http://fixture.local/maintenance-team-tickets?role=it_member');await page.waitForSelector('button');await task(1);await page.waitForFunction(()=>new URLSearchParams(location.search).has('teamExecution'));await page.waitForSelector('textarea');assert.ok(!(await page.$eval('body',e=>e.textContent)).includes('MOCK-MT-2'));await back();await page.waitForFunction(()=>!new URLSearchParams(location.search).has('teamExecution'));
 assert.deepEqual(errors,[]);console.log('PASS IT card opens only chosen execution; unavailable/inactive assignment denial; no browser errors, API or DB connections');
}catch(error){const pages=await browser.pages();const page=pages.at(-1);console.error(await page.evaluate(()=>({url:location.href,body:document.body.innerText.slice(-5000),calls:window.__calls,reads:window.__reads?.slice(-5)})));throw error;}finally{await browser.close();}
