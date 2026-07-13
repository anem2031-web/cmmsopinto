import { describe, expect, it, beforeAll } from "vitest";
import { appRouter } from "../routers";
import { COOKIE_NAME } from "../../shared/const";
import type { TrpcContext } from "../_core/context";

type CookieCall = {
  name: string;
  value?: string;
  options: Record<string, unknown>;
};

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createAdminContext(): { ctx: TrpcContext; cookies: CookieCall[] } {
  const cookies: CookieCall[] = [];

  const user: AuthenticatedUser = {
    id: 1,
    openId: "admin-user",
    email: "admin@example.com",
    name: "Admin",
    loginMethod: "local",
    role: "admin",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  const ctx: TrpcContext = {
    user,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: (name: string, options: Record<string, unknown>) => {
        cookies.push({ name, options });
      },
      cookie: (name: string, value: string, options: Record<string, unknown>) => {
        cookies.push({ name, value, options });
      },
    } as TrpcContext["res"],
  };

  return { ctx, cookies };
}

function createPublicContext(): { ctx: TrpcContext; cookies: CookieCall[] } {
  const cookies: CookieCall[] = [];

  const ctx: TrpcContext = {
    user: null,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: (name: string, options: Record<string, unknown>) => {
        cookies.push({ name, options });
      },
      cookie: (name: string, value: string, options: Record<string, unknown>) => {
        cookies.push({ name, value, options });
      },
    } as TrpcContext["res"],
  };

  return { ctx, cookies };
}

describe("auth.login (local)", () => {
  it("rejects login with wrong credentials", async () => {
    const { ctx } = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.auth.login({ username: "nonexistent", password: "wrong" })
    ).rejects.toThrow();
  });

  it("rejects login with empty username", async () => {
    const { ctx } = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.auth.login({ username: "", password: "test" })
    ).rejects.toThrow();
  });
});

describe("backups", () => {
  it("lists backups (returns array)", async () => {
    const { ctx } = createAdminContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.backups.list();
    expect(Array.isArray(result)).toBe(true);
  });

  it("creates a backup successfully", async () => {
    const { ctx } = createAdminContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.backups.create();
    expect(result).toHaveProperty("id");
    expect(typeof result.id).toBe("number");
  });
});

describe("attachments", () => {
  it("lists attachments for a non-existent entity (returns empty array)", async () => {
    const { ctx } = createAdminContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.attachments.list({ entityType: "ticket", entityId: 999999 });
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(0);
  });

  it("adds an attachment successfully", async () => {
    const { ctx } = createAdminContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.attachments.add({
      entityType: "ticket",
      entityId: 1,
      fileName: "test-file.png",
      fileUrl: "https://example.com/test-file.png",
      fileKey: "test-file-key.png",
      mimeType: "image/png",
      fileSize: 1024,
    });

    expect(result).toHaveProperty("id");
  });
});
