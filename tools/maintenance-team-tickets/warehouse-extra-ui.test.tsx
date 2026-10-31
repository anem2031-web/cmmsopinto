import React from "react";
// Financial reads are verified separately; retain this fixture's warehouse-only boundary.
vi.mock("../../client/src/components/inventory/MaterialCostPanel", () => ({ MaterialCostPanel: () => null }));
// External route review has its own permission tests; this stock-only fixture
// must not load its authentication query or any live environment.
vi.mock("../../client/src/pages/tickets/ExternalRouteReviewPanel", () => ({ ExternalRouteReviewPanel: () => null }));
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDemo } from "../../server/maintenance-team-tickets/testing/fixture";

const fixture = vi.hoisted(() => ({
  hooks: [] as any[],
  index: 0,
  inputs: new Map<string, any>(),
  buttons: new Map<string, any>(),
  state: null as any,
  detailsError: null as any,
  balances: [{ needId: 12, branch: 0, main: 0 }],
  navigate: vi.fn(),
  prepare: vi.fn(),
  issue: vi.fn(),
  provide: vi.fn(),
  selectors: new Map<string, any>(),
}));
function captureSelect(type: any, props: any) {
  if (type === "select" && props?.id) fixture.selectors.set(props.id, props);
}
vi.mock("react/jsx-runtime", async original => {
  const actual = await original<any>();
  return {
    ...actual,
    jsx: (...args: any[]) => {
      captureSelect(args[0], args[1]);
      return actual.jsx(...args);
    },
    jsxs: (...args: any[]) => {
      captureSelect(args[0], args[1]);
      return actual.jsxs(...args);
    },
  };
});
vi.mock("react/jsx-dev-runtime", async original => {
  const actual = await original<any>();
  return {
    ...actual,
    jsxDEV: (...args: any[]) => {
      captureSelect(args[0], args[1]);
      return actual.jsxDEV(...args);
    },
  };
});
vi.mock("react", async original => {
  const actual = await original<typeof import("react")>();
  return {
    ...actual,
    useState: (initial: any) => {
      const index = fixture.index++;
      if (!(index in fixture.hooks))
        fixture.hooks[index] =
          typeof initial === "function" ? initial() : initial;
      return [
        fixture.hooks[index],
        (value: any) => {
          fixture.hooks[index] =
            typeof value === "function" ? value(fixture.hooks[index]) : value;
        },
      ];
    },
  };
});
const text = (node: any): string =>
  node == null || typeof node === "boolean"
    ? ""
    : Array.isArray(node)
      ? node.map(text).join("")
      : typeof node === "object"
        ? text(node.props?.children)
        : String(node);
vi.mock("../../client/src/components/ui/input", () => ({
  Input: (props: any) => {
    fixture.inputs.set(props.id, props);
    return <input {...props} />;
  },
}));
vi.mock("../../client/src/components/ui/button", () => ({
  Button: (props: any) => {
    fixture.buttons.set(text(props.children), props);
    return (
      <button disabled={props.disabled} className={props.className}>
        {props.children}
      </button>
    );
  },
}));
vi.mock("../../client/src/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      client: {
        ticketTeamExecution: {
          prepareSupply: { mutate: fixture.prepare },
          issue: { mutate: fixture.issue },
          provide: { mutate: fixture.provide },
        },
      },
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
          error: fixture.detailsError,
          isLoading: false,
          refetch: vi.fn(),
        }),
      },
      catalog: { useQuery: () => ({ data: [] }) },
      units: { useQuery: () => ({ data: [], error: null }) },
      preview: {
        useQuery: () => ({ data: null, error: null, isFetching: false }),
      },
      balances: { useQuery: () => ({ data: fixture.balances }) },
    },
  },
}));
import { WarehousePurchaseQuantities } from "../../client/src/pages/maintenance-teams/WarehousePurchaseQuantities";
import { ExecutionPanel } from "../../client/src/pages/maintenance-teams/ExecutionPanel";
import { TicketExecutionControls } from "../../client/src/pages/maintenance-teams/TicketExecutionControls";

