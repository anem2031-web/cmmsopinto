import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
const f = vi.hoisted(() => ({ values: [] as any[], index: 0, buttons: new Map<string, any>(), fields: new Map<string, any>(), commandItems: new Map<string, any>(), search: null as any, navigate: vi.fn() }));
vi.mock("react", async original => {
  const actual = await original<typeof import("react")>();
  return { ...actual, useState: (initial: any) => {
    const index = f.index++; if (!(index in f.values)) f.values[index] = typeof initial === "function" ? initial() : initial;
    return [f.values[index], (next: any) => { f.values[index] = typeof next === "function" ? next(f.values[index]) : next; }];
  } };
});
vi.mock("../../client/src/pages/maintenance-teams/team-execution-navigation", () => ({ useOpenTeamExecution: () => f.navigate }));
const text = (x: any): string => x == null || typeof x === "boolean" ? "" : Array.isArray(x) ? x.map(text).join("") : typeof x === "object" ? text(x.props?.children) : String(x);
vi.mock("../../client/src/components/ui/button", async original => {
  const actual = await original<any>();
  return { ...actual, Button: (props: any) => { f.buttons.set(text(props.children), props); return <actual.Button {...props} />; } };
});
vi.mock("../../client/src/components/ui/input", async original => {
  const actual = await original<any>();
  return { Input: (props: any) => { f.fields.set(props.id, props); return <actual.Input {...props} />; } };
});
vi.mock("../../client/src/components/ui/textarea", async original => {
  const actual = await original<any>();
  return { Textarea: (props: any) => { f.fields.set(props.placeholder ?? "dependency", props); return <actual.Textarea {...props} />; } };
});
vi.mock("../../client/src/components/ui/alert-dialog", () => ({
  AlertDialog: (p: any) => p.open ? <div role="alertdialog">{p.children}</div> : null,
  AlertDialogDescription: (p: any) => <p>{p.children}</p>,
  AlertDialogContent: (p: any) => <div>{p.children}</div>, AlertDialogHeader: (p: any) => <div>{p.children}</div>, AlertDialogTitle: (p: any) => <h2>{p.children}</h2>, AlertDialogFooter: (p: any) => <div>{p.children}</div>,
  AlertDialogCancel: (p: any) => <button {...p} />,
  AlertDialogAction: (p: any) => { f.buttons.set(text(p.children), p); return <button {...p} />; },
}));
vi.mock("../../client/src/components/ui/popover", () => ({ Popover: (p: any) => <div>{p.children}</div>, PopoverTrigger: (p: any) => <div>{p.children}</div>, PopoverContent: (p: any) => <div className={p.className}>{p.children}</div> }));
vi.mock("../../client/src/components/ui/command", () => ({
  Command: (p: any) => <div>{p.children}</div>, CommandInput: (p: any) => { f.search = p.onValueChange; return <input placeholder={p.placeholder} value={p.value} readOnly />; },
  CommandList: (p: any) => <div>{p.children}</div>, CommandEmpty: (p: any) => <p>{p.children}</p>, CommandGroup: (p: any) => <div>{p.heading}{p.children}</div>,
  CommandItem: (p: any) => { f.commandItems.set(p.value, p); return <button disabled={p.disabled}>{p.children}</button>; },
}));
import { TicketExecutionControls } from "../../client/src/pages/maintenance-teams/TicketExecutionControls";
import { TicketExecutionTasksView } from "../../client/src/pages/maintenance-teams/TicketExecutionTasksView";
import { TicketMaterialCatalogPicker } from "../../client/src/pages/maintenance-teams/TicketMaterialCatalogPicker";
import { TicketTechnicianMaterials } from "../../client/src/pages/maintenance-teams/TicketTechnicianMaterials";
import type { Snapshot, Assignment } from "../../shared/maintenance-team-tickets/model";
const assignment = (): Assignment => ({ id: 1, ticketId: 10, ticketItemId: 11, ticketNumber: "MOCK-MT-001", title: "فحص المكيف", teamId: 21, warehouseId: 20, responsibleManagerId: 9, location: { siteId: 1, sectionId: 2 }, stage: "action_required", revision: 1, materialRound: 1, assignedById: 9 });
function state(started = false): Snapshot {
  return { users: [{ id: 3, name: "فني تجريبي", role: "technician", active: true }, { id: 4, name: "فني آخر", role: "technician", active: true }], warehouses: [{ id: 20, name: "مخزن الفريق", active: true }], catalog: [], locations: [], tickets: [], teams: [], memberships: [], assignments: [assignment()], actions: started ? [{ id: 1, assignmentId: 1, actorId: 3, kind: "execution_started", note: '{"version":1,"visitKey":"mock:1"}', revision: 1, operationKey: "mock:1", at: "2026-10-13T10:00:00Z" }] : [], needs: [], deliveries: [], supplies: [], returns: [], operations: [], nextId: 10 };
}
let s: Snapshot, calls: any[], language: string, actorId: number;
function renderControls() {
  f.index = 0; f.buttons.clear(); f.fields.clear();
  return renderToStaticMarkup(<TicketExecutionControls state={s} assignment={s.assignments[0]} actorId={actorId} language={language} busy={false} onStart={async resume => { calls.push({ start: resume }); return true; }} onEndVisit={async () => { calls.push({ end: true }); return true; }} onNeedsMaterial={async () => { calls.push({ materials: true }); return true; }} onOutcome={async (outcome, input) => { calls.push({ outcome, input }); return true; }} />);
}
async function click(label: string) { const p = f.buttons.get(label); expect(p).toBeDefined(); expect(p.disabled).toBeFalsy(); p.onClick({ preventDefault() {} }); await Promise.resolve(); await Promise.resolve(); }
beforeEach(() => { f.values = []; f.index = 0; f.commandItems.clear(); s = state(); calls = []; language = "ar"; actorId = 3; });
describe("ticket execution PMV2 UI boundaries", () => {
  it("renders the five choices in native theme but prevents results until start", async () => {
    const html = renderControls(); for (const label of ["سليم", "تم الإصلاح", "تحتاج مواد", "يوجد عائق", "صيانة خارجية"]) { expect(html).toContain(label); expect(f.buttons.get(label).disabled).toBe(true); }
    expect(html).toContain('data-slot="button"'); await click("بدء التنفيذ"); expect(calls).toEqual([{ start: false }]);
  });
  it("working technician records OK immediately through the ticket callback", async () => { s = state(true); renderControls(); await click("سليم"); expect(calls[0]).toEqual({ outcome: "ok", input: { note: "", otherMaterials: undefined, usages: [] } }); });
  it("repair needs details even though PMV2's original note is optional", async () => {
    s = state(true); renderControls(); await click("تم الإصلاح"); expect(calls).toEqual([]); expect(renderControls()).toContain("تفاصيل الإصلاح إلزامية");
    const field = [...f.fields.values()].find(p => p.placeholder?.startsWith("ملاحظات الفحص")); field.onChange({ target: { value: "إصلاح المكيف" } }); renderControls(); await click("تم الإصلاح"); expect(calls[0].input.note).toBe("إصلاح المكيف");
  });
  it("needs materials routes only through its dedicated ticket callback", async () => { s = state(true); renderControls(); await click("تحتاج مواد"); expect(calls).toEqual([{ materials: true }]); });
  it.each(["يوجد عائق", "صيانة خارجية"])("%s retains required details and current manager handoff", async label => {
    s = state(true); renderControls(); await click(label); expect(renderControls()).toContain('role="alertdialog"'); expect(f.buttons.get("حفظ وإرسال للمسؤول").disabled).toBe(true);
    f.fields.get("dependency").onChange({ target: { value: "تفاصيل مطلوبة" } }); renderControls(); await click("حفظ وإرسال للمسؤول"); expect(calls[0].outcome).toBe(label === "يوجد عائق" ? "blocked" : "external"); expect(calls[0].input.usages).toEqual([]);
  });
  it("nonparticipant sees join and cannot record results or end another leader's visit", async () => { s = state(true); actorId = 4; renderControls(); expect(f.buttons.has("إنهاء الزيارة")).toBe(false); expect(f.buttons.get("تم الإصلاح").disabled).toBe(true); await click("الانضمام للتنفيذ"); expect(calls).toEqual([{ start: false }]); });
  it("after receipt shows resume, then the same green usage card without OK or another material request", async () => {
    s = state(); s.assignments[0].stage = "ready_to_repair"; renderControls(); await click("استكمال العمل"); expect(calls).toEqual([{ start: true }]);
    s = state(true); s.assignments[0].stage = "ready_to_repair";
    s.needs = [{ id: 12, assignmentId: 1, catalogItemId: 101, name: "قاطع", originalName: "قاطع", unit: "قطعة", requested: 4, requestedById: 3, warehouseId: 20, round: 1, used: null }];
    s.deliveries = [{ id: 5, needId: 12, deliveryId: 10, deliveryNumber: "MOCK-DLV-1", lotId: 1, inventoryTransactionId: 2, quantity: 4, receivedById: 3, used: null, returned: 0 }];
    const html = renderControls(); expect(html).toContain("border-emerald-200"); expect(f.fields.get("used-12").value).toBe(""); expect(f.buttons.has("سليم")).toBe(false); expect(f.buttons.has("تحتاج مواد")).toBe(false);
    f.fields.get("used-12").onChange({ target: { value: "3" } }); const field = [...f.fields.values()].find(p => p.placeholder?.startsWith("ملاحظات الفحص")); field.onChange({ target: { value: "تفاصيل الإصلاح" } });
    expect(renderControls()).toContain("المرتجع: 1"); await click("تم الإصلاح — حفظ الاستخدام"); expect(calls.at(-1).input.usages).toEqual([{ catalogItemId: 101, used: 3 }]);
  });
  it("only leader can end a waiting or reviewed visit and result remains separate from ticket closure", async () => { s = state(true); s.assignments[0].stage = "awaiting_review"; renderControls(); expect(f.buttons.get("إنهاء الزيارة").disabled).toBe(false); await click("إنهاء الزيارة"); expect(calls).toEqual([{ end: true }]); });
  it.each(["en", "ur"])("keeps PMV2 labels and buttons in %s", lang => { language = lang; const html = renderControls(); expect(html).not.toContain("بدء التنفيذ"); expect(html).toContain('data-slot="button"'); });
  it("material combobox searches inside the popup, displays stock, and blocks duplicate selection", () => {
    const items = [{ id: 101, name: "قاطع", code: "CAT-101", unit: "قطعة", availableQuantity: 5 }, { id: 102, name: "فلتر", code: "CAT-102", unit: "قطعة", availableQuantity: 0 }];
    const picked = vi.fn(), search = vi.fn(); f.index = 0;
    const html = renderToStaticMarkup(<TicketMaterialCatalogPicker items={items} selected={null} search="" onSearch={search} onSelect={picked} blockedIds={[102]} loading={false} disabled={false} language="ar" />);
    expect(html).toContain('role="combobox"'); expect(html).toContain("اقتراحات"); expect(html).toContain("5 قطعة");
    f.search("CAT"); expect(search).toHaveBeenCalledWith("CAT");
    f.commandItems.get("فلتر  CAT-102").onSelect(); expect(picked).not.toHaveBeenCalled(); f.commandItems.get("قاطع  CAT-101").onSelect(); expect(picked).toHaveBeenCalledWith(items[0]);
  });
  it("only complete available stock exposes technician receipt; partial stock leaves a waiting card", () => {
    s.assignments[0].stage = "waiting_material"; s.needs = [{ id: 12, assignmentId: 1, catalogItemId: 101, name: "قاطع", originalName: "قاطع", unit: "قطعة", requested: 4, requestedById: 3, warehouseId: 20, round: 1, used: null }];
    const render = (branch: number) => renderToStaticMarkup(<TicketTechnicianMaterials state={s} assignment={s.assignments[0]} balances={[{ needId: 12, branch, main: 10 }]} busy={false} language="ar" onReceive={async () => true} />);
    expect(render(3)).not.toContain("استلام المواد من مخزن الفريق"); expect(render(4)).toContain("استلام المواد من مخزن الفريق");
  });
  it("renders only selected ticket execution and preserves independent document number in PMV2 card layout", () => {
    const tickets = [1, 2].map(id => ({ assignmentId: id, ticketId: id + 10, ticketNumber: `MOCK-MT-${id}`, title: "فحص المكيف", teamId: 21, teamName: "فريق الصيانة", warehouseName: "مخزن الفريق", stage: "action_required" as const, sourceStatus: "under_inspection", siteName: "موقع تجريبي", sectionName: "قسم تجريبي", description: "وصف البلاغ" }));
    const render = vi.fn(x => <p>{`EXEC-${x.assignmentId}`}</p>); f.index = 0;
    const html = renderToStaticMarkup(<TicketExecutionTasksView tickets={tickets} language="ar" renderExecution={render} />);
    expect(html).toContain("md:grid-cols-2"); expect(html).toContain("MOCK-MT-1"); expect(render).not.toHaveBeenCalled();
    expect(html).not.toContain("EXEC-1"); expect(html).not.toContain("EXEC-2");
    expect(fs.readFileSync("client/src/pages/maintenance-teams/TicketExecutionTasksView.tsx", "utf8")).toContain("openExecution(ticket.assignmentId)");
  });
  it("saves native-theme fixture preview for visual review without network or a database", () => {
    s = state(true); const html = renderControls();
    fs.writeFileSync("tools/ticket-execution-parity/artifacts/preview.html", `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><link rel="stylesheet" href="/styles.css"></head><body class="bg-background p-6"><div class="mx-auto max-w-5xl space-y-4"><p class="rounded-md border border-amber-300 bg-amber-50 p-3">معاينة ببيانات وهمية — ليست متصلة بالبرنامج أو قاعدة البيانات.</p><section class="rounded-xl border bg-card p-6"><h1 class="text-xl font-bold mb-3">تذاكر الصيانة — MOCK-MT-001</h1>${html}</section></div></body></html>`);
  });
});
