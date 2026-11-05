import { WarehouseLotSelection } from "@/components/inventory/WarehouseLotSelection";
import { selectFullIssueLots, type WarehouseLotSelection as LotSelection } from "@shared/warehouse-lot-selection";
import { AlertTriangle, ArrowLeftRight, Boxes, ClipboardList, Link2, Loader2, PackageCheck, RefreshCw, RotateCcw, Send, ShoppingCart, Warehouse } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MaterialIdentityDialog } from "@/components/catalog/MaterialIdentityDialog";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { useTranslation } from "@/contexts/LanguageContext";
import { localizeApiError } from "@/i18n/apiError";
import { getPmv2MaterialQuantityValidationMessage, pmv2MaterialUnitRequiresWholeQuantity } from "@shared/pmv2MaterialQuantity";
import { matchesReturnSearch } from "@/lib/returnSearch";
import { MaterialRequestMeta } from "@/components/inventory/MaterialRequestMeta";

function buildStatusView(t: any): Record<string, { label: string; className: string }> {
  return {
  available: {
    label: t.workflow.pmv2.whStatusAvailable,
    className: "border-emerald-200 bg-emerald-50 text-emerald-700",
  },
  insufficient: {
    label: t.workflow.pmv2.whStatusInsufficient,
    className: "border-amber-200 bg-amber-50 text-amber-700",
  },
  unlisted: {
    label: t.workflow.pmv2.whStatusUnlisted,
    className: "border-slate-200 bg-slate-50 text-slate-700",
  },
  catalog_unavailable: {
    label: t.workflow.pmv2.whStatusCatalogUnavailable,
    className: "border-red-200 bg-red-50 text-red-700",
  },
  ambiguous_inventory: {
    label: t.workflow.pmv2.whStatusAmbiguous,
    className: "border-red-200 bg-red-50 text-red-700",
  },
  unit_mismatch: {
    label: t.workflow.pmv2.whStatusUnitMismatch,
    className: "border-red-200 bg-red-50 text-red-700",
  },
  };
}

function quantityLabel(value: number | null | undefined, unit: string | null | undefined, locale: string) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return `${Number(value).toLocaleString(locale, { maximumFractionDigits: 3 })}${unit ? ` ${unit}` : ""}`;
}

