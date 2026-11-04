import { expect, it } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { prepareReplacementPurchase } from "../supplier-return-followup/purchase-bridge";

const actor = { id: 9, role: "admin", isActive: 1 };
const replacement = { catalogItemId: 1140037, itemName: "قفازات اختبار", quantity: 1, unit: "كيس", siteId: 5, sectionId: 8, categoryId: 12 };
function fixture(recorded: Record<string, unknown> = {}, user = actor, lineage: Record<string, unknown> = {}) {
  const plan = {
    id: 1, caseId: 7, status: "pending_review", purchaseOrderId: null, purchaseOrderItemId: null,
    creatorId: 2, requestedById: 2, originalQuantityCovered: "1", returnedQuantity: "1",
    handoverStatus: "accepted", resolution: "same_item", creatorDecision: null,
    originalPurchaseValue: "14.7200", currency: "SAR", valuationBasis: "tax_inclusive",
    catalogItemId: 1140037, itemName: "قفازات اختبار", replacementQuantity: "1", replacementUnit: "كيس",
    originalOrderId: 22, originalTicketId: null, originalTicketItemId: null,
    originalSiteId: null, originalSectionId: null, originalCategoryId: null, originalAssetId: null,
    originalItemSiteId: null, originalItemSectionId: null, originalItemCategoryId: null, originalItemAssetId: null,
    ...recorded,
  };
  const tx: any = { execute: async (statement: any) => {
    const query = new MySqlDialect().sqlToQuery(statement).sql.replace(/\s+/g, " ");
    if (query.includes("SELECT DATABASE()")) return [[{ databaseName: "copycmms2" }]];
    if (query.includes("FROM users")) return [[user]];
    if (query.includes("SELECT p.id,p.caseId,p.status")) return [[{ id: 19, caseId: 4, status: "received", purchaseOrderId: 22,
      creatorId: 2, createdById: 9, handoverStatus: "accepted", parentReplacementPlanId: null, exactReceipt: 1, parentSourceValid: 1, ...lineage }]];
    if (query.includes("FROM supplier_return_replacement_plans p")) return [[plan]];
    if (query.includes("type='cash_refund'")) return [[{id:11,sourceCreditId:10,amount:"14.7200",currency:"SAR",valuationBasis:"tax_inclusive"}]];
    if (query.includes("FROM supplier_return_settlements")) return [[{ id: 10, amount: "14.7200", currency: "SAR", valuationBasis: "tax_inclusive" }]];
    throw Error(`Unexpected query: ${query}`);
  } };
  const input = { ticketId: null, ticketItemId: null, items: [replacement], context: { siteId: 5, sectionId: 8, categoryId: 12, assetId: null } };
  return { tx, input };
}

it("fills missing historical purchase context only on the replacement order", async () => {
  const { tx, input } = fixture();
  await expect(prepareReplacementPurchase(tx, actor, 1, input)).resolves.toMatchObject({ planId: 1, originalOrderId: 22 });
});
it("links the confirmed refund retained by the delegate as the replacement's funding source",async()=>{
  const {tx,input}=fixture({resolution:"refund",creatorDecision:"replace"});
  await expect(prepareReplacementPurchase(tx,actor,1,input)).resolves.toMatchObject({creditId:11});
});

it("still rejects changing a recorded source location or item category", async () => {
  const location = fixture({ originalSiteId: 3 });
  await expect(prepareReplacementPurchase(location.tx, actor, 1, location.input)).rejects.toThrow("سياق طلب التعويض");
  const category = fixture({ originalItemCategoryId: 44 });
  await expect(prepareReplacementPurchase(category.tx, actor, 1, category.input)).rejects.toThrow("تصنيف صنف البديل");
});

it("keeps the original creator when an administrator entered the preceding replacement order", async () => {
  const creator = { id: 2, role: "operator", isActive: 1 };
  const { tx, input } = fixture({ parentReplacementPlanId: 19, requestedById: 9,
    originalItemId: 33, lotId: 44, receiptId: 55, receiptItemId: 66 }, creator);
  await expect(prepareReplacementPurchase(tx, creator, 1, input)).resolves.toMatchObject({ originalOrderId: 22 });
});

it("does not transfer later-round ownership to the prior order's administrator or a different creator", async () => {
  const recorded = { parentReplacementPlanId: 19, requestedById: 9, originalItemId: 33, lotId: 44, receiptId: 55, receiptItemId: 66 };
  const foreign = { id: 3, role: "operator", isActive: 1 };
  const f = fixture(recorded, foreign);
  await expect(prepareReplacementPurchase(f.tx, foreign, 1, f.input)).rejects.toThrow("منشئ الطلب الأصلي");
  const corrupted = fixture({ ...recorded, creatorId: 3 }, foreign);
  await expect(prepareReplacementPurchase(corrupted.tx, foreign, 1, corrupted.input)).rejects.toThrow("مصدر خطة البديل");
});

it("requires a fresh exact received source and the stored parent for a successive purchase", async () => {
  const recorded = { parentReplacementPlanId: 19, originalItemId: 33, lotId: 44, receiptId: 55, receiptItemId: 66 };
  for (const lineage of [{ exactReceipt: 0 }, { status: "purchased" }, { id: 29 }]) {
    const f = fixture(recorded, actor, lineage);
    await expect(prepareReplacementPurchase(f.tx, actor, 1, f.input)).rejects.toThrow();
  }
  const ordinary = fixture({ creatorId: 3 });
  await expect(prepareReplacementPurchase(ordinary.tx, actor, 1, ordinary.input)).rejects.toThrow("مصدر خطة البديل");
});
