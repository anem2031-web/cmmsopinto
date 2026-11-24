import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ar from "../../client/src/i18n/ar";
import en from "../../client/src/i18n/en";
import ur from "../../client/src/i18n/ur";
import { MAINTENANCE_RESPONSIBLE_DEPARTMENT as D } from "../../shared/roles";

const f = vi.hoisted(() => ({
  path: "/maintenance-team-tickets", search: "", language: "ar", role: "it_member", active: 1, userId: 71,
  loading: false, ticket: undefined as any, error: null as any, queryLoading: false,
  values: [] as any[], cursor: 0, pendingEffects: [] as any[], queries: [] as any[], mutations: [] as any[],
  mutationCalls: [] as any[], buttons: [] as any[], inputs: [] as any[], guard: [] as any[], execution: [] as any[],
  navigation: [] as any[], cache: {} as Record<string, any>, historyState: null as any,
  back: vi.fn(), scrollTo: vi.fn(), refetch: vi.fn(), invalidate: vi.fn(), forceCannotLeave: false,
  mutationPending: false, materialAssignment: undefined as any, ticketItems: [] as any[],
}));
vi.mock("react", async original => ({
  ...(await original<typeof import("react")>()),
  useMemo: (read: () => any) => read(),
  useCallback: (callback: any) => callback,
  useState: (initial: any) => {
    const key=f.cursor++;
    if (!(key in f.values)) f.values[key]=typeof initial==="function"?initial():initial;
    return [f.values[key], (next: any) => { f.values[key]=typeof next==="function"?next(f.values[key]):next; }];
  },
  useRef: (initial: any) => {
    const key=f.cursor++;if (!(key in f.values)) f.values[key]={current:initial};return f.values[key];
  },
  useEffect: (run: () => any) => { f.pendingEffects.push(run); },
}));
vi.mock("wouter", () => ({
  useSearch: () => f.search,
  useLocation: () => [f.path, (url: string, options: any) => {
    f.navigation.push({url,options});const [path,query=""]=url.split("?");f.path=path;f.search=query?"?"+query:"";
  }],
}));
vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({user: {id:f.userId,role:f.role,isActive:f.active},loading:f.loading}),
}));
vi.mock("@/contexts/LanguageContext", () => ({
  useTranslation: () => ({language:f.language,dir:f.language==="en"?"ltr":"rtl",t:f.language==="ar"?ar:f.language==="en"?en:ur}),
  useLanguage: () => ({language:f.language,dir:f.language==="en"?"ltr":"rtl"}),
}));
vi.mock("@/lib/backStack", () => ({
  readHistoryEntryState: (key: string) => f.cache[key],
  writeHistoryEntryState: (key: string,value: any) => { f.cache[key]=value; },
}));
vi.mock("@/lib/trpc", () => {
  const data = (path: string) => {
    if(path==="tickets.getById")return f.ticket;
    if(path==="tickets.items")return f.ticketItems;
    if(path==="tickets.executionReferences")return {
      users:[{id:71,name:"خالد التقنية",nameEn:"Khaled IT",nameUr:"خالد آئی ٹی"}],
      sites:[{id:3,name:"الملقا",nameEn:"Malqa",nameUr:"الملقا"}],
      sections:[{id:5,name:"فودوزو",nameEn:"Fodozo",nameUr:"فودوزو"}],technicians:[],categories:[],
    };
    if(path==="attachments.list")return [
      {id:1,entityType:"ticket",entityId:741,fileName:"report.jpg",fileUrl:"/report.jpg",fileType:"image",mimeType:"image/jpeg"},
      {id:2,entityType:"ticket",entityId:741,fileName:"report.mp4",fileUrl:"/report.mp4",fileType:"video",mimeType:"video/mp4"},
      {id:3,entityType:"ticket",entityId:741,fileName:"invoice.pdf",fileUrl:"/invoice.pdf",fileType:"application/pdf",mimeType:"application/pdf"},
    ];
    if(path==="translation.getEntityTranslations")return f.language==="ar"?{}:{
      title:{text:f.language==="en"?"Inspect recorder":"ریکارڈر کا معائنہ"},
      description:{text:f.language==="en"?"Check camera recording":"کیمرے کی ریکارڈنگ چیک کریں"},
    };
    if(path==="tickets.itMaterialAssignment")return f.materialAssignment;
    if(path==="tickets.itPurchaseNeeds"||path==="externalMaintenance.routeReviews")return [];
    return undefined;
  };
  const node = (parts: string[]=[]): any => new Proxy(()=>{}, {
    get(_target,key) {
      if(key==="useUtils")return ()=>node();
      if(key==="invalidate")return (...args: any[])=>f.invalidate(parts.join("."),...args);
      if(key==="useQuery")return (input: any,options: any={})=>{
        const path=parts.join(".");f.queries.push({path,input,options});
        return {data:data(path),error:path==="tickets.getById"?f.error:null,
          isLoading:path==="tickets.getById"&&f.queryLoading,isFetching:false,refetch:f.refetch};
      };
      if(key==="useMutation")return (options: any={})=>{
        const path=parts.join(".");f.mutations.push({path,options});
        return {isPending:f.mutationPending,error:null,mutate:(input: any)=>f.mutationCalls.push({path,input}),
          mutateAsync:async(input: any)=>{f.mutationCalls.push({path,input});return {};},reset:()=>{}};
      };
      return node([...parts,String(key)]);
    },
  });
  return {trpc:node()};
});
vi.mock("@/components/ui/button", () => ({
  Button: (props: any) => {f.buttons.push(props);const {variant,size,asChild,...native}=props;return <button {...native}/>;},
}));
vi.mock("@/components/ui/input", () => ({
  Input: (props: any) => {f.inputs.push(props);return <input {...props}/>;},
}));
vi.mock("@/components/ui/textarea", () => ({
  Textarea: (props: any) => {f.inputs.push(props);return <textarea {...props}/>;},
}));
vi.mock("@/components/ui/dialog", () => {
  const Box=({children}:any)=><div>{children}</div>;
  return {Dialog:({open,children}:any)=>open?<div role="dialog">{children}</div>:null,
    DialogContent:Box,DialogHeader:Box,DialogTitle:Box,DialogDescription:Box};
});
vi.mock("../../client/src/pages/maintenance-teams/ExecutionLeaveGuard", () => ({
  ExecutionLeaveGuard: (props: any) => {f.guard.push(props);return <div data-leave-guard>{props.children}</div>;},
  useExecutionCanLeave: () => ()=>!f.forceCannotLeave,
  useExecutionDraftDirty: () => {},
}));
vi.mock("../../client/src/pages/maintenance-teams/ExecutionPanel", () => ({
  ExecutionPanel: (props: any) => {f.execution.push(props);return <p>existing linked material execution</p>;},
}));
vi.mock("sonner", () => ({toast:{success:vi.fn(),error:vi.fn()}}));

