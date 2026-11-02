import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const state=vi.hoisted(()=>({user:{id:1,role:'user',isActive:1,username:'ANIS'},calls:[] as any[],buttons:[] as any[],inputs:[] as any[],selects:[] as any[],approved:true,values:[] as any[],cursor:0,pdf:vi.fn(async()=>({name:'DPB-1.pdf',content:'JVBERg=='}))}));
vi.mock('react',async()=>({...await vi.importActual<typeof import('react')>('react'),useEffect:()=>{},useState:(initial:any)=>{
  const index=state.cursor++;if(!(index in state.values))state.values[index]=typeof initial==='function'?initial():initial;
  return [state.values[index],(value:any)=>state.values[index]=typeof value==='function'?value(state.values[index]):value];
}}));
vi.mock('../../client/src/_core/hooks/useAuth',()=>({useAuth:()=>({user:state.user})}));
vi.mock('../../client/src/components/ui/button',()=>({Button:({children,...props}:any)=>{state.buttons.push({children,...props});return <button {...props}>{children}</button>;}}));
vi.mock('../../client/src/components/ui/input',()=>({Input:(props:any)=>{state.inputs.push(props);return <input {...props}/>;}}));
vi.mock('../../client/src/components/ui/select',()=>({
  Select:({children,...props}:any)=>{state.selects.push(props);return <div>{children}</div>;},
  SelectTrigger:({children,...props}:any)=><button {...props}>{children}</button>,SelectValue:({children}:any)=><span>{children}</span>,
  SelectContent:({children}:any)=><div hidden>{children}</div>,SelectItem:({children,value}:any)=><span data-value={value}>{children}</span>,
}));
vi.mock('wouter',()=>({Link:({href,children}:any)=><a href={href}>{children}</a>}));
vi.mock('../../client/src/lib/trpc',()=>{
  const proxy=(path=''):any=>new Proxy(()=>{},{get(_target,key){
    if(key==='useUtils')return ()=>proxy('utils');
    if(key==='useMutation')return ()=>({mutateAsync:state.pdf,mutate:vi.fn(),isPending:false});
    if(key==='useQuery')return (input:any,options:any={})=>{
      state.calls.push({path,input,enabled:options.enabled!==false});
      const bundle={id:3,bundleNumber:'DPB-LEGACY-3',status:'archived',delegateName:'Delegate',total:50,createdAt:'2026-11-02 08:00:00',pdfAllowed:state.approved,items:[]};
      const data=path==='approvedPricingDocuments.listPage'?{rows:[{id:1,bundleNumber:'DPB-APPROVED-1',delegateName:'المندوب التجريبي',approvedAt:'2026-11-02 09:00:00',total:400}],page:1,total:1}:path==='delegatePricingBundles.status'?{enabled:true}:path==='delegatePricingBundles.listPage'?{rows:[bundle],total:1,page:1,delegates:[]}:path==='delegatePricingBundles.detail'?bundle:[];
      return {data:options.enabled===false?undefined:data,isLoading:false,isFetching:false,refetch:vi.fn(),error:null};
    };return proxy(path?`${path}.${String(key)}`:String(key));
  }});return {trpc:proxy()};
});
import DocumentsCenter from '../../client/src/pages/DocumentsCenter';
const render=()=>{state.cursor=0;state.buttons=[];state.inputs=[];state.selects=[];return renderToStaticMarkup(<DocumentsCenter/>);};
describe('Account-scoped approved pricing document tab',()=>{
  beforeEach(()=>{state.user={id:1,role:'user',isActive:1,username:'ANIS'};state.calls=[];state.buttons=[];state.values=[];state.cursor=0;state.approved=true;state.pdf.mockClear();});
  it.each(['ANIS','ahmed1'])('shows %s only the final document reader with view and print',username=>{
    state.user.username=username;const html=render();
    for(const value of ['حزم التسعير المعتمدة','DPB-APPROVED-1','المندوب التجريبي','400.00','استعراض','طباعة','تنزيل PDF'])expect(html).toContain(value);
    expect(html).not.toContain('المستندات الحالية');expect(html).not.toContain('href="/purchase-orders');expect(html).not.toContain('اعتماد وإرسال');
    expect(state.calls.filter(call=>call.enabled).map(call=>call.path)).toEqual(['approvedPricingDocuments.listPage']);
  });
  it.each(['admin','owner'])('shows three groups to %s and fetches only the selected document type',role=>{
    state.user={id:3,role,isActive:1,username:'ADMIN'};const first=render();
    for(const label of ['الوثائق المالية المعتمدة','الشراء والتسعير','مستندات المستودع'])expect(first).toContain(label);
    expect(first).not.toContain('المستندات الحالية');expect(first).toContain('DPB-APPROVED-1');
    expect(state.buttons.filter(button=>button.role==='tab')).toHaveLength(3);
    expect(state.calls.filter(call=>call.enabled).map(call=>call.path)).toEqual(['approvedPricingDocuments.listPage']);
    state.buttons.find(button=>button.children==='الشراء والتسعير').onClick();state.values=state.values.slice(0,1);state.calls=[];const purchasing=render();
    expect(purchasing).not.toContain('DPB-APPROVED-1');expect(state.calls.filter(call=>call.enabled).map(call=>call.path)).toEqual(['purchaseOrders.list']);
    state.buttons.find(button=>button.children==='الوثائق المالية المعتمدة').onClick();state.values=state.values.slice(0,1);state.calls=[];const selected=render();
    expect(selected).toContain('DPB-APPROVED-1');expect(state.calls.filter(call=>call.enabled).map(call=>call.path)).toEqual(['approvedPricingDocuments.listPage']);expect(selected).toContain('تنزيل PDF');
  });
  it.each(['accountant','senior_management','delegate','warehouse','observer'])('preserves existing %s tabs without the new account grant',role=>{
    state.user={id:7,role,isActive:1,username:'OTHER'};const html=render();
    expect(html).not.toContain('DPB-APPROVED-1');expect(state.calls.some(call=>call.path==='approvedPricingDocuments.listPage')).toBe(false);
  });
  it('keeps one search, collapses advanced filters and forwards date/sort filters to the current reader',()=>{
    let html=render();expect(state.inputs.filter(input=>input['aria-label']==='البحث في المستندات')).toHaveLength(1);
    expect(html).not.toContain('type="date"');expect(html).not.toContain('مرات الطباعة');expect(html).toContain('1 مستند مطابق');
    state.buttons.find(button=>React.Children.toArray(button.children).includes('تصفية')).onClick();html=render();
    expect(state.inputs.filter(input=>input.type==='date')).toHaveLength(2);
    state.inputs.find(input=>input.type==='date').onChange({target:{value:'2026-11-01'}});
    render();
    state.selects.find(select=>select.value==='newest').onValueChange('oldest');state.calls=[];render();
    expect(state.calls.filter(call=>call.enabled)).toEqual([expect.objectContaining({path:'approvedPricingDocuments.listPage',input:expect.objectContaining({page:1,dateFrom:'2026-11-01',sort:'oldest'})})]);
    state.buttons.find(button=>button.children==='مسح الفلاتر').onClick();state.calls=[];render();
    expect(state.calls.find(call=>call.enabled).input).toMatchObject({page:1,dateFrom:undefined,dateTo:undefined,sort:'newest'});
  });
  it('keeps the accountant on its existing DPB endpoint and hides long references until details are requested',()=>{
    state.user={id:7,role:'accountant',isActive:1,username:'OTHER'};render();
    state.selects[0].onValueChange('delegate_pricing_bundle');state.values=state.values.slice(0,1);state.calls=[];let html=render();
    expect(html).toContain('DPB-LEGACY-3');expect(html).not.toContain('طلبات الشراء المرتبطة');
    expect(state.calls.filter(call=>call.enabled).map(call=>call.path)).toEqual(['delegatePricingBundles.status','delegatePricingBundles.listPage']);
    expect(state.calls.some(call=>call.path==='approvedPricingDocuments.listPage'||call.path==='delegatePricingBundles.list')).toBe(false);
    for(const action of ['استعراض','تنزيل PDF','طباعة'])expect(html).toContain(action);
    state.buttons.find(button=>button.children==='تفاصيل').onClick();state.calls=[];render();
    expect(state.calls.find(call=>call.path==='delegatePricingBundles.detail')).toMatchObject({enabled:true,input:{id:3}});
    state.approved=false;html=render();expect(html).not.toContain('title="عرض PDF"');expect(html).not.toContain('title="تنزيل PDF"');
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
  it('downloads the freshly authorized approved PDF with its server filename without requiring a popup',async()=>{
    const originalUrl=globalThis.URL,originalWindow=(globalThis as any).window;
    const anchor={href:'',download:'',hidden:false,click:vi.fn(),remove:vi.fn()},appendChild=vi.fn();
    const revoke=vi.fn();
    (globalThis as any).URL={createObjectURL:vi.fn(()=> 'blob:approved-download'),revokeObjectURL:revoke};
    (globalThis as any).window={open:vi.fn(),document:{createElement:vi.fn(()=>anchor),body:{appendChild}},setTimeout:(fn:()=>void)=>fn()};
    try{
      render();await state.buttons.find(button=>React.Children.toArray(button.children).includes('تنزيل PDF')).onClick();
      expect(state.pdf).toHaveBeenCalledWith({id:1});expect(anchor.download).toBe('DPB-1.pdf');expect(anchor.href).toBe('blob:approved-download');
      expect(appendChild).toHaveBeenCalledWith(anchor);expect(anchor.click).toHaveBeenCalledTimes(1);expect(anchor.remove).toHaveBeenCalledTimes(1);
      expect(revoke).toHaveBeenCalledWith('blob:approved-download');expect((globalThis as any).window.open).not.toHaveBeenCalled();
      state.pdf.mockRejectedValueOnce(Error('approval revoked'));
      await state.buttons.find(button=>React.Children.toArray(button.children).includes('تنزيل PDF')).onClick();
      expect(anchor.click).toHaveBeenCalledTimes(1);expect(state.pdf).toHaveBeenCalledTimes(2);
    }finally{globalThis.URL=originalUrl;(globalThis as any).window=originalWindow;}
  });
  it('uses the original approval-scoped DPB RPC afresh for each of the three standardized actions',async()=>{
    state.user={id:7,role:'accountant',isActive:1,username:'OTHER'};render();
    state.selects[0].onValueChange('delegate_pricing_bundle');state.values=state.values.slice(0,1);render();
    const originalUrl=globalThis.URL,originalWindow=(globalThis as any).window;
    const preview={opener:{},location:{replace:vi.fn()},close:vi.fn()},anchor={href:'',download:'',hidden:false,click:vi.fn(),remove:vi.fn()};
    (globalThis as any).URL={createObjectURL:()=> 'blob:legacy',revokeObjectURL:vi.fn()};
    (globalThis as any).window={open:vi.fn(()=>preview),document:{createElement:()=>anchor,body:{appendChild:vi.fn()}},setTimeout:(fn:()=>void)=>fn()};
    vi.useFakeTimers();
    try{
      for(const action of ['استعراض','تنزيل PDF','طباعة'])await state.buttons.find(button=>React.Children.toArray(button.children).includes(action)).onClick();
      expect(state.pdf.mock.calls).toEqual(Array.from({length:3},()=>[{id:3,approvedDocument:true}]));
      expect(preview.location.replace).toHaveBeenCalledTimes(2);expect(anchor.click).toHaveBeenCalledTimes(1);
      expect(state.calls.some(call=>call.path==='approvedPricingDocuments.listPage')).toBe(false);
      vi.runOnlyPendingTimers();
    }finally{vi.useRealTimers();globalThis.URL=originalUrl;(globalThis as any).window=originalWindow;}
  });
});
