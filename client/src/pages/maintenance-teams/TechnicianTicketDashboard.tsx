import { useEffect, useState } from "react";
import { readHistoryEntryState, writeHistoryEntryState } from "@/lib/backStack";
import { useRestoreTeamTicketList } from "./team-execution-navigation";
import { useAuth } from "@/_core/hooks/useAuth";
import { useTranslation } from "@/contexts/LanguageContext";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { TechnicianStatusCards } from "@/components/maintenance/TechnicianStatusCards";
import {
  bucketCounts,
  namedTicketBucket,
  teamTicketBucket,
  TECHNICIAN_BUCKETS,
  type TechnicianBucket,
} from "@shared/technician-task-buckets";
import { TicketSequentialTasksView } from "./TicketSequentialTasksView";
import { NamedTechnicianTickets } from "./NamedTechnicianTickets";
import { ExecutionPanel } from "./ExecutionPanel";

export function TechnicianTicketDashboard() {
  const { user } = useAuth();
  const { t, language, dir } = useTranslation();
  const [bucket, setBucket] = useState<TechnicianBucket>(() => {
    const saved = readHistoryEntryState<TechnicianBucket>("teamTicketBucket");
    return saved && (TECHNICIAN_BUCKETS as readonly string[]).includes(saved) ? saved : "execution";
  });
  useEffect(() => { writeHistoryEntryState("teamTicketBucket", bucket); }, [bucket]);
  const utils = trpc.useUtils();
  const allowed = user?.role === "technician" && user.isActive === 1;
  const queue = trpc.ticketTeamAssignments.queue.useQuery(undefined, {
    enabled: allowed,
    retry: false,
    refetchInterval: 30_000,
  });
  const namedQuery = trpc.tickets.list.useQuery(
    {},
    { enabled: allowed, retry: false, refetchInterval: 30_000 }
  );
  useRestoreTeamTicketList(!!queue.data && !!namedQuery.data);
  const teams = queue.data ?? [];
  const teamTicketIds = new Set(teams.map(ticket => ticket.ticketId));
  const named = (namedQuery.data ?? []).filter(
    ticket => !teamTicketIds.has(ticket.id)
  );
  const groups = Array.from(teamTicketIds).map(id =>
    teams.filter(ticket => ticket.ticketId === id)
  );
  const counts = bucketCounts(groups, teamTicketBucket);
  const nameCounts = bucketCounts(named, namedTicketBucket);
  for (const key of Object.keys(counts) as TechnicianBucket[])
    counts[key] += nameCounts[key];
  if (!allowed) return null;
  const refresh = () =>
    void Promise.all([
      queue.refetch(),
      namedQuery.refetch(),
      utils.ticketTeamExecution.details.invalidate(),
      utils.ticketTeamExecution.balances.invalidate(),
    ]);
  return (
    <div className="space-y-4 p-3" dir={dir}>
      <Button
        variant="outline"
        disabled={queue.isFetching || namedQuery.isFetching}
        onClick={refresh}
      >
        {t.workflow.pmv2.refresh}
      </Button>
      <TechnicianStatusCards
        counts={counts}
        value={bucket}
        onChange={setBucket}
        language={language}
        loading={
          queue.isLoading ||
          namedQuery.isLoading ||
          !!queue.error ||
          !!namedQuery.error
        }
      />
      {teams.length === 200 && <p className="text-xs text-muted-foreground">{language === "ar" ? "قائمة الفرق تعرض أحدث 200 إسناد وفق الحد الحالي؛ أعداد البطاقات تخص السجلات المعروضة." : language === "ur" ? "ٹیم کی فہرست آخری 200 تفویض دکھاتی ہے؛ تعداد دکھائے گئے ریکارڈز کی ہے۔" : "The existing team queue shows the latest 200 assignments; card counts reflect displayed records."}</p>}
      {(queue.error || namedQuery.error) && (
        <p role="alert" className="text-destructive">
          {queue.error?.message ?? namedQuery.error?.message}
        </p>
      )}
      {queue.data && (
        <TicketSequentialTasksView
          tickets={teams}
          bucket={bucket}
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
      )}
      {namedQuery.data && (
        <NamedTechnicianTickets
          key={bucket}
          rows={named}
          bucket={bucket}
          onChanged={refresh}
        />
      )}
    </div>
  );
}
