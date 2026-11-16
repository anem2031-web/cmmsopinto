import React from "react";
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const fixture = vi.hoisted(() => ({
  search: "",
  language: "ar",
  user: { id: 2, role: "warehouse", isActive: 1 },
  rows: [] as any[],
  queryError: null as any,
  queryCalls: [] as any[],
  pmv2Renders: 0,
  pmv2QueryCalls: [] as string[],
  navigate: vi.fn(),
}));
vi.mock("wouter", () => ({
  useSearch: () => fixture.search,
  useLocation: () => [
    "/scheduled-maintenance/warehouse-requests",
    fixture.navigate,
  ],
}));
vi.mock("../../client/src/_core/hooks/useAuth", () => ({
  useAuth: () => ({ user: fixture.user, loading: false }),
}));
vi.mock("../../client/src/contexts/LanguageContext", () => ({
  useTranslation: () => ({
    language: fixture.language,
    dir: "rtl",
    t: {
      common: { loading: "جاري التحميل", refresh: "تحديث" },
      workflow: { pmv2: new Proxy({}, { get: (_target, key) => String(key) }) },
    },
  }),
}));
vi.mock("../../client/src/pages/pmv2/Pmv2WarehouseQueue", () => ({
  default: () => {
    fixture.pmv2Renders++;
    return <p>existing PMV2 queue</p>;
  },
}));
vi.mock("../../client/src/pages/maintenance-teams/ExecutionPanel", () => ({
  ExecutionPanel: (props: any) => (
    <p
      data-execution-mode={props.mode}
      data-assignment={props.assignmentId}
      data-need={props.warehouseNeedId}
    >
      {props.warehouseTicket?.ticketNumber} {props.warehouseTicket?.teamName}{" "}
      {props.warehouseTicket?.warehouseName} existing warehouse actions
    </p>
  ),
}));
vi.mock("../../client/src/lib/trpc", () => ({
  trpc: {
    pmv2: {
      warehouse: Object.fromEntries(
        [
          "waitingMaterialQueue",
          "readyToIssueQueue",
          "pendingReturns",
          "searchMaterialIdentityCandidates",
          "prepareTransferHandoff",
          "preparePurchaseHandoff",
          "resolveMaterialIdentity",
          "issueReadyRequirement",
          "linkConfirmedDelivery",
          "confirmPendingReturn",
        ].map(name => [
          name,
          {
            useQuery: () => {
              fixture.pmv2QueryCalls.push(name);
              return {
                data:
                  name === "waitingMaterialQueue"
                    ? {
                        total: 0,
                        items: [],
                        mainWarehouse: { nameAr: "الرئيسي" },
                      }
                    : name === "searchMaterialIdentityCandidates"
                      ? { items: [] }
                      : [],
                isLoading: false,
                isFetching: false,
                error: null,
                refetch: vi.fn(),
              };
            },
            useMutation: () => ({
              isPending: false,
              mutate: vi.fn(),
              mutateAsync: vi.fn(),
            }),
          },
        ])
      ),
    },
    pscmFulfillment: {
      ready: { useQuery: () => ({ data: { items: [], nextCursor: null } }) },
      recipients: { useQuery: () => ({ data: [] }) },
    },
    useUtils: () => ({
      ticketTeamExecution: {
        details: { invalidate: vi.fn() },
        balances: { invalidate: vi.fn() },
      },
    }),
    ticketTeamAssignments: {
      warehouseRequests: {
        useQuery: (_: any, options: any) => {
          fixture.queryCalls.push(options);
          return {
            data: fixture.rows,
            isLoading: false,
            isFetching: false,
            error: fixture.queryError,
            refetch: vi.fn(),
          };
        },
      },
    },
  },
}));
import WarehouseRequestsPage from "../../client/src/pages/pmv2/WarehouseRequestsPage";

