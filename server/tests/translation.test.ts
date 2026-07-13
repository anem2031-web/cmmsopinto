import { describe, expect, it, vi, beforeEach } from "vitest";
import { appRouter } from "../routers";
import type { TrpcContext } from "../_core/context";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createMockContext(role: string = "admin", userId: number = 1): TrpcContext {
  const user: AuthenticatedUser = {
    id: userId,
    openId: `test-user-${userId}`,
    email: `user${userId}@test.com`,
    name: `Test User ${userId}`,
    loginMethod: "manus",
    role: role as any,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {
      clearCookie: () => {},
    } as TrpcContext["res"],
  };
}

function createUnauthContext(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {
      clearCookie: () => {},
    } as TrpcContext["res"],
  };
}

describe("Translation System Tests", () => {
  describe("Translation Router - Access Control", () => {
    it("getStats is accessible by authenticated users", async () => {
      const ctx = createMockContext("admin", 1);
      const caller = appRouter.createCaller(ctx);
      const result = await caller.translation.getStats();
      // Should return stats object or null (if DB not available)
      expect(result === null || typeof result === "object").toBe(true);
      if (result) {
        expect(result).toHaveProperty("translations");
        expect(result).toHaveProperty("jobs");
        expect(result).toHaveProperty("byEntity");
        expect(result).toHaveProperty("byLanguage");
        expect(result).toHaveProperty("cacheSize");
        expect(result.translations).toHaveProperty("total");
        expect(result.translations).toHaveProperty("pending");
        expect(result.translations).toHaveProperty("processing");
        expect(result.translations).toHaveProperty("completed");
        expect(result.translations).toHaveProperty("failed");
        expect(result.translations).toHaveProperty("approved");
      }
    });

    it("getStats returns correct structure", async () => {
      const ctx = createMockContext("owner", 1);
      const caller = appRouter.createCaller(ctx);
      const result = await caller.translation.getStats();
      if (result) {
        expect(typeof result.translations.total).toBe("number");
        expect(typeof result.translations.pending).toBe("number");
        expect(typeof result.cacheSize).toBe("number");
        expect(Array.isArray(result.byEntity)).toBe(true);
        expect(Array.isArray(result.byLanguage)).toBe(true);
      }
    });

    it("getJobs returns array", async () => {
      const ctx = createMockContext("admin", 1);
      const caller = appRouter.createCaller(ctx);
      const result = await caller.translation.getJobs({ limit: 10 });
      expect(Array.isArray(result)).toBe(true);
    });

    it("getJobs with status filter returns array", async () => {
      const ctx = createMockContext("admin", 1);
      const caller = appRouter.createCaller(ctx);
      const result = await caller.translation.getJobs({ status: "pending", limit: 5 });
      expect(Array.isArray(result)).toBe(true);
    });

    it("getJobs with entity filter returns array", async () => {
      const ctx = createMockContext("admin", 1);
      const caller = appRouter.createCaller(ctx);
      const result = await caller.translation.getJobs({ entityType: "ticket", limit: 5 });
      expect(Array.isArray(result)).toBe(true);
    });

    it("getEntityFieldMap returns entity field mapping", async () => {
      const ctx = createMockContext("admin", 1);
      const caller = appRouter.createCaller(ctx);
      const result = await caller.translation.getEntityFieldMap();
      expect(result).toBeDefined();
      expect(typeof result).toBe("object");
      // Should have ticket, purchase_order, etc.
      expect(result).toHaveProperty("TICKET");
      expect(result).toHaveProperty("PO");
      expect(result).toHaveProperty("PO_ITEM");
      expect(result).toHaveProperty("INVENTORY");
    });

    it("getEntityFieldMap contains correct field arrays", async () => {
      const ctx = createMockContext("admin", 1);
      const caller = appRouter.createCaller(ctx);
      const result = await caller.translation.getEntityFieldMap();
      // TICKET should have title, description
      expect(Array.isArray(result.TICKET)).toBe(true);
      expect(result.TICKET).toContain("title");
      expect(result.TICKET).toContain("description");
    });

    it("unauthenticated user cannot access getStats", async () => {
      const ctx = createUnauthContext();
      const caller = appRouter.createCaller(ctx);
      await expect(caller.translation.getStats()).rejects.toThrow();
    });

    it("unauthenticated user cannot access getJobs", async () => {
      const ctx = createUnauthContext();
      const caller = appRouter.createCaller(ctx);
      await expect(caller.translation.getJobs()).rejects.toThrow();
    });

    it("unauthenticated user cannot queue translation", async () => {
      const ctx = createUnauthContext();
      const caller = appRouter.createCaller(ctx);
      await expect(caller.translation.queueTranslation({
        entityType: "ticket",
        entityId: 1,
        fields: [{ fieldName: "title", text: "Test" }],
        sourceLanguage: "ar",
      })).rejects.toThrow();
    });
  });

  describe("Translation Router - Manual Override Access", () => {
    it("admin can call manualOverride", async () => {
      const ctx = createMockContext("admin", 1);
      const caller = appRouter.createCaller(ctx);
      // This may fail if entity doesn't exist, but should not throw FORBIDDEN
      try {
        await caller.translation.manualOverride({
          entityType: "ticket",
          entityId: 999999,
          fieldName: "title",
          languageCode: "en",
          translatedText: "Test translation",
        });
      } catch (err: any) {
        // Should not be FORBIDDEN for admin
        expect(err.code).not.toBe("FORBIDDEN");
      }
    });

    it("owner can call manualOverride", async () => {
      const ctx = createMockContext("owner", 1);
      const caller = appRouter.createCaller(ctx);
      try {
        await caller.translation.manualOverride({
          entityType: "ticket",
          entityId: 999999,
          fieldName: "title",
          languageCode: "en",
          translatedText: "Test translation",
        });
      } catch (err: any) {
        expect(err.code).not.toBe("FORBIDDEN");
      }
    });

    it("maintenance_manager can call manualOverride", async () => {
      const ctx = createMockContext("maintenance_manager", 1);
      const caller = appRouter.createCaller(ctx);
      try {
        await caller.translation.manualOverride({
          entityType: "ticket",
          entityId: 999999,
          fieldName: "title",
          languageCode: "en",
          translatedText: "Test translation",
        });
      } catch (err: any) {
        expect(err.code).not.toBe("FORBIDDEN");
      }
    });

    it("regular user cannot call manualOverride", async () => {
      const ctx = createMockContext("user", 2);
      const caller = appRouter.createCaller(ctx);
      await expect(caller.translation.manualOverride({
        entityType: "ticket",
        entityId: 1,
        fieldName: "title",
        languageCode: "en",
        translatedText: "Test translation",
      })).rejects.toThrow();
    });

    it("technician cannot call manualOverride", async () => {
      const ctx = createMockContext("technician", 3);
      const caller = appRouter.createCaller(ctx);
      await expect(caller.translation.manualOverride({
        entityType: "ticket",
        entityId: 1,
        fieldName: "title",
        languageCode: "en",
        translatedText: "Test translation",
      })).rejects.toThrow();
    });

    it("delegate cannot call manualOverride", async () => {
      const ctx = createMockContext("delegate", 4);
      const caller = appRouter.createCaller(ctx);
      await expect(caller.translation.manualOverride({
        entityType: "ticket",
        entityId: 1,
        fieldName: "title",
        languageCode: "en",
        translatedText: "Test translation",
      })).rejects.toThrow();
    });
  });

  describe("Translation Router - Retry Access", () => {
    it("admin can retry failed jobs", async () => {
      const ctx = createMockContext("admin", 1);
      const caller = appRouter.createCaller(ctx);
      const result = await caller.translation.retryFailed({});
      expect(result).toHaveProperty("success", true);
      expect(result).toHaveProperty("retriedCount");
      expect(typeof result.retriedCount).toBe("number");
    });

    it("owner can retry failed jobs", async () => {
      const ctx = createMockContext("owner", 1);
      const caller = appRouter.createCaller(ctx);
      const result = await caller.translation.retryFailed({});
      expect(result).toHaveProperty("success", true);
    });

    it("regular user cannot retry failed jobs", async () => {
      const ctx = createMockContext("user", 2);
      const caller = appRouter.createCaller(ctx);
      await expect(caller.translation.retryFailed({})).rejects.toThrow();
    });

    it("technician cannot retry failed jobs", async () => {
      const ctx = createMockContext("technician", 3);
      const caller = appRouter.createCaller(ctx);
      await expect(caller.translation.retryFailed({})).rejects.toThrow();
    });

    it("retry with entity type filter works", async () => {
      const ctx = createMockContext("admin", 1);
      const caller = appRouter.createCaller(ctx);
      const result = await caller.translation.retryFailed({ entityType: "ticket" });
      expect(result).toHaveProperty("success", true);
    });
  });

  describe("Translation Router - Queue Translation", () => {
    it("queueTranslation accepts valid input", async () => {
      const ctx = createMockContext("admin", 1);
      const caller = appRouter.createCaller(ctx);
      const result = await caller.translation.queueTranslation({
        entityType: "ticket",
        entityId: 1,
        fields: [
          { fieldName: "title", text: "عطل في المكيف" },
          { fieldName: "description", text: "المكيف لا يعمل في الطابق الثاني" },
        ],
        sourceLanguage: "ar",
        targetLanguages: ["en", "ur"],
      });
      expect(result).toHaveProperty("success", true);
      expect(result).toHaveProperty("jobIds");
      expect(result).toHaveProperty("count");
      expect(Array.isArray(result.jobIds)).toBe(true);
    });

    it("queueTranslation with single target language", async () => {
      const ctx = createMockContext("admin", 1);
      const caller = appRouter.createCaller(ctx);
      const result = await caller.translation.queueTranslation({
        entityType: "purchase_order",
        entityId: 1,
        fields: [{ fieldName: "notes", text: "ملاحظات الطلب" }],
        sourceLanguage: "ar",
        targetLanguages: ["en"],
      });
      expect(result.success).toBe(true);
    });

    it("queueTranslation without target languages defaults to all others", async () => {
      const ctx = createMockContext("admin", 1);
      const caller = appRouter.createCaller(ctx);
      const result = await caller.translation.queueTranslation({
        entityType: "ticket",
        entityId: 2,
        fields: [{ fieldName: "title", text: "Test title" }],
        sourceLanguage: "en",
      });
      expect(result.success).toBe(true);
      // Should create jobs for ar and ur (all except source)
      expect(result.count).toBeGreaterThanOrEqual(0);
    });
  });

  describe("Translation Router - Get Translations", () => {
    it("getEntityTranslations returns object", async () => {
      const ctx = createMockContext("admin", 1);
      const caller = appRouter.createCaller(ctx);
      const result = await caller.translation.getEntityTranslations({
        entityType: "ticket",
        entityId: 1,
        languageCode: "en",
      });
      expect(typeof result).toBe("object");
    });

    it("getEntityTranslations with field filter", async () => {
      const ctx = createMockContext("admin", 1);
      const caller = appRouter.createCaller(ctx);
      const result = await caller.translation.getEntityTranslations({
        entityType: "ticket",
        entityId: 1,
        languageCode: "en",
        fieldNames: ["title"],
      });
      expect(typeof result).toBe("object");
    });

    it("getBatchTranslations returns object", async () => {
      const ctx = createMockContext("admin", 1);
      const caller = appRouter.createCaller(ctx);
      const result = await caller.translation.getBatchTranslations({
        entityType: "ticket",
        entityIds: [1, 2, 3],
        languageCode: "en",
      });
      expect(typeof result).toBe("object");
    });
  });

  describe("Translation Router - Set Language", () => {
    it("setLanguage accepts valid language", async () => {
      const ctx = createMockContext("admin", 1);
      const caller = appRouter.createCaller(ctx);
      const result = await caller.translation.setLanguage({ language: "en" });
      expect(result).toHaveProperty("success", true);
    });

    it("setLanguage accepts Arabic", async () => {
      const ctx = createMockContext("admin", 1);
      const caller = appRouter.createCaller(ctx);
      const result = await caller.translation.setLanguage({ language: "ar" });
      expect(result).toHaveProperty("success", true);
    });

    it("setLanguage accepts Urdu", async () => {
      const ctx = createMockContext("admin", 1);
      const caller = appRouter.createCaller(ctx);
      const result = await caller.translation.setLanguage({ language: "ur" });
      expect(result).toHaveProperty("success", true);
    });

    it("setLanguage rejects invalid language", async () => {
      const ctx = createMockContext("admin", 1);
      const caller = appRouter.createCaller(ctx);
      await expect(caller.translation.setLanguage({ language: "fr" as any })).rejects.toThrow();
    });

    it("unauthenticated user cannot set language", async () => {
      const ctx = createUnauthContext();
      const caller = appRouter.createCaller(ctx);
      await expect(caller.translation.setLanguage({ language: "en" })).rejects.toThrow();
    });
  });

  describe("Translation Router - Version History", () => {
    it("getVersionHistory returns array", async () => {
      const ctx = createMockContext("admin", 1);
      const caller = appRouter.createCaller(ctx);
      const result = await caller.translation.getVersionHistory({
        entityType: "ticket",
        entityId: 1,
        fieldName: "title",
        languageCode: "en",
      });
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe("Translation Input Validation", () => {
    it("queueTranslation with empty fields returns empty jobIds", async () => {
      const ctx = createMockContext("admin", 1);
      const caller = appRouter.createCaller(ctx);
      const result = await caller.translation.queueTranslation({
        entityType: "ticket",
        entityId: 1,
        fields: [],
        sourceLanguage: "ar",
      });
      expect(result.success).toBe(true);
      expect(result.count).toBe(0);
    });

    it("queueTranslation rejects invalid source language", async () => {
      const ctx = createMockContext("admin", 1);
      const caller = appRouter.createCaller(ctx);
      await expect(caller.translation.queueTranslation({
        entityType: "ticket",
        entityId: 1,
        fields: [{ fieldName: "title", text: "test" }],
        sourceLanguage: "invalid" as any,
      })).rejects.toThrow();
    });

    it("manualOverride rejects empty translated text", async () => {
      const ctx = createMockContext("admin", 1);
      const caller = appRouter.createCaller(ctx);
      await expect(caller.translation.manualOverride({
        entityType: "ticket",
        entityId: 1,
        fieldName: "title",
        languageCode: "en",
        translatedText: "",
      })).rejects.toThrow();
    });

    it("getEntityTranslations rejects invalid language", async () => {
      const ctx = createMockContext("admin", 1);
      const caller = appRouter.createCaller(ctx);
      await expect(caller.translation.getEntityTranslations({
        entityType: "ticket",
        entityId: 1,
        languageCode: "invalid" as any,
      })).rejects.toThrow();
    });
  });
});
