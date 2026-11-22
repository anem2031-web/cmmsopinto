import { sql, type SQL } from "drizzle-orm";
type Reader = { execute(query: SQL): Promise<unknown> };
/** Call only with task-item IDs already authorized for the current actor. */
export async function loadAuthorizedTaskItemTitles(db: Reader, authorizedIds: readonly number[], language: "ar" | "en" | "ur") {
  const result = new Map<number,string>();
  if (language === "ar") return result;
  const ids = Array.from(new Set(authorizedIds));
  if (ids.some(id => !Number.isSafeInteger(id) || id < 1)) throw new Error("معرف بند المهمة غير صالح");
  for (let offset=0; offset<ids.length; offset+=500) {
    const chunk=ids.slice(offset,offset+500);
    const data=await db.execute(sql`SELECT entityId,translatedText FROM entity_translations
      WHERE entityType='PMV2_TASK_ITEM' AND fieldName='titleSnapshot' AND languageCode=${language}
        AND translationStatus IN ('approved','completed') AND entityId IN (${sql.join(chunk.map(id=>sql`${id}`),sql`, `)}) ORDER BY id DESC`);
    if (!Array.isArray(data) || !Array.isArray(data[0])) throw new Error("تعذر قراءة ترجمة المهام");
    for (const row of data[0] as any[]) { const id=Number(row.entityId); if (!result.has(id) && typeof row.translatedText==='string' && row.translatedText.trim()) result.set(id,row.translatedText.trim()); }
  }
  return result;
}
