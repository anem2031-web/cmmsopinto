import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router, protectedProcedure, managerProcedure } from "../_shared/procedures";
import { translateFields, detectLanguage, type SupportedLanguage } from "../../services/translation";
import { storageRename } from "../../storage";
import { translationCache } from "../../translationEngine";
import * as db from "../../db";

export const assetsRouter = router({
  list: protectedProcedure.input(z.object({
    siteId: z.number().optional(),
    sectionId: z.number().optional(),
    status: z.string().optional(),
    search: z.string().optional(),
  }).optional()).query(async ({ input }) => {
    return db.listAssets(input ?? {});
  }),

  getById: protectedProcedure.input(z.object({ id: z.number() })).query(async ({ input }) => {
    const asset = await db.getAssetById(input.id);
    if (!asset) throw new TRPCError({ code: "NOT_FOUND", message: "الأصل غير موجود" });
    return asset;
  }),

  create: managerProcedure.input(z.object({
    name: z.string().min(1),
    description: z.string().optional(),
    category: z.string().optional(),
    brand: z.string().optional(),
    model: z.string().optional(),
    serialNumber: z.string().optional(),
    siteId: z.number().optional(),
    sectionId: z.number().optional(),
    locationDetail: z.string().optional(),
    status: z.enum(["active", "inactive", "under_maintenance", "disposed"]).optional(),
    purchaseDate: z.string().optional(),
    purchaseCost: z.string().optional(),
    warrantyExpiry: z.string().optional(),
    warrantyNotes: z.string().optional(),
    photoUrl: z.string().optional(),
    notes: z.string().optional(),
    rfidTag: z.string().optional(),
    categoryId: z.number().optional(),
  })).mutation(async ({ input, ctx }) => {
    const assetNumber = await db.generateAssetNumber();
    // Auto-translate description and notes
    let assetTranslation: Record<string, any> = {};
    const fieldsToTranslate: Record<string, string> = {};
    if (input.description) fieldsToTranslate.description = input.description;
    if (input.notes) fieldsToTranslate.notes = input.notes;
    if (Object.keys(fieldsToTranslate).length > 0) {
      try {
        const lang = await detectLanguage(Object.values(fieldsToTranslate)[0]);
        const translations = await translateFields(fieldsToTranslate, lang);
        if (translations.description) {
          assetTranslation.description_ar = translations.description.ar;
          assetTranslation.description_en = translations.description.en;
          assetTranslation.description_ur = translations.description.ur;
        }
        if (translations.notes) {
          assetTranslation.notes_ar = translations.notes.ar;
          assetTranslation.notes_en = translations.notes.en;
          assetTranslation.notes_ur = translations.notes.ur;
        }
        assetTranslation.originalLanguage = lang;
      } catch (e) {
        console.error("[Asset] Translation failed:", e);
      }
    }
    const result = await db.createAsset({
      ...input,
      ...assetTranslation,
      assetNumber,
      purchaseDate: input.purchaseDate ? new Date(input.purchaseDate) : undefined,
      warrantyExpiry: input.warrantyExpiry ? new Date(input.warrantyExpiry) : undefined,
      status: input.status ?? "active",
      createdById: ctx.user.id,
    });
    // ── إعادة تسمية صورة الأصل بقيمة RFID إذا توفر كلاهما ──────────────
    if (result && input.rfidTag && input.photoUrl) {
      try {
        const oldKey = input.photoUrl.includes("/api/media?key=")
          ? decodeURIComponent(input.photoUrl.split("key=")[1])
          : input.photoUrl.replace(/^.*\/cmms\//, "cmms/");
        const safeRfid = input.rfidTag.replace(/[^a-zA-Z0-9_\-]/g, "_");
        const newKey = `cmms/assets/${safeRfid}.webp`;
        if (oldKey !== newKey) {
          const { url: newUrl } = await storageRename(oldKey, newKey);
          const proxyUrl = `/api/media?key=${encodeURIComponent(newKey)}`;
          await db.updateAsset(result.id, { photoUrl: proxyUrl });
          (result as any).photoUrl = proxyUrl;
        }
      } catch (e) {
        console.error("[Asset] RFID photo rename failed (create):", e);
      }
    }
    return result;
  }),

  update: managerProcedure.input(z.object({
    id: z.number(),
    name: z.string().optional(),
    description: z.string().optional(),
    category: z.string().optional(),
    brand: z.string().optional(),
    model: z.string().optional(),
    serialNumber: z.string().optional(),
    siteId: z.number().optional(),
    sectionId: z.number().optional(),
    locationDetail: z.string().optional(),
    status: z.enum(["active", "inactive", "under_maintenance", "disposed"]).optional(),
    purchaseDate: z.string().optional(),
    purchaseCost: z.string().optional(),
    warrantyExpiry: z.string().optional(),
    warrantyNotes: z.string().optional(),
    photoUrl: z.string().optional(),
    notes: z.string().optional(),
    rfidTag: z.string().optional(),
    categoryId: z.number().optional(),
  })).mutation(async ({ input }) => {
    const { id, ...data } = input;
    // Auto-translate updated text fields to all 3 languages
    let assetTranslation: Record<string, any> = {};
    const assetFieldsToTranslate: Record<string, string> = {};
    if (data.description) assetFieldsToTranslate.description = data.description;
    if (data.notes) assetFieldsToTranslate.notes = data.notes;
    if (Object.keys(assetFieldsToTranslate).length > 0) {
      try {
        const textForDetection = Object.values(assetFieldsToTranslate)[0];
        const detectedLang = await detectLanguage(textForDetection) as SupportedLanguage;
        const translations = await translateFields(assetFieldsToTranslate, detectedLang);
        if (translations.description) {
          assetTranslation.description_ar = translations.description.ar;
          assetTranslation.description_en = translations.description.en;
          assetTranslation.description_ur = translations.description.ur;
        }
        if (translations.notes) {
          assetTranslation.notes_ar = translations.notes.ar;
          assetTranslation.notes_en = translations.notes.en;
          assetTranslation.notes_ur = translations.notes.ur;
        }
      } catch (e) {
        console.error("[Asset] Update translation failed:", e);
      }
    }
    // ── إعادة تسمية صورة الأصل بقيمة RFID عند التعديل ─────────────────────
    let finalPhotoUrl = data.photoUrl;
    const effectiveRfid = data.rfidTag;
    if (effectiveRfid && data.photoUrl) {
      // صورة جديدة + RFID: إعادة تسمية الصورة المرفوعة
      try {
        const oldKey = data.photoUrl.includes("/api/media?key=")
          ? decodeURIComponent(data.photoUrl.split("key=")[1])
          : data.photoUrl.replace(/^.*\/cmms\//, "cmms/");
        const safeRfid = effectiveRfid.replace(/[^a-zA-Z0-9_\-]/g, "_");
        const newKey = `cmms/assets/${safeRfid}.webp`;
        if (!oldKey.endsWith(`${safeRfid}.webp`)) {
          await storageRename(oldKey, newKey);
          finalPhotoUrl = `/api/media?key=${encodeURIComponent(newKey)}`;
        }
      } catch (e) {
        console.error("[Asset] RFID photo rename failed (update+photo):", e);
      }
    } else if (effectiveRfid && !data.photoUrl) {
      // تغيير RFID فقط: إعادة تسمية الصورة الموجودة في قاعدة البيانات
      try {
        const existing = await db.getAssetById(id);
        if (existing?.photoUrl) {
          const oldKey = existing.photoUrl.includes("/api/media?key=")
            ? decodeURIComponent(existing.photoUrl.split("key=")[1])
            : existing.photoUrl.replace(/^.*\/cmms\//, "cmms/");
          const safeRfid = effectiveRfid.replace(/[^a-zA-Z0-9_\-]/g, "_");
          const newKey = `cmms/assets/${safeRfid}.webp`;
          if (!oldKey.endsWith(`${safeRfid}.webp`)) {
            await storageRename(oldKey, newKey);
            finalPhotoUrl = `/api/media?key=${encodeURIComponent(newKey)}`;
          }
        }
      } catch (e) {
        console.error("[Asset] RFID rename on rfid-change failed:", e);
      }
    }
const updateResult = await db.updateAsset(id, {
  ...data,
  ...assetTranslation,
  photoUrl: finalPhotoUrl,
  purchaseDate: data.purchaseDate ? new Date(data.purchaseDate) : undefined,
  warrantyExpiry: data.warrantyExpiry ? new Date(data.warrantyExpiry) : undefined,
});

if (Object.keys(assetTranslation).length > 0) {
  translationCache.invalidate("ASSET", id);
}

return updateResult;
  }),

  delete: managerProcedure.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
    return db.deleteAsset(input.id);
  }),

  getByRfid: protectedProcedure.input(z.object({
    rfidTag: z.string().min(1),
  })).query(async ({ input }) => {
    const asset = await db.getAssetByRfidTag(input.rfidTag);
    if (!asset) throw new TRPCError({ code: "NOT_FOUND", message: "الأصل بهذا الـ RFID غير موجود" });
    return asset;
  }),

  updateRfid: managerProcedure.input(z.object({
    id: z.number(),
    rfidTag: z.string().min(1),
  })).mutation(async ({ input }) => {
    return db.updateAssetRfidTag(input.id, input.rfidTag);
  }),

  linkRfidTag: protectedProcedure.input(z.object({
    assetId: z.number(),
    rfidTag: z.string().min(1),
  })).mutation(async ({ input }) => {
    const asset = await db.getAssetById(input.assetId);
    if (!asset) throw new TRPCError({ code: "NOT_FOUND", message: "الأصل غير موجود" });
    return db.updateAssetRfidTag(input.assetId, input.rfidTag);
  }),

  getMaintenanceHistory: protectedProcedure.input(z.object({
    id: z.number(),
  })).query(async ({ input }) => {
    const asset = await db.getAssetById(input.id);
    if (!asset) throw new TRPCError({ code: "NOT_FOUND", message: "الأصل غير موجود" });
    return db.getAssetMaintenanceHistory(input.id);
  }),

  getMaintenanceStats: protectedProcedure.input(z.object({
    id: z.number(),
  })).query(async ({ input }) => {
    const asset = await db.getAssetById(input.id);
    if (!asset) throw new TRPCError({ code: "NOT_FOUND", message: "الأصل غير موجود" });
    return db.getAssetMaintenanceStats(input.id);
  }),

  addSparePart: managerProcedure.input(z.object({
    assetId: z.number(),
    inventoryItemId: z.number(),
    minStockLevel: z.number().optional(),
    preferredQuantity: z.number().optional(),
    notes: z.string().optional(),
  })).mutation(async ({ input }) => {
    return db.addAssetSparePart(input);
  }),

  getSpareParts: protectedProcedure.input(z.object({
    assetId: z.number(),
  })).query(async ({ input }) => {
    return db.getAssetSpareParts(input.assetId);
  }),

  removeSparePart: managerProcedure.input(z.object({
    id: z.number(),
  })).mutation(async ({ input }) => {
    return db.removeAssetSparePart(input.id);
  }),

  getMetrics: protectedProcedure.input(z.object({
    assetId: z.number(),
  })).query(async ({ input }) => {
    return db.getAssetMetricsById(input.assetId);
  }),

  calculateMetrics: managerProcedure.input(z.object({
    assetId: z.number(),
  })).mutation(async ({ input }) => {
    return db.calculateAssetMetrics(input.assetId);
  }),

  getAllMetrics: protectedProcedure.query(async () => {
    return db.getAllAssetMetrics();
  }),

  getLowStockAlerts: managerProcedure.query(async () => {
    return db.getInventoryAlerts();
  }),

  getAssetSparePartsWithLowStock: protectedProcedure.input(z.object({
    assetId: z.number(),
  })).query(async ({ input }) => {
    return db.getAssetSparePartsWithLowStock(input.assetId);
  }),
});
