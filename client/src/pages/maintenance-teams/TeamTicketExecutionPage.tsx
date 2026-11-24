import { useEffect, useState } from "react";
import { useSearch } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { useTranslation } from "@/contexts/LanguageContext";
import { trpc } from "@/lib/trpc";
import { canReadTicketTeamExecution } from "@shared/maintenance-team-tickets/execution-permissions";
import { ExecutionPanel } from "./ExecutionPanel";
import { ExecutionLeaveGuard } from "./ExecutionLeaveGuard";
import { TicketSequentialTasksView } from "./TicketSequentialTasksView";
import {
  TicketExecutionDetail,
  TicketExecutionBackButton as TeamExecutionBackButton,
  useReturnToTicketTasks,
} from "./TicketExecutionDetail";

export default function TeamTicketExecutionPage() {
  const { user, loading } = useAuth();
  const { language, dir, t } = useTranslation();
  const search = useSearch();
  const assignmentId = Number(new URLSearchParams(search).get("teamExecution"));
  const allowed = user?.isActive === 1 && canReadTicketTeamExecution(user.role);
  const technician = user?.role === "technician";
  const queue = trpc.ticketTeamAssignments.queue.useQuery(
    { language, assignmentId },
    {
      enabled:
        !!allowed && Number.isSafeInteger(assignmentId) && assignmentId > 0,
      retry: false,
      refetchInterval: technician ? 30_000 : false,
    }
  );
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [assignmentId]);
  if (loading || (allowed && queue.isLoading))
    return <p className="p-6">{t.common.loading}</p>;
  const selected = queue.data?.find(
    ticket => ticket.assignmentId === assignmentId
  );
  const unavailable =
    language === "ar"
      ? "المهمة غير متاحة لك ضمن مهام الفريق الحالية."
      : language === "ur"
        ? "یہ کام آپ کی موجودہ ٹیم کی فہرست میں دستیاب نہیں۔"
        : "This task is not available in your current team assignments.";
  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 p-3 sm:p-6" dir={dir}>
      <ExecutionLeaveGuard language={language} busy={busy}>
        {!allowed || queue.error || !selected ? (
          <>
            <TeamExecutionBackButton language={language} />
            <p role="alert">{queue.error?.message ?? unavailable}</p>
          </>
        ) : user!.role === "technician" ? (
          <TeamExecutionContent
            tickets={queue.data!}
            assignmentId={assignmentId}
            language={language}
            actorId={user!.id}
            role={user!.role}
            onBusyChange={setBusy}
            onChanged={() => void queue.refetch()}
          />
        ) : (
          <>
            <TeamExecutionBackButton language={language} disabled={busy} />
            <TicketExecutionDetail
              ticketNumber={selected.ticketNumber}
              title={selected.title}
              description={selected.description}
              language={language}
              media={selected.reportMedia}
              location={
                <>
                  {selected.siteName} / {selected.sectionName} ·{" "}
                  {selected.teamName}
                </>
              }
            >
              <ExecutionPanel
                key={assignmentId}
                assignmentId={assignmentId}
                actorId={user!.id}
                role={user!.role}
                language={language}
                onBusyChange={setBusy}
                onChanged={() => void queue.refetch()}
              />
            </TicketExecutionDetail>
          </>
        )}
      </ExecutionLeaveGuard>
    </div>
  );
}

function TeamExecutionContent({
  tickets,
  assignmentId,
  language,
  actorId,
  role,
  onBusyChange,
  onChanged,
}: {
  tickets: React.ComponentProps<typeof TicketSequentialTasksView>["tickets"];
  assignmentId: number;
  language: string;
  actorId: number;
  role: string;
  onBusyChange: (busy: boolean) => void;
  onChanged: () => void;
}) {
  const back = useReturnToTicketTasks();
  return (
    <TicketSequentialTasksView
      key={assignmentId}
      tickets={tickets}
      language={language}
      executionAssignmentId={assignmentId}
      onExit={back}
      renderExecution={(ticket, onStepBusyChange) => (
        <ExecutionPanel
          key={ticket.assignmentId}
          assignmentId={ticket.assignmentId}
          actorId={actorId}
          role={role}
          language={language}
          onBusyChange={value => {
            onBusyChange(value);
            onStepBusyChange?.(value);
          }}
          onChanged={onChanged}
        />
      )}
    />
  );
}
