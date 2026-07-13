/**
 * ============================================================
 * CMMS Central Translation Engine
 * ============================================================
 * Enterprise-level translation engine with:
 * - Async Translation Job Queue with retry mechanism
 * - LLM-powered translation (Arabic, English, Urdu)
 * - Smart Re-Translation (only changed fields)
 * - Manual Override protection (approved translations preserved)
 * - Fallback Logic (original text when translation fails)
 * - In-memory cache with TTL
 * - Version tracking for all changes
 * - Audit logging for all operations
 * ============================================================
 */

import { eq, and, desc, sql, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  entityTranslations, translationJobs, translationVersions,
  type SupportedLanguage, supportedLanguages, auditLogs,
  tickets, assets, pmWorkOrders, purchaseOrderItems,
  preventivePlans, pmExecutionResults, pmExecutionSessions, pmChecklistItems,
} from "../../../drizzle/schema";
import { invokeLLM } from "../../_core/llm";
import { getDb } from "../../_core/db";
import crypto from "crypto";

// ============================================================
// TYPES
// ============================================================
export interface TranslatableField {
  fieldName: string;
  text: string;
}

export interface TranslationRequest {
  entityType: string;
  entityId: number;
  fields: TranslatableField[];
  sourceLanguage: SupportedLanguage;
  targetLanguages?: SupportedLanguage[];
  userId?: number;
}

export interface TranslationResult {
  entityType: string;
  entityId: number;
  fieldName: string;
  languageCode: SupportedLanguage;
  translatedText: string | null;
  status: string;
  versionNumber: number;
}

// Entity field mapping - defines which fields are translatable for each entity type
export const ENTITY_FIELD_MAP: Record<string, string[]> = {
  // tickets table: title_ar/en/ur, description_ar/en/ur, repairNotes_ar/en/ur موجودة في الـ schema
  TICKET: ["title", "description", "repairNotes"],
  // purchaseOrders table: لا أعمدة ترجمة مباشرة - يُخزَّن في entity_translations فقط
  PO: ["notes", "accountingNotes", "managementNotes", "rejectionReason"],
  // purchaseOrderItems: specifications غير موجود في الـ schema
  PO_ITEM: ["itemName", "description", "notes"],
  // inventory: لا أعمدة ترجمة في الـ schema حالياً - يُخزَّن في entity_translations فقط
  INVENTORY: ["itemName", "description"],
  // sites: name فقط - address وdescription غير مترجمَين في الـ schema
  SITE: ["name"],
  // notifications: لا أعمدة ترجمة في الـ schema حالياً
  NOTIFICATION: ["title", "message"],
  PM_PLAN: ["title", "description"],
  PM_WORK_ORDER: ["title", "technicianNotes"],
  PM_RESULT: ["fixNotes"],
  PM_SESSION: ["generalNotes"],
  PM_CHECKLIST: ["text"],
};

// ============================================================
// CACHE (In-memory with TTL)
// ============================================================
interface CacheEntry {
  value: string;
  expiresAt: number;
}

class TranslationCache {
  private cache = new Map<string, CacheEntry>();
  private readonly TTL = 30 * 60 * 1000; // 30 minutes

  private key(entityType: string, entityId: number, fieldName: string, lang: SupportedLanguage): string {
    return `${entityType}:${entityId}:${fieldName}:${lang}`;
  }

  get(entityType: string, entityId: number, fieldName: string, lang: SupportedLanguage): string | null {
    const k = this.key(entityType, entityId, fieldName, lang);
    const entry = this.cache.get(k);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(k);
      return null;
    }
    return entry.value;
  }

  set(entityType: string, entityId: number, fieldName: string, lang: SupportedLanguage, value: string): void {
    const k = this.key(entityType, entityId, fieldName, lang);
    this.cache.set(k, { value, expiresAt: Date.now() + this.TTL });
  }

  invalidate(entityType: string, entityId: number, fieldName?: string): void {
    const prefix = fieldName
      ? `${entityType}:${entityId}:${fieldName}:`
      : `${entityType}:${entityId}:`;
    const keys = Array.from(this.cache.keys());
    for (const k of keys) {
      if (k.startsWith(prefix)) this.cache.delete(k);
    }
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }
}

