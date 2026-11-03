import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  role: "warehouse",
  language: "ar",
  loading: false,
  error: null as any,
  data: null as any,
  calls: [] as any[],
  normal: 0,
}));
vi.mock("../../client/src/lib/trpc", () => ({
  trpc: {
    ticketTeamExecution: {
      warehouseTicket: {
        useQuery: (input: any, options: any) => {
          state.calls.push({ input, options });
          return {
            data: state.data,
            error: state.error,
            isLoading: state.loading,
          };
        },
      },
    },
  },
}));
vi.mock("../../client/src/contexts/LanguageContext", () => ({
  useTranslation: () => ({
    language: state.language,
    dir: state.language === "en" ? "ltr" : "rtl",
  }),
}));
vi.mock("../../client/src/hooks/useContentTranslation", () => ({
  useStaticLabels: () => ({
    getStatusLabel: (value: string) => value,
    getPriorityLabel: (value: string) => value,
  }),
}));
import { WarehouseMaterialTicketView } from "../../client/src/pages/maintenance-teams/WarehouseMaterialTicketView";
const file = "client/src/pages/tickets/TicketDetail.tsx";
const ast = ts.createSourceFile(
  file,
  readFileSync(file, "utf8"),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX
);
const entry = ast.statements.find(
  node => ts.isFunctionDeclaration(node) && node.name?.text === "TicketDetail"
)!;
const code = ts.transpileModule(
  `(${entry.getText(ast).replace("export default ", "")})`,
  { compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 } }
).outputText;
const Page = vm.runInNewContext(code, {
  React,
  useRoute: () => [true, { id: "200" }],
  useAuth: () => ({ user: { role: state.role } }),
  APP_ROLE: { WAREHOUSE: "warehouse" },
  WarehouseMaterialTicketView,
  TicketDetailContent: () => {
    state.normal++;
    return <div>Existing ticket page</div>;
  },
});
beforeEach(() => {
  state.role = "warehouse";
  state.language = "ar";
  state.loading = false;
  state.error = null;
  state.calls = [];
  state.normal = 0;
  state.data = {
    id: 200,
    ticketNumber: "MT-TEST-01",
    title: "Repair light",
    description: "Detailed report",
    status: "in_progress",
    priority: "high",
    siteName: "Site",
    sectionName: "Section",
    teamName: "Team",
    reportMedia: [
      { url: "/api/media?key=cmms/photo.jpg", name: "Photo", type: "image" },
      { url: "/api/media?key=cmms/video.mp4", name: "Video", type: "video" },
    ],
  };
});
describe("Material-linked warehouse ticket read-only page", () => {
  it.each(["ar", "en", "ur"])(
    "renders report details and media through only the dedicated query in %s",
    language => {
      state.language = language;
      const html = renderToStaticMarkup(<Page />);
      for (const text of [
        "MT-TEST-01",
        "Repair light",
        "Detailed report",
        "Site",
        "Section",
        "Team",
        "in_progress",
        "high",
        "photo.jpg",
        "video.mp4",
      ])
        expect(html).toContain(text);
      expect(state.calls).toEqual([
        { input: { ticketId: 200 }, options: { enabled: true, retry: false } },
      ]);
      expect(state.normal).toBe(0);
      for (const action of [
        "<input",
        "<textarea",
        "بدء التنفيذ",
        "اعتماد نتيجة الفريق",
        "تأكيد الصرف",
        "تعديل البلاغ",
      ])
        expect(html).not.toContain(action);
    }
  );
  it.each([
    "admin",
    "owner",
    "technician",
    "it_member",
    "general_maintenance_manager",
    "accountant",
  ])("retains the existing page branch for %s", role => {
    state.role = role;
    expect(renderToStaticMarkup(<Page />)).toContain("Existing ticket page");
    expect(state.calls).toEqual([]);
  });
  it("does not keep previous ticket contents after a denied or missing result", () => {
    expect(renderToStaticMarkup(<Page />)).toContain("Detailed report");
    state.data = undefined;
    state.error = Error("Forbidden");
    const html = renderToStaticMarkup(<Page />);
    expect(html).toContain('role="alert"');
    expect(html).not.toContain("Detailed report");
    expect(html).not.toContain("photo.jpg");
    expect(html).toContain("العودة إلى طلبات المواد");
  });
  it("shows loading without content and disables invalid IDs", () => {
    state.loading = true;
    expect(
      renderToStaticMarkup(<WarehouseMaterialTicketView ticketId={200} />)
    ).toContain('role="status"');
    state.calls = [];
    renderToStaticMarkup(<WarehouseMaterialTicketView ticketId={0} />);
    expect(state.calls[0].options.enabled).toBe(false);
  });
});