import ItTicketExecutionPage from "../../client/src/pages/maintenance-teams/ItTicketExecutionPage";
import { useOpenItExecution } from "../../client/src/pages/maintenance-teams/team-execution-navigation";

const text=(node: any): string=>node==null||typeof node==="boolean"?"":Array.isArray(node)?node.map(text).join(""):typeof node==="object"?text(node.props?.children):String(node);
const read=(path: string)=>f.queries.filter(query=>query.path===path).at(-1);
const button=(label: string)=>f.buttons.find(item=>text(item.children)===label);
function render(){
  f.cursor=0;f.pendingEffects=[];f.buttons=[];f.inputs=[];f.guard=[];f.execution=[];
  const html=renderToStaticMarkup(<ItTicketExecutionPage/>);for(const run of f.pendingEffects)run();return html;
}
const ticket=()=>({
  id:741,ticketNumber:"MT-2026-00795-01",title:"فحص جهاز التسجيل",description:"فحص تسجيل الكاميرا",
  workflowModel:"sub_ticket",sourceTaskId:18,parentTicketId:740,maintenanceResponsibleDepartment:D.IT,
  assignedToId:71,status:"in_progress",maintenancePath:null,siteId:3,sectionId:5,originalLanguage:"ar",
});
beforeEach(()=>{
  Object.assign(f,{path:"/maintenance-team-tickets",search:"?department="+D.IT+"&itExecution=741&search=كاميرا&executorId=71&status=open&siteId=3&sectionId=5&sort=newest&page=2",
    language:"ar",role:"it_member",active:1,userId:71,loading:false,ticket:ticket(),error:null,queryLoading:false,
    values:[],cursor:0,pendingEffects:[],queries:[],mutations:[],mutationCalls:[],buttons:[],inputs:[],guard:[],
    execution:[],navigation:[],cache:{},historyState:null,forceCannotLeave:false,mutationPending:false,materialAssignment:undefined,ticketItems:[]});
  f.back.mockReset();f.scrollTo.mockReset();f.refetch.mockReset();f.invalidate.mockReset();
  vi.stubGlobal("window",{scrollY:333,scrollTo:f.scrollTo,history:{get state(){return f.historyState;},back:f.back},
    requestAnimationFrame:(callback:()=>void)=>{callback();return 1;},cancelAnimationFrame:()=>{}});
  vi.stubGlobal("requestAnimationFrame",(callback:()=>void)=>{callback();return 1;});
});
afterEach(()=>vi.unstubAllGlobals());

