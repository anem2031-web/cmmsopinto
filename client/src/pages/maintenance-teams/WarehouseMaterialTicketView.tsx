import { trpc } from "@/lib/trpc";
import { useTranslation } from "@/contexts/LanguageContext";
import { useStaticLabels } from "@/hooks/useContentTranslation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TicketReportMedia } from "./TicketReportMedia";

export function WarehouseMaterialTicketView({
  ticketId,
  onBack,
}: {
  ticketId: number;
  onBack?: () => void;
}) {
  const { language, dir } = useTranslation();
  const { getStatusLabel, getPriorityLabel } = useStaticLabels();
  const l = (ar: string, en: string, ur: string) =>
    language === "ar" ? ar : language === "ur" ? ur : en;
  const query = trpc.ticketTeamExecution.warehouseTicket.useQuery(
    { ticketId },
    { enabled: Number.isSafeInteger(ticketId) && ticketId > 0, retry: false }
  );
  const back = (
    <Button
      variant="outline"
      onClick={
        onBack ||
        (() => {
          window.location.href = `/scheduled-maintenance/warehouse-requests?source=tickets&ticketId=${ticketId}`;
        })
      }
    >
      {l(
        "العودة إلى طلبات المواد",
        "Back to material requests",
        "مواد کی درخواستوں پر واپس جائیں"
      )}
    </Button>
  );
  if (query.isLoading)
    return (
      <p role="status">
        {l("جارٍ تحميل البلاغ…", "Loading ticket…", "ٹکٹ لوڈ ہو رہا ہے…")}
      </p>
    );
  if (query.error || !query.data)
    return (
      <div className="space-y-4" dir={dir}>
        <p role="alert">
          {l(
            "البلاغ غير متاح للمستودع أو غير مرتبط بطلب مواد.",
            "This ticket is unavailable or has no material request.",
            "یہ ٹکٹ دستیاب نہیں یا مواد کی درخواست سے منسلک نہیں ہے۔"
          )}
        </p>
        {back}
      </div>
    );
  const ticket = query.data;
  return (
    <div className="space-y-4" dir={dir}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold" dir="ltr">
          {ticket.ticketNumber}
        </h1>
        {back}
      </div>
      <p className="text-sm text-muted-foreground">
        {l(
          "استعراض البلاغ المرتبط بطلب المواد — للقراءة فقط",
          "Material-request ticket — read only",
          "مواد کی درخواست کا ٹکٹ — صرف مطالعہ"
        )}
      </p>
      <Card>
        <CardHeader>
          <CardTitle>{ticket.title}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-3 text-sm sm:grid-cols-2">
            <p>
              {l("الموقع", "Site", "مقام")}: {ticket.siteName || "—"}
            </p>
            <p>
              {l("القسم", "Section", "شعبہ")}: {ticket.sectionName || "—"}
            </p>
            <p>
              {l("الفريق", "Team", "ٹیم")}: {ticket.teamName || "—"}
            </p>
            <p>
              {l("الحالة", "Status", "حالت")}: {getStatusLabel(ticket.status)}
            </p>
            <p>
              {l("الأولوية", "Priority", "ترجیح")}:{" "}
              {getPriorityLabel(ticket.priority)}
            </p>
          </div>
          <p className="whitespace-pre-wrap break-words">
            {ticket.description || "—"}
          </p>
          <TicketReportMedia media={ticket.reportMedia} language={language} />
        </CardContent>
      </Card>
    </div>
  );
}
