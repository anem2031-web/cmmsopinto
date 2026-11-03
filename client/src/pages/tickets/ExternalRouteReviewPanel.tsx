import { useState } from "react";
import { useExecutionDraftDirty } from "../maintenance-teams/ExecutionLeaveGuard";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { useTranslation } from "@/contexts/LanguageContext";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { isExternalRouteReviewer, type ExternalRouteReview, type ExternalRoute } from "@shared/external-route-review";

function Decision({ row, onChanged }: { row: ExternalRouteReview; onChanged: () => void }) {
  const { language } = useTranslation();
  const l = (ar: string, en: string, ur: string) => language === "ar" ? ar : language === "ur" ? ur : en;
  const [reason, setReason] = useState("");
  const [path, setPath] = useState<ExternalRoute>("A");
  useExecutionDraftDirty(Boolean(reason.trim() || path !== "A"));
  const mutation = trpc.externalMaintenance.decideRouteReview.useMutation({ onSuccess: onChanged });
  return <section className="rounded-md border border-orange-300 p-4 space-y-3">
    <p className="font-semibold">{l("مراجعة طلب معاد من المستودع — البند", "Warehouse return — item", "گودام سے واپس — آئٹم")} {row.itemNumber}</p>
    <p className="whitespace-pre-wrap">{row.reason}</p>
    <label className="block">{l("المسار", "Route", "راستہ")}
      <select className="block border rounded p-2 w-full bg-background" value={path} onChange={e => setPath(e.target.value as ExternalRoute)} disabled={mutation.isPending}>
        <option value="A">A — {l("صيانة داخلية", "Internal repair", "اندرونی مرمت")}</option>
        <option value="B">B — {l("يحتاج مواد", "Materials needed", "مواد درکار")}</option>
        <option value="C">C — {l("تأكيد الصيانة الخارجية", "Confirm external repair", "بیرونی مرمت کی تصدیق")}</option>
      </select>
    </label>
    <label className="block">{l("سبب القرار (مطلوب)", "Decision reason (required)", "فیصلے کی وجہ (ضروری)")}
      <Textarea value={reason} onChange={e => setReason(e.target.value)} maxLength={4000} disabled={mutation.isPending} />
    </label>
    {mutation.error && <p role="alert" className="text-destructive">{mutation.error.message}</p>}
    <Button disabled={!reason.trim() || mutation.isPending} onClick={() => mutation.mutate({ ticketId: row.ticketId, ticketItemId: row.ticketItemId, returnId: row.returnId, path, reason })}>{l("حفظ قرار المسار", "Save route decision", "راستے کا فیصلہ محفوظ کریں")}</Button>
  </section>;
}

export function ExternalRouteReviewPanel({ ticketId, ticketItemId, onChanged }: { ticketId: number; ticketItemId?: number; onChanged: () => void }) {
  const { user } = useAuth();
  if (!user || !isExternalRouteReviewer(user.role)) return null;
  return <ReviewRows ticketId={ticketId} ticketItemId={ticketItemId} onChanged={onChanged} />;
}
function ReviewRows({ ticketId, ticketItemId, onChanged }: { ticketId: number; ticketItemId?: number; onChanged: () => void }) {
  const query = trpc.externalMaintenance.routeReviews.useQuery({ ticketId });
  const utils = trpc.useUtils();
  const refresh = () => {
    void utils.externalMaintenance.routeReviews.invalidate({ ticketId });
    void utils.externalMaintenance.listForWarehouse.invalidate();
    void utils.ticketTeamExecution.details.invalidate();
    void utils.ticketTeamAssignments.queue.invalidate();
    onChanged();
  };
  if (query.error) return <p role="alert" className="text-destructive">{query.error.message}</p>;
  return <>{query.data?.filter(r => ticketItemId == null || r.ticketItemId === ticketItemId).map(row => <Decision key={row.returnId} row={row} onChanged={refresh} />)}</>;
}