beforeEach(() => {
  fixture.hooks = [];
  fixture.detailsError = null;
  fixture.index = 0;
  fixture.inputs.clear();
  fixture.buttons.clear();
  fixture.navigate.mockReset();
  fixture.prepare.mockReset();
  fixture.issue.mockReset();
  fixture.provide.mockReset();
  fixture.selectors.clear();
  fixture.balances = [{ needId: 12, branch: 0, main: 0 }];
  vi.stubGlobal("window", { location: { assign: fixture.navigate } });
});
const fields = (
  extra = "3",
  purchaseQuantity: number | null = 5,
  language = "ar",
  disabled = false,
  onExtraChange = vi.fn()
) =>
  renderToStaticMarkup(
    <WarehousePurchaseQuantities
      id="test"
      technicianQuantity={5}
      purchaseQuantity={purchaseQuantity}
      extra={extra}
      unit="حبة"
      language={language}
      disabled={disabled}
      onExtraChange={onExtraChange}
    />
  );
async function initPanel() {
  const d = createDemo();
  await d.service.assign(1, {
    ...(await d.store.read()).tickets[0],
    teamId: 21,
  });
  fixture.state = await d.store.read();
  // This fixture tests stock operations, so its need and catalog must use the same unit.
  fixture.state.catalog.find((item: any) => item.id === 103).unit = "حبة";
  fixture.state.assignments[0].stage = "waiting_material";
  fixture.state.needs.push({
    id: 12,
    assignmentId: fixture.state.assignments[0].id,
    catalogItemId: 103,
    name: "حساس",
    originalName: "حساس",
    unit: "حبة",
    requested: 5,
    requestedById: 3,
    used: null,
    round: 1,
    warehouseId: 20,
  });
  fixture.prepare.mockResolvedValue({
    assignmentId: fixture.state.assignments[0].id,
    needId: 12,
    revision: 2,
    ticketId: 1001,
    ticketItemId: 5001,
    ticketNumber: "MT-1",
    catalogItemId: 103,
    name: "حساس",
    unit: "حبة",
    quantity: 5,
    location: { siteId: 1, sectionId: 11 },
    mainWarehouseId: 10,
    warehouseId: 20,
  });
}
function panel(
  role = "warehouse",
  mode: "warehouse" | "execution" = "warehouse",
  card = false
) {
  fixture.index = 0;
  return renderToStaticMarkup(
    <ExecutionPanel
      assignmentId={fixture.state.assignments[0].id}
      actorId={role === "technician" ? 3 : 2}
      role={role}
      language="ar"
      mode={mode}
      warehouseNeedId={card ? 12 : undefined}
      warehouseTicket={
        card
          ? ({
              ticketNumber: "MT-1",
              teamName: "فريق التكييف",
              warehouseName: "مخزن التكييف",
              title: "إصلاح",
              siteName: "الموقع",
              sectionName: "القسم",
            } as any)
          : undefined
      }
      onChanged={() => {}}
    />
  );
}
describe("warehouse extra quantity with isolated UI/API boundaries", () => {
  it("shows actual replacement delivery usage separately from the retained original need", async () => {
    await initPanel(); fixture.state.assignments[0].stage = "ready_to_repair";
    fixture.state.deliveries = [{ id: 1, needId: 12, deliveryId: 91, deliveryNumber: "DLV-ACTUAL", lotId: 14,
      quantity: 6, returned: 0, used: null, originalEquivalent: 5, replacementPlanId: 9, replacementName: "صنف بديل", physicalUnit: "متر" }];
    fixture.index = 0;
    const html = renderToStaticMarkup(<TicketExecutionControls state={fixture.state} assignment={fixture.state.assignments[0]} actorId={3} language="ar" busy={false}
      onStart={async () => true} onEndVisit={async () => true} onNeedsMaterial={async () => true} onOutcome={async () => true} />);
    expect(html).toContain("حساس"); expect(html).toContain("صنف بديل"); expect(html).toContain("6 متر");
    expect(fixture.inputs.has("physical-used-91")).toBe(true);
    expect(fixture.inputs.has("used-12")).toBe(false);
    expect(fixture.inputs.get("physical-used-91").max).toBe(6);
  });
  it("transfers approved replacement segments through the guarded aggregate action without trusting URL stock allocations", async () => {
    await initPanel();
    fixture.balances = [{ needId: 12, branch: 0, main: 8 }];
    const response = await fixture.prepare();
    fixture.prepare.mockClear(); fixture.prepare.mockResolvedValue({ ...response, replacementFulfillment: true, revision: 19 });
    fixture.provide.mockResolvedValue({ revision: 20 });
    panel("warehouse", "warehouse", true);
    fixture.buttons.get("تحويل النقص إلى مخزن الفريق — ٥ حبة").onClick();
    await vi.waitFor(() => expect(fixture.provide).toHaveBeenCalledOnce());
    expect(fixture.provide.mock.calls[0][0]).toMatchObject({ assignmentId: fixture.state.assignments[0].id, needId: 12, kind: "transfer", expectedRevision: 19 });
    expect(fixture.provide.mock.calls[0][0].operationKey).toMatch(/^mtt:/);
    expect(fixture.provide.mock.calls[0][0]).not.toHaveProperty("allocations");
    expect(fixture.navigate).not.toHaveBeenCalled();
  });
  it("transfer uses the PMV2 primary button and keeps ticket linkage and full shortage, without the storage extra", async () => {
    await initPanel();
    fixture.balances = [{ needId: 12, branch: 0, main: 8 }];
    panel("warehouse", "warehouse", true);
    fixture.inputs
      .get(`need-${fixture.state.assignments[0].id}-12-warehouse`)
      .onChange({ target: { value: "3" } });
    panel("warehouse", "warehouse", true);
    const button = fixture.buttons.get("تحويل النقص إلى مخزن الفريق — ٥ حبة");
    expect(button.className).toBe("w-full gap-2");
    expect(button.variant).toBeUndefined();
    expect(button.disabled).toBe(false);
    button.onClick();
    await vi.waitFor(() => expect(fixture.navigate).toHaveBeenCalledOnce());
    expect(fixture.prepare).toHaveBeenCalledWith({
      assignmentId: fixture.state.assignments[0].id,
      needId: 12,
      kind: "transfer",
    });
    const url = new URL(
      fixture.navigate.mock.calls[0][0],
      "http://mock.invalid"
    );
    expect(url.pathname).toBe("/warehouse/transfer");
    expect(url.searchParams.get("quantity")).toBe("5");
    expect(url.searchParams.get("fromWarehouseId")).toBe("10");
    expect(url.searchParams.get("toWarehouseId")).toBe("20");
    expect(url.searchParams.get("ticketTeamNeedId")).toBe("12");
    expect(url.searchParams.get("ticketItemId")).toBe("5001");
    expect(url.searchParams.has("pmv2RequestItemId")).toBe(false);
    expect(url.searchParams.has("ticketWarehouseExtraQuantity")).toBe(false);
  });
  it("a rejected transfer preparation stays on the ticket and shows the server reason", async () => {
    await initPanel();
    fixture.balances = [{ needId: 12, branch: 0, main: 8 }];
    fixture.prepare.mockRejectedValue(new Error("تغير الرصيد؛ أعد التحقق"));
    panel("warehouse", "warehouse", true);
    fixture.buttons.get("تحويل النقص إلى مخزن الفريق — ٥ حبة").onClick();
    await vi.waitFor(() =>
      expect(panel("warehouse", "warehouse", true)).toContain(
        "تغير الرصيد؛ أعد التحقق"
      )
    );
    expect(fixture.navigate).not.toHaveBeenCalled();
    expect(fixture.issue).not.toHaveBeenCalled();
  });
  it("PMV2 recipient form submits the chosen actual recipient to the ticket API with revision and operation key", async () => {
    await initPanel();
    fixture.balances = [{ needId: 12, branch: 5, main: 0 }];
    const html = panel("warehouse", "warehouse", true);
    expect(html).toContain("أحمد — طالب المادة");
    expect(html).toContain("سيُصرف الآن");
    expect(html).toContain("sm:grid-cols-[1fr_auto]");
    const selector = fixture.selectors.get(
      `ticket-recipient-${fixture.state.assignments[0].id}-12`
    );
    expect(selector.value).toBe("3");
    selector.onChange({ target: { value: "4" } });
    panel("warehouse", "warehouse", true);
    const button = fixture.buttons.get("صرف كامل الاحتياج للمهمة");
    expect(button.className).toBe("gap-2");
    expect(button.disabled).toBe(false);
    button.onClick();
    await vi.waitFor(() => expect(fixture.issue).toHaveBeenCalledOnce());
    expect(fixture.issue).toHaveBeenCalledWith({
      assignmentId: fixture.state.assignments[0].id,
      expectedRevision: fixture.state.assignments[0].revision,
      operationKey: expect.stringMatching(/^mtt:/),
      needId: 12,
      recipientId: 4,
    });
    expect(fixture.navigate).not.toHaveBeenCalled();
  });
  it("an inactive selected recipient cannot enable issuing after a fresh details read", async () => {
    await initPanel();
    fixture.balances = [{ needId: 12, branch: 5, main: 0 }];
    panel("warehouse", "warehouse", true);
    fixture.selectors
      .get(`ticket-recipient-${fixture.state.assignments[0].id}-12`)
      .onChange({ target: { value: "4" } });
    fixture.state.users.find((u: any) => u.id === 4).active = false;
    panel("warehouse", "warehouse", true);
    expect(fixture.buttons.get("صرف كامل الاحتياج للمهمة").disabled).toBe(true);
    expect(fixture.issue).not.toHaveBeenCalled();
  });
  it("closed-ticket read failure remains visible and cannot expose material actions", async () => {
    await initPanel();
    fixture.detailsError = {
      message: "أُغلق البلاغ الأصلي؛ لا يمكن متابعة التنفيذ",
    };
    const html = panel("warehouse", "warehouse", true);
    expect(html).toContain("أُغلق البلاغ الأصلي");
    expect(html).not.toContain("إنشاء طلب شراء للعجز");
    expect(html).not.toContain("صرف كامل الاحتياج للمهمة");
    expect(fixture.prepare).not.toHaveBeenCalled();
  });
  it("material card shows PMV2 sections, ticket reference and only the transfer action when main covers", async () => {
    await initPanel();
    fixture.balances = [{ needId: 12, branch: 0, main: 8 }];
    const html = panel("warehouse", "warehouse", true);
    for (const label of [
      "الكميات",
      "المخزون والوجهة",
      "تفاصيل الطلب والحالة",
      "الإجراء",
      "SIM-MT-001",
      "فريق التكييف",
      "متوفر في المستودع الرئيسي",
    ])
      expect(html).toContain(label);
    expect(html).toContain("تحويل النقص إلى مخزن الفريق");
    expect(html).toContain("— ٥ حبة");
    expect(html).not.toContain("إنشاء طلب شراء للعجز");
  });
  it("insufficient main stock shows purchase shortage and preserves requested-plus-extra fields", async () => {
    await initPanel();
    fixture.balances = [{ needId: 12, branch: 0, main: 4 }];
    panel("warehouse", "warehouse", true);
    fixture.inputs
      .get(`need-${fixture.state.assignments[0].id}-12-warehouse`)
      .onChange({ target: { value: "3" } });
    const html = panel("warehouse", "warehouse", true);
    expect(html).toContain("يحتاج استكمال / شراء");
    expect(html).toContain("إنشاء طلب شراء للعجز");
    expect(html).toContain("— ١ حبة");
    expect(html).not.toContain("تحويل النقص إلى مخزن الفريق");
    expect(
      fixture.inputs.get(`need-${fixture.state.assignments[0].id}-12-total`)
        .value
    ).toBe(8);
  });
  it("available team stock shows the real recipient and issue action", async () => {
    await initPanel();
    fixture.balances = [{ needId: 12, branch: 5, main: 4 }];
    const html = panel("warehouse", "warehouse", true);
    expect(html).toContain("جاهزة للصرف");
    expect(html).toContain("صرف كامل الاحتياج للمهمة");
    expect(html).toContain("أحمد");
    expect(html).not.toContain("إنشاء طلب شراء للعجز");
  });
  it("unmatched material retains technician totals and exposes only the PMV2 identity resolver", async () => {
    await initPanel();
    fixture.state.needs[0].catalogItemId = null;
    const html = panel("warehouse", "warehouse", true);
    expect(html).toContain("غير موجود في الدليل");
    expect(html).toContain("تحديد المادة من الدليل");
    expect(html).not.toContain("ملاحظات المطابقة (إلزامي)");
    expect(
      fixture.inputs.get(`need-${fixture.state.assignments[0].id}-12-total`)
        .value
    ).toBe(5);
    expect(fixture.buttons.has("تأكيد المطابقة")).toBe(false);
    fixture.inputs
      .get(`need-${fixture.state.assignments[0].id}-12-warehouse`)
      .onChange({ target: { value: "" } });
    panel("warehouse", "warehouse", true);
    expect(
      fixture.inputs.get(`need-${fixture.state.assignments[0].id}-12-total`)
        .value
    ).toBe(5);
  });
  it("return card preserves original lot/document and return confirmation", async () => {
    await initPanel();
    fixture.state.assignments[0].stage = "awaiting_review";
    fixture.state.needs[0].used = 2;
    fixture.state.deliveries.push({
      id: 1,
      needId: 12,
      deliveryId: 11,
      deliveryNumber: "DLV-11",
      lotId: 991,
      inventoryTransactionId: 2,
      quantity: 5,
      receivedById: 3,
      used: null,
      returned: 0,
    });
    const html = panel("warehouse", "warehouse", true);
    expect(html).toContain("مرتجع بانتظار التأكيد");
    expect(html).toContain("DLV-11");
    expect(html).toContain("991");
    expect(html).toContain("تأكيد استلام المرتجع للمستودع");
    fixture.state.catalog.find((item: any) => item.id === 103).unit = "كرتون";
    const historical = panel("warehouse", "warehouse", true);
    expect(historical).toContain("تأكيد استلام المرتجع للمستودع");
    expect(historical).toContain("DLV-11");
  });
  it("a material card never shows or submits another need in the same assignment", async () => {
    await initPanel();
    fixture.state.needs.push({
      ...fixture.state.needs[0],
      id: 13,
      name: "مادة أخرى",
    });
    expect(panel("warehouse", "warehouse", true)).not.toContain("مادة أخرى");
  });
  it("5 + 3 shows 8 with blue technician, amber extra and green total", () => {
    const html = fields();
    expect(fixture.inputs.get("test-total").value).toBe(8);
    expect(html).toContain("كمية الفني");
    expect(html).toContain("إضافة المستودع للتخزين");
    expect(html).toContain("الإجمالي — الفني + إضافة المستودع");
    expect(html).toContain("border-blue-200");
    expect(html).toContain("border-amber-200");
    expect(html).toContain("border-emerald-200");
  });
  it("technician and total are read-only; extra uses the controlled parent value", () => {
    const onChange = vi.fn();
    fields("0", 5, "ar", false, onChange);
    expect(fixture.inputs.get("test-technician").readOnly).toBe(true);
    expect(fixture.inputs.get("test-total").readOnly).toBe(true);
    fixture.inputs.get("test-warehouse").onChange({ target: { value: "3" } });
    expect(onChange).toHaveBeenCalledWith("3");
    fields("3");
    expect(fixture.inputs.get("test-total").value).toBe(8);
  });
  it("partial coverage keeps requested-plus-extra total, with actual shortage purchase explained separately", () => {
    const html = fields("3", 2);
    expect(fixture.inputs.get("test-technician").value).toBe(5);
    expect(fixture.inputs.get("test-total").value).toBe(8);
    expect(html).toContain("كمية الشراء الفعلية مع الإضافة: 5 حبة");
  });
  it("invalid or unknown inputs never invent an order total", () => {
    for (const extra of ["-1", "0.5", "NaN", "2147483647"]) {
      expect(fields(extra)).toContain('role="alert"');
      expect(fixture.inputs.get("test-total").value).toBe("—");
    }
    fields("3", null);
    expect(fixture.inputs.get("test-total").value).toBe(8);
    fields("", null);
    expect(fixture.inputs.get("test-total").value).toBe(5);
  });
  it("busy/pending controls and Arabic/English/Urdu labels are supported", () => {
    fields("3", 5, "ar", true);
    expect(fixture.inputs.get("test-warehouse").disabled).toBe(true);
    expect(fields("3", 5, "en")).toContain("Extra warehouse stock");
    expect(fields("3", 5, "ur")).toContain("گودام کے لیے اضافی اسٹاک");
  });
  it("warehouse action carries extra separately to the original purchase form", async () => {
    await initPanel();
    panel();
    const id = `need-${fixture.state.assignments[0].id}-12-warehouse`;
    fixture.inputs.get(id).onChange({ target: { value: "3" } });
    panel();
    expect(fixture.buttons.get("إنشاء طلب شراء للعجز — ٥ حبة").variant).toBe(
      "outline"
    );
    fixture.buttons.get("إنشاء طلب شراء للعجز — ٥ حبة").onClick();
    await vi.waitFor(() => expect(fixture.navigate).toHaveBeenCalledOnce());
    const url = new URL(
      fixture.navigate.mock.calls[0][0],
      "http://mock.invalid"
    );
    expect(url.pathname).toBe("/purchase-orders/new");
    expect(url.searchParams.get("ticketWarehouseExtraQuantity")).toBe("3");
    expect(url.searchParams.get("ticketTechnicianQuantity")).toBe("5");
    expect(url.searchParams.get("ticketMinimumQuantity")).toBe("5");
    expect(url.searchParams.has("pmv2RequestItemId")).toBe(false);
  });
  it("invalid extra disables purchasing and is not available to the technician", async () => {
    await initPanel();
    panel();
    fixture.inputs
      .get(`need-${fixture.state.assignments[0].id}-12-warehouse`)
      .onChange({ target: { value: "-1" } });
    panel();
    expect(fixture.buttons.get("إنشاء طلب شراء للعجز — ٥ حبة").disabled).toBe(
      true
    );
    fixture.inputs.clear();
    const html = panel("technician", "execution");
    expect(html).not.toContain("إضافة المستودع للتخزين");
  });
  it("each need has an independent warehouse extra and ready issue stays at ticket quantity", async () => {
    await initPanel();
    fixture.state.catalog.find((item: any) => item.id === 102).unit = "حبة";
    fixture.state.needs.push({
      ...fixture.state.needs[0],
      id: 13,
      catalogItemId: 102,
      requested: 2,
    });
    fixture.balances.push({ needId: 13, branch: 0, main: 0 });
    panel();
    const prefix = `need-${fixture.state.assignments[0].id}`;
    fixture.inputs
      .get(`${prefix}-12-warehouse`)
      .onChange({ target: { value: "3" } });
    panel();
    expect(fixture.inputs.get(`${prefix}-12-total`).value).toBe(8);
    expect(fixture.inputs.get(`${prefix}-13-total`).value).toBe(2);
  });
  it("a linked item with a different unit shows a review notice instead of false stock quantities or issue actions", async () => {
    await initPanel();
    fixture.state.catalog.find((item: any) => item.id === 103).unit = "كرتون";
    fixture.balances = [{ needId: 12, branch: 100, main: 100 }];
    const html = panel();
    expect(html).toContain("تم ربط الصنف"); expect(html).toContain("كرتون");
    expect(html).not.toContain("جاهزة للصرف");
    expect(fixture.buttons.has("صرف كامل الاحتياج")).toBe(false);
    expect(fixture.inputs.size).toBe(0);
  });
});
