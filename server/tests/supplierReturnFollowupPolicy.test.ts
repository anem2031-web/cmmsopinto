import { describe, it, expect } from "vitest";
import { decideHandover, resendHandover, chooseResolution, decideCreator, compareCompensationValue, type Followup } from "../supplier-return-followup/policy";
const actor = { id: 2, role: "delegate", active: true };
const warehouse = { id: 1, role: "warehouse", active: true };
const creator = { id: 3, role: "operations", active: true };
const initial = (): Followup => ({ delegateId: 2, creatorId: 3, returnedQuantity: 2, revision: 1, handover: "awaiting_delegate", resolution: null, rejectionReason: null, creatorDecision: null });
const noLinks = { verified: true, hasMaintenance: false, hasTask: false, hasMaterialNeed: false };
describe("supplier return follow-up policy foundation (not live)", () => {
  it("keeps delegate manager receipt and resolution limited to its assigned return",()=>{
    const manager={...actor,role:"delegate_manager"};
    const accepted=decideHandover(manager,initial(),1,true);
    expect(chooseResolution(manager,accepted,2,"refund")).toMatchObject({resolution:"refund",creatorDecision:"pending"});
    expect(()=>decideHandover({...manager,id:99},initial(),1,true)).toThrow("المسند");
  });
  it("requires a rejection reason and preserves quantity through resend", () => {
    expect(() => decideHandover(actor,initial(),1,false,"  ")).toThrow("السبب إلزامي");
    const rejected = decideHandover(actor,initial(),1,false,"لم تصل القطع");
    const resent = resendHandover(warehouse,rejected,2);
    expect(resent.returnedQuantity).toBe(2); expect(resent.handover).toBe("awaiting_delegate"); expect(resent.rejectionReason).toBe("لم تصل القطع");
    expect(decideHandover(actor,resent,3,true).handover).toBe("accepted");
  });
  it.each(["same_item","change_item","refund"] as const)("blocks %s before receipt; permits it after receipt", resolution => {
    expect(() => chooseResolution(actor,initial(),1,resolution)).toThrow("يلزم استلام");
    const accepted = decideHandover(actor,initial(),1,true);
    const selected = chooseResolution(actor,accepted,2,resolution);
    expect(selected.resolution).toBe(resolution);
    expect(() => chooseResolution(actor,selected,3,"refund")).toThrow();
  });
  it.each([{...actor,id:4},{...actor,active:false},{...actor,role:"accountant"}])("denies another recipient/inactive user/role", user => {
    expect(() => decideHandover(user,initial(),1,true)).toThrow();
  });
  it("rejects stale revisions and replay without mutating the original", () => {
    const source = initial(); const next = decideHandover(actor,source,1,true);
    expect(() => decideHandover(actor,next,1,false,"سبب")).toThrow("تغير المرتجع");
    expect(() => decideHandover(actor,next,2,true)).toThrow(); expect(source).toEqual(initial());
  });
  it("routes a changed item to the creator, not the delegate", () => {
    const state = chooseResolution(actor,decideHandover(actor,initial(),1,true),2,"change_item");
    expect(() => decideCreator(actor,state,3,"replace",noLinks)).toThrow("منشئ الطلب");
    expect(decideCreator(creator,state,3,"replace",noLinks).creatorDecision).toBe("replace");
    expect(() => decideCreator(creator,state,3,"cancel",noLinks)).toThrow();
  });
  it.each(["hasMaintenance","hasTask","hasMaterialNeed"] as const)("prevents cancelling a refund case with %s", field => {
    const state = chooseResolution(actor,decideHandover(actor,initial(),1,true),2,"refund");
    expect(() => decideCreator(creator,state,3,"cancel",{...noLinks,[field]:true})).toThrow("لا يمكن إلغاء");
    expect(decideCreator(creator,state,3,"replace",{...noLinks,[field]:true}).creatorDecision).toBe("replace");
  });
  it("allows cancellation only for verified unlinked refund; missing scope fails closed", () => {
    const state = chooseResolution(actor,decideHandover(actor,initial(),1,true),2,"refund");
    expect(() => decideCreator(creator,state,3,"cancel",{...noLinks,verified:false})).toThrow();
    expect(decideCreator(creator,state,3,"cancel",noLinks).creatorDecision).toBe("cancel");
    expect(() => chooseResolution(actor,{...state,resolution:null,creatorId:null},3,"refund")).toThrow("منشئ طلب");
  });
  it.each([[10000,10000,0,0],[12000,10000,2000,0],[8000,10000,0,2000],[12000,0,12000,0]])("compares %s against verified credit %s", (price,credit,additional,refund) => {
    expect(compareCompensationValue(price,credit)).toEqual({additionalCustody:additional,supplierRefundDue:refund});
  });
  it.each([-1,NaN,Infinity,0.1,Number.MAX_SAFE_INTEGER+1])("rejects invalid money %s", amount => {
    expect(() => compareCompensationValue(amount,10000)).toThrow();
  });
});
