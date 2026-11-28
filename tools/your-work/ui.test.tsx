import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { APP_ROLE, canRoleAccessPath } from "../../shared/roles";
import vm from "node:vm";
import ts from "typescript";
import { canReadYourWork, YOUR_WORK_PATH, yourWorkOverdueAt, type YourWorkItem, type YourWorkResponse } from "../../shared/your-work";
import { yourWorkCopy, yourWorkDate, yourWorkDuration } from "../../client/src/pages/your-work/copy";

const f = vi.hoisted(() => ({
  language: "ar", actual: { id: 21, name: "ماجد", role: "warehouse", isActive: 1 } as any,
  user: null as any, loading: false, cells: [] as any[], cursor: 0,
  buttons: [] as any[], rows: [] as any[], links: [] as any[], queries: [] as any[], navigation: [] as string[],
  result: { isLoading: false, error: null, data: null } as any, effects: [] as any[], keyedResults: null as Record<string, any> | null,
}));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(), useEffect: (effect: any) => { f.effects.push(effect); }, useState: (initial: any) => {
  const index = f.cursor++;
  if (!(index in f.cells)) f.cells[index] = typeof initial === "function" ? initial() : initial;
  return [f.cells[index], (value: any) => { f.cells[index] = typeof value === "function" ? value(f.cells[index]) : value; }];
} }));
vi.mock("react/jsx-runtime", async original => {
  const runtime = await original<typeof import("react/jsx-runtime")>();
  const capture = (type: any, props: any) => {
    if (type === "button") f.buttons.push(props);
    if (type === "tr" && props["data-work-key"]) f.rows.push(props);
    if (type === "a") f.links.push(props);
  };
  return { ...runtime, jsx: (type: any, props: any, key: any) => { capture(type, props); return runtime.jsx(type, props, key); },
    jsxs: (type: any, props: any, key: any) => { capture(type, props); return runtime.jsxs(type, props, key); } };
});
vi.mock("react/jsx-dev-runtime", async original => {
  const runtime = await original<typeof import("react/jsx-dev-runtime")>();
  return { ...runtime, jsxDEV: (type: any, props: any, ...rest: any[]) => {
    if (type === "button") f.buttons.push(props);
    if (type === "tr" && props["data-work-key"]) f.rows.push(props);
    if (type === "a") f.links.push(props);
    return (runtime.jsxDEV as any)(type, props, ...rest);
  } };
});
vi.mock("../../client/src/_core/hooks/useAuth", () => ({ useAuth: () => ({ user: f.user ?? f.actual, authenticatedUser: f.actual, loading: f.loading }) }));
vi.mock("../../client/src/contexts/LanguageContext", () => ({ useLanguage: () => ({ language: f.language, dir: f.language === "en" ? "ltr" : "rtl" }) }));
vi.mock("wouter", () => ({ useLocation: () => [YOUR_WORK_PATH, (path: string) => f.navigation.push(path)] }));
vi.mock("../../client/src/lib/trpc", () => ({ trpc: { yourWork: { list: { useQuery: (input: any, options: any) => {
  f.queries.push({ input, options });
  return options.enabled ? f.keyedResults ? f.keyedResults[JSON.stringify(input)] || { isLoading: true, data: undefined, error: null } : f.result : { isLoading: false, data: undefined, error: null };
} } } } }));
vi.mock("../../client/src/components/ui/sidebar", () => ({
  SidebarMenu: ({ children, ...props }: any) => <ul {...props}>{children}</ul>,
  SidebarMenuItem: ({ children }: any) => <li>{children}</li>,
  SidebarMenuButton: ({ children, isActive, tooltip, ...props }: any) => <button {...props} data-active={isActive}>{children}</button>,
}));
import YourWork, { YourWorkSidebarLink } from "../../client/src/pages/your-work/YourWork";
const now = Date.parse("2026-11-28T08:00:00Z");
const row = (key: string, arrivedAt: number | null): YourWorkItem => ({ key, kind: "purchase", reference: `PR-${key}`, title: "مصباح", action: "purchase_review", href: `/purchase-orders/12?itemId=${key}#item-${key}`, arrivedAt });
const data = (): YourWorkResponse => ({
  overdue: [row("101", Date.parse("2026-11-25T13:53:00Z")), row("102", Date.parse("2026-11-24T13:53:00Z"))],
  required: [row("201", Date.parse("2026-11-28T07:30:00Z"))], counts: { overdue: 2, required: 1 }, generatedAt: now,
});
const content = (value: any): string => Array.isArray(value) ? value.map(content).join("") : React.isValidElement(value) ? content((value.props as any).children) : value == null ? "" : String(value);
const render = (element = <YourWork />) => {
  f.cursor = 0; f.buttons = []; f.rows = []; f.links = []; f.effects = [];
  return renderToStaticMarkup(element);
};
const tab = (name: string) => f.buttons.find(button => button.role === "tab" && button.id === `your-work-tab-${name}`)!;
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(now);
  f.language = "ar"; f.keyedResults = null; f.actual = { id: 21, name: "ماجد", role: "warehouse", isActive: 1 }; f.user = null; f.loading = false;
  f.cells = []; f.cursor = 0; f.queries = []; f.navigation = [];
  f.result = { isLoading: false, error: null, data: data() };
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("Your work personal page", () => {
  it.each(["ar", "en", "ur"])('translates the two tabs, columns, actions and welcome in %s with aligned direction', language => {
    f.language = language;
    const copy = yourWorkCopy(language);
    const html = render();
    expect(html).toContain(`dir="${language === "en" ? "ltr" : "rtl"}"`);
    for (const expected of [copy.title, copy.greeting("ماجد"), copy.overdue, copy.required, copy.transaction, copy.action, copy.arrived, copy.overdueDuration, copy.kinds.purchase, copy.actions.purchase_review]) expect(html).toContain(expected);
    expect(f.buttons.filter(button => button.role === "tab")).toHaveLength(2);
    expect(content(tab("overdue").children)).toContain("(2)");
    expect(content(tab("required").children)).toContain("(1)");
    expect(html).toContain('class="px-3 py-3 text-start font-semibold"');
    expect(html).toContain('class="px-3 py-3 text-center font-semibold"');
    expect(html).toContain('dir="ltr" dateTime="2026-11-25T13:53:00.000Z"');
    expect(html).toContain("2026-11-25-16:53");
  });
  it.each(["ar", "en", "ur"])("translates idea and IT purchase workflow action rows in %s", language => {
    f.language = language;
    const actions = ["idea_classify", "idea_study", "idea_decide", "it_purchase_submit", "it_purchase_create"] as const;
    f.result.data.overdue = actions.map((action, index) => ({ ...row(String(index + 1), Date.parse("2026-11-25T13:53:00Z")), action }));
    const html = render();
    for (const action of actions) expect(html).toContain(yourWorkCopy(language).actions[action]);
    expect(f.rows).toHaveLength(actions.length);
  });
  it("shows serials within each tab and separates elapsed time from the working-day overdue time", () => {
    let html = render();
    expect(f.rows).toHaveLength(2);
    expect(html).toContain('tabular-nums">1</td>'); expect(html).toContain('tabular-nums">2</td>');
    expect(html).toContain("11 ساعة"); // Wednesday arrival becomes overdue Saturday midnight after Thursday grace and Friday exclusion.
    expect(html).not.toContain("PR-201");
    tab("required").onClick(); html = render();
    expect(f.rows).toHaveLength(1); expect(html).toContain("PR-201"); expect(html).not.toContain("PR-101");
    expect(html).toContain("30 دقيقة"); expect(html).toContain("منذ الوصول");
    expect(html).toContain('tabular-nums">1</td>'); expect(html).not.toContain('tabular-nums">2</td>');
  });
  it("navigates the full row directly to its original deep link", () => {
    render(); f.rows[0].onClick();
    expect(f.navigation).toEqual([data().overdue[1].href]);
  });
  it.each(["Enter", " "])("opens the full row with %s", key => {
    render(); const element = {}; const preventDefault = vi.fn();
    f.rows[0].onKeyDown({ key, target: element, currentTarget: element, preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce(); expect(f.navigation).toEqual([data().overdue[1].href]);
  });
  it("keeps an actual link and avoids double navigation from link/key bubbling", () => {
    render(); const preventDefault = vi.fn(), stopPropagation = vi.fn();
    f.links[0].onClick({ preventDefault, stopPropagation });
    expect(preventDefault).toHaveBeenCalledOnce(); expect(stopPropagation).toHaveBeenCalledOnce(); expect(f.navigation).toHaveLength(1);
    f.rows[0].onKeyDown({ key: "Enter", target: {}, currentTarget: {}, preventDefault });
    expect(f.navigation).toHaveLength(1);
  });
  it("polls only the read query and refreshes when the user returns to the page", () => {
    render(); expect(f.queries.at(-1)).toEqual({ input: { viewerId: 21, viewerRole: "warehouse", language: "ar" }, options: expect.objectContaining({ enabled: true, refetchInterval: 30_000, refetchIntervalInBackground: false, refetchOnWindowFocus: true }) });
    expect(f.buttons.every(button => button.role === "tab")).toBe(true);
  });
  it.each(["account", "role", "language"])("isolates the query cache by %s without reusing previous work", change => {
    const originalInput = { viewerId: 21, viewerRole: "warehouse", language: "ar" };
    f.keyedResults = { [JSON.stringify(originalInput)]: f.result };
    expect(render()).toContain("PR-101");
    if (change === "account") f.actual = { ...f.actual, id: 22, name: "New account" };
    if (change === "role") f.actual = { ...f.actual, role: "senior_management" };
    if (change === "language") f.language = "en";
    const html = render();
    const latest = f.queries.at(-1);
    expect(latest.input).toEqual({ viewerId: f.actual.id, viewerRole: f.actual.role, language: f.language });
    expect(latest.input).not.toEqual(originalInput);
    expect(html).not.toContain("PR-101"); expect(html).toContain(yourWorkCopy(f.language).loading);
    expect(latest.options.placeholderData(f.result.data)).toBeUndefined();
    expect(latest.options.keepPreviousData).not.toBe(true);
  });
  it("updates counters and removes completed work when a fresh response arrives", () => {
    render(); f.result.data = { overdue: [], required: [], counts: { overdue: 0, required: 0 }, generatedAt: now + 1 }; const html = render();
    expect(html).not.toContain("PR-101"); expect(html).toContain(yourWorkCopy("ar").noWork);
    expect(content(tab("overdue").children)).toContain("(0)"); expect(content(tab("required").children)).toContain("(0)");
  });
  it("does not guess arrival dates or elapsed duration for missing evidence", () => {
    f.result.data.required = [row("201", null)]; render(); tab("required").onClick();
    const html = render(); expect(html.match(/غير مسجل/g)?.length).toBe(2);
    expect(html).not.toContain("Invalid Date"); expect(html).not.toContain("NaN");
  });
  it("moves work to overdue after the extra working day at the Riyadh midnight minute tick", () => {
    vi.setSystemTime(new Date("2026-11-29T20:59:40Z"));
    f.result.data = { overdue: [], required: [row("201", Date.parse("2026-11-28T07:30:00Z"))], counts: { overdue: 0, required: 1 }, generatedAt: Date.now() };
    vi.stubGlobal("window", { setInterval, clearInterval });
    render(); expect(content(tab("overdue").children)).toContain("(0)");
    const cleanup = f.effects[0]();
    vi.advanceTimersByTime(60_000); render();
    expect(content(tab("overdue").children)).toContain("(1)");
    expect(content(tab("required").children)).toContain("(0)");
    expect(f.rows).toHaveLength(1); cleanup();
  });
  it("does not move a fresh midnight server result back to the previous day while the local timer is waiting", () => {
    vi.setSystemTime(new Date("2026-11-29T20:59:40Z"));
    f.result.data = { overdue: [row("201", Date.parse("2026-11-28T07:30:00Z"))], required: [], counts: { overdue: 1, required: 0 }, generatedAt: Date.parse("2026-11-29T21:00:20Z") };
    render(); expect(content(tab("overdue").children)).toContain("(1)"); expect(f.rows).toHaveLength(1);
  });
  it("freezes overdue duration throughout Friday while real elapsed time continues", () => {
    vi.setSystemTime(new Date("2026-11-26T21:00:00Z")); // Friday 00:00 Riyadh.
    const arrival = Date.parse("2026-11-24T07:30:00Z"); // Tuesday: due Thursday 00:00 Riyadh.
    f.result.data = { overdue: [row("301", arrival)], required: [], counts: { overdue: 1, required: 0 }, generatedAt: Date.now() };
    vi.stubGlobal("window", { setInterval, clearInterval });
    render(); const before = content(f.rows[0].children[4]);
    expect(before).toBe("يوم");
    const cleanup = f.effects[0]();
    vi.advanceTimersByTime(23 * 3_600_000 + 59 * 60_000); render();
    expect(content(f.rows[0].children[4])).toBe(before);
    expect(content(tab("overdue").children)).toContain("(1)");
    vi.advanceTimersByTime(2 * 60_000); render(); // Saturday 00:01 resumes counted delay.
    expect(content(f.rows[0].children[4])).toBe("يوم ودقيقة"); cleanup();
  });
  it("reclassifies a cached old-boundary response with the same rule as the current API and keeps arrival elapsed real", () => {
    vi.setSystemTime(new Date("2026-11-27T08:00:00Z")); // Friday 11:00 Riyadh: Thursday arrival is not overdue, but elapsed time includes Friday.
    f.result.data = { overdue: [row("201", Date.parse("2026-11-26T07:30:00Z"))], required: [], counts: { overdue: 1, required: 0 }, generatedAt: Date.now() };
    render();
    expect(content(tab("overdue").children)).toContain("(0)");
    expect(content(tab("required").children)).toContain("(1)");
    tab("required").onClick(); const html = render();
    expect(f.rows).toHaveLength(1); expect(html).toContain("PR-201");
    expect(content(f.rows[0].children[4])).toBe("يوم و30 دقيقة");
  });
  it("keeps the mobile layout as a horizontally scrollable table", () => {
    const html = render(); expect(html).toContain("overflow-x-auto"); expect(html).toContain("min-w-[680px]"); expect(html).toContain("<table");
  });
  it("shows a safe loading/error state without raw server details or fabricated counts", () => {
    f.result = { isLoading: true, error: null, data: undefined }; let html = render();
    expect(html).toContain(yourWorkCopy("ar").loading); expect(html).not.toContain("<table");
    f.result = { isLoading: false, error: new Error("SELECT passwordHash FROM users"), data: undefined }; html = render();
    expect(html).toContain(yourWorkCopy("ar").loadError); expect(html).not.toContain("SELECT"); expect(html).not.toContain("passwordHash");
    expect(content(tab("required").children)).toContain("—");
  });
  it.each([...Object.values(APP_ROLE), "unknown", "", null])("uses the actual identity to prevent page/query access for excluded role %s", role => {
    f.actual = { id: 21, name: "User", role, isActive: 1 }; f.user = { id: 21, name: "Displayed admin", role: "admin", isActive: 1 };
    const html = render(); const allowed = canReadYourWork(f.actual);
    expect(f.queries.at(-1).options.enabled).toBe(allowed);
    expect(html.includes("PR-101")).toBe(allowed);
    expect(html.includes(yourWorkCopy("ar").denied)).toBe(!allowed);
  });
  it.each([0, false])("rejects an inactive account (%s)", isActive => {
    f.actual.isActive = isActive; const html = render(); expect(html).toContain(yourWorkCopy("ar").denied); expect(f.queries.at(-1).options.enabled).toBe(false);
  });
  it("waits for authentication rather than loading the inbox early", () => {
    f.loading = true; const html = render(); expect(html).toContain(yourWorkCopy("ar").loading); expect(f.queries.at(-1).options.enabled).toBe(false);
  });
});

describe("Your work navigation and stable formatting", () => {
  it.each([...Object.values(APP_ROLE), "unknown", null])("shows only for an active eligible actual role %s", role => {
    const actor = { id: 1, role: role as any, isActive: 1 };
    const html = render(<YourWorkSidebarLink actor={actor} collapsed={false} active={true} language="ar" onNavigate={path => f.navigation.push(path)} />);
    expect(html.includes('data-your-work-navigation="true"')).toBe(canReadYourWork(actor));
    if (canReadYourWork(actor)) { expect(html).toContain("#C4B5FD"); expect(html).toContain("font-bold"); expect(html).toContain("text-base"); f.buttons[0].onClick(); expect(f.navigation).toEqual([YOUR_WORK_PATH]); }
  });
  it.each(["ar", "en", "ur"])("uses the %s sidebar label, including the collapsed accessible control", language => {
    const html = render(<YourWorkSidebarLink actor={f.actual} collapsed={true} active={false} language={language} onNavigate={() => {}} />);
    expect(html).toContain(`aria-label="${yourWorkCopy(language).title}"`); expect(html).not.toContain("<span");
  });
  it("registers the page and keeps its link directly above the favorites rendering", () => {
    const app = readFileSync("client/src/App.tsx", "utf8"), layout = readFileSync("client/src/components/layout/DashboardLayout.tsx", "utf8");
    expect(app).toContain('<Route path="/your-work" component={YourWork} />');
    expect(layout).toContain("return [favoriteSection, ...permittedSections]");
    expect(layout.indexOf("<YourWorkSidebarLink actor={authenticatedUser ?? user}")).toBeGreaterThan(layout.indexOf("<SidebarContent"));
    expect(layout.indexOf("<YourWorkSidebarLink actor={authenticatedUser ?? user}")).toBeLessThan(layout.indexOf("visibleSections.map((section"));
  });
  it("enforces the layout URL guard with the actual role even when the displayed role is admin", () => {
    const source = ts.createSourceFile("DashboardLayout.tsx", readFileSync("client/src/components/layout/DashboardLayout.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let expression = "";
    const visit = (node: ts.Node) => { if (ts.isVariableDeclaration(node) && node.name.getText(source) === "canAccessCurrentPath") expression = node.initializer!.getText(source); ts.forEachChild(node, visit); };
    visit(source); expect(expression).not.toBe("");
    for (const role of Object.values(APP_ROLE)) {
      const value = vm.runInNewContext(expression, { authLoading: false, location: YOUR_WORK_PATH, YOUR_WORK_PATH, RETURNS_CENTER_PATH: "/returns-center", returnsCenterAccess: false,
        role: "admin", user: { role: "admin" }, authenticatedUser: { role }, canRoleAccessPath, approvedPricingDocumentPageAllowed: () => false });
      expect(value).toBe(canRoleAccessPath(role, YOUR_WORK_PATH));
    }
  });
  it("formats exact Gregorian Riyadh dates and duration units independently of browser timezone", () => {
    expect(yourWorkDate(Date.parse("2026-11-27T21:00:00Z"), "missing")).toBe("2026-11-28-00:00");
    expect(yourWorkDate(null, "missing")).toBe("missing"); expect(yourWorkDate(NaN, "missing")).toBe("missing");
    expect(yourWorkDuration(26 * 3600000, "ar", "missing")).toBe("يوم وساعتان");
    expect(yourWorkDuration(26 * 3600000, "en", "missing")).toBe("1 day and 2 hours");
    expect(yourWorkDuration(26 * 3600000, "ur", "missing")).toBe("1 دن اور 2 گھنٹے");
    expect(yourWorkDuration(null, "ar", "missing")).toBe("missing");
    expect(yourWorkOverdueAt(Date.parse("2026-11-28T00:01:00Z"))).toBe(Date.parse("2026-11-29T21:00:00Z"));
  });
});
