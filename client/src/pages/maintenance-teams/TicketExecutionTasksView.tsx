import { useOpenTeamExecution } from "./team-execution-navigation";
import { type ReactNode } from "react";
import { ClipboardList, MapPin, Users, Warehouse } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import type { AssignedTeamTicket } from "@shared/maintenance-team-tickets/assignment";
import { stageLabels } from "@shared/maintenance-team-tickets/model";
import { TicketSequentialTasksView } from "./TicketSequentialTasksView";
import { TicketReportMedia } from "./TicketReportMedia";

/** Same task-card/detail layout as Pmv2MyTasks; the document identity remains a ticket. */
export function TicketExecutionTasksView({ sequential = false, ...props }: {
  tickets: AssignedTeamTicket[]; language: string; sequential?: boolean; renderExecution: (ticket: AssignedTeamTicket, onBusyChange?: (busy: boolean) => void) => ReactNode;
}) {
  return sequential ? <TicketSequentialTasksView {...props} /> : <LegacyTicketExecutionTasksView {...props} />;
}
function LegacyTicketExecutionTasksView({ tickets, language, renderExecution }: {
  tickets: AssignedTeamTicket[]; language: string; renderExecution: (ticket: AssignedTeamTicket) => ReactNode;
}) {
  const openExecution = useOpenTeamExecution();
  const l = (a: string, e: string, u: string) => language === "ar" ? a : language === "ur" ? u : e;
  const attention = tickets.filter(x => ["waiting_material", "ready_to_repair"].includes(x.stage));
  const title = l("تذاكر الصيانة", "Maintenance tickets", "مرمت کے ٹکٹ");
  const labels = {
    action_required: l(stageLabels.action_required, "Team action required", "ٹیم کی کارروائی درکار"),
    waiting_material: l(stageLabels.waiting_material, "Waiting for materials", "مواد کا انتظار"),
    ready_to_repair: l(stageLabels.ready_to_repair, "Materials received — resume work", "مواد موصول — کام جاری رکھیں"),
    awaiting_review: l(stageLabels.awaiting_review, "Execution finished — awaiting manager", "کام مکمل — ذمہ دار کا انتظار"),
    blocked: l(stageLabels.blocked, "Obstacle awaiting manager", "رکاوٹ — ذمہ دار کا انتظار"),
    external_requested: l(stageLabels.external_requested, "External maintenance requested", "بیرونی مرمت کی درخواست"),
    external_in_progress: l(stageLabels.external_in_progress, "External maintenance in progress", "بیرونی مرمت جاری"),
    reinstall_required: l(stageLabels.reinstall_required, "Reinstallation required", "دوبارہ تنصیب درکار"),
    closed: l(stageLabels.closed, "Team execution completed", "ٹیم کا کام مکمل"),
  };
  return <div className="space-y-6">
    {!!attention.length && <Card><CardHeader><CardTitle className="flex items-center justify-between text-lg">{l("مواد تحتاج انتباهك", "Materials needing your attention", "مواد جن پر توجہ درکار ہے")}<Badge variant="secondary">{attention.length}</Badge></CardTitle><CardDescription>{l("احتياجات المواد المرتبطة بتذاكر الصيانة تبقى هنا حتى استلامها واستكمال الإصلاح.", "Ticket material needs remain here until receipt and repair completion.", "ٹکٹ کے مواد کی ضروریات وصولی اور مرمت تک یہاں رہتی ہیں۔")}</CardDescription></CardHeader><CardContent className="space-y-2">{attention.map(ticket => <button key={ticket.assignmentId} type="button" className="flex w-full flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-start text-sm hover:bg-muted/50" onClick={() => openExecution(ticket.assignmentId)}><span dir="ltr">{ticket.ticketNumber}</span><span>{ticket.title}</span><Badge variant="outline">{labels[ticket.stage]}</Badge></button>)}</CardContent></Card>}
    <Card><CardHeader><CardTitle className="flex items-center justify-between gap-3"><span className="flex items-center gap-2"><ClipboardList className="h-5 w-5" />{title}</span><Badge variant="secondary">{tickets.length}</Badge></CardTitle>
      <CardDescription>{l("المهام الناتجة عن البلاغات والمسندة لفرق الصيانة — اختر تذكرة لعرض بنودها وإجراءاتها.", "Tasks from reports assigned to maintenance teams — select a ticket to view its execution.", "مرمت کی ٹیموں کو تفویض کردہ ٹکٹ — کارروائی دیکھنے کے لیے ٹکٹ منتخب کریں۔")}</CardDescription></CardHeader>
      <CardContent className="space-y-5">
        {!tickets.length && <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">{l("لا توجد تذاكر مسندة إلى فريقك.", "No team tickets assigned.", "آپ کی ٹیم کو کوئی ٹکٹ تفویض نہیں ہوا۔")}</div>}
        <div className="grid gap-3 md:grid-cols-2">{tickets.map(ticket => {
          const done = ["awaiting_review", "closed"].includes(ticket.stage);
          return <div key={ticket.assignmentId} className={`rounded-xl border p-4 transition hover:bg-muted/50`}><button type="button" onClick={() => openExecution(ticket.assignmentId)} className="w-full text-start">
            <div className="flex items-start justify-between gap-3"><div><div className="font-semibold" dir="ltr">{ticket.ticketNumber}</div><div className="mt-1 flex items-start gap-1 text-sm text-muted-foreground"><MapPin className="mt-0.5 h-4 w-4 shrink-0" /><span>{ticket.siteName} / {ticket.sectionName}</span></div></div><Badge variant={done ? "secondary" : "outline"}>{ticket.executionInProgress ? l("قيد التنفيذ", "In progress", "کام جاری ہے") : labels[ticket.stage]}</Badge></div>
            <p className="mt-2 text-sm font-medium">{ticket.title}</p>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground"><span className="flex items-center gap-1"><Users className="h-3.5 w-3.5" />{ticket.teamName}</span><span className="flex items-center gap-1"><Warehouse className="h-3.5 w-3.5" />{ticket.warehouseName}</span><span>{l("إنجاز التنفيذ", "Execution progress", "کام کی پیش رفت")}: {done ? "1 / 1" : "0 / 1"}</span></div><Progress value={done ? 100 : 0} className="mt-2 h-2" />
          </button><div className="mt-3"><TicketReportMedia media={ticket.reportMedia} language={language} /></div></div>;
        })}</div>
      </CardContent></Card>

  </div>;
}
