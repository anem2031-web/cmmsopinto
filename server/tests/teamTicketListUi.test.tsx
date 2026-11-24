import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAINTENANCE_RESPONSIBLE_DEPARTMENT as D } from "../../shared/roles";
import {
  readTicketListState,
  ticketListUrl,
  updateTicketListState,
} from "../../client/src/pages/maintenance-teams/ticket-list-state";
import ar from "../../client/src/i18n/ar";
import en from "../../client/src/i18n/en";
import ur from "../../client/src/i18n/ur";
const state = vi.hoisted(() => ({
  path: "/maintenance-team-tickets",
  search: "",
  language: "ar",
  role: "owner",
  active: 1,
  values: [] as any[],
  cursor: 0,
  effects: [] as any[],
  pending: [] as any[],
  buttons: [] as any[],
  inputs: [] as any[],
  selects: [] as any[],
  query: [] as any[],
  queue: [] as any[],
  execution: [] as any[],
  views: [] as any[],
  navigation: [] as any[],
  changeTab: undefined as any,
  data: undefined as any,
  error: null as any,
  placeholder: false,
  fetching: false,
  refetch: vi.fn(),
  details: vi.fn(),
  balances: vi.fn(),
}));
vi.mock("react", async original => ({
  ...(await original<typeof import("react")>()),
  useMemo: (read: () => any) => read(),
  useState: (initial: any) => {
    const key = state.cursor++;
    if (!(key in state.values))
      state.values[key] = typeof initial === "function" ? initial() : initial;
    return [
      state.values[key],
      (next: any) => {
        state.values[key] =
          typeof next === "function" ? next(state.values[key]) : next;
      },
    ];
  },
  useRef: (initial: any) => {
    const key = state.cursor++;
    if (!(key in state.values)) state.values[key] = { current: initial };
    return state.values[key];
  },
  useEffect: (run: () => any, deps: any[]) => {
    const key = state.cursor++,
      previous = state.effects[key];
    if (
      !previous ||
      deps.some((value, i) => !Object.is(value, previous.deps[i]))
    ) {
      state.pending.push(() => {
        previous?.cleanup?.();
        state.effects[key] = { deps, cleanup: run() };
      });
    }
  },
}));
vi.mock("wouter", () => ({
  useSearch: () => state.search,
  useLocation: () => [
    state.path,
    (url: string, options: any) => {
      state.navigation.push({ url, options });
      const [path, query = ""] = url.split("?");
      state.path = path;
      state.search = query ? "?" + query : "";
    },
  ],
}));
vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: 7, role: state.role, isActive: state.active },
    loading: false,
  }),
}));
vi.mock("@/contexts/LanguageContext", () => ({
  useTranslation: () => ({
    language: state.language,
    dir: state.language === "en" ? "ltr" : "rtl",
    t: state.language === "ar" ? ar : state.language === "en" ? en : ur,
  }),
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      ticketTeamExecution: {
        details: { invalidate: state.details },
        balances: { invalidate: state.balances },
      },
    }),
    ticketTeamAssignments: {
      list: {
        useQuery: (input: any, options: any) => {
          state.query.push({ input, options });
          return {
            data: state.data,
            error: state.error,
            isLoading: !state.data && !state.error,
            isPlaceholderData: state.placeholder,
            isFetching: state.fetching,
            refetch: state.refetch,
          };
        },
      },
      queue: {
        useQuery: (input: any, options: any) => {
          state.queue.push({ input, options });
          return {
            data: state.data?.items ?? [],
            isLoading: false,
            isFetching: false,
            refetch: state.refetch,
          };
        },
      },
    },
  },
}));
vi.mock("@/components/ui/button", () => ({
  Button: (props: any) => {
    state.buttons.push(props);
    const { variant, size, ...native } = props;
    return <button {...native} />;
  },
}));
vi.mock("@/components/ui/input", () => ({
  Input: (props: any) => {
    state.inputs.push(props);
    return <input {...props} />;
  },
}));
vi.mock("@/components/ui/tabs", () => ({
  Tabs: ({ children, onValueChange }: any) => {
    state.changeTab = onValueChange;
    return <div>{children}</div>;
  },
  TabsList: ({ children, ...props }: any) => (
    <div role="tablist" {...props}>
      {children}
    </div>
  ),
  TabsTrigger: ({ children, value }: any) => (
    <button role="tab" value={value}>
      {children}
    </button>
  ),
  TabsContent: ({ children }: any) => <div>{children}</div>,
}));
vi.mock(
  "../../client/src/pages/maintenance-teams/TicketListFilters",
  async original => {
    const actual =
      await original<
        typeof import("../../client/src/pages/maintenance-teams/TicketListFilters")
      >();
    const visit = (node: any) => {
      if (Array.isArray(node)) return node.forEach(visit);
      if (!node?.props) return;
      if (node.type === "select") state.selects.push(node.props);
      visit(node.props.children);
    };
    return {
      TicketListFilters: (props: any) => {
        const node = actual.TicketListFilters(props);
        visit(node);
        return node;
      },
    };
  }
);
vi.mock(
  "../../client/src/pages/maintenance-teams/TicketExecutionTasksView",
  () => ({
    TicketExecutionTasksView: (props: any) => {
      state.views.push(props);
      return (
        <p>
          {props.tickets.map((ticket: any) => ticket.ticketNumber).join(",")}
        </p>
      );
    },
  })
);
vi.mock("../../client/src/pages/maintenance-teams/ExecutionPanel", () => ({
  ExecutionPanel: (props: any) => {
    state.execution.push(props);
    return <div />;
  },
}));
vi.mock(
  "../../client/src/pages/maintenance-teams/team-execution-navigation",
  () => ({ useRestoreTeamTicketList: () => {} })
);
vi.mock(
  "../../client/src/pages/maintenance-teams/TeamTicketExecutionPage",
  () => ({ default: () => <p>existing team execution page</p> })
);
import AssignedMaintenanceTickets from "../../client/src/pages/maintenance-teams/AssignedMaintenanceTickets";

