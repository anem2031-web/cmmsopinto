import { MaterialCostPanel } from "@/components/inventory/MaterialCostPanel";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { TechnicianExecutionWindow, ExecutionElapsedTime } from "@/components/maintenance/TechnicianExecutionWindow";
import { currentExecutionStep } from "@shared/technician-workspace";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TicketSourceSummary } from "@/components/maintenance/TicketSourceSummary";
import CreateTicket from "@/pages/tickets/CreateTicket";
import { TechnicianStatusCards, technicianBucketTitle } from "@/components/maintenance/TechnicianStatusCards";
import { scheduledTaskBucket, bucketCounts, type TechnicianBucket } from "@shared/technician-task-buckets";
import { BellRing, CalendarClock, Camera, Check, CheckCircle2, ChevronsUpDown, ClipboardList, Clock3, ExternalLink, History, ImageIcon, Loader2, MapPin, PackageSearch, PlayCircle, RefreshCw, TicketPlus, Users, Wrench } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { useTranslation } from "@/contexts/LanguageContext";
import { useStaticLabels } from "@/hooks/useContentTranslation";
import { EntityTranslatedText } from "@/components/i18n/EntityTranslatedText";
import { mediaUrl } from "@/lib/mediaUrl";
import { toast } from "sonner";
import { useLocation } from "wouter";
import { localizeApiError } from "@/i18n/apiError";
import {
  getPmv2MaterialQuantityValidationMessage,
  pmv2MaterialUnitRequiresWholeQuantity,
} from "@shared/pmv2MaterialQuantity";

function buildTaskStatusLabels(t: any): Record<string, string> {
  return {
    pending: t.workflow.pmv2.pending,
    in_progress: t.workflow.pmv2.inProgress,
    waiting_material: t.workflow.pmv2.waitingMaterial,
    waiting_ticket: t.workflow.pmv2.waitingTicket,
    ready_to_complete: t.workflow.pmv2.readyToComplete,
    completed: t.workflow.pmv2.completed,
    cancelled: t.workflow.pmv2.cancelled,
  };
}

function buildItemStatusLabels(t: any): Record<string, string> {
  return { ...buildTaskStatusLabels(t), completed: t.workflow.pmv2.itemCompleted };
}

function buildItemResultLabels(t: any): Record<string, string> {
  return {
    ok: t.workflow.pmv2.ok,
    fixed: t.workflow.pmv2.fixed,
    needs_material: t.workflow.pmv2.needsMaterial,
    needs_ticket: t.workflow.pmv2.needsTicket,
  };
}


function formatTimelineMinutes(value: number | null | undefined, t: any) {
  const minutes = Math.max(0, Number(value || 0));
  if (minutes < 60) return `${minutes} ${t.workflow.pmv2.minutesShort}`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 24) return rest ? `${hours} ${t.workflow.pmv2.hoursShort} ${rest} ${t.workflow.pmv2.minutesShort}` : `${hours} ${t.workflow.pmv2.hoursShort}`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours ? `${days} ${t.workflow.pmv2.day} ${remHours} ${t.workflow.pmv2.hoursShort}` : `${days} ${t.workflow.pmv2.day}`;
}

function formatTimelineDate(value: string | null | undefined, locale: string) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString(locale);
}

function targetLabel(task: {
  siteName?: string | null;
  sectionName?: string | null;
  assetName?: string | null;
}, t: any) {
  return [task.siteName, task.sectionName, task.assetName].filter(Boolean).join(" / ") || t.workflow.pmv2.unnamedTarget;
}

function ItemEvidence({ taskId, taskItemId }: { taskId: number; taskItemId: number }) {
  const { t } = useTranslation();
  const evidenceQuery = trpc.pmv2.technician.evidence.useQuery({ taskId, taskItemId });
  const addAttachment = trpc.attachments.add.useMutation();
  const [uploading, setUploading] = useState(false);

  const handleImage = async (file: File | undefined) => {
    if (!file) return;
    const targetActionId = evidenceQuery.data?.uploadActionId;
    if (!targetActionId) {
      toast.error(t.workflow.pmv2.evidenceUnavailable);
      return;
    }
    const looksLikeImage = file.type.startsWith("image/") || /\.(jpe?g|png|webp|gif|heic|heif|bmp|tiff?)$/i.test(file.name);
    if (!looksLikeImage) {
      toast.error(t.workflow.pmv2.imageOnly);
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/api/upload", { method: "POST", body: formData });
      const uploaded = await response.json();
      if (!response.ok || !uploaded?.url || !uploaded?.fileKey) {
        throw new Error(uploaded?.error || t.workflow.pmv2.uploadFailed);
      }
      await addAttachment.mutateAsync({
        entityType: "pmv2_item_action",
        entityId: targetActionId,
        fileName: file.name,
        fileUrl: uploaded.url,
        fileKey: uploaded.fileKey,
        mimeType: file.type || undefined,
        fileSize: file.size,
      });
      await evidenceQuery.refetch();
      toast.success(t.workflow.pmv2.evidenceAdded);
    } catch (error: any) {
      toast.error(error?.message ? localizeApiError(error.message) : t.workflow.pmv2.evidenceUploadFailed);
    } finally {
      setUploading(false);
    }
  };

  const evidence = evidenceQuery.data?.evidence ?? [];
  const canUpload = Boolean(evidenceQuery.data?.uploadActionId);

  if (!evidenceQuery.isLoading && !evidenceQuery.error && evidence.length === 0 && !canUpload) return null;

  return (
    <div className="w-full space-y-2 rounded-md border border-dashed p-2 sm:w-[360px]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-medium">
          <ImageIcon className="h-4 w-4" />
          {t.workflow.pmv2.evidenceTitle}
        </div>
        {canUpload && (
          <label className="inline-flex cursor-pointer items-center rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-muted">
            {uploading ? <Loader2 className="me-1 h-4 w-4 animate-spin" /> : <Camera className="me-1 h-4 w-4" />}
            {uploading ? t.workflow.pmv2.uploading : t.workflow.pmv2.addEvidence}
            <input
              type="file"
              accept="image/*,.heic,.heif"
              className="hidden"
              disabled={uploading}
              onChange={event => {
                const file = event.target.files?.[0];
                event.currentTarget.value = "";
                void handleImage(file);
              }}
            />
          </label>
        )}
      </div>

      {evidenceQuery.isLoading && <p className="text-xs text-muted-foreground">{t.workflow.pmv2.loadingEvidence}</p>}
      {evidenceQuery.error && <p className="text-xs text-destructive">{localizeApiError(evidenceQuery.error.message)}</p>}
      {evidence.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {evidence.map(file => (
            <a
              key={file.id}
              href={mediaUrl(file.fileUrl || file.fileKey)}
              target="_blank"
              rel="noreferrer"
              title={file.fileName}
              className="block h-16 w-16 overflow-hidden rounded-md border bg-muted"
            >
              <img
                src={mediaUrl(file.fileUrl || file.fileKey)}
                alt={file.fileName}
                className="h-full w-full object-cover"
              />
            </a>
          ))}
        </div>
      )}
      {canUpload && <p className="text-[11px] text-muted-foreground">{t.workflow.pmv2.evidenceOptional}</p>}
    </div>
  );
}




