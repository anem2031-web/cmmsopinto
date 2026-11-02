import { canReadPricingBundles } from "@shared/delegate-pricing-bundles";
import { canReadApprovedPricingDocuments, EXISTING_DOCUMENT_CENTER_ROLES, type ApprovedPricingDocumentActor } from "@shared/approved-pricing-documents";

export type ExistingDocumentKind = "purchase_order" | "receipt" | "delivery" | "warehouse_issue" | "return" | "disposal" | "count" | "settlement" | "delegate_pricing_documents" | "po_financial_batch" | "delegate_pricing_bundle";
export type DocumentKind = ExistingDocumentKind | "approved_pricing_bundle";
export type DocumentSection = { id: "financial" | "purchasing" | "warehouse"; label: string; types: {key:DocumentKind;label:string}[] };

/** Display organization only. Every type keeps its existing RPC and server scope. */
export function documentCenterSections(user: ApprovedPricingDocumentActor | null | undefined): DocumentSection[] {
  if (!user || user.isActive !== 1) return [];
  const oldCenter = EXISTING_DOCUMENT_CENTER_ROLES.includes(user.role);
  const general = oldCenter && !["accountant", "delegate"].includes(user.role);
  const approvedReader = canReadApprovedPricingDocuments(user);
  const financial: DocumentSection = {id:"financial",label:"الوثائق المالية المعتمدة",types:[]};
  if (approvedReader) financial.types.push({key:"approved_pricing_bundle",label:"حزم التسعير المعتمدة — DPB"});
  else if (oldCenter && !["delegate","observer"].includes(user.role) && canReadPricingBundles({...user,isActive:1})) financial.types.push({key:"delegate_pricing_bundle",label:"حزم التسعير المعتمدة — DPB"});
  if (["accountant","senior_management","owner","admin"].includes(user.role)) financial.types.push({key:"po_financial_batch",label:"اعتمادات طلبات وحزم الشراء"});
  const purchasing: DocumentSection = {id:"purchasing",label:"الشراء والتسعير",types:[]};
  if(general)purchasing.types.push({key:"purchase_order",label:"طلبات الشراء"});
  if(["delegate","accountant","senior_management","owner","admin"].includes(user.role))purchasing.types.push({key:"delegate_pricing_documents",label:"وثائق التسعير الصادرة من المندوبين"});
  const warehouse: DocumentSection = {id:"warehouse",label:"مستندات المستودع",types:general?[
    {key:"receipt",label:"سندات الاستلام"},{key:"delivery",label:"سندات التسليم"},{key:"warehouse_issue",label:"سندات الصرف المخزني"},
    {key:"return",label:"سندات المرتجع"},{key:"count",label:"الجرد"},{key:"settlement",label:"تسويات الجرد"},{key:"disposal",label:"الاستبعاد"},
  ]:[]};
  return [financial,purchasing,warehouse].filter(section=>section.types.length>0);
}
export function defaultDocumentKind(user: ApprovedPricingDocumentActor | null | undefined, sections=documentCenterSections(user)): DocumentKind | undefined {
  const allowed = sections.flatMap(section=>section.types.map(type=>type.key));
  const preferred:DocumentKind = canReadApprovedPricingDocuments(user)?"approved_pricing_bundle":user?.role==="accountant"?"po_financial_batch":user?.role==="delegate"?"delegate_pricing_documents":"purchase_order";
  return allowed.includes(preferred)?preferred:allowed[0];
}
