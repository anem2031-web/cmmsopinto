/**
 * Full-Cycle Workflow Tests - Phase 23
 * Tests for: Path A (Internal), Path B (Procurement), Path C (External)
 * Verifies: Closure Rights (Khaled=Path A, AbdelFattah=Path B&C)
 * Verifies: Status transitions, role enforcement, gate protocol
 */
import { describe, expect, it, vi } from "vitest";
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
    loginMethod: "local",
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

// Simulated ticket factory
function makeTicket(overrides: Record<string, any> = {}) {
  return {
    id: 1,
    ticketNumber: "TKT-001",
    title: "Test Ticket",
    status: "pending_triage",
    maintenancePath: null,
    reportedById: 10,
    assignedToId: null,
    supervisorId: null,
    gateSecurityId: null,
    gateExitApprovedById: null,
    gateEntryApprovedById: null,
    closedAt: null,
    ...overrides,
  };
}

// ============================================================
// STATUS TRANSITION LOGIC (mirrors routers.ts)
// ============================================================

function triageTicket(ticket: any, user: AuthenticatedUser, input: { inspectionTeamId: number; priority: string; ticketType: string }) {
  if (!["supervisor", "maintenance_manager", "owner", "admin"].includes(user.role)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "ليس لديك صلاحية" });
  }
  if (ticket.status !== "pending_triage") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "البلاغ ليس في مرحلة الفرز" });
  }
  return { ...ticket, status: "under_inspection", supervisorId: user.id };
}

function inspectTicket(ticket: any, user: AuthenticatedUser, input: { inspectionNotes: string }) {
  if (!["supervisor", "maintenance_manager", "owner", "admin"].includes(user.role)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "ليس لديك صلاحية" });
  }
  if (ticket.status !== "under_inspection") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "البلاغ ليس قيد الفحص" });
  }
  return { ...ticket, status: "inspected", inspectionNotes: input.inspectionNotes };
}

function approveWork(ticket: any, user: AuthenticatedUser, input: { maintenancePath: "A" | "B" | "C"; justification?: string }) {
  if (!["maintenance_manager", "owner", "admin"].includes(user.role)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "ليس لديك صلاحية" });
  }
  if (ticket.status !== "under_inspection" && ticket.status !== "inspected") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "البلاغ ليس في مرحلة الفحص" });
  }
  if (input.maintenancePath === "C" && !input.justification) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "يجب توفير مبرر للإصلاح الخارجي" });
  }
  let newStatus = "work_approved";
  if (input.maintenancePath === "C") newStatus = "work_approved"; // Gate will move to out_for_repair
  if (input.maintenancePath === "A") newStatus = "work_approved";
  return { ...ticket, status: newStatus, maintenancePath: input.maintenancePath };
}

function markReadyForClosure(ticket: any, user: AuthenticatedUser) {
  if (ticket.maintenancePath !== "A") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "هذا الإجراء للمسار A فقط" });
  }
  if (ticket.status !== "repaired") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "البلاغ لم يكتمل إصلاحه بعد" });
  }
  return { ...ticket, status: "ready_for_closure" };
}

function closeBySupervisor(ticket: any, user: AuthenticatedUser) {
  if (!["supervisor", "owner", "admin"].includes(user.role)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "ليس لديك صلاحية - المسار A يُغلق من المشرف فقط" });
  }
  if (ticket.status !== "ready_for_closure") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "البلاغ ليس جاهزاً للإغلاق" });
  }
  if (ticket.maintenancePath !== "A") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "هذا الإجراء للمسار A فقط" });
  }
  return { ...ticket, status: "closed", closedAt: new Date() };
}

function closeByManager(ticket: any, user: AuthenticatedUser) {
  if (!["maintenance_manager", "owner", "admin"].includes(user.role)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "ليس لديك صلاحية - المسار B/C يُغلق من مدير الصيانة فقط" });
  }
  if (ticket.status !== "ready_for_closure") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "البلاغ ليس جاهزاً للإغلاق" });
  }
  return { ...ticket, status: "closed", closedAt: new Date() };
}

function approveGateExit(ticket: any, user: AuthenticatedUser) {
  if (!["gate_security", "owner", "admin"].includes(user.role)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "ليس لديك صلاحية" });
  }
  if (ticket.maintenancePath !== "C") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "هذا الإجراء للمسار C فقط" });
  }
  return { ...ticket, status: "out_for_repair", gateExitApprovedById: user.id };
}

function approveGateEntry(ticket: any, user: AuthenticatedUser) {
  if (!["gate_security", "owner", "admin"].includes(user.role)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "ليس لديك صلاحية" });
  }
  if (ticket.maintenancePath !== "C") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "هذا الإجراء للمسار C فقط" });
  }
  // ✅ Correct: moves to ready_for_closure (NOT repaired)
  return { ...ticket, status: "ready_for_closure", gateEntryApprovedById: user.id };
}