export const translationCache = new TranslationCache();

// ============================================================
// TEXT HASH (for Smart Re-Translation)
// ============================================================
function textHash(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex").slice(0, 16);
}

// ============================================================
// LLM TRANSLATION
// ============================================================
const LANGUAGE_NAMES: Record<SupportedLanguage, string> = {
  ar: "Arabic",
  en: "English",
  ur: "Urdu",
};

async function translateWithLLM(
  sourceText: string,
  sourceLang: SupportedLanguage,
  targetLang: SupportedLanguage,
  context?: string
): Promise<string> {
  const systemPrompt = `You are a professional translator for a maintenance management system (CMMS). 
Translate the following text from ${LANGUAGE_NAMES[sourceLang]} to ${LANGUAGE_NAMES[targetLang]}.
Rules:
- Maintain technical terminology accuracy
- Preserve any numbers, codes, or references (like MT-2026-00001)
- Keep proper nouns unchanged
- Use formal/professional tone
- Return ONLY the translated text, no explanations
${context ? `Context: ${context}` : ""}`;

  try {
    const result = await invokeLLM({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: sourceText },
      ],
    });

    const translated = result.choices?.[0]?.message?.content;
    if (typeof translated === "string") return translated.trim();
    if (Array.isArray(translated)) {
      const textPart = translated.find((p: any) => p.type === "text");
      if (textPart && "text" in textPart) return (textPart as any).text.trim();
    }
    throw new Error("No translation content in LLM response");
  } catch (error: any) {

    throw error;
  }
}

// ============================================================
// CORE ENGINE FUNCTIONS
// ============================================================

/**
 * Queue translation jobs for an entity (async, non-blocking)
 * Creates pending jobs and translation records
 */
export async function queueTranslation(request: TranslationRequest): Promise<number[]> {
  const db = await getDb();
  if (!db) {
    console.error("[TranslationEngine] Failed to get database connection for queueTranslation. Job aborted.");
    return [];
  }

  const targetLangs = request.targetLanguages ||
    supportedLanguages.filter(l => l !== request.sourceLanguage);

  const jobIds: number[] = [];

  for (const field of request.fields) {
    if (!field.text || field.text.trim() === "") continue;

    const hash = textHash(field.text);

    for (const targetLang of targetLangs) {
      // Check if approved translation exists (Manual Override protection)
      const existing = await db.select().from(entityTranslations).where(
        and(
          eq(entityTranslations.entityType, request.entityType),
          eq(entityTranslations.entityId, request.entityId),
          eq(entityTranslations.fieldName, field.fieldName),
          eq(entityTranslations.languageCode, targetLang)
        )
      ).limit(1);

      if (existing[0]?.translationStatus === "approved") {
        // Skip approved translations - Manual Override protection
        continue;
      }

      // Smart Re-Translation: check if text actually changed
      const existingJob = await db.select().from(translationJobs).where(
        and(
          eq(translationJobs.entityType, request.entityType),
          eq(translationJobs.entityId, request.entityId),
          eq(translationJobs.fieldName, field.fieldName),
          eq(translationJobs.targetLanguage, targetLang),
          eq(translationJobs.previousTextHash, hash),
          eq(translationJobs.status, "completed")
        )
      ).limit(1);

      if (existingJob[0]) {
        // Text hasn't changed, skip re-translation
        continue;
      }

      // Create translation job
      const [jobResult] = await db.insert(translationJobs).values({
        entityType: request.entityType,
        entityId: request.entityId,
        fieldName: field.fieldName,
        sourceLanguage: request.sourceLanguage,
        targetLanguage: targetLang,
        sourceText: field.text,
        status: "pending",
        previousTextHash: hash,
      });

      const jobId = jobResult.insertId;
      jobIds.push(jobId);

      // Create or update entity_translations record
      if (existing[0]) {
        await db.update(entityTranslations).set({
          translationStatus: "pending",
          translationJobId: jobId,
          errorMessage: null,
        }).where(eq(entityTranslations.id, existing[0].id));
      } else {
        await db.insert(entityTranslations).values({
          entityType: request.entityType,
          entityId: request.entityId,
          fieldName: field.fieldName,
          languageCode: targetLang,
          translationStatus: "pending",
          translationJobId: jobId,
          versionNumber: 1,
        });
      }
    }
  }

  // Process jobs asynchronously (fire and forget)
  if (jobIds.length > 0) {
    processTranslationJobs(jobIds).catch(err =>
      console.error("[TranslationEngine] Background job processing error for jobIds:", jobIds, err)
    );
  }

  return jobIds;
}