function render() {
  state.cursor = 0;
  state.pending = [];
  state.buttons = [];
  state.inputs = [];
  state.selects = [];
  state.views = [];
  const html = renderToStaticMarkup(<AssignedMaintenanceTickets />);
  for (const effect of state.pending) effect();
  return html;
}
const select = (id: string, value: string) =>
  state.selects
    .find(control => control.id === id)
    .onChange({ currentTarget: { value } });
beforeEach(() => {
  vi.useFakeTimers();
  Object.assign(state, {
    path: "/maintenance-team-tickets",
    search: "",
    language: "ar",
    role: "owner",
    active: 1,
    values: [],
    cursor: 0,
    effects: [],
    pending: [],
    buttons: [],
    inputs: [],
    selects: [],
    query: [],
    queue: [],
    execution: [],
    views: [],
    navigation: [],
    error: null,
    placeholder: false,
    fetching: false,
    data: {
      items: [
        {
          assignmentId: 9,
          ticketId: 91,
          ticketNumber: "MT-OLD-009",
          stage: "action_required",
        },
      ],
      total: 41,
      page: 1,
      pageSize: 20,
      departmentCounts: { general: 30, construction: 11 },
      options: {
        teams: [{ id: 20, name: "فريق الكهرباء" }],
        sites: [
          { id: 3, name: "الملقا" },
          { id: 4, name: "الرياض" },
        ],
        sections: [
          { id: 5, siteId: 3, name: "فودوزو" },
          { id: 6, siteId: 4, name: "قسم آخر" },
        ],
      },
    },
  });
  state.refetch.mockReset();
  state.details.mockReset();
  state.balances.mockReset();
});
afterEach(() => {
  for (const effect of state.effects) effect?.cleanup?.();
  vi.useRealTimers();
});