function MaterialNeedPanel({ taskId, taskItemId, onBusyChange }: { taskId: number; taskItemId: number; onBusyChange?: (busy: boolean) => void }) {
  const { t, language, dir } = useTranslation();
  const localizedCatalogName = (item: any) => language === "ar"
    ? (item?.nameAr || item?.nameEn || "—")
    : (item?.nameEn || item?.nameAr || "—");
  const localizedCategoryPath = (item: any) => language === "ar"
    ? (item?.categoryPathAr || item?.categoryPathEn || "")
    : (item?.categoryPathEn || item?.categoryPathAr || "");
  const localizedWarehouseName = (item: any) => language === "ar"
    ? (item?.nameAr || item?.nameEn || "—")
    : (item?.nameEn || item?.nameAr || "—");
  const materialRequestStatus: Record<string, string> = {
    waiting_warehouse: t.workflow.pmv2.waitingMainWarehouse,
    external_purchase: t.workflow.pmv2.externalPurchase,
    received_warehouse: t.workflow.pmv2.receivedMainWarehouse,
    issued_to_team: t.workflow.pmv2.issuedTeam,
    consumed: t.workflow.pmv2.consumed,
    cancelled: t.workflow.pmv2.cancelled,
  };
  const utils = trpc.useUtils();
  const [search, setSearch] = useState("");
  const [entryMode, setEntryMode] = useState<"catalog" | "unlisted">("catalog");
  const [catalogItemId, setCatalogItemId] = useState("");
  const [selectedCatalogItemSnapshot, setSelectedCatalogItemSnapshot] = useState<any>(null);
  const [materialPickerOpen, setMaterialPickerOpen] = useState(false);
  const [unlistedItemName, setUnlistedItemName] = useState("");
  const [quantity, setQuantity] = useState("");
  const [lastRoute, setLastRoute] = useState<any>(null);
  const [formOpenOverride, setFormOpenOverride] = useState<boolean | null>(null);
  const [receiveConfirmation, setReceiveConfirmation] = useState<null | {
    mode: "new" | "existing";
    routeDecisionActionId?: number;
    itemName: string;
    quantity: number;
    unit: string;
    catalogItemId?: number;
  }>(null);

  const resetMaterialEntry = () => {
    setEntryMode("catalog");
    setSearch("");
    setCatalogItemId("");
    setSelectedCatalogItemSnapshot(null);
    setMaterialPickerOpen(false);
    setUnlistedItemName("");
    setQuantity("");
  };

  const materialState = trpc.pmv2.technician.materialState.useQuery({ taskId, taskItemId });
  const readyReceiptsQuery = trpc.pmv2.technician.readyMaterialReceipts.useQuery({ taskId, taskItemId });
  const catalogQuery = trpc.pmv2.technician.materialCatalog.useQuery({ taskId, taskItemId, search });

  const refreshMaterialSurface = async () => {
    await utils.materialCosts.invalidate();
    await Promise.all([
      materialState.refetch(),
      readyReceiptsQuery.refetch(),
      utils.pmv2.technician.items.invalidate({ taskId }),
      utils.pmv2.technician.today.invalidate(),
      utils.pmv2.technician.workspace.invalidate(),
      utils.pmv2.technician.materialAttention.invalidate(),
    ]);
  };

  const submitMaterialNeed = trpc.pmv2.technician.submitMaterialNeed.useMutation({
    onSuccess: async data => {
      if (data.route === "team_inventory") {
        setLastRoute(null);
        toast.success(t.workflow.pmv2.fullQtyAvailableSaved);
        resetMaterialEntry();
        setFormOpenOverride(false);
        await refreshMaterialSurface();
      } else if (data.unlistedCatalogItem) {
        setLastRoute(data);
        toast.success(`${t.workflow.pmv2.registerUnlistedAction} (${data.shortageQuantity} ${data.unit})`);
        resetMaterialEntry();
        setFormOpenOverride(false);
        await refreshMaterialSurface();
      } else {
        setLastRoute(data);
        toast.success(`${t.workflow.pmv2.recordNeedRequestShortage} (${data.shortageQuantity} ${data.unit})`);
        resetMaterialEntry();
        setFormOpenOverride(false);
        await refreshMaterialSurface();
      }
    },
    onError: async error => {
      toast.error(localizeApiError(error.message));
      await refreshMaterialSurface();
    },
  });

  const submitAndReceiveMaterialNeed = trpc.pmv2.technician.submitAndReceiveMaterialNeed.useMutation({
    onSuccess: async (data: any) => {
      setReceiveConfirmation(null);
      if (data.route === "material_request") {
        setLastRoute(data);
        toast.success(`${t.workflow.pmv2.recordNeedRequestShortage} (${data.shortageQuantity} ${data.unit})`);
        resetMaterialEntry();
        setFormOpenOverride(false);
        await refreshMaterialSurface();
        return;
      }
      if (data.issue?.completed && !data.issue?.partial) {
        toast.success(`${t.workflow.pmv2.confirmReceipt}: ${data.issue.issuedQuantity} ${data.unit}`);
      } else {
        toast.error(data.issue?.message ? localizeApiError(data.issue.message, language) : t.workflow.pmv2.materialReceiveIncomplete);
      }
      resetMaterialEntry();
      setFormOpenOverride(false);
      await refreshMaterialSurface();
    },
    onError: async error => {
      setReceiveConfirmation(null);
      toast.error(localizeApiError(error.message));
      await refreshMaterialSurface();
    },
  });

  const receiveReadyMaterial = trpc.pmv2.technician.receiveReadyMaterial.useMutation({
    onSuccess: async (data: any) => {
      setReceiveConfirmation(null);
      if (data.completed && !data.partial) {
        toast.success(`${t.workflow.pmv2.confirmReceipt}: ${data.issuedQuantity}`);
      } else {
        toast.error(data.message ? localizeApiError(data.message, language) : t.workflow.pmv2.materialReceiveIncomplete);
      }
      await refreshMaterialSurface();
    },
    onError: async error => {
      setReceiveConfirmation(null);
      toast.error(localizeApiError(error.message));
      await refreshMaterialSurface();
    },
  });

  const catalogItems = catalogQuery.data ?? [];
  const requests = materialState.data?.requests ?? [];
  const teamInventoryHandoffs = materialState.data?.teamInventoryHandoffs ?? [];
  const readyReceipts = readyReceiptsQuery.data ?? [];
  const readyReceiptByRoute = new Map(readyReceipts.map((receipt: any) => [Number(receipt.routeDecisionActionId), receipt]));
  const readyReceiptByRequestItem = new Map(
    readyReceipts
      .filter((receipt: any) => receipt.materialRequestItemId != null)
      .map((receipt: any) => [Number(receipt.materialRequestItemId), receipt]),
  );
  const activeRequests = requests.filter(request => !["consumed", "cancelled"].includes(request.status));
  const activeCatalogRequestIds = new Set(
    activeRequests.flatMap(request => {
      const directCatalogItemId = request.catalogItemId == null ? null : Number(request.catalogItemId);
      const identityResolution = request.identityResolution as any;
      const resolvedCatalogItemId = identityResolution?.resolvedCatalogItemId == null
        ? null
        : Number(identityResolution.resolvedCatalogItemId);
      return [directCatalogItemId, resolvedCatalogItemId]
        .filter((id): id is number => Number.isInteger(id) && id > 0);
    }),
  );
  const readyCatalogItemIds = new Set(teamInventoryHandoffs.map(handoff => Number(handoff.catalogItemId)));
  const blockedCatalogItemIds = new Set([...activeCatalogRequestIds, ...readyCatalogItemIds]);
  const normalizeMaterialName = (value: string) => value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
  const unlistedDuplicateActive = entryMode === "unlisted" && Boolean(
    unlistedItemName.trim() && activeRequests.some(request =>
      request.catalogItemId == null &&
      normalizeMaterialName(request.itemNameSnapshot) === normalizeMaterialName(unlistedItemName),
    ),
  );
  const defaultFormOpen = activeRequests.length === 0 && teamInventoryHandoffs.length === 0;
  const formOpen = formOpenOverride ?? defaultFormOpen;
  const selectedCatalogItem = catalogItems.find(item => String(item.id) === catalogItemId)
    ?? (String(selectedCatalogItemSnapshot?.id ?? "") === catalogItemId ? selectedCatalogItemSnapshot : undefined);
  const selectedAvailability = selectedCatalogItem?.teamAvailability;
  const unit = entryMode === "catalog" ? String(selectedCatalogItem?.unit || "").trim() : "";
  const parsedQuantity = Number(quantity);
  const previewUnit = unit || t.workflow.pmv2.unitGeneric;
  const quantityValidationMessage = quantity.trim()
    ? getPmv2MaterialQuantityValidationMessage(parsedQuantity, unit)
    : null;
  const quantityIsValid = Boolean(quantity.trim()) && !quantityValidationMessage;
  const requiresWholeQuantity = pmv2MaterialUnitRequiresWholeQuantity(unit);
  const availableQuantity = selectedAvailability?.ambiguous
    ? null
    : Math.max(0, Number(selectedAvailability?.availableQuantity || 0));
  const shortageQuantity = availableQuantity != null && quantityIsValid
    ? Math.max(0, Number((parsedQuantity - availableQuantity).toFixed(3)))
    : null;
  const canSubmitCatalog = Boolean(
    catalogItemId && quantityIsValid && unit.trim() && !blockedCatalogItemIds.has(Number(catalogItemId)),
  );
  const canSubmitUnlisted = Boolean(
    unlistedItemName.trim() && quantityIsValid && !unlistedDuplicateActive,
  );
  const fullStockReadyForSelfReceive = Boolean(
    entryMode === "catalog" &&
    canSubmitCatalog &&
    !selectedAvailability?.ambiguous &&
    shortageQuantity === 0,
  );
  const anyMaterialMutationPending = submitMaterialNeed.isPending || submitAndReceiveMaterialNeed.isPending || receiveReadyMaterial.isPending;
  useEffect(() => { onBusyChange?.(anyMaterialMutationPending); return () => onBusyChange?.(false); }, [anyMaterialMutationPending, onBusyChange]);

  const openAnotherMaterial = () => {
    resetMaterialEntry();
    setLastRoute(null);
    setFormOpenOverride(true);
  };

  const switchToUnlisted = () => {
    setEntryMode("unlisted");
    setCatalogItemId("");
    setSelectedCatalogItemSnapshot(null);
    setMaterialPickerOpen(false);
    setLastRoute(null);
    if (!unlistedItemName.trim() && search.trim()) setUnlistedItemName(search.trim());
  };

  const switchToCatalog = () => {
    setEntryMode("catalog");
    setUnlistedItemName("");
    setLastRoute(null);
  };

  return (
    <div className="w-full space-y-3 rounded-md border border-amber-200 bg-amber-50/40 p-3 sm:w-[420px]">
      <div className="flex items-start gap-2">
        <PackageSearch className="mt-0.5 h-4 w-4 text-amber-700" />
        <div>
          <p className="text-sm font-medium">{t.workflow.pmv2.identifyMaterial}</p>
          <p className="text-[11px] text-muted-foreground">
            {t.workflow.pmv2.materialRoutingHelp}
          </p>
        </div>
      </div>

      {materialState.isLoading && <p className="text-xs text-muted-foreground">{t.workflow.pmv2.loadingMaterialState}</p>}
      {materialState.error && <p className="text-xs text-destructive">{localizeApiError(materialState.error.message)}</p>}
      {materialState.data?.teamWarehouse && (
        <p className="text-xs text-muted-foreground">
          {t.workflow.pmv2.teamStore}: <strong>{language === "ar" ? materialState.data.teamWarehouse.nameAr : (materialState.data.teamWarehouse.nameEn || materialState.data.teamWarehouse.nameAr)}</strong>
          {materialState.data.teamWarehouse.code ? ` (${materialState.data.teamWarehouse.code})` : ""}
        </p>
      )}

      {(requests.length > 0 || teamInventoryHandoffs.length > 0) && (
        <div className="space-y-2 rounded-md border bg-background p-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-medium">{t.workflow.pmv2.currentMaterialNeeds}</p>
            {!formOpen && (
              <Button type="button" size="sm" variant="outline" onClick={openAnotherMaterial}>
                {t.workflow.pmv2.addAnotherMaterial}
              </Button>
            )}
          </div>
          {teamInventoryHandoffs.map(handoff => {
            const receipt = readyReceiptByRoute.get(Number(handoff.actionId));
            return (
              <div key={`handoff-${handoff.actionId}`} className="space-y-1.5 rounded-md border border-emerald-200 bg-emerald-50/70 p-2 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>{handoff.itemNameSnapshot} — {handoff.requestedQuantity} {handoff.unit}</span>
                  <Badge variant="outline" className={receipt?.canReceive ? "border-emerald-300 text-emerald-800" : "border-amber-300 text-amber-800"}>
                    {receipt?.canReceive ? t.workflow.pmv2.readyReceiveTeamStore : t.workflow.pmv2.waitingFullBalance}
                  </Badge>
                </div>
                {receipt ? (
                  <>
                    <p className={receipt.canReceive ? "text-emerald-800" : "text-amber-800"}>
                      {t.workflow.pmv2.availableNow}: {receipt.availableQuantity} {receipt.unit}. {t.workflow.pmv2.remainingForTask}: {receipt.remainingQuantity} {receipt.unit}.
                      {receipt.canReceive
                        ? ` ${t.workflow.pmv2.receiveUsesInventory}`
                        : ` ${receipt.blocker || t.workflow.pmv2.waitingFullTeamQuantity}`}
                    </p>
                    {receipt.canReceive && receipt.lotAllocations?.length > 1 && (
                      <p className="text-[11px] text-muted-foreground">{t.workflow.pmv2.autoAllocateLots.replace("{count}", String(receipt.lotAllocations.length))}</p>
                    )}
                    {receipt.canReceive && (
                      <Button
                        type="button"
                        size="sm"
                        disabled={anyMaterialMutationPending}
                        onClick={() => setReceiveConfirmation({
                          mode: "existing",
                          routeDecisionActionId: Number(receipt.routeDecisionActionId),
                          itemName: receipt.itemName,
                          quantity: Number(receipt.remainingQuantity),
                          unit: receipt.unit,
                        })}
                      >
                        {t.workflow.pmv2.receiveFromTeamStore}
                      </Button>
                    )}
                  </>
                ) : (
                  <p className="text-amber-800">{t.workflow.pmv2.recheckingBalance}</p>
                )}
              </div>
            );
          })}
          {requests.map(request => {
            const receipt = readyReceiptByRequestItem.get(Number(request.requestItemId));
            const identityResolution = request.identityResolution as any;
            const requestStatusLabel = identityResolution?.route === "team_inventory" && request.status === "cancelled"
              ? t.workflow.pmv2.identityResolvedAvailable
              : (materialRequestStatus[request.status] ?? request.status);
            return (
              <div key={request.requestItemId} className="space-y-1.5 rounded-md border p-2 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span><EntityTranslatedText entityType="PMV2_MATERIAL_REQUEST_ITEM" entityId={Number(request.requestItemId)} field="itemNameSnapshot" original={request.itemNameSnapshot} /> — {request.requestedQuantity} {request.unitSnapshot || t.workflow.pmv2.unitGeneric}</span>
                    {request.catalogItemId == null && <Badge variant="secondary">{t.workflow.pmv2.unlistedCatalog}</Badge>}
                    {identityResolution && <Badge variant="outline" className="border-blue-300 bg-blue-50 text-blue-800">{t.workflow.pmv2.identifiedByWarehouse}</Badge>}
                  </span>
                  <Badge variant="outline" className={receipt?.canReceive ? "border-emerald-300 text-emerald-800" : ""}>
                    {receipt?.canReceive ? t.workflow.pmv2.readyReceiveTeamStore : requestStatusLabel}
                  </Badge>
                </div>
                {identityResolution && (
                  <div className="rounded border border-blue-200 bg-blue-50/60 p-2 text-blue-900">
                    <p className="font-medium">{t.workflow.pmv2.warehouseIdentifiedMaterial}</p>
                    <p>{t.workflow.pmv2.yourDescription}: «{identityResolution.originalItemName}»</p>
                    <p>{t.workflow.pmv2.resolvedItem}: <strong>{identityResolution.resolvedItemName}</strong>{identityResolution.resolvedItemCode ? ` — ${identityResolution.resolvedItemCode}` : ""}</p>
                    {identityResolution.route === "team_inventory"
                      ? <p className="mt-1 font-medium text-emerald-800">{t.workflow.pmv2.resolvedAvailableReceive}</p>
                      : <p className="mt-1">{t.workflow.pmv2.shortageAfterResolve.replace("{qty}", String(identityResolution.shortageQuantity)).replace("{unit}", identityResolution.unit || request.unitSnapshot || t.workflow.pmv2.unitGeneric)}</p>}
                  </div>
                )}
                {receipt && (
                  <p className={receipt.canReceive ? "text-emerald-800" : "text-amber-800"}>
                    {t.workflow.pmv2.availableNow}: {receipt.availableQuantity} {receipt.unit}. {t.workflow.pmv2.requiredForFullReceipt}: {receipt.remainingQuantity} {receipt.unit}.
                    {!receipt.canReceive && ` ${receipt.blocker || t.workflow.pmv2.waitingShortageCompletion}`}
                  </p>
                )}
                {receipt?.canReceive && (
                  <>
                    {receipt.lotAllocations?.length > 1 && (
                      <p className="text-[11px] text-muted-foreground">{t.workflow.pmv2.autoAllocateLotsShort.replace("{count}", String(receipt.lotAllocations.length))}</p>
                    )}
                    <Button
                      type="button"
                      size="sm"
                      disabled={anyMaterialMutationPending}
                      onClick={() => setReceiveConfirmation({
                        mode: "existing",
                        routeDecisionActionId: Number(receipt.routeDecisionActionId),
                        itemName: receipt.itemName,
                        quantity: Number(receipt.remainingQuantity),
                        unit: receipt.unit,
                      })}
                    >
                      {t.workflow.pmv2.receiveFromTeamStore}
                    </Button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {formOpen && <div className="space-y-2">
        {entryMode === "catalog" ? (
          <>
            <Popover
              open={materialPickerOpen}
              onOpenChange={open => {
                setMaterialPickerOpen(open);
                if (!open) setSearch("");
              }}
            >
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  role="combobox"
                  aria-expanded={materialPickerOpen}
                  className="h-auto min-h-10 w-full justify-between gap-2 px-3 py-2 text-start font-normal"
                >
                  <span className="min-w-0 flex-1">
                    {selectedCatalogItem ? (
                      <span className="flex min-w-0 flex-col items-start gap-0.5">
                        <span className="w-full truncate font-medium">
                          {localizedCatalogName(selectedCatalogItem)}{selectedCatalogItem.code ? ` — ${selectedCatalogItem.code}` : ""}
                        </span>
                        <span className="text-[11px] text-muted-foreground">
                          {selectedCatalogItem.teamAvailability?.ambiguous
                            ? t.workflow.pmv2.teamBalanceNeedsReview
                            : t.workflow.pmv2.teamAvailable.replace("{qty}", String(Math.max(0, Number(selectedCatalogItem.teamAvailability?.availableQuantity || 0)))).replace("{unit}", selectedCatalogItem.teamAvailability?.unit || selectedCatalogItem.unit || t.workflow.pmv2.unitGeneric)}
                        </span>
                        {localizedCategoryPath(selectedCatalogItem) && (
                          <span className="w-full truncate text-[11px] text-muted-foreground">
                            {localizedCategoryPath(selectedCatalogItem)}
                          </span>
                        )}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">{t.workflow.pmv2.searchChooseMaterial}</span>
                    )}
                  </span>
                  <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                <Command shouldFilter={false}>
                  <CommandInput
                    value={search}
                    onValueChange={setSearch}
                    placeholder={t.workflow.pmv2.searchMaterialCode}
                  />
                  <CommandList>
                    {catalogQuery.isFetching && (
                      <div className="flex items-center justify-center gap-2 px-3 py-4 text-xs text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        {t.workflow.pmv2.searchingCatalog}
                      </div>
                    )}
                    {!catalogQuery.isFetching && catalogItems.length === 0 && (
                      <CommandEmpty>{t.workflow.pmv2.noMatchingMaterial}</CommandEmpty>
                    )}
                    <CommandGroup heading={search.trim() ? t.workflow.pmv2.searchAllCatalogResults : t.workflow.pmv2.smartSuggestions}>
                      {catalogItems.map(item => {
                        const availability = item.teamAvailability;
                        const blocked = blockedCatalogItemIds.has(Number(item.id));
                        const balanceLabel = availability?.ambiguous
                          ? t.workflow.pmv2.balanceNeedsReview
                          : t.workflow.pmv2.balanceValue.replace("{qty}", String(Math.max(0, Number(availability?.availableQuantity || 0)))).replace("{unit}", availability?.unit || item.unit || t.workflow.pmv2.unitGeneric);
                        const statusLabel = activeCatalogRequestIds.has(Number(item.id))
                          ? t.workflow.pmv2.alreadyRequested
                          : readyCatalogItemIds.has(Number(item.id))
                            ? t.workflow.pmv2.readyToReceive
                            : null;
                        const smartSignals = item.smartSignals as any;
                        const smartLabel = smartSignals?.inTeamStock
                          ? t.workflow.pmv2.availableTeamStore
                          : Number(smartSignals?.sameTargetUseCount || 0) > 0
                            ? t.workflow.pmv2.usedForTarget
                            : Number(smartSignals?.teamUseCount || 0) > 0
                              ? t.workflow.pmv2.usedByTeam
                              : null;
                        return (
                          <CommandItem
                            key={item.id}
                            value={`${item.nameAr || ""} ${item.nameEn || ""} ${item.code || ""}`}
                            disabled={blocked}
                            onSelect={() => {
                              setCatalogItemId(String(item.id));
                              setSelectedCatalogItemSnapshot(item);
                              setLastRoute(null);
                              setSearch("");
                              setMaterialPickerOpen(false);
                            }}
                            className="items-start py-2"
                          >
                            <Check className={`mt-0.5 h-4 w-4 ${catalogItemId === String(item.id) ? "opacity-100" : "opacity-0"}`} />
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="font-medium leading-5">{localizedCatalogName(item)}</span>
                                {smartLabel && (
                                  <Badge variant={smartSignals?.inTeamStock ? "default" : "outline"} className="h-5 px-1.5 text-[10px]">
                                    {smartLabel}
                                  </Badge>
                                )}
                              </div>
                              <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                                {item.code && <span>{t.workflow.pmv2.codeLabel}: {item.code}</span>}
                                <span>{balanceLabel}</span>
                                {statusLabel && <span className="font-medium text-amber-700">{statusLabel}</span>}
                              </div>
                              {item.categoryPathAr && (
                                <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                                  {t.workflow.pmv2.categoryLabel}: {localizedCategoryPath(item)}
                                </div>
                              )}
                            </div>
                          </CommandItem>
                        );
                      })}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>

            <p className="text-[11px] text-muted-foreground">
              {t.workflow.pmv2.catalogSuggestionHelp}
            </p>

            <div className="text-xs">
              <span className="text-muted-foreground">{t.workflow.pmv2.materialNotFoundPrompt} </span>
              <button
                type="button"
                className="font-medium text-primary underline-offset-4 hover:underline"
                onClick={switchToUnlisted}
              >
                {t.workflow.pmv2.registerUnlistedMaterial}
              </button>
            </div>
          </>
        ) : (
          <div className="space-y-2 rounded-md border border-amber-300 bg-background p-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-xs font-medium">{t.workflow.pmv2.unlistedMaterialTitle}</p>
                <p className="text-[11px] text-muted-foreground">
                  {t.workflow.pmv2.unlistedMaterialHelp}
                </p>
              </div>
              <Button type="button" size="sm" variant="outline" onClick={switchToCatalog}>
                {t.workflow.pmv2.backToCatalog}
              </Button>
            </div>
            <Input
              value={unlistedItemName}
              onChange={event => {
                setUnlistedItemName(event.target.value);
                setLastRoute(null);
              }}
              placeholder={t.workflow.pmv2.unlistedNamePlaceholder}
              maxLength={300}
            />
            {unlistedDuplicateActive && (
              <p className="text-xs text-destructive">
                {t.workflow.pmv2.activeRequestExists}
              </p>
            )}
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <Input
            type="number"
            min={requiresWholeQuantity ? "1" : "0.001"}
            step={requiresWholeQuantity ? "1" : "0.001"}
            value={quantity}
            onChange={event => {
              setQuantity(event.target.value);
              setLastRoute(null);
            }}
            placeholder={t.workflow.pmv2.requiredQuantityPlaceholder}
            dir="ltr"
            aria-invalid={Boolean(quantityValidationMessage)}
          />
          {entryMode === "catalog" ? <Input value={unit} readOnly aria-label={t.workflow.pmv2.unitPlaceholder} placeholder={t.workflow.pmv2.unitPlaceholder} />
            : <p className="self-center text-xs text-muted-foreground">{language === "ar" ? "يحدد المستودع الوحدة والكمية عند الربط بالكتالوج" : language === "ur" ? "کیٹلاگ سے ربط کے وقت گودام اکائی اور مقدار کی تصدیق کرے گا" : "Warehouse confirms the unit and quantity when linking the catalog item"}</p>}
        </div>

        {quantityValidationMessage && (
          <p className="text-xs text-destructive">{quantityValidationMessage}</p>
        )}

        {entryMode === "catalog" && selectedCatalogItem && (
          <div className="space-y-2 rounded-md border bg-background p-2.5 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">{localizedCatalogName(selectedCatalogItem)}</span>
              {selectedAvailability?.ambiguous ? (
                <Badge variant="destructive">{t.workflow.pmv2.inventoryNeedsReview}</Badge>
              ) : (
                <Badge variant="outline">{t.workflow.pmv2.availableLabel}: {availableQuantity ?? 0} {previewUnit}</Badge>
              )}
            </div>

            {selectedAvailability?.ambiguous ? (
              <p className="text-destructive">
                {t.workflow.pmv2.duplicateInventoryCards}
              </p>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-1.5 text-center">
                  <div className="rounded border p-1.5">
                    <div className="text-[10px] text-muted-foreground">{t.workflow.pmv2.requiredLabel}</div>
                    <div className="font-medium">{quantityIsValid ? parsedQuantity : "—"}</div>
                  </div>
                  <div className="rounded border p-1.5">
                    <div className="text-[10px] text-muted-foreground">{t.workflow.pmv2.availableShort}</div>
                    <div className="font-medium">{availableQuantity ?? 0}</div>
                  </div>
                  <div className="rounded border p-1.5">
                    <div className="text-[10px] text-muted-foreground">{t.workflow.pmv2.shortageLabel}</div>
                    <div className="font-medium">{shortageQuantity ?? "—"}</div>
                  </div>
                </div>
                {shortageQuantity === 0 && quantityIsValid && (
                  <p className="text-emerald-700">
                    {t.workflow.pmv2.fullQuantityNoMainRequest}
                  </p>
                )}
                {shortageQuantity != null && shortageQuantity > 0 && (
                  <p className="text-amber-800">
                    {t.workflow.pmv2.partialAvailabilityRoute.replace("{available}", String(availableQuantity)).replace("{shortage}", String(shortageQuantity)).replaceAll("{unit}", previewUnit)}
                  </p>
                )}
                {selectedAvailability?.lotsRequired && (
                  <p className="text-[11px] text-muted-foreground">{t.workflow.pmv2.positiveLotsBalanceHelp}</p>
                )}
              </>
            )}
          </div>
        )}

        {entryMode === "unlisted" && (
          <div className="rounded-md border bg-background p-2.5 text-xs text-amber-900">
            {t.workflow.pmv2.unknownCatalogRouteHelp.split("{status}")[0]}<strong>{t.workflow.pmv2.waitingMainWarehouse}</strong>{t.workflow.pmv2.unknownCatalogRouteHelp.split("{status}")[1]}
          </div>
        )}

        <Button
          size="sm"
          type="button"
          disabled={anyMaterialMutationPending || (entryMode === "catalog" ? !canSubmitCatalog : !canSubmitUnlisted)}
          onClick={() => {
            const nextQuantity = Number(quantity);
            if (entryMode === "catalog" && !unit.trim()) {
              toast.error(t.workflow.pmv2.enterMaterialUnit);
              return;
            }
            const nextQuantityValidationMessage = getPmv2MaterialQuantityValidationMessage(nextQuantity, unit);
            if (nextQuantityValidationMessage) {
              toast.error(nextQuantityValidationMessage);
              return;
            }
            if (entryMode === "catalog" && !catalogItemId) {
              toast.error(t.workflow.pmv2.chooseCatalogMaterial);
              return;
            }
            if (entryMode === "unlisted" && !unlistedItemName.trim()) {
              toast.error(t.workflow.pmv2.enterUnlistedMaterialName);
              return;
            }

            if (fullStockReadyForSelfReceive && selectedCatalogItem) {
              setReceiveConfirmation({
                mode: "new",
                itemName: localizedCatalogName(selectedCatalogItem),
                quantity: nextQuantity,
                unit: unit.trim(),
                catalogItemId: Number(catalogItemId),
              });
              return;
            }

            submitMaterialNeed.mutate({
              taskId,
              taskItemId,
              catalogItemId: entryMode === "catalog" ? Number(catalogItemId) : null,
              unlistedItemName: entryMode === "unlisted" ? unlistedItemName.trim() : undefined,
              quantity: nextQuantity,
              unit: entryMode === "catalog" ? unit : undefined,
            });
          }}
        >
          {anyMaterialMutationPending ? <Loader2 className="me-1 h-4 w-4 animate-spin" /> : <PackageSearch className="me-1 h-4 w-4" />}
          {anyMaterialMutationPending
            ? (fullStockReadyForSelfReceive ? t.workflow.pmv2.receivingMaterials : t.workflow.pmv2.savingNeed)
            : entryMode === "unlisted"
              ? t.workflow.pmv2.registerUnlistedAction
              : fullStockReadyForSelfReceive
                ? t.workflow.pmv2.receiveFromTeamStore
                : shortageQuantity != null && shortageQuantity > 0
                  ? t.workflow.pmv2.recordNeedRequestShortage
                  : t.workflow.pmv2.recordNeed}
        </Button>
      </div>}

      {lastRoute?.route === "material_request" && (
        <div className="rounded-md border border-amber-300 bg-amber-100/70 p-2 text-xs text-amber-900">
          {lastRoute.unlistedCatalogItem
            ? `${t.workflow.pmv2.registerUnlistedAction} #${lastRoute.requestId}: ${lastRoute.itemNameSnapshot} — ${lastRoute.shortageQuantity} ${lastRoute.unit} — ${t.workflow.pmv2.waitingMainWarehouse}`
            : `${t.workflow.pmv2.recordNeedRequestShortage} #${lastRoute.requestId}: ${lastRoute.shortageQuantity} ${lastRoute.unit} — ${t.workflow.pmv2.waitingMainWarehouse}`}
        </div>
      )}

      <AlertDialog
        open={Boolean(receiveConfirmation)}
        onOpenChange={(open) => { if (!open && !anyMaterialMutationPending) setReceiveConfirmation(null); }}
      >
        <AlertDialogContent dir={dir}>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.workflow.pmv2.confirmReceiveMaterialsTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {t.workflow.pmv2.confirmReceipt}: {receiveConfirmation?.quantity ?? 0} {receiveConfirmation?.unit || ""}
              {receiveConfirmation?.itemName ? ` «${receiveConfirmation.itemName}»` : ""}
              {materialState.data?.teamWarehouse ? ` — ${localizedWarehouseName(materialState.data.teamWarehouse)}` : ""}.
              {t.workflow.pmv2.receiveInventoryExplanation}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={anyMaterialMutationPending}>{t.workflow.pmv2.cancel}</AlertDialogCancel>
            <AlertDialogAction
              disabled={anyMaterialMutationPending || !receiveConfirmation}
              onClick={() => {
                const confirmation = receiveConfirmation;
                if (!confirmation) return;
                if (confirmation.mode === "new") {
                  submitAndReceiveMaterialNeed.mutate({
                    taskId,
                    taskItemId,
                    catalogItemId: Number(confirmation.catalogItemId),
                    quantity: confirmation.quantity,
                    unit: confirmation.unit,
                  });
                  return;
                }
                receiveReadyMaterial.mutate({
                  routeDecisionActionId: Number(confirmation.routeDecisionActionId),
                });
              }}
            >
              {anyMaterialMutationPending && <Loader2 className="me-1 h-4 w-4 animate-spin" />}
              {t.workflow.pmv2.confirmReceipt}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function MaterialCompletionPanel({ taskId, taskItemId, onBusyChange }: { taskId: number; taskItemId: number; onBusyChange?: (busy: boolean) => void }) {
  const {t}=useTranslation();
  const utils = trpc.useUtils();
  const materials = trpc.pmv2.technician.completionMaterials.useQuery({ taskId, taskItemId });
  const [usedByCatalog, setUsedByCatalog] = useState<Record<number, string>>({});
  const [usedByDelivery, setUsedByDelivery] = useState<Record<number,string>>({});
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!materials.data) return;
    setUsedByDelivery(current=>{
      const next={...current};
      for(const item of materials.data) for(const part of item.physicalParts ?? []) if(next[part.deliveryDocumentId]==null) next[part.deliveryDocumentId]=String(part.quantity);
      return next;
    });
    setUsedByCatalog((current) => {
      const next = { ...current };
      for (const item of materials.data) {
        if (next[item.catalogItemId] == null) next[item.catalogItemId] = String(item.defaultUsedQuantity);
      }
      return next;
    });
  }, [materials.data]);

  const complete = trpc.pmv2.technician.submitBasicResult.useMutation({
    onSuccess: async (data: any) => {
      if(data.hasPhysicalReturns) toast.success(t.workflow.pmv2.pendingPmv2Returns);
      else if (Number(data.pendingReturnQuantity || 0) > 0) {
        toast.success(t.workflow.pmv2.usageRecordedReturnPending.replace("{qty}", String(data.pendingReturnQuantity)));
      } else {
        toast.success(t.workflow.pmv2.fixedNoReturn);
      }
      await Promise.all([
        utils.pmv2.technician.today.invalidate(),
      utils.pmv2.technician.workspace.invalidate(),
        utils.pmv2.technician.items.invalidate({ taskId }),
        utils.pmv2.technician.visitState.invalidate({ taskId }),
        utils.pmv2.technician.timeline.invalidate({ taskId }),
        utils.pmv2.warehouse.pendingReturns.invalidate(),
      ]);
    },
    onError: (error) => toast.error(localizeApiError(error.message)),
  });

  useEffect(() => { onBusyChange?.(complete.isPending); return () => onBusyChange?.(false); }, [complete.isPending, onBusyChange]);
  if (materials.isLoading) return <p className="text-xs text-muted-foreground">{t.workflow.pmv2.loadingIssuedMaterials}</p>;
  if (materials.error) return <p className="text-xs text-destructive">{localizeApiError(materials.error.message)}</p>;
  const rows = materials.data ?? [];
  if (!rows.length) return <p className="text-xs text-muted-foreground">{t.workflow.pmv2.noIssuedMaterials}</p>;

  return (
    <div className="w-full space-y-3 rounded-lg border border-emerald-200 bg-emerald-50/40 p-3 sm:w-[420px]">
      <div>
        <p className="text-sm font-semibold">{t.workflow.pmv2.completeRepairAfterMaterials}</p>
        <p className="text-xs text-muted-foreground">{t.workflow.pmv2.actualUsageHelp}</p>
      </div>
      {rows.map((item) => (
        <div key={item.catalogItemId} className="rounded-md border bg-background p-2">
          <div className="text-sm font-medium">{item.itemName}{item.itemCode ? ` — ${item.itemCode}` : ""}</div>
          <div className="mt-1 text-xs text-muted-foreground">{t.workflow.pmv2.issuedForTask}: {item.issuedQuantity} {item.unit} · {t.workflow.pmv2.requiredLabel}: {item.requiredQuantity} {item.unit}</div>
          {!!item.physicalParts?.length ? item.physicalParts.map((part:any)=><div key={part.deliveryDocumentId} className="mt-2 rounded border p-2">
            <p className="text-xs font-medium">{part.itemName} · {part.lotCode} · {part.quantity} {part.unit} ↔ {part.originalQuantity} {item.unit}</p>
            <label className="mt-2 block text-xs font-medium">{t.workflow.pmv2.usedQuantityLabel} ({part.unit})</label>
            <Input type="number" min="0" max={part.quantity} step={pmv2MaterialUnitRequiresWholeQuantity(part.unit)?"1":"0.001"} value={usedByDelivery[part.deliveryDocumentId]??""} onChange={event=>setUsedByDelivery(current=>({...current,[part.deliveryDocumentId]:event.target.value}))}/>
          </div>) : <><label className="mt-2 block text-xs font-medium">{t.workflow.pmv2.usedQuantityLabel}</label>
          <Input
            type="number"
            min="0"
            max={item.issuedQuantity}
            step={pmv2MaterialUnitRequiresWholeQuantity(item.unit) ? "1" : "0.001"}
            value={usedByCatalog[item.catalogItemId] ?? ""}
            onChange={(event) => setUsedByCatalog((current) => ({ ...current, [item.catalogItemId]: event.target.value }))}
          /></>}
        </div>
      ))}
      <Textarea rows={2} maxLength={2000} value={note} onChange={(event) => setNote(event.target.value)} placeholder={t.workflow.pmv2.repairNoteOptional} />
      <Button
        size="sm"
        className="w-full"
        disabled={complete.isPending}
        onClick={() => {
          const materialUsages = rows.map((item) => ({
            catalogItemId: item.catalogItemId,
            usedQuantity: Number(usedByCatalog[item.catalogItemId] ?? item.issuedQuantity),
            ...(item.physicalParts?.length ? {physicalUsages:item.physicalParts.map((part:any)=>({deliveryDocumentId:part.deliveryDocumentId,usedQuantity:Number(usedByDelivery[part.deliveryDocumentId]??part.quantity)}))}: {}),
          }));
          if (materialUsages.some((item) => !Number.isFinite(item.usedQuantity) || item.usedQuantity < 0 || item.physicalUsages?.some((part:any)=>!Number.isFinite(part.usedQuantity)||part.usedQuantity<0))) {
            toast.error(t.workflow.pmv2.invalidUsedQty);
            return;
          }
          complete.mutate({ taskId, taskItemId, result: "fixed", note, materialUsages });
        }}
      >
        {complete.isPending ? <Loader2 className="me-1 h-4 w-4 animate-spin" /> : <Wrench className="me-1 h-4 w-4" />}
        {t.workflow.pmv2.saveFixedUsage}
      </Button>
    </div>
  );
}

export default function Pmv2MyTasks() {
  const { user } = useAuth();
  const sequential = user?.role === "technician";
  const { t, language, dir } = useTranslation();
  const { getStatusLabel } = useStaticLabels();
  const locale = language === "ar" ? "ar-SA" : language === "ur" ? "ur-PK" : "en-US";
  const taskStatusLabels = buildTaskStatusLabels(t);
  const itemStatusLabels = buildItemStatusLabels(t);
  const itemResultLabels = buildItemResultLabels(t);
  const materialAttentionStatus: Record<string, string> = {
    waiting_identity: t.workflow.pmv2.waitingIdentity,
    waiting_warehouse: t.workflow.pmv2.waitingShortage,
    waiting_purchase: t.workflow.pmv2.waitingSupply,
    waiting_transfer: t.workflow.pmv2.waitingTransfer,
    ready_to_receive: t.workflow.pmv2.readyReceive,
    ready_blocked: t.workflow.pmv2.readyBlocked,
  };
  const utils = trpc.useUtils();
  const [, setLocation] = useLocation();
  const legacyTodayQuery = trpc.pmv2.technician.today.useQuery(undefined, { enabled: !sequential });
  const workspaceQuery = trpc.pmv2.technician.workspace.useQuery(undefined, { enabled: sequential, refetchInterval: 30_000 });
  const todayQuery = sequential ? workspaceQuery : legacyTodayQuery;
  const materialAttentionQuery = trpc.pmv2.technician.materialAttention.useQuery(undefined, { refetchInterval: 60_000 });
  const tasks = todayQuery.data?.items ?? [];
  const todayTasks = tasks.filter(task => !task.isCarryOver);
  const carryOverTasks = tasks.filter(task => task.isCarryOver);
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);
  const [activeItemId, setActiveItemId] = useState<number | null>(null);
  const [createLinkedItemId, setCreateLinkedItemId] = useState<number | null>(null);
  const [viewLinkedTicketId, setViewLinkedTicketId] = useState<number | null>(null);
  const [creatingLinkedTicket, setCreatingLinkedTicket] = useState(false);
  const [materialWindowBusy, setMaterialWindowBusy] = useState(false);
  const [resultNotes, setResultNotes] = useState<Record<number, string>>({});
  const [ticketNoteDialogItemId, setTicketNoteDialogItemId] = useState<number | null>(null);
  const [ticketHandoffNote, setTicketHandoffNote] = useState("");
  const [attentionReceipt, setAttentionReceipt] = useState<any | null>(null);
  const [bucket, setBucket] = useState<TechnicianBucket>("execution");
  const counts = bucketCounts(tasks, scheduledTaskBucket);
  const listedTasks = sequential ? tasks.filter(task => scheduledTaskBucket(task) === bucket) : tasks;
  const listedTodayTasks = listedTasks.filter(task => !task.isCarryOver);
  const listedCarryOverTasks = listedTasks.filter(task => task.isCarryOver);
  const visibleMaterialAttention = (materialAttentionQuery.data?.items ?? []).filter((alert: any) => !sequential || tasks.some(task => task.id === alert.taskId && scheduledTaskBucket(task) === "materials"));
  const attentionCount = sequential ? visibleMaterialAttention.length : materialAttentionQuery.data?.count ?? 0;
  const actionableAttentionCount = sequential ? visibleMaterialAttention.filter((alert: any) => alert.attentionStatus === "ready_to_receive").length : materialAttentionQuery.data?.actionableCount ?? 0;

  useEffect(() => {
    if (tasks.length === 0) {
      setSelectedTaskId(null);
      return;
    }
    if (selectedTaskId == null || !tasks.some(task => task.id === selectedTaskId)) {
      if (!sequential) setSelectedTaskId(tasks[0].id);
      else if (selectedTaskId != null) setSelectedTaskId(null);
    }
  }, [todayQuery.data, selectedTaskId, tasks, sequential]);

  const selectedTask = useMemo(
    () => tasks.find(task => task.id === selectedTaskId) ?? null,
    [tasks, selectedTaskId],
  );

  const itemsQuery = trpc.pmv2.technician.items.useQuery(
    { taskId: selectedTaskId ?? 0 },
    { enabled: selectedTaskId != null },
  );

  const visitStateQuery = trpc.pmv2.technician.visitState.useQuery(
    { taskId: selectedTaskId ?? 0 },
    { enabled: selectedTaskId != null },
  );

  const timelineQuery = trpc.pmv2.technician.timeline.useQuery(
    { taskId: selectedTaskId ?? 0 },
    { enabled: selectedTaskId != null },
  );

  const receiveAttentionMaterial = trpc.pmv2.technician.receiveReadyMaterial.useMutation({
    onSuccess: async (data: any) => {
      await utils.materialCosts.invalidate();
      setAttentionReceipt(null);
      if (data.completed && !data.partial) {
        toast.success(`${t.workflow.pmv2.confirmReceipt}: ${data.issuedQuantity}`);
      } else {
        toast.error(data.message ? localizeApiError(data.message, language) : t.workflow.pmv2.materialReceiveIncomplete);
      }
      await Promise.all([
        materialAttentionQuery.refetch(),
        todayQuery.refetch(),
        utils.pmv2.technician.items.invalidate(),
        utils.pmv2.technician.materialState.invalidate(),
        utils.pmv2.technician.readyMaterialReceipts.invalidate(),
      ]);
    },
    onError: async error => {
      setAttentionReceipt(null);
      toast.error(localizeApiError(error.message));
      await materialAttentionQuery.refetch();
    },
  });

  const openAttentionTask = (taskId: number) => {
    setSelectedTaskId(taskId);
    setActiveItemId(null);
    window.setTimeout(() => document.getElementById("pmv2-selected-task")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  };

  const startItem = trpc.pmv2.technician.startItem.useMutation({
    onSuccess: async data => {
      toast.success(data.visitCreated ? t.workflow.pmv2.visitStarted : t.workflow.pmv2.visitStartedExisting);
      await Promise.all([
        todayQuery.refetch(),
        itemsQuery.refetch(),
        visitStateQuery.refetch(),
        timelineQuery.refetch(),
        utils.pmv2.technician.evidence.invalidate({ taskId: data.taskId, taskItemId: data.taskItemId }),
      ]);
    },
    onError: error => toast.error(localizeApiError(error.message)),
  });

  const resumeItem = trpc.pmv2.technician.resumeItem.useMutation({
    onSuccess: async data => {
      toast.success(data.visitCreated ? t.workflow.pmv2.resumeVisitCreated : t.workflow.pmv2.resumeVisitExisting);
      await Promise.all([
        todayQuery.refetch(),
        itemsQuery.refetch(),
        visitStateQuery.refetch(),
        timelineQuery.refetch(),
        utils.pmv2.technician.evidence.invalidate({ taskId: data.taskId, taskItemId: data.taskItemId }),
      ]);
    },
    onError: error => toast.error(localizeApiError(error.message)),
  });

  const endVisit = trpc.pmv2.technician.endVisit.useMutation({
    onSuccess: async () => {
      toast.success(t.workflow.pmv2.visitEnded);
      await Promise.all([
        todayQuery.refetch(),
        itemsQuery.refetch(),
        visitStateQuery.refetch(),
        timelineQuery.refetch(),
        utils.pmv2.technician.evidence.invalidate(),
      ]);
    },
    onError: error => toast.error(localizeApiError(error.message)),
  });

  const submitBasicResult = trpc.pmv2.technician.submitBasicResult.useMutation({
    onSuccess: async data => {
      toast.success(data.result === "ok" ? t.workflow.pmv2.itemRecordedOk : t.workflow.pmv2.itemRecordedFixed);
      setResultNotes(current => {
        const next = { ...current };
        delete next[data.taskItemId];
        return next;
      });
      await Promise.all([
        todayQuery.refetch(),
        itemsQuery.refetch(),
        timelineQuery.refetch(),
        utils.pmv2.technician.evidence.invalidate({ taskId: data.taskId, taskItemId: data.taskItemId }),
      ]);
    },
    onError: error => toast.error(localizeApiError(error.message)),
  });

  const submitDependencyResult = trpc.pmv2.technician.submitDependencyResult.useMutation({
    onSuccess: async data => {
      toast.success(
        data.result === "needs_material"
          ? t.workflow.pmv2.itemNeedsMaterialsRecorded
          : t.workflow.pmv2.itemNeedsTicketRecorded,
      );
      setResultNotes(current => {
        const next = { ...current };
        delete next[data.taskItemId];
        return next;
      });
      await Promise.all([
        todayQuery.refetch(),
        itemsQuery.refetch(),
        timelineQuery.refetch(),
        utils.pmv2.technician.evidence.invalidate({ taskId: data.taskId, taskItemId: data.taskItemId }),
      ]);
    },
    onError: error => toast.error(localizeApiError(error.message)),
  });

  const resultMutationPending = submitBasicResult.isPending || submitDependencyResult.isPending;
  const openLinkedTicketCreate = (taskItemId: number) => {
    if (sequential) setCreateLinkedItemId(taskItemId);
    else setLocation(`/tickets/new?pmv2TaskItemId=${taskItemId}`);
  };
  const openTicketNoteDialog = (taskItemId: number) => {
    setTicketHandoffNote(resultNotes[taskItemId] ?? "");
    setTicketNoteDialogItemId(taskItemId);
  };
  const confirmNeedsTicket = async () => {
    const taskItemId = ticketNoteDialogItemId;
    const note = ticketHandoffNote.trim();
    if (!taskItemId) return;
    if (!note) {
      toast.error(t.workflow.pmv2.ticketNoteRequired);
      return;
    }
    try {
      await submitDependencyResult.mutateAsync({
        taskId: selectedTask!.id,
        taskItemId,
        result: "needs_ticket",
        note,
      });
      setResultNotes(current => ({ ...current, [taskItemId]: note }));
      setTicketNoteDialogItemId(null);
      setTicketHandoffNote("");
      openLinkedTicketCreate(taskItemId);
    } catch {
      // onError in the mutation already shows the server message.
    }
  };
  const hasInProgressItem = Boolean(itemsQuery.data?.some(item => item.status === "in_progress"));
  const steps = (itemsQuery.data ?? []).map(item => ({ id: item.id, title: item.titleSnapshot, status: itemStatusLabels[item.status] ?? item.status, recorded: item.status === "completed", working: item.status === "in_progress" }));
  const currentStep = currentExecutionStep(steps, activeItemId);
  const displayedItems = sequential ? (itemsQuery.data ?? []).filter(item => item.id === currentStep?.id) : itemsQuery.data ?? [];
  const windowBusy = startItem.isPending || resumeItem.isPending || endVisit.isPending || resultMutationPending || materialWindowBusy;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 p-3 sm:p-5" dir={dir}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <CalendarClock className="h-7 w-7 text-primary" />
            <h1 className="text-2xl font-bold">{t.workflow.pmv2.myTasksToday}</h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {t.workflow.pmv2.myTasksPageHelp}
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => void Promise.all([todayQuery.refetch(), materialAttentionQuery.refetch()])}
          disabled={todayQuery.isFetching || materialAttentionQuery.isFetching}
        >
          <RefreshCw className={`me-2 h-4 w-4 ${todayQuery.isFetching || materialAttentionQuery.isFetching ? "animate-spin" : ""}`} />
          {t.workflow.pmv2.refresh}
        </Button>
      </div>

      {sequential && <TechnicianStatusCards counts={counts} value={bucket} onChange={setBucket} language={language} loading={todayQuery.isLoading || !!todayQuery.error} />}
      {sequential && bucket === "done" && <p className="text-xs text-muted-foreground">{language === "ar" ? "يعرض المنجز الحالي وأحدث 100 مهمة منجزة سابقة؛ العدد يخص المهام المعروضة، دون حذف السجل." : language === "ur" ? "موجودہ مکمل کام اور آخری 100 سابقہ مکمل کام؛ تعداد دکھائے گئے کاموں کی ہے۔" : "Current completed tasks and the latest 100 archived tasks; the count is for displayed tasks. No history is deleted."}</p>}
      {(!sequential || bucket === "materials") && (materialAttentionQuery.isLoading || materialAttentionQuery.error || attentionCount > 0) && (
        <Card className="border-amber-300 bg-amber-50/30">
          <CardHeader className="pb-3">
            <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-lg">
              <span className="flex items-center gap-2">
                <BellRing className="h-5 w-5 text-amber-700" />
                {t.workflow.pmv2.materialsNeedAttention}
              </span>
              <div className="flex flex-wrap gap-1.5">
                <Badge variant="outline">{t.workflow.pmv2.statusesCount.replace("{count}", String(attentionCount))}</Badge>
                {actionableAttentionCount > 0 && (
                  <Badge className="bg-emerald-600">{t.workflow.pmv2.readyReceiveCount.replace("{count}", String(actionableAttentionCount))}</Badge>
                )}
              </div>
            </CardTitle>
            <CardDescription>{t.workflow.pmv2.materialAttentionHelp}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {materialAttentionQuery.isLoading && <p className="text-sm text-muted-foreground">{t.workflow.pmv2.loadingMaterialStatuses}</p>}
            {materialAttentionQuery.error && <p className="text-sm text-destructive">{localizeApiError(materialAttentionQuery.error.message)}</p>}
            {visibleMaterialAttention.map((alert: any) => (
              <div key={alert.id} className="rounded-lg border bg-background p-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={alert.attentionStatus === "ready_to_receive" ? "default" : "outline"}>
                        {materialAttentionStatus[alert.attentionStatus] ?? alert.attentionStatus}
                      </Badge>
                      <span className="font-mono text-xs" dir="ltr">{alert.taskNumber}</span>
                    </div>
                    <div className="font-semibold">{alert.itemName}{alert.itemCode ? ` — ${alert.itemCode}` : ""}</div>
                    {alert.identityResolved && alert.originalItemName && alert.originalItemName !== alert.itemName && (
                      <div className="text-xs text-muted-foreground">
                        {t.workflow.pmv2.previouslyRecorded}: <span className="font-medium text-foreground">{alert.originalItemName}</span> — {t.workflow.pmv2.warehouseIdentifiedSuffix}
                      </div>
                    )}
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span>{t.workflow.pmv2.requiredInline}: {alert.requiredQuantity} {alert.unit}</span>
                      {alert.teamAvailableQuantity != null && <span>{t.workflow.pmv2.teamAvailableLastEval}: {alert.teamAvailableQuantity} {alert.unit}</span>}
                      {alert.initialShortageQuantity > 0 && <span>{t.workflow.pmv2.shortageAtRegistration}: {alert.initialShortageQuantity} {alert.unit}</span>}
                      {alert.shortageQuantity > 0
                        ? <span className="font-medium text-amber-800">{t.workflow.pmv2.remainingShortage}: {alert.shortageQuantity} {alert.unit}</span>
                        : alert.initialShortageQuantity > 0 && <span className="font-medium text-emerald-700">{t.workflow.pmv2.shortageCompletedTeam}</span>}
                      {alert.warehouseReceivedQuantity > 0 && <span>{t.workflow.pmv2.arrivedMainWarehouse}: {alert.warehouseReceivedQuantity} {alert.unit}</span>}
                      {alert.warehouseIssuedToTeamQuantity > 0 && <span>{t.workflow.pmv2.transferredTeamStore}: {alert.warehouseIssuedToTeamQuantity} {alert.unit}</span>}
                    </div>
                    <div className="text-xs text-muted-foreground">{t.workflow.pmv2.taskItemLabel}: {alert.taskItemTitle}</div>
                    {alert.blocker && <div className="text-xs text-destructive">{alert.blocker}</div>}
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => openAttentionTask(alert.taskId)}>{t.workflow.pmv2.openTask}</Button>
                    {alert.attentionStatus === "ready_to_receive" && (
                      <Button size="sm" onClick={() => setAttentionReceipt(alert)}>{t.workflow.pmv2.receiveFromTeamStore}</Button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <AlertDialog
        open={attentionReceipt != null}
        onOpenChange={(open) => {
          if (!open && !receiveAttentionMaterial.isPending) setAttentionReceipt(null);
        }}
      >
        <AlertDialogContent dir={dir}>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.workflow.pmv2.confirmReceiveMaterialTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {attentionReceipt ? `${t.workflow.pmv2.confirmReceipt}: ${attentionReceipt.requiredQuantity} ${attentionReceipt.unit} — ${attentionReceipt.itemName} — ${attentionReceipt.taskNumber}` : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={receiveAttentionMaterial.isPending}>{t.workflow.pmv2.cancel}</AlertDialogCancel>
            <AlertDialogAction
              disabled={receiveAttentionMaterial.isPending || !attentionReceipt}
              onClick={(event) => {
                event.preventDefault();
                if (attentionReceipt) receiveAttentionMaterial.mutate({ routeDecisionActionId: attentionReceipt.routeDecisionActionId });
              }}
            >
              {receiveAttentionMaterial.isPending ? t.workflow.pmv2.receiving : t.workflow.pmv2.confirmReceipt}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-lg">
            <span>{sequential ? technicianBucketTitle(bucket, language) : t.workflow.pmv2.myTasksHeader.replace("{date}", todayQuery.data?.date ?? t.workflow.pmv2.myTasksToday)}</span>
            <div className="flex flex-wrap gap-1.5">
              {sequential ? <Badge variant="secondary">{listedTasks.length}</Badge> : <Badge variant="secondary">{t.workflow.pmv2.todayCount.replace("{count}", String(todayQuery.data?.todayCount ?? todayTasks.length))}</Badge>}
              {!sequential && carryOverTasks.length > 0 && (
                <Badge variant="outline">{t.workflow.pmv2.carryOverCount.replace("{count}", String(todayQuery.data?.carryOverCount ?? carryOverTasks.length))}</Badge>
              )}
            </div>
          </CardTitle>
          <CardDescription>{t.workflow.pmv2.tasksCardHelp}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {todayQuery.isLoading && <p className="text-sm text-muted-foreground">{t.workflow.pmv2.loadingYourTasks}</p>}
          {todayQuery.error && <p className="text-sm text-destructive">{localizeApiError(todayQuery.error.message)}</p>}
          {!todayQuery.isLoading && !todayQuery.error && listedTasks.length === 0 && (
            <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              {t.workflow.pmv2.noTasks}
            </div>
          )}

          {[
            { key: "today", title: t.workflow.pmv2.todayTasks, items: listedTodayTasks, carryOver: false },
            { key: "carry-over", title: t.workflow.pmv2.carryOverTasks, items: listedCarryOverTasks, carryOver: true },
          ].map(section => section.items.length > 0 && (
            <section key={section.key} className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold">{section.title}</h3>
                <Badge variant={section.carryOver ? "outline" : "secondary"}>{section.items.length}</Badge>
                {section.carryOver && (
                  <span className="text-xs text-muted-foreground">{t.workflow.pmv2.carryOverHelp}</span>
                )}
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                {section.items.map(task => {
                  const progress = task.itemCount > 0
                    ? Math.round((task.completedItemCount / task.itemCount) * 100)
                    : 0;
                  const selected = selectedTaskId === task.id;
                  return (
                    <button
                      key={task.id}
                      type="button"
                      onClick={() => { setSelectedTaskId(task.id); setActiveItemId(null); }}
                      className={`rounded-xl border p-4 text-start transition ${selected ? "border-primary bg-primary/5" : "hover:bg-muted/50"}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="font-semibold" dir="ltr">{task.taskNumber}</div>
                            {task.isCarryOver && <Badge variant="destructive">{t.workflow.pmv2.carryOverBadge}</Badge>}
                          </div>
                          <div className="mt-1 flex items-start gap-1 text-sm text-muted-foreground">
                            <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
                            <span>{targetLabel(task, t)}</span>
                          </div>
                        </div>
                        <Badge variant={task.status === "completed" ? "secondary" : "outline"}>
                          {taskStatusLabels[task.status] ?? task.status}
                        </Badge>
                      </div>
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1"><Users className="h-3.5 w-3.5" />{task.teamCode}</span>
                        <span className="flex items-center gap-1"><CalendarClock className="h-3.5 w-3.5" />{t.workflow.pmv2.dueDateLabel}: {task.dueDate}</span>
                        <span>{t.workflow.pmv2.completedItemsCount.replace("{done}", String(task.completedItemCount)).replace("{total}", String(task.itemCount))}</span>
                      </div>
                      <Progress value={progress} className="mt-2 h-2" />
                      {sequential && <span className="mt-3 inline-flex items-center gap-1 text-sm text-primary"><PlayCircle className="h-4 w-4" />{language === "ar" ? "بدء التنفيذ / متابعة" : language === "ur" ? "کام شروع / جاری رکھیں" : "Start / continue execution"}</span>}
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </CardContent>
      </Card>

      <AlertDialog
        open={ticketNoteDialogItemId != null}
        onOpenChange={(open) => {
          if (!open && !submitDependencyResult.isPending) {
            setTicketNoteDialogItemId(null);
            setTicketHandoffNote("");
          }
        }}
      >
        <AlertDialogContent dir={dir}>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.workflow.pmv2.convertItemTicketTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {t.workflow.pmv2.convertItemTicketHelp}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea
            rows={4}
            maxLength={2000}
            value={ticketHandoffNote}
            onChange={(event) => setTicketHandoffNote(event.target.value)}
            placeholder={t.workflow.pmv2.ticketNotePlaceholder}
            disabled={submitDependencyResult.isPending}
          />
          <div className="text-xs text-muted-foreground">{ticketHandoffNote.trim().length}/2000</div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitDependencyResult.isPending}>{t.workflow.pmv2.cancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void confirmNeedsTicket();
              }}
              disabled={submitDependencyResult.isPending || !ticketHandoffNote.trim()}
            >
              {submitDependencyResult.isPending ? t.workflow.pmv2.recording : t.workflow.pmv2.continueCreateTicket}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {selectedTask && (
        <TechnicianExecutionWindow sequential={sequential} open onClose={() => { setSelectedTaskId(null); setActiveItemId(null); }} title={selectedTask.taskNumber} description={targetLabel(selectedTask, t)} language={language} steps={steps} currentId={currentStep?.id ?? null} onSelect={setActiveItemId} busy={windowBusy} timer={<ExecutionElapsedTime startedAt={visitStateQuery.data?.startedAt} language={language} />}>
        <Card id="pmv2-selected-task">
          <CardContent className="pt-4"><MaterialCostPanel source="pmv2" id={selectedTask.id} /></CardContent>
          <CardHeader>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <ClipboardList className="h-5 w-5" />
                  {t.workflow.pmv2.taskItemsTitle.replace("{number}", "")} <span dir="ltr">{selectedTask.taskNumber}</span>
                </CardTitle>
                <CardDescription>{targetLabel(selectedTask, t)}</CardDescription>
              </div>
              {visitStateQuery.data?.hasOpenVisit && !visitStateQuery.data.conflict && visitStateQuery.data.isLeader && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => endVisit.mutate({ taskId: selectedTask.id })}
                  disabled={endVisit.isPending || hasInProgressItem || materialWindowBusy}
                >
                  {endVisit.isPending ? t.workflow.pmv2.endingVisit : t.workflow.pmv2.endVisit}
                </Button>
              )}
            </div>
            {visitStateQuery.data?.conflict && (
              <p className="text-sm text-destructive">{t.workflow.pmv2.multipleOpenVisits}</p>
            )}
            {visitStateQuery.data?.hasOpenVisit && !visitStateQuery.data.conflict && selectedTask.status === "completed" && (
              <p className="text-sm font-medium text-emerald-700">
                {t.workflow.pmv2.allItemsVisitOpen}
                {visitStateQuery.data.isLeader
                  ? ` ${t.workflow.pmv2.endVisitWhenLeaving}`
                  : ` ${t.workflow.pmv2.waitingVisitLeader}`}
              </p>
            )}
            {visitStateQuery.data?.hasOpenVisit && !visitStateQuery.data.isLeader && !visitStateQuery.data.conflict && selectedTask.status !== "completed" && (
              <p className="text-xs text-muted-foreground">{t.workflow.pmv2.visitOnlyLeader}</p>
            )}
            {visitStateQuery.data?.hasOpenVisit && visitStateQuery.data.isLeader && hasInProgressItem && (
              <p className="text-xs text-muted-foreground">{t.workflow.pmv2.recordAllResultsFirst}</p>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg border bg-muted/20 p-3">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 font-semibold">
                  <History className="h-4 w-4" />
                  {t.workflow.pmv2.taskTimeline}
                </div>
                <Button size="sm" variant="ghost" onClick={() => timelineQuery.refetch()} disabled={timelineQuery.isFetching}>
                  {timelineQuery.isFetching ? <Loader2 className="me-1 h-4 w-4 animate-spin" /> : <RefreshCw className="me-1 h-4 w-4" />}
                  {t.workflow.pmv2.refresh}
                </Button>
              </div>
              {timelineQuery.isLoading && <p className="text-xs text-muted-foreground">{t.workflow.pmv2.loadingTimeline}</p>}
              {timelineQuery.error && <p className="text-xs text-destructive">{localizeApiError(timelineQuery.error.message)}</p>}
              {timelineQuery.data && (
                <div className="space-y-3">
                  {timelineQuery.data.summary.currentResponsibility ? (
                    <div className="rounded-md border bg-background p-3 text-sm">
                      <div className="font-semibold">{t.workflow.pmv2.stuckNow}: {timelineQuery.data.summary.currentResponsibility.stageLabel}</div>
                      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        <span>{t.workflow.pmv2.partyLabel}: {timelineQuery.data.summary.currentResponsibility.roleLabel}</span>
                        <span>{t.workflow.pmv2.responsibleLabel}: {timelineQuery.data.summary.currentResponsibility.responsibleUserName || t.workflow.pmv2.notAssignedPerson}</span>
                        <span>{t.workflow.pmv2.sinceLabel}: {formatTimelineDate(timelineQuery.data.summary.currentResponsibility.since, locale)}</span>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-md border bg-background p-2 text-xs text-muted-foreground">{t.workflow.pmv2.noWaitingParty}</div>
                  )}
                  <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-5">
                    <div className="rounded-md border bg-background p-2"><div className="text-muted-foreground">{t.workflow.pmv2.taskAge}</div><div className="mt-1 font-semibold">{formatTimelineMinutes(timelineQuery.data.summary.totalAgeMinutes, t)}</div></div>
                    <div className="rounded-md border bg-background p-2"><div className="text-muted-foreground">{t.workflow.pmv2.actualWork}</div><div className="mt-1 font-semibold">{formatTimelineMinutes(timelineQuery.data.summary.actualWorkMinutes, t)}</div></div>
                    <div className="rounded-md border bg-background p-2"><div className="text-muted-foreground">{t.workflow.pmv2.waitingMaterials}</div><div className="mt-1 font-semibold">{formatTimelineMinutes(timelineQuery.data.summary.waitingMaterialMinutes, t)}</div></div>
                    <div className="rounded-md border bg-background p-2"><div className="text-muted-foreground">{t.workflow.pmv2.waitingTicketLabel}</div><div className="mt-1 font-semibold">{formatTimelineMinutes(timelineQuery.data.summary.waitingTicketMinutes, t)}</div></div>
                    <div className="rounded-md border bg-background p-2"><div className="text-muted-foreground">{t.workflow.pmv2.readyNotCompleted}</div><div className="mt-1 font-semibold">{formatTimelineMinutes(timelineQuery.data.summary.waitingResumeMinutes, t)}</div></div>
                  </div>
                  {timelineQuery.data.summary.openResponsibilityCount > 1 && (
                    <details className="rounded-md border bg-background p-2">
                      <summary className="cursor-pointer text-sm font-medium">{t.workflow.pmv2.currentActionOwners.replace("{count}", String(timelineQuery.data.summary.openResponsibilityCount))}</summary>
                      <div className="mt-2 space-y-2">
                        {timelineQuery.data.responsibilities.map((row: any) => (
                          <div key={`${row.taskItemId}-${row.stageKey}`} className="rounded border p-2 text-xs">
                            <div className="font-medium">{row.taskItemTitle} — {row.stageLabel}</div>
                            <div className="mt-1 text-muted-foreground">{row.roleLabel}{row.responsibleUserName ? ` — ${row.responsibleUserName}` : ` — ${t.workflow.pmv2.notAssignedPerson}`} • {t.workflow.pmv2.sinceLabel} {formatTimelineDate(row.since, locale)}</div>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                  {timelineQuery.data.responsibilityDurations.length > 0 && (
                    <details className="rounded-md border bg-background p-2">
                      <summary className="cursor-pointer text-sm font-medium">{t.workflow.pmv2.timeByOwner}</summary>
                      <div className="mt-2 grid gap-2 text-xs sm:grid-cols-2">
                        {timelineQuery.data.responsibilityDurations.map((row: any, index: number) => (
                          <div key={`${row.roleKey}-${row.responsibleUserId ?? "role"}-${index}`} className="rounded border p-2">
                            <div className="font-medium">{row.roleLabel}{row.responsibleUserName ? ` — ${row.responsibleUserName}` : ""}</div>
                            <div className="mt-1 text-muted-foreground">{formatTimelineMinutes(row.durationMinutes, t)}</div>
                          </div>
                        ))}
                      </div>
                      <p className="mt-2 text-[11px] text-muted-foreground">{t.workflow.pmv2.durationSlaHelp}</p>
                    </details>
                  )}
                  {timelineQuery.data.stageSegments.length > 0 && (
                    <details className="rounded-md border bg-background p-2">
                      <summary className="cursor-pointer text-sm font-medium">{t.workflow.pmv2.taskStageDurations.replace("{count}", String(timelineQuery.data.stageSegments.length))}</summary>
                      <div className="mt-2 space-y-2">
                        {[...timelineQuery.data.stageSegments].reverse().map((segment: any) => (
                          <div key={segment.id} className="rounded border p-2 text-xs">
                            <div className="font-medium">{segment.taskItemTitle} — {segment.stageLabel}</div>
                            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground">
                              <span>{t.workflow.pmv2.partyLabel}: {segment.roleLabel}</span>
                              {segment.responsibleUserName && <span>{t.workflow.pmv2.responsibleLabel}: {segment.responsibleUserName}</span>}
                              <span>{t.workflow.pmv2.durationLabel}: {formatTimelineMinutes(segment.durationMinutes, t)}</span>
                              <span>{t.workflow.pmv2.fromLabel}: {formatTimelineDate(segment.startedAt, locale)}</span>
                              <span>{t.workflow.pmv2.toLabel}: {segment.isOpen ? t.workflow.pmv2.now : formatTimelineDate(segment.endedAt, locale)}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                  <details className="rounded-md border bg-background p-2">
                    <summary className="cursor-pointer text-sm font-medium">{t.workflow.pmv2.fullTimeline.replace("{count}", String(timelineQuery.data.events.length))}</summary>
                    <div className="mt-3 space-y-2">
                      {[...timelineQuery.data.events].reverse().map((event: any) => (
                        <div key={event.id} className={`text-xs ${dir === "rtl" ? "border-r-2 pr-3" : "border-l-2 pl-3"}`}>
                          <div className="font-medium">{event.label}</div>
                          <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground">
                            <span><Clock3 className="me-1 inline h-3 w-3" />{formatTimelineDate(event.at, locale)}</span>
                            {event.roleLabel && <span>{t.workflow.pmv2.partyLabel}: {event.roleLabel}</span>}
                            {event.responsibleUserName && <span>{t.workflow.pmv2.responsibleLabel}: {event.responsibleUserName}</span>}
                            {event.actorUserName && event.actorUserName !== event.responsibleUserName && <span>{t.workflow.pmv2.actorTransition}: {event.actorUserName}</span>}
                          </div>
                          {event.detail && <div className="mt-1 text-muted-foreground">{event.detail}</div>}
                        </div>
                      ))}
                    </div>
                  </details>
                </div>
              )}
            </div>

            {itemsQuery.isLoading && <p className="text-sm text-muted-foreground">{t.workflow.pmv2.loadingItems}</p>}
            {itemsQuery.error && <p className="text-sm text-destructive">{localizeApiError(itemsQuery.error.message)}</p>}
            {displayedItems.map(item => (
              <div key={item.id} data-active-execution-item={item.id} className={sequential ? "space-y-4 rounded-2xl border-2 border-primary/20 p-5" : "flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"}>
                <div className="flex items-start gap-2">
                  {item.status === "completed"
                    ? <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-600" />
                    : <ClipboardList className="mt-0.5 h-5 w-5 text-muted-foreground" />}
                  <div>
                    <div className="font-medium">{item.sortOrderSnapshot}. <EntityTranslatedText entityType="PMV2_TASK_ITEM" entityId={Number(item.id)} field="titleSnapshot" original={item.titleSnapshot} /></div>
                    {item.recurrenceLabelSnapshot && (
                      <div className="mt-1 text-xs text-muted-foreground">{item.recurrenceLabelSnapshot}</div>
                    )}
                  </div>
                </div>
                <div className="flex w-full flex-col gap-2 sm:w-auto sm:items-end">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{itemStatusLabels[item.status] ?? item.status}</Badge>
                    {item.result && <Badge variant="secondary">{itemResultLabels[item.result] ?? item.result}</Badge>}
                    {item.status === "pending" && (
                      <Button
                        size="sm"
                        onClick={() => startItem.mutate({ taskId: selectedTask.id, taskItemId: item.id })}
                        disabled={startItem.isPending}
                      >
                        <PlayCircle className="me-1 h-4 w-4" />
                        {startItem.isPending ? t.workflow.pmv2.starting : t.workflow.pmv2.startExecution}
                      </Button>
                    )}
                  </div>

                  <ItemEvidence taskId={selectedTask.id} taskItemId={item.id} />

                  {item.status === "waiting_material" && item.result === "needs_material" && (
                    <MaterialNeedPanel taskId={selectedTask.id} taskItemId={item.id} onBusyChange={sequential ? setMaterialWindowBusy : undefined} />
                  )}

                  {item.status === "waiting_ticket" && item.result === "needs_ticket" && (
                    <div className="w-full space-y-2 rounded-md border border-blue-200 bg-blue-50/40 p-3 sm:w-[360px]">
                      {item.linkedTicket ? (
                        <>
                          <div className="text-sm font-medium">
                            {t.workflow.pmv2.linkedTicket}: <span className="font-mono">{item.linkedTicket.ticketNumber}</span>
                          </div>
                          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            <span>{t.workflow.pmv2.statusLabel}: {getStatusLabel(item.linkedTicket.status) ?? item.linkedTicket.status}</span>
                            {item.linkedTicket.maintenancePath && <span>{t.workflow.pmv2.pathLabel}: {item.linkedTicket.maintenancePath}</span>}
                          </div>
                          <Button size="sm" variant="outline" onClick={() => sequential ? setViewLinkedTicketId(item.linkedTicket!.id) : setLocation(`/tickets/${item.linkedTicket!.id}`)}>
                            <ExternalLink className="me-1 h-4 w-4" />
                            {t.workflow.pmv2.openTicket}
                          </Button>
                        </>
                      ) : (
                        <>
                          <p className="text-sm">{t.workflow.pmv2.ticketNeedRecorded}</p>
                          <Button size="sm" onClick={() => openLinkedTicketCreate(item.id)}>
                            <TicketPlus className="me-1 h-4 w-4" />
                            {t.workflow.pmv2.createLinkedTicket}
                          </Button>
                        </>
                      )}
                    </div>
                  )}

                  {item.status === "ready_to_complete" && item.result === "needs_material" && (
                    <div className="w-full space-y-2 rounded-lg border border-emerald-200 bg-emerald-50/40 p-3 sm:w-[420px]">
                      <div className="text-sm font-semibold">{t.workflow.pmv2.materialsReadyResume}</div>
                      <p className="text-xs text-muted-foreground">{t.workflow.pmv2.resumeSameTaskHelp}</p>
                      <Button
                        size="sm"
                        className="w-full"
                        onClick={() => resumeItem.mutate({ taskId: selectedTask.id, taskItemId: item.id })}
                        disabled={resumeItem.isPending || visitStateQuery.data?.conflict}
                      >
                        {resumeItem.isPending ? <Loader2 className="me-1 h-4 w-4 animate-spin" /> : <PlayCircle className="me-1 h-4 w-4" />}
                        {resumeItem.isPending ? t.workflow.pmv2.resumingWork : t.workflow.pmv2.resumeWork}
                      </Button>
                    </div>
                  )}

                  {item.status === "in_progress" && item.result === "needs_material" && (
                    <MaterialCompletionPanel taskId={selectedTask.id} taskItemId={item.id} onBusyChange={sequential ? setMaterialWindowBusy : undefined} />
                  )}

                  {item.status === "in_progress" && item.result !== "needs_material" && (
                    <div className="w-full space-y-2 sm:w-[360px]">
                      <Textarea
                        rows={2}
                        maxLength={2000}
                        value={resultNotes[item.id] ?? ""}
                        onChange={event => setResultNotes(current => ({ ...current, [item.id]: event.target.value }))}
                        placeholder={t.workflow.pmv2.executionNoteOptional}
                      />
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          onClick={() => submitBasicResult.mutate({
                            taskId: selectedTask.id,
                            taskItemId: item.id,
                            result: "ok",
                            note: resultNotes[item.id] ?? "",
                          })}
                          disabled={resultMutationPending}
                        >
                          <CheckCircle2 className="me-1 h-4 w-4" />
                          {t.workflow.pmv2.ok}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => submitBasicResult.mutate({
                            taskId: selectedTask.id,
                            taskItemId: item.id,
                            result: "fixed",
                            note: resultNotes[item.id] ?? "",
                          })}
                          disabled={resultMutationPending}
                        >
                          <Wrench className="me-1 h-4 w-4" />
                          {t.workflow.pmv2.fixed}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => submitDependencyResult.mutate({
                            taskId: selectedTask.id,
                            taskItemId: item.id,
                            result: "needs_material",
                            note: resultNotes[item.id] ?? "",
                          })}
                          disabled={resultMutationPending}
                        >
                          {t.workflow.pmv2.needsMaterial}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => openTicketNoteDialog(item.id)}
                          disabled={resultMutationPending}
                        >
                          {t.workflow.pmv2.needsTicket}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
            {!itemsQuery.isLoading && itemsQuery.data?.length === 0 && (
              <p className="text-sm text-muted-foreground">{t.workflow.pmv2.noTaskItems}</p>
            )}
          </CardContent>
        </Card>
        </TechnicianExecutionWindow>
      )}
      <Dialog open={createLinkedItemId != null} onOpenChange={open => { if (!open && !creatingLinkedTicket) setCreateLinkedItemId(null); }}><DialogContent dir={dir} className="max-h-[90vh] overflow-y-auto sm:max-w-3xl"><DialogHeader><DialogTitle>{t.workflow.pmv2.createLinkedTicket}</DialogTitle></DialogHeader>{createLinkedItemId != null && <CreateTicket key={createLinkedItemId} linkedPmv2ItemId={createLinkedItemId} onSavingChange={setCreatingLinkedTicket} onCancel={() => { if (!creatingLinkedTicket) setCreateLinkedItemId(null); }} onCreated={() => { setCreatingLinkedTicket(false); setCreateLinkedItemId(null); void Promise.all([itemsQuery.refetch(), todayQuery.refetch(), materialAttentionQuery.refetch()]); }} />}</DialogContent></Dialog>
      <Dialog open={viewLinkedTicketId != null} onOpenChange={open => { if (!open) setViewLinkedTicketId(null); }}><DialogContent dir={dir} className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>{t.workflow.pmv2.linkedTicket}</DialogTitle></DialogHeader>{viewLinkedTicketId != null && <TicketSourceSummary ticketId={viewLinkedTicketId} language={language} />}</DialogContent></Dialog>
    </div>
  );
}