describe("IT execution detail uses existing guarded ticket APIs",()=>{
  it("reads the exact actual ticket ID and scoped references without broad directory requests",()=>{
    const html=render();
    expect(read("tickets.getById")).toMatchObject({input:{id:741},options:{enabled:true}});
    expect(read("tickets.executionReferences")).toMatchObject({input:{ticketId:741},options:{enabled:true}});
    expect(read("attachments.list")).toMatchObject({input:{entityType:"ticket",entityId:741},options:{enabled:true}});
    expect(f.queries.some(query=>["users.list","sites.list","sections.list","ticketTeamAssignments.queue"].includes(query.path))).toBe(false);
    expect(html).toContain("MT-2026-00795-01");expect(html).toContain("فحص جهاز التسجيل");
    button("فتح البلاغ الكامل")!.onClick();
    expect(f.navigation.at(-1)?.url).toBe("/tickets/741");expect(f.execution).toHaveLength(0);
  });
  it.each(["0","-1","1.5","NaN","9007199254740992"])("disables guarded reads for malformed direct ID %s",id=>{
    f.search="?itExecution="+id;const html=render();
    expect(read("tickets.getById")?.options.enabled).toBe(false);
    expect(f.queries.filter(query=>query.options.enabled!==false&&query.path!=="tickets.getById")).toHaveLength(0);
    expect(html).not.toContain("فحص جهاز التسجيل");expect(f.mutationCalls).toHaveLength(0);
  });
  it.each(["warehouse","delegate","senior_management","observer"])("keeps forbidden role %s from all ticket reads/actions",role=>{
    f.role=role;const html=render();
    expect(read("tickets.getById")?.options.enabled).toBe(false);
    expect(html).not.toContain("فحص جهاز التسجيل");expect(f.mutationCalls).toHaveLength(0);
  });
  it("disables inactive/loading accounts and hides raw server errors",()=>{
    f.active=0;expect(render()).not.toContain("فحص جهاز التسجيل");
    expect(read("tickets.getById")?.options.enabled).toBe(false);
    f.active=1;f.error={message:"SELECT private_tokens FROM users"};const html=render();
    expect(html).not.toContain("SELECT private_tokens");expect(html).not.toContain("فحص جهاز التسجيل");
  });
  it("opens a canonical IT child item with a legacy general header for read-only review",()=>{
    f.ticket.maintenanceResponsibleDepartment=D.GENERAL;
    f.ticketItems=[{id:10,ticketId:741,responsibleDepartment:D.IT}];const html=render();
    expect(read("tickets.items")).toMatchObject({input:{ticketId:741},options:{enabled:true}});
    expect(html).toContain("فحص جهاز التسجيل");
    expect(read("tickets.executionReferences")?.options.enabled).toBe(true);
    expect(read("attachments.list")?.options.enabled).toBe(true);
    expect(html).not.toContain("سليم ولا يحتاج إصلاح");expect(html).not.toContain("تنفيذ بلاغ تقنية المعلومات");
    expect(read("tickets.itMaterialAssignment")).toBeUndefined();
    expect(read("tickets.itPurchaseNeeds")).toBeUndefined();
    expect(f.mutationCalls).toHaveLength(0);expect(f.execution).toHaveLength(0);
  });
  it.each([999,undefined])("does not accept a stale IT child item from ticket %s",itemTicketId=>{
    f.ticket.maintenanceResponsibleDepartment=D.GENERAL;
    f.ticketItems=[{id:10,ticketId:itemTicketId,responsibleDepartment:D.IT}];const html=render();
    expect(html).not.toContain("فحص جهاز التسجيل");
    expect(read("tickets.executionReferences")?.options.enabled).toBe(false);
    expect(read("attachments.list")?.options.enabled).toBe(false);
    expect(read("tickets.itMaterialAssignment")).toBeUndefined();
    expect(read("tickets.itPurchaseNeeds")).toBeUndefined();
  });
  it.each([
    {workflowModel:"department_tasks"}, {sourceTaskId:null}, {maintenanceResponsibleDepartment:D.GENERAL},
    {id:999},
  ])("does not render an unrelated or wrong-type cached ticket %j",changes=>{
    Object.assign(f.ticket,changes);const html=render();
    expect(html).not.toContain("فحص جهاز التسجيل");
    expect(read("tickets.executionReferences")?.options.enabled).toBe(false);
    expect(read("attachments.list")?.options.enabled).toBe(false);
    expect(f.mutationCalls).toHaveLength(0);
  });
});

