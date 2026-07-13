import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the LLM invocation to avoid real API calls in tests
vi.mock("./_core/llm", () => ({
  invokeLLM: vi.fn(async ({ messages }: { messages: Array<{ role: string; content: string }> }) => {
    const userMessage = messages.find((m) => m.role === "user")?.content || "";

    // Simulate language detection
    if (userMessage.includes("detect") || userMessage.includes("language")) {
      if (userMessage.includes("مرحبا") || userMessage.includes("عطل")) return { choices: [{ message: { content: "ar" } }] };
      if (userMessage.includes("hello") || userMessage.includes("broken")) return { choices: [{ message: { content: "en" } }] };
      if (userMessage.includes("ہیلو") || userMessage.includes("خراب")) return { choices: [{ message: { content: "ur" } }] };
      return { choices: [{ message: { content: "ar" } }] };
    }

    // Simulate translation
    if (userMessage.includes("translate") || userMessage.includes("JSON")) {
      const mockTranslations: Record<string, any> = {
        "Water pump failure": {
          title: { ar: "عطل في مضخة المياه", en: "Water pump failure", ur: "پانی کے پمپ کی خرابی" },
        },
        "عطل في مضخة المياه": {
          title: { ar: "عطل في مضخة المياه", en: "Water pump failure", ur: "پانی کے پمپ کی خرابی" },
        },
        "Pump stopped working": {
          description: { ar: "توقفت المضخة عن العمل", en: "Pump stopped working", ur: "پمپ نے کام کرنا بند کر دیا" },
        },
      };

      for (const [key, value] of Object.entries(mockTranslations)) {
        if (userMessage.includes(key)) {
          return { choices: [{ message: { content: JSON.stringify(value) } }] };
        }
      }

      // Default mock translation
      return {
        choices: [
          {
            message: {
              content: JSON.stringify({
                title: { ar: "نص مترجم", en: "Translated text", ur: "ترجمہ شدہ متن" },
              }),
            },
          },
        ],
      };
    }

    return { choices: [{ message: { content: "ar" } }] };
  }),
}));

describe("Translation Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("detectLanguage", () => {
    it("should detect Arabic text", async () => {
      const { detectLanguage } = await import("../services/translation/translation");
      const lang = await detectLanguage("مرحبا بالعالم");
      expect(lang).toBe("ar");
    });

    it("should detect English text", async () => {
      const { detectLanguage } = await import("../services/translation/translation");
      const lang = await detectLanguage("hello world broken");
      expect(lang).toBe("en");
    });

    it("should detect Urdu text", async () => {
      const { detectLanguage } = await import("../services/translation/translation");
      const lang = await detectLanguage("ہیلو");
      expect(lang).toBe("ur");
    });

    it("should return a valid language for unknown text", async () => {
      const { detectLanguage } = await import("../services/translation/translation");
      const lang = await detectLanguage("12345");
      expect(["ar", "en", "ur"]).toContain(lang);
    });
  });

  describe("translateFields", () => {
    it("should translate a single field from English to all languages", async () => {
      const { translateFields } = await import("../services/translation/translation");
      const result = await translateFields({ title: "Water pump failure" }, "en");
      expect(result).toBeDefined();
      expect(result.title).toBeDefined();
      expect(result.title.ar).toBeTruthy();
      expect(result.title.en).toBeTruthy();
      expect(result.title.ur).toBeTruthy();
    });

    it("should translate Arabic text to all languages", async () => {
      const { translateFields } = await import("../services/translation/translation");
      const result = await translateFields({ title: "عطل في مضخة المياه" }, "ar");
      expect(result).toBeDefined();
      expect(result.title).toBeDefined();
      expect(result.title.en).toBeTruthy();
    });

    it("should handle multiple fields at once", async () => {
      const { translateFields } = await import("../services/translation/translation");
      const result = await translateFields(
        { title: "Water pump failure", description: "Pump stopped working" },
        "en"
      );
      expect(result).toBeDefined();
      // Should have at least one field translated
      expect(Object.keys(result).length).toBeGreaterThan(0);
    });

    it("should handle empty fields gracefully", async () => {
      const { translateFields } = await import("../services/translation/translation");
      const result = await translateFields({}, "ar");
      expect(result).toBeDefined();
      expect(Object.keys(result)).toHaveLength(0);
    });
  });
});

describe("useTranslatedField hook logic", () => {
  it("should return translated value when available", () => {
    const record = {
      title: "Water pump failure",
      title_ar: "عطل في مضخة المياه",
      title_en: "Water pump failure",
      title_ur: "پانی کے پمپ کی خرابی",
    };

    // Simulate getField for Arabic
    const getFieldForLang = (rec: Record<string, any>, field: string, lang: string) => {
      const key = `${field}_${lang}`;
      return rec[key] || rec[field] || "";
    };

    expect(getFieldForLang(record, "title", "ar")).toBe("عطل في مضخة المياه");
    expect(getFieldForLang(record, "title", "en")).toBe("Water pump failure");
    expect(getFieldForLang(record, "title", "ur")).toBe("پانی کے پمپ کی خرابی");
  });

  it("should fallback to original field when translation not available", () => {
    const record = {
      title: "Water pump failure",
      // No translated versions
    };

    const getFieldForLang = (rec: Record<string, any>, field: string, lang: string) => {
      const key = `${field}_${lang}`;
      return rec[key] || rec[field] || "";
    };

    expect(getFieldForLang(record, "title", "ar")).toBe("Water pump failure");
    expect(getFieldForLang(record, "title", "en")).toBe("Water pump failure");
  });

  it("should return empty string for missing field", () => {
    const record = {};

    const getFieldForLang = (rec: Record<string, any>, field: string, lang: string) => {
      const key = `${field}_${lang}`;
      return rec[key] || rec[field] || "";
    };

    expect(getFieldForLang(record, "title", "ar")).toBe("");
  });

  it("should detect if translations exist", () => {
    const recordWithTranslations = {
      title: "Test",
      title_ar: "اختبار",
      title_en: "Test",
      title_ur: "ٹیسٹ",
    };

    const recordWithoutTranslations = {
      title: "Test",
    };

    const hasTranslation = (rec: Record<string, any>, field: string) => {
      return ["ar", "en", "ur"].some((lang) => {
        const key = `${field}_${lang}`;
        return rec[key] && rec[key].trim().length > 0;
      });
    };

    expect(hasTranslation(recordWithTranslations, "title")).toBe(true);
    expect(hasTranslation(recordWithoutTranslations, "title")).toBe(false);
  });
});