export default function Pmv2WarehouseQueue({ section, embedded = false, search = "" }: {
  section?: "returns"; embedded?: boolean; search?: string;
} = {}) {
  const returnsOnly = embedded && section === "returns";
  const { t, language, dir } = useTranslation();
  const locale = language === "ar" ? "ar-SA" : language === "ur" ? "ur-PK" : "en-US";
  const STATUS_VIEW = buildStatusView(t);
  const qty = (value: number | null | undefined, unit: string | null | undefined) => quantityLabel(value, unit, locale);
  const fmt = (template: string, values: Record<string, string | number>) => Object.entries(values).reduce((out, [key, value]) => out.replaceAll(`{${key}}`, String(value)), template);
  const localizedName = (value: any) => language === "ar" ? (value?.nameAr || value?.nameEn || "—") : (value?.nameEn || value?.nameAr || "—");
  const [, navigate] = useLocation();
  const queue = trpc.pmv2.warehouse.waitingMaterialQueue.useQuery(undefined, { enabled: !returnsOnly, refetchOnWindowFocus: false });
  const readyIssue = trpc.pmv2.warehouse.readyToIssueQueue.useQuery(undefined, { enabled: !returnsOnly, refetchOnWindowFocus: false });
  const pendingReturns = trpc.pmv2.warehouse.pendingReturns.useQuery(undefined, { refetchOnWindowFocus: false });
  const prepareTransfer = trpc.pmv2.warehouse.prepareTransferHandoff.useMutation();
  const preparePurchase = trpc.pmv2.warehouse.preparePurchaseHandoff.useMutation();
  const [recipientByRequirement, setRecipientByRequirement] = useState<Record<number, string>>({});
  const [returnQtyByLot, setReturnQtyByLot] = useState<Record<string, string>>({});
  const [identityRequest, setIdentityRequest] = useState<any | null>(null);
  const [identitySearch, setIdentitySearch] = useState("");
  const [approvedIdentityQuantity, setApprovedIdentityQuantity] = useState("");
  const [selectedIdentityCatalogId, setSelectedIdentityCatalogId] = useState<number | null>(null);
  const [sectionState, setActiveSection] = useState<"waiting" | "ready" | "returns">(section ?? "waiting");
  const activeSection = returnsOnly ? "returns" : sectionState;
  const [lotSelections,setLotSelections]=useState<Record<number,LotSelection>>({});

  const identityCandidates = trpc.pmv2.warehouse.searchMaterialIdentityCandidates.useQuery(
    { requestItemId: Number(identityRequest?.requestItemId || 1), search: identitySearch },
    { enabled: Boolean(identityRequest), refetchOnWindowFocus: false },
  );

  const refreshOperationalQueues = async () => {
    await Promise.all([...(returnsOnly ? [] : [queue.refetch(), readyIssue.refetch()]), pendingReturns.refetch()]);
  };

  const resolveMaterialIdentity = trpc.pmv2.warehouse.resolveMaterialIdentity.useMutation({
    onSuccess: async (result: any) => {
      if (result.route === "team_inventory") {
        toast.success(t.workflow.pmv2.identityResolvedTeamReady);
      } else {
        toast.success(fmt(t.workflow.pmv2.identityResolvedShortage, { qty: qty(result.shortageQuantity, result.unit) }));
      }
      setIdentityRequest(null);
      setIdentitySearch("");
      setSelectedIdentityCatalogId(null);
      await refreshOperationalQueues();
    },
    onError: (error: any) => toast.error(error?.message ? localizeApiError(error.message) : t.workflow.pmv2.identityResolveFailed),
  });

  const openIdentityResolver = (item: any) => {
    setIdentityRequest(item);
    setIdentitySearch("");
    setSelectedIdentityCatalogId(item.catalogItemId == null ? null : Number(item.catalogItemId));
    setApprovedIdentityQuantity(String(item.taskNeedQuantity ?? item.requestedQuantity ?? ""));
  };

  const issueRequirement = trpc.pmv2.warehouse.issueReadyRequirement.useMutation({
    onSuccess: async (result: any) => {
      if (result.partial) toast.warning(result.message ? localizeApiError(result.message, language) : t.workflow.pmv2.partialIssueWarning);
      else toast.success(t.workflow.pmv2.fullNeedIssued);
      await refreshOperationalQueues();
    },
    onError: (error: any) => toast.error(error?.message ? localizeApiError(error.message) : t.workflow.pmv2.issueNeedFailed),
  });

  const relinkDelivery = trpc.pmv2.warehouse.linkConfirmedDelivery.useMutation({
    onSuccess: async () => {
      toast.success(t.workflow.pmv2.deliveryRelinked);
      await refreshOperationalQueues();
    },
    onError: (error: any) => toast.error(error?.message ? localizeApiError(error.message) : t.workflow.pmv2.relinkFailed),
  });

  const confirmReturn = trpc.pmv2.warehouse.confirmPendingReturn.useMutation({
    onSuccess: async (result: any) => {
      toast.success(result.completed ? t.workflow.pmv2.returnCompleted : fmt(t.workflow.pmv2.returnPartial, { qty: qty(result.remainingReturnQuantity, result.unit) }));
      await refreshOperationalQueues();
    },
    onError: (error: any) => toast.error(error?.message ? localizeApiError(error.message) : t.workflow.pmv2.returnConfirmFailed),
  });

  const data = queue.data;
  const identityItems = identityCandidates.data?.items ?? [];
  const identityCatalogUnit = identityItems.find(item => Number(item.id) === selectedIdentityCatalogId)?.unit || "";

  async function startWarehouseTransfer(requestItemId: number) {
    try {
      const handoff = await prepareTransfer.mutateAsync({ requestItemId });
      const params = new URLSearchParams({
        pmv2RequestItemId: String(handoff.requestItemId),
        pmv2RequestId: String(handoff.requestId),
        pmv2TaskNumber: handoff.taskNumber,
        pmv2MaterialName: handoff.materialName,
        fromWarehouseId: String(handoff.sourceWarehouse.id),
        toWarehouseId: String(handoff.destinationWarehouse.id),
        inventoryId: String(handoff.sourceInventoryId),
        quantity: String(handoff.transferableNow),
        unit: handoff.unit || "",
      });
      navigate(`/warehouse/transfer?${params.toString()}`);
    } catch (error: any) {
      toast.error(error?.message ? localizeApiError(error.message) : t.workflow.pmv2.prepareTransferFailed);
      queue.refetch();
    }
  }

  async function startPurchaseRequest(item: any) {
    try {
      const requestItemId = Number(item.requestItemId);
      const handoff = await preparePurchase.mutateAsync({ requestItemId });
      const note = fmt(t.workflow.pmv2.purchasePrefillNote, { task: handoff.taskNumber, request: handoff.requestId, item: handoff.requestItemId, qty: qty(handoff.purchaseMinimumQuantity, handoff.unit) });
      const params = new URLSearchParams({
        pmv2RequestItemId: String(handoff.requestItemId),
        pmv2RequestId: String(handoff.requestId),
        pmv2TaskNumber: handoff.taskNumber,
        pmv2CatalogItemId: String(handoff.catalogItemId),
        pmv2ItemName: handoff.itemName,
        pmv2ItemCode: handoff.itemCode || "",
        pmv2Unit: handoff.unit || "",
        pmv2MinimumQuantity: String(handoff.purchaseMinimumQuantity),
        prefillNotes: note,
      });
      if (Number.isFinite(Number(item.taskNeedQuantity))) params.set("pmv2TaskNeedQuantity", String(item.taskNeedQuantity));
      if (Number.isFinite(Number(item.teamAvailableAtRequest))) params.set("pmv2TeamAvailableAtRequest", String(item.teamAvailableAtRequest));
      if (handoff.unitId) params.set("pmv2UnitId", String(handoff.unitId));
      navigate(`/purchase-orders/new?${params.toString()}`);
    } catch (error: any) {
      toast.error(error?.message ? localizeApiError(error.message) : t.workflow.pmv2.preparePurchaseFailed);
      queue.refetch();
    }
  }

  const readyIssueCount = Array.isArray(readyIssue.data) ? readyIssue.data.length : 0;
  const pendingReturnsCount = Array.isArray(pendingReturns.data) ? pendingReturns.data.length : 0;
  const visibleReturns = (Array.isArray(pendingReturns.data) ? pendingReturns.data : []).filter((item: any) => matchesReturnSearch(
    search, item.itemName, item.taskNumber, item.taskItemTitle, item.previousRecipientName,
    ...(item.lots || []).map((lot: any) => lot.lotCode), ...(item.physicalUsages || []).map((part: any) => part.itemName),
  ));

  return (
    <div className="space-y-6" dir={dir}>
      {!returnsOnly && <>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t.workflow.pmv2.warehouseQueueTitle}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t.workflow.pmv2.warehouseQueueHelp}
          </p>
        </div>
        <Button variant="outline" onClick={refreshOperationalQueues} disabled={queue.isFetching || readyIssue.isFetching || pendingReturns.isFetching}>
          {(queue.isFetching || readyIssue.isFetching || pendingReturns.isFetching) ? <Loader2 className={dir === "rtl" ? "ml-2 h-4 w-4 animate-spin" : "mr-2 h-4 w-4 animate-spin"} /> : <RefreshCw className={dir === "rtl" ? "ml-2 h-4 w-4" : "mr-2 h-4 w-4"} />}
          {t.common.refresh}
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t.workflow.pmv2.warehouseSummary}</CardTitle>
          <CardDescription>{t.workflow.pmv2.warehouseSummaryHelp}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-lg border bg-muted/20 p-3">
              <p className="text-xs text-muted-foreground">{t.workflow.pmv2.mainWarehouseCheck}</p>
              <p className="mt-1 flex items-center gap-2 font-semibold"><Warehouse className="h-4 w-4" />{localizedName(data?.mainWarehouse)}</p>
              <p className="mt-1 text-xs text-muted-foreground">{data?.mainWarehouse.code || "—"}</p>
            </div>
            <div className="rounded-lg border bg-muted/20 p-3">
              <p className="text-xs text-muted-foreground">{t.workflow.pmv2.waitingWarehouseRequests}</p>
              <p className="mt-1 flex items-center gap-2 font-semibold"><ClipboardList className="h-4 w-4" />{data?.total ?? 0}</p>
              <p className="mt-1 text-xs text-muted-foreground">{t.workflow.pmv2.waitingWarehouseStatus}</p>
            </div>
            <div className="rounded-lg border bg-muted/20 p-3">
              <p className="text-xs text-muted-foreground">{t.workflow.pmv2.readyTaskIssue}</p>
              <p className="mt-1 flex items-center gap-2 font-semibold"><PackageCheck className="h-4 w-4" />{readyIssueCount}</p>
              <p className="mt-1 text-xs text-muted-foreground">{t.workflow.pmv2.waitingActualIssue}</p>
            </div>
            <div className="rounded-lg border bg-muted/20 p-3">
              <p className="text-xs text-muted-foreground">{t.workflow.pmv2.pendingPmv2Returns}</p>
              <p className="mt-1 flex items-center gap-2 font-semibold"><RotateCcw className="h-4 w-4" />{pendingReturnsCount}</p>
              <p className="mt-1 text-xs text-muted-foreground">{t.workflow.pmv2.waitingWarehouseReceipt}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-2 rounded-xl border bg-card p-2 sm:grid-cols-3" role="tablist" aria-label={t.workflow.pmv2.warehouseSectionsAria}>
        <button
          type="button"
          role="tab"
          aria-selected={activeSection === "waiting"}
          onClick={() => setActiveSection("waiting")}
          className={`flex items-center justify-between gap-2 rounded-lg px-4 py-3 text-start text-sm font-semibold transition-colors ${activeSection === "waiting" ? "bg-primary text-primary-foreground shadow-sm" : "hover:bg-muted"}`}
        >
          <span className="flex items-center gap-2"><ClipboardList className="h-4 w-4" />{t.workflow.pmv2.needsProcessing}</span>
          <span className={`rounded-full px-2 py-0.5 text-xs ${activeSection === "waiting" ? "bg-primary-foreground/15" : "bg-muted"}`}>{data?.total ?? 0}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeSection === "ready"}
          onClick={() => setActiveSection("ready")}
          className={`flex items-center justify-between gap-2 rounded-lg px-4 py-3 text-start text-sm font-semibold transition-colors ${activeSection === "ready" ? "bg-primary text-primary-foreground shadow-sm" : "hover:bg-muted"}`}
        >
          <span className="flex items-center gap-2"><PackageCheck className="h-4 w-4" />{t.workflow.pmv2.readyForIssue}</span>
          <span className={`rounded-full px-2 py-0.5 text-xs ${activeSection === "ready" ? "bg-primary-foreground/15" : "bg-muted"}`}>{readyIssueCount}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeSection === "returns"}
          onClick={() => setActiveSection("returns")}
          className={`flex items-center justify-between gap-2 rounded-lg px-4 py-3 text-start text-sm font-semibold transition-colors ${activeSection === "returns" ? "bg-primary text-primary-foreground shadow-sm" : "hover:bg-muted"}`}
        >
          <span className="flex items-center gap-2"><RotateCcw className="h-4 w-4" />{t.workflow.pmv2.returns}</span>
          <span className={`rounded-full px-2 py-0.5 text-xs ${activeSection === "returns" ? "bg-primary-foreground/15" : "bg-muted"}`}>{pendingReturnsCount}</span>
        </button>
      </div>

      </>}
      {returnsOnly && <Button variant="outline" disabled={pendingReturns.isFetching} onClick={() => void refreshOperationalQueues()}>{t.common.refresh}</Button>}
      {activeSection === "waiting" && (
      <section className="space-y-3" role="tabpanel">
        <div className="flex flex-col gap-1 border-b pb-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold">{t.workflow.pmv2.waitingSectionTitle}</h2>
            <p className="text-sm text-muted-foreground">{t.workflow.pmv2.waitingSectionHelp}</p>
          </div>
          {!queue.isLoading && !queue.error && <Badge variant="secondary">{fmt(t.workflow.pmv2.requestCount, { count: data?.total ?? 0 })}</Badge>}
        </div>

        {queue.isLoading ? (
          <Card>
            <CardContent className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              {t.workflow.pmv2.loadingMaterialRequests}
            </CardContent>
          </Card>
        ) : queue.error ? (
          <Card className="border-red-200">
            <CardContent className="py-8 text-center text-red-700">
              {queue.error.message ? localizeApiError(queue.error.message) : t.workflow.pmv2.queueLoadFailed}
            </CardContent>
          </Card>
        ) : !data?.items.length ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center gap-2 py-14 text-center text-muted-foreground">
              <PackageCheck className="h-9 w-9" />
              <p className="font-medium">{t.workflow.pmv2.noWaitingRequests}</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {data.items.map((item) => {
              const statusView = STATUS_VIEW[item.availabilityStatus] ?? STATUS_VIEW.insufficient;
              const inventory = item.mainWarehouseAvailability;
              return (
                <Card key={item.requestItemId} className="overflow-hidden">
                  <CardHeader className="gap-3 border-b bg-muted/10">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <CardTitle className="text-lg">{item.itemNameSnapshot}</CardTitle>
                        <CardDescription className="mt-1">
                          {fmt(t.workflow.pmv2.requestMeta, { request: item.requestId, item: item.requestItemId, task: item.taskNumber })}
                        </CardDescription>
                      </div>
                      <Badge variant="outline" className={statusView.className}>{statusView.label}</Badge>
                    </div>
                  </CardHeader>
                  <div className="px-6 py-3"><MaterialRequestMeta creatorName={item.requestCreatorName} sentAt={item.requestCreatedAt} language={language} /></div>
                  <details className="group">
                    <summary className="cursor-pointer list-none border-b px-6 py-3 text-sm font-medium text-primary hover:bg-muted/40 [&::-webkit-details-marker]:hidden">
                      <span className="group-open:hidden">{t.workflow.pmv2.showDetailsAction}</span>
                      <span className="hidden group-open:inline">{t.workflow.pmv2.hideDetails}</span>
                    </summary>

                  <CardContent className="space-y-4 pt-4">
                    <div className="grid gap-4 xl:grid-cols-2">
                      <div className="rounded-lg border p-3">
                        <p className="mb-3 text-sm font-semibold">{t.workflow.pmv2.quantities}</p>
                        <div className="grid gap-3 text-sm sm:grid-cols-2">
                          <div>
                            <p className="text-muted-foreground">{t.workflow.pmv2.taskNeed}</p>
                            <p className="font-semibold">{qty(item.taskNeedQuantity, item.unitSnapshot)}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">{t.workflow.pmv2.teamAvailableAtRequest}</p>
                            <p className="font-semibold">{qty(item.teamAvailableAtRequest, item.unitSnapshot)}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">{t.workflow.pmv2.taskRecordedShortage}</p>
                            <p className="font-semibold">{qty(item.requestedQuantity, item.unitSnapshot)}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">{t.workflow.pmv2.remainingCoverage}</p>
                            <p className="font-semibold">{qty(item.remainingQuantity, item.unitSnapshot)}</p>
                          </div>
                        </div>
                      </div>

                      <div className="rounded-lg border p-3">
                        <p className="mb-3 text-sm font-semibold">{t.workflow.pmv2.inventoryDestination}</p>
                        <div className="grid gap-3 text-sm sm:grid-cols-2">
                          <div>
                            <p className="text-muted-foreground">{t.workflow.pmv2.mainAvailableNow}</p>
                            <p className="font-semibold">
                              {item.catalogItemId == null || item.availabilityStatus === "catalog_unavailable"
                                ? "—"
                                : qty(inventory?.availableQuantity ?? 0, inventory?.unit || item.unitSnapshot)}
                            </p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">{t.workflow.pmv2.targetTeamStore}</p>
                            <p className="font-semibold">
                              {item.teamWarehouse ? localizedName(item.teamWarehouse) : `Warehouse #${item.teamWarehouseId}`}
                              {item.teamWarehouse?.code ? ` (${item.teamWarehouse.code})` : ""}
                            </p>
                          </div>
                        </div>
                        <p className="mt-3 text-xs text-muted-foreground">{t.workflow.pmv2.teamLabel}: {item.teamCode} · #{item.teamId}</p>
                      </div>
                    </div>

                    <div className="rounded-lg border p-3 text-sm">
                      <p className="mb-3 font-semibold">{t.workflow.pmv2.requestStatusDetails}</p>
                      {item.catalogItemId != null && (
                        <div className="mb-3 grid gap-2 sm:grid-cols-2">
                          <p><span className="text-muted-foreground">{t.workflow.pmv2.itemCode}:</span> <span className="font-medium">{item.catalogItem?.code || t.workflow.pmv2.notSetCatalog}</span></p>
                          <p><span className="text-muted-foreground">{t.workflow.pmv2.taxonomy}:</span> <span className="font-medium">{(language === "ar" ? item.catalogItem?.categoryPathAr : item.catalogItem?.categoryPathEn) || item.catalogItem?.categoryPathEn || item.catalogItem?.categoryPathAr || t.workflow.pmv2.notSetTaxonomy}</span></p>
                        </div>
                      )}
                      <div className="flex items-start gap-2 rounded-md bg-muted/30 p-3">
                        <Boxes className="mt-0.5 h-4 w-4 shrink-0" />
                        <div className="space-y-1">
                          <p><span className="text-muted-foreground">{t.workflow.pmv2.maintenanceItem}:</span> {item.taskItemTitle}</p>
                          <p><span className="text-muted-foreground">{t.workflow.pmv2.due}:</span> {item.dueDate}</p>
                          {item.catalogItemId == null && (
                            <p><span className="text-muted-foreground">{t.workflow.pmv2.materialIdentity}:</span> {t.workflow.pmv2.unlistedMustResolve}</p>
                          )}
                          {item.taskNeedQuantity != null && item.teamAvailableAtRequest != null && (
                            <p className="font-medium">
                              {fmt(t.workflow.pmv2.needCoverageSummary, { need: qty(item.taskNeedQuantity, item.unitSnapshot), team: qty(item.teamAvailableAtRequest, item.unitSnapshot), request: qty(item.requestedQuantity, item.unitSnapshot) })}
                            </p>
                          )}
                          {item.availabilityStatus === "available" && (
                            <p className="font-medium text-emerald-700">
                              {fmt(t.workflow.pmv2.mainFullyCovers, { qty: qty(item.remainingQuantity, item.unitSnapshot) })}
                            </p>
                          )}
                          {item.availabilityStatus === "insufficient" && Number(item.purchaseNeededQuantity || 0) > 0 && (
                            <p className="font-medium text-amber-700">
                              {fmt(t.workflow.pmv2.mainInsufficientPurchase, { available: qty(item.transferableNow, item.unitSnapshot), purchase: qty(item.purchaseNeededQuantity, item.unitSnapshot) })}
                            </p>
                          )}
                          {item.availabilityStatus === "insufficient" && Number(item.purchaseNeededQuantity || 0) <= 0 && Number(item.pendingPurchaseCoverageQuantity || 0) > 0 && (
                            <p className="font-medium text-amber-700">
                              {t.workflow.pmv2.pendingPurchaseCovers}
                            </p>
                          )}
                          {item.availabilityStatus === "ambiguous_inventory" && (
                            <p className="font-medium text-red-700">{t.workflow.pmv2.ambiguousInventoryHelp}</p>
                          )}
                          {item.availabilityStatus === "unit_mismatch" && (
                            <p className="font-medium text-red-700">{t.workflow.pmv2.unitMismatchHelp}</p>
                          )}
                          {item.availabilityStatus === "catalog_unavailable" && (
                            <p className="font-medium text-red-700">{t.workflow.pmv2.catalogUnavailableHelp}</p>
                          )}
                        </div>
                      </div>
                    </div>

                    {!!item.purchaseLinks?.length && (
                      <div className="rounded-md border border-blue-200 bg-blue-50/50 p-3 text-sm text-blue-900">
                        <p className="font-medium">{t.workflow.pmv2.linkedPurchaseOrders}</p>
                        {item.purchaseLinks.map((link: any) => (
                          <p key={link.id} className="mt-1">
                            {link.poNumber || `PO #${link.purchaseOrderId}`} · {fmt(t.workflow.pmv2.linkedToTaskQty, { qty: qty(link.linkedQuantity, item.unitSnapshot) })}
                            {link.purchaseQuantity != null ? ` · ${fmt(t.workflow.pmv2.purchaseItemQty, { qty: qty(link.purchaseQuantity, item.unitSnapshot) })}` : ""}
                            {link.itemStatus ? ` · ${fmt(t.workflow.pmv2.statusInline, { status: link.itemStatus })}` : ""}
                          </p>
                        ))}
                      </div>
                    )}

                    <div className="rounded-lg border bg-muted/10 p-3">
                      <p className="mb-3 text-sm font-semibold">{t.workflow.pmv2.actionLabel}</p>
                      <div className="space-y-3">
                        {(item.catalogItemId == null || (item.catalogItem?.unit && item.unitSnapshot !== item.catalogItem.unit)) && (
                          <Button className="w-full gap-2" onClick={() => openIdentityResolver(item)}>
                            <Link2 className="h-4 w-4" />
                            {item.catalogItemId == null ? t.workflow.pmv2.identifyFromCatalog
                              : language === "ar" ? "اعتماد وحدة وكمية الاحتياج" : language === "ur" ? "ضرورت کی اکائی اور مقدار کی تصدیق" : "Confirm requested unit and quantity"}
                          </Button>
                        )}

                        {item.catalogItemId != null && item.availabilityStatus === "available" && item.remainingQuantity > 0 && (
                          <Button className="w-full gap-2" onClick={() => startWarehouseTransfer(item.requestItemId)} disabled={prepareTransfer.isPending}>
                            {prepareTransfer.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowLeftRight className="h-4 w-4" />}
                            {fmt(t.workflow.pmv2.transferShortage, { qty: qty(item.remainingQuantity, item.unitSnapshot) })}
                          </Button>
                        )}

                        {item.catalogItemId != null && Number(item.purchaseNeededQuantity || 0) > 0 && !["ambiguous_inventory", "unit_mismatch", "catalog_unavailable"].includes(item.availabilityStatus) && (
                          <Button variant="outline" className="w-full gap-2" onClick={() => startPurchaseRequest(item)} disabled={preparePurchase.isPending}>
                            {preparePurchase.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShoppingCart className="h-4 w-4" />}
                            {fmt(t.workflow.pmv2.createPurchaseShortage, { qty: qty(item.purchaseNeededQuantity, item.unitSnapshot) })}
                          </Button>
                        )}

                        {item.catalogItemId != null && Number(item.mainWarehouseShortageQuantity || 0) > 0 && Number(item.purchaseNeededQuantity || 0) <= 0 && Number(item.pendingPurchaseCoverageQuantity || 0) > 0 && (
                          <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm font-medium text-amber-800">
                            {fmt(t.workflow.pmv2.purchaseAlreadyCovers, { qty: qty(item.pendingPurchaseCoverageQuantity, item.unitSnapshot) })}
                          </p>
                        )}
                      </div>
                    </div>
                  </CardContent>
                  </details>
                </Card>
              );
            })}
          </div>
        )}
      </section>
      )}

      {activeSection === "ready" && (
      <section className="space-y-3" role="tabpanel">
        <div className="flex flex-col gap-1 border-b pb-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold">{t.workflow.pmv2.readyIssueSectionTitle}</h2>
            <p className="text-sm text-muted-foreground">{t.workflow.pmv2.readyIssueHelp}</p>
          </div>
          {!readyIssue.isLoading && !readyIssue.error && <Badge variant="secondary">{fmt(t.workflow.pmv2.materialCount, { count: readyIssueCount })}</Badge>}
        </div>
        {readyIssue.isLoading ? (
          <Card><CardContent className="flex items-center justify-center gap-2 py-8 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> {t.workflow.pmv2.checkingReadyIssue}</CardContent></Card>
        ) : readyIssue.error ? (
          <Card className="border-red-200"><CardContent className="py-6 text-center text-red-700">{localizeApiError(readyIssue.error.message)}</CardContent></Card>
        ) : !(readyIssue.data as any[] | undefined)?.length ? (
          <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">{t.workflow.pmv2.noReadyIssue}</CardContent></Card>
        ) : (
          <div className="space-y-3">
            {(readyIssue.data as any[]).map((item: any) => {
              const selectedRecipient = recipientByRequirement[item.routeDecisionActionId] || String(item.defaultRecipientUserId || "");
              const selection=lotSelections[item.routeDecisionActionId]||{mode:"fifo" as const};
              let manualReady=true;
              if(selection.mode==="manual")try{selectFullIssueLots(item.availableLotOptions||[],item.remainingQuantity,item.unit,selection);}catch{manualReady=false;}
              return (
                <Card key={item.routeDecisionActionId} className={item.canIssue ? "border-emerald-200" : "border-amber-200"}>
                  <CardHeader className="border-b pb-3">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <CardTitle className="text-lg">{item.itemName}</CardTitle>
                        <CardDescription>{item.itemCode ? fmt(t.workflow.pmv2.codeInline, { code: item.itemCode }) + " · " : ""}{fmt(t.workflow.pmv2.taskInline, { task: item.taskNumber })} · {item.taskItemTitle}</CardDescription>
                      </div>
                      <Badge variant="outline" className={item.canIssue ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700"}>
                        {item.canIssue ? t.workflow.pmv2.readyForIssue : t.workflow.pmv2.needsReview}
                      </Badge>
                    </div>
                  </CardHeader>
                  <div className="px-6 py-3"><MaterialRequestMeta creatorName={item.requestCreatorName} sentAt={item.requestCreatedAt} language={language} /></div>
                  <details className="group">
                    <summary className="cursor-pointer list-none border-b px-6 py-3 text-sm font-medium text-primary hover:bg-muted/40 [&::-webkit-details-marker]:hidden">
                      <span className="group-open:hidden">{t.workflow.pmv2.showDetailsIssue}</span>
                      <span className="hidden group-open:inline">{t.workflow.pmv2.hideDetails}</span>
                    </summary>
                  <CardContent className="space-y-4 pt-4">
                    <div className="rounded-lg border p-3">
                      <p className="mb-3 text-sm font-semibold">{t.workflow.pmv2.quantitiesLocation}</p>
                      <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-5">
                        <div><p className="text-muted-foreground">{t.workflow.pmv2.taskNeed}</p><p className="font-semibold">{qty(item.requiredQuantity, item.unit)}</p></div>
                        <div><p className="text-muted-foreground">{t.workflow.pmv2.issuedForTaskWh}</p><p className="font-semibold">{qty(item.issuedQuantity, item.unit)}</p></div>
                        <div><p className="text-muted-foreground">{t.workflow.pmv2.willIssueNow}</p><p className="font-semibold">{qty(item.remainingQuantity, item.unit)}</p></div>
                        <div><p className="text-muted-foreground">{t.workflow.pmv2.availableTeamStoreWh}</p><p className="font-semibold">{qty(item.availableQuantity, item.unit)}</p></div>
                        <div><p className="text-muted-foreground">{t.workflow.pmv2.locationAsset}</p><p className="font-semibold">{item.targetLabel}</p></div>
                      </div>
                    </div>
                    <div className="rounded-md border bg-muted/30 p-3 text-sm">
                      <p><span className="text-muted-foreground">{t.workflow.pmv2.materialRequester}:</span> <strong>{item.requesterName}</strong></p>
                      <p className="mt-1"><span className="text-muted-foreground">{t.workflow.pmv2.teamLabel}:</span> {item.teamCode}</p>
                      {!!item.lotAllocations?.length && (
                        <p className="mt-1"><span className="text-muted-foreground">{t.workflow.pmv2.autoLotAllocation}:</span> {item.lotAllocations.map((lot: any) => `${lot.lotCode} = ${qty(lot.quantity, lot.unit||item.unit)}${lot.replacementPlanId ? ` ↔ ${qty(lot.originalQuantity,item.unit)}`:""}`).join(" + ")}</p>
                      )}
                    </div>
                    {item.pendingRelink ? (
                      <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                        <p className="font-semibold">{item.blocker}</p>
                        <p>{t.workflow.pmv2.lotLabel}: {item.pendingRelink.lotCode || "—"} · {t.workflow.pmv2.quantityLabelWh}: {qty(item.pendingRelink.quantity, item.unit)}</p>
                        <Button variant="outline" className="gap-2 border-amber-400" disabled={relinkDelivery.isPending} onClick={() => relinkDelivery.mutate({ routeDecisionActionId: item.routeDecisionActionId, deliveryNumber: item.pendingRelink.deliveryNumber })}>
                          {relinkDelivery.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                          {t.workflow.pmv2.relinkOnly}
                        </Button>
                      </div>
                    ) : item.blocker ? <p className="text-sm font-medium text-amber-700">{item.blocker}</p> : (
                      <div className="grid gap-3 rounded-lg border bg-muted/10 p-3 sm:grid-cols-[1fr_auto] sm:items-end">
                        <div className="sm:col-span-2"><WarehouseLotSelection lots={item.availableLotOptions||[]} required={item.remainingQuantity} unit={item.unit} value={selection}
                          onChange={value=>setLotSelections(old=>({...old,[item.routeDecisionActionId]:value}))} disabled={issueRequirement.isPending} language={language}/></div>
                        <div>
                          <label className="mb-1 block text-xs font-medium">{t.workflow.pmv2.actualRecipient}</label>
                          <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={selectedRecipient}
                            onChange={(event) => setRecipientByRequirement((current) => ({ ...current, [item.routeDecisionActionId]: event.target.value }))}>
                            {item.technicians.map((tech: any) => <option key={tech.id} value={String(tech.id)}>{tech.name}{tech.id === item.requesterUserId ? ` — ${t.workflow.pmv2.materialRequesterSuffix}` : ""}</option>)}
                          </select>
                        </div>
                        <Button className="gap-2" disabled={issueRequirement.isPending || !selectedRecipient || !manualReady}
                          onClick={() => issueRequirement.mutate({ routeDecisionActionId: item.routeDecisionActionId, deliveredToId: Number(selectedRecipient),selection })}>
                          {issueRequirement.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                          {t.workflow.pmv2.issueFullNeed}
                        </Button>
                      </div>
                    )}
                  </CardContent>
                  </details>
                </Card>
              );
            })}
          </div>
        )}
      </section>
      )}

      {activeSection === "returns" && (
      <section className="space-y-3" role="tabpanel">
        <div className="flex flex-col gap-1 border-b pb-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold">{t.workflow.pmv2.returnsSectionTitle}</h2>
            <p className="text-sm text-muted-foreground">{t.workflow.pmv2.returnsHelp}</p>
          </div>
          {!pendingReturns.isLoading && !(returnsOnly && pendingReturns.error) && <Badge variant="secondary">{fmt(t.workflow.pmv2.returnCount, { count: visibleReturns.length })}</Badge>}
        </div>
        {pendingReturns.isLoading ? (
          <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">{t.workflow.pmv2.loadingReturns}</CardContent></Card>
        ) : returnsOnly && pendingReturns.error ? (
          <p role="alert" className="text-sm text-destructive">{localizeApiError(pendingReturns.error.message, language)}</p>
        ) : !visibleReturns.length ? (
          <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">{t.workflow.pmv2.noPendingReturns}</CardContent></Card>
        ) : (
          <div className="space-y-3">
            {visibleReturns.map((item: any) => (
              <Card key={item.declarationActionId}>
                <CardHeader className="border-b pb-3"><CardTitle className="text-base">{item.itemName}</CardTitle><CardDescription>{item.taskNumber} · {item.taskItemTitle}</CardDescription></CardHeader>
                  <details className="group">
                    <summary className="cursor-pointer list-none border-b px-6 py-3 text-sm font-medium text-primary hover:bg-muted/40 [&::-webkit-details-marker]:hidden">
                      <span className="group-open:hidden">{t.workflow.pmv2.showDetailsReceive}</span>
                      <span className="hidden group-open:inline">{t.workflow.pmv2.hideDetails}</span>
                    </summary>
                <CardContent className="space-y-3 pt-4 text-sm">
                  <div className="rounded-lg border p-3">
                    <p className="mb-3 font-semibold">{t.workflow.pmv2.quantities}</p>
                    <div className="grid gap-2 sm:grid-cols-4">
                      <div><span className="text-muted-foreground">{t.workflow.pmv2.issuedForTaskWh}</span><div className="font-semibold">{qty(item.issuedQuantity, item.unit)}</div></div>
                      <div><span className="text-muted-foreground">{t.workflow.pmv2.usedQuantityLabel}</span><div className="font-semibold">{item.physicalMode?"—":qty(item.usedQuantity, item.unit)}</div></div>
                      <div><span className="text-muted-foreground">{t.workflow.pmv2.remainingReturnQty}</span><div className="font-semibold">{item.physicalMode?item.lots.map((lot:any)=>qty(lot.returnableQuantity,lot.physicalUnit)).join(" + "):qty(item.remainingReturnQuantity, item.unit)}</div></div>
                      <div><span className="text-muted-foreground">{t.workflow.pmv2.previousRecipient}</span><div className="font-semibold">{item.previousRecipientName || "—"}</div></div>
                    </div>
                    {!!item.physicalMode && <div className="mt-2 text-xs">{item.physicalUsages.map((part:any)=><p key={part.deliveryDocumentId}>{part.itemName} · {part.lotCode}: {qty(part.usedQuantity,part.unit)}</p>)}</div>}
                  </div>
                  {item.singleLot ? (
                    <p className="rounded-md border bg-muted/30 p-2">{t.workflow.pmv2.returnLotFixed}: <strong>{item.lots[0]?.lotCode || `#${item.lots[0]?.lotId}`}</strong>{item.lots[0]?.physicalUnit ? ` — ${qty(Number((item.remainingReturnQuantity*item.lots[0].physicalReturnableQuantity/item.lots[0].returnableQuantity).toFixed(3)),item.lots[0].physicalUnit)}`:""}</p>
                  ) : (
                    <div className="rounded-md border p-3">
                      <p className="mb-2 font-medium">{t.workflow.pmv2.selectReturnLots}</p>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {item.lots.map((lot: any) => {
                          const key = `${item.declarationActionId}:${lot.lotId}`;
                          return <label key={lot.lotId} className="flex items-center justify-between gap-2 rounded border p-2">
                            <span>{lot.lotCode || `Lot #${lot.lotId}`} · {t.workflow.pmv2.maxReturn}: {lot.returnableQuantity} {item.physicalMode?lot.physicalUnit:item.unit}{!item.physicalMode&&lot.physicalUnit&&(lot.physicalUnit!==item.unit||Math.abs(lot.physicalReturnableQuantity-lot.returnableQuantity)>0.0005) ? ` ↔ ${lot.physicalReturnableQuantity} ${lot.physicalUnit}`:""}</span>
                            <input type="number" min="0" max={lot.returnableQuantity} step="0.001" dir="ltr" className="h-9 w-24 rounded border px-2" value={returnQtyByLot[key] || ""}
                              onChange={(event) => setReturnQtyByLot((current) => ({ ...current, [key]: event.target.value }))} />
                          </label>;
                        })}
                      </div>
                    </div>
                  )}
                  <div className="rounded-lg border bg-muted/10 p-3">
                    <Button variant="outline" className="gap-2" disabled={confirmReturn.isPending} onClick={() => {
                      const lotAllocations = item.singleLot ? undefined : item.lots.map((lot: any) => ({
                        lotId: lot.lotId,
                        quantity: Number(returnQtyByLot[`${item.declarationActionId}:${lot.lotId}`] || 0),
                      })).filter((row: any) => row.quantity > 0);
                      confirmReturn.mutate({ declarationActionId: item.declarationActionId, lotAllocations });
                    }}>
                      {confirmReturn.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                      {t.workflow.pmv2.confirmReturnReceipt}
                    </Button>
                  </div>
                </CardContent>
                </details>
              </Card>
            ))}
          </div>
        )}
      </section>
      )}

      {!returnsOnly && <><Card className="border-blue-200 bg-blue-50/50">
        <CardContent className="flex gap-3 pt-6 text-sm text-blue-900">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <p className="font-semibold">{t.workflow.pmv2.pmv2NoInventoryMovement}</p>
            <p className="mt-1">
              {t.workflow.pmv2.pmv2IntegrationHelp}
            </p>
          </div>
        </CardContent>
      </Card>

      <MaterialIdentityDialog
        allowDifferentUnits
        lockCatalogSelection={identityRequest?.catalogItemId != null}
        quantityApproval={{ value: approvedIdentityQuantity, onChange: setApprovedIdentityQuantity,
          step: pmv2MaterialUnitRequiresWholeQuantity(identityCatalogUnit) ? 1 : 0.001,
          validate: value => getPmv2MaterialQuantityValidationMessage(value, identityCatalogUnit)
            || (Math.abs(value * 1000 - Math.round(value * 1000)) > 0.000001 ? "دقة الكمية لا تتجاوز ثلاث منازل عشرية" : null) }}
        open={Boolean(identityRequest)} onClose={() => { if (!resolveMaterialIdentity.isPending) { setIdentityRequest(null); setIdentitySearch(""); setSelectedIdentityCatalogId(null); } }}
        language={language} originalName={identityRequest?.itemNameSnapshot || ""}
        requestedQuantity={identityRequest?.taskNeedQuantity ?? identityRequest?.requestedQuantity}
        unit={identityRequest?.unitSnapshot} referenceNumber={identityRequest?.taskNumber || ""} itemTitle={identityRequest?.taskItemTitle || ""}
        search={identitySearch} onSearch={value => { setIdentitySearch(value); setSelectedIdentityCatalogId(null); }}
        items={identityItems} selectedId={selectedIdentityCatalogId} onSelect={setSelectedIdentityCatalogId}
        loading={identityCandidates.isFetching} error={identityCandidates.error} busy={resolveMaterialIdentity.isPending}
        onConfirm={() => { if (identityRequest?.requestItemId && selectedIdentityCatalogId) resolveMaterialIdentity.mutate({ requestItemId: Number(identityRequest.requestItemId), catalogItemId: Number(selectedIdentityCatalogId), requestedQuantity: Number(approvedIdentityQuantity) }); }}
      />
      </>}
    </div>
  );
}
