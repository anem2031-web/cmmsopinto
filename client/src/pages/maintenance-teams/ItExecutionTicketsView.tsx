import type { ItExecutionListRow } from "@shared/maintenance-team-tickets/list";
import { Badge } from "@/components/ui/badge";
import { MapPin, UserRound } from "lucide-react";
import { useTranslation } from "@/contexts/LanguageContext";
import { ticketListText } from "@/i18n/ticketList";

/** Existing IT tickets keep their named executor and their current execution page. */
export function ItExecutionTicketsView({
  tickets,
  language,
  onOpen,
}: {
  tickets: ItExecutionListRow[];
  language: "ar" | "en" | "ur";
  onOpen: (ticketId: number) => void;
}) {
  const text = ticketListText[language];
  const { t } = useTranslation();
  const status = (ticket: ItExecutionListRow) =>
    ticket.state === "other"
      ? (t.ticketStatus as Record<string, string>)[ticket.status] ||
        text.otherStatus
      : text.statuses[ticket.state];
  return (
    <div
      className="grid gap-3 md:grid-cols-2"
      dir={language === "en" ? "ltr" : "rtl"}
    >
      {tickets.map(ticket => (
        <button
          key={ticket.id}
          type="button"
          onClick={() => onOpen(ticket.id)}
          className="w-full space-y-3 rounded-xl border bg-card p-4 text-start transition hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <div className="flex items-start justify-between gap-3">
            <span className="font-semibold" dir="ltr">
              {ticket.ticketNumber}
            </span>
            <Badge
              variant={ticket.state === "closed" ? "secondary" : "outline"}
            >
              {status(ticket)}
            </Badge>
          </div>
          <p className="font-medium">{ticket.title}</p>
          <p className="flex items-start gap-1 text-sm text-muted-foreground">
            <MapPin aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              {ticket.siteName} / {ticket.sectionName}
            </span>
          </p>
          <p className="flex items-center gap-1 text-sm text-muted-foreground">
            <UserRound aria-hidden className="h-4 w-4 shrink-0" />
            <span>
              {text.executor}: {ticket.assignedToName || text.unassigned}
            </span>
          </p>
          {ticket.parentTicketNumber && (
            <p className="text-xs text-muted-foreground">
              {text.parentReport}:{" "}
              <span dir="ltr" className="inline-block">
                {ticket.parentTicketNumber}
              </span>
            </p>
          )}
          <p className="text-sm text-primary">{text.openDetails}</p>
        </button>
      ))}
    </div>
  );
}
