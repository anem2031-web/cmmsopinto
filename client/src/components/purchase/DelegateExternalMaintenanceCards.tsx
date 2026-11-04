import { isDelegateRole } from "@shared/roles";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { useTranslation } from "@/contexts/LanguageContext";
import { mediaUrl } from "@/lib/mediaUrl";
import { localizeApiError } from "@/i18n/apiError";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

export function DelegateExternalMaintenanceCards() {
  const { authenticatedUser, loading } = useAuth();
  const { t } = useTranslation();
  if (loading) return <p>{t.workflow.purchase.loadingExternal}</p>;
  if (!authenticatedUser || !isDelegateRole(authenticatedUser.role) || Number(authenticatedUser.isActive) !== 1)
    return <p role="alert">{t.workflow.purchase.externalMaintenanceAccessDenied}</p>;
  return <AssignedExternalAssets delegateId={authenticatedUser.id} />;
}

function AssignedExternalAssets({ delegateId }: { delegateId: number }) {
  const { t } = useTranslation();
  const text = t.workflow.purchase;
  const utils = trpc.useUtils();
  const query = trpc.externalMaintenance.listForDelegate.useQuery();
  const [rejectedRow, setRejectedRow] = useState<any>(null);
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<{ src: string; label: string } | null>(null);
  const decision = trpc.externalMaintenance.decideDelegateReceipt.useMutation({
    onSuccess: () => {
      setRejectedRow(null); setReason("");
      void utils.externalMaintenance.listForDelegate.invalidate();
      toast.success(text.delegateReceiptDecisionSaved);
    },
    onError: error => toast.error(localizeApiError(error.message)),
  });
  // The server supplies only assigned pre-purchase rows. Keep the same boundary
  // in this view so an accepted asset never duplicates its later purchase item.
  const rows = (query.data || []).filter(row => Number(row.job.delegateId) === delegateId
    && row.job.purchaseOrderId == null && row.job.gateExitApprovedAt == null
    && ["waiting_delegate_receipt", "waiting_gate_exit", "waiting_warehouse_preparation"].includes(row.job.status));

  return <section className="space-y-3" aria-label={text.delegateExternalMaintenanceTab}>
    {query.isLoading ? <p>{text.loadingExternal}</p> : query.error ? <p role="alert" className="text-destructive">{localizeApiError(query.error.message)}</p> : rows.length === 0 ? <p className="text-muted-foreground">{text.noDelegateExternalAssets}</p> : rows.map(row => {
      const job = row.job;
      const canDecide = job.status === "waiting_delegate_receipt" && job.delegateReceiptStatus === "pending";
      const revision = Number(job.preparationRevision);
      const ready = Number.isSafeInteger(revision) && revision > 0 && !!job.purchaseTitle?.trim();
      const photos = [
        { src: job.assetBeforePhotoUrl, label: text.assetBeforePhotoRequired.replace(/\s*\*$/, "") },
      ].filter((photo, index, all) => photo.src && all.findIndex(item => item.src === photo.src) === index);
      return <Card key={job.id} data-external-job-id={job.id}><CardContent className="space-y-3 p-4">
        <h3 className="font-semibold break-words">{job.purchaseTitle || text.externalPurchaseTitleMissing}</h3>
        <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
          <div><dt className="text-muted-foreground">{text.asset}</dt><dd>{job.assetName || row.assetRegisteredName || "—"}</dd></div>
          <div><dt className="text-muted-foreground">{text.ticketNumber}</dt><dd dir="ltr">{row.ticketNumber}</dd></div>
          <div className="sm:col-span-2"><dt className="text-muted-foreground">{text.externalFaultDescription}</dt><dd className="whitespace-pre-wrap break-words">{row.ticketDescription || row.ticketTitle || "—"}</dd></div>
          <div><dt className="text-muted-foreground">{text.assetBeforeConditionRequired.replace(/\s*\*$/, "")}</dt><dd className="whitespace-pre-wrap break-words">{job.assetBeforeCondition || "—"}</dd></div>
          <div><dt className="text-muted-foreground">{text.warehouseNotes}</dt><dd className="whitespace-pre-wrap break-words">{job.warehouseNotes || "—"}</dd></div>
          <div><dt className="text-muted-foreground">{text.exitDocument}</dt><dd dir="ltr">{job.exitDocumentNumber || "—"}</dd></div>
        </dl>
        {photos.length > 0 && <div className="flex flex-wrap gap-3">{photos.map(photo => <button key={photo.src} type="button" className="rounded-md border p-1 text-start" aria-label={`${text.externalEnlargePhoto}: ${photo.label}`} onClick={() => setPreview({ src: photo.src!, label: photo.label })}>
          <img src={mediaUrl(photo.src)} alt={photo.label} className="h-24 w-32 object-contain" />
        </button>)}</div>}
        {canDecide ? <div className="flex flex-wrap gap-2">
          <Button disabled={decision.isPending || !ready} onClick={() => decision.mutate({ jobId: job.id, expectedRevision: revision, decision: "accept" })}>{decision.isPending && <Loader2 className="me-1 h-4 w-4 animate-spin" />}{text.delegateConfirmAssetReceipt}</Button>
          <Button variant="outline" disabled={decision.isPending || !ready} onClick={() => { setRejectedRow(row); setReason(""); }}>{text.delegateRejectAssetReceipt}</Button>
        </div> : job.delegateReceiptStatus === "accepted" ? <p className="text-sm text-primary">{text.delegateAcceptedAwaitingGate}</p> : job.delegateReceiptStatus === "rejected" ? <p className="text-sm text-destructive">{text.delegateReceiptRejected}: {job.delegateReceiptReason}<br />{text.delegateRejectedAwaitingWarehouse}</p> : <p className="text-sm text-muted-foreground">{text.delegateAwaitingWarehousePreparation}</p>}
      </CardContent></Card>;
    })}
    <Dialog open={!!rejectedRow} onOpenChange={open => { if (!open && !decision.isPending) setRejectedRow(null); }}>
      <DialogContent><DialogHeader><DialogTitle>{text.delegateRejectAssetReceipt}</DialogTitle></DialogHeader>
        <Label htmlFor="external-delegate-rejection">{text.delegateReceiptRejectionReason} *</Label>
        <Textarea id="external-delegate-rejection" required maxLength={4000} value={reason} disabled={decision.isPending} onChange={event => setReason(event.target.value)} />
        <DialogFooter><Button variant="outline" disabled={decision.isPending} onClick={() => setRejectedRow(null)}>{text.cancel}</Button><Button disabled={decision.isPending || !reason.trim()} onClick={() => {
          if (!rejectedRow || !reason.trim() || decision.isPending) return;
          decision.mutate({ jobId: rejectedRow.job.id, expectedRevision: Number(rejectedRow.job.preparationRevision), decision: "reject", reason: reason.trim() });
        }}>{text.delegateConfirmRejection}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={!!preview} onOpenChange={open => { if (!open) setPreview(null); }}>
      <DialogContent className="sm:max-w-4xl"><DialogHeader><DialogTitle>{preview?.label}</DialogTitle></DialogHeader>
        {preview && <img src={mediaUrl(preview.src)} alt={preview.label} className="max-h-[75vh] w-full object-contain" />}
        <DialogFooter><Button variant="outline" onClick={() => setPreview(null)}>{t.common.close}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </section>;
}
