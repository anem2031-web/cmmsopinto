import { beforeEach, describe, expect, it, vi } from "vitest";
import { router } from "../../_core/trpc";
import { createPmv2SimplifiedRouter } from "../../routers/pmv2/simplified";
const state=vi.hoisted(()=>({ enabled:true, execute:vi.fn(), create:vi.fn(), addItem:vi.fn(), updatePlan:vi.fn(), updateItem:vi.fn(), disableItem:vi.fn(), deletePlan:vi.fn(), activate:vi.fn(), pause:vi.fn(), resume:vi.fn() }));
const moduleRouter=createPmv2SimplifiedRouter({ enabled:()=>state.enabled, db:async()=>({execute:state.execute,transaction:vi.fn() as any}), service: { create:state.create,addItem:state.addItem,updatePlan:state.updatePlan,updateItem:state.updateItem,disableItem:state.disableItem,deletePlan:state.deletePlan,activate:state.activate,pause:state.pause,resume:state.resume } as any });
const api=router({pmv2:router({simplified:moduleRouter})});
function caller(role:string,isActive=1,actualRole=role){const user={id:7,role,isActive};return api.createCaller({user,authenticatedUser:{...user,role:actualRole}} as any).pmv2.simplified;}
beforeEach(()=>{state.enabled=true;state.execute.mockReset();state.execute.mockResolvedValue([[{id:7}]]);for(const f of [state.create,state.addItem,state.updatePlan,state.updateItem,state.disableItem,state.deletePlan,state.activate,state.pause,state.resume])f.mockReset();state.create.mockResolvedValue({id:1});});
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
    state.enabled=false;await expect(caller("owner").status()).resolves.toEqual({enabled:false,legacyExists:false,canDelete:false});
    await expect(caller("owner").create({title:"فحص",siteId:1,sectionId:2,teamId:3})).rejects.toMatchObject({code:"PRECONDITION_FAILED"});
    expect(state.execute).not.toHaveBeenCalled();expect(state.create).not.toHaveBeenCalled();
  });
  it("rechecks the current account before list reads",async()=>{
    state.execute.mockResolvedValueOnce([[]]);await expect(caller("owner").teams()).rejects.toMatchObject({code:"FORBIDDEN"});
    expect(state.execute).toHaveBeenCalledTimes(1);
  });
  it("guards all of the new editing actions with the existing PMV2 management scope", async () => {
    const plan = { planId: 1, title: "فحص", titleEn: "Inspect", titleUr: "معائنہ", siteId: 1, sectionId: 2, teamId: 3 };
    const item = { planId: 1, itemId: 2, titleAr: "فحص", titleEn: "Inspect", titleUr: "معائنہ", recurrence: { kind: "daily" as const, startDate: "2026-11-22" } };
    const disabled = { planId: 1, itemId: 2 };
    for (const account of [caller("technician"), caller("owner", 0), caller("owner", 1, "observer")]) {
      await expect(account.updatePlan(plan)).rejects.toThrow();
      await expect(account.updateItem(item)).rejects.toThrow();
      await expect(account.disableItem(disabled)).rejects.toThrow();
    }
    expect(state.updatePlan).not.toHaveBeenCalled();
    expect(state.updateItem).not.toHaveBeenCalled();
    expect(state.disableItem).not.toHaveBeenCalled();

    const owner = caller("owner");
    await owner.updatePlan(plan);
    await owner.updateItem(item);
    await owner.disableItem(disabled);
    expect(state.updatePlan).toHaveBeenCalledOnce();
    expect(state.updateItem).toHaveBeenCalledOnce();
    expect(state.disableItem).toHaveBeenCalledOnce();
  });
  it("exposes and executes deletion only for the active owner and admin", async () => {
    const input = { planId: 1 };
    state.deletePlan.mockResolvedValue({ kind: "retired", cancelledFutureTasks: 0 });
    for (const role of ["maintenance_manager", "general_maintenance_manager"]) {
      await expect(caller(role).status()).resolves.toMatchObject({ canDelete: false });
      await expect(caller(role).deletePlan(input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    await expect(caller("owner", 0).deletePlan(input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller("owner", 1, "observer").deletePlan(input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller("maintenance_manager", 1, "owner").deletePlan(input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(state.deletePlan).not.toHaveBeenCalled();

    for (const role of ["owner", "admin"]) {
      await expect(caller(role).status()).resolves.toMatchObject({ canDelete: true });
      await expect(caller(role).deletePlan(input)).resolves.toEqual({ kind: "retired", cancelledFutureTasks: 0 });
    }
    expect(state.deletePlan).toHaveBeenCalledTimes(2);
    state.enabled = false;
    await expect(caller("owner").deletePlan(input)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(state.deletePlan).toHaveBeenCalledTimes(2);
  });
  it("does not leak SQL errors to the user",async()=>{
    state.create.mockRejectedValue(new Error("secret SQL error"));
    await expect(caller("owner").create({title:"فحص",siteId:1,sectionId:2,teamId:3})).rejects.toThrow("تعذر حفظ المهمة");
  });
});
