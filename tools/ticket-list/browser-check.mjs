import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { build } from "esbuild";
import puppeteer from "puppeteer-core";
const root=process.cwd();
const file=name=>JSON.stringify(path.join(root,name).replaceAll("\\","/"));
const fixtures=[
"import React from 'react';",
"import ar from "+file("client/src/i18n/ar.ts")+";",
"import en from "+file("client/src/i18n/en.ts")+";",
"import ur from "+file("client/src/i18n/ur.ts")+";",
"const language=new URLSearchParams(location.search).get('lang')||'ar',role=new URLSearchParams(location.search).get('role')||'admin';",
"const G='maintenance_report_department_general',C='maintenance_report_department_construction';",
"const rows=Array.from({length:28},(_,i)=>({assignmentId:i===0?301:i+1,ticketId:100+i,ticketNumber:i===0?'MT-MOCK-301':'MT-MOCK-'+(i+1),title:i===0?'فحص الرموز !%_ خاص':'فحص الإضاءة '+(i+1),description:'تفاصيل المهمة',teamId:i%2+1,teamName:i%2?'فريق السباكة':'فريق الكهرباء',warehouseName:'مخزن الفريق',stage:'action_required',sourceStatus:'under_inspection',siteId:i%2+1,siteName:i%2?'الموقع الثاني':'الملقا',sectionId:i%2+1,sectionName:i%2?'المطعم الثاني':'فودوزو',responsibleDepartment:i>=25?C:G,executionInProgress:false,reportMedia:[]}));",
"const options={teams:[{id:1,name:'فريق الكهرباء'},{id:2,name:'فريق السباكة'}],sites:[{id:1,name:'الملقا'},{id:2,name:'الموقع الثاني'}],sections:[{id:1,name:'فودوزو',siteId:1},{id:2,name:'المطعم الثاني',siteId:2}]};",
"const itRows=[{id:901,ticketNumber:'IT-MOCK-901',title:'فحص كاميرا !%_',description:'مهمة IT بلا طلب مواد',status:'in_progress',state:'in_progress',assignedToId:31,assignedToName:'منفذ التقنية الأول',siteId:1,sectionId:1,siteName:'الملقا',sectionName:'فودوزو',parentTicketNumber:'MT-PARENT-901',assignedAt:'2026-11-24'},{id:902,ticketNumber:'IT-MOCK-902',title:'فحص الشبكة',description:'مهمة IT',status:'in_progress',state:'blocked',assignedToId:32,assignedToName:'منفذ التقنية الثاني',siteId:2,sectionId:2,siteName:'الموقع الثاني',sectionName:'المطعم الثاني',parentTicketNumber:'MT-PARENT-902',assignedAt:'2026-11-24'}];",
"window.__reads=[];window.__writes=[];",
"function data(route,input={}){if(route==='ticketTeamAssignments.list'){if(input.department==='maintenance_report_department_it'){let found=itRows;if(input.search)found=found.filter(r=>(r.title+' '+r.ticketNumber+' '+r.assignedToName+' '+r.parentTicketNumber).includes(input.search));if(input.executorId)found=found.filter(r=>r.assignedToId===input.executorId);if(input.status!=='open'&&input.status!=='all')found=found.filter(r=>r.state===input.status);for(const k of ['siteId','sectionId'])if(input[k])found=found.filter(r=>r[k]===input[k]);return{items:[],itTickets:found,total:found.length,page:1,pageSize:20,options:{...options,teams:[],executors:[{id:31,name:'منفذ التقنية الأول'},{id:32,name:'منفذ التقنية الثاني'}]},departmentCounts:{general:25,construction:3,it:2}};}let found=rows.filter(r=>r.responsibleDepartment===input.department);if(input.search)found=found.filter(r=>(r.title+' '+r.ticketNumber+' '+r.siteName+' '+r.teamName).includes(input.search));for(const k of ['teamId','siteId','sectionId'])if(input[k])found=found.filter(r=>r[k]===input[k]);if(input.sort==='newest')found=found.slice().reverse();const page=Math.min(input.page||1,Math.max(1,Math.ceil(found.length/20)));return{items:found.slice((page-1)*20,page*20),total:found.length,page,pageSize:20,options,departmentCounts:{general:25,construction:3}};}if(route==='ticketTeamAssignments.queue')return input.assignmentId?rows.filter(r=>r.assignmentId===input.assignmentId):rows;return[];}",
"const proxy=(p=[])=>new Proxy(()=>{},{get(_,k){if(k==='useUtils')return()=>proxy();if(k==='useQuery')return(input,o={})=>{if(o.enabled!==false)window.__reads.push({route:p.join('.'),input});return{data:o.enabled===false?undefined:data(p.join('.'),input),error:null,isLoading:false,isFetching:false,isPlaceholderData:false,refetch:async()=>({})};};if(k==='invalidate')return async()=>{};if(k==='useMutation')return()=>({isPending:false,mutate:x=>window.__writes.push(x)});return proxy([...p,k]);}});",
"export const trpc=proxy();export const useAuth=()=>({user:{id:3,role,isActive:1},loading:false});",
"export const useTranslation=()=>({language,dir:language==='en'?'ltr':'rtl',t:({ar,en,ur})[language]});export const useLanguage=useTranslation;",
"export const ExecutionPanel=()=>React.createElement('p',null,'EXECUTION-FIXTURE');"
].join("\n");
const entry="import React from 'react';import{createRoot}from'react-dom/client';import Assigned from './client/src/pages/maintenance-teams/AssignedMaintenanceTickets';createRoot(document.getElementById('root')).render(<Assigned/>);";
const result=await build({stdin:{contents:entry,resolveDir:root,loader:"tsx"},bundle:true,write:false,platform:"browser",format:"iife",jsx:"automatic",alias:{"@":path.join(root,"client/src"),"@shared":path.join(root,"shared")},define:{"process.env.NODE_ENV":'"production"'},plugins:[{name:"offline",setup(p){p.onResolve({filter:/^(?:@\/(?:lib\/trpc|_core\/hooks\/useAuth|contexts\/LanguageContext)|\.\/ExecutionPanel)$/},()=>({path:"fixture",namespace:"offline"}));p.onLoad({filter:/.*/,namespace:"offline"},()=>({contents:fixtures,loader:"tsx",resolveDir:root}));}}]});
const css=fs.readdirSync("dist/public/assets").filter(n=>/^index-.*\.css$/.test(n)).map(n=>fs.readFileSync("dist/public/assets/"+n,"utf8")).join("\n");
const html='<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'*{animation:none!important;transition:none!important}</style><div id="root"></div><script>'+result.outputFiles[0].text.replaceAll("</script","<\\/script")+"</script>";
const browser=await puppeteer.launch({headless:true,executablePath:"C:/Program Files/Google/Chrome/Application/chrome.exe",args:["--no-sandbox","--disable-background-networking","--disable-sync","--no-first-run"]});
fs.mkdirSync("tmp/ticket-list",{recursive:true});
try{
 const page=await browser.newPage();page.setDefaultTimeout(6000);const errors=[];page.on("pageerror",e=>errors.push(e.message));
 await page.setRequestInterception(true);page.on("request",r=>r.isNavigationRequest()&&r.url().startsWith("http://fixture.local/")?r.respond({status:200,contentType:"text/html",body:html}):r.abort());
 const goto=async(q="",width=1280)=>{await page.setViewport({width,height:900});await page.goto("http://fixture.local/maintenance-team-tickets"+q);await page.waitForSelector("#ticket-list-search");};
 for(const [lang,width]of[["ar",1280],["ar",390],["en",1280],["ur",390]]){
  await goto("?lang="+lang,width);
  assert.equal(await page.$$eval('[role="tab"]',xs=>xs.length),3);
  assert.equal(await page.$eval("#ticket-list-status",e=>e.value),"open");
  assert.equal(await page.$eval("#ticket-list-sort",e=>e.value),"oldest");
  assert.equal(await page.$eval('[role="search"]',e=>getComputedStyle(e).direction),lang==="en"?"ltr":"rtl");
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));
  await page.screenshot({path:"tmp/ticket-list/"+lang+"-"+width+".png",fullPage:false});
 }
 await goto();await page.type("#ticket-list-search","!%_");
 await page.waitForFunction(()=>new URLSearchParams(location.search).get("search")==="!%_");
 await page.waitForFunction(()=>document.body.textContent.includes("عدد النتائج: 1"));
 await page.evaluate(()=>[...document.querySelectorAll("button")].find(b=>b.textContent.includes("MT-MOCK-301")).click());
 await page.waitForFunction(()=>new URLSearchParams(location.search).get("teamExecution")==="301");
 await page.waitForFunction(()=>document.body.textContent.includes("EXECUTION-FIXTURE"));
 assert.ok(await page.evaluate(()=>window.__reads.some(r=>r.route==="ticketTeamAssignments.queue"&&r.input.assignmentId===301)));
 await page.evaluate(()=>[...document.querySelectorAll("button")].find(b=>b.textContent==="العودة إلى مهام الفريق").click());
 await page.waitForSelector("#ticket-list-search");assert.equal(await page.$eval("#ticket-list-search",e=>e.value),"!%_");
 await goto("?department=maintenance_report_department_construction");
 assert.ok((await page.$eval('[role="tab"][data-state="active"]',e=>e.textContent)).includes("الإنشاءات"));
 await page.select("#ticket-list-team","1");await page.waitForFunction(()=>new URLSearchParams(location.search).get("teamId")==="1");
 await page.select("#ticket-list-site","2");await page.waitForFunction(()=>new URLSearchParams(location.search).get("siteId")==="2");
 assert.deepEqual(await page.$$eval("#ticket-list-section option",xs=>xs.map(x=>x.value)),["all","2"]);
 await page.select("#ticket-list-section","2");await page.waitForFunction(()=>new URLSearchParams(location.search).get("sectionId")==="2");
 await page.select("#ticket-list-site","1");await page.waitForFunction(()=>!new URLSearchParams(location.search).has("sectionId"));
 await page.select("#ticket-list-sort","newest");await page.waitForFunction(()=>new URLSearchParams(location.search).get("sort")==="newest");
 await goto();await page.evaluate(()=>[...document.querySelectorAll("button")].find(b=>b.textContent==="التالي").click());
 await page.waitForFunction(()=>new URLSearchParams(location.search).get("page")==="2");
 await page.select("#ticket-list-status","all");await page.waitForFunction(()=>new URLSearchParams(location.search).get("page")==="1");
 for(const [lang,width]of[["ar",1280],["ar",390],["en",1280],["ur",390]]){
  await goto("?role=it_manager&lang="+lang,width);await page.waitForSelector("#ticket-list-executor");
  assert.equal(await page.$("#ticket-list-team"),null);
  assert.ok(await page.evaluate(()=>window.__reads.filter(r=>r.route==="ticketTeamAssignments.list").every(r=>r.input.department==="maintenance_report_department_it")));
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));
  await page.screenshot({path:"tmp/ticket-list/it-"+lang+"-"+width+".png",fullPage:false});
 }
 await goto("?role=it_manager");await page.waitForSelector("#ticket-list-executor");
 await page.type("#ticket-list-search","!%_");await page.waitForFunction(()=>new URLSearchParams(location.search).get("search")==="!%_");
 await page.select("#ticket-list-executor","31");await page.waitForFunction(()=>new URLSearchParams(location.search).get("executorId")==="31");
 await page.evaluate(()=>[...document.querySelectorAll("button")].find(b=>b.textContent.includes("IT-MOCK-901")).click());
 await page.waitForFunction(()=>location.pathname==="/tickets/901");
 assert.ok(!new URL(await page.url()).searchParams.has("teamExecution"));
 await page.goBack();await page.waitForSelector("#ticket-list-executor");
 assert.equal(await page.$eval("#ticket-list-executor",e=>e.value),"31");assert.equal(await page.$eval("#ticket-list-search",e=>e.value),"!%_");
 await goto("?role=warehouse&department=maintenance_report_department_it");
 assert.equal(await page.$$eval('[role="tab"]',xs=>xs.length),2);assert.equal(await page.$("#ticket-list-executor"),null);
 assert.deepEqual(await page.evaluate(()=>window.__writes),[]);assert.deepEqual(errors,[]);
 console.log("PASS offline browser: desktop/mobile RTL+LTR; IT tab with named executor and existing detail URL; original two warehouse tabs; literal debounced search; selected old ticket and back; combined filters; section reset; ordering; pagination; no writes.");
}finally{await browser.close();}
