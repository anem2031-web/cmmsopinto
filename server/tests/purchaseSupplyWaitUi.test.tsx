import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const ui = vi.hoisted(() => ({ actor: { id: 10, role: "delegate", isActive: 1 }, language: "ar", available: true,
  serverNow: "2026-11-08T10:00:00.000Z", entries: [] as any[], requests: [] as any[], error: false, responseRole: null as string | null }));
vi.mock("../../client/src/_core/hooks/useAuth", () => ({ useAuth: () => ({ user: ui.actor, authenticatedUser: ui.actor }) }));
vi.mock("../../client/src/contexts/LanguageContext", () => ({ useTranslation: () => ({ language: ui.language }) }));
vi.mock("../../client/src/lib/trpc", () => ({ trpc: {
  useQueries: (factory: any) => factory({ purchaseSupplyWait: { list: (input: any) => {
    ui.requests.push(input);
    return { data: { available: ui.available, viewerId: ui.actor.id, viewerRole: ui.responseRole || ui.actor.role, serverNow: ui.serverNow,
      items: ui.entries.filter(entry => input.items.some((item: any) => item.itemId === entry.itemId && item.purchaseOrderId === entry.purchaseOrderId)) },
      dataUpdatedAt: Date.now(), isError: ui.error };
  } } }),
  useUtils: () => ({ purchaseSupplyWait: { invalidate: vi.fn() } }),
  purchaseSupplyWait: { save: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) } },
} }));
import { SupplyWaitExplanation, SupplyWaitProvider } from "../../client/src/components/purchase/SupplyWaitExplanation";
import { purchaseSupplyWaitText } from "../../client/src/i18n/purchaseSupplyWait";
const note = { kind: "preparing", expectedReceiptDate: "2026-11-12", reason: "تصنيع الصنف لدى المورد", createdById: 10,
  createdByName: "المندوب", createdAt: "2026-11-08T10:00:00.000Z", updatedById: 10, updatedByName: "المندوب", updatedAt: "2026-11-08T10:00:00.000Z",
  revision: 0, editableUntil: "2026-11-08T12:00:00.000Z", canEdit: true };
function render(items = [{ id: 1, purchaseOrderId: 100 }]) {
  return renderToStaticMarkup(<SupplyWaitProvider items={items}>{items.map(item => <SupplyWaitExplanation key={item.id} itemId={item.id} purchaseOrderId={item.purchaseOrderId} />)}</SupplyWaitProvider>);
}
beforeEach(() => { ui.actor = { id: 10, role: "delegate", isActive: 1 }; ui.language = "ar"; ui.available = true;
  ui.entries = [{ itemId: 1, purchaseOrderId: 100, canCreate: true, note: null }]; ui.serverNow = "2026-11-08T10:00:00.000Z"; ui.requests = []; ui.error = false; ui.responseRole = null; });
describe("supply wait item UI", () => {
  it.each(["delegate", "delegate_manager"])("shows the optional blue press-effect button for %s", role => {
    ui.actor.role = role; const html = render(); expect(html).toContain("توضيح انتظار التوريد"); expect(html).toContain("bg-blue-600"); expect(html).toContain("active:scale-95");
    expect(html).not.toContain("تصنيع الصنف");
  });
  it.each(["ar", "en", "ur"] as const)("localizes the addition in %s without changing user reason text", language => {
    ui.language = language; ui.entries[0] = { ...ui.entries[0], canCreate: false, note }; const html = render();
    expect(html).toContain(purchaseSupplyWaitText[language].preparing); expect(html).toContain(note.reason); expect(html).toContain(note.createdByName);
  });
  it("renders the date/reason and available edit, then hides stale edit at the server deadline", () => {
    ui.entries[0] = { ...ui.entries[0], canCreate: false, note }; expect(render()).toContain("تعديل توضيح انتظار التوريد");
    ui.serverNow = "2026-11-08T12:00:00.000Z";
    const html = render(); expect(html).toContain(note.reason); expect(html).toContain(note.expectedReceiptDate); expect(html).not.toContain("تعديل توضيح انتظار التوريد");
  });
  it.each(["admin", "owner"])("keeps editing visible for %s after the deadline", role => {
    ui.actor.role = role; ui.entries[0] = { ...ui.entries[0], canCreate: false, note }; ui.serverNow = "2026-11-10T12:00:00.000Z";
    expect(render()).toContain("تعديل توضيح انتظار التوريد");
  });
  it("does not render hidden note content or controls for a requester before publication", () => {
    ui.actor = { id: 20, role: "warehouse", isActive: 1 }; ui.entries[0] = { ...ui.entries[0], canCreate: false, note: null };
    const html = render(); expect(html).not.toContain(note.reason); expect(html).not.toContain(note.expectedReceiptDate); expect(html).not.toContain("توضيح انتظار التوريد");
  });
  it("shows a published explanation read-only for the actual reviewer", () => {
    ui.actor = { id: 30, role: "senior_management", isActive: 1 }; ui.entries[0] = { ...ui.entries[0], canCreate: false, note: { ...note, canEdit: false } };
    const html = render(); expect(html).toContain(note.reason); expect(html).not.toContain("تعديل توضيح انتظار التوريد");
  });
  it("uses a bounded list query with a distinct authenticated viewer key, not a query per item", () => {
    render(Array.from({ length: 1200 }, (_, index) => ({ id: index + 1, purchaseOrderId: 100 })));
    expect(ui.requests.map(request => request.items.length)).toEqual([500, 500, 200]); expect(ui.requests.every(request => request.viewerId === 10)).toBe(true);
  });
  it("does not mount the addition for an observer or inactive account", () => {
    ui.actor.role = "observer"; expect(render()).not.toContain("توضيح انتظار التوريد"); expect(ui.requests).toHaveLength(0);
    ui.actor = { id: 10, role: "delegate", isActive: 0 }; render(); expect(ui.requests).toHaveLength(0);
  });
  it("keeps existing UI usable before the optional migration", () => {
    ui.available = false; ui.entries = []; expect(render()).not.toContain("توضيح انتظار التوريد");
  });
  it("does not reuse an old admin projection after the same account's role changes", () => {
    ui.actor.role = "warehouse"; ui.responseRole = "admin"; ui.entries[0] = { ...ui.entries[0], canCreate: false, note };
    expect(render()).not.toContain(note.reason); expect(render()).not.toContain("تعديل توضيح انتظار التوريد");
  });
  it("shows a scoped read failure without inventing an empty success", () => {
    ui.error = true; expect(render()).toContain("تعذر تحميل توضيحات انتظار التوريد");
  });
});
