import { parseExternalTimestamp } from "@shared/externalMaintenanceReturnTime";

/** Display the original request, never the recipient or the latest workflow update. */
export function MaterialRequestMeta({ creatorName, sentAt, language }: {
  creatorName?: string | null; sentAt?: string | Date | null; language: string;
}) {
  const labels = language === "ar" ? ["منشئ طلب المواد", "وقت الإرسال (الرياض)"]
    : language === "ur" ? ["مواد کی درخواست بنانے والا", "ارسال کا وقت (ریاض)"]
    : ["Material request creator", "Sent at (Riyadh)"];
  const date = sentAt ? parseExternalTimestamp(sentAt) : null;
  const locale = language === "ar" ? "ar-SA-u-ca-gregory" : language === "ur" ? "ur-PK" : "en-GB";
  return <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
    <p>{labels[0]}: <span className="font-medium text-foreground">{creatorName?.trim() || "—"}</span></p>
    <p>{labels[1]}: <span className="font-medium text-foreground">{date ? new Intl.DateTimeFormat(locale, {
      timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    }).format(date) : "—"}</span></p>
  </div>;
}
