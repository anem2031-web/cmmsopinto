import { invokeLLM } from "../_core/llm";

export type SupportedLanguage = "ar" | "en" | "ur";

export interface TranslationResult {
  ar: string;
  en: string;
  ur: string;
  originalLanguage: SupportedLanguage;
}

/**
 * Detect the language of a given text
 */
export async function detectLanguage(text: string): Promise<SupportedLanguage> {
  if (!text || text.trim().length === 0) return "ar";

  // Quick heuristic detection before calling LLM
  const arabicPattern = /[\u0600-\u06FF]/;
  const urduPattern = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/;

  // Check for Arabic-specific characters (not in Urdu)
  const arabicSpecific = /[\u0622\u0623\u0625\u0671]/;
  // Check for Urdu-specific characters
  const urduSpecific = /[\u06A9\u06AF\u06BA\u06BE\u06C1\u06CC\u06D2]/;

  if (urduSpecific.test(text)) return "ur";
  if (arabicSpecific.test(text)) return "ar";
  if (arabicPattern.test(text)) return "ar";
  if (urduPattern.test(text)) return "ur";

  // Default to English for Latin script
  return "en";
}

/**
 * Translate text to all three languages using LLM
 */
export async function translateToAllLanguages(
  text: string,
  originalLanguage?: SupportedLanguage
): Promise<TranslationResult> {
  if (!text || text.trim().length === 0) {
    return { ar: "", en: "", ur: "", originalLanguage: originalLanguage || "ar" };
  }

  const detectedLang = originalLanguage || (await detectLanguage(text));

  try {
    const response = await invokeLLM({
      messages: [
        {
          role: "system",
          content: `You are a professional translator specializing in Arabic, English, and Urdu for maintenance and facility management systems. 
Translate the given text accurately to all three languages.
Return ONLY a valid JSON object with keys: "ar" (Arabic), "en" (English), "ur" (Urdu).
Keep technical terms, numbers, and proper nouns as-is.
Preserve the original meaning and context.`,
        },
        {
          role: "user",
          content: `Translate this text (original language: ${detectedLang}):\n"${text}"`,
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "translation_result",
          strict: true,
          schema: {
            type: "object",
            properties: {
              ar: { type: "string", description: "Arabic translation" },
              en: { type: "string", description: "English translation" },
              ur: { type: "string", description: "Urdu translation" },
            },
            required: ["ar", "en", "ur"],
            additionalProperties: false,
          },
        },
      },
    });

    const content = response.choices?.[0]?.message?.content;
    if (!content) throw new Error("No translation content returned");

    const parsed = typeof content === "string" ? JSON.parse(content) : content;

    return {
      ar: parsed.ar || text,
      en: parsed.en || text,
      ur: parsed.ur || text,
      originalLanguage: detectedLang,
    };
  } catch (error) {
    console.error("[Translation] Error translating text:", error);
    // Fallback: return original text for all languages
    return {
      ar: text,
      en: text,
      ur: text,
      originalLanguage: detectedLang,
    };
  }
}

/**
 * Translate multiple fields at once (more efficient)
 */
export async function translateFields(
  fields: Record<string, string>,
  originalLanguage?: SupportedLanguage
): Promise<Record<string, TranslationResult>> {
  const results: Record<string, TranslationResult> = {};

  // Filter out empty fields
  const nonEmptyFields = Object.entries(fields).filter(([, v]) => v && v.trim().length > 0);

  if (nonEmptyFields.length === 0) return results;

  const detectedLang = originalLanguage || (await detectLanguage(nonEmptyFields[0][1]));

  try {
    const fieldsJson = JSON.stringify(Object.fromEntries(nonEmptyFields));

    const response = await invokeLLM({
      messages: [
        {
          role: "system",
          content: `You are a professional translator for maintenance and facility management systems.
Translate all fields in the given JSON object to Arabic (ar), English (en), and Urdu (ur).
Return a JSON object where each key maps to an object with "ar", "en", "ur" translations.
Keep technical terms, numbers, asset codes, and proper nouns as-is.`,
        },
        {
          role: "user",
          content: `Translate these fields (original language: ${detectedLang}):\n${fieldsJson}`,
        },
      ],
    });

const content = response.choices?.[0]?.message?.content;
if (!content) throw new Error("No translation content returned");

// تنظيف الـ markdown إذا أضافه الـ LLM
const cleanContent = typeof content === "string"
  ? content.replace(/```json\n?|\n?```/g, "").trim()
  : content;

let parsed: any;
try {
  parsed = typeof cleanContent === "string" ? JSON.parse(cleanContent) : cleanContent;
} catch {
  console.error("[Translation] JSON parse failed, content was:", cleanContent);
  // fallback: كل حقل يأخذ نصه الأصلي
  for (const [key, value] of nonEmptyFields) {
    results[key] = { ar: value, en: value, ur: value, originalLanguage: detectedLang };
  }
  return results;
}

// تحقق من الشكل قبل الكتابة
if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
  console.error("[Translation] Unexpected response shape:", parsed);
  for (const [key, value] of nonEmptyFields) {
    results[key] = { ar: value, en: value, ur: value, originalLanguage: detectedLang };
  }
  return results;
}

for (const [key] of nonEmptyFields) {
  const t = parsed[key];
  if (t && typeof t === "object" && (t.ar || t.en || t.ur)) {
    results[key] = {
      ar: t.ar || fields[key],
      en: t.en || fields[key],
      ur: t.ur || fields[key],
      originalLanguage: detectedLang,
    };
  } else {
    results[key] = {
      ar: fields[key],
      en: fields[key],
      ur: fields[key],
      originalLanguage: detectedLang,
    };
  }
}
  } catch (error) {
    console.error("[Translation] Error translating fields:", error);
    // Fallback
    for (const [key, value] of nonEmptyFields) {
      results[key] = {
        ar: value,
        en: value,
        ur: value,
        originalLanguage: detectedLang,
      };
    }
  }

  return results;
}

/**
 * Get translated text for a specific language
 */
export function getTranslatedText(
  record: Record<string, any>,
  fieldName: string,
  language: SupportedLanguage
): string {
  const translatedKey = `${fieldName}_${language}`;
  return record[translatedKey] || record[fieldName] || "";
}
