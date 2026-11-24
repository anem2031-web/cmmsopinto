import type { ReactNode } from "react";
import { useLocation, useSearch } from "wouter";
import { Button } from "@/components/ui/button";
import type { TicketReportMedia as ReportMedia } from "@shared/maintenance-team-tickets/assignment";
import { useExecutionCanLeave } from "./ExecutionLeaveGuard";
import { TicketReportMedia } from "./TicketReportMedia";

/** A shared presentation only; each workflow supplies its own authorized actions. */
export function TicketExecutionDetail({
  ticketNumber,
  title,
  description,
  location,
  media,
  language,
  children,
}: {
  ticketNumber: string;
  title: string;
  description?: string;
  location: ReactNode;
  media?: ReportMedia[];
  language: string;
  children: ReactNode;
}) {
  return (
    <>
      <header>
        <h1 className="text-xl font-bold" dir="ltr">
          {ticketNumber}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">{location}</p>
      </header>
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="whitespace-pre-wrap text-sm">{description}</p>
      <TicketReportMedia media={media} language={language} />
      {children}
    </>
  );
}

export function useReturnToTicketTasks() {
  const [path, navigate] = useLocation();
  const search = useSearch();
  return () => {
    if (window.history.state?.fromTeamTicketList) window.history.back();
    else {
      const params = new URLSearchParams(search);
      params.delete("teamExecution");
      params.delete("itExecution");
      navigate(`${path}${params.size ? `?${params}` : ""}`);
    }
  };
}

export function TicketExecutionBackButton({
  language,
  disabled,
}: {
  language: string;
  disabled?: boolean;
}) {
  const canLeave = useExecutionCanLeave(),
    back = useReturnToTicketTasks();
  return (
    <Button
      variant="outline"
      disabled={disabled}
      onClick={() => {
        if (canLeave()) back();
      }}
    >
      {language === "ar"
        ? "العودة إلى مهام الفريق"
        : language === "ur"
          ? "ٹیم کے کاموں پر واپس"
          : "Back to team tasks"}
    </Button>
  );
}