/**
 * كتابة الترجمة في الأعمدة المباشرة بعد اكتمال الـ Engine
 * حتى تظهر الترجمة في القوائم والبحث والتقارير
 */
async function writeBackToDirectColumn(
  db: any,
  entityType: string,
  entityId: number,
  fieldName: string,
  language: SupportedLanguage,
  translatedText: string
): Promise<void> {
  try {
    const columnName = `${fieldName}_${language}`;

    if (entityType === "TICKET") {
      const validColumns = [
        "title_ar", "title_en", "title_ur",
        "description_ar", "description_en", "description_ur",
        "repairNotes_ar", "repairNotes_en", "repairNotes_ur",
      ];
      if (!validColumns.includes(columnName)) return;
      await db.update(tickets)
        .set({ [columnName]: translatedText })
        .where(eq(tickets.id, entityId));

    } else if (entityType === "ASSET") {
      const validColumns = [
        "description_ar", "description_en", "description_ur",
        "notes_ar", "notes_en", "notes_ur",
      ];
      if (!validColumns.includes(columnName)) return;
      await db.update(assets)
        .set({ [columnName]: translatedText })
        .where(eq(assets.id, entityId));

    } else if (entityType === "WORK_ORDER") {
      const validColumns = [
        "technicianNotes_ar", "technicianNotes_en", "technicianNotes_ur",
      ];
      if (!validColumns.includes(columnName)) return;
      await db.update(pmWorkOrders)
        .set({ [columnName]: translatedText })
        .where(eq(pmWorkOrders.id, entityId));

    } else if (entityType === "PO_ITEM") {
      const validColumns = [
        "itemName_ar", "itemName_en", "itemName_ur",
        "description_ar", "description_en", "description_ur",
        "notes_ar", "notes_en", "notes_ur",
      ];
      if (!validColumns.includes(columnName)) return;
      await db.update(purchaseOrderItems)
        .set({ [columnName]: translatedText })
        .where(eq(purchaseOrderItems.id, entityId));

    } else if (entityType === "PM_PLAN") {
      const validColumns = [
        "title_ar", "title_en", "title_ur",
        "description_ar", "description_en", "description_ur",
      ];
      if (!validColumns.includes(columnName)) return;
      await db.update(preventivePlans)
        .set({ [columnName]: translatedText })
        .where(eq(preventivePlans.id, entityId));

    } else if (entityType === "PM_WORK_ORDER") {
      const validColumns = [
        "title_ar", "title_en", "title_ur",
        "technicianNotes_ar", "technicianNotes_en", "technicianNotes_ur",
      ];
      if (!validColumns.includes(columnName)) return;
      await db.update(pmWorkOrders)
        .set({ [columnName]: translatedText })
        .where(eq(pmWorkOrders.id, entityId));

    } else if (entityType === "PM_RESULT") {
      const validColumns = [
        "fixNotes_ar", "fixNotes_en", "fixNotes_ur",
      ];
      if (!validColumns.includes(columnName)) return;
      await db.update(pmExecutionResults)
        .set({ [columnName]: translatedText })
        .where(eq(pmExecutionResults.id, entityId));

    } else if (entityType === "PM_SESSION") {
      const validColumns = [
        "generalNotes_ar", "generalNotes_en", "generalNotes_ur",
      ];
      if (!validColumns.includes(columnName)) return;
      await db.update(pmExecutionSessions)
        .set({ [columnName]: translatedText })
        .where(eq(pmExecutionSessions.id, entityId));

    } else if (entityType === "PM_CHECKLIST") {
      const validColumns = ["text_ar", "text_en", "text_ur"];
      if (!validColumns.includes(columnName)) return;
      await db.update(pmChecklistItems)
        .set({ [columnName]: translatedText })
        .where(eq(pmChecklistItems.id, entityId));
    }
  } catch (e) {
    // لا نوقف العملية إذا فشل الـ write-back
    console.error(`[TranslationEngine] Write-back failed for ${entityType}.${fieldName}_${language}:`, e);
  }
}

