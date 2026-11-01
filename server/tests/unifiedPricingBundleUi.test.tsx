import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import fs from "node:fs";
const state = vi.hoisted(() => ({
  role: "accountant",
  values: [] as any[],
  cursor: 0,
  buttons: [] as any[],
  inputs: [] as any[],
  areas: [] as any[],
  calls: [] as any[],
  stage: "pending_accounting",
  detailUnavailable: false,
  rejectedIds: [] as number[],
  mutationResults: [] as any[],
  navigation: [] as string[],
  queueEnabled: true,
  effects: [] as Array<() => void>,
  savedFollowup: false,
  savedById: 7,
}));
vi.mock("react", async () => ({
  ...(await vi.importActual<typeof import("react")>("react")),
  useEffect: (effect: () => void) => {
    state.effects.push(effect);
  },
  useState: (initial: any) => {
    const index = state.cursor++;
    if (!(index in state.values))
      state.values[index] = typeof initial === "function" ? initial() : initial;
    return [
      state.values[index],
      (value: any) => {
        state.values[index] =
          typeof value === "function" ? value(state.values[index]) : value;
      },
    ];
  },
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () =>
      Object.fromEntries(
        ["delegatePricingBundles", "purchaseOrders", "purchasePackages"].map(
          key => [key, { invalidate: async () => {} }]
        )
      ),
    delegatePricingBundles: {
      status: {
        useQuery: () => ({ data: { enabled: true, approvalEnabled: true } }),
      },
      list: {
        useQuery: () => {
          throw Error("Archive must not load in selected-only review");
        },
      },
      approvalQueue: {
        useQuery: (_input: any, options: any) => {
          state.queueEnabled = options.enabled;
          return {
            data: {
              items: [
                {
                  id: 24,
                  bundleNumber: "DPB-2026-000024",
                  status: state.stage,
                  orderIds: [101, 102, 103],
                },
              ],
              nextId: null,
            },
          };
        },
      },
      approvalDetail: {
        useQuery: () => ({
          data: state.detailUnavailable
            ? undefined
            : {
                id: 24,
                bundleNumber: "DPB-2026-000024",
                status: state.stage,
                revision: 0,
                custodyBalance:
                  state.stage === "pending_accounting" ? null : "45538.00",
                delegateName: "Test delegate",
                accountingApprovedById: state.savedFollowup
                  ? state.savedById
                  : null,
                accountingEffectsDone: !state.savedFollowup,
                managementEffectsDone: true,
                rejections: state.rejectedIds.map(itemId => ({
                  itemId,
                  reason: "Already rejected by accounting",
                })),
                items: Array.from({ length: 8 }, (_, n) => ({
                  id: n + 1,
                  itemName: `صنف ${n + 1}`,
                  purchaseOrderId: n === 0 ? 101 : n < 4 ? 102 : 103,
                  poNumber: n === 0 ? "PR-101" : n < 4 ? "PR-102" : "PR-103",
                  packageNumber: n === 0 ? "PB-A" : "PB-B",
                  quantity: 1,
                  unit: "قطعة",
                  estimatedTotalCost: "100.00",
                  currentStatus: state.rejectedIds.includes(n + 1)
                    ? "rejected"
                    : "estimated",
                })),
              },
        }),
      },
      approveAccounting: {
        useMutation: () => ({
          isPending: false,
          mutateAsync: async (payload: any) => {
            state.calls.push({ stage: "accounting", payload });
            const result = state.mutationResults.shift() || {
              effectsDone: true,
              status: "pending_management",
            };
            if (result instanceof Error) throw result;
            return result;
          },
        }),
      },
      approveManagement: {
        useMutation: () => ({
          isPending: false,
          mutateAsync: async (payload: any) => {
            state.calls.push({ stage: "management", payload });
            const result = state.mutationResults.shift() || {
              effectsDone: true,
              status: "approved",
            };
            if (result instanceof Error) throw result;
            return result;
          },
        }),
      },
      resumeApproval: {
        useMutation: () => ({
          isPending: false,
          mutateAsync: async (payload: any) => {
            state.calls.push({ stage: `resume:${payload.stage}`, payload });
            return { effectsDone: true, status: "pending_management" };
          },
        }),
      },
    },
  },
}));
vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: 7, role: state.role, isActive: 1 } }),
}));
vi.mock("wouter", () => ({
  useSearch: () => "?approval=24",
  useLocation: () => [
    "/delegate-pricing-bundles",
    (path: string) => state.navigation.push(path),
  ],
  Link: ({ href, children }: any) => <a href={href}>{children}</a>,
}));
vi.mock("@/contexts/LanguageContext", () => ({
  useTranslation: () => ({ language: "ar", dir: "rtl" }),
}));
vi.mock("@/components/ui/button", () => ({
  Button: (props: any) => {
    state.buttons.push(props);
    return <button disabled={props.disabled}>{props.children}</button>;
  },
}));
vi.mock("@/components/ui/input", () => ({
  Input: (props: any) => {
    state.inputs.push(props);
    return (
      <input aria-label={props["aria-label"]} value={props.value} readOnly />
    );
  },
}));
vi.mock("@/components/ui/textarea", () => ({
  Textarea: (props: any) => {
    state.areas.push(props);
    return (
      <textarea aria-label={props["aria-label"]} value={props.value} readOnly />
    );
  },
}));
vi.mock("@/components/ui/card", () => ({
  Card: ({ children }: any) => <section>{children}</section>,
  CardHeader: ({ children }: any) => <header>{children}</header>,
  CardTitle: ({ children }: any) => <h3>{children}</h3>,
  CardContent: ({ children }: any) => <div>{children}</div>,
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
}));
import { UnifiedBundleApproval } from "../../client/src/components/purchase/UnifiedBundleApproval";
import DelegatePricingBundles from "../../client/src/pages/purchase/DelegatePricingBundles";
const render = (selectedOnly = false, page = false) => {
  state.cursor = 0;
  state.buttons = [];
  state.inputs = [];
  state.areas = [];
  state.effects = [];
  return renderToStaticMarkup(
    page ? (
      <DelegatePricingBundles />
    ) : (
      <UnifiedBundleApproval selectedOnly={selectedOnly} />
    )
  );
};
beforeEach(() => {
  state.role = "accountant";
  state.values = [];
  state.calls = [];
  state.stage = "pending_accounting";
  state.detailUnavailable = false;
  state.rejectedIds = [];
  state.mutationResults = [];
  state.navigation = [];
  state.savedFollowup = false;
  state.savedById = 7;
});
it("renders the queue safely before a detail loads or when no detail is available", () => {
  state.detailUnavailable = true;
  const html = render();
  expect(html).toContain("مراجعة الحزمة");
  expect(html).not.toContain("إجمالي تسعير الحزمة الأصلي");
  expect(
    state.buttons.find(row => row.children === "اعتماد وإرسال للإدارة العليا")
  ).toBeUndefined();
});
it("shows one DPB approval card, eight original item references and one free custody field with one confirmation", () => {
  const html = render(true, true);
  expect(html.match(/DPB-2026-000024/g)).toHaveLength(1);
  expect(html).not.toContain("حزم التسعير بانتظار الاعتماد");
  expect(html).not.toContain("الأرشيف");
  expect(html).toContain("رجوع إلى بانتظار إجرائي");
  expect(state.queueEnabled).toBe(false);
  expect(html).toContain("PB-A");
  expect(html).toContain("PB-B");
  expect(html.match(/رفض هذا الصنف فقط/g)).toHaveLength(8);
  expect(
    state.inputs.filter(row => row["aria-label"] === "إجمالي رصيد العهد")
  ).toHaveLength(1);
  expect(
    state.buttons.filter(row => row.children === "اعتماد وإرسال للإدارة العليا")
  ).toHaveLength(1);
  fs.mkdirSync("tools/unified-dpb-approval/artifacts", { recursive: true });
  fs.writeFileSync(
    "tools/unified-dpb-approval/artifacts/accounting-preview.html",
    `<!doctype html><html dir="rtl" lang="ar"><meta charset="utf-8"><style>body{font-family:Tahoma,sans-serif;background:#f7f9fc;margin:24px}section{background:white;border:1px solid #d9e0e8;border-radius:10px;padding:18px;margin:12px 0}table{border-collapse:collapse;width:100%}td,th{border:1px solid #dae2ea;padding:8px}button{background:#00718a;color:white;border:0;border-radius:5px;padding:10px;margin:8px}input,textarea{padding:8px;border:1px solid #b7c7d4;max-width:95%}a{color:#00718a}</style><p>معاينة اختبار معزولة — بيانات وهمية دون اتصال بقاعدة البيانات</p>${html}</html>`
  );
});
it("submits the manually entered balance once and only the selected item rejection, retaining a bundle operation key", async () => {
  render();
  state.values[2] = "45538";
  state.values[4] = { 2: "هذا الصنف غير مناسب للموقع" };
  render(true);
  await state.buttons
    .find(row => row.children === "اعتماد وإرسال للإدارة العليا")
    .onClick();
  expect(state.calls).toHaveLength(1);
  expect(state.calls[0]).toMatchObject({
    stage: "accounting",
    payload: {
      id: 24,
      custodyBalance: "45538",
      rejections: [{ itemId: 2, reason: "هذا الصنف غير مناسب للموقع" }],
    },
  });
  expect(state.calls[0].payload.operationKey).toMatch(/^[\da-f-]{36}$/);
  expect(state.navigation).toEqual(["/purchase-orders"]);
});
it("management receives only accepted items, excludes rejected totals and reasons, and confirms once without a second custody entry", async () => {
  state.role = "senior_management";
  state.stage = "pending_management";
  state.rejectedIds = [1];
  const html = render(true);
  expect(html).toContain("45538.00");
  expect(state.inputs).toHaveLength(0);
  expect(html).not.toContain("صنف 1");
  expect(html).not.toContain("Already rejected by accounting");
  expect(html).toContain("700.00");
  expect(html).not.toContain("800.00");
  await state.buttons
    .find(row => row.children === "اعتماد وإرسال للمندوب")
    .onClick();
  expect(state.calls[0].stage).toBe("management");
  expect(state.calls[0].payload).not.toHaveProperty("custodyBalance");
});
it("does not give the delegate or other unrelated roles an approval interface, or accountant a management action", () => {
  for (const role of [
    "delegate",
    "warehouse",
    "observer",
    "executive_director",
  ]) {
    state.role = role;
    expect(render()).toBe("");
  }
  state.role = "accountant";
  state.stage = "pending_management";
  render();
  expect(
    state.buttons.find(row => row.children === "اعتماد وإرسال للمندوب")
  ).toBeUndefined();
});
it("automatically resumes an unfinished committed follow-up with the identical key and returns to the inbox", async () => {
  state.mutationResults = [
    { effectsDone: false },
    { effectsDone: true, status: "pending_management" },
  ];
  const html = render(true);
  expect(html).not.toContain("استكمال متابعة القرار المحفوظ");
  await state.buttons
    .find(row => row.children === "اعتماد وإرسال للإدارة العليا")
    .onClick();
  expect(state.calls).toHaveLength(2);
  expect(state.calls[1].payload).toEqual(state.calls[0].payload);
  expect(state.navigation).toEqual(["/purchase-orders"]);
});
it("bounds automatic follow-up attempts and offers only the same primary action without generating a new decision", async () => {
  state.mutationResults = [
    { effectsDone: false },
    { effectsDone: false },
    { effectsDone: false },
  ];
  render(true);
  await state.buttons
    .find(row => row.children === "اعتماد وإرسال للإدارة العليا")
    .onClick();
  expect(state.calls).toHaveLength(3);
  expect(new Set(state.calls.map(call => call.payload.operationKey)).size).toBe(
    1
  );
  expect(state.navigation).toEqual([]);
  // Keep the stored operation/ref from the same mounted callback for a network-error retry.
  expect(state.values[5]).toBe(true);
});
it("does not retry validation failures or navigate away from an unsaved decision", async () => {
  state.mutationResults = [new Error("Validation failed")];
  render(true);
  await state.buttons
    .find(row => row.children === "اعتماد وإرسال للإدارة العليا")
    .onClick();
  expect(state.calls).toHaveLength(1);
  expect(state.navigation).toEqual([]);
});
it("resumes an existing committed decision after reload without a pricing or approval payload", async () => {
  state.stage = "pending_management";
  state.savedFollowup = true;
  render(true);
  state.effects[2]();
  await vi.waitFor(() =>
    expect(state.navigation).toEqual(["/purchase-orders"])
  );
  expect(state.calls).toEqual([
    { stage: "resume:accounting", payload: { id: 24, stage: "accounting" } },
  ]);
});
it("does not automatically resume another accountant's saved decision", async () => {
  state.stage = "pending_management";
  state.savedFollowup = true;
  state.savedById = 99;
  render(true);
  state.effects[2]();
  expect(state.calls).toEqual([]);
  expect(state.navigation).toEqual([]);
});
