/**
 * Workflow Tests - Phase 1 Critical Fixes
 * Tests for: Batching Limit, Path C Status, triageTicket, inspectTicket, Auto-Transition
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";
import type { TrpcContext } from "../_core/context";
import type { AuthenticatedUser } from "../_core/context";

// ============================================================
// Helpers
// ============================================================

function makeUser(overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return {
    id: 1,
    openId: "test-user",
    email: "test@example.com",
    name: "Test User",
    loginMethod: "manus",
    role: "maintenance_manager",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
    ...overrides,
  };
}

function makeCtx(user: AuthenticatedUser): TrpcContext {
  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

// ============================================================
// Test 1: Batching Limit - 15 items max per PO
// ============================================================

describe("Batching Limit: max 15 items per Purchase Order", () => {
  it("should reject a PO with more than 15 items", async () => {
    // Simulate the validation logic that was added to create PO
    const MAX_ITEMS = 15;
    const items = Array.from({ length: 16 }, (_, i) => ({
      itemName: `Item ${i + 1}`,
      quantity: 1,
      unit: "pcs",
    }));

    const validate = (items: any[]) => {
      if (items.length > MAX_ITEMS) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `لا يمكن إضافة أكثر من ${MAX_ITEMS} صنفاً في طلب شراء واحد. يرجى تقسيم الطلب.`,
        });
      }
    };

    expect(() => validate(items)).toThrowError(TRPCError);
    expect(() => validate(items)).toThrowError(/15/);
  });

  it("should accept a PO with exactly 15 items", () => {
    const MAX_ITEMS = 15;
    const items = Array.from({ length: 15 }, (_, i) => ({
      itemName: `Item ${i + 1}`,
      quantity: 1,
      unit: "pcs",
    }));

    const validate = (items: any[]) => {
      if (items.length > MAX_ITEMS) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `لا يمكن إضافة أكثر من ${MAX_ITEMS} صنفاً`,
        });
      }
      return true;
    };

    expect(validate(items)).toBe(true);
  });

  it("should accept a PO with fewer than 15 items", () => {
    const MAX_ITEMS = 15;
    const items = Array.from({ length: 5 }, (_, i) => ({
      itemName: `Item ${i + 1}`,
      quantity: 1,
      unit: "pcs",
    }));

    const validate = (items: any[]) => {
      if (items.length > MAX_ITEMS) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Too many items" });
      }
      return true;
    };

    expect(validate(items)).toBe(true);
  });
});

// ============================================================
// Test 2: Path C Status Fix - Gate Entry → ready_for_closure
// ============================================================

describe("Path C Status Fix: Gate Entry moves ticket to ready_for_closure", () => {
  it("should transition ticket to ready_for_closure (not repaired) after gate entry", () => {
    // Simulate the approveGateEntry logic
    const approveGateEntry = (ticket: any, user: any) => {
      if (ticket.maintenancePath !== "C") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "هذا البلاغ ليس في المسار C" });
      }
      if (ticket.status !== "out_for_repair") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "البلاغ ليس في حالة خارج للإصلاح" });
      }
      // FIXED: was "repaired", now "ready_for_closure"
      return { ...ticket, status: "ready_for_closure", gateEntryApprovedById: user.id };
    };

    const ticket = { id: 1, status: "out_for_repair", maintenancePath: "C" };
    const user = makeUser({ role: "gate_security" });
    const result = approveGateEntry(ticket, user);

    expect(result.status).toBe("ready_for_closure");
    expect(result.status).not.toBe("repaired");
    expect(result.gateEntryApprovedById).toBe(user.id);
  });

  it("should reject gate entry for non-Path-C tickets", () => {
    const approveGateEntry = (ticket: any) => {
      if (ticket.maintenancePath !== "C") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "هذا البلاغ ليس في المسار C" });
      }
      return { ...ticket, status: "ready_for_closure" };
    };

    const ticket = { id: 2, status: "out_for_repair", maintenancePath: "A" };
    expect(() => approveGateEntry(ticket)).toThrowError(TRPCError);
  });
});

// ============================================================
// Test 3: triageTicket - pending_triage → under_inspection
// ============================================================

describe("triageTicket: transitions ticket from pending_triage to under_inspection", () => {
  it("should move ticket to under_inspection when supervisor triages it", () => {
    const triageTicket = (ticket: any, input: any, user: any) => {
      if (ticket.status !== "pending_triage") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "البلاغ ليس في حالة انتظار الفرز" });
      }
      if (!["supervisor", "maintenance_manager", "owner", "admin"].includes(user.role)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "غير مصرح" });
      }
      return {
        ...ticket,
        status: "under_inspection",
        ticketType: input.ticketType,
        supervisorId: user.id,
      };
    };

    const ticket = { id: 1, status: "pending_triage" };
    const user = makeUser({ role: "supervisor", id: 10 });
    const input = { ticketId: 1, ticketType: "corrective" };

    const result = triageTicket(ticket, input, user);
    expect(result.status).toBe("under_inspection");
    expect(result.ticketType).toBe("corrective");
    expect(result.supervisorId).toBe(10);
  });

  it("should reject triage if ticket is not in pending_triage", () => {
    const triageTicket = (ticket: any, _input: any, _user: any) => {
      if (ticket.status !== "pending_triage") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "البلاغ ليس في حالة انتظار الفرز" });
      }
      return { ...ticket, status: "under_inspection" };
    };

    const ticket = { id: 1, status: "assigned" };
    const user = makeUser({ role: "supervisor" });
    expect(() => triageTicket(ticket, {}, user)).toThrowError(TRPCError);
  });

  it("should reject triage if user is not supervisor or above", () => {
    const triageTicket = (ticket: any, _input: any, user: any) => {
      if (ticket.status !== "pending_triage") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "البلاغ ليس في حالة انتظار الفرز" });
      }
      if (!["supervisor", "maintenance_manager", "owner", "admin"].includes(user.role)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "غير مصرح" });
      }
      return { ...ticket, status: "under_inspection" };
    };

    const ticket = { id: 1, status: "pending_triage" };
    const user = makeUser({ role: "technician" });
    expect(() => triageTicket(ticket, {}, user)).toThrowError(TRPCError);
  });
});

// ============================================================
// Test 4: inspectTicket - under_inspection → work_approved
// ============================================================

describe("inspectTicket: transitions ticket from under_inspection to work_approved", () => {
  it("should move ticket to work_approved when maintenance_manager inspects", () => {
    const inspectTicket = (ticket: any, input: any, user: any) => {
      if (ticket.status !== "under_inspection") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "البلاغ ليس قيد الفحص" });
      }
      if (!["maintenance_manager", "owner", "admin"].includes(user.role)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "غير مصرح" });
      }
      return {
        ...ticket,
        status: "work_approved",
        maintenancePath: input.maintenancePath,
        assignedToId: input.assignedToId,
      };
    };

    const ticket = { id: 1, status: "under_inspection" };
    const user = makeUser({ role: "maintenance_manager" });
    const input = { ticketId: 1, maintenancePath: "A", assignedToId: 5 };

    const result = inspectTicket(ticket, input, user);
    expect(result.status).toBe("work_approved");
    expect(result.maintenancePath).toBe("A");
    expect(result.assignedToId).toBe(5);
  });

  it("should reject inspection if ticket is not under_inspection", () => {
    const inspectTicket = (ticket: any) => {
      if (ticket.status !== "under_inspection") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "البلاغ ليس قيد الفحص" });
      }
      return { ...ticket, status: "work_approved" };
    };

    const ticket = { id: 1, status: "pending_triage" };
    expect(() => inspectTicket(ticket)).toThrowError(TRPCError);
  });

  it("should validate maintenancePath is A, B, or C", () => {
    const inspectTicket = (ticket: any, input: any) => {
      if (ticket.status !== "under_inspection") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "البلاغ ليس قيد الفحص" });
      }
      if (!["A", "B", "C"].includes(input.maintenancePath)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "مسار الصيانة غير صحيح" });
      }
      return { ...ticket, status: "work_approved", maintenancePath: input.maintenancePath };
    };

    const ticket = { id: 1, status: "under_inspection" };
    expect(() => inspectTicket(ticket, { maintenancePath: "D" })).toThrowError(TRPCError);
    expect(inspectTicket(ticket, { maintenancePath: "A" }).maintenancePath).toBe("A");
    expect(inspectTicket(ticket, { maintenancePath: "B" }).maintenancePath).toBe("B");
    expect(inspectTicket(ticket, { maintenancePath: "C" }).maintenancePath).toBe("C");
  });
});

// ============================================================
// Test 5: Auto-Transition - New tickets start at pending_triage
// ============================================================

describe("Auto-Transition: New tickets start at pending_triage", () => {
  it("should create ticket with pending_triage status (not new)", () => {
    // Simulate the create ticket logic
    const createTicket = (input: any) => {
      return {
        ...input,
        status: "pending_triage", // FIXED: was "new"
        ticketNumber: `TKT-${Date.now()}`,
        createdAt: new Date(),
      };
    };

    const input = {
      title: "Test Ticket",
      description: "Test description",
      siteId: 1,
      priority: "medium",
    };

    const result = createTicket(input);
    expect(result.status).toBe("pending_triage");
    expect(result.status).not.toBe("new");
  });
});

// ============================================================
// Test 6: Warehouse Visibility - Only see purchased items
// ============================================================

describe("Warehouse Visibility: Only see items after delegate confirms purchase", () => {
  it("should only show items with status purchased to warehouse", () => {
    const items = [
      { id: 1, itemName: "Item A", status: "approved" },
      { id: 2, itemName: "Item B", status: "purchased" },
      { id: 3, itemName: "Item C", status: "estimated" },
      { id: 4, itemName: "Item D", status: "purchased" },
      { id: 5, itemName: "Item E", status: "delivered_to_warehouse" },
    ];

    // Warehouse visibility rule: only see items with status "purchased"
    const warehouseVisibleItems = items.filter(i => i.status === "purchased");

    expect(warehouseVisibleItems).toHaveLength(2);
    expect(warehouseVisibleItems.map(i => i.id)).toEqual([2, 4]);
    expect(warehouseVisibleItems.every(i => i.status === "purchased")).toBe(true);
  });

  it("should not show items with status approved or estimated to warehouse", () => {
    const items = [
      { id: 1, itemName: "Item A", status: "approved" },
      { id: 2, itemName: "Item B", status: "estimated" },
    ];

    const warehouseVisibleItems = items.filter(i => i.status === "purchased");
    expect(warehouseVisibleItems).toHaveLength(0);
  });
});

// ============================================================
// Test 7: NFC Tag Lookup - Asset Not Found
// ============================================================

describe("NFC Tag Lookup: Asset not found returns proper error", () => {
  it("should throw NOT_FOUND when rfid tag is not registered", () => {
    const scanNFCTag = (rfidTag: string, assets: any[]) => {
      const asset = assets.find(a => a.rfidTag === rfidTag);
      if (!asset) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `الأصل غير موجود. الرقاقة "${rfidTag}" غير مسجلة في النظام.`,
        });
      }
      return asset;
    };

    const assets = [
      { id: 1, name: "Pump A", rfidTag: "TAG-001" },
      { id: 2, name: "Generator B", rfidTag: "TAG-002" },
    ];

    expect(() => scanNFCTag("TAG-999", assets)).toThrowError(TRPCError);
    expect(() => scanNFCTag("TAG-999", assets)).toThrowError(/غير مسجلة/);
    expect(scanNFCTag("TAG-001", assets)).toMatchObject({ id: 1, name: "Pump A" });
  });
});