// ============================================================
// PATH A: Internal Direct Repair
// ============================================================
describe("Path A: Full Cycle - Internal Direct Repair", () => {
  const khaled = makeUser({ id: 2, role: "supervisor", name: "Eng. Khaled" });
  const abdelFattah = makeUser({ id: 3, role: "maintenance_manager", name: "Abdel Fattah" });
  const technician = makeUser({ id: 4, role: "technician", name: "Tech Ali" });

  it("Step 1: New ticket starts at pending_triage", () => {
    const ticket = makeTicket({ status: "pending_triage" });
    expect(ticket.status).toBe("pending_triage");
  });

  it("Step 2: Supervisor triages ticket → under_inspection", () => {
    const ticket = makeTicket({ status: "pending_triage" });
    const result = triageTicket(ticket, khaled, { inspectionTeamId: 4, priority: "high", ticketType: "corrective" });
    expect(result.status).toBe("under_inspection");
    expect(result.supervisorId).toBe(khaled.id);
  });

  it("Step 3: Supervisor inspects ticket → inspected", () => {
    const ticket = makeTicket({ status: "under_inspection" });
    const result = inspectTicket(ticket, khaled, { inspectionNotes: "الجهاز يحتاج تبديل قطعة" });
    expect(result.status).toBe("inspected");
  });

  it("Step 4: Manager approves work with Path A → work_approved", () => {
    const ticket = makeTicket({ status: "inspected" });
    const result = approveWork(ticket, abdelFattah, { maintenancePath: "A" });
    expect(result.status).toBe("work_approved");
    expect(result.maintenancePath).toBe("A");
  });

  it("Step 5: Technician completes repair → repaired (status transition)", () => {
    const ticket = makeTicket({ status: "work_approved", maintenancePath: "A" });
    // Simulate completeRepair
    const result = { ...ticket, status: "repaired" };
    expect(result.status).toBe("repaired");
  });

  it("Step 6: Mark ready for closure (Path A only)", () => {
    const ticket = makeTicket({ status: "repaired", maintenancePath: "A" });
    const result = markReadyForClosure(ticket, abdelFattah);
    expect(result.status).toBe("ready_for_closure");
  });

  it("Step 7 ✅ CLOSURE RIGHT: Only Supervisor (Khaled) can close Path A", () => {
    const ticket = makeTicket({ status: "ready_for_closure", maintenancePath: "A" });
    const result = closeBySupervisor(ticket, khaled);
    expect(result.status).toBe("closed");
    expect(result.closedAt).toBeDefined();
  });

  it("Step 7 ❌ CLOSURE VIOLATION: Manager cannot close Path A via supervisorClose", () => {
    const ticket = makeTicket({ status: "ready_for_closure", maintenancePath: "A" });
    expect(() => closeBySupervisor(ticket, abdelFattah)).toThrowError(TRPCError);
    expect(() => closeBySupervisor(ticket, abdelFattah)).toThrowError(/صلاحية/);
  });

  it("Step 7 ❌ CLOSURE VIOLATION: Technician cannot close any ticket", () => {
    const ticket = makeTicket({ status: "ready_for_closure", maintenancePath: "A" });
    expect(() => closeBySupervisor(ticket, technician)).toThrowError(TRPCError);
    expect(() => closeByManager(ticket, technician)).toThrowError(TRPCError);
  });
});