const row = {
  assignmentId: 10,
  ticketId: 566,
  ticketNumber: "MT-2026-00566-01",
  title: "إصلاح وحدة التكييف",
  teamId: 21,
  teamName: "فريق التكييف",
  warehouseName: "مستودع التكييف",
  stage: "waiting_material",
  sourceStatus: "under_inspection",
  siteName: "الموقع",
  sectionName: "القسم",
  description: "طلب فلتر",
  materialNeeds: [
    { needId: 12, name: "فلتر", unit: "قطعة", section: "waiting" },
  ],
};
function render(search = "", role = "warehouse", active = 1, language = "ar") {
  Object.assign(fixture, {
    search,
    language,
    user: { id: 2, role, isActive: active },
    rows: [row],
    queryError: null,
    queryCalls: [],
    pmv2Renders: 0,
  });
  return renderToStaticMarkup(<WarehouseRequestsPage />);
}
describe("consolidated warehouse source tabs use mocked boundaries only", () => {
  it("original PMV2 component still renders its three operational tabs through original query endpoints", async () => {
    fixture.pmv2QueryCalls = [];
    const { default: OriginalQueue } = await vi.importActual<
      typeof import("../../client/src/pages/pmv2/Pmv2WarehouseQueue")
    >("../../client/src/pages/pmv2/Pmv2WarehouseQueue");
    const html = renderToStaticMarkup(<OriginalQueue />);
    expect((html.match(/role="tab"/g) ?? []).length).toBe(3);
    expect(html).toContain("needsProcessing");
    expect(html).toContain("readyForIssue");
    expect(html).toContain("returns");
    expect(fixture.pmv2QueryCalls).toEqual([
      "waitingMaterialQueue",
      "readyToIssueQueue",
      "pendingReturns",
      "searchMaterialIdentityCandidates",
    ]);
  });
  it("preserves PMV2 as default without loading ticket requests", () => {
    const html = render();
    expect(html).toContain("existing PMV2 queue");
    expect(html).toContain("تذاكر الصيانة");
    expect(fixture.pmv2Renders).toBe(1);
    expect(fixture.queryCalls).toHaveLength(0);
    expect(html).toContain('data-slot="tabs-trigger"');
  });
  it("material-notification query opens the ticket card with the existing warehouse panel", () => {
    const html = render("source=tickets&ticketId=566");
    expect(fixture.pmv2Renders).toBe(0);
    expect(fixture.queryCalls).toHaveLength(1);
    expect(fixture.queryCalls[0].enabled).toBe(true);
    for (const text of [
      "MT-2026-00566-01",
      "فريق التكييف",
      "مستودع التكييف",
      "existing warehouse actions",
    ])
      expect(html).toContain(text);
    expect(html).toContain('data-execution-mode="warehouse"');
    expect(html).toContain('data-need="12"');
  });
  it("ticket tab renders independent material cards without requiring a selected ticket", () => {
    const html = render("source=tickets");
    expect(html).toContain("MT-2026-00566-01");
    expect(html).toContain("existing warehouse actions");
    expect(html).not.toContain("existing PMV2 queue");
    for (const label of ["تحتاج معالجة", "جاهزة للصرف", "المرتجعات"])
      expect(html).toContain(label);
  });
  it.each(["owner", "admin"])("%s uses existing warehouse access", role => {
    expect(render("source=tickets&ticketId=566", role)).toContain(
      "existing warehouse actions"
    );
    expect(fixture.queryCalls[0].enabled).toBe(true);
  });
  it("technician, construction and inactive accounts cannot load warehouse requests", () => {
    for (const [role, active] of [
      ["technician", 1],
      ["construction_procurement_manager", 1],
      ["warehouse", 0],
    ] as const) {
      expect(render("source=tickets", role, active)).toContain(
        "طلبات مواد التذاكر للمستودع فقط"
      );
      expect(fixture.queryCalls[0].enabled).toBe(false);
    }
  });
  it("empty queue and query errors are visible", () => {
    render("source=tickets");
    fixture.rows = [];
    expect(renderToStaticMarkup(<WarehouseRequestsPage />)).toContain(
      "لا توجد طلبات مواد لتذاكر الصيانة في هذا القسم."
    );
    fixture.queryError = { message: "تعذر تحميل الطلبات" };
    expect(renderToStaticMarkup(<WarehouseRequestsPage />)).toContain(
      "تعذر تحميل الطلبات"
    );
  });
  it("English ticket tab retains its original document number", () => {
    const html = render("source=tickets", "warehouse", 1, "en");
    expect(html).toContain("Maintenance Tickets");
    expect(html).toContain("MT-2026-00566-01");
  });
  it("counts material needs, renders independent need IDs and caps initial cards at twenty", () => {
    render("source=tickets");
    fixture.rows = [
      {
        ...row,
        materialNeeds: Array.from({ length: 25 }, (_, i) => ({
          needId: 100 + i,
          name: "مادة",
          unit: "قطعة",
          section: "waiting",
        })),
      },
    ];
    const html = renderToStaticMarkup(<WarehouseRequestsPage />);
    expect((html.match(/data-need=/g) ?? []).length).toBe(20);
    expect(html).toContain('data-need="100"');
    expect(html).toContain('data-need="119"');
    expect(html).not.toContain('data-need="124"');
    expect(html).toContain("عرض المزيد من الاحتياجات");
    expect(html).toContain(">25</span>");
  });
});
