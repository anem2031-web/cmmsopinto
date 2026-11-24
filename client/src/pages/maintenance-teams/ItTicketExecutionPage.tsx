import { useEffect, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { useTranslation } from "@/contexts/LanguageContext";
import {
  useResolvedTranslation,
  getLocalizedName,
} from "@/hooks/useTranslatedField";
import { trpc } from "@/lib/trpc";
import { mediaUrl } from "@/lib/mediaUrl";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  isItTeamRole,
  MAINTENANCE_RESPONSIBLE_DEPARTMENT as DEPT,
} from "@shared/roles";
import { canExecuteItSubTicket } from "@shared/it-execution-workflow";
import type { TicketReportMedia } from "@shared/maintenance-team-tickets/assignment";
import { ItExecutionPanel, ItPurchaseNeedsPanel } from "../tickets/ItTeamPanel";
import { ExternalRouteReviewPanel } from "../tickets/ExternalRouteReviewPanel";
import {
  ExecutionLeaveGuard,
  useExecutionCanLeave,
} from "./ExecutionLeaveGuard";
import {
  TicketExecutionDetail,
  TicketExecutionBackButton,
} from "./TicketExecutionDetail";
import { canSeeItTicketTab } from "./ticket-list-state";

/** IT ticket identity stays separate from a team-assignment identity. No new workflow. */
export default function ItTicketExecutionPage() {
  const { user, loading } = useAuth();
  const { language, dir, t } = useTranslation();
  const search = useSearch();
  const ticketId = Number(new URLSearchParams(search).get("itExecution"));
  const allowed = user?.isActive === 1 && canSeeItTicketTab(user.role);
  const validId = Number.isSafeInteger(ticketId) && ticketId > 0;
  const trpcUtils = trpc.useUtils();
  const ticketQuery = trpc.tickets.getById.useQuery(
    { id: ticketId },
    {
      enabled: !!allowed && validId,
      retry: false,
      refetchOnMount: "always",
    }
  );
  const ticket = ticketQuery.data;
  const candidate =
    !!allowed &&
    validId &&
    !ticketQuery.error &&
    ticket?.id === ticketId &&
    ticket.workflowModel === "sub_ticket" &&
    !!ticket.sourceTaskId;
  const itHeader = ticket?.maintenanceResponsibleDepartment === DEPT.IT;
  // Historical compatibility headers may differ from the canonical IT item.
  // This preserves list visibility; it never grants named IT execution.
  const items = trpc.tickets.items.useQuery(
    { ticketId },
    { enabled: !!candidate && !itHeader, retry: false }
  );
  const selected =
    candidate &&
    (itHeader ||
      (!items.error &&
        items.data?.some(
          (item: { ticketId: number; responsibleDepartment?: string | null }) =>
            item.ticketId === ticketId && item.responsibleDepartment === DEPT.IT
        )));
  const references = trpc.tickets.executionReferences.useQuery(
    { ticketId },
    { enabled: !!selected, retry: false }
  );
  const attachments = trpc.attachments.list.useQuery(
    { entityType: "ticket", entityId: ticketId },
    { enabled: !!selected, retry: false }
  );
  const { getField } = useResolvedTranslation(
    "TICKET",
    selected ? ticketId : undefined,
    selected ? ticket : undefined,
    ticket?.originalLanguage
  );
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [ticketId]);
  const l = (ar: string, en: string, ur: string) =>
    language === "ar" ? ar : language === "ur" ? ur : en;
  if (loading || (allowed && validId && ticketQuery.isLoading) || (candidate && !itHeader && items.isLoading))
    return <p className="p-6">{t.common.loading}</p>;
  const media: TicketReportMedia[] = [];
  const addMedia = (
    url: string | null | undefined,
    type: "image" | "video",
    name = ""
  ) => {
    const normalized = mediaUrl(url);
    if (normalized && !media.some(item => item.url === normalized))
      media.push({ url: normalized, type, name });
  };
  if (selected) {
    addMedia(ticket.beforePhotoUrl, "image");
    for (const attachment of attachments.data ?? []) {
      const mime = String(attachment.mimeType || "").toLowerCase();
      if (mime.startsWith("image/"))
        addMedia(attachment.fileUrl, "image", attachment.fileName);
      else if (mime.startsWith("video/"))
        addMedia(attachment.fileUrl, "video", attachment.fileName);
    }
  }
  const refresh = () => {
    void ticketQuery.refetch();
    void trpcUtils.ticketTeamAssignments.list.invalidate();
  };
  // Keep the existing IT manager's purchase-needs review separate from named execution.
  const team = isItTeamRole(user?.role) && itHeader;
  const status = ticket
    ? (t.ticketStatus as Record<string, string>)[ticket.status] ||
      t.common.loading
    : "";
  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 p-3 sm:p-6" dir={dir}>
      <ExecutionLeaveGuard language={language} busy={busy}>
        <TicketExecutionBackButton language={language} disabled={busy} />
        {!selected ? (
          <p role="alert">
            {l(
              "التذكرة غير متاحة لك ضمن تذاكر تقنية المعلومات الحالية.",
              "This ticket is not available among your current IT tickets.",
              "یہ ٹکٹ آپ کے موجودہ آئی ٹی ٹکٹوں میں دستیاب نہیں۔"
            )}
          </p>
        ) : (
          <>
            <TicketExecutionDetail
              ticketNumber={ticket.ticketNumber}
              title={getField("title")}
              description={getField("description")}
              language={language}
              media={media}
              location={
                <>
                  {getLocalizedName(
                    references.data?.sites.find(
                      site => site.id === ticket.siteId
                    ),
                    language
                  )}{" "}
                  /{" "}
                  {getLocalizedName(
                    references.data?.sections.find(
                      section => section.id === ticket.sectionId
                    ),
                    language
                  )}{" "}
                  ·{" "}
                  {references.data?.users.find(
                    person => person.id === ticket.assignedToId
                  )?.name ||
                    l(
                      "لم يُحدد المنفذ",
                      "Executor not assigned",
                      "کارکن مقرر نہیں"
                    )}
                </>
              }
            >
              <Badge variant="outline">{status}</Badge>
              {attachments.error && (
                <p role="alert" className="text-sm text-destructive">
                  {l(
                    "تعذر تحميل مرفقات التذكرة. يرجى المحاولة مجددًا.",
                    "Could not load ticket attachments. Please try again.",
                    "ٹکٹ کے منسلکات لوڈ نہیں ہو سکے۔ دوبارہ کوشش کریں۔"
                  )}
                </p>
              )}
              {!canExecuteItSubTicket(user, ticket) &&
                !["closed", "requester_confirmed"].includes(ticket.status) && (
                  <p className="text-sm text-muted-foreground">
                    {l(
                      "تنفيذ التذكرة متاح للمكلّف بها فقط.",
                      "Ticket execution is available only to its assigned executor.",
                      "ٹکٹ پر کام صرف مقررہ کارکن کر سکتا ہے۔"
                    )}
                  </p>
                )}
              {team && (
                <ItExecutionPanel
                  key={ticketId}
                  ticket={ticket}
                  onChanged={refresh}
                  onBusyChange={setBusy}
                />
              )}
              {team && <ItPurchaseNeedsPanel key={ticketId} ticket={ticket} />}
              <ExternalRouteReviewPanel
                ticketId={ticketId}
                onChanged={refresh}
              />
            </TicketExecutionDetail>
            <FullTicketButton
              ticketId={ticketId}
              busy={busy}
              language={language}
            />
          </>
        )}
      </ExecutionLeaveGuard>
    </div>
  );
}

function FullTicketButton({
  ticketId,
  busy,
  language,
}: {
  ticketId: number;
  busy: boolean;
  language: string;
}) {
  const [, navigate] = useLocation();
  const canLeave = useExecutionCanLeave();
  return (
    <Button
      variant="outline"
      disabled={busy}
      onClick={() => {
        if (canLeave()) navigate(`/tickets/${ticketId}`);
      }}
    >
      {language === "ar"
        ? "فتح البلاغ الكامل"
        : language === "ur"
          ? "مکمل رپورٹ کھولیں"
          : "Open full ticket"}
    </Button>
  );
}
