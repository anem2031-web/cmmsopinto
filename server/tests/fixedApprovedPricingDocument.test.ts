import { afterEach, describe, expect, it, vi } from "vitest";
import { approvedPricingFixture } from "./fixtures/approvedPricingDocuments";
import { ApprovedPricingDocumentReader } from "../services/delegate-pricing-bundles/approved-reader";
import { PricingBundleService } from "../services/delegate-pricing-bundles/service";
import { approvedBundleSnapshot } from "../services/delegate-pricing-bundles/approved-document";
import { fixedPdfHash, legacyDocumentSource, LEGACY_DPB_CORRECTIONS, readFixedApprovedDocument, lowestLegacyCustody } from "../services/delegate-pricing-bundles/fixed-approved-document";
import { documentHtml } from "../../tools/legacy-dpb-fixed-pdf/render.mjs";
import { financialFooterHtml } from "../../tools/legacy-dpb-fixed-pdf/finance.mjs";

const closes: Array<() => void> = [];
afterEach(() => { closes.splice(0).forEach(close => close()); vi.unstubAllEnvs(); });
const bytes = Buffer.from("%PDF-1.7\nfixed document\n%%EOF");
function fixture() {
  vi.stubEnv("DELEGATE_PRICING_BUNDLE_APPROVALS_ENABLED", "false");
  const f = approvedPricingFixture(); closes.push(() => f.memory.close());
  f.memory.function("SHA2", (value: string, _bits: number) => fixedPdfHash(String(value)));
  const snapshot = f.add(9), second = f.add(10);
  snapshot.number = "DPB-2026-000009"; snapshot.rows.push(...second.rows); snapshot.signatures.push(...second.signatures);
  f.memory.prepare("UPDATE delegate_pricing_bundles SET bundleNumber=?,snapshotJson=? WHERE id=9").run(snapshot.number, JSON.stringify(snapshot));
  f.memory.exec("UPDATE delegate_pricing_bundle_batches SET bundleId=9 WHERE bundleId=10; UPDATE delegate_pricing_bundle_items SET bundleId=9 WHERE bundleId=10;");
  f.memory.exec("ALTER TABLE delegate_pricing_bundles ADD COLUMN revision INTEGER DEFAULT 1; ALTER TABLE delegate_pricing_bundles ADD COLUMN effectsDone INTEGER DEFAULT 1; ALTER TABLE delegate_pricing_bundles ADD COLUMN createdAt TEXT; ALTER TABLE delegate_pricing_bundles ADD COLUMN pdfContent BLOB;");
  f.memory.prepare("UPDATE delegate_pricing_bundles SET pdfContent=? WHERE id=9").run(Buffer.from("%PDF-delegate-original"));
  f.memory.exec("CREATE TABLE delegate_pricing_bundle_pdf_corrections(bundleId INTEGER PRIMARY KEY,bundleNumber TEXT,sourceHash TEXT,formatVersion INTEGER,originalPdf BLOB,originalSha256 TEXT,correctedPdf BLOB,correctedSha256 TEXT,createdAt TEXT)");
  const bundle = { id: 9, bundleNumber: snapshot.number };
  const ports = { ...f.ports, fixedApprovedPdf: vi.fn(readFixedApprovedDocument) };
  const seed = async () => {
    const source = await legacyDocumentSource(f.database, bundle);
    f.memory.prepare("INSERT INTO delegate_pricing_bundle_pdf_corrections VALUES(?,?,?,2,?,?,?,?,CURRENT_TIMESTAMP)").run(9, bundle.bundleNumber, source.sourceHash, Buffer.from("original"), fixedPdfHash("original"), bytes, fixedPdfHash(bytes));
  };
  return { ...f, snapshot, bundle, ports, seed };
}

