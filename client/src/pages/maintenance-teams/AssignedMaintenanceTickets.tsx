import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { useTranslation } from "@/contexts/LanguageContext";
import { trpc } from "@/lib/trpc";
import { writeHistoryEntryState } from "@/lib/backStack";
import { ItExecutionTicketsView } from "./ItExecutionTicketsView";
import { keepPreviousData } from "@tanstack/react-query";
import { MAINTENANCE_RESPONSIBLE_DEPARTMENT } from "@shared/roles";
import { canReadTicketTeamExecution } from "@shared/maintenance-team-tickets/execution-permissions";
import { TicketExecutionTasksView } from "./TicketExecutionTasksView";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RefreshCw } from "lucide-react";
import { ExecutionPanel } from "./ExecutionPanel";
import { useRestoreTeamTicketList } from "./team-execution-navigation";
import { useLocation, useSearch } from "wouter";
import TeamTicketExecutionPage from "./TeamTicketExecutionPage";
import { TicketListFilters } from "./TicketListFilters";
import { ticketListText } from "@/i18n/ticketList";
import {
  canSeeItTicketTab,
  readTicketListState,
  ticketListUrl,
  updateTicketListState,
  type TicketListState,
  type TicketListDepartment,
} from "./ticket-list-state";

export default function AssignedMaintenanceTickets() {
  const search = useSearch();
  const [path] = useLocation();
  if (new URLSearchParams(search).has("teamExecution"))
    return <TeamTicketExecutionPage />;
  return path === "/maintenance-team-tickets" ? (
    <AssignedMaintenanceTicketList />
  ) : (
    <LegacyAssignedMaintenanceTicketList />
  );
}