describe("Team ticket list URL state", () => {
  it("defaults to open oldest and chooses the construction manager's department", () => {
    expect(readTicketListState("", "owner")).toMatchObject({
      department: D.GENERAL,
      status: "open",
      sort: "oldest",
      page: 1,
    });
    expect(
      readTicketListState("", "construction_procurement_manager").department
    ).toBe(D.CONSTRUCTION);
  });
  it("normalizes malformed filters and oversized pages without changing the permitted department values", () => {
    expect(
      readTicketListState(
        "?department=it&status=evil&teamId=-1&siteId=1.5&page=1000001&sort=random"
      )
    ).toMatchObject({
      department: D.GENERAL,
      status: "open",
      teamId: undefined,
      siteId: undefined,
      page: 1,
      sort: "oldest",
    });
  });
  it("round-trips literal symbols, IDs and sorting while retaining unrelated navigation parameters", () => {
    const filters = {
      ...readTicketListState(""),
      department: D.CONSTRUCTION,
      search: "MT-%_! / مضخة 7",
      teamId: 20,
      siteId: 3,
      sectionId: 5,
      sort: "newest" as const,
      page: 3,
    };
    const url = ticketListUrl(
      "/maintenance-team-tickets",
      "?source=tickets",
      filters
    );
    expect(readTicketListState(url.slice(url.indexOf("?")))).toEqual(filters);
    expect(new URLSearchParams(url.split("?")[1]).get("source")).toBe(
      "tickets"
    );
  });
  it("resets paging on filter changes, section on site changes, and team on department changes", () => {
    const initial = {
      ...readTicketListState(""),
      page: 5,
      siteId: 3,
      sectionId: 5,
      teamId: 20,
    };
    expect(updateTicketListState(initial, { status: "blocked" })).toMatchObject(
      { page: 1, sectionId: 5, teamId: 20 }
    );
    expect(updateTicketListState(initial, { siteId: 4 })).toMatchObject({
      page: 1,
      sectionId: undefined,
    });
    expect(
      updateTicketListState(initial, { department: D.CONSTRUCTION })
    ).toMatchObject({ page: 1, teamId: undefined });
    expect(updateTicketListState(initial, { page: 2 }).page).toBe(2);
  });
});
describe("Team ticket search and department tabs", () => {
  it("renders exactly two department tabs, filters and scoped data with unchanged execution props", () => {
    const html = render();
    expect(html.match(/role="tab"/g) || []).toHaveLength(2);
    expect(html).toContain("الإنشاءات");
    expect(html).toContain("الصيانة العامة");
    expect(html).toContain("فريق الكهرباء");
    expect(html).toContain("MT-OLD-009");
    expect(state.selects.map(control => control.id)).toHaveLength(5);
    expect(html).not.toContain("بانتظار إجراء الفريق");
    expect(state.query.at(-1)).toMatchObject({
      input: {
        department: D.GENERAL,
        page: 1,
        pageSize: 20,
        sort: "oldest",
        status: "open",
        language: "ar",
      },
      options: { refetchOnMount: "always", enabled: true },
    });
    renderToStaticMarkup(
      state.views[0].renderExecution(state.data.items[0], undefined)
    );
    expect(state.execution[0]).toMatchObject({
      assignmentId: 9,
      actorId: 7,
      role: "owner",
      language: "ar",
    });
  });
  it("debounces literal substring search into the server query and replaces the URL history entry", () => {
    render();
    state.inputs[0].onChange({ currentTarget: { value: "%_7" } });
    render();
    vi.advanceTimersByTime(199);
    expect(state.navigation).toHaveLength(0);
    vi.advanceTimersByTime(1);
    render();
    expect(state.query.at(-1).input.search).toBe("%_7");
    expect(state.navigation.at(-1).options).toEqual({ replace: true });
  });
  it("sends combined filters and restores them from the URL after opening a task", () => {
    state.search = `?department=${D.CONSTRUCTION}&search=MT-7&status=blocked&teamId=20&siteId=3&sectionId=5&sort=newest&page=2`;
    state.data.page = 2;
    render();
    expect(state.query.at(-1).input).toMatchObject({
      department: D.CONSTRUCTION,
      search: "MT-7",
      status: "blocked",
      teamId: 20,
      siteId: 3,
      sectionId: 5,
      sort: "newest",
      page: 2,
    });
    expect(state.inputs[0].value).toBe("MT-7");
    expect(
      state.selects.find(control => control.id === "ticket-list-section").value
    ).toBe(5);
  });
  it("filters section options by site and clears the previous section when the site changes", () => {
    state.search = "?siteId=3&sectionId=5&page=2";
    state.data.page = 2;
    const html = render();
    expect(html).toContain("فودوزو");
    expect(html).not.toContain("قسم آخر");
    select("ticket-list-site", "4");
    render();
    expect(state.query.at(-1).input).toMatchObject({
      siteId: 4,
      sectionId: undefined,
      page: 1,
    });
  });
  it("selects a department explicitly, resets paging and preserves the search", () => {
    state.search = "?search=مضخة&teamId=20&page=2";
    state.data.page = 2;
    render();
    state.changeTab(D.CONSTRUCTION);
    state.data.page = 1;
    render();
    expect(state.query.at(-1).input).toMatchObject({
      department: D.CONSTRUCTION,
      search: "مضخة",
      teamId: undefined,
      page: 1,
    });
  });
  it("auto-selects construction only for the initial unfiltered empty default, never for a search", () => {
    state.data.departmentCounts.general = 0;
    render();
    expect(new URLSearchParams(state.search).get("department")).toBe(
      D.CONSTRUCTION
    );
    state.values = [];
    state.effects = [];
    state.navigation = [];
    state.search = "?search=لا يوجد";
    render();
    expect(state.navigation).toHaveLength(0);
  });
  it("hides stale department cards during replacement data and uses a clear empty message", () => {
    state.placeholder = true;
    const pending = render();
    expect(pending).toContain("جارٍ تحميل التذاكر");
    expect(pending).not.toContain("MT-OLD-009");
    state.placeholder = false;
    state.data.items = [];
    state.data.total = 0;
    expect(render()).toContain("لا توجد تذاكر تطابق البحث والفلاتر");
  });
  it("does not expose raw query errors or enable reads for inactive accounts", () => {
    state.error = { message: "SELECT secret FROM users" };
    const failed = render();
    expect(failed).toContain("تعذر تحميل تذاكر الصيانة");
    expect(failed).not.toContain("SELECT secret");
    state.active = 0;
    const denied = render();
    expect(denied).toContain("ليس لديك صلاحية");
    expect(state.query.at(-1).options.enabled).toBe(false);
  });
  it("paginates and resets filters while retaining the selected department", () => {
    state.search = `?department=${D.CONSTRUCTION}&status=blocked&search=7&teamId=20&siteId=3&sectionId=5&sort=newest`;
    render();
    state.buttons.find(button => button.children === "التالي").onClick();
    state.data.page = 2;
    render();
    expect(state.query.at(-1).input.page).toBe(2);
    state.buttons.find(button => button.children === "مسح الفلاتر").onClick();
    state.data.page = 1;
    render();
    expect(state.query.at(-1).input).toMatchObject({
      department: D.CONSTRUCTION,
      status: "open",
      search: "",
      teamId: undefined,
      siteId: undefined,
      sectionId: undefined,
      sort: "oldest",
      page: 1,
    });
  });
  it.each(["en", "ur"])(
    "renders translated labels and matching direction in %s",
    language => {
      state.language = language;
      const html = render();
      expect(html).toContain(`dir="${language === "en" ? "ltr" : "rtl"}"`);
      expect(html).toContain(
        language === "en" ? "General maintenance" : "عمومی مرمت"
      );
    }
  );
  it("preserves embedded IT queues and the current execution page", () => {
    state.path = "/scheduled-maintenance/my-tasks";
    state.role = "it_manager";
    expect(render()).toContain("MT-OLD-009");
    expect(state.queue).toHaveLength(1);
    expect(state.query).toHaveLength(0);
    state.search = "?teamExecution=9&source=tickets";
    expect(render()).toContain("existing team execution page");
    expect(state.queue).toHaveLength(1);
    expect(state.query).toHaveLength(0);
  });
});
