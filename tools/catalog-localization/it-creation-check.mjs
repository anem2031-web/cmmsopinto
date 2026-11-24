import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';

// Actual ItemsManager and controls, with in-memory auth/RPC/upload only. No server or database.
const root = process.cwd();
const file = name => JSON.stringify(path.join(root, name).replaceAll('\\', '/'));
const fixture = `
import ar from ${file('client/src/i18n/ar.ts')};
import en from ${file('client/src/i18n/en.ts')};
import ur from ${file('client/src/i18n/ur.ts')};
import { getCatalogError } from ${file('client/src/i18n/catalogUi.ts')};
import { IT_CATALOG_CREATION_DENIED } from ${file('shared/catalog-item-create-scope.ts')};
window.__denial={raw:IT_CATALOG_CREATION_DENIED,ar:getCatalogError(IT_CATALOG_CREATION_DENIED,'ar','Fallback'),en:getCatalogError(IT_CATALOG_CREATION_DENIED,'en','Fallback')};
const cfg=window.__itCase;
const language=cfg.language||'en';
const t=({ar,en,ur})[language];
const user={id:9,role:cfg.role,isActive:1};
const baseNodes=[
 {id:100,parentId:null,code:'10',nameAr:'IT Root',nameEn:'IT Root',level:1,isActive:1},
 {id:101,parentId:100,code:'10-01',nameAr:'IT Devices',nameEn:'IT Devices',level:2,isActive:1},
 {id:200,parentId:null,code:'20',nameAr:'Other Root',nameEn:'Other Root',level:1,isActive:1},
 {id:201,parentId:200,code:'20-01',nameAr:'Other Tools',nameEn:'Other Tools',level:2,isActive:1},
];
const nodes=cfg.missing?baseNodes.filter(n=>n.id!==100):cfg.ambiguous?[...baseNodes,{id:300,parentId:null,code:'10',nameAr:'Ambiguous IT',nameEn:'Ambiguous IT',level:1,isActive:1}]:baseNodes;
const units=[{id:1,nameAr:'Piece',nameEn:'Piece',isActive:1}];
const items=[{id:11,nodeId:101,code:'10-01-001',nameAr:'IT Screen',nameEn:'IT Screen',unit:'Piece',manufacturer:'IT Maker',isActive:1,primaryImageUrl:'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='},{id:22,nodeId:201,code:'20-01-001',nameAr:'Foreign Hammer',nameEn:'Foreign Hammer',unit:'Piece',manufacturer:'Other Maker',isActive:1,primaryImageUrl:'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='}];
window.__reads=[];window.__writes=[];window.__captions={add:t.catalog.items.addNew,duplicate:t.catalog.items.addFrom,save:t.common.save};
function data(route,input){
 if(route==='catalog.nodes.list')return nodes;
 if(route==='catalog.items.list')return items;
 if(route==='catalog.units.list')return units;
 if(route==='catalog.items.previewNextCode'){const node=nodes.find(n=>n.id===input.nodeId);return {code:(node?.code||'00')+'-002',nodeCode:node?.code};}
 return [];
}
const rpc=(parts=[])=>new Proxy(()=>{},{get(_,key){
 if(key==='useUtils')return()=>rpc();if(key==='invalidate')return async()=>{};
 if(key==='useQuery')return(input,options={})=>{const route=parts.join('.');if(options.enabled!==false)window.__reads.push({route,input});return {data:options.enabled===false?undefined:data(route,input),isLoading:false,isFetching:false,error:null,refetch:async()=>({})};};
 if(key==='useMutation')return(options={})=>{const run=async input=>{window.__writes.push({route:parts.join('.'),input});await options.onSuccess?.({});return {};};return {isPending:false,mutate:run,mutateAsync:run};};
 return rpc([...parts,String(key)]);
}});
window.XMLHttpRequest=class {upload={};status=200;responseText=JSON.stringify({url:'data:image/png;base64,AA==',fileKey:'fixture/image.png'});open(){}send(){queueMicrotask(()=>this.onload?.());}};
export const trpc=rpc();
export const useAuth=()=>({user,authenticatedUser:user,loading:false});
export const useTranslation=()=>({language,t,dir:language==='en'?'ltr':'rtl',isRTL:language!=='en'});
`;
const output = await build({
  stdin: { contents: "import React from 'react';import{createRoot}from'react-dom/client';import{Toaster}from'sonner';import ItemsManager from './client/src/components/catalog/ItemsManager';createRoot(document.getElementById('root')).render(<><ItemsManager/><Toaster/></>);", resolveDir:root,loader:'tsx' },
  bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',alias:{'@':path.join(root,'client/src'),'@shared':path.join(root,'shared')},define:{'process.env.NODE_ENV':'"production"'},
  plugins:[{name:'offline-it-scope',setup(p){p.onResolve({filter:/^@\/(?:lib\/trpc|_core\/hooks\/useAuth|contexts\/LanguageContext)$/},()=>({path:'fixture',namespace:'offline-it-scope'}));p.onLoad({filter:/.*/,namespace:'offline-it-scope'},()=>({contents:fixture,loader:'tsx',resolveDir:root}));}}],
});
const browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--no-sandbox','--disable-gpu']});
const errors=[];
let passed=0;
async function pageFor(config){
 const page=await browser.newPage();
 page.on('pageerror',e=>errors.push(String(e)));
 await page.setRequestInterception(true);
 page.on('request',r=>r.url().startsWith('data:')||r.url()==='about:blank'?r.continue():r.abort());
 await page.setContent('<html><body><div id="root"></div></body></html>');
 await page.evaluate(cfg=>{window.__itCase=cfg;document.documentElement.dir=cfg.language==='ar'?'rtl':'ltr';},config);
 await page.addScriptTag({content:output.outputFiles[0].text});
 await page.waitForFunction(()=>document.body.innerText.includes('Foreign Hammer'));
 return page;
}
async function clickText(page,text,scope='body'){
 const found=await page.evaluate(({text,scope})=>{const button=[...document.querySelector(scope).querySelectorAll('button')].find(el=>el.textContent.trim()===text);if(!button)return false;button.click();return true;},{text,scope});
 assert(found,'Button not found: '+text);
}
async function openCreate(page){const label=await page.evaluate(()=>window.__captions.add);await clickText(page,label);await page.waitForSelector('[role="dialog"]');}
async function clickCategory(page){
 const found=await page.evaluate(()=>{const button=[...document.querySelector('[role=dialog]').querySelectorAll('button')].find(el=>el.querySelector('svg.lucide-folder-open'));if(!button)return false;button.click();return true;});assert(found,'Category picker button missing');
}
async function pickerText(page){return page.$eval('[role=dialog]',el=>el.innerText);}
async function chooseItLeaf(page){
 await clickCategory(page);
 await page.evaluate(()=>{const label=[...document.querySelector('[role=dialog]').querySelectorAll('span')].find(el=>el.textContent.trim()==='IT Root');label.parentElement.querySelector('button').click();});
 await page.waitForFunction(()=>[...document.querySelector('[role=dialog]').querySelectorAll('span')].some(el=>el.textContent.trim()==='IT Devices'));
 await page.evaluate(()=>[...document.querySelector('[role=dialog]').querySelectorAll('span')].find(el=>el.textContent.trim()==='IT Devices').click());
}
async function addImage(page){await page.$eval('[role=dialog] input[type=file]',input=>{const transfer=new DataTransfer();transfer.items.add(new File([new Uint8Array([137,80,78,71])],'fixture.png',{type:'image/png'}));input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));});}
async function itemAction(page,itemName,action){const found=await page.evaluate(({itemName,action})=>{const card=[...document.querySelectorAll('[data-slot=card]')].find(el=>el.querySelector('p.font-semibold')?.textContent.trim()===itemName);const button=[...card.querySelectorAll('button')].find(el=>el.textContent.trim()===action);if(!button)return false;button.click();return true;},{itemName,action});assert(found,'Item action missing: '+action);await page.waitForSelector('[role=dialog]');}
async function formValues(page){return page.$eval('[role=dialog]',el=>({nameAr:el.querySelector('input[dir=rtl]').value,nameEn:el.querySelector('input[placeholder="Example: Water Pump"][dir=ltr]').value,unit:el.querySelector('select').value,manufacturer:el.querySelector('input[placeholder="Example: LG"]').value}));}
async function test(name,fn){await fn();passed++;console.log('PASS '+name);}
try{
 await test('IT fresh create lists only root 10 and its descendants; item list stays global',async()=>{
  const page=await pageFor({role:'it_manager'});
  const denial=await page.evaluate(()=>window.__denial);
  assert.equal(denial.en,'IT managers can create new items only under Information Technology (10) and its subcategories.');assert.equal(denial.ar,denial.raw);
  await openCreate(page);await clickCategory(page);
  const text=await pickerText(page);assert(text.includes('IT Root'));assert(!text.includes('Other Root'));assert(!text.includes('Other Tools'));
  assert.equal(await page.evaluate(()=>window.__reads.find(r=>r.route==='catalog.items.list').input.nodeIds),undefined);
  assert(await page.evaluate(()=>document.body.innerText.includes('Foreign Hammer')));
  await page.close();
 });
 await test('IT foreign duplicate clears only category and creates under the selected IT leaf',async()=>{
  const page=await pageFor({role:'it_manager'}),duplicate=await page.evaluate(()=>window.__captions.duplicate);
  await itemAction(page,'Foreign Hammer',duplicate);
  assert.deepEqual(await formValues(page),{nameAr:'Foreign Hammer',nameEn:'Foreign Hammer',unit:'Piece',manufacturer:'Other Maker'});
  assert(!(await pickerText(page)).includes('Other Tools'));
  assert(!await page.evaluate(()=>window.__reads.some(r=>r.route==='catalog.items.previewNextCode'&&r.input.nodeId===201)));
  await chooseItLeaf(page);await addImage(page);await clickText(page,await page.evaluate(()=>window.__captions.save),'[role=dialog]');
  await page.waitForFunction(()=>window.__writes.some(w=>w.route==='catalog.items.create'));
  const write=await page.evaluate(()=>window.__writes.find(w=>w.route==='catalog.items.create').input);
  assert.equal(write.nodeId,101);assert.equal(write.nameAr,'Foreign Hammer');assert.equal(write.unit,'Piece');assert.equal(write.manufacturer,'Other Maker');assert(!('id' in write));
  await page.close();
 });
 await test('IT own duplicate retains the permitted category',async()=>{
  const page=await pageFor({role:'it_manager'});await itemAction(page,'IT Screen',await page.evaluate(()=>window.__captions.duplicate));
  assert((await pickerText(page)).includes('IT Devices'));assert(await page.evaluate(()=>window.__reads.some(r=>r.route==='catalog.items.previewNextCode'&&r.input.nodeId===101)));
  await page.close();
 });
 await test('IT can edit a foreign item with all categories and save its original ID/category',async()=>{
  const page=await pageFor({role:'it_manager'});await itemAction(page,'Foreign Hammer','Edit');await clickCategory(page);
  const text=await pickerText(page);assert(text.includes('IT Root'));assert(text.includes('Other Root'));assert(text.includes('Other Tools'));
  assert(await page.evaluate(()=>window.__reads.some(r=>r.route==='catalog.items.previewNextCode'&&r.input.nodeId===201)));
  await clickText(page,'Update item','[role=dialog]');await page.waitForFunction(()=>window.__writes.some(w=>w.route==='catalog.items.update'));
  const write=await page.evaluate(()=>window.__writes.find(w=>w.route==='catalog.items.update').input);assert.equal(write.id,22);assert.equal(write.nodeId,201);assert.equal(write.nameAr,'Foreign Hammer');
  await page.close();
 });
 for(const role of ['owner','admin','warehouse','maintenance_manager','construction_procurement_manager','senior_management']){
  await test(role+' creation keeps all existing category options',async()=>{const page=await pageFor({role});await openCreate(page);await clickCategory(page);const text=await pickerText(page);assert(text.includes('IT Root'));assert(text.includes('Other Root'));await page.close();});
 }
 for(const mode of ['missing','ambiguous']){
  await test('IT '+mode+' root fails closed without other categories',async()=>{const page=await pageFor({role:'it_manager',[mode]:true});await openCreate(page);await clickCategory(page);const text=await pickerText(page);assert(text.includes('category (10) is unavailable'));assert(!text.includes('Other Root'));await clickText(page,await page.evaluate(()=>window.__captions.save),'[role=dialog]');assert.equal(await page.evaluate(()=>window.__writes.length),0);await page.close();});
 }
 assert.deepEqual(errors,[],'Browser runtime errors');
 console.log(JSON.stringify({passed,network:'blocked',database:'not used',realComponent:'ItemsManager'}));
}finally{await browser.close();}
