import React from "react";
vi.mock("../../client/src/pages/tickets/ExternalRouteReviewPanel", () => ({ ExternalRouteReviewPanel: () => null }));
// Financial reads are verified separately; retain this fixture's execution-only boundary.
vi.mock("../../client/src/components/inventory/MaterialCostPanel", () => ({ MaterialCostPanel: () => null }));
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createDemo } from "../../server/maintenance-team-tickets/testing/fixture";

const fixture = vi.hoisted(() => ({
  state: null as any,
  balances: [] as any[],
}));
vi.mock("../../client/src/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      client: {},
      ticketTeamExecution: { balances: { invalidate: vi.fn() } },
      ticketTeamAssignments: {
        queue: { invalidate: vi.fn() },
        warehouseRequests: { invalidate: vi.fn() },
      },
    }),
    ticketTeamExecution: {
      details: {
        useQuery: () => ({
          data: fixture.state,
          isLoading: false,
          error: null,
          refetch: vi.fn(),
        }),
      },
      catalog: { useQuery: () => ({ data: [], error: null }) },
      units: { useQuery: () => ({ data: [], error: null }) },
      preview: {
        useQuery: () => ({ data: null, error: null, isFetching: false }),
      },
      balances: { useQuery: () => ({ data: fixture.balances, error: null }) },
    },
  },
}));
import { ExecutionPanel } from "../../client/src/pages/maintenance-teams/ExecutionPanel";