/**
 * Process translation jobs (called asynchronously)
 */
async function processTranslationJobs(jobIds: number[]): Promise<void> {
  const db = await getDb();
  if (!db) {
    console.error("[TranslationEngine] Failed to get database connection for processTranslationJobs. Job aborted.");
    return;
  }

  for (const jobId of jobIds) {
    try {
      // Get job
      const [job] = await db.select().from(translationJobs).where(eq(translationJobs.id, jobId)).limit(1);
      if (!job || job.status !== "pending") continue;

      // Mark as processing
      await db.update(translationJobs).set({ status: "processing" }).where(eq(translationJobs.id, jobId));

      // Translate
      const translated = await translateWithLLM(
        job.sourceText,
        job.sourceLanguage as SupportedLanguage,
        job.targetLanguage as SupportedLanguage,
        `Entity: ${job.entityType}, Field: ${job.fieldName}`
      );

      // Update job as completed
      await db.update(translationJobs).set({
        status: "completed",
        translatedText: translated,
        completedAt: new Date(),
      }).where(eq(translationJobs.id, jobId));

      // Update entity_translations
      const [etRecord] = await db.select().from(entityTranslations).where(
        and(
          eq(entityTranslations.entityType, job.entityType),
          eq(entityTranslations.entityId, job.entityId),
          eq(entityTranslations.fieldName, job.fieldName),
          eq(entityTranslations.languageCode, job.targetLanguage)
        )
      ).limit(1);

      if (etRecord) {
        const newVersion = etRecord.versionNumber + 1;
        // Save version history
        await db.insert(translationVersions).values({
          entityTranslationId: etRecord.id,
          versionNumber: newVersion,
          translatedText: translated,
          translationStatus: "completed",
          changeReason: "auto_translate",
        });

        await db.update(entityTranslations).set({
          translatedText: translated,
          translationStatus: "completed",
          versionNumber: newVersion,
          lastAttemptAt: new Date(),
          errorMessage: null,
          translationJobId: jobId,
        }).where(eq(entityTranslations.id, etRecord.id));

        // Update cache
        translationCache.set(
          job.entityType, job.entityId, job.fieldName,
          job.targetLanguage as SupportedLanguage, translated
        );

        // كتابة الترجمة في الأعمدة المباشرة أيضاً حتى تظهر في القوائم والبحث
        await writeBackToDirectColumn(
          db, job.entityType, job.entityId,
          job.fieldName, job.targetLanguage as SupportedLanguage, translated
        );
      }

    } catch (error: any) {
      // Handle failure with retry
      const [job] = await db.select().from(translationJobs).where(eq(translationJobs.id, jobId)).limit(1);
      if (!job) continue;

      const newRetryCount = job.retryCount + 1;
      const isFinalFailure = newRetryCount >= job.maxRetries;

      await db.update(translationJobs).set({
        status: isFinalFailure ? "failed" : "pending",
        retryCount: newRetryCount,
        errorMessage: error.message?.slice(0, 500),
      }).where(eq(translationJobs.id, jobId));

      // Update entity_translations status
      await db.update(entityTranslations).set({
        translationStatus: isFinalFailure ? "failed" : "pending",
        lastAttemptAt: new Date(),
        errorMessage: error.message?.slice(0, 500),
      }).where(
        and(
          eq(entityTranslations.entityType, job.entityType),
          eq(entityTranslations.entityId, job.entityId),
          eq(entityTranslations.fieldName, job.fieldName),
          eq(entityTranslations.languageCode, job.targetLanguage)
        )
      );

      // Retry pending jobs after a delay
      if (!isFinalFailure) {
        setTimeout(() => {
          processTranslationJobs([jobId]).catch(console.error);
        }, 5000 * newRetryCount); // Exponential backoff
      }
    }
  }
}

/**
 * Get translations for an entity (with cache + fallback)
 */
