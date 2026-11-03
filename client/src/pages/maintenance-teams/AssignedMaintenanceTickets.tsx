import { useAuth } from "@/_core/hooks/useAuth";
import { useTranslation } from "@/contexts/LanguageContext";
import { trpc } from "@/lib/trpc";
import { canReadTicketTeamExecution } from "@shared/maintenance-team-tickets/execution-permissions";
import { TicketExecutionTasksView } from "./TicketExecutionTasksView";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import { ExecutionPanel } from "./ExecutionPanel";
import { useRestoreTeamTicketList } from "./team-execution-navigation";
import { useSearch } from "wouter";
import TeamTicketExecutionPage from "./TeamTicketExecutionPage";

export default function AssignedMaintenanceTickets() {
  const search = useSearch();
  if (new URLSearchParams(search).has("teamExecution")) return <TeamTicketExecutionPage />;
  return <AssignedMaintenanceTicketList />;
}

function AssignedMaintenanceTicketList() {
  const { user, loading } = useAuth();
  const { language, dir, t } = useTranslation();
  const utils = trpc.useUtils();
  const allowed = user?.isActive === 1 && canReadTicketTeamExecution(user.role);
  const queue = trpc.ticketTeamAssignments.queue.useQuery(undefined, { enabled: !!allowed, retry: false });
  useRestoreTeamTicketList(!!queue.data);
  if (loading || (allowed && queue.isLoading)) return <div className="p-6">{t.common.loading}</div>;
  if (!allowed) return <div role="alert" className="p-6">{language === "ar" ? "ليس لديك صلاحية لعرض تذاكر الفريق" : language === "ur" ? "آپ کو ٹیم کے ٹکٹ دیکھنے کی اجازت نہیں ہے۔" : "You cannot view team tickets."}</div>;
  return <div className="space-y-4 p-6" dir={dir}>
    <Button variant="outline" size="sm" disabled={queue.isFetching} onClick={() => void Promise.all([queue.refetch(), utils.ticketTeamExecution.details.invalidate(), utils.ticketTeamExecution.balances.invalidate()])}><RefreshCw className="me-1 h-4 w-4" />{language === "ar" ? "تحديث" : language === "ur" ? "تازہ کریں" : "Refresh"}</Button>
    {queue.error && <p role="alert" className="text-destructive">{queue.error.message}</p>}
    {queue.data && <TicketExecutionTasksView sequential={user!.role === "technician"} tickets={queue.data} language={language} renderExecution={(ticket, onBusyChange) => <ExecutionPanel key={ticket.assignmentId} assignmentId={ticket.assignmentId} actorId={user!.id} role={user!.role} language={language} onBusyChange={onBusyChange} onChanged={()=>void queue.refetch()} />} />}
  </div>;
}
