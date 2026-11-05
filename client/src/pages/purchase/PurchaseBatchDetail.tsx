import { isDelegateRole } from "@shared/roles";
import { ExternalWorkshopPricingFields, externalWorkshopForm, externalWorkshopIssue, externalWorkshopPayload, type ExternalWorkshopForm } from "@/components/purchase/ExternalWorkshopPricingFields";
import { externalMaintenanceLabels } from "@/i18n/externalMaintenanceFollowup";
import { trpc } from "@/lib/trpc";
import { useLocation, useRoute } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowRight, CalendarDays, CheckCircle2, DollarSign, FileDown, Inbox, Loader2, Send, ShoppingCart, User, XCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/_core/hooks/useAuth";
import { useStaticLabels, useBatchTranslation, useEntityTranslation, getLocalizedItemField } from "@/hooks/useContentTranslation";
import { useTranslation } from "@/contexts/LanguageContext";
import { localizeApiError } from "@/i18n/apiError";
import { getLocalizedCatalogUnitName } from "@/i18n/catalogMasterData";
import { formatAvailableDuration, formatDateOnly, getAvailableCalendarDays } from "@/lib/purchaseItemTiming";
import { formatPurchaseSubmissionTime } from "@shared/purchaseSubmissionTime";
import { canOpenApprovalPdf, approvalPdfNotice } from "@/lib/approvalPdfAccess";

// ============================================================
// [PB-P2] صفحة تفاصيل حزمة الشراء — المندوب والحسابات (2026-08-30/31)
//
// العرض يجعل كل طلب بطاقة كاملة تحت رأس الدفعة، مع بقاء إجراءات الصنف
// الحالية في مستواها الأصلي. اعتماد الحسابات للحزم أُضيف بموافقة صريحة على
// مستوى دفعة الإرسال الواحدة، بينما اعتماد الطلب المفرد القديم لم يتغير.
// الشراء والاستلام وPurchaseOrderDetail.tsx لا يعاد هيكلتها هنا.
// ============================================================

const PO_STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  pending_review: "bg-blue-100 text-blue-700",
  revision_needed: "bg-rose-100 text-rose-700",
  pending_estimate: "bg-amber-100 text-amber-700",
  pending_accounting: "bg-orange-100 text-orange-700",
  pending_management: "bg-orange-100 text-orange-700",
  approved: "bg-teal-100 text-teal-700",
  partial_purchase: "bg-cyan-100 text-cyan-700",
  purchased: "bg-emerald-100 text-emerald-700",
  received: "bg-green-100 text-green-700",
  closed: "bg-gray-100 text-gray-700",
  rejected: "bg-red-100 text-red-700",
};

const ITEM_STATUS_COLORS: Record<string, string> = {
  pending: "bg-gray-100 text-gray-700",
  estimated: "bg-amber-100 text-amber-700",
  approved: "bg-teal-100 text-teal-700",
  rejected: "bg-red-100 text-red-700",
  funded: "bg-cyan-100 text-cyan-700",
  purchased: "bg-emerald-100 text-emerald-700",
  delivered_to_warehouse: "bg-blue-100 text-blue-700",
  delivered_to_requester: "bg-green-100 text-green-700",
  cancelled: "bg-gray-200 text-gray-500",
  purchase_cancelled: "bg-red-100 text-red-700",
  needs_item_revision: "bg-rose-100 text-rose-700",
};

const WORKFLOW_KEYS = [
  "draft",
  "pending_review",
  "pending_estimate",
  "pending_accounting",
  "pending_management",
  "approved",
  "purchased",
  "received",
] as const;

function currentWorkflowIndex(status: string) {
  if (status === "draft") return 0;
  if (status === "pending_review" || status === "revision_needed") return 1;
  if (status === "pending_estimate") return 2;
  if (status === "pending_accounting") return 3;
  if (status === "pending_management") return 4;
  if (status === "approved") return 5;
  if (status === "partial_purchase" || status === "purchased") return 6;
  if (status === "received" || status === "closed") return 7;
  return -1;
}