export async function getEntityTranslations(
  entityType: string,
  entityId: number,
  languageCode: SupportedLanguage,
  fieldNames?: string[]
): Promise<Record<string, { text: string | null; status: string; isOriginal: boolean }>> {
  const db = await getDb();
  const result: Record<string, { text: string | null; status: string; isOriginal: boolean }> = {};

  if (!db) return result;

  const fields = fieldNames || ENTITY_FIELD_MAP[entityType] || [];

  for (const fieldName of fields) {
    // Check cache first
    const cached = translationCache.get(entityType, entityId, fieldName, languageCode);
    if (cached) {
      result[fieldName] = { text: cached, status: "completed", isOriginal: false };
      continue;
    }

    // Query DB
    const [record] = await db.select().from(entityTranslations).where(
      and(
        eq(entityTranslations.entityType, entityType),
        eq(entityTranslations.entityId, entityId),
        eq(entityTranslations.fieldName, fieldName),
        eq(entityTranslations.languageCode, languageCode)
      )
    ).limit(1);

    if (record?.translatedText && (record.translationStatus === "completed" || record.translationStatus === "approved")) {
      // Cache it
      translationCache.set(entityType, entityId, fieldName, languageCode, record.translatedText);
      result[fieldName] = {
        text: record.translatedText,
        status: record.translationStatus,
        isOriginal: false,
      };
    } else {
      // Fallback: return null (frontend will show original text)
      result[fieldName] = {
        text: null,
        status: record?.translationStatus || "not_found",
        isOriginal: true,
      };
    }
  }

  return result;
}

/**
 * Get translations for multiple entities at once (batch)
 */
export async function getBatchTranslations(
  entityType: string,
  entityIds: number[],
  languageCode: SupportedLanguage,
  fieldNames?: string[]
): Promise<Record<number, Record<string, { text: string | null; status: string; isOriginal: boolean }>>> {
  const db = await getDb();
  const result: Record<number, Record<string, { text: string | null; status: string; isOriginal: boolean }>> = {};

  if (!db || entityIds.length === 0) return result;

  // Initialize all entities
  for (const id of entityIds) {
    result[id] = {};
  }

  // Batch query all translations
  const records = await db.select().from(entityTranslations).where(
    and(
      eq(entityTranslations.entityType, entityType),
      inArray(entityTranslations.entityId, entityIds),
      eq(entityTranslations.languageCode, languageCode)
    )
  );

  const fields = fieldNames || ENTITY_FIELD_MAP[entityType] || [];

  // Index records
  const recordMap = new Map<string, typeof records[0]>();
  for (const r of records) {
    recordMap.set(`${r.entityId}:${r.fieldName}`, r);
  }

  for (const id of entityIds) {
    for (const fieldName of fields) {
      const cached = translationCache.get(entityType, id, fieldName, languageCode);
      if (cached) {
        result[id][fieldName] = { text: cached, status: "completed", isOriginal: false };
        continue;
      }

      const record = recordMap.get(`${id}:${fieldName}`);
      if (record?.translatedText && (record.translationStatus === "completed" || record.translationStatus === "approved")) {
        translationCache.set(entityType, id, fieldName, languageCode, record.translatedText);
        result[id][fieldName] = { text: record.translatedText, status: record.translationStatus, isOriginal: false };
      } else {
        result[id][fieldName] = { text: null, status: record?.translationStatus || "not_found", isOriginal: true };
      }
    }
  }

  return result;
}

/**
 * Manual Override - update translation manually (marks as "approved")
 */
