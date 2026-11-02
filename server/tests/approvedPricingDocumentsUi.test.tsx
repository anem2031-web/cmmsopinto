import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const state=vi.hoisted(()=>({user:{id:1,role:'user',isActive:1,username:'ANIS'},calls:[] as any[],buttons:[] as any[],values:[] as any[],cursor:0,pdf:vi.fn(async()=>({name:'DPB-1.pdf',content:'JVBERg=='}))}));
vi.mock('react',async()=>({...await vi.importActual<typeof import('react')>('react'),useEffect:()=>{},useState:(initial:any)=>{
  const index=state.cursor++;if(!(index in state.values))state.values[index]=typeof initial==='function'?initial():initial;
  return [state.values[index],(value:any)=>state.values[index]=typeof value==='function'?value(state.values[index]):value];
}}));
vi.mock('../../client/src/_core/hooks/useAuth',()=>({useAuth:()=>({user:state.user})}));
vi.mock('../../client/src/components/ui/button',()=>({Button:({children,...props}:any)=>{state.buttons.push({children,...props});return <button {...props}>{children}</button>;}}));
vi.mock('wouter',()=>({Link:({href,children}:any)=><a href={href}>{children}</a>}));
vi.mock('../../client/src/lib/trpc',()=>{
  const proxy=(path=''):any=>new Proxy(()=>{},{get(_target,key){
    if(key==='useUtils')return ()=>proxy('utils');
    if(key==='useMutation')return ()=>({mutateAsync:state.pdf,mutate:vi.fn(),isPending:false});
    if(key==='useQuery')return (input:any,options:any={})=>{
      state.calls.push({path,input,enabled:options.enabled!==false});
      const data=path==='approvedPricingDocuments.listPage'?{rows:[{id:1,bundleNumber:'DPB-APPROVED-1',delegateName:'المندوب التجريبي',approvedAt:'2026-11-02 09:00:00',total:400}],page:1,total:1}:path==='delegatePricingBundles.status'?{enabled:true}:[];
      return {data:options.enabled===false?undefined:data,isLoading:false,isFetching:false,refetch:vi.fn(),error:null};
    };return proxy(path?`${path}.${String(key)}`:String(key));
  }});return {trpc:proxy()};
});
import DocumentsCenter from '../../client/src/pages/DocumentsCenter';
const render=()=>{state.cursor=0;state.buttons=[];return renderToStaticMarkup(<DocumentsCenter/>);};
describe('Account-scoped approved pricing document tab',()=>{
  beforeEach(()=>{state.user={id:1,role:'user',isActive:1,username:'ANIS'};state.calls=[];state.buttons=[];state.values=[];state.cursor=0;state.pdf.mockClear();});
  it.each(['ANIS','ahmed1'])('shows %s only the final document reader with view and print',username=>{
    state.user.username=username;const html=render();
    for(const value of ['حزم التسعير المعتمدة','DPB-APPROVED-1','المندوب التجريبي','400.00','استعراض','طباعة'])expect(html).toContain(value);
    expect(html).not.toContain('المستندات الحالية');expect(html).not.toContain('href="/purchase-orders');expect(html).not.toContain('اعتماد وإرسال');
    expect(state.calls.filter(call=>call.enabled).map(call=>call.path)).toEqual(['approvedPricingDocuments.listPage']);
  });
  it.each(['admin','owner'])('adds a tab for %s and loads it only on selection',role=>{
    state.user={id:3,role,isActive:1,username:'ADMIN'};const first=render();
    expect(first).toContain('حزم التسعير المعتمدة');expect(first).toContain('المستندات الحالية');expect(first).not.toContain('DPB-APPROVED-1');
    expect(state.calls.some(call=>call.path==='approvedPricingDocuments.listPage')).toBe(false);
    state.buttons.find(button=>button.children==='حزم التسعير المعتمدة').onClick();state.calls=[];const selected=render();
    expect(selected).toContain('DPB-APPROVED-1');expect(state.calls.filter(call=>call.enabled).map(call=>call.path)).toEqual(['approvedPricingDocuments.listPage']);
  });
  it.each(['accountant','senior_management','delegate','warehouse','observer'])('preserves existing %s tabs without the new account grant',role=>{
    state.user={id:7,role,isActive:1,username:'OTHER'};const html=render();
    expect(html).not.toContain('حزم التسعير المعتمدة');expect(state.calls.some(call=>call.path==='approvedPricingDocuments.listPage')).toBe(false);
  });
  it('rechecks the server PDF on each view or print, without using an archived delegate URL',async()=>{
    const created:string[]=[], revoked:string[]=[];const preview={opener:{},location:{replace:vi.fn()},close:vi.fn()};
    const originalUrl=globalThis.URL, originalWindow=(globalThis as any).window;
    (globalThis as any).URL={createObjectURL:()=>{created.push('blob:approved');return 'blob:approved';},revokeObjectURL:(url:string)=>revoked.push(url)};
    (globalThis as any).window={open:vi.fn(()=>preview),setTimeout:(fn:()=>void)=>fn()};
    try{
      render();const view=state.buttons.find(button=>React.Children.toArray(button.children).includes('استعراض'));
      const print=state.buttons.find(button=>React.Children.toArray(button.children).includes('طباعة'));
      await view.onClick();await print.onClick();
      expect(state.pdf.mock.calls).toEqual([[{id:1}],[{id:1}]]);expect(preview.location.replace).toHaveBeenCalledTimes(2);expect(preview.opener).toBe(null);expect(created).toHaveLength(2);expect(revoked).toHaveLength(2);
    }finally{globalThis.URL=originalUrl;(globalThis as any).window=originalWindow;}
  });
});