export function AssignedMaintenanceTicketList() {
  const { user, loading } = useAuth();
  const { language, dir, t } = useTranslation();
  const text = ticketListText[language];
  const [path, navigate] = useLocation();
  const search = useSearch();
  const state = useMemo(
    () => readTicketListState(search, user?.role),
    [search, user?.role]
  );
  const [searchInput, setSearchInput] = useState(state.search);
  const defaultResolved = useRef(false);
  const utils = trpc.useUtils();
  const allowed = user?.isActive === 1 && canReadTicketTeamExecution(user.role);
  const update = (changes: Partial<TicketListState>) => {
    const next = updateTicketListState(state, {
      search: searchInput,
      ...changes,
    });
    navigate(ticketListUrl(path, search, next), { replace: true });
  };
  useEffect(() => {
    setSearchInput(state.search);
  }, [state.search]);
  useEffect(() => {
    if (searchInput === state.search) return;
    const timer = setTimeout(() => update({ search: searchInput }), 200);
    return () => clearTimeout(timer);
  }, [searchInput, state, path, search]);
  const queue = trpc.ticketTeamAssignments.list.useQuery(
    { ...state, pageSize: 20, language },
    {
      enabled: !!allowed,
      retry: false,
      refetchOnMount: "always",
      placeholderData: keepPreviousData,
    }
  );
  const data = queue.data;
  useRestoreTeamTicketList(!!data && !queue.isPlaceholderData);
  useEffect(() => {
    if (!data || queue.isPlaceholderData) return;
    if (!defaultResolved.current) {
      defaultResolved.current = true;
      const unfiltered =
        state.status === "open" &&
        state.sort === "oldest" &&
        state.page === 1 &&
        !state.search &&
        !searchInput &&
        state.teamId == null &&
        state.executorId == null &&
        state.siteId == null &&
        state.sectionId == null;
      if (
        !new URLSearchParams(search).has("department") &&
        unfiltered &&
        state.department === MAINTENANCE_RESPONSIBLE_DEPARTMENT.GENERAL &&
        data.departmentCounts.general === 0 &&
        data.departmentCounts.construction > 0
      ) {
        update({ department: MAINTENANCE_RESPONSIBLE_DEPARTMENT.CONSTRUCTION });
        return;
      }
    }
    if (data.page !== state.page) update({ page: data.page });
  }, [data, queue.isPlaceholderData, search, state, searchInput]);
  if (loading) return <div className="p-6">{t.common.loading}</div>;
  if (!allowed)
    return (
      <div role="alert" className="p-6">
        {text.denied}
      </div>
    );
  const refresh = () =>
    void Promise.all([
      queue.refetch(),
      utils.ticketTeamExecution.details.invalidate(),
      utils.ticketTeamExecution.balances.invalidate(),
    ]);
  const reset = () => {
    setSearchInput("");
    update({
      search: "",
      status: "open",
      teamId: undefined,
      executorId: undefined,
      siteId: undefined,
      sectionId: undefined,
      sort: "oldest",
    });
  };
  const totalPages = Math.max(
    1,
    Math.ceil((data?.total ?? 0) / (data?.pageSize ?? 20))
  );
  const waiting = queue.isLoading || queue.isPlaceholderData;
  const it = state.department === MAINTENANCE_RESPONSIBLE_DEPARTMENT.IT;
  const openItTicket = (ticketId: number) => {
    writeHistoryEntryState(
      "teamTicketListScroll",
      typeof window === "undefined" ? 0 : window.scrollY
    );
    navigate(`/tickets/${ticketId}`);
  };
  return (
    <div className="space-y-4 p-3 sm:p-6" dir={dir}>
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold">{t.nav.maintenanceTeamTickets}</h1>
        <Button
          variant="outline"
          size="sm"
          disabled={queue.isFetching}
          onClick={refresh}
        >
          <RefreshCw className="me-1 h-4 w-4" />
          {text.refresh}
        </Button>
      </div>
      <Tabs
        value={state.department}
        onValueChange={department =>
          update({ department: department as TicketListDepartment })
        }
        dir={dir}
        className="space-y-4"
      >
        <TabsList aria-label={text.departments} className="h-auto flex-wrap">
          <TabsTrigger value={MAINTENANCE_RESPONSIBLE_DEPARTMENT.CONSTRUCTION}>
            {text.construction}
          </TabsTrigger>
          <TabsTrigger value={MAINTENANCE_RESPONSIBLE_DEPARTMENT.GENERAL}>
            {text.general}
          </TabsTrigger>
          {canSeeItTicketTab(user?.role) && (
            <TabsTrigger value={MAINTENANCE_RESPONSIBLE_DEPARTMENT.IT}>
              {text.it}
            </TabsTrigger>
          )}
        </TabsList>
        <TicketListFilters
          value={state}
          searchInput={searchInput}
          onSearchInput={setSearchInput}
          onChange={update}
          onReset={reset}
          options={data?.options ?? { teams: [], sites: [], sections: [] }}
          language={language}
        />
        <TabsContent value={state.department} className="space-y-4">
          {queue.error ? (
            <p role="alert" className="text-destructive">
              {text.failed}
            </p>
          ) : waiting ? (
            <p role="status" className="text-sm text-muted-foreground">
              {text.loading}
            </p>
          ) : (
            data && (
              <>
                <p className="text-sm text-muted-foreground" aria-live="polite">
                  {text.results}: {data.total}
                </p>
                {it && data.itTickets?.length ? (
                  <ItExecutionTicketsView
                    tickets={data.itTickets}
                    language={language}
                    onOpen={openItTicket}
                  />
                ) : !it && data.items.length ? (
                  <TicketExecutionTasksView
                    sequential={user!.role === "technician"}
                    tickets={data.items}
                    language={language}
                    renderExecution={(ticket, onBusyChange) => (
                      <ExecutionPanel
                        key={ticket.assignmentId}
                        assignmentId={ticket.assignmentId}
                        actorId={user!.id}
                        role={user!.role}
                        language={language}
                        onBusyChange={onBusyChange}
                        onChanged={refresh}
                      />
                    )}
                  />
                ) : (
                  <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                    {text.empty}
                  </div>
                )}
                {totalPages > 1 && (
                  <nav
                    aria-label={text.page}
                    className="flex flex-wrap items-center justify-center gap-3"
                  >
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={data.page <= 1 || queue.isFetching}
                      onClick={() => update({ page: data.page - 1 })}
                    >
                      {text.previous}
                    </Button>
                    <span className="text-sm">
                      {text.page} {data.page} {text.of} {totalPages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={data.page >= totalPages || queue.isFetching}
                      onClick={() => update({ page: data.page + 1 })}
                    >
                      {text.next}
                    </Button>
                  </nav>
                )}
              </>
            )
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

/** Embedded task workspaces retain their existing queue and department coverage. */
function LegacyAssignedMaintenanceTicketList() {
  const { user, loading } = useAuth();
  const { language, dir, t } = useTranslation();
  const utils = trpc.useUtils();
  const allowed = user?.isActive === 1 && canReadTicketTeamExecution(user.role);
  const queue = trpc.ticketTeamAssignments.queue.useQuery(undefined, {
    enabled: !!allowed,
    retry: false,
  });
  useRestoreTeamTicketList(!!queue.data);
  if (loading || (allowed && queue.isLoading))
    return <div className="p-6">{t.common.loading}</div>;
  if (!allowed)
    return (
      <div role="alert" className="p-6">
        {ticketListText[language].denied}
      </div>
    );
  return (
    <div className="space-y-4 p-6" dir={dir}>
      <Button
        variant="outline"
        size="sm"
        disabled={queue.isFetching}
        onClick={() =>
          void Promise.all([
            queue.refetch(),
            utils.ticketTeamExecution.details.invalidate(),
            utils.ticketTeamExecution.balances.invalidate(),
          ])
        }
      >
        <RefreshCw className="me-1 h-4 w-4" />
        {ticketListText[language].refresh}
      </Button>
      {queue.error && (
        <p role="alert" className="text-destructive">
          {queue.error.message}
        </p>
      )}
      {queue.data && (
        <TicketExecutionTasksView
          sequential={user!.role === "technician"}
          tickets={queue.data}
          language={language}
          renderExecution={(ticket, onBusyChange) => (
            <ExecutionPanel
              key={ticket.assignmentId}
              assignmentId={ticket.assignmentId}
              actorId={user!.id}
              role={user!.role}
              language={language}
              onBusyChange={onBusyChange}
              onChanged={() => void queue.refetch()}
            />
          )}
        />
      )}
    </div>
  );
}