async function render(
  role: string,
  stage = "action_required",
  materials = false,
  actorId = 1,
  mode: "execution" | "warehouse" = "execution",
  warehouseSection?: "waiting" | "ready" | "returns"
) {
  const demo = createDemo(),
    initial = await demo.store.read(),
    t = initial.tickets[0];
  await demo.service.assign(1, { ...t, teamId: 21 });
  fixture.state = await demo.store.read();
  const a = fixture.state.assignments[0];
  a.stage = stage;
  if (materials)
    fixture.state.needs.push({
      id: 12,
      assignmentId: a.id,
      catalogItemId: 101,
      name: "فلتر أصلي",
      unit: "قطعة",
      requested: 3,
      requestedById: 3,
      used: 2,
      round: 1,
    });
  return renderToStaticMarkup(
    <ExecutionPanel
      assignmentId={a.id}
      actorId={actorId}
      mode={mode}
      warehouseSection={warehouseSection}
      role={role}
      language="ar"
      onChanged={() => {}}
    />
  );
}
describe("production execution UI rendered with mock queries only", () => {
  it("offers construction manager only result approval for the owned construction assignment", async () => {
    await render("construction_procurement_manager", "awaiting_review", false, 90);
    const a = fixture.state.assignments[0]; a.responsibleManagerId = 90;
    Object.assign(fixture.state.tickets[0], { responsibleDepartment: "maintenance_report_department_construction", ticketManagerId: 90, itemResponsibleDepartment: "maintenance_report_department_construction", itemResponsibleManagerId: 90 });
    const show = (actorId: number) => renderToStaticMarkup(<ExecutionPanel assignmentId={a.id} actorId={actorId} role="construction_procurement_manager" language="ar" onChanged={() => {}} />);
    expect(show(90)).toContain("اعتماد نتيجة الفريق");
    expect(show(90)).not.toContain("إعادة للفريق");
    expect(show(91)).not.toContain("اعتماد نتيجة الفريق");
    fixture.state.tickets[0].ticketManagerId = 91;
    expect(show(90)).not.toContain("اعتماد نتيجة الفريق");
    fixture.state.tickets[0].ticketManagerId = 90; a.stage = "closed";
    expect(show(90)).toContain("متابعة اعتماد وإغلاق البلاغ");
  });
  it("shows translated action notes and falls back to the original without changing it", async () => {
    await render("technician", "awaiting_review", false, 3);
    const a = fixture.state.assignments[0];
    fixture.state.actions.push({ id: 991, assignmentId: a.id, actorId: 3, kind: "fixed", note: "تم إصلاح المحرك", translatedNote: "Motor repaired", at: new Date().toISOString(), revision: 2, operationKey: "translated" });
    const show = () => renderToStaticMarkup(<ExecutionPanel assignmentId={a.id} actorId={3} role="technician" language="en" onChanged={() => {}} />);
    expect(show()).toContain("Motor repaired");
    delete fixture.state.actions.at(-1).translatedNote;
    expect(show()).toContain("تم إصلاح المحرك");
  });
  it("ready section selects a real team recipient and issues without duplicate technician confirmation", async () => {
    fixture.balances = [{ needId: 12, branch: 3, main: 0 }];
    const html = await render(
      "warehouse",
      "waiting_material",
      true,
      2,
      "warehouse",
      "ready"
    );
    expect(html).toContain("المستلم الفعلي");
    expect(html).toContain("أحمد");
    expect(html).toContain("خالد");
    expect(html).toContain("صرف كامل الاحتياج للمهمة");
    expect(html).not.toContain("تحويل النقص إلى مخزن الفريق");
    expect(html).not.toContain("أؤكد استلام");
    fixture.balances = [];
  });
  it("ready material is excluded from processing section", async () => {
    fixture.balances = [{ needId: 12, branch: 3, main: 0 }];
    const html = await render(
      "warehouse",
      "waiting_material",
      true,
      2,
      "warehouse",
      "waiting"
    );
    expect(html).not.toContain("فلتر أصلي");
    expect(html).not.toContain("إنشاء طلب شراء للعجز");
    fixture.balances = [];
  });
  it.each(["warehouse", "owner", "admin"])(
    "%s has material processing controls without technician actions in warehouse mode",
    async role => {
      fixture.balances = [{ needId: 12, branch: 0, main: 0 }];
      const html = await render(
        role,
        "waiting_material",
        true,
        99,
        "warehouse"
      );
      expect(html).toContain("فلتر أصلي");
      expect(html).not.toContain("تحويل النقص إلى مخزن الفريق");
      expect(html).toContain("إنشاء طلب شراء للعجز");
      fixture.balances = [];
      expect(html).not.toContain("أؤكد استلام كامل المتبقي لنفسي");
      expect(
        await render(role, "action_required", false, 99, "warehouse")
      ).not.toContain("تم الإصلاح");
      expect(
        await render(role, "awaiting_review", true, 1, "warehouse")
      ).not.toContain("اعتماد نتيجة الفريق");
    }
  );
  it("technician sees all five choices in the original theme components", async () => {
    const html = await render("technician");
    for (const label of [
      "سليم",
      "تم الإصلاح",
      "تحتاج مواد",
      "يوجد عائق",
      "صيانة خارجية",
    ])
      expect(html).toContain(label);
    expect(html).toContain('data-slot="button"');
    expect(html).not.toContain("SIMULATE");
  });
  it("waiting technician sees material name, unit and quantities without manager approval buttons", async () => {
    fixture.balances = [{ needId: 12, branch: 3, main: 0 }];
    const html = await render("technician", "waiting_material", true);
    fixture.balances = [];
    expect(html).toContain("فلتر أصلي");
    expect(html).toContain("قطعة");
    expect(html).toContain("استلام المواد من مخزن الفريق");
    expect(html).not.toContain("اعتماد نتيجة الفريق");
  });
  it("responsible manager sees evidence and approve/return options at review", async () => {
    const html = await render("maintenance_manager", "awaiting_review", true);
    expect(html).toContain("اعتماد نتيجة الفريق");
    expect(html).toContain("إعادة للفريق");
    expect(html).toContain("فلتر أصلي");
    expect(html).not.toContain("تأكيد استلام المرتجع للمستودع");
  });
  it.each([
    "owner",
    "admin",
    "maintenance_manager",
    "general_maintenance_manager",
    "construction_procurement_manager",
  ])("%s sees all five execution choices without membership", async role => {
    const html = await render(role, "action_required", false, 99);
    for (const label of [
      "سليم",
      "تم الإصلاح",
      "تحتاج مواد",
      "يوجد عائق",
      "صيانة خارجية",
    ])
      expect(html).toContain(label);
  });
  it.each([
    "maintenance_manager",
    "general_maintenance_manager",
    "construction_procurement_manager",
  ])(
    "%s can receive materials but cannot approve another manager's assignment",
    async role => {
      fixture.balances = [{ needId: 12, branch: 3, main: 0 }];
      expect(await render(role, "waiting_material", true, 99)).toContain(
        "استلام المواد من مخزن الفريق"
      );
      fixture.balances = [];
      const html = await render(role, "awaiting_review", true, 99);
      expect(html).not.toContain("اعتماد نتيجة الفريق");
      expect(html).not.toContain("إعادة للفريق");
      expect(html).not.toContain("تأكيد استلام المرتجع للمستودع");
    }
  );
  it("execution completed links to current ticket closure without claiming actual ticket closure", async () => {
    const html = await render("maintenance_manager", "closed");
    expect(html).toContain("اكتمل تنفيذ الفريق");
    expect(html).toContain("متابعة اعتماد وإغلاق البلاغ");
    expect(html).not.toContain("مغلقة باعتماد المسؤول");
  });
});