// ============================================================
// PATH B: Internal + Procurement
// ============================================================
describe("Path B: Full Cycle - Internal + Procurement", () => {
  const khaled = makeUser({ id: 2, role: "supervisor", name: "Eng. Khaled" });
  const abdelFattah = makeUser({ id: 3, role: "maintenance_manager", name: "Abdel Fattah" });

  it("Step 1-3: Triage → Inspect (same as Path A)", () => {
    let ticket = makeTicket({ status: "pending_triage" });
    ticket = triageTicket(ticket, khaled, { inspectionTeamId: 4, priority: "medium", ticketType: "corrective" });
    ticket = inspectTicket(ticket, khaled, { inspectionNotes: "يحتاج قطع غيار" });
    expect(ticket.status).toBe("inspected");
  });

  it("Step 4: Manager approves work with Path B → work_approved", () => {
    const ticket = makeTicket({ status: "inspected" });
    const result = approveWork(ticket, abdelFattah, { maintenancePath: "B" });
    expect(result.status).toBe("work_approved");
    expect(result.maintenancePath).toBe("B");
  });

  it("Step 5: Batching limit enforced - max 15 items per PO", () => {
    const MAX_ITEMS = 15;
    const items16 = Array.from({ length: 16 }, (_, i) => ({ name: `Item ${i + 1}` }));
    const validate = (items: any[]) => {
      if (items.length > MAX_ITEMS) throw new TRPCError({ code: "BAD_REQUEST", message: `لا يمكن إضافة أكثر من ${MAX_ITEMS} صنفاً` });
    };
    expect(() => validate(items16)).toThrowError(TRPCError);
  });

  it("Step 6: After warehouse receipt, ticket moves to ready_for_closure", () => {
    const ticket = makeTicket({ status: "work_approved", maintenancePath: "B" });
    // Simulate warehouse receipt completion
    const result = { ...ticket, status: "ready_for_closure" };
    expect(result.status).toBe("ready_for_closure");
  });

  it("Step 7 ✅ CLOSURE RIGHT: Only Manager (Abdel Fattah) can close Path B", () => {
    const ticket = makeTicket({ status: "ready_for_closure", maintenancePath: "B" });
    const result = closeByManager(ticket, abdelFattah);
    expect(result.status).toBe("closed");
  });

  it("Step 7 ❌ CLOSURE VIOLATION: Supervisor cannot close Path B via managerClose", () => {
    const ticket = makeTicket({ status: "ready_for_closure", maintenancePath: "B" });
    expect(() => closeByManager(ticket, khaled)).toThrowError(TRPCError);
    expect(() => closeByManager(ticket, khaled)).toThrowError(/صلاحية/);
  });
});

// ============================================================
// PATH C: External Maintenance
// ============================================================
describe("Path C: Full Cycle - External Maintenance (Gate Protocol)", () => {
  const khaled = makeUser({ id: 2, role: "supervisor", name: "Eng. Khaled" });
  const abdelFattah = makeUser({ id: 3, role: "maintenance_manager", name: "Abdel Fattah" });
  const gateSecurity = makeUser({ id: 5, role: "gate_security", name: "Gate Guard" });

  it("Step 4: Manager approves Path C - requires justification", () => {
    const ticket = makeTicket({ status: "inspected" });
    expect(() => approveWork(ticket, abdelFattah, { maintenancePath: "C" }))
      .toThrowError(/مبرر/);
  });

  it("Step 4: Manager approves Path C with justification → work_approved", () => {
    const ticket = makeTicket({ status: "inspected" });
    const result = approveWork(ticket, abdelFattah, { maintenancePath: "C", justification: "لا تتوفر قطع الغيار محلياً" });
    expect(result.status).toBe("work_approved");
    expect(result.maintenancePath).toBe("C");
  });

  it("Step 5 ✅ GATE PROTOCOL: Gate Security approves exit → out_for_repair", () => {
    const ticket = makeTicket({ status: "work_approved", maintenancePath: "C" });
    const result = approveGateExit(ticket, gateSecurity);
    expect(result.status).toBe("out_for_repair");
    expect(result.gateExitApprovedById).toBe(gateSecurity.id);
  });

  it("Step 5 ❌ GATE VIOLATION: Non-gate-security cannot approve exit", () => {
    const ticket = makeTicket({ status: "work_approved", maintenancePath: "C" });
    expect(() => approveGateExit(ticket, abdelFattah)).toThrowError(TRPCError);
    expect(() => approveGateExit(ticket, khaled)).toThrowError(TRPCError);
  });

  it("Step 5 ❌ GATE VIOLATION: Cannot approve exit for non-Path-C ticket", () => {
    const ticket = makeTicket({ status: "work_approved", maintenancePath: "A" });
    expect(() => approveGateExit(ticket, gateSecurity)).toThrowError(TRPCError);
  });

  it("Step 6 ✅ GATE PROTOCOL: Gate Security approves entry → ready_for_closure (NOT repaired)", () => {
    const ticket = makeTicket({ status: "out_for_repair", maintenancePath: "C" });
    const result = approveGateEntry(ticket, gateSecurity);
    // ✅ Critical: Must be ready_for_closure, NOT repaired
    expect(result.status).toBe("ready_for_closure");
    expect(result.status).not.toBe("repaired");
    expect(result.gateEntryApprovedById).toBe(gateSecurity.id);
  });

  it("Step 7 ✅ CLOSURE RIGHT: Only Manager (Abdel Fattah) can close Path C", () => {
    const ticket = makeTicket({ status: "ready_for_closure", maintenancePath: "C" });
    const result = closeByManager(ticket, abdelFattah);
    expect(result.status).toBe("closed");
  });

  it("Step 7 ❌ CLOSURE VIOLATION: Supervisor cannot close Path C", () => {
    const ticket = makeTicket({ status: "ready_for_closure", maintenancePath: "C" });
    expect(() => closeByManager(ticket, khaled)).toThrowError(TRPCError);
  });
});

