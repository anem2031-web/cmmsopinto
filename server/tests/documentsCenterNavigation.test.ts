import { describe,expect,it } from "vitest";
import { documentCenterSections,defaultDocumentKind } from "../../client/src/lib/documentCenterNavigation";
const actor=(role:string,username="OTHER")=>({id:7,role,username,isActive:1});
const types=(role:string,username="OTHER")=>documentCenterSections(actor(role,username)).flatMap(section=>section.types.map(type=>type.key));
describe("Document center organization preserves available document scopes",()=>{
  it.each(['admin','owner'])("organizes all documents into three groups with one DPB entry for %s",role=>{
    const sections=documentCenterSections(actor(role));
    expect(sections.map(section=>section.id)).toEqual(['financial','purchasing','warehouse']);
    expect(types(role)).toHaveLength(11);expect(new Set(types(role)).size).toBe(11);
    expect(types(role)).toContain('approved_pricing_bundle');expect(types(role)).not.toContain('delegate_pricing_bundle');
    expect(defaultDocumentKind(actor(role))).toBe('approved_pricing_bundle');
  });
  it.each(['ANIS','ahmed1'])("defaults named account %s to its approved DPB reader alone",username=>{
    expect(documentCenterSections(actor('user',username)).map(section=>section.id)).toEqual(['financial']);
    expect(types('user',username)).toEqual(['approved_pricing_bundle']);
    expect(defaultDocumentKind(actor('user',username))).toBe('approved_pricing_bundle');
    expect(types('purchase_requester',username)).toContain('purchase_order');
  });
  it.each(['accountant','senior_management'])("retains the original approval-scoped reader for %s",role=>{
    expect(types(role)).toContain('delegate_pricing_bundle');expect(types(role)).toContain('po_financial_batch');
    expect(types(role)).not.toContain('approved_pricing_bundle');expect(types(role)).toContain('delegate_pricing_documents');
  });
  it("keeps the accountant's three types and the delegate's sole original pricing type",()=>{
    expect(new Set(types('accountant'))).toEqual(new Set(['po_financial_batch','delegate_pricing_bundle','delegate_pricing_documents']));
    expect(types('delegate')).toEqual(['delegate_pricing_documents']);
    expect(defaultDocumentKind(actor('accountant'))).toBe('po_financial_batch');expect(defaultDocumentKind(actor('delegate'))).toBe('delegate_pricing_documents');
  });
  it.each(['warehouse','food_warehouse_manager','food_warehouse_assistant','maintenance_manager','executive_director','purchase_requester','observer'])("keeps the original nonfinancial types for %s without adding a financial grant",role=>{
    expect(new Set(types(role))).toEqual(new Set(['purchase_order','receipt','delivery','warehouse_issue','return','disposal','count','settlement']));
    expect(documentCenterSections(actor(role)).map(section=>section.id)).toEqual(['purchasing','warehouse']);
  });
  it.each(['user','it_member','it_manager','technician','gate_security','general_maintenance_manager','construction_procurement_manager'])("does not add an unrelated document route to %s",role=>{
    expect(types(role)).toEqual([]);expect(defaultDocumentKind(actor(role))).toBeUndefined();
  });
  it("denies disabled and missing identities and does not reuse a previous user's groups",()=>{
    expect(documentCenterSections({...actor('admin'),isActive:0})).toEqual([]);expect(documentCenterSections(null)).toEqual([]);
    expect(types('admin')).toContain('approved_pricing_bundle');expect(types('user')).toEqual([]);
    expect(types('user','ANIS')).toEqual(['approved_pricing_bundle']);expect(types('user','ANIS2')).toEqual([]);
  });
});
