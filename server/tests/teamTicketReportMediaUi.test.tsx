import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  hooks: [] as any[],
  index: 0,
  buttons: [] as any[],
}));
vi.mock("react", async original => ({
  ...(await original<typeof import("react")>()),
  useState: (initial: any) => {
    const index = state.index++;
    if (!(index in state.hooks)) state.hooks[index] = initial;
    return [
      state.hooks[index],
      (next: any) => {
        state.hooks[index] = next;
      },
    ];
  },
}));
vi.mock(
  "../../client/src/pages/maintenance-teams/TicketReportMedia",
  async original => {
    const actual = await original<any>();
    return {
      TicketReportMedia: (props: any) => {
        const tree = actual.TicketReportMedia(props);
        const visit = (node: any) => {
          if (Array.isArray(node)) {
            node.forEach(visit);
            return;
          }
          if (!node?.props || node.props.open === false) return;
          if (node.props.onClick) state.buttons.push(node.props);
          visit(node.props.children);
        };
        visit(tree);
        return tree;
      },
    };
  }
);
vi.mock("../../client/src/components/ui/button", () => ({
  Button: ({ children, ...props }: any) => (
    <button {...props}>{children}</button>
  ),
}));
vi.mock("../../client/src/components/ui/dialog", () => {
  const Box = ({ children }: any) => <div>{children}</div>;
  return {
    Dialog: ({ open, children }: any) =>
      open ? <div role="dialog">{children}</div> : null,
    DialogContent: ({ children }: any) => <div>{children}</div>,
    DialogHeader: Box,
    DialogTitle: Box,
    DialogDescription: Box,
  };
});
vi.mock(
  "../../client/src/components/maintenance/TechnicianExecutionWindow",
  () => ({
    TechnicianExecutionWindow: ({ children }: any) => (
      <div data-execution-window>{children}</div>
    ),
  })
);
import { TicketReportMedia } from "../../client/src/pages/maintenance-teams/TicketReportMedia";
import { TicketSequentialTasksView } from "../../client/src/pages/maintenance-teams/TicketSequentialTasksView";
const media = [
  { url: "/photo.jpg", type: "image" as const, name: "الصورة الأصلية" },
  { url: "/report.mp4", type: "video" as const, name: "الفيديو الأصلي" },
];
const render = (node: React.ReactNode) => {
  state.index = 0;
  state.buttons = [];
  return renderToStaticMarkup(node);
};
beforeEach(() => {
  state.hooks = [];
  state.index = 0;
  state.buttons = [];
});
it("shows thumbnails on the assigned card before opening execution, and preview clicks do not start work", () => {
  const execute = vi.fn(() => <p>execution</p>);
  const ticket: any = {
    assignmentId: 1,
    ticketId: 10,
    ticketNumber: "MT-TEST",
    title: "بلاغ",
    description: "تفاصيل",
    siteName: "الموقع",
    sectionName: "القسم",
    teamName: "فريق",
    warehouseName: "مخزن",
    stage: "action_required",
    reportMedia: media,
  };
  const view = (
    <TicketSequentialTasksView
      tickets={[ticket]}
      language="ar"
      renderExecution={execute}
    />
  );
  const html = render(view);
  expect(html).toContain('src="/photo.jpg"');
  expect(html).toContain('src="/report.mp4"');
  expect(execute).not.toHaveBeenCalled();
  expect(html.indexOf('src="/photo.jpg"')).toBeLessThan(
    html.indexOf("بدء التنفيذ")
  );
  state.buttons.find(b => b["aria-label"] === "عرض صورة البلاغ 1").onClick();
  expect(render(view)).toContain('role="dialog"');
  expect(execute).not.toHaveBeenCalled();
  state.buttons.find(b => b.children === "إغلاق").onClick();
  expect(render(view)).not.toContain('role="dialog"');
  expect(execute).not.toHaveBeenCalled();
});
it.each(["ar", "en", "ur"])(
  "enlarges images, opens controlled video and removes it when closed in %s",
  language => {
    const view = <TicketReportMedia media={media} language={language} />;
    render(view);
    state.buttons.filter(b => b["aria-label"])[0].onClick();
    let html = render(view);
    expect(html).toContain('role="dialog"');
    expect((html.match(/src="\/photo.jpg"/g) || []).length).toBe(2);
    state.buttons
      .find(
        b =>
          b.children ===
          (language === "ar"
            ? "إغلاق"
            : language === "en"
              ? "Close"
              : "بند کریں")
      )
      .onClick();
    render(view);
    state.buttons.filter(b => b["aria-label"])[1].onClick();
    html = render(view);
    expect(html).toContain('controls=""');
    state.buttons
      .find(
        b =>
          b.children ===
          (language === "ar"
            ? "إغلاق"
            : language === "en"
              ? "Close"
              : "بند کریں")
      )
      .onClick();
    html = render(view);
    expect(html).not.toContain('role="dialog"');
    expect(html).not.toContain('controls=""');
  }
);
it("adds no empty gallery when the report has no photos/videos", () => {
  expect(render(<TicketReportMedia language="ar" />)).toBe("");
});