export async function manualOverrideTranslation(
  entityType: string,
  entityId: number,
  fieldName: string,
  languageCode: SupportedLanguage,
  translatedText: string,
  userId: number
): Promise<void> {
  const db = await getDb();
  if (!db) {
    console.error("[TranslationEngine] Failed to get database connection for processTranslationJobs. Job aborted.");
    return;
  }

  const [existing] = await db.select().from(entityTranslations).where(
    and(
      eq(entityTranslations.entityType, entityType),
      eq(entityTranslations.entityId, entityId),
      eq(entityTranslations.fieldName, fieldName),
      eq(entityTranslations.languageCode, languageCode)
    )
  ).limit(1);

  if (existing) {
    const newVersion = existing.versionNumber + 1;

    // Save version history
    await db.insert(translationVersions).values({
      entityTranslationId: existing.id,
      versionNumber: newVersion,
      translatedText,
      translationStatus: "approved",
      changedById: userId,
      changeReason: "manual_edit",
    });

    await db.update(entityTranslations).set({
      translatedText,
      translationStatus: "approved",
      versionNumber: newVersion,
      approvedById: userId,
      approvedAt: new Date(),
      errorMessage: null,
    }).where(eq(entityTranslations.id, existing.id));
  } else {
    const [insertResult] = await db.insert(entityTranslations).values({
      entityType,
      entityId,
      fieldName,
      languageCode,
      translatedText,
      translationStatus: "approved",
      versionNumber: 1,
      approvedById: userId,
      approvedAt: new Date(),
    });

    // Save version history
    await db.insert(translationVersions).values({
      entityTranslationId: insertResult.insertId,
      versionNumber: 1,
      translatedText,
      translationStatus: "approved",
      changedById: userId,
      changeReason: "manual_edit",
    });
  }

  // Update cache
  translationCache.set(entityType, entityId, fieldName, languageCode, translatedText);

  // Audit log
  await db.insert(auditLogs).values({
    userId,
    action: "manual_translation_override",
    entityType: "TRANSLATION",
    entityId,
    newValues: JSON.stringify({ entityType, fieldName, languageCode, translatedText }),
  });
}

/**
 * Get translation version history
 */
export async function getTranslationVersions(
  entityType: string,
  entityId: number,
  fieldName: string,
  languageCode: SupportedLanguage
) {
  const db = await getDb();
  if (!db) {
    console.error("[TranslationEngine] Failed to get database connection for queueTranslation. Job aborted.");
    return [];
  }

  const [etRecord] = await db.select().from(entityTranslations).where(
    and(
      eq(entityTranslations.entityType, entityType),
      eq(entityTranslations.entityId, entityId),
      eq(entityTranslations.fieldName, fieldName),
      eq(entityTranslations.languageCode, languageCode)
    )
  ).limit(1);

  if (!etRecord) return [];

  return db.select().from(translationVersions)
    .where(eq(translationVersions.entityTranslationId, etRecord.id))
    .orderBy(desc(translationVersions.versionNumber));
}

/**
 * Retry failed translation jobs
 */
export async function retryFailedJobs(entityType?: string): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  const conditions: any[] = [eq(translationJobs.status, "failed")];
  if (entityType) conditions.push(eq(translationJobs.entityType, entityType));

  const failedJobs = await db.select().from(translationJobs).where(and(...conditions));

  const jobIds: number[] = [];
  for (const job of failedJobs) {
    await db.update(translationJobs).set({
      status: "pending",
      retryCount: 0,
      errorMessage: null,
    }).where(eq(translationJobs.id, job.id));

    // Reset entity_translations status
    await db.update(entityTranslations).set({
      translationStatus: "pending",
      errorMessage: null,
    }).where(
      and(
        eq(entityTranslations.entityType, job.entityType),
        eq(entityTranslations.entityId, job.entityId),
        eq(entityTranslations.fieldName, job.fieldName),
        eq(entityTranslations.languageCode, job.targetLanguage)
      )
    );

    jobIds.push(job.id);
  }

  // Process retried jobs
  if (jobIds.length > 0) {
    processTranslationJobs(jobIds).catch(console.error);
  }

  return jobIds.length;
}

/**
 * Get translation statistics for monitoring
 */
