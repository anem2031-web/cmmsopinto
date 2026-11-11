import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { router, catalogProcedure, catalogItemManagerProcedure, catalogItemUpdateProcedure, catalogItemDeactivateProcedure, catalogItemLifecycleProcedure } from "../routers/_shared/procedures";
import { APP_ROLE } from "../../shared/roles";
import { REQUIRE_CATALOG_IMAGE_ON_EDIT } from "../../shared/catalog-item-image-policy";
import { catalogItems, attachments, auditLogs, catalogAuditLogs } from "../../drizzle/schema";
import { eq } from "drizzle-orm";
import { catalogItemImageSchema, assertCatalogImageUpload, saveRequiredCatalogImage } from "../routers/catalog/item-image";

vi.mock("../_core/authz/media-access", () => ({ assertMediaMutationAccess: async () => {} }));
vi.mock("../_core/db", () => ({}));
const image = { fileName: "material.png", fileKey: "cmms/uploads/u-9/material.webp", mimeType: "image/png", fileSize: 100 };
const input = { nameAr: "صنف", nameEn: "Item", nodeId: 7, unit: "قطعة", image };
let rows: any[], files: any[], audits: any[], failImage: boolean;
const db: any = {
  select: () => ({ from: (table: any) => ({ where: () => Object.assign(
    Promise.resolve(table === attachments ? files : rows),
    { limit: async () => table === attachments ? files : rows },
  ) }) }),
  insert: (table: any) => ({ values: async (value: any) => {
    if (table === attachments && failImage) throw Error("image persistence failed");
    const target = table === catalogItems ? rows : table === attachments ? files : audits;
    target.push({ id: target.length + 1, ...value }); return [{ insertId: target.length }];
  } }),
  update: () => ({ set: (value: any) => ({ where: async () => Object.assign(rows[0], value) }) }),
  transaction: async (work: any) => {
    const snapshot = structuredClone({ rows, files, audits });
    try { return await work(db); } catch (error) {
      ({ rows, files, audits } = snapshot); throw error;
    }
  },
};
function actualItemProcedure(name: string) {
  const file = "server/routers/catalog/catalog.router.ts";
  const ast = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  let itemScope: ts.Node | undefined;
  function find(node: ts.Node) {
    if (ts.isPropertyAssignment(node) && node.name.getText(ast) === "items" &&
        ts.isCallExpression(node.initializer) && node.initializer.expression.getText(ast) === "router") itemScope = node;
    ts.forEachChild(node, find);
  }
  find(ast); let code = "";
  function property(node: ts.Node) {
    if (ts.isPropertyAssignment(node) && node.name.getText(ast) === name) code = node.initializer.getText(ast);
    ts.forEachChild(node, property);
  }
  property(itemScope!);
  if (!code) throw Error(`Missing catalog items ${name}`);
  return vm.runInNewContext(ts.transpileModule(`(${code})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText,
    { z, TRPCError, catalogProcedure, catalogItemManagerProcedure, catalogItemUpdateProcedure, catalogItemDeactivateProcedure, catalogItemLifecycleProcedure, APP_ROLE, eq, catalogItems, catalogAuditLogs,
      catalogItemImageSchema, assertCatalogImageUpload, saveRequiredCatalogImage, REQUIRE_CATALOG_IMAGE_ON_EDIT, getDb: async () => db,
      assertActiveCatalogMasterUnit: async (_db: any, unit: string) => unit,
      assertActiveCatalogNodePath: async () => {},
      getLeafCategoryCodeState: async () => ({ node: { code: "7" }, code: "7-001" }),
      isCatalogItemCodeForNode: () => true, assertCatalogCodeAvailable: async () => {},
      catalogAuditRequestMeta: () => ({}), catalogAuditJson: (value: any) => value, pickAuditValues: (value: any) => value });
}
const api = router({ catalog: router({ items: router({
  create: actualItemProcedure("create"), update: actualItemProcedure("update"),
  delete: actualItemProcedure("delete"), reactivate: actualItemProcedure("reactivate"),
}) }) });
function caller(role = "admin", id = 9, isActive = 1) {
  const user = { id, role, isActive };
  return api.createCaller({ user, authenticatedUser: user, req: {}, res: {} } as any).catalog.items;
}
beforeEach(() => { rows = []; files = []; audits = []; failImage = false; });

describe("manual catalog item save and image handling", () => {
  it("rejects create without image before any item is persisted", async () => {
    const { image: _, ...without } = input;
    await expect(caller().create(without as any)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(rows).toEqual([]);
  });
  it.each(["admin", "owner", "senior_management", "construction_procurement_manager", "maintenance_manager", "general_maintenance_manager", "warehouse", "it_manager"])("keeps approved create/edit grant for %s", async role => {
    await caller(role).create(input); expect(rows).toHaveLength(1); expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({ entityId: 1, entityType: "catalog_item", uploadedById: 9 });
    await caller(role).update({ id: 1, nameAr: "تعديل" });
    expect(rows[0].nameAr).toBe("تعديل"); expect(files).toHaveLength(1);
  });
  it("IT manager deactivation preserves the item, attachments and audit, and cannot reactivate", async () => {
    await caller("it_manager").create(input);
    await caller("it_manager").delete(1);
    expect(rows).toHaveLength(1); expect(rows[0].isActive).toBe(0); expect(files).toHaveLength(1);
    expect(audits.at(-1)).toMatchObject({ entityType: "item", action: "delete", entityId: 1 });
    await expect(caller("it_manager").reactivate(1)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller("it_manager").update({ id: 1, isActive: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(rows[0].isActive).toBe(0);
  });
  it("senior management creates, edits, deactivates and reactivates an item with images and audit preserved", async () => {
    await caller("senior_management").create(input);
    await caller("senior_management").update({ id: 1, nameAr: "مراجعة الإدارة" });
    expect(rows[0].nameAr).toBe("مراجعة الإدارة");
    await caller("senior_management").delete(1);
    expect(rows).toHaveLength(1); expect(rows[0].isActive).toBe(0); expect(files).toHaveLength(1);
    expect(audits.at(-1)).toMatchObject({ entityType: "item", action: "delete", entityId: 1 });
    await caller("senior_management").reactivate(1);
    expect(Number(rows[0].isActive)).toBe(1);
    expect(audits.at(-1)).toMatchObject({ entityType: "item", action: "update", entityId: 1, oldValues: { isActive: false }, newValues: { isActive: true } });
    await caller("senior_management").delete(1);
    await caller("senior_management").update({ id: 1, isActive: true });
    expect(Number(rows[0].isActive)).toBe(1); expect(files).toHaveLength(1);
    expect(audits.at(-1)).toMatchObject({ entityType: "item", action: "update", entityId: 1 });
  });
  it("adds construction deactivation while preserving its existing edit/create and archived item history", async () => {
    const manager = caller("construction_procurement_manager");
    await manager.create(input);
    await manager.update({ id: 1, nameAr: "تعديل الإنشاءات" });
    await manager.delete(1);
    expect(rows).toHaveLength(1); expect(rows[0].isActive).toBe(0); expect(files).toHaveLength(1);
    expect(audits.at(-1)).toMatchObject({ entityType: "item", action: "delete", entityId: 1 });
    await manager.update({ id: 1, isActive: false });
    await expect(manager.update({ id: 1, isActive: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(manager.reactivate(1)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(Number(rows[0].isActive)).toBe(0);
  });
  it.each(["senior_management", "construction_procurement_manager"])("rechecks %s on each actual update/deactivation and preserves missing-item denials", async role => {
    await caller().create(input);
    const before = structuredClone({ rows, files, audits });
    // Existing construction edits were not changed; its new deactivate grant
    // and every new senior grant require an active actor at the write boundary.
    if (role === "senior_management") await expect(caller(role, 9, 0).update({ id: 1, nameAr: "ممنوع" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller(role, 9, 0).delete(1)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect({ rows, files, audits }).toEqual(before);
    rows = [];
    await expect(caller(role).update({ id: 999, nameAr: "مفقود" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(caller(role).delete(999)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("rechecks current IT identity/activity and missing item at each write", async () => {
    await caller("it_manager").create(input);
    const before = structuredClone({ rows, files, audits });
    for (const current of [caller("it_manager", 9, 0), caller("it_member")]) {
      await expect(current.create(input)).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(current.update({ id: 1, nameAr: "ممنوع" })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(current.delete(1)).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect({ rows, files, audits }).toEqual(before);
    rows = [];
    await expect(caller("it_manager").update({ id: 99, nameAr: "مفقود" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(caller("it_manager").delete(99)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it.each(["delegate", "accountant", "technician", "observer", "gate_security"])("retains denial for %s", async role => {
    await expect(caller(role).create(input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(rows).toEqual([]);
  });
  it("rolls back new item and audit if attachment persistence fails", async () => {
    failImage = true;
    await expect(caller().create(input)).rejects.toThrow("image persistence failed");
    expect(rows).toEqual([]); expect(files).toEqual([]); expect(audits).toEqual([]);
    failImage = false; await caller().create(input); expect(rows).toHaveLength(1);
  });
  it("saves an existing item without an image and attaches an optional image when provided", async () => {
    rows = [{ id: 1, nodeId: 7, nameAr: "الأصل", code: "7-001" }];
    await caller().update({ id: 1, nameAr: "تعديل بدون صورة" });
    expect(rows[0].nameAr).toBe("تعديل بدون صورة");
    expect(files).toHaveLength(0);
    expect(audits.at(-1)).toMatchObject({ action: "update", entityId: 1 });
    await caller().update({ id: 1, nameAr: "محفوظ", image });
    expect(rows[0].nameAr).toBe("محفوظ"); expect(rows[0]).not.toHaveProperty("image");
    expect(files).toHaveLength(1);
  });
  it("preserves an existing PDF when saving an item without an image", async () => {
    rows = [{ id: 1, nodeId: 7 }]; files = [{ fileName: "manual.pdf", mimeType: "application/pdf" }];
    await caller().update({ id: 1, nameAr: "edit" });
    expect(rows[0].nameAr).toBe("edit");
    expect(files).toEqual([{ fileName: "manual.pdf", mimeType: "application/pdf" }]);
  });
  it("accepts historical image with absent mime without rewriting it", async () => {
    rows = [{ id: 1, nodeId: 7 }]; files = [{ fileName: "old.JPG", mimeType: null }];
    await caller().update({ id: 1, nameAr: "edit" }); expect(files).toHaveLength(1);
  });
  it("rejects foreign upload and malformed/non-image inputs", async () => {
    await expect(caller("admin", 10).create(input)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    for (const bad of [{ mimeType: "application/pdf" }, { fileSize: 0 }, { fileKey: "cmms/uploads/u-9/../x.webp" }])
      await expect(caller().create({ ...input, image: { ...image, ...bad } })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(rows).toHaveLength(0);
  });
  it("preserves missing item denial and construction reactivation restriction", async () => {
    await expect(caller().update({ id: 999, image })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(caller("construction_procurement_manager").update({ id: 1, image, isActive: true }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("actual catalog dialog save handler", () => {
  function ui(overrides: any = {}) {
    const file = "client/src/components/catalog/ItemsManager.tsx";
    const ast = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let code = "";
    function visit(node: ts.Node) {
      if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "handleCreate") code = node.initializer!.getText(ast);
      ts.forEachChild(node, visit);
    }
    visit(ast);
    const events: string[] = [];
    const state: any = {
      selectedNode: { id: 7, code: "7" }, catalogNodes: [{ id: 7, code: "7" }],
      formData: { nameAr: "صنف", nameEn: "Item", unit: "piece" }, customCode: "", codeEdited: false,
      editingItem: null, selectedImage: null, codePreviewQuery: {}, REQUIRE_CATALOG_IMAGE_ON_EDIT,
      t: { catalog: { validation: { requiredFields: "required" } } },
      toast: { error: vi.fn(), success: vi.fn() },
      setIsSavingItem: vi.fn(), setImageSaveStage: vi.fn(), setImageUploadProgress: vi.fn(), setImageSaveMessage: vi.fn(),
      uploadCatalogItemImageFile: vi.fn(async () => { events.push("upload"); return { fileKey: image.fileKey }; }),
      createMut: { mutateAsync: vi.fn(async () => { events.push("create"); return 1; }) },
      updateMut: { mutateAsync: vi.fn(async () => { events.push("update"); }) },
      reloadFromStart: vi.fn(), resetForm: vi.fn(), setIsDialogOpen: vi.fn(), ...overrides,
    };
    return { state, events, save: vm.runInNewContext(ts.transpileModule(`(${code})`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText, state) };
  }
  it("blocks creation without an image and saves an existing imageless item without uploading", async () => {
    const create = ui(); await create.save();
    expect(create.state.toast.error).toHaveBeenCalledWith(expect.stringContaining("إلزامية"));
    expect(create.events).toEqual([]);

    const edit = ui({ editingItem: { id: 1 } }); await edit.save();
    expect(edit.events).toEqual(["update"]);
    expect(edit.state.updateMut.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ id: 1, image: undefined }));
    expect(edit.state.setIsDialogOpen).toHaveBeenCalledWith(false);
  });
  it("uploads before creating and passes image in the same item mutation", async () => {
    const u = ui({ selectedImage: { name: "photo.png", type: "image/png", size: 100 } });
    await u.save(); expect(u.events).toEqual(["upload", "create"]);
    expect(u.state.createMut.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ image: expect.objectContaining({ fileKey: image.fileKey }) }));
    expect(u.state.setIsDialogOpen).toHaveBeenCalledWith(false);
  });
  it("upload failure never creates an item or closes the dialog", async () => {
    const u = ui({ selectedImage: { name: "photo.png", type: "image/png", size: 100 },
      uploadCatalogItemImageFile: vi.fn(async () => { throw Error("upload failed"); }) });
    await u.save(); expect(u.state.createMut.mutateAsync).not.toHaveBeenCalled();
    expect(u.state.setIsDialogOpen).not.toHaveBeenCalled();
  });
  it("keeps an existing image when editing metadata", async () => {
    const u = ui({ editingItem: { id: 1, primaryImageUrl: "/api/media?key=old" } });
    await u.save(); expect(u.events).toEqual(["update"]);
  });
});
