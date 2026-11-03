import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

const schema = read("drizzle/schema.ts");
const migration = read("drizzle/2026_10_04_purchase_order_location_categories.sql");
const router = read("server/routers/purchase/purchase-orders.router.ts");
const categoriesRouter = read("server/routers/purchase/purchase-categories.router.ts");
const createPage = read("client/src/pages/purchase/CreatePurchaseOrder.tsx");
const sidebar = read("client/src/components/layout/DashboardLayout.tsx");
const app = read("client/src/App.tsx");

test("purchase orders persist site/section/asset and dynamic category context", () => {
  assert.match(schema, /export const centerCategories = mysqlTable\("center_categories"/);
  assert.match(schema, /categoryId: int\(\)\.references\(\(\) => centerCategories\.id, \{ onDelete: "restrict" \}\)/);
  assert.match(migration, /ADD COLUMN `assetId` int NULL/);
  assert.match(migration, /ADD COLUMN `categoryId` int NULL/);
  assert.match(migration, /fk_purchase_orders_purchase_category/);
});

test("server validates the site -> section -> optional asset hierarchy", () => {
  assert.match(router, /الموقع والقسم مطلوبان في طلب الشراء/);
  assert.match(router, /القسم المحدد غير مرتبط بالموقع المختار/);
  assert.match(router, /الأصل المحدد غير مرتبط بالقسم المختار/);
  assert.match(router, /الأصل المحدد غير مرتبط بالموقع المختار/);
  assert.match(router, /const assetWasProvided = input\.assetId !== undefined/);
  assert.match(router, /if \(!assetWasProvided && ticket\.assetId\) assetId = Number\(ticket\.assetId\)/);
});

test("create and save-draft preserve atomic header + items creation", () => {
  const atomicBlocks = router.match(/db\.withTransaction\(async \(tx: any\) => \{/g) || [];
  assert.ok(atomicBlocks.length >= 2, "expected both create and saveDraft atomic transactions");
  assert.match(router, /db\.createPurchaseOrder\([\s\S]*?, tx\)/);
  assert.match(router, /db\.createPOItems\(itemsData, tx\)/);
});

test("purchase-order form resets dependent selectors and loads category master data", () => {
  assert.match(createPage, /trpc\.centerCategories\.list\.useQuery/);
  assert.match(createPage, /field === "siteId" \? \{ sectionId: "", assetId: "" \} : field === "sectionId" \? \{ assetId: "" \}/);
  assert.match(createPage, /const context = isReturnReplacement \? initialContext : purchaseItemsForSubmit\(\)\[0\]/);
  assert.match(createPage, /assetId: context\?\.assetId \? Number\(context\.assetId\) : null/);
  assert.match(createPage, /categoryId: context\?\.categoryId \? Number\(context\.categoryId\) : null/);
});

test("purchase categories are managed dynamically and protected from unsafe deletion", () => {
  assert.match(categoriesRouter, /list: protectedProcedure/);
  assert.match(categoriesRouter, /create: managerProcedure/);
  assert.match(categoriesRouter, /update: managerProcedure/);
  assert.match(categoriesRouter, /getCenterCategoryUsageCount/);
  assert.match(categoriesRouter, /ER_ROW_IS_REFERENCED_2/);
});

test("categories page is reachable from the management sidebar", () => {
  assert.match(sidebar, /labelKey: "nav\.purchaseCategories", path: "\/center-categories"/);
  assert.match(app, /<Route path="\/purchase-categories" component=\{PurchaseCategories\} \/>/);
});
