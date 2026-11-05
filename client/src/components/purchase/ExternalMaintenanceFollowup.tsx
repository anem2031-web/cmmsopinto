import { useEffect, useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { useTranslation } from "@/contexts/LanguageContext";
import { trpc } from "@/lib/trpc";
import { independentReadOptions } from "@/lib/read-transport";
import { mediaUrl } from "@/lib/mediaUrl";
import { localizeApiError } from "@/i18n/apiError";
import { externalMaintenanceLabels } from "@/i18n/externalMaintenanceFollowup";
import { externalMaintenanceReturnTime, parseExternalTimestamp } from "@shared/externalMaintenanceReturnTime";
import { canReadExternalFollowupRole } from "@shared/external-maintenance-followup";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function canViewExternalFollowup(user: { role?: string | null; isActive?: number | boolean | null } | null | undefined): boolean {
  return !!user && Number(user.isActive) === 1 && canReadExternalFollowupRole(user.role);
}
export function ExternalMaintenanceFollowup({ view = "active" }: { view?: "active" | "received" }) {
  const { authenticatedUser, loading } = useAuth();
  const { language } = useTranslation();
  const text = externalMaintenanceLabels(language);
  if (loading) return <p>{text.loading}</p>;
  if (!canViewExternalFollowup(authenticatedUser)) return <p role="alert">{text.accessDenied}</p>;
  return <AuthorizedFollowup key={`${authenticatedUser!.id}:${authenticatedUser!.role}:${view}`} view={view} />;
}

export function ExternalFollowupCard({ row, now, onOpen, language }: { row: any; now: Date; onOpen: () => void; language: string }) {
  const text = externalMaintenanceLabels(language);
  const timing = externalMaintenanceReturnTime(row, now);
  const timingText = timing.state === "missing" ? text.missingDate : timing.state === "today" ? text.today : (timing.state === "late" ? text.late : text.remaining).replace("{days}", String(timing.days));
  const returned = !!row.gateEntryApprovedAt;
  const isLate = timing.state === "late" && (!row.warehouseReceivedAt || returned);
  return <button type="button" className="w-full text-start" onClick={onOpen} aria-label={`${text.details}: ${row.purchaseTitle || "—"}`}>
    <Card data-external-followup-id={row.jobId} className={`h-full transition-shadow hover:shadow-md ${isLate ? "border-red-400 bg-red-50/70" : ""}`}>
      <CardContent className="space-y-3 p-4">
        <h3 className="font-semibold break-words">{row.purchaseTitle || "—"}</h3>
        <div className="flex h-36 items-center justify-center rounded-md bg-muted/30">
          {row.assetBeforePhotoUrl ? <img src={mediaUrl(row.assetBeforePhotoUrl)} alt={text.beforePhoto} className="h-full w-full object-contain" /> : <span>—</span>}
        </div>
        <dl className="space-y-2 text-sm">
          <div><dt className="text-muted-foreground">{text.delegate}</dt><dd>{row.delegateName || "—"}</dd></div>
          <div><dt className="text-muted-foreground">{text.expectedReturnDate}</dt><dd dir="ltr">{row.expectedReturnDate?.slice(0, 10) || "—"}</dd></div>
        </dl>
        {(!row.warehouseReceivedAt || returned) && (!returned || timing.state === "late") && <p className={`text-sm font-medium ${timing.state === "late" ? "text-red-700" : "text-primary"}`} data-return-timing={timing.state}>{timingText}</p>}
        {row.warehouseReceivedAt ? <p className="text-sm text-muted-foreground">{text.receivedStatus}</p> : returned ? <p className="text-sm text-primary">{text.waitingWarehouse}</p> : null}
      </CardContent>
    </Card>
  </button>;
}

function AuthorizedFollowup({ view }: { view: "active" | "received" }) {
  const { language } = useTranslation();
  const text = externalMaintenanceLabels(language);
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [now, setNow] = useState(() => new Date());
  const query = trpc.externalMaintenance.listFollowup.useQuery({ view, page, pageSize: 24 }, { ...independentReadOptions, retry: false, refetchOnMount: "always", refetchInterval: 30_000 });
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const pages = Math.max(1, Math.ceil((query.data?.total || 0) / 24));
  useEffect(() => { if (page > pages && query.isSuccess) setPage(pages); }, [page, pages, query.isSuccess]);
  const rows = query.isFetchedAfterMount && !query.error ? query.data?.rows || [] : [];
  return <section className="space-y-3" aria-label={view === "received" ? text.received : text.tab}>
    {view === "received" && <h2 className="text-lg font-semibold">{text.received}</h2>}
    {query.isLoading || (!query.isFetchedAfterMount && !query.error) ? <p>{text.loading}</p> : query.error ? <p role="alert" className="text-destructive">{localizeApiError(query.error.message)}</p> : rows.length === 0 ? <p className="text-muted-foreground">{view === "received" ? text.emptyReceived : text.empty}</p> : <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {rows.filter(row => view === "received" ? !!row.warehouseReceivedAt : !row.warehouseReceivedAt).map(row => <ExternalFollowupCard key={row.jobId} row={row} now={now} language={language} onOpen={() => setSelectedId(row.jobId)} />)}
    </div>}
    {!query.error && pages > 1 && <div className="flex items-center justify-center gap-3">
      <Button variant="outline" size="sm" disabled={page <= 1 || query.isFetching} onClick={() => setPage(value => value - 1)}>{text.previous}</Button>
      <span className="text-sm">{text.page.replace("{page}", String(page)).replace("{pages}", String(pages))}</span>
      <Button variant="outline" size="sm" disabled={page >= pages || query.isFetching} onClick={() => setPage(value => value + 1)}>{text.next}</Button>
    </div>}
    {selectedId != null && <FollowupDetails key={selectedId} jobId={selectedId} onClose={() => setSelectedId(null)} />}
  </section>;
}

export function externalWorkshopLocation(value?: string | null): string | null {
  if (!value) return null;
  try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) ? url.href : null; } catch { return null; }
}
export function ExternalFollowupDetailsContent({ row, language, onPhoto }: { row: any; language: string; onPhoto: (photo: { src: string; label: string }) => void }) {
  const text = externalMaintenanceLabels(language);
  const locale = language === "ar" ? "ar-SA" : language === "ur" ? "ur-PK" : "en-GB";
  const timestamp = (value?: string | Date | null) => value && parseExternalTimestamp(value)?.toLocaleString(locale, { timeZone: "Asia/Riyadh" }) || "—";
  const location = externalWorkshopLocation(row.workshopLocationUrl);
  const knownStage = ["purchase_cycle", "waiting_gate_entry", "waiting_warehouse_receipt", "waiting_technician_handover", "delivered_for_reinstall", "reinstall_in_progress", "ready_for_closure", "closed"].includes(row.status);
  const stage = knownStage ? text[row.status as keyof typeof text] : row.warehouseReceivedAt ? text.receivedStatus : row.gateEntryApprovedAt ? text.waitingWarehouse : text.maintenance;
  const fields = [
    [text.asset, row.assetName], [text.ticket, row.ticketNumber], [text.purchaseOrder, row.poNumber], [text.delegate, row.delegateName],
    [text.workshopName, row.workshopName], [text.workshopPhone, row.workshopPhone], [text.expectedReturnDate, row.expectedReturnDate?.slice(0, 10)],
    [text.workshopNotes, row.workshopNotes], [text.warehouseNotes, row.warehouseNotes], [text.beforeCondition, row.assetBeforeCondition],
    [text.stage, stage], [text.exitAt, timestamp(row.gateExitApprovedAt)], [text.exitBy, row.gateExitApprovedByName],
    [text.entryAt, timestamp(row.gateEntryApprovedAt)], [text.entryBy, row.gateEntryApprovedByName],
    [text.receivedAt, timestamp(row.warehouseReceivedAt)], [text.receivedBy, row.warehouseReceivedByName], [text.returnCondition, row.returnCondition], [text.returnNotes, row.warehouseReturnNotes],
  ];
  const photos = [{ src: row.assetBeforePhotoUrl, label: text.beforePhoto }, { src: row.assetAfterReturnPhotoUrl, label: text.afterPhoto }]
    .filter((photo, index, all) => photo.src && all.findIndex(other => other.src === photo.src) === index);
  return <div className="space-y-4">
    <h3 className="font-semibold break-words">{row.purchaseTitle || "—"}</h3>
    <dl className="grid gap-3 text-sm sm:grid-cols-2">{fields.map(([label, value]) => <div key={label}><dt className="text-muted-foreground">{label}</dt><dd className="whitespace-pre-wrap break-words">{value || "—"}</dd></div>)}</dl>
    <div className="text-sm"><p className="text-muted-foreground">{text.workshopLocationUrl}</p>{location ? <a href={location} target="_blank" rel="noopener noreferrer" className="text-primary underline">{text.openLocation}</a> : <p>{row.workshopLocationUrl || "—"}</p>}</div>
    <div className="flex flex-wrap gap-3">{photos.map(photo => <button type="button" key={photo.src} aria-label={`${text.enlarge}: ${photo.label}`} className="rounded-md border p-1" onClick={() => onPhoto({ src: photo.src, label: photo.label })}><img src={mediaUrl(photo.src)} alt={photo.label} className="h-28 w-40 object-contain" /></button>)}</div>
  </div>;
}
function FollowupDetails({ jobId, onClose }: { jobId: number; onClose: () => void }) {
  const { language } = useTranslation();
  const text = externalMaintenanceLabels(language);
  const [photo, setPhoto] = useState<{ src: string; label: string } | null>(null);
  const detail = trpc.externalMaintenance.followupDetail.useQuery({ jobId }, { ...independentReadOptions, retry: false, refetchOnMount: "always", refetchInterval: 30_000 });
  return <>
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
      <DialogHeader><DialogTitle>{text.details}</DialogTitle></DialogHeader>
      {detail.isLoading || (!detail.isFetchedAfterMount && !detail.error) ? <p>{text.loading}</p> : detail.error ? <p role="alert" className="text-destructive">{localizeApiError(detail.error.message)}</p> : detail.data ? <ExternalFollowupDetailsContent row={detail.data} language={language} onPhoto={setPhoto} /> : <p>{text.empty}</p>}
      <DialogFooter><Button variant="outline" onClick={onClose}>{text.close}</Button></DialogFooter>
    </DialogContent></Dialog>
    <Dialog open={!!photo} onOpenChange={open => { if (!open) setPhoto(null); }}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl"><DialogHeader><DialogTitle>{photo?.label}</DialogTitle></DialogHeader>
      {photo && <img src={mediaUrl(photo.src)} alt={photo.label} className="max-h-[75vh] w-full object-contain" />}
      <DialogFooter><Button variant="outline" onClick={() => setPhoto(null)}>{text.close}</Button></DialogFooter>
    </DialogContent></Dialog>
  </>;
}