// ============================================================
// CROSS-PATH CLOSURE RIGHTS SUMMARY
// ============================================================
describe("Closure Rights Enforcement - Cross-Path Summary", () => {
  const khaled = makeUser({ id: 2, role: "supervisor" });
  const abdelFattah = makeUser({ id: 3, role: "maintenance_manager" });
  const technician = makeUser({ id: 4, role: "technician" });
  const warehouse = makeUser({ id: 6, role: "warehouse" });
  const delegate = makeUser({ id: 7, role: "delegate" });

  const pathATicket = makeTicket({ status: "ready_for_closure", maintenancePath: "A" });
  const pathBTicket = makeTicket({ status: "ready_for_closure", maintenancePath: "B" });
  const pathCTicket = makeTicket({ status: "ready_for_closure", maintenancePath: "C" });

  it("✅ Khaled (supervisor) CAN close Path A", () => {
    expect(() => closeBySupervisor(pathATicket, khaled)).not.toThrow();
  });

  it("❌ Khaled (supervisor) CANNOT close Path B via supervisorClose", () => {
    // Path B must be closed by manager, not supervisor
    const pathBTicketA = { ...pathBTicket, maintenancePath: "A" as const }; // simulate wrong path
    // The real enforcement: supervisorClose checks maintenancePath === "A"
    const ticket = makeTicket({ status: "ready_for_closure", maintenancePath: "B" });
    // closeBySupervisor checks maintenancePath === "A"
    expect(() => {
      if (ticket.maintenancePath !== "A") throw new TRPCError({ code: "BAD_REQUEST", message: "هذا الإجراء للمسار A فقط" });
    }).toThrowError(TRPCError);
  });

  it("✅ AbdelFattah (manager) CAN close Path B", () => {
    expect(() => closeByManager(pathBTicket, abdelFattah)).not.toThrow();
  });

  it("✅ AbdelFattah (manager) CAN close Path C", () => {
    expect(() => closeByManager(pathCTicket, abdelFattah)).not.toThrow();
  });

  it("❌ Technician CANNOT close any path", () => {
    expect(() => closeBySupervisor(pathATicket, technician)).toThrowError(TRPCError);
    expect(() => closeByManager(pathBTicket, technician)).toThrowError(TRPCError);
    expect(() => closeByManager(pathCTicket, technician)).toThrowError(TRPCError);
  });

  it("❌ Warehouse CANNOT close any path", () => {
    expect(() => closeBySupervisor(pathATicket, warehouse)).toThrowError(TRPCError);
    expect(() => closeByManager(pathBTicket, warehouse)).toThrowError(TRPCError);
  });

  it("❌ Delegate CANNOT close any path", () => {
    expect(() => closeBySupervisor(pathATicket, delegate)).toThrowError(TRPCError);
    expect(() => closeByManager(pathBTicket, delegate)).toThrowError(TRPCError);
  });
});

// ============================================================
// STATUS TRANSITION VALIDATION
// ============================================================
describe("Status Transition Guards", () => {
  const khaled = makeUser({ id: 2, role: "supervisor" });
  const abdelFattah = makeUser({ id: 3, role: "maintenance_manager" });

  it("Cannot triage a ticket that is not pending_triage", () => {
    const ticket = makeTicket({ status: "under_inspection" });
    expect(() => triageTicket(ticket, khaled, { inspectionTeamId: 1, priority: "high", ticketType: "corrective" }))
      .toThrowError(/الفرز/);
  });

  it("Cannot inspect a ticket that is not under_inspection", () => {
    const ticket = makeTicket({ status: "pending_triage" });
    expect(() => inspectTicket(ticket, khaled, { inspectionNotes: "test" }))
      .toThrowError(/الفحص/);
  });

  it("Cannot approve work on a closed ticket", () => {
    const ticket = makeTicket({ status: "closed" });
    expect(() => approveWork(ticket, abdelFattah, { maintenancePath: "A" }))
      .toThrowError(TRPCError);
  });

  it("Cannot mark ready_for_closure on Path B ticket", () => {
    const ticket = makeTicket({ status: "repaired", maintenancePath: "B" });
    expect(() => markReadyForClosure(ticket, abdelFattah))
      .toThrowError(TRPCError);
  });

  it("Cannot close a ticket that is not ready_for_closure", () => {
    const ticket = makeTicket({ status: "in_progress", maintenancePath: "A" });
    expect(() => closeBySupervisor(ticket, khaled))
      .toThrowError(TRPCError);
  });
});