export default function PurchaseBatchDetail() {
  const [, params] = useRoute("/purchase-packages/:id");
  const [, setLocation] = useLocation();
  const { language, t, dir } = useTranslation();
  const { user } = useAuth();
  const { getPOStatusLabel, getPOItemStatusLabel } = useStaticLabels();
  const locale = language === "ar" ? "ar-SA" : language === "ur" ? "ur-PK" : "en-US";
  const currency = t?.common?.currency || "SAR";

  const packageId = Number(params?.id);
  const utils = trpc.useUtils();
  const { data: catalogUnits = [] } = trpc.catalog.units.list.useQuery();
  const displayUnit = (value: string | null | undefined) =>
    getLocalizedCatalogUnitName(value, catalogUnits as any[], language);
  const displayItemName = (item: any) => getLocalizedItemField(item, "itemName", language) || getLocalizedItemField(item, "description", language) || t.workflow.purchase.itemFallback.replace("{id}", String(item?.id ?? ""));
  const displayItemDescription = (item: any) => getLocalizedItemField(item, "description", language);
  const { data: pkg, isLoading } = trpc.purchasePackages.getById.useQuery(
    { id: packageId },
    { enabled: Number.isFinite(packageId) }
  );
  const { data: directoryUsers = [] } = trpc.users.list.useQuery(undefined, { enabled: !!user && !isDelegateRole(user.role) });
  const packageOrders = (pkg as any)?.orders ?? [];
  const users = user && isDelegateRole(user.role) ? [
    { id: user.id, name: user.name },
    { id: (pkg as any)?.createdById, name: (pkg as any)?.createdByName },
    ...packageOrders.map((po: any) => ({ id: po.requestedById, name: po.requestedByName })),
  ] : directoryUsers;
  const packageItems = packageOrders.flatMap((order: any) => order.items ?? []);
  const { translations: packageTranslations } = useEntityTranslation(
    "PO_PACKAGE",
    (pkg as any)?.id,
    ["notes"],
  );
  const { translationsMap: itemWorkflowTranslations } = useBatchTranslation(
    "PO_ITEM",
    packageItems.map((item: any) => Number(item.id)).filter((id: number) => Number.isFinite(id)),
    ["delegateChangeReason", "managementRejectionReason", "itemRevisionNote", "purchaseCancelReason", "returnReason"],
  );
  const workflowItemField = (item: any, field: string) => itemWorkflowTranslations[Number(item.id)]?.[field] || item?.[field] || "";

  const isDelegate = isDelegateRole(user?.role);
  // عند الدخول من «بانتظار إجرائي» أثناء التسعير نعرض البطاقة التشغيلية
  // الكاملة للحزمة. الدخول العادي من «جميع الطلبات» يبقى ملخصًا كما اتفقنا.
  const isDelegatePricingActionView =
    isDelegate &&
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("action") === "pricing";
  const focusedSubmissionIdRaw =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("submissionId")
      : null;
  const focusedSubmissionId = focusedSubmissionIdRaw ? Number(focusedSubmissionIdRaw) : undefined;
  const isPackageSubmissionFocusView =
    ["accountant", "senior_management"].includes(user?.role || "") &&
    Number.isFinite(focusedSubmissionId);
  const isAdminOrOwner = user?.role === "admin" || user?.role === "owner";
  const [estimates, setEstimates] = useState<Record<number, string>>({});
  const [workshopDrafts, setWorkshopDrafts] = useState<Record<number, ExternalWorkshopForm>>({});
  const [selectedRevisionItemId, setSelectedRevisionItemId] = useState<number | null>(null);
  const [itemRevisionReason, setItemRevisionReason] = useState("");
  const [delegateChangeDialogItem, setDelegateChangeDialogItem] = useState<any>(null);
  const [delegateChangeReason, setDelegateChangeReason] = useState("");

  const refreshPackage = () => {
    // إعادة مزامنة العرض من الخادم بعد أي إجراء على الحزمة، حتى إذا
    // نجح التغيير التشغيلي ثم فشلت خطوة لاحقة غير حرجة في نفس الطلب.
    void utils.purchasePackages.getById.invalidate({ id: packageId });
    void utils.purchasePackages.submissions.invalidate({ packageId });
    // «بانتظار إجرائي» للمندوب يعتمد الآن على حالة الصنف الفعلية، لذلك
    // نحدّث قائمتي الأصناف/الإجراءات أيضًا بعد الحفظ أو الإرسال.
    void utils.purchaseOrders.pendingEstimateItems.invalidate();
    void utils.purchaseOrders.actionableForMe.invalidate();
  };

  const estimateMut = trpc.purchaseOrders.estimateCost.useMutation({
    onSuccess: () => {
      toast.success(t?.common?.save || t.workflow.purchase.saved);
      refreshPackage();
    },
    onError: (e: any) => toast.error(localizeApiError(e.message)),
  });

  // نفس وظيفة طلب مراجعة الصنف المستخدمة في شاشة الطلب المفرد؛ لا مسار جديد.
  const requestItemRevisionMut = trpc.purchaseOrders.requestItemRevision.useMutation({
    onSuccess: () => {
      toast.success(t?.purchaseOrders?.itemRevisionRequested || t.workflow.purchase.reviewRequestSent);
      setSelectedRevisionItemId(null);
      setItemRevisionReason("");
      refreshPackage();
    },
    onError: (e: any) => toast.error(localizeApiError(e.message)),
  });

  // نفس وظيفة تغيير المندوب الحالية في PurchaseOrderDetail.
  const requestDelegateChangeMut = trpc.purchaseOrders.requestDelegateChange.useMutation({
    onSuccess: () => {
      toast.success(t.workflow.purchase.delegateChangeSent);
      setDelegateChangeDialogItem(null);
      setDelegateChangeReason("");
      refreshPackage();
    },
    onError: (e: any) => toast.error(localizeApiError(e.message)),
  });

  const submitPackageBatchMut = trpc.purchasePackages.submitPackageBatch.useMutation({
    onSuccess: (res: any) => {
      toast.success(t.workflow.purchase.batchSentSuccess.replace("{number}", res.submissionNumber).replace("{count}", String(res.sent.length)));
      if (res.skipped?.length > 0) {
        toast.info(t.workflow.purchase.skippedOrders.replace("{count}", String(res.skipped.length)));
      }
      if (res.pricingDocumentArchived === false) {
        toast.warning(t.workflow.purchase.packagePricingDocumentWarning);
      }
      void utils.attachments.listByType.invalidate({ entityType: "delegate_pricing_documents" });
    },
    onError: (e: any) => toast.error(localizeApiError(e.message)),
    // لا نعتمد على onSuccess وحده لتحديث الزر؛ إذا تم الإرسال فعليًا ثم
    // فشلت خطوة لاحقة، نعيد قراءة الحزمة وتختفي إمكانية الإرسال القديمة.
    onSettled: () => refreshPackage(),
  });

  if (isLoading) {
    return (
      <div className="space-y-4 p-4">
        <Skeleton className="h-40 w-full rounded-2xl" />
        {Array.from({ length: 2 }).map((_, i) => (
          <Skeleton key={i} className="h-96 w-full rounded-2xl" />
        ))}
      </div>
    );
  }

  if (!pkg) {
    return (
      <Card>
        <CardContent className="p-12 text-center text-muted-foreground">
          {t.workflow.purchase.packageNotFound}
        </CardContent>
      </Card>
    );
  }

  const orders = (pkg as any).orders ?? [];
  const totalItems = orders.reduce((sum: number, o: any) => sum + (o.items?.length ?? 0), 0);
  const creator = (users as any[]).find((u: any) => u.id === (pkg as any).createdById);

  const isMyItem = (item: any) =>
    isAdminOrOwner || (isDelegate && item.delegateId === user?.id);

  const readyToSubmitCount = orders.reduce(
    (sum: number, po: any) =>
      sum +
      (po.items ?? []).filter(
        (i: any) =>
          isMyItem(i) &&
          i.status === "estimated" &&
          !i.batchId &&
          !i.delegateChangeRequestedAt
      ).length,
    0
  );

  const readyOrderCount = orders.filter((po: any) =>
    (po.items ?? []).some(
      (i: any) =>
        isMyItem(i) &&
        i.status === "estimated" &&
        !i.batchId &&
        !i.delegateChangeRequestedAt
    )
  ).length;

  return (
    <div className="space-y-5 max-w-6xl mx-auto" dir={language === "en" ? "ltr" : "rtl"}>
      {/* رأس دفعة الطلبات — عرض فقط، ولا يحمل حالة Workflow مستقلة. */}
      <Card className="overflow-hidden border-slate-200 shadow-sm rounded-2xl">
        <CardContent className="p-0">
          <div className="flex flex-col lg:flex-row lg:items-stretch">
            <div className="flex-1 p-5 sm:p-6 flex items-start gap-4">
              <div className="h-20 w-20 shrink-0 rounded-2xl border border-sky-100 bg-sky-50 flex items-center justify-center">
                <Inbox className="w-10 h-10 text-sky-700" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h1 className="text-xl sm:text-2xl font-bold">{t.workflow.purchase.containerPackageBatch}</h1>
                    <div className="font-mono text-lg sm:text-xl font-bold text-sky-700 mt-1">
                      {(pkg as any).packageNumber}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="shrink-0"
                    onClick={() => setLocation("/purchase-orders")}
                    aria-label={t.workflow.purchase.back}
                  >
                    <ArrowRight className={`w-5 h-5 ${dir === "ltr" ? "rotate-180" : ""}`} />
                  </Button>
                </div>
                <p className="text-sm text-muted-foreground mt-2">
                  {t.workflow.purchase.packageContainsOrders.replace("{count}", String(orders.length))} · {totalItems} {t.workflow.purchase.itemCount}
                </p>
                {(pkg as any).notes && (
                  <p className="text-xs text-muted-foreground mt-2 bg-muted/40 rounded-lg px-3 py-2">
                    {packageTranslations.notes || (pkg as any).notes}
                  </p>
                )}
              </div>
            </div>

            <div className="border-t lg:border-t-0 lg:border-s px-5 py-4 lg:w-[300px] grid grid-cols-1 gap-3 content-center bg-muted/10">
              <div className="flex items-center gap-3 text-sm">
                <CalendarDays className="w-4 h-4 text-muted-foreground" />
                <div>
                  <div className="text-xs text-muted-foreground">{t.workflow.purchase.packageCreatedDate}</div>
                  <div className="font-semibold">{new Date((pkg as any).createdAt).toLocaleDateString(locale)}</div>
                </div>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <User className="w-4 h-4 text-muted-foreground" />
                <div>
                  <div className="text-xs text-muted-foreground">{t.workflow.purchase.createdBy}</div>
                  <div className="font-semibold">{creator?.name || creator?.username || t.workflow.purchase.userFallback.replace("{id}", String((pkg as any).createdById))}</div>
                </div>
              </div>
            </div>

            {isDelegate && readyToSubmitCount > 0 && (
              <div className="border-t lg:border-t-0 lg:border-s p-5 lg:w-[260px] flex flex-col justify-center gap-2">
                <Button
                  className="h-12 bg-emerald-700 hover:bg-emerald-800 gap-2 text-base transition-transform duration-100 ease-out active:scale-[0.97] active:translate-y-px"
                  onClick={() => submitPackageBatchMut.mutate({ packageId })}
                  disabled={submitPackageBatchMut.isPending}
                >
                  {submitPackageBatchMut.isPending ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <Send className="w-5 h-5" />
                  )}
                  {t.workflow.purchase.sendAccounting}
                </Button>
                <div className="text-[11px] text-center text-muted-foreground">
                  {t.workflow.purchase.readyOrderSummary.replace("{items}", String(readyToSubmitCount)).replace("{orders}", String(readyOrderCount))}
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {isDelegate && !isDelegatePricingActionView ? (
        <>
          {/* [PB-DELEGATE-SUMMARY 2026-08-31]
              {t.workflow.purchase.packageSummaryOnly}
              لا تغيير هنا لأي حالة Workflow أو لأي استدعاء تشغيلي. */}
          <Card className="rounded-2xl border-slate-200 shadow-sm overflow-hidden">
            <CardContent className="p-4 sm:p-5 space-y-3">
              <div className="flex items-center justify-between gap-3 flex-wrap pb-2 border-b">
                <div>
                  <h2 className="font-bold text-base">{t.workflow.purchase.ordersInsideBatch}</h2>
                  <p className="text-xs text-muted-foreground mt-1">
                    {t.workflow.purchase.openOrderForItemsHelp}
                  </p>
                </div>
                <Badge variant="secondary" className="text-xs">
                  {t.workflow.purchase.orderCountShort.replace("{count}", String(orders.length))}
                </Badge>
              </div>

              <div className="space-y-2">
                {orders.map((po: any) => {
                  const requestedBy = (users as any[]).find((u: any) => u.id === po.requestedById);
                  const delegateItems = (po.items ?? []).filter((item: any) => item.delegateId === user?.id);
                  const estimatedTotal = delegateItems.reduce(
                    (sum: number, item: any) => sum + Number(item.estimatedTotalCost || 0),
                    0
                  );

                  return (
                    <button
                      type="button"
                      key={po.id}
                      className="w-full text-start rounded-xl border bg-muted/20 hover:bg-muted/50 transition-colors px-3.5 py-3"
                      onClick={() => setLocation(`/purchase-orders/${po.id}`)}
                    >
                      <div className="flex items-center justify-between gap-3 flex-wrap">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono text-sm font-semibold text-sky-800">{po.poNumber}</span>
                            <Badge className={PO_STATUS_COLORS[po.status] || "bg-gray-100 text-gray-700"}>
                              {getPOStatusLabel(po.status)}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-x-4 gap-y-1 flex-wrap text-xs text-muted-foreground mt-2">
                            <span>{delegateItems.length} {t.workflow.purchase.itemCount}</span>
                            {requestedBy && <span>{t.workflow.purchase.requesterColon} {requestedBy.name || requestedBy.username}</span>}
                            <span>
                              {t.workflow.purchase.totalColon} {estimatedTotal.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {currency}
                            </span>
                          </div>
                        </div>
                        <ArrowRight className={`w-4 h-4 text-muted-foreground shrink-0 ${dir === "rtl" ? "rotate-180" : ""}`} />
                      </div>
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* نحافظ على وظيفة تصدير PDF للمندوب بدون إعادة عرض تفاصيل
              الطلبات/الأصناف داخل دفعات الإرسال مرة ثانية. */}
          <DelegateSubmissionExports packageId={packageId} packageNumber={(pkg as any).packageNumber} />
        </>
      ) : (
        <>
      {/* عند دخول الحسابات/الإدارة من «بانتظار إجرائي» نعرض دفعة الإرسال
          المحددة فقط في القسم أدناه، ولا نخلط معها كل أصناف الحزمة. */}
      {!isPackageSubmissionFocusView && (
      <>
      {/* الطلبات داخل الحزمة — الخط الجانبي بصري فقط ولا يمثل علاقة بيانات جديدة. */}
      <div className={`relative space-y-5 ${dir === "rtl" ? "md:pl-14" : "md:pr-14"}`}>
        <div className={`hidden md:block absolute top-0 bottom-0 border-dashed border-sky-600/60 ${dir === "rtl" ? "left-5 border-l" : "right-5 border-r"}`} />

        {orders.map((po: any) => {
          const requestedBy = (users as any[]).find((u: any) => u.id === po.requestedById);
          const poItems = po.items ?? [];
          // في دخول المندوب من «بانتظار إجرائي» نعرض فقط عمل التسعير الحالي:
          // pending غير مسعّر + estimated محفوظ ولم يُرسل. أي صنف دخل دفعة
          // إرسال سابقة لا يظهر هنا مرة أخرى حتى لا يختلط بالتسعير المتبقي.
          const displayItems = isDelegate
            ? poItems.filter((item: any) =>
                item.delegateId === user?.id &&
                (
                  !isDelegatePricingActionView ||
                  (
                    !item.batchId &&
                    !item.delegateChangeRequestedAt &&
                    ["pending", "estimated"].includes(item.status)
                  )
                )
              )
            : poItems;
          if (isDelegatePricingActionView && displayItems.length === 0) return null;
          const myItems = displayItems.filter((item: any) => isMyItem(item));
          const orderReadyCount = myItems.filter(
            (item: any) => item.status === "estimated" && !item.batchId && !item.delegateChangeRequestedAt
          ).length;
          const orderAwaitingPricing = myItems.filter(
            (item: any) => item.status === "pending" && !item.batchId && !item.delegateChangeRequestedAt
          ).length;
          const orderEstimatedTotal = displayItems.reduce(
            (sum: number, item: any) => sum + Number(item.estimatedTotalCost || 0),
            0
          );
          const workflowIndex = currentWorkflowIndex(po.status);
          const hasRevisionAttention = displayItems.some(
            (item: any) => item.status === "needs_item_revision" || !!item.delegateChangeRequestedAt
          );

          return (
            <div key={po.id} className="relative">
              <div className="hidden md:flex absolute -left-[43px] top-14 items-center">
                <span className="h-4 w-4 rounded-full bg-background border-2 border-sky-700" />
                <span className="w-7 border-t border-sky-700/70" />
              </div>

              <Card className="rounded-2xl border-slate-200 shadow-sm overflow-hidden">
                <CardContent className="p-4 sm:p-5 space-y-4">
                  {/* رأس طلب الشراء داخل الدفعة */}
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-xs sm:text-sm text-muted-foreground">{po.poNumber}</span>
                        <Badge className={PO_STATUS_COLORS[po.status] || "bg-gray-100 text-gray-700"}>
                          {getPOStatusLabel(po.status)}
                        </Badge>
                      </div>
                      <h2 className="text-lg font-bold">{t.workflow.purchase.purchaseOrdersManagement}</h2>
                    </div>

                    <div className="flex items-center gap-2">
                      {hasRevisionAttention && (
                        <Badge variant="outline" className="border-rose-200 text-rose-700 bg-rose-50">
                          {t.workflow.purchase.needsFollowup}
                        </Badge>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setLocation(`/purchase-orders/${po.id}`)}
                        aria-label={t.workflow.purchase.openOrderAria.replace("{number}", po.poNumber)}
                      >
                        <ArrowRight className={`w-5 h-5 ${dir === "rtl" ? "rotate-180" : ""}`} />
                      </Button>
                    </div>
                  </div>

                  {/* شريط مراحل الطلب — يقرأ حالة PO فقط ولا يكتب أي حالة. */}
                  <div className="border rounded-xl p-3 overflow-x-auto">
                    <div className="flex items-center min-w-[760px]">
                      {WORKFLOW_KEYS.map((key, index) => {
                        const isDone = workflowIndex > index || (workflowIndex === 7 && index === 7);
                        const isCurrent = workflowIndex === index;
                        return (
                          <div key={key} className="contents">
                            <div className="flex items-center gap-1.5 shrink-0">
                              <span
                                className={`h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-bold border ${
                                  isDone
                                    ? "bg-sky-100 text-sky-800 border-sky-200"
                                    : isCurrent
                                      ? "bg-sky-700 text-white border-sky-700"
                                      : "bg-muted text-muted-foreground border-muted"
                                }`}
                              >
                                {isDone ? <CheckCircle2 className="w-3.5 h-3.5" /> : index + 1}
                              </span>
                              <span className={`text-[10px] whitespace-nowrap ${isCurrent ? "font-bold text-sky-800" : "text-muted-foreground"}`}>
                                {getPOStatusLabel(key)}
                              </span>
                            </div>
                            {index < WORKFLOW_KEYS.length - 1 && (
                              <div className={`h-px flex-1 min-w-5 mx-2 ${workflowIndex > index ? "bg-sky-300" : "bg-border"}`} />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* بيانات مختصرة — نفس المعلومات الموجودة أصلًا بالطلب دون اشتقاق Workflow جديد. */}
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
                    <div className="border rounded-xl p-3 min-h-[78px] flex items-center gap-3">
                      <User className="w-5 h-5 text-muted-foreground shrink-0" />
                      <div className="min-w-0">
                        <div className="text-[11px] text-muted-foreground">{t.workflow.purchase.requester}</div>
                        <div className="text-sm font-semibold truncate">{requestedBy?.name || requestedBy?.username || t.workflow.purchase.userFallback.replace("{id}", String(po.requestedById))}</div>
                      </div>
                    </div>
                    <div className="border rounded-xl p-3 min-h-[78px] flex items-center gap-3">
                      <CalendarDays className="w-5 h-5 text-muted-foreground shrink-0" />
                      <div>
                        <div className="text-[11px] text-muted-foreground">{t.workflow.purchase.requestDate}</div>
                        <div className="text-sm font-semibold">{formatPurchaseSubmissionTime(po, locale)}</div>
                      </div>
                    </div>
                    <div className="border rounded-xl p-3 min-h-[78px] flex items-center gap-3">
                      <DollarSign className="w-5 h-5 text-muted-foreground shrink-0" />
                      <div>
                        <div className="text-[11px] text-muted-foreground">{t.workflow.purchase.currencyLabel}</div>
                        <div className="text-sm font-semibold">{currency}</div>
                      </div>
                    </div>
                    <div className="border rounded-xl p-3 min-h-[78px] flex items-center gap-3">
                      <ShoppingCart className="w-5 h-5 text-muted-foreground shrink-0" />
                      <div>
                        <div className="text-[11px] text-muted-foreground">{t.workflow.purchase.readyToSendShort}</div>
                        <div className="text-sm font-semibold">{t.workflow.purchase.readyCount.replace("{count}", String(orderReadyCount))} · {orderAwaitingPricing} {t.workflow.purchase.waitingPricing}</div>
                      </div>
                    </div>
                  </div>

                  {/* الأصناف — جميع إجراءات المندوب تبقى على مستوى الصنف. */}
                  <div className="border rounded-xl p-3 sm:p-4 space-y-3">
                    <div className="flex items-center gap-2 font-semibold text-sm">
                      <ShoppingCart className="w-4 h-4" />
                      {t.workflow.purchase.itemsLabel}
                    </div>

                    {displayItems.map((item: any) => {
                      const delegate = (users as any[]).find((u: any) => u.id === item.delegateId);
                      const itemBelongsToMe = isMyItem(item);
                      const isCancelled = item.status === "cancelled" || item.status === "purchase_cancelled";
                      const availableDays = getAvailableCalendarDays(item.requiredDate, item.delegateAssignedAt);

                      return (
                        <div
                          key={item.id}
                          className={`border rounded-xl p-3.5 space-y-3 ${
                            isCancelled ? "opacity-60 bg-gray-50 border-gray-200" : "bg-background"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <h3 className={`font-semibold text-sm ${isCancelled ? "line-through text-gray-400" : ""}`}>
                                  {displayItemName(item)}
                                </h3>
                                <Badge className={`text-[10px] ${ITEM_STATUS_COLORS[item.status] || "bg-gray-100 text-gray-700"}`}>
                                  {getPOItemStatusLabel(item.status)}
                                </Badge>
                              </div>
                              {displayItemDescription(item) && getLocalizedItemField(item, "itemName", language) && (
                                <p className="text-xs text-muted-foreground mt-1">{displayItemDescription(item)}</p>
                              )}
                              <div className="flex gap-x-4 gap-y-1 flex-wrap text-xs text-muted-foreground mt-2">
                                <span>{t.workflow.purchase.quantityLabel} <strong>{item.quantity} {displayUnit(item.unit)}</strong></span>
                                {delegate && <span>{t.workflow.purchase.delegateLabelColon} <strong>{delegate.name || delegate.username}</strong></span>}
                                {item.requiredDate && <span>{t.purchaseOrders.requiredDate}: <strong>{formatDateOnly(item.requiredDate, locale)}</strong></span>}
                                {item.delegateAssignedAt && <span>{t.purchaseOrders.delegateAssignedDate}: <strong>{formatDateOnly(item.delegateAssignedAt, locale)}</strong></span>}
                                {availableDays != null && <span className={availableDays < 0 ? "text-red-600" : ""}>{t.purchaseOrders.availableDuration}: <strong>{formatAvailableDuration(availableDays, language)}</strong></span>}
                              </div>
                            </div>
                          </div>

                          {item.delegateChangeRequestedAt && (
                            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-900 space-y-1">
                              <div className="font-semibold">{t.workflow.purchase.delegateChangePending}</div>
                              <div>{t.workflow.purchase.reasonColon} {workflowItemField(item, "delegateChangeReason") || t.workflow.purchase.reasonNotProvided}</div>
                            </div>
                          )}

                          {item.status === "needs_item_revision" && (
                            <div className="bg-rose-50 border border-rose-200 rounded-lg p-3 text-xs text-rose-900 space-y-1">
                              <div className="font-semibold">{t.workflow.purchase.needsReview}</div>
                              {item.itemRevisionNote && <div>{t.workflow.purchase.reasonColon} {workflowItemField(item, "itemRevisionNote")}</div>}
                            </div>
                          )}

                          {itemBelongsToMe && item.status === "estimated" && !item.batchId && (
                            <div className="bg-teal-50 border border-teal-200 rounded-lg p-2.5 flex items-center justify-between gap-2">
                              <p className="text-xs text-teal-800 flex items-center gap-1.5">
                                <CheckCircle2 className="w-3.5 h-3.5" /> {t.workflow.purchase.pricedWaitingAccounting}
                              </p>
                              <span className="text-xs font-bold text-teal-700">
                                {Number(item.estimatedTotalCost || 0).toLocaleString(locale)} {currency}
                              </span>
                            </div>
                          )}

                          {itemBelongsToMe && item.status === "pending" && !item.batchId && !item.delegateChangeRequestedAt && (
                            <div className="bg-amber-50/70 border border-amber-200 rounded-xl p-3 space-y-2">
                              <ExternalWorkshopPricingFields item={item} idPrefix={`external-batch-${item.id}`} value={externalWorkshopForm(item, workshopDrafts[item.id])} onChange={value => setWorkshopDrafts(previous => ({ ...previous, [item.id]: value }))} disabled={estimateMut.isPending} />
                              <p className="text-xs font-semibold text-amber-900 flex items-center gap-1.5">
                                <DollarSign className="w-3.5 h-3.5" /> {t.workflow.purchase.estimatedUnitCost}
                              </p>
                              <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
                                <div className="flex-1 space-y-1">
                                  <Label className="text-[11px] text-amber-700">
                                    {t.workflow.purchase.estimatedUnitCostCurrency.replace("{currency}", currency)}
                                  </Label>
                                  <Input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    placeholder="0.00"
                                    value={estimates[item.id] || ""}
                                    onChange={(e) => setEstimates((prev) => ({ ...prev, [item.id]: e.target.value }))}
                                    className="bg-white"
                                  />
                                </div>
                                {estimates[item.id] && parseFloat(estimates[item.id]) > 0 && (
                                  <div className="text-xs text-amber-800 sm:pb-2 whitespace-nowrap">
                                    {t.workflow.purchase.total} {(parseFloat(estimates[item.id]) * item.quantity).toLocaleString(locale)} {currency}
                                  </div>
                                )}
                                <div className="flex gap-2 flex-wrap">
                                  <Button
                                    size="sm"
                                    onClick={() => {
                                      if (!estimates[item.id] || parseFloat(estimates[item.id]) <= 0) {
                                        toast.error(t.workflow.purchase.enterValidPrice);
                                        return;
                                      }
                                      const workshopIssue = externalWorkshopIssue(item, workshopDrafts[item.id]);
                                      if (workshopIssue) { toast.error(externalMaintenanceLabels(language)[workshopIssue]); return; }
                                      estimateMut.mutate({
                                        purchaseOrderId: po.id,
                                        items: [{ id: item.id, estimatedUnitCost: estimates[item.id], ...externalWorkshopPayload(item, workshopDrafts[item.id]) }],
                                      });
                                    }}
                                    disabled={estimateMut.isPending || !!externalWorkshopIssue(item, workshopDrafts[item.id])}
                                  >
                                    {estimateMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : t.workflow.purchase.save}
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => {
                                      setSelectedRevisionItemId(item.id);
                                      setItemRevisionReason("");
                                    }}
                                  >
                                    {t.workflow.purchase.requestReview}
                                  </Button>
                                  {isDelegate && item.delegateId === user?.id && !item.estimatedUnitCost && (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() => {
                                        setDelegateChangeDialogItem(item);
                                        setDelegateChangeReason("");
                                      }}
                                    >
                                      {t.workflow.purchase.reassignDelegate}
                                    </Button>
                                  )}
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <div className="rounded-xl border bg-slate-50/80 px-4 py-3 flex items-center justify-between gap-4">
                    <span className="font-semibold text-sm">{t.workflow.purchase.estimatedTotalCost}</span>
                    <span className="font-bold text-lg" dir="ltr">
                      {orderEstimatedTotal.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {currency}
                    </span>
                  </div>
                </CardContent>
              </Card>
            </div>
          );
        })}
      </div>
      </>
      )}

      {/* في دخول المندوب من «بانتظار إجرائي» نعرض التسعير فقط ولا نكرر
          تاريخ دفعات الإرسال أسفل نفس الشاشة. الحسابات والإدارة تبقيان عليه. */}
      {!isDelegate && (
        <PackageSubmissions
          packageId={packageId}
          packageNumber={(pkg as any).packageNumber}
          focusedSubmissionId={isPackageSubmissionFocusView ? focusedSubmissionId : undefined}
        />
      )}
        </>
      )}

      <Dialog
        open={selectedRevisionItemId !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedRevisionItemId(null);
            setItemRevisionReason("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.workflow.purchase.itemReviewRequest}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">{t.workflow.purchase.itemReviewHelp}</p>
            <div className="space-y-2">
              <Label>{t.workflow.purchase.reviewReasonRequired}</Label>
              <Textarea
                value={itemRevisionReason}
                onChange={(e) => setItemRevisionReason(e.target.value)}
                placeholder={t?.purchaseOrders?.revisionNoteExample || t.workflow.purchase.enterReviewReason}
                rows={4}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedRevisionItemId(null)}>{t.workflow.purchase.cancel}</Button>
            <Button
              variant="destructive"
              disabled={itemRevisionReason.trim().length < 5 || requestItemRevisionMut.isPending || !selectedRevisionItemId}
              onClick={() => {
                if (!selectedRevisionItemId) return;
                requestItemRevisionMut.mutate({
                  itemId: selectedRevisionItemId,
                  note: itemRevisionReason.trim(),
                });
              }}
            >
              {requestItemRevisionMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : t.workflow.purchase.sendReviewRequest}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!delegateChangeDialogItem}
        onOpenChange={(open) => {
          if (!open) {
            setDelegateChangeDialogItem(null);
            setDelegateChangeReason("");
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t.workflow.purchase.delegateChangeRequest}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              {t.workflow.purchase.pricingPausedDelegate}
            </p>
            <div className="rounded-lg bg-muted/40 border p-2 text-sm">
              {t.workflow.purchase.itemColon} <strong>{delegateChangeDialogItem?.itemName}</strong>
            </div>
            <div className="space-y-2">
              <Label>{t.workflow.purchase.delegateChangeReason}</Label>
              <Textarea
                value={delegateChangeReason}
                onChange={(e) => setDelegateChangeReason(e.target.value)}
                placeholder={t.workflow.purchase.delegateChangePlaceholder}
                rows={4}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDelegateChangeDialogItem(null)}>{t.workflow.purchase.cancel}</Button>
            <Button
              disabled={delegateChangeReason.trim().length < 5 || requestDelegateChangeMut.isPending}
              onClick={() => {
                if (!delegateChangeDialogItem) return;
                requestDelegateChangeMut.mutate({
                  itemId: delegateChangeDialogItem.id,
                  reason: delegateChangeReason.trim(),
                });
              }}
            >
              {requestDelegateChangeMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              {t.workflow.purchase.sendRequest}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * [PB-DELEGATE-SUMMARY] يحافظ على تصدير PDF للمندوب من دون تكرار
 * تفاصيل الطلبات والأصناف داخل صفحة الحزمة. عرض فقط؛ لا يكتب أي حالة.
 */
function DelegateSubmissionExports({ packageId, packageNumber }: { packageId: number; packageNumber: string }) {
  const { t } = useTranslation();
  const { data: submissions = [], isLoading } = trpc.purchasePackages.submissions.useQuery(
    { packageId },
    { enabled: Number.isFinite(packageId) }
  );

  if (isLoading || submissions.length === 0) return null;

  return (
    <Card className="rounded-2xl border-slate-200 shadow-sm">
      <CardContent className="p-4 sm:p-5 space-y-3">
        <div>
          <h2 className="font-semibold text-sm">{t.workflow.purchase.dispatchFiles}</h2>
          <p className="text-xs text-muted-foreground mt-1">
            {t.workflow.purchase.dispatchExportOnly}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {submissions.map((sub: any) => {
            const firstBatch = sub.batches?.[0];
            if (!firstBatch) return null;
            return (
              <Button
                key={sub.id}
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={() =>
                  window.open(
                    `/api/export/po/${firstBatch.purchaseOrderId}/pdf?submissionId=${sub.id}`,
                    "_blank"
                  )
                }
              >
                <FileDown className="w-3.5 h-3.5" />
                {t.workflow.purchase.export} {packageNumber}-{sub.subNumber}
              </Button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * [PB] قسم الدفعات الفرعية (PB01-1، PB01-2...).
 *
 * [PB-ACC/MGMT 2026-08-31] الحسابات والإدارة العليا تعتمدان **دفعة
 * الإرسال** كوحدة واحدة في مسار الحزم. حقل العهدة واحد على مستوى الإرسال.
 * رفض الإدارة يبقى زرًا على مستوى الصنف، لكنه يُطبّق ذريًا مع اعتماد
 * الإرسال حتى لا تنشأ حالة جزئية. مسارات الطلب المفرد القديمة لم تتغير.
 */
export function PackageSubmissions({
  packageId,
  packageNumber,
  focusedSubmissionId,
}: {
  packageId: number;
  packageNumber: string;
  focusedSubmissionId?: number;
}) {
  const { t, language } = useTranslation();
  const locale = language === "ar" ? "ar-SA" : language === "ur" ? "ur-PK" : "en-US";
  const currency = t?.common?.currency || "SAR";
  const { data: catalogUnits = [] } = trpc.catalog.units.list.useQuery();
  const displayUnit = (value: string | null | undefined) =>
    getLocalizedCatalogUnitName(value, catalogUnits as any[], language);
  const displayItemName = (item: any) =>
    getLocalizedItemField(item, "itemName", language) ||
    getLocalizedItemField(item, "description", language) ||
    t.workflow.purchase.itemFallback.replace("{id}", String(item?.id ?? ""));
  const displayItemDescription = (item: any) =>
    getLocalizedItemField(item, "description", language);
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const [custodyBalance, setCustodyBalance] = useState<Record<number, string>>({});
  const [approvingSubmission, setApprovingSubmission] = useState<number | null>(null);
  const [rejectItemDialog, setRejectItemDialog] = useState<{
    itemId: number;
    itemName: string;
    mode: "accounting" | "management";
    submissionId?: number;
  } | null>(null);
  const [rejectItemReason, setRejectItemReason] = useState("");
  const [managementRejections, setManagementRejections] = useState<Record<number, { submissionId: number; reason: string }>>({});
  // [PB-MGMT-UI 2026-08-31] سبب رفض الإدارة يُكتب داخل بطاقة الصنف نفسها،
  // بدون نافذة مستقلة، مع إبقاء نفس اعتماد الدفعة ونفس بيانات الرفض الحالية.
  const [managementRejectEditor, setManagementRejectEditor] = useState<{
    itemId: number;
    submissionId: number;
    reason: string;
  } | null>(null);
  const REJECT_ITEM_MIN_LENGTH = 10;

  const { data: submissions = [], isLoading } = trpc.purchasePackages.submissions.useQuery(
    { packageId },
    { enabled: Number.isFinite(packageId) }
  );

  const approveSubmissionMut = trpc.purchasePackages.approveAccountingSubmission.useMutation({
    onSuccess: (result: any) => {
      toast.success(t.workflow.purchase.accountingApprovedSentManagement.replace("{number}", result.submissionNumber));
      if (result.financialDocumentArchived === false) {
        toast.warning(t.workflow.purchase.dispatchFinancialWarning);
      }
      void utils.attachments.listByType.invalidate({ entityType: "po_financial_batch" });
    },
    onError: (e: any) => toast.error(localizeApiError(e.message)),
    // إعادة جلب الحالة في الحالتين تمنع بقاء بطاقة «بانتظار الحسابات»
    // إذا نجح الاعتماد في قاعدة البيانات ثم أخفقت خطوة لاحقة غير حرجة.
    onSettled: () => {
      void utils.purchasePackages.submissions.invalidate({ packageId });
      void utils.purchasePackages.getById.invalidate({ id: packageId });
      void utils.attachments.listByType.invalidate({ entityType: "po_financial_batch" });
    },
  });

  const approveManagementSubmissionMut = trpc.purchasePackages.approveManagementSubmission.useMutation({
    onSuccess: (result: any) => {
      toast.success(
        result.status === "rejected"
          ? t.workflow.purchase.managementAllRejected.replace("{number}", result.submissionNumber)
          : t.workflow.purchase.managementApprovedSubmission.replace("{number}", result.submissionNumber)
      );
      setManagementRejections((prev) =>
        Object.fromEntries(
          Object.entries(prev).filter(([, value]) => value.submissionId !== result.submissionId)
        )
      );
      setManagementRejectEditor((current) =>
        current?.submissionId === result.submissionId ? null : current
      );
      utils.purchasePackages.submissions.invalidate({ packageId });
      utils.purchasePackages.getById.invalidate({ id: packageId });
    },
    onError: (e: any) => toast.error(localizeApiError(e.message)),
  });

  // نفس إجراء رفض الصنف الفوري الموجود في شاشة طلب الشراء المفرد.
  const rejectAccountingItemMut = trpc.purchaseOrders.rejectAccountingBatchItem.useMutation({
    onSuccess: (result: any) => {
      toast.success(
        result?.batchNowClosed
          ? t.workflow.purchase.pricingBatchRejectedNoActive
          : t.workflow.purchase.itemRejectedShort
      );
      setRejectItemDialog(null);
      setRejectItemReason("");
      utils.purchasePackages.submissions.invalidate({ packageId });
      utils.purchasePackages.getById.invalidate({ id: packageId });
    },
    onError: (e: any) => toast.error(localizeApiError(e.message)),
  });

  const isAccountant = user?.role === "accountant" || ["owner", "admin"].includes(user?.role || "");
  const isManagementApprover = user?.role === "senior_management" || ["owner", "admin"].includes(user?.role || "");
  const isManagementViewer = isManagementApprover || user?.role === "executive_director";
  const isDelegate = isDelegateRole(user?.role);

  if (isLoading || submissions.length === 0) return null;

  const visibleSubmissions = focusedSubmissionId
    ? (submissions as any[]).filter((sub: any) => Number(sub.id) === focusedSubmissionId)
    : submissions;

  const approveSubmission = async (sub: any) => {
    const value = parseFloat(custodyBalance[sub.id] || "");
    if (!(value > 0)) {
      toast.error(t.workflow.purchase.enterCustodyBalance);
      return;
    }

    setApprovingSubmission(sub.id);
    try {
      await approveSubmissionMut.mutateAsync({
        submissionId: sub.id,
        custodyBalance: value.toFixed(2),
      });
    } finally {
      setApprovingSubmission(null);
    }
  };

  const approveManagementSubmission = async (sub: any) => {
    const rejections = Object.entries(managementRejections)
      .filter(([, value]) => value.submissionId === sub.id)
      .map(([itemId, value]) => ({ itemId: Number(itemId), reason: value.reason }));

    setApprovingSubmission(sub.id);
    try {
      await approveManagementSubmissionMut.mutateAsync({
        submissionId: sub.id,
        rejections: rejections.length > 0 ? rejections : undefined,
      });
    } finally {
      setApprovingSubmission(null);
    }
  };

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold text-muted-foreground">{t.workflow.purchase.dispatchBatches}</h2>
      {visibleSubmissions.length === 0 && focusedSubmissionId ? (
        <Card className="border-amber-200 bg-amber-50/40">
          <CardContent className="p-4 text-sm text-amber-900">
            {t.workflow.purchase.selectedDispatchUnavailable}
          </CardContent>
        </Card>
      ) : null}
      {visibleSubmissions.map((sub: any) => {
        const pendingCount = (sub.batches ?? []).filter((b: any) => b.status === "pending_accounting").length;
        const hasConflictingStatus = (sub.batches ?? []).some(
          (b: any) => !["pending_accounting", "rejected"].includes(b.status)
        );
        const canApproveSubmission = pendingCount > 0 && !hasConflictingStatus;
        const pendingManagementCount = (sub.batches ?? []).filter((b: any) => b.status === "pending_management").length;
        const hasManagementConflictingStatus = (sub.batches ?? []).some(
          (b: any) => !["pending_management", "rejected"].includes(b.status)
        );
        const canApproveManagementSubmission =
          sub.status === "pending_management" &&
          pendingManagementCount > 0 &&
          !hasManagementConflictingStatus;
        const managementRejectedCount = Object.values(managementRejections).filter(
          (value) => value.submissionId === sub.id
        ).length;
        const total = (sub.batches ?? []).reduce((sum: number, b: any) => {
          const activeItems = (b.items ?? []).filter((item: any) => !["cancelled", "rejected"].includes(item.status));
          if (activeItems.length > 0) {
            return sum + activeItems.reduce(
              (itemSum: number, item: any) => itemSum + Number(item.estimatedTotalCost || 0),
              0
            );
          }
          return sum;
        }, 0);
        const firstBatch = sub.batches?.[0];

        return (
          <Card key={sub.id} className="border-orange-200">
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between gap-3 flex-wrap pb-2 border-b">
                <div className="flex items-center gap-2 flex-wrap">
                  <Send className="w-4 h-4 text-orange-600" />
                  <span className="font-mono font-semibold text-sm">
                    {t.workflow.purchase.batchWord} {packageNumber}-{sub.subNumber}
                  </span>
                  <Badge variant="secondary" className="text-[10px]">
                    {t.workflow.purchase.orderCountShort.replace("{count}", String(sub.batches?.length ?? 0))}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {t.workflow.purchase.totalColon} {total.toLocaleString(locale)} {currency}
                  </span>
                </div>
                <div className="flex gap-2 flex-wrap">
                  {/* [PB] نفس شرط PurchaseOrderDetail.tsx حرفيًا — زر التصدير
                      يظهر للمندوب والحسابات فقط، لا لكل من يفتح الصفحة. */}
                  {(isDelegate || isAccountant || user?.role === "senior_management") && firstBatch && canOpenApprovalPdf(user?.role, sub) && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5"
                      onClick={async () => {
                        try {
                          if (user?.role === "accountant" || user?.role === "senior_management") {
                            const permission = await utils.purchaseOrders.documentPermission.fetch({ poId: firstBatch.purchaseOrderId, submissionId: sub.id });
                            if (!canOpenApprovalPdf(user.role, permission)) { toast.error(approvalPdfNotice(language)); return; }
                          }
                          const response = await fetch(`/api/export/po/${firstBatch.purchaseOrderId}/pdf?submissionId=${sub.id}`, { credentials: "include" });
                          if (!response.ok) throw new Error(t.purchaseOrders.exportPdfFailed);
                          const url = URL.createObjectURL(await response.blob());
                          const anchor = document.createElement("a");
                          anchor.href = url; anchor.download = `${packageNumber}-${sub.subNumber}.pdf`; anchor.click();
                          setTimeout(() => URL.revokeObjectURL(url), 60000);
                        } catch (error: any) { toast.error(localizeApiError(error.message)); }
                      }}
                    >
                      <FileDown className="w-3.5 h-3.5" />
                      {t.workflow.purchase.exportBatchPdf}
                    </Button>
                  )}
                  {(user?.role === "accountant" || user?.role === "senior_management") && !canOpenApprovalPdf(user.role, sub) && <p className="text-xs text-muted-foreground self-center">{approvalPdfNotice(language)}</p>}
                  {isAccountant && canApproveSubmission && (
                    <Button
                      size="sm"
                      className="bg-orange-600 hover:bg-orange-700 gap-1.5"
                      disabled={approvingSubmission === sub.id || !(parseFloat(custodyBalance[sub.id] || "") > 0)}
                      onClick={() => approveSubmission(sub)}
                    >
                      {approvingSubmission === sub.id && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                      {t.workflow.purchase.approveSendManagement}
                    </Button>
                  )}
                  {isManagementApprover && canApproveManagementSubmission && (
                    <Button
                      size="sm"
                      className="bg-blue-600 hover:bg-blue-700 gap-1.5"
                      disabled={approvingSubmission === sub.id}
                      onClick={() => approveManagementSubmission(sub)}
                    >
                      {approvingSubmission === sub.id && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                      {managementRejectedCount > 0
                        ? t.workflow.purchase.approveWithRejected.replace("{count}", String(managementRejectedCount))
                        : t.workflow.purchase.approveBatch}
                    </Button>
                  )}
                </div>
              </div>

              {isAccountant && canApproveSubmission && (
                <div className="rounded-lg border border-orange-200 bg-orange-50/60 p-3">
                  <div className="flex items-end gap-3 flex-wrap">
                    <div className="space-y-1 flex-1 min-w-[220px]">
                      <Label className="text-xs font-medium text-orange-800">
                        {t.workflow.purchase.custodyBalanceRequired.replace("{currency}", currency)}
                      </Label>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="0.00"
                        value={custodyBalance[sub.id] || ""}
                        onChange={(e) =>
                          setCustodyBalance((prev) => ({ ...prev, [sub.id]: e.target.value }))
                        }
                        className="bg-white max-w-xs"
                      />
                    </div>
                    <div className="text-xs text-orange-800 pb-2">
                      {t.workflow.purchase.dispatchBatchValue} <strong>{total.toLocaleString(locale)} {currency}</strong>
                    </div>
                  </div>
                </div>
              )}

              {isAccountant && pendingCount > 0 && hasConflictingStatus && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                  {t.workflow.purchase.mixedBatchAccounting}
                </div>
              )}

              {isManagementViewer && pendingManagementCount > 0 && hasManagementConflictingStatus && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                  {t.workflow.purchase.mixedBatchManagement}
                </div>
              )}

              {!pendingCount && sub.custodyBalance && (isAccountant || isManagementViewer) && (
                <div className="rounded-lg border bg-muted/30 p-3 text-sm">
                  <span className="text-muted-foreground">{t.workflow.purchase.custodyBalanceColon} </span>
                  <strong>{Number(sub.custodyBalance).toLocaleString(locale)} {currency}</strong>
                </div>
              )}

              <div className="space-y-2">
                {(sub.batches ?? []).map((b: any) => (
                  <div key={b.id} className="rounded-md bg-muted/40 p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2 flex-wrap text-sm">
                        <span className="font-mono text-xs px-1.5 py-0.5 rounded bg-background border">
                          {b.poNumber}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {b.itemCount} {t.workflow.purchase.itemCountUnit} · {Number(b.totalEstimatedCost || 0).toLocaleString(locale)} {currency}
                        </span>
                      </div>
                      <Badge
                        className={
                          b.status === "approved" ? "bg-emerald-100 text-emerald-700" :
                          b.status === "rejected" ? "bg-red-100 text-red-700" :
                          b.status === "pending_management" ? "bg-blue-100 text-blue-700" :
                          "bg-orange-100 text-orange-700"
                        }
                      >
                        {b.status === "pending_accounting" ? t.workflow.purchase.statusPendingAccounting :
                         b.status === "pending_management" ? t.workflow.purchase.statusPendingManagement :
                         b.status === "approved" ? t.workflow.purchase.statusApprovedShort : t.workflow.purchase.statusRejectedShort}
                      </Badge>
                    </div>

                    {(b.items ?? []).length > 0 && (
                      <div className="space-y-1.5 pt-1">
                        {(b.items ?? []).map((item: any) => {
                          const availableDays = getAvailableCalendarDays(item.requiredDate, item.delegateAssignedAt);
                          const canRejectAccountingItem = isAccountant &&
                            b.status === "pending_accounting" &&
                            !["rejected", "cancelled"].includes(item.status);
                          const canRejectManagementItem = isManagementApprover &&
                            canApproveManagementSubmission &&
                            b.status === "pending_management" &&
                            !["rejected", "cancelled"].includes(item.status);
                          const managementRejection = managementRejections[item.id];
                          const isMarkedForManagementRejection =
                            managementRejection?.submissionId === sub.id;
                          const isEditingManagementRejection =
                            managementRejectEditor?.itemId === item.id &&
                            managementRejectEditor?.submissionId === sub.id;
                          return (
                            <div
                              key={item.id}
                              className="rounded-md border bg-background px-3 py-2 space-y-2"
                            >
                              <div className="flex items-center justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="text-xs font-medium truncate">{displayItemName(item)}</div>
                                  <div className="text-[11px] text-muted-foreground">
                                    {item.quantity} {displayUnit(item.unit)}
                                    {item.estimatedTotalCost ? ` · ${Number(item.estimatedTotalCost).toLocaleString(locale)} ${currency}` : ""}
                                  </div>
                                  {(item.requiredDate || item.delegateAssignedAt) && (
                                    <div className="text-[11px] text-muted-foreground mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                                      {item.requiredDate && <span>{t.purchaseOrders.requiredDate}: {formatDateOnly(item.requiredDate, locale)}</span>}
                                      {item.delegateAssignedAt && <span>{t.purchaseOrders.delegateAssignedDate}: {formatDateOnly(item.delegateAssignedAt, locale)}</span>}
                                      {availableDays != null && <span className={availableDays < 0 ? "text-red-600" : ""}>{t.purchaseOrders.availableDuration}: {formatAvailableDuration(availableDays, language)}</span>}
                                    </div>
                                  )}
                                </div>
                                {isMarkedForManagementRejection ? (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-8 shrink-0 gap-1 border-amber-200 text-amber-700 hover:bg-amber-50"
                                    onClick={() =>
                                      setManagementRejections((prev) => {
                                        const next = { ...prev };
                                        delete next[item.id];
                                        return next;
                                      })
                                    }
                                  >
                                    {t.workflow.purchase.undoRejection}
                                  </Button>
                                ) : (canRejectAccountingItem || canRejectManagementItem) && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-8 shrink-0 gap-1 border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
                                    onClick={() => {
                                      if (canRejectManagementItem) {
                                        setManagementRejectEditor({
                                          itemId: item.id,
                                          submissionId: sub.id,
                                          reason: "",
                                        });
                                        return;
                                      }
                                      setRejectItemDialog({
                                        itemId: item.id,
                                        itemName: displayItemName(item) || displayItemDescription(item) || t.workflow.purchase.itemFallback.replace("{id}", String(item.id)),
                                        mode: "accounting",
                                      });
                                      setRejectItemReason("");
                                    }}
                                  >
                                    <XCircle className="w-3.5 h-3.5" />
                                    {t.workflow.purchase.rejectItemTitle}
                                  </Button>
                                )}
                              </div>

                              {isEditingManagementRejection && canRejectManagementItem && (
                                <div className="rounded-md border border-red-200 bg-red-50/60 p-3 space-y-2">
                                  <Label className="text-xs font-medium text-red-700">{t.workflow.purchase.itemRejectReasonRequired}</Label>
                                  <Textarea
                                    value={managementRejectEditor.reason}
                                    onChange={(e) =>
                                      setManagementRejectEditor((current) =>
                                        current && current.itemId === item.id && current.submissionId === sub.id
                                          ? { ...current, reason: e.target.value }
                                          : current
                                      )
                                    }
                                    placeholder={t.workflow.purchase.writeRejectReason}
                                    rows={2}
                                    className="resize-none bg-background"
                                    autoFocus
                                  />
                                  <div className="flex items-center justify-between gap-2 flex-wrap">
                                    <p className={`text-[11px] ${managementRejectEditor.reason.trim().length < REJECT_ITEM_MIN_LENGTH ? "text-red-600" : "text-emerald-600"}`}>
                                      {managementRejectEditor.reason.trim().length}/{REJECT_ITEM_MIN_LENGTH} {t.workflow.purchase.minimumChars}
                                    </p>
                                    <div className="flex items-center gap-2">
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="h-8"
                                        onClick={() => setManagementRejectEditor(null)}
                                      >
                                        {t.workflow.purchase.cancel}
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="destructive"
                                        className="h-8 gap-1.5"
                                        disabled={managementRejectEditor.reason.trim().length < REJECT_ITEM_MIN_LENGTH}
                                        onClick={() => {
                                          const reason = managementRejectEditor.reason.trim();
                                          if (reason.length < REJECT_ITEM_MIN_LENGTH) return;
                                          setManagementRejections((prev) => ({
                                            ...prev,
                                            [item.id]: { submissionId: sub.id, reason },
                                          }));
                                          setManagementRejectEditor(null);
                                          toast.info(t.workflow.purchase.markedForReject);
                                        }}
                                      >
                                        <XCircle className="w-3.5 h-3.5" />
                                        {t.workflow.purchase.markForReject}
                                      </Button>
                                    </div>
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}

                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        );
      })}

      <Dialog
        open={!!rejectItemDialog}
        onOpenChange={(open) => {
          if (!open) {
            setRejectItemDialog(null);
            setRejectItemReason("");
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-700">
              <XCircle className="w-5 h-5" />
              {t.workflow.purchase.rejectItemTitle}
            </DialogTitle>
          </DialogHeader>
          {rejectItemDialog && (
            <div className="space-y-4">
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold">
                {rejectItemDialog.itemName}
              </div>
              {rejectItemDialog.mode === "management" && (
                <p className="text-xs text-muted-foreground">
                  {t.workflow.purchase.rejectAppliedAtManagement}
                </p>
              )}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">{t.workflow.purchase.rejectReasonLabel}</Label>
                <Textarea
                  value={rejectItemReason}
                  onChange={(e) => setRejectItemReason(e.target.value)}
                  placeholder={t.workflow.purchase.writeRejectReason}
                  rows={4}
                  className="resize-none"
                  autoFocus
                />
                <p className={`text-[11px] ${rejectItemReason.trim().length < REJECT_ITEM_MIN_LENGTH ? "text-red-600" : "text-emerald-600"}`}>
                  {rejectItemReason.trim().length}/{REJECT_ITEM_MIN_LENGTH} {t.workflow.purchase.minimumChars}
                </p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setRejectItemDialog(null); setRejectItemReason(""); }}>
              {t.workflow.purchase.cancel}
            </Button>
            <Button
              variant="destructive"
              className="gap-1.5"
              disabled={
                rejectItemReason.trim().length < REJECT_ITEM_MIN_LENGTH ||
                (rejectItemDialog?.mode === "accounting" && rejectAccountingItemMut.isPending)
              }
              onClick={() => {
                if (!rejectItemDialog) return;
                const reason = rejectItemReason.trim();
                if (rejectItemDialog.mode === "management") {
                  if (!rejectItemDialog.submissionId) return;
                  setManagementRejections((prev) => ({
                    ...prev,
                    [rejectItemDialog.itemId]: {
                      submissionId: rejectItemDialog.submissionId!,
                      reason,
                    },
                  }));
                  setRejectItemDialog(null);
                  setRejectItemReason("");
                  toast.info(t.workflow.purchase.markedForReject);
                  return;
                }
                rejectAccountingItemMut.mutate({
                  itemId: rejectItemDialog.itemId,
                  reason,
                });
              }}
            >
              {rejectItemDialog?.mode === "accounting" && rejectAccountingItemMut.isPending
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <XCircle className="w-4 h-4" />}
              {rejectItemDialog?.mode === "management" ? t.workflow.purchase.markForReject : t.workflow.purchase.confirmRejectMark}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
