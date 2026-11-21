import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { buildDashboard, dashboardSummary } from "../../shared/dashboard-overview";
import { fixture, FILTERS, NOW } from "../../tools/dashboard-development/fixture";

const state = vi.hoisted(() => ({ role: "owner", summary: null as any }));
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: 1, name: "المالك", role: state.role }, authenticatedUser: { id: 1, role: state.role }, loading: false }) }));
vi.mock("@/contexts/LanguageContext", () => ({ useTranslation: () => ({ language: "ar", t: { dashboard: { title: "لوحة التحكم الرئيسية" }, roles: { owner: "مالك", warehouse: "المستودع" }, poItemStatus: {}, ticketStatus: {} } }) }));
vi.mock("wouter", () => ({ useLocation: () => ["/", vi.fn()], Link: ({ children }: any) => children }));
vi.mock("@/lib/trpc", () => ({ trpc: { dashboard: { overview: { useQuery: () => ({ data: state.summary, isLoading: false, isPlaceholderData: false, isFetching: false, refetch: vi.fn() }) }, details: { useQuery: () => ({}) } } } }));
import FollowupDashboard from "../../client/src/pages/dashboard/FollowupDashboard";

describe("owner dashboard presentation", () => {
  it("shows seven explanatory cards and preserves the next report stages", () => {
    state.role = "owner"; state.summary = { ...dashboardSummary(buildDashboard(fixture(), FILTERS, NOW)), snapshotId: "snapshot" };
    const html = renderToStaticMarkup(React.createElement(FollowupDashboard));
    for (const text of ["أعمال متأخرة", "بلاغات بانتظار الفرز والتصنيف", "بانتظار إسناد الفريق", "بانتظار بدء الفني", "الفني يعمل", "مشتريات مرتبطة ببلاغات", "تذاكر صيانة مغلقة", "أعمال تجاوزت المدة أو الموعد المحدد لها.", "المراحل التالية للبلاغات", "تذاكر بانتظار المواد", "عائق بانتظار المسؤول"]) expect(html).toContain(text);
  });
  it("does not render the dashboard for a warehouse user", () => {
    state.role = "warehouse";
    expect(renderToStaticMarkup(React.createElement(FollowupDashboard))).toBe("");
  });
});
