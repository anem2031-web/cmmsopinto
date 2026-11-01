import { afterEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";
import {
  UnifiedBundleApprovalService,
  type UnifiedApprovalPorts,
} from "../services/delegate-pricing-bundles/unified-approval";
import { createPricingBundlesRouter } from "../routers/delegate-pricing-bundles/router";
import { router } from "../routers/_shared/procedures";
import {
  approvedBundleCondition,
  approvedBundleSnapshot,
} from "../services/delegate-pricing-bundles/approved-document";
import { assertLegacyApprovalOutsideUnifiedBundle } from "../services/delegate-pricing-bundles/unified-feature";
import { TRPCError } from "@trpc/server";
import { createBundleReplacementAdapter } from "../services/delegate-pricing-bundles/replacement-approval-adapter";
import { pricingBundleApprovalNotificationPath } from "../../shared/delegate-pricing-bundles";
import { getDelegateItemActionMode } from "../routers/purchase/actionable";
import { assertPOVisible } from "../_core/authz/engine";
import { PricingBundleService } from "../services/delegate-pricing-bundles/service";
const { DatabaseSync } = createRequire(import.meta.url)(
  "node:sqlite"
) as typeof import("node:sqlite");
const closes: Array<() => void> = [];
afterEach(() => {
  closes.splice(0).forEach(fn => fn());
  vi.unstubAllEnvs();
});
const accountant = {
  id: 7,
  role: "accountant",
  isActive: 1,
  name: "Accountant",
};
const management = {
  id: 8,
  role: "senior_management",
  isActive: 1,
  name: "Management",
};
const key = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const input = (n = 1) => ({
  id: 24,
  revision: 0,
  operationKey: key(n),
  custodyBalance: "45538.00",
  notes: "ملاحظة الحزمة",
  rejections: [] as Array<{ itemId: number; reason: string }>,
});
function fixture() {
  vi.stubEnv("DELEGATE_PRICING_BUNDLE_APPROVALS_ENABLED", "true");
  const memory = new DatabaseSync(":memory:");
  closes.push(() => memory.close());
  memory.exec(`
    CREATE TABLE delegate_pricing_bundles(id INTEGER PRIMARY KEY,bundleNumber TEXT,delegateId INTEGER,status TEXT,revision INTEGER,createdAt TEXT,sentAt TEXT,effectsDone INTEGER,snapshotJson TEXT,pdfContent BLOB);
    CREATE TABLE delegate_pricing_bundle_approvals(bundleId INTEGER PRIMARY KEY,status TEXT,revision INTEGER DEFAULT 0,custodyBalance TEXT,accountingApprovedById INTEGER,accountingApprovedAt TEXT,accountingSignatureSnapshot TEXT,accountingNotes TEXT,accountingRejections TEXT,accountingOperationKey TEXT,accountingRequestHash TEXT,managementApprovedById INTEGER,managementApprovedAt TEXT,managementSignatureSnapshot TEXT,managementNotes TEXT,managementRejections TEXT,managementOperationKey TEXT,managementRequestHash TEXT,sendEffectsDone INTEGER DEFAULT 0,accountingEffectsDone INTEGER DEFAULT 0,managementEffectsDone INTEGER DEFAULT 0);
    CREATE TABLE delegate_pricing_bundle_batches(bundleId INTEGER,purchaseOrderId INTEGER,pricingBatchId INTEGER,purchasePackageSubmissionId INTEGER);
    CREATE TABLE delegate_pricing_bundle_items(bundleId INTEGER,purchaseOrderItemId INTEGER,removedAt TEXT);
    CREATE TABLE purchase_orders(id INTEGER PRIMARY KEY,poNumber TEXT,packageId INTEGER,status TEXT,requestedById INTEGER,ticketId INTEGER,ticketItemId INTEGER);
    CREATE TABLE purchase_packages(id INTEGER PRIMARY KEY,packageNumber TEXT);
    CREATE TABLE purchase_order_items(id INTEGER PRIMARY KEY,purchaseOrderId INTEGER,batchId INTEGER,delegateId INTEGER,itemName TEXT,quantity NUMERIC,unit TEXT,estimatedUnitCost TEXT,estimatedTotalCost TEXT,status TEXT,managementRejectionReason TEXT);
    CREATE TABLE po_pricing_batches(id INTEGER PRIMARY KEY,purchaseOrderId INTEGER,batchNumber INTEGER,purchasePackageSubmissionId INTEGER,submittedById INTEGER,status TEXT,itemCount INTEGER,totalEstimatedCost TEXT,custodyAmount TEXT,accountingApprovedById INTEGER,accountingApprovedAt TEXT,accountingSignatureSnapshot TEXT,accountingNotes TEXT,managementApprovedById INTEGER,managementApprovedAt TEXT,managementNotes TEXT);
    CREATE TABLE purchase_package_submissions(id INTEGER PRIMARY KEY,purchasePackageId INTEGER,subNumber INTEGER,status TEXT,totalEstimatedCost TEXT,custodyBalance TEXT,accountingApprovedById INTEGER,accountingApprovedAt TEXT,accountingSignatureSnapshot TEXT,managementApprovedById INTEGER,managementApprovedAt TEXT);
    CREATE TABLE users(id INTEGER PRIMARY KEY,role TEXT,isActive INTEGER,name TEXT,signatureUrl TEXT);
    CREATE TABLE audit_logs(id INTEGER PRIMARY KEY,userId INTEGER,action TEXT,entityType TEXT,entityId INTEGER,newValues TEXT);
    INSERT INTO users VALUES(7,'accountant',1,'Actual accountant','accounting-image'),(8,'senior_management',1,'Actual manager','management-image'),(11,'delegate',1,'Delegate',NULL),(1,'owner',1,'Owner',NULL),(2,'admin',1,'Admin',NULL);
    INSERT INTO purchase_packages VALUES(1,'PB-A'),(2,'PB-B');
    INSERT INTO purchase_orders VALUES(101,'PR-101',1,'pending_accounting',10,1001,2001),(102,'PR-102',2,'pending_accounting',10,1002,2002),(103,'PR-103',2,'pending_accounting',20,1003,2003);
    INSERT INTO po_pricing_batches(id,purchaseOrderId,batchNumber,purchasePackageSubmissionId,submittedById,status,itemCount,totalEstimatedCost) VALUES(11,101,3,10,11,'pending_accounting',1,'100'),(12,102,1,20,11,'pending_accounting',3,'50'),(13,103,2,20,11,'pending_accounting',4,'2275');
    INSERT INTO purchase_package_submissions(id,purchasePackageId,subNumber,status,totalEstimatedCost) VALUES(10,1,5,'pending_accounting','100'),(20,2,2,'pending_accounting','2325');
    INSERT INTO delegate_pricing_bundle_batches VALUES(24,101,11,10),(24,102,12,20),(24,103,13,20);
    INSERT INTO delegate_pricing_bundle_approvals(bundleId,status) VALUES(24,'pending_accounting');
  `);
  const prices = ["100", "10", "10", "30", "920", "640", "690", "25"];
  const snapshot: any = {
    number: "DPB-2026-000024",
    submittedAt: "2026-10-31T09:09:47Z",
    delegate: { id: 11, name: "Delegate", signature: "" },
    signatures: [101, 102, 103].map(id => ({
      purchaseOrderId: id,
      poNumber: `PR-${id}`,
      requesterName: "Requester",
      reviewerName: "Reviewer",
      requesterSignature: "",
      reviewerSignature: "",
    })),
    rows: prices.map((price, n) => ({
      id: n + 1,
      purchaseOrderId: n === 0 ? 101 : n < 4 ? 102 : 103,
      poNumber: n === 0 ? "PR-101" : n < 4 ? "PR-102" : "PR-103",
      packageId: n === 0 ? 1 : 2,
      delegateId: 11,
      itemName: `Material ${n + 1}`,
      quantity: 1,
      unit: "قطعة",
      estimatedUnitCost: price,
      estimatedTotalCost: price,
      ticketId: n === 0 ? 1001 : n < 4 ? 1002 : 1003,
      ticketItemId: n === 0 ? 2001 : n < 4 ? 2002 : 2003,
      sectionName: "Section",
      supplierName: "Supplier",
    })),
  };
  memory
    .prepare(
      "INSERT INTO delegate_pricing_bundles VALUES(24,?,11,'archived',1,'2026-10-31','2026-10-31',1,?,?)"
    )
    .run(
      snapshot.number,
      JSON.stringify(snapshot),
      Buffer.from("%PDF-delegate-original")
    );
  for (const row of snapshot.rows) {
    const batch =
      row.purchaseOrderId === 101 ? 11 : row.purchaseOrderId === 102 ? 12 : 13;
    memory
      .prepare(
        "INSERT INTO purchase_order_items(id,purchaseOrderId,batchId,delegateId,itemName,quantity,unit,estimatedUnitCost,estimatedTotalCost,status) VALUES(?,?,?,?,?,?,?,?,?,?)"
      )
      .run(
        row.id,
        row.purchaseOrderId,
        batch,
        11,
        row.itemName,
        1,
        row.unit,
        row.estimatedUnitCost,
        row.estimatedTotalCost,
        "estimated"
      );
    memory
      .prepare("INSERT INTO delegate_pricing_bundle_items VALUES(24,?,NULL)")
      .run(row.id);
  }
  // Same PO, but another batch/flow/item that must never be approved or rejected by DPB 24.
  memory.exec(
    "INSERT INTO po_pricing_batches(id,purchaseOrderId,batchNumber,submittedById,status,itemCount,totalEstimatedCost) VALUES(99,103,99,11,'pending_accounting',1,'999'); INSERT INTO purchase_order_items VALUES(99,103,99,11,'Foreign item',1,'قطعة','999','999','estimated',NULL)"
  );
  const dialect = new MySqlDialect();
  const queries: Array<{ sql: string; params: any[] }> = [];
  let chain = Promise.resolve();
  const tx = {
    execute: async (statement: any) => {
      const query = dialect.sqlToQuery(statement);
      const text = query.sql.replace(/ FOR UPDATE/g, "");
      queries.push({ sql: text, params: query.params });
      if (text.includes("information_schema.TABLES"))
        return [[{ TABLE_NAME: "delegate_pricing_bundle_approvals" }], []];
      const prepared = memory.prepare(text);
      return /^SELECT\b/i.test(text.trim())
        ? [prepared.all(...(query.params as any[])), []]
        : [
            {
              affectedRows: Number(
                prepared.run(...(query.params as any[])).changes
              ),
            },
            [],
          ];
    },
  };
  const database = {
    ...tx,
    transaction: (fn: any) => {
      const run = chain.then(async () => {
        memory.exec("BEGIN");
        try {
          const value = await fn(tx);
          memory.exec("COMMIT");
          return value;
        } catch (error) {
          memory.exec("ROLLBACK");
          throw error;
        }
      });
      chain = run.then(
        () => undefined,
        () => undefined
      );
      return run;
    },
  };
  const guards = vi.fn(async (_actor?: any) => (po: any) => {
    if (Number(po.requestedById) === 666)
      throw new TRPCError({ code: "FORBIDDEN" });
  });
  const stageGuard = vi.fn();
  const replacement = vi.fn(async () => false);
  const finish = vi.fn(async () => {});
  const updateItem = vi.fn(async (locked: any, item: any, data: any) => {
    const parts = Object.entries(data);
    await locked.execute(
      sql`UPDATE purchase_order_items SET ${sql.join(
        parts.map(([k, v]) => sql`${sql.raw(k)}=${v}`),
        sql`, `
      )} WHERE id=${Number(item.id)}`
    );
  });
  const ports: UnifiedApprovalPorts = {
    enabled: () => true,
    database: async () => database,
    readGuard: guards,
    authorizeStage: stageGuard,
    updateItem,
    replacement,
    finish,
  };
  const service = new UnifiedBundleApprovalService(ports);
  const get = (table: string, id = 24) =>
    memory
      .prepare(
        `SELECT * FROM ${table} WHERE ${table === "delegate_pricing_bundle_approvals" ? "bundleId" : "id"}=?`
      )
      .get(id) as any;
  return {
    memory,
    snapshot,
    queries,
    tx,
    database,
    ports,
    service,
    get,
    updateItem,
    replacement,
    finish,
    guards,
    stageGuard,
  };
}
describe("DPB live regressions: absent units and committed approvals", () => {
  it("resumes a stored follow-up through a fresh RPC after reload without repeating any decision or funding", async () => {
    const f = fixture();
    f.guards.mockImplementation(
      async actor => po =>
        assertPOVisible({ role: actor.role, userId: actor.id }, po)
    );
    f.finish.mockRejectedValueOnce(Error("Notification offline"));
    expect(
      (await f.service.approve(accountant, "accounting", input())).effectsDone
    ).toBe(false);
    const writes = f.updateItem.mock.calls.length;
    const replacements = f.replacement.mock.calls.length;
    const revision = f.get("delegate_pricing_bundle_approvals").revision;
    const api = router({
      delegatePricingBundles: createPricingBundlesRouter(
        { database: async () => f.database, unified: f.ports } as any,
        () => true
      ),
    });
    const caller = (user: any) =>
      api.createCaller({ user, req: { headers: {} }, res: {} } as any)
        .delegatePricingBundles;
    const result = await caller(accountant).resumeApproval({
      id: 24,
      stage: "accounting",
    });
    expect(result.effectsDone).toBe(true);
    expect(
      f.get("delegate_pricing_bundle_approvals").accountingEffectsDone
    ).toBe(1);
    await caller(accountant).resumeApproval({ id: 24, stage: "accounting" });
    expect(f.get("delegate_pricing_bundle_approvals").revision).toBe(revision);
    expect(f.updateItem).toHaveBeenCalledTimes(writes);
    expect(f.replacement).toHaveBeenCalledTimes(replacements);
    expect(f.finish).toHaveBeenCalledTimes(2);
    await expect(
      caller(accountant).resumeApproval({ id: 24, stage: "management" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      caller(management).resumeApproval({ id: 24, stage: "accounting" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    for (const role of [
      "delegate",
      "observer",
      "warehouse",
      "executive_director",
      "technician",
    ])
      await expect(
        caller({ ...accountant, role }).resumeApproval({
          id: 24,
          stage: "accounting",
        })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    f.memory.exec("INSERT INTO users VALUES(9,'accountant',1,'Other',NULL)");
    await expect(
      caller({ ...accountant, id: 9 }).resumeApproval({
        id: 24,
        stage: "accounting",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      caller(accountant).resumeApproval({ id: 999, stage: "accounting" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    f.memory.exec("UPDATE users SET isActive=0 WHERE id=7");
    await expect(
      caller(accountant).resumeApproval({ id: 24, stage: "accounting" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it.each([null, "", "—"])(
    "accepts an unchanged absent unit represented as %j without rewriting the frozen document",
    async unit => {
      const f = fixture();
      f.snapshot.rows[0].unit = "—";
      f.memory
        .prepare(
          "UPDATE delegate_pricing_bundles SET snapshotJson=? WHERE id=24"
        )
        .run(JSON.stringify(f.snapshot));
      f.memory
        .prepare("UPDATE purchase_order_items SET unit=? WHERE id=1")
        .run(unit);
      const before = f.get("delegate_pricing_bundles");
      const result = await f.service.approve(accountant, "accounting", input());
      expect(result.effectsDone).toBe(true);
      expect(result.status).toBe("pending_management");
      expect(f.get("delegate_pricing_bundles").snapshotJson).toBe(
        before.snapshotJson
      );
      expect(f.get("delegate_pricing_bundles").pdfContent).toEqual(
        before.pdfContent
      );
      expect(f.get("purchase_order_items", 1).unit).toBe(unit);
    }
  );
  it.each(["حبة", "كرتون", "قطعة "])(
    "continues to deny a real quoted unit change to %s",
    async unit => {
      const f = fixture();
      f.memory
        .prepare("UPDATE purchase_order_items SET unit=? WHERE id=1")
        .run(unit);
      await expect(
        f.service.approve(accountant, "accounting", input())
      ).rejects.toThrow("تغيرت بيانات صنف");
      expect(f.updateItem).not.toHaveBeenCalled();
    }
  );
  const useRealVisibility = (f: ReturnType<typeof fixture>) => {
    f.guards.mockImplementation(
      async actor => po =>
        assertPOVisible({ role: actor.role, userId: actor.id }, po)
    );
  };
  it("completes accounting and management with the real central policy, including a parent with a foreign accounting batch", async () => {
    const f = fixture();
    useRealVisibility(f);
    const result = await f.service.approve(accountant, "accounting", {
      ...input(),
      rejections: [{ itemId: 1, reason: "السعر مرتفع ويحتاج إعادة مراجعة" }],
    });
    expect(result.effectsDone).toBe(true);
    expect(f.get("purchase_orders", 101).status).toBe("rejected");
    expect(f.get("purchase_orders", 102).status).toBe("pending_management");
    expect(f.get("purchase_orders", 103).status).toBe("pending_accounting");
    // Original PO access stays restricted; only the exact DPB decision is readable.
    expect(() =>
      assertPOVisible(
        { role: "accountant", userId: 7 },
        f.get("purchase_orders", 102)
      )
    ).toThrow();
    expect(
      (await f.service.detail(accountant, 24)).accountingApprovedById
    ).toBe(7);
    expect((await f.service.detail(management, 24)).status).toBe(
      "pending_management"
    );
    expect(() =>
      assertPOVisible(
        { role: "senior_management", userId: 8 },
        f.get("purchase_orders", 103)
      )
    ).toThrow();
    const replay = await f.service.approve(accountant, "accounting", {
      ...input(),
      rejections: [{ itemId: 1, reason: "السعر مرتفع ويحتاج إعادة مراجعة" }],
    });
    expect(replay.replayed).toBe(true);
    expect(replay.effectsDone).toBe(true);
    const writes = f.updateItem.mock.calls.length;
    await expect(
      f.service.approve(accountant, "accounting", { ...input(2), revision: 1 })
    ).rejects.toThrow("تغيرت مرحلة");
    expect(f.updateItem).toHaveBeenCalledTimes(writes);
    const approved = await f.service.approve(management, "management", {
      ...input(3),
      revision: 1,
    });
    expect(approved.effectsDone).toBe(true);
    expect(approved.status).toBe("approved");
    expect(f.get("purchase_order_items", 1).status).toBe("rejected");
    expect(f.get("purchase_order_items", 2).status).toBe("approved");
    expect(f.get("purchase_order_items", 99).status).toBe("estimated");
    expect(f.get("po_pricing_batches", 99).status).toBe("pending_accounting");
  });
  it("does not grant a different accountant access or follow-up after the original actor completes accounting", async () => {
    const f = fixture();
    useRealVisibility(f);
    await f.service.approve(accountant, "accounting", input());
    f.memory.exec(
      "INSERT INTO users VALUES(9,'accountant',1,'Other accountant',NULL)"
    );
    const other = { ...accountant, id: 9 };
    await expect(f.service.detail(other, 24)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      f.service.finish(other, 24, "accounting")
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await f.service.detail(accountant, 24)).bundleNumber).toBe(
      f.snapshot.number
    );
    await expect(f.service.detail(other, 24)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(f.finish).toHaveBeenCalledTimes(1);
  });
  it("rechecks active identity and keeps missing-parent and infrastructure failures visible on committed reads/replays", async () => {
    const f = fixture();
    useRealVisibility(f);
    await f.service.approve(accountant, "accounting", input());
    f.memory.exec("UPDATE users SET isActive=0 WHERE id=7");
    await expect(f.service.detail(accountant, 24)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      f.service.finish(accountant, 24, "accounting")
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    f.memory.exec("UPDATE users SET isActive=1 WHERE id=7");
    f.guards.mockRejectedValueOnce(Error("Read infrastructure offline"));
    await expect(f.service.detail(accountant, 24)).rejects.toThrow(
      "Read infrastructure offline"
    );
    f.memory.exec("DELETE FROM purchase_orders WHERE id=101");
    await expect(f.service.detail(accountant, 24)).rejects.toThrow(
      "أحد طلبات الحزمة غير موجود"
    );
  });
});
describe("Unified DPB approval is atomic while item workflow links remain independent", () => {
  it("approves 8 items / 3 POs / 2 PBs in two decisions, stores the free custody once, and preserves each original source reference", async () => {
    const f = fixture();
    const before = f.memory
      .prepare(
        "SELECT id,purchaseOrderId,batchId,delegateId FROM purchase_order_items ORDER BY id"
      )
      .all();
    const accounting = await f.service.approve(
      accountant,
      "accounting",
      input()
    );
    expect(accounting.status).toBe("pending_management");
    expect(f.get("delegate_pricing_bundle_approvals").custodyBalance).toBe(
      "45538.00"
    );
    expect(
      f.memory
        .prepare("SELECT custodyAmount FROM po_pricing_batches WHERE id<>99")
        .all()
        .every((row: any) => row.custodyAmount === null)
    ).toBe(true);
    expect(
      f.memory
        .prepare("SELECT custodyBalance FROM purchase_package_submissions")
        .all()
        .every((row: any) => row.custodyBalance === null)
    ).toBe(true);
    const managementResult = await f.service.approve(management, "management", {
      ...input(2),
      revision: 1,
      custodyBalance: undefined,
    });
    expect(managementResult.status).toBe("approved");
    expect(
      f.memory
        .prepare("SELECT status FROM purchase_order_items WHERE id<>99")
        .all()
        .every((row: any) => row.status === "approved")
    ).toBe(true);
    expect(f.get("purchase_order_items", 99).status).toBe("estimated");
    expect(f.get("po_pricing_batches", 99).status).toBe("pending_accounting");
    expect(f.get("purchase_orders", 103).status).toBe("pending_accounting");
    for (const item of f.memory
      .prepare("SELECT * FROM purchase_order_items WHERE id<>99")
      .all() as any[])
      expect(
        getDelegateItemActionMode(
          f.get("purchase_orders", item.purchaseOrderId).status,
          item
        )
      ).toBe("purchase");
    expect(
      getDelegateItemActionMode(
        "pending_accounting",
        f.get("purchase_order_items", 99)
      )
    ).toBeNull();
    expect(
      f.memory
        .prepare(
          "SELECT id,purchaseOrderId,batchId,delegateId FROM purchase_order_items ORDER BY id"
        )
        .all()
    ).toEqual(before);
    expect(f.get("purchase_orders", 101)).toMatchObject({
      ticketId: 1001,
      ticketItemId: 2001,
    });
    expect(f.get("delegate_pricing_bundles").snapshotJson).toBe(
      JSON.stringify(f.snapshot)
    );
    expect(
      Buffer.from(f.get("delegate_pricing_bundles").pdfContent).toString()
    ).toBe("%PDF-delegate-original");
    expect(
      JSON.parse(
        f.get("delegate_pricing_bundle_approvals").managementSignatureSnapshot
      )
    ).toMatchObject({
      actorId: 8,
      name: "Actual manager",
      signatureUrl: "management-image",
    });
  });
  it("keeps rejected items separate while the remaining items continue through management and become individually purchaseable", async () => {
    const f = fixture();
    await f.service.approve(accountant, "accounting", {
      ...input(),
      rejections: [{ itemId: 1, reason: "رفض الحسابات للصنف المحدد" }],
    });
    expect(f.get("po_pricing_batches", 11).status).toBe("rejected");
    expect(f.get("purchase_orders", 101).status).toBe("rejected");
    await f.service.approve(management, "management", {
      ...input(2),
      revision: 1,
      custodyBalance: undefined,
      rejections: [{ itemId: 2, reason: "رفض الإدارة للصنف المحدد" }],
    });
    expect(f.get("purchase_order_items", 1).status).toBe("rejected");
    expect(f.get("purchase_order_items", 2).status).toBe("rejected");
    expect(f.get("purchase_order_items", 3).status).toBe("approved");
    const file = await approvedBundleSnapshot(
      f.database,
      { id: 24 },
      f.snapshot,
      async source => (source ? "data:" + source : "")
    );
    expect(file.number).toBe(f.snapshot.number);
    expect(file.rows).toHaveLength(8);
    expect(file.approvedTotal).toBe("2315.00");
    expect(f.get("purchase_package_submissions", 20).totalEstimatedCost).toBe(
      "2315"
    );
    expect(file.rows[0].approvalRejectionReason).toContain("الحسابات");
    expect(file.financialApprovals).toHaveLength(1);
    expect(file.financialApprovals?.[0]).toMatchObject({
      reference: f.snapshot.number,
      custodyValue: "45538.00",
      accountingName: "Actual accountant",
      managementName: "Actual manager",
      managementSignature: "data:management-image",
    });
  });
  it("does not show the document until management finishes and does not fall back to an older financial file", async () => {
    const f = fixture();
    const visible = async () => {
      const [result] = await f.database.execute(
        sql`SELECT b.id FROM delegate_pricing_bundles b WHERE ${approvedBundleCondition()}`
      );
      return result;
    };
    expect(await visible()).toEqual([]);
    await f.service.approve(accountant, "accounting", input());
    expect(await visible()).toEqual([]);
    await expect(
      approvedBundleSnapshot(f.database, { id: 24 }, f.snapshot, async () => "")
    ).rejects.toThrow("اكتمال اعتماد");
    await f.service.approve(management, "management", {
      ...input(2),
      revision: 1,
      custodyBalance: undefined,
    });
    expect(await visible()).toHaveLength(1);
  });
  it("uses DPB approval ownership for the real PDF service, including rejected child batches, while retaining the delegate bytes and fresh parent denial", async () => {
    const f = fixture();
    await f.service.approve(accountant, "accounting", {
      ...input(),
      rejections: [{ itemId: 1, reason: "رفض الصنف الأول من الحسابات" }],
    });
    await f.service.approve(management, "management", {
      ...input(2),
      revision: 1,
      custodyBalance: undefined,
    });
    const render = vi.fn(async (snapshot: any) =>
      Buffer.from("%PDF-financial-" + JSON.stringify(snapshot))
    );
    const pdf = new PricingBundleService({
      database: async () => f.database,
      render,
      signature: async (source: string | null) =>
        source ? "data:" + source : "",
    } as any);
    await expect(
      pdf.pdf({ ...accountant, id: 99 }, 24, true)
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const result = await pdf.pdf(management, 24, true);
    expect(result.name).toBe(f.snapshot.number + ".pdf");
    expect(render.mock.calls[0][0].approvedTotal).toBe("2325.00");
    expect(
      Buffer.from(
        (await pdf.pdf({ id: 11, role: "delegate", isActive: 1 }, 24, true))
          .content,
        "base64"
      ).toString()
    ).toBe("%PDF-delegate-original");
    f.memory.exec("DELETE FROM po_pricing_batches WHERE id=13");
    await expect(pdf.pdf(management, 24, true)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(render).toHaveBeenCalledTimes(1);
  });
  it("rolls back every earlier item, batch, signature and balance if a later item writer fails", async () => {
    const f = fixture();
    f.updateItem.mockImplementation(async () => {
      throw Error("later line unavailable");
    });
    await expect(
      f.service.approve(accountant, "accounting", {
        ...input(),
        rejections: [{ itemId: 5, reason: "سبب رفض الصنف الخامس" }],
      })
    ).rejects.toThrow("later line");
    expect(f.get("delegate_pricing_bundle_approvals")).toMatchObject({
      status: "pending_accounting",
      revision: 0,
      custodyBalance: null,
    });
    expect(f.get("po_pricing_batches", 11).status).toBe("pending_accounting");
    expect(f.memory.prepare("SELECT * FROM audit_logs").all()).toEqual([]);
    expect(f.finish).not.toHaveBeenCalled();
  });
  it("replays the exact operation without writing custody or stock projections twice and rejects changed payloads or concurrent conflicting decisions", async () => {
    const f = fixture();
    const results = await Promise.all([
      f.service.approve(accountant, "accounting", input()),
      f.service.approve(accountant, "accounting", input()),
    ]);
    expect(results.filter(row => row.replayed)).toHaveLength(1);
    expect(f.replacement).toHaveBeenCalledTimes(3);
    expect(f.memory.prepare("SELECT * FROM audit_logs").all()).toHaveLength(1);
    await expect(
      f.service.approve(accountant, "accounting", {
        ...input(),
        custodyBalance: "100",
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      f.service.approve(accountant, "accounting", input(3))
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(f.finish).toHaveBeenCalledTimes(1);
  });
  it("resumes failed workflow synchronization using the saved approval without applying the decision again", async () => {
    const f = fixture();
    f.finish.mockRejectedValueOnce(Error("notification failed"));
    expect(
      (await f.service.approve(accountant, "accounting", input())).effectsDone
    ).toBe(false);
    expect(
      (await f.service.approve(accountant, "accounting", input())).effectsDone
    ).toBe(true);
    expect(f.memory.prepare("SELECT * FROM audit_logs").all()).toHaveLength(1);
    expect(f.replacement).toHaveBeenCalledTimes(3);
  });
  it.each([
    [
      "foreign rejection",
      () => ({
        ...input(),
        rejections: [{ itemId: 99, reason: "صنف خارج حزمة التسعير" }],
      }),
    ],
    [
      "duplicate rejection",
      () => ({
        ...input(),
        rejections: [
          { itemId: 1, reason: "سبب مرفوض للصنف المحدد" },
          { itemId: 1, reason: "سبب آخر للصنف نفسه" },
        ],
      }),
    ],
    [
      "missing reason",
      () => ({ ...input(), rejections: [{ itemId: 1, reason: "قصير" }] }),
    ],
    ["stale revision", () => ({ ...input(), revision: 99 })],
    ["invalid custody", () => ({ ...input(), custodyBalance: "abc" })],
  ])("rejects %s before touching an item or approval", async (_, make) => {
    const f = fixture();
    await expect(
      f.service.approve(accountant, "accounting", make())
    ).rejects.toBeTruthy();
    expect(f.updateItem).not.toHaveBeenCalled();
    expect(f.get("delegate_pricing_bundle_approvals").revision).toBe(0);
  });
  it.each([
    "DELETE FROM purchase_orders WHERE id=103",
    "DELETE FROM po_pricing_batches WHERE id=13",
    "DELETE FROM purchase_package_submissions WHERE id=20",
    "DELETE FROM purchase_packages WHERE id=2",
    "DELETE FROM purchase_order_items WHERE id=8",
    "UPDATE purchase_order_items SET batchId=99 WHERE id=8",
    "UPDATE purchase_order_items SET quantity=20 WHERE id=8",
    "UPDATE purchase_orders SET ticketId=9999 WHERE id=103",
    "UPDATE purchase_orders SET requestedById=666 WHERE id=103",
  ])(
    "denies a bundle whose undisplayed member changed or lacks a parent: %s",
    async change => {
      const f = fixture();
      f.memory.exec(change);
      await expect(
        f.service.approve(accountant, "accounting", input())
      ).rejects.toBeTruthy();
      expect(f.updateItem).not.toHaveBeenCalled();
      expect(f.get("delegate_pricing_bundle_approvals").revision).toBe(0);
    }
  );
  it("refuses legacy batch, submission and whole-order approval paths only for managed members", async () => {
    const f = fixture();
    for (const scope of [{ batchId: 11 }, { submissionId: 20 }, { poId: 103 }])
      await expect(
        assertLegacyApprovalOutsideUnifiedBundle(f.database, scope)
      ).rejects.toThrow("DPB-2026-000024");
    await expect(
      assertLegacyApprovalOutsideUnifiedBundle(f.database, { batchId: 99 })
    ).resolves.toBeUndefined();
    vi.stubEnv("DELEGATE_PRICING_BUNDLE_APPROVALS_ENABLED", "false");
    const count = f.queries.length;
    await expect(
      assertLegacyApprovalOutsideUnifiedBundle(f.database, { batchId: 11 })
    ).rejects.toThrow("DPB-2026-000024");
    expect(f.queries).toHaveLength(count + 2);
    const absent = vi.fn(async () => [[], []]);
    await assertLegacyApprovalOutsideUnifiedBundle(
      { execute: absent },
      { batchId: 11 }
    );
    expect(absent).toHaveBeenCalledTimes(1);
    await expect(
      assertLegacyApprovalOutsideUnifiedBundle(
        {
          execute: async () => {
            throw Error("schema unavailable");
          },
        },
        { batchId: 11 }
      )
    ).rejects.toThrow("schema unavailable");
  });
  it("shows a DPB card rather than covering a foreign batch in the same request, keeps independent requests and propagates infrastructure errors", async () => {
    const f = fixture();
    const queue = await f.service.queue(accountant);
    expect(queue.items).toHaveLength(1);
    expect(queue.items[0].orderIds).toEqual([101, 102, 103]);
    expect(queue.items[0].coveredOrderIds).toEqual([101, 102]);
    expect(f.queries).toHaveLength(4);
    await f.service.queue(accountant);
    expect(f.queries).toHaveLength(8);
    f.memory.exec("DELETE FROM purchase_orders WHERE id=103");
    expect((await f.service.queue(accountant)).items).toEqual([]);
    f.ports.database = async () => ({
      execute: async () => {
        throw Error("database offline");
      },
    });
    await expect(f.service.queue(accountant)).rejects.toThrow(
      "database offline"
    );
  });
  it("uses the central RPC role allowlist plus fresh stored actor validation, denying observer/other roles/direct wrong-stage calls", async () => {
    const f = fixture();
    const api = router({
      delegatePricingBundles: createPricingBundlesRouter(
        { database: async () => f.database, unified: f.ports } as any,
        () => true
      ),
    });
    const caller = (user: any) =>
      api.createCaller({ user, req: { headers: {} }, res: {} } as any)
        .delegatePricingBundles;
    for (const role of [
      "delegate",
      "warehouse",
      "observer",
      "executive_director",
      "technician",
      "maintenance_manager",
    ]) {
      await expect(
        caller({ ...accountant, role }).approvalQueue()
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        caller({ ...accountant, role }).approveAccounting(input())
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    await expect(
      caller(accountant).approveManagement(input())
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      caller(management).approveAccounting(input())
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    f.memory.exec("UPDATE users SET isActive=0 WHERE id=7");
    await expect(
      caller(accountant).approveAccounting(input())
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(f.get("delegate_pricing_bundle_approvals").revision).toBe(0);
  });
  it("covers the original PO card when all its pending batches are represented by visible DPB cards, while each DPB still changes only its own items", async () => {
    const f = fixture();
    const extra = {
      ...f.snapshot,
      number: "DPB-2026-000025",
      rows: [
        {
          ...f.snapshot.rows[7],
          id: 99,
          purchaseOrderId: 103,
          poNumber: "PR-103",
          itemName: "Foreign item",
          estimatedUnitCost: "999",
          estimatedTotalCost: "999",
        },
      ],
    };
    f.memory
      .prepare(
        "INSERT INTO delegate_pricing_bundles VALUES(25,?,11,'archived',1,'2026-11-01','2026-11-01',1,?,NULL)"
      )
      .run(extra.number, JSON.stringify(extra));
    f.memory.exec(
      "INSERT INTO delegate_pricing_bundle_approvals(bundleId,status) VALUES(25,'pending_accounting'); INSERT INTO purchase_package_submissions(id,purchasePackageId,subNumber,status) VALUES(21,2,3,'pending_accounting'); UPDATE po_pricing_batches SET purchasePackageSubmissionId=21 WHERE id=99; INSERT INTO delegate_pricing_bundle_batches VALUES(25,103,99,21); INSERT INTO delegate_pricing_bundle_items VALUES(25,99,NULL)"
    );
    const queue = await f.service.queue(accountant);
    expect(queue.items).toHaveLength(2);
    expect(queue.items.flatMap(row => row.coveredOrderIds)).toContain(103);
    await f.service.approve(accountant, "accounting", input());
    expect(f.get("delegate_pricing_bundle_approvals", 25).status).toBe(
      "pending_accounting"
    );
    expect(f.get("purchase_order_items", 99).status).toBe("estimated");
  });
  it.each([
    ["owner", 1],
    ["admin", 2],
  ] as const)(
    "retains the existing %s exception for both approval stages",
    async (role, id) => {
      const f = fixture();
      const actor = { id, role, isActive: 1 };
      await f.service.approve(actor, "accounting", input());
      expect(
        (
          await f.service.approve(actor, "management", {
            ...input(2),
            revision: 1,
            custodyBalance: undefined,
          })
        ).status
      ).toBe("approved");
    }
  );
  it("rejects the entire DPB without requiring custody when all its items are rejected, preserving an unrelated active item", async () => {
    const f = fixture();
    const result = await f.service.approve(accountant, "accounting", {
      ...input(),
      custodyBalance: undefined,
      rejections: f.snapshot.rows.map((row: any) => ({
        itemId: row.id,
        reason: "سبب رفض الصنف من الحسابات",
      })),
    });
    expect(result.status).toBe("rejected");
    expect(
      f.get("delegate_pricing_bundle_approvals").custodyBalance
    ).toBeNull();
    expect(f.get("purchase_order_items", 99).status).toBe("estimated");
    expect(f.get("purchase_orders", 103).status).toBe("pending_accounting");
  });
  it("closes a bundle whose items were already cancelled without reviving them or requiring custody", async () => {
    const f = fixture();
    f.memory.exec(
      "UPDATE purchase_order_items SET status='cancelled' WHERE id<>99"
    );
    expect(
      (
        await f.service.approve(accountant, "accounting", {
          ...input(),
          custodyBalance: undefined,
        })
      ).status
    ).toBe("rejected");
    expect(f.get("purchase_order_items", 1).status).toBe("cancelled");
    expect(f.get("po_pricing_batches", 11).status).toBe("rejected");
    expect(f.get("purchase_order_items", 99).status).toBe("estimated");
  });
  it("records an already-cancelled line as unapproved in the final DPB while allowing the other lines to complete", async () => {
    const f = fixture();
    f.memory.exec(
      "UPDATE purchase_order_items SET status='cancelled' WHERE id=1"
    );
    await f.service.approve(accountant, "accounting", input());
    await f.service.approve(management, "management", {
      ...input(2),
      revision: 1,
      custodyBalance: undefined,
    });
    expect(
      (await f.service.detail(management, 24)).items[0].currentStatus
    ).toBe("cancelled");
    const file = await approvedBundleSnapshot(
      f.database,
      { id: 24 },
      f.snapshot,
      async () => ""
    );
    expect(file.rows[0].approvalRejectionReason).toContain("ملغى");
    expect(file.approvedTotal).toBe("2325.00");
  });
  it("lets a rejected replacement return for repricing without reopening it when other DPB items reach management approval", async () => {
    const f = fixture();
    f.replacement.mockImplementation(async (...args: any[]) => {
      const [tx, , stage, batch, rejection] = args;
      if (Number(batch.id) !== 11 || !rejection) return false;
      expect(stage).toBe("accounting");
      await tx.execute(
        sql`UPDATE purchase_order_items SET status='pending',batchId=NULL,estimatedUnitCost=NULL,estimatedTotalCost=NULL WHERE id=1`
      );
      await tx.execute(
        sql`UPDATE purchase_orders SET status='pending_estimate' WHERE id=101`
      );
      return true;
    });
    await f.service.approve(accountant, "accounting", {
      ...input(),
      rejections: [{ itemId: 1, reason: "يلزم إعادة تسعير البديل" }],
    });
    expect(f.get("purchase_orders", 101).status).toBe("pending_estimate");
    await f.service.approve(management, "management", {
      ...input(2),
      revision: 1,
      custodyBalance: undefined,
    });
    expect(f.get("purchase_order_items", 1)).toMatchObject({
      status: "pending",
      batchId: null,
      estimatedUnitCost: null,
    });
    expect(f.get("purchase_orders", 101).status).toBe("pending_estimate");
    expect(f.get("purchase_order_items", 3).status).toBe("approved");
  });
  it("keeps queue query counts bounded by 500 distinct parents, with no single-record loader and fresh scopes per request", async () => {
    const f = fixture();
    f.memory.exec("BEGIN");
    for (let n = 0; n < 50; n++) {
      const bundleId = 100 + n;
      const rows: any[] = [];
      for (let k = 0; k < 20; k++) {
        const id = 10000 + n * 20 + k;
        rows.push({
          ...f.snapshot.rows[0],
          id,
          purchaseOrderId: id,
          poNumber: `PR-${id}`,
          packageId: null,
        });
        f.memory
          .prepare(
            "INSERT INTO purchase_orders VALUES(?,?,NULL,'pending_accounting',10,NULL,NULL)"
          )
          .run(id, `PR-${id}`);
        f.memory
          .prepare(
            "INSERT INTO po_pricing_batches(id,purchaseOrderId,batchNumber,submittedById,status,itemCount,totalEstimatedCost) VALUES(?,?,1,11,'pending_accounting',1,'100')"
          )
          .run(id, id);
        f.memory
          .prepare(
            "INSERT INTO purchase_order_items VALUES(?,?,?,11,'Material',1,'قطعة','100','100','estimated',NULL)"
          )
          .run(id, id, id);
        f.memory
          .prepare(
            "INSERT INTO delegate_pricing_bundle_batches VALUES(?,?,?,NULL)"
          )
          .run(bundleId, id, id);
        f.memory
          .prepare("INSERT INTO delegate_pricing_bundle_items VALUES(?,?,NULL)")
          .run(bundleId, id);
      }
      f.memory
        .prepare(
          "INSERT INTO delegate_pricing_bundles VALUES(?,?,11,'archived',1,'2026-11-01','2026-11-01',1,?,NULL)"
        )
        .run(
          bundleId,
          `DPB-${bundleId}`,
          JSON.stringify({ ...f.snapshot, number: `DPB-${bundleId}`, rows })
        );
      f.memory
        .prepare(
          "INSERT INTO delegate_pricing_bundle_approvals(bundleId,status) VALUES(?,'pending_accounting')"
        )
        .run(bundleId);
    }
    f.memory.exec("COMMIT");
    const result = await f.service.queue(accountant);
    expect(result.items).toHaveLength(50);
    expect(result.nextId).toBe(148);
    expect(f.queries).toHaveLength(6);
    expect(
      f.queries
        .filter(
          q =>
            q.sql.includes("purchaseOrderId IN") ||
            q.sql.startsWith("SELECT * FROM purchase_orders WHERE")
        )
        .every(q => q.params.length <= 500)
    ).toBe(true);
    expect(f.guards).toHaveBeenCalledTimes(1);
    expect((await f.service.queue(accountant, 148)).items).toHaveLength(1);
    expect(f.queries).toHaveLength(10);
    expect(f.guards).toHaveBeenCalledTimes(2);
    f.memory.exec("UPDATE purchase_orders SET requestedById=666 WHERE id=103");
    expect(
      (await f.service.queue(accountant)).items.map(row => row.id)
    ).not.toContain(24);
  });
  it("uses the existing compensation delta writers, with no DPB balance passed as replacement funding, and returns rejected replacements by their own batch", async () => {
    const tx = {};
    const accountingWriter = vi.fn(async () => true),
      managementWriter = vi.fn(async () => true),
      returnWriter = vi.fn(async () => true),
      funding = vi.fn(async () => ({ additionalFunding: "20.0000" }));
    const adapter = createBundleReplacementAdapter({
      accounting: accountingWriter,
      management: managementWriter,
      returnToDelegate: returnWriter,
      funding,
    });
    expect(
      await adapter(
        tx,
        accountant,
        "accounting",
        { id: 11 },
        undefined,
        "note",
        "frozen"
      )
    ).toBe(true);
    expect(accountingWriter).toHaveBeenCalledWith(
      tx,
      7,
      11,
      "20.0000",
      "note",
      "frozen"
    );
    await adapter(
      tx,
      management,
      "management",
      { id: 11 },
      undefined,
      "note",
      "frozen"
    );
    expect(managementWriter).toHaveBeenCalledWith(tx, 8, 11, "note");
    await adapter(
      tx,
      management,
      "management",
      { id: 11 },
      { itemId: 1, reason: "إعادة تسعير البديل" },
      "note",
      "frozen"
    );
    expect(returnWriter).toHaveBeenCalledWith(
      tx,
      8,
      "senior_management",
      "management",
      11,
      1,
      "إعادة تسعير البديل"
    );
    expect(accountingWriter).toHaveBeenCalledTimes(1);
  });
  it("routes only the explicit DPB approval notification to its bundle without changing other notification targets", () => {
    expect(pricingBundleApprovalNotificationPath("dpb_approval:24")).toBe(
      "/delegate-pricing-bundles?approval=24"
    );
    for (const value of [
      null,
      "it_ticket_arrival",
      "dpb_approval:0",
      "dpb_approval:-1",
      "dpb_approval:24/../1",
      "dpb_approval:999999999999999999",
    ])
      expect(pricingBundleApprovalNotificationPath(value)).toBeNull();
  });
});
