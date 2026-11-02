// Offline render of the actual document-center components. No app server, DB,
// environment file or external network requests; all RPC responses are fixtures.
import fs from "node:fs";
import path from "node:path";
import { build } from "esbuild";
import puppeteer from "puppeteer-core";

const root=process.cwd();
const fixture=`
const fixture=window.__documentFixture;
const permission={pdfAllowed:true,pdfBlockedReason:null};
const bundle={id:24,bundleNumber:'DPB-2026-DEMO',status:'archived',delegateId:11,delegateName:'مندوب تجريبي',total:18450,createdAt:'2026-11-02T08:00:00Z',items:[],...permission};
const financial={id:10,fileName:'PB-DEMO-معتمدة.pdf',createdAt:'2026-11-02T08:00:00Z',delegateId:11,delegateName:'مندوب تجريبي',totalEstimatedCost:'18450',fileUrl:'data:application/pdf;base64,JVBERg==',...permission};
function query(path,input,options={}){
  let rows=path==='approvedPricingDocuments.listPage'?[{id:24,bundleNumber:'DPB-2026-DEMO',delegateName:'مندوب تجريبي',approvedAt:'2026-11-02T08:00:00Z',total:18450}]
   :path==='attachments.listByType'?[financial]
   :path==='delegatePricingBundles.listPage'?[bundle]
   :path==='purchaseOrders.list'?[{id:101,poNumber:'PR-2026-DEMO',createdAt:'2026-11-02T08:00:00Z',requestedByName:'مقدم طلب تجريبي',...permission}]
   :path==='warehouseReceipts.list'?[{id:1,receiptNumber:'RCV-2026-DEMO',createdAt:'2026-11-02T08:00:00Z',vendorName:'مورد تجريبي',printCount:1}]:[];
  let data=path==='delegatePricingBundles.status'?{enabled:true}:path==='delegatePricingBundles.detail'?bundle
   :path==='approvedPricingDocuments.listPage'||path==='delegatePricingBundles.listPage'||input?.pagination?{rows,total:rows.length,count:rows.length,page:1,delegates:[{id:11,name:'مندوب تجريبي'}]}:rows;
  return {data:options.enabled===false?undefined:data,isLoading:false,isFetching:false,error:null,refetch:()=>{}};
}
const proxy=(path='')=>new Proxy(()=>{},{get(_,key){
  if(key==='useUtils')return ()=>proxy('utils');
  if(key==='useQuery')return (input,options)=>query(path,input,options);
  if(key==='useMutation')return ()=>({isPending:false,mutateAsync:async()=>({name:'DEMO.pdf',content:'JVBERg=='})});
  return proxy(path?path+'.'+key:String(key));
}});
export const trpc=proxy();
export const useAuth=()=>({user:fixture.user});
`;
const result=await build({stdin:{contents:'import React from "react"; import {createRoot} from "react-dom/client"; import DocumentsCenter from "./client/src/pages/DocumentsCenter"; createRoot(document.getElementById("root")).render(<DocumentsCenter/>);',resolveDir:root,loader:'tsx'},bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',alias:{'@':path.join(root,'client/src'),'@shared':path.join(root,'shared')},define:{'process.env.NODE_ENV':'"production"'},plugins:[{
  name:'offline-auth-and-rpc',setup(plugin){
    plugin.onResolve({filter:/^@\/(lib\/trpc|_core\/hooks\/useAuth)$/},()=>({path:'fixture',namespace:'offline-fixture'}));
    plugin.onLoad({filter:/.*/,namespace:'offline-fixture'},()=>({contents:fixture,loader:'js'}));
  }
}]});
const assets=path.join(root,'dist/public/assets');
const css=fs.readdirSync(assets).filter(name=>/^index-.*\.css$/.test(name)).map(name=>fs.readFileSync(path.join(assets,name),'utf8')).join('\n');
const folder=path.join(root,'tmp/documents-center-organization');fs.mkdirSync(folder,{recursive:true});
const browser=await puppeteer.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--no-sandbox','--disable-gpu']});
try{
  const page=await browser.newPage();await page.setRequestInterception(true);page.on('request',request=>request.abort());
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  async function load(user,width=1366){
    await page.setViewport({width,height:900,deviceScaleFactor:1});
    await page.setContent(`<html lang="ar" dir="rtl"><head><meta charset="utf-8"><style>${css}</style></head><body class="bg-background text-foreground"><main id="root" class="p-5 max-w-7xl mx-auto"></main><script>window.__documentFixture=${JSON.stringify({user})}</script><script>${result.outputFiles[0].text.replaceAll('</script','<\\/script')}</script></body></html>`,{waitUntil:'load'});
    await page.waitForSelector('[role="tab"]');
    if(await page.$eval('#root',element=>{const box=element.getBoundingClientRect();return box.left < -1||box.right > innerWidth+1;}))throw Error('Preview shell is outside the viewport');
  }
  const admin={id:3,username:'ADMIN',role:'admin',isActive:1};
  await load(admin);
  if(await page.$$eval('[role="tab"]',tabs=>tabs.length)!==3)throw Error('Expected exactly three main sections');
  await page.screenshot({path:path.join(folder,'admin-financial.png'),fullPage:false});
  await page.evaluate(()=>Array.from(document.querySelectorAll('[role="tab"]')).find(tab=>tab.textContent==='الشراء والتسعير').click());
  await page.waitForFunction(()=>document.querySelector('#root').textContent.includes('PR-2026-DEMO'));
  await page.click('[aria-label="نوع المستند"]');await page.waitForSelector('[role="option"]');
  await page.evaluate(()=>Array.from(document.querySelectorAll('[role="option"]')).find(option=>option.textContent.includes('وثائق التسعير')).click());
  await page.waitForSelector('[role="option"]',{hidden:true});
  await page.waitForFunction(()=>document.querySelector('#root').textContent.includes('PB-DEMO-معتمدة.pdf'));
  await page.evaluate(()=>Array.from(document.querySelectorAll('button')).find(button=>button.textContent==='تصفية').click());
  await page.waitForSelector('input[type="date"]');
  await page.screenshot({path:path.join(folder,'admin-pricing-filters.png'),fullPage:false});
  await load(admin,390);
  await page.evaluate(()=>Array.from(document.querySelectorAll('[role="tab"]')).find(tab=>tab.textContent==='مستندات المستودع').click());
  await page.waitForFunction(()=>document.querySelector('#root').textContent.includes('RCV-2026-DEMO'));
  if(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1))throw Error('Mobile page overflow');
  await page.screenshot({path:path.join(folder,'admin-warehouse-mobile.png'),fullPage:false});
  await load({id:1,username:'ANIS',role:'user',isActive:1},390);
  if(await page.$$eval('[role="tab"]',tabs=>tabs.length)!==1)throw Error('Named account gained another section');
  if(await page.$eval('#root',element=>element.textContent.includes('PR-2026-DEMO')))throw Error('Named account loaded purchasing');
  await page.screenshot({path:path.join(folder,'named-account-mobile.png'),fullPage:false});
  await page.evaluate(()=>{document.querySelector('[data-slot="table-container"]').scrollLeft=-10000;});
  await page.screenshot({path:path.join(folder,'named-account-mobile-actions.png'),fullPage:false});
  await load({id:7,username:'ACCOUNTANT',role:'accountant',isActive:1});
  if(await page.$$eval('[role="tab"]',tabs=>tabs.length)!==2)throw Error('Accountant section scope changed');
  await page.screenshot({path:path.join(folder,'accountant-financial.png'),fullPage:false});
  if(errors.length)throw Error(errors.join('\n'));
  console.log('Actual component preview passed: desktop navigation, document-type selection, expanded filters, mobile stock view, named-account-only view and accountant scope. No DB/network.');
}finally{await browser.close();}