export async function getTranslationStats() {
  const db = await getDb();
  if (!db) return null;

  const [total] = await db.select({ cnt: sql<number>`count(*)` }).from(entityTranslations);
  const [pending] = await db.select({ cnt: sql<number>`count(*)` }).from(entityTranslations)
    .where(eq(entityTranslations.translationStatus, "pending"));
  const [processing] = await db.select({ cnt: sql<number>`count(*)` }).from(entityTranslations)
    .where(eq(entityTranslations.translationStatus, "processing"));
  const [completed] = await db.select({ cnt: sql<number>`count(*)` }).from(entityTranslations)
    .where(eq(entityTranslations.translationStatus, "completed"));
  const [failed] = await db.select({ cnt: sql<number>`count(*)` }).from(entityTranslations)
    .where(eq(entityTranslations.translationStatus, "failed"));
  const [approved] = await db.select({ cnt: sql<number>`count(*)` }).from(entityTranslations)
    .where(eq(entityTranslations.translationStatus, "approved"));

  const [jobsPending] = await db.select({ cnt: sql<number>`count(*)` }).from(translationJobs)
    .where(eq(translationJobs.status, "pending"));
  const [jobsProcessing] = await db.select({ cnt: sql<number>`count(*)` }).from(translationJobs)
    .where(eq(translationJobs.status, "processing"));
  const [jobsFailed] = await db.select({ cnt: sql<number>`count(*)` }).from(translationJobs)
    .where(eq(translationJobs.status, "failed"));

  // By entity type
  const byEntity = await db.select({
    entityType: entityTranslations.entityType,
    cnt: sql<number>`count(*)`,
  }).from(entityTranslations).groupBy(entityTranslations.entityType);

  // By language
  const byLanguage = await db.select({
    languageCode: entityTranslations.languageCode,
    cnt: sql<number>`count(*)`,
  }).from(entityTranslations).groupBy(entityTranslations.languageCode);

  return {
    translations: {
      total: total?.cnt || 0,
      pending: pending?.cnt || 0,
      processing: processing?.cnt || 0,
      completed: completed?.cnt || 0,
      failed: failed?.cnt || 0,
      approved: approved?.cnt || 0,
    },
    jobs: {
      pending: jobsPending?.cnt || 0,
      processing: jobsProcessing?.cnt || 0,
      failed: jobsFailed?.cnt || 0,
    },
    byEntity: byEntity.map(e => ({ entityType: e.entityType, count: e.cnt })),
    byLanguage: byLanguage.map(l => ({ languageCode: l.languageCode, count: l.cnt })),
    cacheSize: translationCache.size,
  };
}

/**
 * Get failed/pending translations for admin monitoring
 */
export async function getTranslationJobsList(filters?: {
  status?: string;
  entityType?: string;
  limit?: number;
}) {
  const db = await getDb();
  if (!db) {
    console.error("[TranslationEngine] Failed to get database connection for queueTranslation. Job aborted.");
    return [];
  }

  const conditions: any[] = [];
  if (filters?.status) conditions.push(eq(translationJobs.status, filters.status as any));
  if (filters?.entityType) conditions.push(eq(translationJobs.entityType, filters.entityType));

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  return db.select().from(translationJobs)
    .where(where)
    .orderBy(desc(translationJobs.createdAt))
    .limit(filters?.limit || 100);
}

/**
 * Update user preferred language
 */
export async function updateUserLanguage(userId: number, language: SupportedLanguage) {
  const db = await getDb();
  if (!db) {
    console.error("[TranslationEngine] Failed to get database connection for processTranslationJobs. Job aborted.");
    return;
  }
  const { users } = await import("../../../drizzle/schema");
  await db.update(users).set({ preferredLanguage: language }).where(eq(users.id, userId));
}

/**
 * استعادة الـ jobs المعلقة عند بدء تشغيل السيرفر
 */
export async function recoverPendingTranslations(): Promise<void> {
  const db = await getDb();
  if (!db) return;

  const pending = await db.select()
    .from(translationJobs)
    .where(inArray(translationJobs.status, ["pending", "processing"]))
    .limit(50);

  if (pending.length === 0) {
    console.log("[TranslationEngine] No pending translation jobs to recover.");
    return;
  }

  console.log(`[TranslationEngine] Recovering ${pending.length} pending translation jobs...`);

  // أعد وضع الـ processing كـ pending إذا كانت stuck
  const processingIds = pending
    .filter(j => j.status === "processing")
    .map(j => j.id);

  if (processingIds.length > 0) {
    await db.update(translationJobs)
      .set({ status: "pending" })
      .where(inArray(translationJobs.id, processingIds));
  }

  const allPendingIds = pending.map(j => j.id);
  processTranslationJobs(allPendingIds).catch(e =>
    console.error("[TranslationEngine] Recovery processing error:", e)
  );
}
