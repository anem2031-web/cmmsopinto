import { beforeEach, describe, expect, it, vi } from "vitest";
import { router } from "../../_core/trpc";
import { createPmv2SimplifiedRouter } from "../../routers/pmv2/simplified";
const state=vi.hoisted(()=>({ enabled:true, execute:vi.fn(), create:vi.fn(), addItem:vi.fn(), activate:vi.fn(), pause:vi.fn(), resume:vi.fn() }));
const moduleRouter=createPmv2SimplifiedRouter({ enabled:()=>state.enabled, db:async()=>({execute:state.execute,transaction:vi.fn() as any}), service: { create:state.create,addItem:state.addItem,activate:state.activate,pause:state.pause,resume:state.resume } as any });
const api=router({pmv2:router({simplified:moduleRouter})});
function caller(role:string,isActive=1,actualRole=role){const user={id:7,role,isActive};return api.createCaller({user,authenticatedUser:{...user,role:actualRole}} as any).pmv2.simplified;}
beforeEach(()=>{state.enabled=true;state.execute.mockReset();state.execute.mockResolvedValue([[{id:7}]]);for(const f of [state.create,state.addItem,state.activate,state.pause,state.resume])f.mockReset();state.create.mockResolvedValue({id:1});});
describe("simplified PMV2 API access",()=>{
  it.each(["owner","admin","maintenance_manager","general_maintenance_manager"])("allows active %s to request a draft",async role=>{
    await expect(caller(role).create({title:"فحص",siteId:1,sectionId:2,teamId:3})).resolves.toEqual({id:1});
    expect(state.create).toHaveBeenCalledOnce();
  });
  it.each(["technician","warehouse","delegate","senior_management","observer"])("rejects %s before writes",async role=>{
    await expect(caller(role).create({title:"فحص",siteId:1,sectionId:2,teamId:3})).rejects.toThrow();expect(state.create).not.toHaveBeenCalled();
  });
  it("rejects inactive and impersonated accounts",async()=>{
    await expect(caller("owner",0).create({title:"فحص",siteId:1,sectionId:2,teamId:3})).rejects.toThrow();
    await expect(caller("admin",1,"observer").create({title:"فحص",siteId:1,sectionId:2,teamId:3})).rejects.toThrow();
    expect(state.create).not.toHaveBeenCalled();
  });
  it("does not call the database or writer while the feature is off",async()=>{
    state.enabled=false;await expect(caller("owner").status()).resolves.toEqual({enabled:false,legacyExists:false});
    await expect(caller("owner").create({title:"فحص",siteId:1,sectionId:2,teamId:3})).rejects.toMatchObject({code:"PRECONDITION_FAILED"});
    expect(state.execute).not.toHaveBeenCalled();expect(state.create).not.toHaveBeenCalled();
  });
  it("rechecks the current account before list reads",async()=>{
    state.execute.mockResolvedValueOnce([[]]);await expect(caller("owner").teams()).rejects.toMatchObject({code:"FORBIDDEN"});
    expect(state.execute).toHaveBeenCalledTimes(1);
  });
  it("does not leak SQL errors to the user",async()=>{
    state.create.mockRejectedValue(new Error("secret SQL error"));
    await expect(caller("owner").create({title:"فحص",siteId:1,sectionId:2,teamId:3})).rejects.toThrow("تعذر حفظ المهمة");
  });
});
