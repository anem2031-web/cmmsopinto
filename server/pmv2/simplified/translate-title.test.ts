import { describe, expect, it } from "vitest";
import { translatePmv2TaskTitle } from "./translate-title";

describe("PMV2 task title translation preview", () => {
  it("gets both editable titles through DeepSeek Chat Completions JSON mode", async () => {
    const result = await translatePmv2TaskTitle("فحص الكهرباء", async request => {
      // Reproduce the provider rejecting an unsupported response_format.
      if (request.response_format?.type !== "json_object") {
        throw new Error("DeepSeek Chat Completions requires json_object for JSON output");
      }
      expect(request.messages[0]?.content).toMatch(/JSON object.*\{"en":".+","ur":".+"\}/);
      expect(request.messages[1]).toEqual({ role: "user", content: "فحص الكهرباء" });
      return {
        choices: [{
          message: {
            content: JSON.stringify({ en: " Inspect electrical system ", ur: " بجلی کا معائنہ " }),
          },
        }],
      };
    });
    expect(result).toEqual({ en: "Inspect electrical system", ur: "بجلی کا معائنہ" });
  });
  it("rejects empty input before invoking the translator", async () => {
    let called = false;
    await expect(translatePmv2TaskTitle("  ", async () => { called = true; throw new Error(); })).rejects.toThrow("اكتب عنوان المهمة");
    expect(called).toBe(false);
  });
  it("reports a clear error when translation fails or has missing fields", async () => {
    const fail = async () => { throw new Error("internal secret"); };
    await expect(translatePmv2TaskTitle("فحص", fail)).rejects.toThrow("تعذرت الترجمة");
    await expect(translatePmv2TaskTitle("فحص", async () => ({ choices: [{ message: { content: '{"en":"Inspection"}' } }] }))).rejects.toThrow("تعذرت الترجمة");
  });
});