describe("Fixed legacy DPB PDFs: no writes or new permission grants", () => {
  it("limits the correction to exactly the reviewed twelve numbers", () => {
    expect(LEGACY_DPB_CORRECTIONS).toHaveLength(12);
    expect(new Set(LEGACY_DPB_CORRECTIONS).size).toBe(12);
    expect(LEGACY_DPB_CORRECTIONS).not.toContain("DPB-2026-000037");
  });
  it.each([1, 2, 3, 4])("serves the same frozen bytes through the named-reader entry point for allowed account %s", async id => {
    const f = fixture(); await f.seed();
    const reader = new ApprovedPricingDocumentReader(f.ports, () => true);
    for (let i = 0; i < 2; i++) expect(Buffer.from((await reader.pdf(f.actor(id), 9)).content, "base64")).toEqual(bytes);
    expect(f.ports.render).not.toHaveBeenCalled();
    expect(f.queries.every(q => q.sql.trim().startsWith("SELECT"))).toBe(true);
    expect(Buffer.from(f.memory.prepare("SELECT originalPdf FROM delegate_pricing_bundle_pdf_corrections").get()!.originalPdf as Uint8Array).toString()).toBe("original");
  });
  it.each(["accountant", "senior_management", "owner", "admin"])("serves fixed final bytes to %s but preserves the delegate's original download", async role => {
    const f = fixture(); await f.seed(); const service = new PricingBundleService(f.ports as any);
    expect(Buffer.from((await service.pdf({ id: 99, role, isActive: 1 }, 9, true)).content, "base64")).toEqual(bytes);
    expect(Buffer.from((await service.pdf({ id: 11, role: "delegate", isActive: 1 }, 9, true)).content, "base64").toString()).toBe("%PDF-delegate-original");
    expect(f.ports.fixedApprovedPdf).toHaveBeenCalledTimes(1); expect(f.ports.render).not.toHaveBeenCalled();
  });
  it.each([5, 7, 8, 11])("does not grant named-reader access to foreign account %s", async id => {
    const f = fixture(); await f.seed(); const reader = new ApprovedPricingDocumentReader(f.ports, () => true);
    await expect(reader.pdf(f.actor(id), 9)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(f.ports.fixedApprovedPdf).not.toHaveBeenCalled();
  });
  it.each([
    "UPDATE po_pricing_batches SET managementApprovedAt=NULL WHERE id=10",
    "DELETE FROM purchase_orders WHERE id=110",
    "DELETE FROM purchase_order_items WHERE id=1000",
    "DELETE FROM delegate_pricing_bundle_batches WHERE purchaseOrderId=110",
    "UPDATE users SET isActive=0 WHERE id=1",
  ])("rechecks approval, all members and actor before stored bytes: %s", async change => {
    const f = fixture(); await f.seed(); const reader = new ApprovedPricingDocumentReader(f.ports, () => true); const actor = f.actor();
    await reader.pdf(actor, 9); f.ports.fixedApprovedPdf.mockClear(); f.memory.exec(change);
    await expect(reader.pdf(actor, 9)).rejects.toBeTruthy(); expect(f.ports.fixedApprovedPdf).not.toHaveBeenCalled();
  });
  it.each([
    "UPDATE po_pricing_batches SET custodyAmount='99.00' WHERE id=10",
    "UPDATE po_pricing_batches SET accountingApprovedById=8 WHERE id=10",
    "UPDATE po_pricing_batches SET accountingNotes='Changed' WHERE id=10",
  ])("refuses stale fixed bytes after an approved source changes: %s", async change => {
    const f = fixture(); await f.seed(); f.memory.exec(change); const reader = new ApprovedPricingDocumentReader(f.ports, () => true);
    await expect(reader.pdf(f.actor(), 9)).rejects.toThrow("تغيرت بيانات"); expect(f.ports.render).not.toHaveBeenCalled();
  });
  it.each([
    "UPDATE delegate_pricing_bundle_pdf_corrections SET bundleNumber='FOREIGN'",
    "UPDATE delegate_pricing_bundle_pdf_corrections SET formatVersion=99",
    "UPDATE delegate_pricing_bundle_pdf_corrections SET formatVersion=1",
    "UPDATE delegate_pricing_bundle_pdf_corrections SET correctedSha256='broken'",
    "UPDATE delegate_pricing_bundle_pdf_corrections SET correctedPdf=x'255044462D62726F6B656E'",
  ])("rejects altered identity/format/bytes: %s", async change => {
    const f = fixture(); await f.seed(); f.memory.exec(change); const reader = new ApprovedPricingDocumentReader(f.ports, () => true);
    await expect(reader.pdf(f.actor(), 9)).rejects.toBeTruthy(); expect(f.ports.render).not.toHaveBeenCalled();
  });
  it("keeps current rendering when no correction has been installed", async () => {
    const f = fixture(); const reader = new ApprovedPricingDocumentReader(f.ports, () => true);
    await reader.pdf(f.actor(), 9); expect(f.ports.render).toHaveBeenCalledOnce();
  });
  it("does not query corrections for new/unified/unlisted documents", async () => {
    const database = { execute: vi.fn() };
    await expect(readFixedApprovedDocument(database, { id: 37, bundleNumber: "DPB-2026-000037" }, { financialApprovals: [{}, {}] } as any)).resolves.toBeNull();
    await expect(readFixedApprovedDocument(database, { id: 9, bundleNumber: "DPB-2026-000009" }, { financialApprovals: [{}] } as any)).resolves.toBeNull();
    expect(database.execute).not.toHaveBeenCalled();
  });
  it("only tolerates the exact missing-table migration error and propagates outages", async () => {
    const approved = { financialApprovals: [{}, {}] } as any, bundle = { id: 9, bundleNumber: "DPB-2026-000009" };
    const database = (error: any) => ({ execute: vi.fn(async () => { throw error; }) });
    await expect(readFixedApprovedDocument(database({ cause: { code: "ER_NO_SUCH_TABLE", errno: 1146, sqlMessage: "Table db.delegate_pricing_bundle_pdf_corrections doesn't exist" } }), bundle, approved)).resolves.toBeNull();
    await expect(readFixedApprovedDocument(database(Error("offline")), bundle, approved)).rejects.toThrow("offline");
    await expect(readFixedApprovedDocument(database({ code: "ER_NO_SUCH_TABLE", errno: 1146, sqlMessage: "Table purchase_orders doesn't exist" }), bundle, approved)).rejects.toBeTruthy();
  });
  it("keeps the source fingerprint independent of JSON key order and fetched signature availability", async () => {
    const f = fixture(); const before = await legacyDocumentSource(f.database, f.bundle);
    f.memory.prepare("UPDATE delegate_pricing_bundles SET snapshotJson=? WHERE id=9").run(JSON.stringify(Object.fromEntries(Object.entries(f.snapshot).reverse())));
    expect((await legacyDocumentSource(f.database, f.bundle)).sourceHash).toBe(before.sourceHash);
  });
  it("keeps the archived PDF stable when a user's current display name changes", async () => {
    const f = fixture(); await f.seed();
    f.memory.exec("UPDATE users SET name='New profile name' WHERE id IN (7,8)");
    const reader = new ApprovedPricingDocumentReader(f.ports, () => true);
    expect(Buffer.from((await reader.pdf(f.actor(), 9)).content, "base64")).toEqual(bytes);
    expect(f.ports.render).not.toHaveBeenCalled();
  });
  it("retains the delegate template and adds one financial block with the owner's lowest-balance display policy", async () => {
    const f = fixture(); f.memory.exec("UPDATE po_pricing_batches SET custodyAmount='47.00',accountingNotes='<original note>' WHERE id=10");
    const approved = await approvedBundleSnapshot(f.database, f.bundle, f.snapshot as any, async () => "data:image/png;base64,same-signature");
    const before = JSON.stringify(approved); const original = await documentHtml(approved);
    const delegate = await documentHtml(f.snapshot);
    const corrected = financialFooterHtml(approved);
    expect(original.match(/<div class="section-title">الشؤون المالية والإجراءات المحاسبية/g)).toHaveLength(2);
    expect(corrected.match(/الشؤون المالية والإجراءات المحاسبية/g)).toHaveLength(1);
    expect(corrected.match(/>الحسابات<\/td>/g)).toHaveLength(1);
    expect(corrected.match(/20\.00/g)).toHaveLength(1); expect(corrected).not.toContain("47.00"); expect(corrected).not.toContain("67.00");
    expect(corrected).toContain("&lt;original note&gt;");
    expect(delegate).toContain("القسم المستفيد</th>"); expect(delegate).toContain("المورد:");
    expect(delegate).not.toContain("الشؤون المالية والإجراءات المحاسبية</div>");
    expect(JSON.stringify(approved)).toBe(before);
  });
  it.each([
    [["3230.00", "3230.00", "47640.00"], "3230.00"],
    [["10.10", "2.25"], "2.25"],
    [["1.00", "0.00"], "0.00"],
    [[null, "12.00"], "12.00"],
    [["99999999999999.0002", "99999999999999.0001"], "99999999999999.0001"],
  ])("selects the exact lowest recorded balance from %j without mutating approvals", (values, minimum) => {
    const approvals = (values as (string | null)[]).map(custodyValue => ({ custodyValue })) as any;
    const before = JSON.stringify(approvals);
    expect(lowestLegacyCustody(approvals)).toBe(minimum); expect(JSON.stringify(approvals)).toBe(before);
  });
  it.each([[null], ["bad"], ["-2"], ["1.00001"]])("does not fabricate or silently accept invalid historical balances: %j", value => {
    expect(() => lowestLegacyCustody([{ custodyValue: value }] as any)).toThrow();
  });
});
