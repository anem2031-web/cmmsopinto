import { useState } from "react";
import { APP_ROLE } from "@shared/roles";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { useTranslation } from "@/contexts/LanguageContext";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { localizeApiError } from "@/i18n/apiError";
import { toast } from "sonner";

export function canManagerAssignOwnItem(actor: { id: number; role?: string | null; isActive?: number | boolean | null } | null | undefined, item: any): boolean {
  return !!actor && actor.role === APP_ROLE.DELEGATE_MANAGER && Number(actor.isActive) === 1
    && !!item && item.managerAssignable === true && Number(item.delegateId) === actor.id
    && item.status === "pending" && item.batchId == null && !item.delegateChangeRequestedAt
    && item.estimatedUnitCost == null && item.estimatedTotalCost == null && item.estimatedById == null
    && item.ticketPath !== "C" && !item.isExternalMaintenance;
}

export function DelegateManagerAssignmentDialog({ item, onClose, onAssigned }: { item: any; onClose: () => void; onAssigned: () => void }) {
  const { authenticatedUser } = useAuth();
  if (!canManagerAssignOwnItem(authenticatedUser, item)) return null;
  return <AssignmentDialog item={item} onClose={onClose} onAssigned={onAssigned} />;
}

function AssignmentDialog({ item, onClose, onAssigned }: { item: any; onClose: () => void; onAssigned: () => void }) {
  const { t } = useTranslation();
  const text = t.purchaseOrders;
  const [delegateId, setDelegateId] = useState("");
  const delegates = trpc.purchaseOrders.delegateAssignmentOptions.useQuery();
  const assign = trpc.purchaseOrders.assignOwnDelegateItem.useMutation({
    onSuccess: () => { toast.success(text.managerAssignmentSaved); onAssigned(); onClose(); },
    onError: error => toast.error(localizeApiError(error.message)),
  });
  const selected = delegates.data?.some(delegate => delegate.id === Number(delegateId));
  return <Dialog open onOpenChange={open => { if (!open && !assign.isPending) onClose(); }}><DialogContent>
    <DialogHeader><DialogTitle>{text.managerAssignToDelegate}</DialogTitle></DialogHeader>
    <p className="break-words text-sm">{item.itemName}</p>
    <Label htmlFor="manager-assignment-delegate">{text.delegate} *</Label>
    <select id="manager-assignment-delegate" className="h-10 w-full rounded-md border bg-background px-3" required value={delegateId} disabled={assign.isPending || delegates.isLoading} onChange={event => setDelegateId(event.target.value)}>
      <option value="">{text.managerChooseDelegate}</option>
      {delegates.data?.map(delegate => <option key={delegate.id} value={String(delegate.id)}>{delegate.name || delegate.username}</option>)}
    </select>
    {delegates.error && <p role="alert" className="text-destructive">{localizeApiError(delegates.error.message)}</p>}
    {!delegates.isLoading && !delegates.error && !delegates.data?.length && <p>{text.managerNoDelegates}</p>}
    <DialogFooter><Button variant="outline" disabled={assign.isPending} onClick={onClose}>{t.common.cancel}</Button><Button disabled={!selected || assign.isPending || delegates.isLoading || !!delegates.error} onClick={() => {
      if (!selected || assign.isPending) return;
      assign.mutate({ purchaseOrderId: item.purchaseOrderId, itemId: item.id, delegateId: Number(delegateId) });
    }}>{text.managerConfirmAssignment}</Button></DialogFooter>
  </DialogContent></Dialog>;
}
