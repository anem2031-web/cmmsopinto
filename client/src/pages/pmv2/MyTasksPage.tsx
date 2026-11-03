import { useLocation, useSearch } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { useTranslation } from "@/contexts/LanguageContext";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { canRoleExecutePmv2Technician } from "@shared/roles";
import { canReadTicketTeamExecution } from "@shared/maintenance-team-tickets/execution-permissions";
import AssignedMaintenanceTickets from "../maintenance-teams/AssignedMaintenanceTickets";
import Pmv2MyTasks from "./Pmv2MyTasks";
import { TechnicianTicketDashboard } from "../maintenance-teams/TechnicianTicketDashboard";
import TeamTicketExecutionPage from "../maintenance-teams/TeamTicketExecutionPage";

export default function MyTasksPage() {
  const { user, loading } = useAuth();
  const { t, language, dir } = useTranslation();
  const search = useSearch();
  const [location, navigate] = useLocation();
  const scheduledAllowed =
    user?.isActive === 1 && canRoleExecutePmv2Technician(user.role);
  const ticketsAllowed =
    scheduledAllowed && canReadTicketTeamExecution(user?.role);
  const params = new URLSearchParams(search);
  const source =
    params.get("source") === "pmv2" || !ticketsAllowed ? "pmv2" : "tickets";

  if (loading) return <div className="p-6">{t.common.loading}</div>;
  if (!scheduledAllowed)
    return (
      <div role="alert" className="p-6">
        {language === "ar"
          ? "ليس لديك صلاحية لعرض هذه المهام"
          : language === "ur"
            ? "آپ کو یہ کام دیکھنے کی اجازت نہیں ہے۔"
            : "You cannot view these tasks."}
      </div>
    );

  if (source === "tickets" && ticketsAllowed && params.has("teamExecution")) return <TeamTicketExecutionPage />;

  return (
    <Tabs
      value={source}
      dir={dir}
      className="space-y-4"
      onValueChange={value => {
        if (value !== "tickets" && value !== "pmv2") return;
        if (value === "tickets" && !ticketsAllowed) return;
        const nextParams = new URLSearchParams(search);
        nextParams.set("source", value);
        navigate(`${location}?${nextParams.toString()}`);
      }}
    >
      <TabsList aria-label={t.nav.pmv2MyTasks}>
        <TabsTrigger value="tickets" disabled={!ticketsAllowed}>
          {t.nav.maintenanceTeamTickets}
        </TabsTrigger>
        <TabsTrigger value="pmv2">{t.nav.scheduledMaintenance}</TabsTrigger>
      </TabsList>
      <TabsContent value="tickets">
        {source === "tickets" && ticketsAllowed && (
          user?.role === "technician" ? <TechnicianTicketDashboard /> : <AssignedMaintenanceTickets />
        )}
      </TabsContent>
      <TabsContent value="pmv2">
        {source === "pmv2" && <Pmv2MyTasks />}
      </TabsContent>
    </Tabs>
  );
}