describe("IT detail shares the visual shell while preserving existing execution permissions",()=>{
  it.each(["ar","en","ur"])("renders translated title, description and report media with %s direction",language=>{
    f.language=language;const html=render();
    expect(html).toContain('dir="'+(language==="en"?"ltr":"rtl")+'"');
    expect(html).toContain(language==="ar"?"فحص جهاز التسجيل":language==="en"?"Inspect recorder":"ریکارڈر کا معائنہ");
    expect(html).toContain(language==="ar"?"فحص تسجيل الكاميرا":language==="en"?"Check camera recording":"کیمرے کی ریکارڈنگ چیک کریں");
    expect(html).toContain('src="/report.jpg"');expect(html).toContain('src="/report.mp4"');
    expect(html).not.toContain('src="/invoice.pdf"');expect(html).toContain("data-leave-guard");
  });
  it("retains existing result controls only for the actual assigned IT executor",()=>{
    const html=render();
    for(const label of ["سليم ولا يحتاج إصلاح","تم الإصلاح","يحتاج مواد","يوجد عائق","صيانة خارجية"])expect(html).toContain(label);
    button("سليم ولا يحتاج إصلاح")!.onClick();
    expect(f.mutationCalls).toEqual([{path:"tickets.recordItExecutionOutcome",input:{ticketId:741,outcome:"ok",note:"",materialsUsed:undefined}}]);
  });
  it.each(["owner","admin","construction_procurement_manager","it_manager"])("adds no IT execution writes for read-only viewer %s",role=>{
    f.role=role;f.userId=7;const html=render();
    expect(html).toContain("فحص جهاز التسجيل");expect(html).not.toContain("سليم ولا يحتاج إصلاح");
    expect(html).not.toContain("تنفيذ بلاغ تقنية المعلومات");expect(f.mutationCalls).toHaveLength(0);
    if(role==="it_manager")expect(f.queries.find(query=>query.path==="tickets.itMaterialAssignment")?.options.enabled).toBe(false);
    else expect(read("tickets.itMaterialAssignment")).toBeUndefined();
  });
  it("keeps another IT member in read-only mode without impersonating the named executor",()=>{
    f.userId=72;const html=render();
    expect(html).toContain("فحص جهاز التسجيل");expect(html).toContain("تنفيذ التذكرة متاح للمكلّف بها فقط");
    expect(html).not.toContain("سليم ولا يحتاج إصلاح");expect(f.mutationCalls).toHaveLength(0);
    expect(f.queries.find(query=>query.path==="tickets.itMaterialAssignment")?.options.enabled).toBe(false);
  });
  it("uses the existing real material assignment only when linked",()=>{
    f.materialAssignment={assignmentId:91};const html=render();
    expect(html).toContain("existing linked material execution");expect(f.execution).toHaveLength(1);
    expect(f.execution[0]).toMatchObject({assignmentId:91,actorId:71,role:"it_member",mode:"execution"});
  });
  it("passes pending execution to the existing leave guard without auto-saving",()=>{
    f.mutationPending=true;render();render();
    expect(f.guard.at(-1)?.busy).toBe(true);expect(f.mutationCalls).toHaveLength(0);
  });
});

describe("IT detail navigation retains list state",()=>{
  it("opens the real ticket query parameter, preserves filters, and saves scroll",()=>{
    f.search=f.search.replace("&itExecution=741","");const open=useOpenItExecution();open(742);
    const url=f.navigation.at(-1)?.url,params=new URLSearchParams(url.split("?")[1]);
    expect(params.get("itExecution")).toBe("742");expect(params.get("executorId")).toBe("71");
    expect(params.get("page")).toBe("2");expect(params.get("search")).toBe("كاميرا");
    expect(params.get("department")).toBe(D.IT);expect(Object.values(f.cache)).toContain(333);
    expect(params.has("teamExecution")).toBe(false);
  });
  it("keeps the full-ticket escape route behind the same unsaved-work guard",()=>{
    render();f.forceCannotLeave=true;button("فتح البلاغ الكامل")!.onClick();expect(f.navigation).toHaveLength(0);
    f.forceCannotLeave=false;button("فتح البلاغ الكامل")!.onClick();
    expect(f.navigation.at(-1)?.url).toBe("/tickets/741");expect(f.mutationCalls).toHaveLength(0);
  });
  it("returns to the same filtered list when there is no history marker",()=>{
    render();button("العودة إلى مهام الفريق")!.onClick();
    const params=new URLSearchParams(f.navigation.at(-1)?.url.split("?")[1]);
    expect(params.has("itExecution")).toBe(false);expect(params.get("search")).toBe("كاميرا");
    expect(params.get("executorId")).toBe("71");expect(params.get("siteId")).toBe("3");
    expect(params.get("page")).toBe("2");expect(f.back).not.toHaveBeenCalled();
  });
  it("uses browser back for a list navigation marker and honors the shared unsaved-work guard",()=>{
    f.historyState={fromTeamTicketList:true};render();f.forceCannotLeave=true;
    button("العودة إلى مهام الفريق")!.onClick();expect(f.back).not.toHaveBeenCalled();
    f.forceCannotLeave=false;button("العودة إلى مهام الفريق")!.onClick();
    expect(f.back).toHaveBeenCalledOnce();expect(f.navigation).toHaveLength(0);
  });
});
