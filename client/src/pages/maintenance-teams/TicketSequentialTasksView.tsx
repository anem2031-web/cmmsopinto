import { useState, type ReactNode } from "react";
import { PlayCircle } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { TechnicianExecutionWindow } from "@/components/maintenance/TechnicianExecutionWindow";
import { TicketReportMedia } from "./TicketReportMedia";
import type { AssignedTeamTicket } from "@shared/maintenance-team-tickets/assignment";
import { stageLabels } from "@shared/maintenance-team-tickets/model";
import {
  teamTicketBucket,
  type TechnicianBucket,
} from "@shared/technician-task-buckets";
import {
  currentExecutionStep,
  ticketStepRecorded,
} from "@shared/technician-workspace";

/** Ticket assignments remain independent; presentation groups only items of the same ticket. */
export function TicketSequentialTasksView({
  tickets,
  language,
  renderExecution,
  bucket,
}: {
  tickets: AssignedTeamTicket[];
  language: string;
  bucket?: TechnicianBucket;
  renderExecution: (
    ticket: AssignedTeamTicket,
    onBusyChange?: (busy: boolean) => void
  ) => ReactNode;
}) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const l = (a: string, e: string, u: string) =>
    language === "ar" ? a : language === "ur" ? u : e;
  const title = l("تذاكر الصيانة", "Maintenance tickets", "مرمت کے ٹکٹ");
  const status = (ticket: AssignedTeamTicket) =>
    language === "ar"
      ? stageLabels[ticket.stage]
      : {
          action_required: l(
            "",
            "Team action required",
            "ٹیم کی کارروائی درکار"
          ),
          waiting_material: l("", "Waiting for materials", "مواد کا انتظار"),
          ready_to_repair: l(
            "",
            "Materials received — resume work",
            "مواد موصول — کام جاری رکھیں"
          ),
          awaiting_review: l(
            "",
            "Awaiting manager review",
            "ذمہ دار کا انتظار"
          ),
          blocked: l("", "Obstacle", "رکاوٹ"),
          external_requested: l(
            "",
            "External requested",
            "بیرونی مرمت کی درخواست"
          ),
          external_in_progress: l(
            "",
            "External work in progress",
            "بیرونی مرمت جاری"
          ),
          reinstall_required: l(
            "",
            "Reinstallation required",
            "دوبارہ تنصیب درکار"
          ),
          closed: l("", "Team execution completed", "ٹیم کا کام مکمل"),
        }[ticket.stage];
  const groups = Array.from(
    new Set(tickets.map(ticket => ticket.ticketId))
  ).map(id => tickets.filter(ticket => ticket.ticketId === id));
  const visibleGroups = groups.filter(
    items => bucket == null || teamTicketBucket(items) === bucket
  );
  const selected = tickets.find(ticket => ticket.assignmentId === selectedId);
  const group = selected
    ? tickets.filter(ticket => ticket.ticketId === selected.ticketId)
    : [];
  const steps = group.map(ticket => ({
    id: ticket.assignmentId,
    title: ticket.title,
    status: status(ticket),
    recorded: ticketStepRecorded(ticket.stage),
    working: ticket.executionInProgress,
  }));
  const step = currentExecutionStep(steps, activeId);
  const current = group.find(ticket => ticket.assignmentId === step?.id);
  const visitToEnd = !current
    ? group.find(ticket => ticket.hasOpenVisit)
    : undefined;
  const open = (ticket: AssignedTeamTicket) => {
    setSelectedId(ticket.assignmentId);
    setActiveId(ticket.assignmentId);
  };
  return (
    <div className="space-y-6">
      {bucket == null &&
        tickets.some(ticket =>
          ["waiting_material", "ready_to_repair"].includes(ticket.stage)
        ) && (
          <Card>
            <CardHeader>
              <CardTitle>
                {l(
                  "مواد تحتاج انتباهك",
                  "Materials needing your attention",
                  "مواد جن پر توجہ درکار ہے"
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {tickets
                .filter(ticket =>
                  ["waiting_material", "ready_to_repair"].includes(ticket.stage)
                )
                .map(ticket => (
                  <button
                    key={ticket.assignmentId}
                    type="button"
                    className="flex w-full justify-between gap-2 rounded-lg border p-3 text-start text-sm"
                    onClick={() => open(ticket)}
                  >
                    <span>
                      {ticket.ticketNumber} — {ticket.title}
                    </span>
                    <span>{status(ticket)}</span>
                  </button>
                ))}
            </CardContent>
          </Card>
        )}
      <Card>
        <CardHeader>
          <CardTitle>
            {title} ({visibleGroups.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!visibleGroups.length && (
            <p>
              {l(
                "لا توجد تذاكر مسندة إلى فريقك.",
                "No team tickets assigned.",
                "آپ کی ٹیم کو کوئی ٹکٹ تفویض نہیں ہوا۔"
              )}
            </p>
          )}
          <div className="grid gap-3 md:grid-cols-2">
            {visibleGroups.map(items => {
              const ticket = items[0];
              const done = items.filter(item =>
                ticketStepRecorded(item.stage)
              ).length;
              return (
                <div
                  key={ticket.ticketId}
                  className="rounded-xl border p-4 transition hover:bg-muted/50"
                >
                  <button
                    key={ticket.ticketId}
                    type="button"
                    onClick={() =>
                      open(
                        items.find(item => !ticketStepRecorded(item.stage)) ??
                          ticket
                      )
                    }
                    className="w-full text-start"
                  >
                    <p className="font-semibold" dir="ltr">
                      {ticket.ticketNumber}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {ticket.siteName} / {ticket.sectionName}
                    </p>
                    <p className="mt-2 font-medium">{ticket.title}</p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {ticket.teamName} · {ticket.warehouseName}
                    </p>
                    <p className="mt-2 text-sm">
                      {done} / {items.length}
                    </p>
                    <Progress
                      value={(done / items.length) * 100}
                      className="mt-2 h-2"
                    />
                  </button>
                  <div className="mt-3">
                    <TicketReportMedia
                      media={ticket.reportMedia}
                      language={language}
                    />
                  </div>
                  <button
                    type="button"
                    className="mt-3 inline-flex items-center gap-1 text-sm text-primary"
                    onClick={() =>
                      open(
                        items.find(item => !ticketStepRecorded(item.stage)) ??
                          ticket
                      )
                    }
                  >
                    <PlayCircle className="h-4 w-4" />
                    {l(
                      "بدء التنفيذ / متابعة",
                      "Start / continue execution",
                      "کام شروع / جاری رکھیں"
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
      {selected && (
        <TechnicianExecutionWindow
          open
          onClose={() => {
            setSelectedId(null);
            setActiveId(null);
          }}
          title={`${title} — ${selected.ticketNumber}`}
          description={`${selected.siteName} / ${selected.sectionName}`}
          language={language}
          steps={steps}
          currentId={step?.id ?? null}
          onSelect={setActiveId}
          busy={busy}
        >
          {current && (
            <div
              id="ticket-selected-task"
              className="rounded-2xl border-2 border-primary/20 p-5"
            >
              <h3 className="mb-2 text-xl font-bold">{current.title}</h3>
              <p className="mb-4 whitespace-pre-wrap text-sm text-muted-foreground">
                {current.description}
              </p>
              {renderExecution(current, setBusy)}
            </div>
          )}
          {visitToEnd && (
            <div className="rounded-lg border p-3">
              <p className="mb-3 text-sm">
                {l(
                  "أنهِ الزيارة عند مغادرة الموقع؛ هذا لا يغلق التذكرة.",
                  "End the visit when leaving the site; this does not close the ticket.",
                  "مقام چھوڑتے وقت دورہ ختم کریں؛ ٹکٹ بند نہیں ہوتا۔"
                )}
              </p>
              {renderExecution(visitToEnd, setBusy)}
            </div>
          )}
        </TechnicianExecutionWindow>
      )}
    </div>
  );
}
