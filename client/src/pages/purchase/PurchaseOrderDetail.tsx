import { isDelegateRole } from "@shared/roles";
import { ExternalWorkshopPricingFields, externalWorkshopForm, externalWorkshopIssue, externalWorkshopPayload, needsExternalWorkshop, type ExternalWorkshopForm } from "@/components/purchase/ExternalWorkshopPricingFields";
import { externalMaintenanceLabels } from "@/i18n/externalMaintenanceFollowup";
import { defaultDelegateManagerId, reviewDelegateId, reviewBulkDelegateValue } from "@/lib/delegateReviewDefaults";
import { PricingBundleLink, PricingBundleAddButton } from "@/components/purchase/PricingBundleActions";
import { ReplacementRepriceButton } from "@/components/purchase/ReplacementRepriceButton";
import { isDelegateOwnPurchaseDraft } from "@shared/purchaseDraftVisibility";
import { ImprovementReference } from "@/components/improvement/ImprovementReference";
import { trpc } from "@/lib/trpc";
import { independentReadOptions } from "@/lib/read-transport";
import { refreshPurchaseExecution, purchaseRefreshNotice } from "@/lib/purchaseExecutionRefresh";
import { mediaUrl } from "@/lib/mediaUrl";
import { goBackOrFallback } from "@/lib/backStack";
import { useAuth } from "@/_core/hooks/useAuth";
import { isRoutedPurchaseItem, isPendingPurchaseItemReview, canReviewPurchaseItem, canResolvePurchaseItemReviewer } from "@shared/purchase-item-review";
import { useRoute, useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  ArrowRight, ShoppingCart, CheckCircle2, Clock, DollarSign, Loader2,
  Camera, Package, User, FileText, AlertCircle, ExternalLink, XCircle, Pencil, Upload, FileDown, Ban
} from "lucide-react";
import { useState, useMemo, useRef, useEffect } from "react";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useTranslation } from "@/contexts/LanguageContext";
import { getLocalizedName, useTranslatedField } from "@/hooks/useTranslatedField";
import { useStaticLabels, getLocalizedItemField, useEntityTranslation, useBatchTranslation } from "@/hooks/useContentTranslation";
import DropZone, { type UploadedFile } from "@/components/common/DropZone";
import { EntityTranslatedText } from "@/components/i18n/EntityTranslatedText";
import { localizeApiError } from "@/i18n/apiError";
import { getLocalizedCatalogUnitName } from "@/i18n/catalogMasterData";
import { formatAvailableDuration, formatDateOnly, getAvailableCalendarDays } from "@/lib/purchaseItemTiming";
import { formatPurchaseSubmissionTime } from "@shared/purchaseSubmissionTime";
import { canOpenApprovalPdf, approvalPdfNotice } from "@/lib/approvalPdfAccess";

const PO_STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  pending_review: "bg-purple-100 text-purple-700",
  pending_estimate: "bg-amber-100 text-amber-700",
  pending_accounting: "bg-orange-100 text-orange-700",
  pending_management: "bg-orange-100 text-orange-700",
  approved: "bg-teal-100 text-teal-700",
  partial_purchase: "bg-cyan-100 text-cyan-700",
  purchased: "bg-emerald-100 text-emerald-700",
  received: "bg-green-100 text-green-700",
  closed: "bg-gray-100 text-gray-700",
  rejected: "bg-red-100 text-red-700",
  revision_needed: "bg-rose-100 text-rose-700",
};

const ITEM_STATUS_COLORS: Record<string, string> = {
  pending: "bg-gray-100 text-gray-700",
  estimated: "bg-amber-100 text-amber-700",
  approved: "bg-teal-100 text-teal-700",
  rejected: "bg-red-100 text-red-700",
  purchased: "bg-emerald-100 text-emerald-700",
  received: "bg-green-100 text-green-700",
  cancelled: "bg-gray-200 text-gray-500",
  purchase_cancelled: "bg-red-100 text-red-700",
  needs_item_revision: "bg-rose-100 text-rose-700",
};

function numberToWords(num: number, language: string): string {
  if (language === "en") {
    if (num === 0) return "Zero SAR";
    const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
      "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
    const tensEn = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
    const n = Math.floor(num);
    const parts: string[] = [];
    if (n >= 1000000) parts.push(ones[Math.floor(n / 1000000)] + " Million");
    if (Math.floor(n % 1000000 / 1000) > 0) parts.push(ones[Math.floor(n % 1000000 / 1000)] + " Thousand");
    const rem = n % 1000;
    if (rem >= 100) parts.push(ones[Math.floor(rem / 100)] + " Hundred");
    const r = rem % 100;
    if (r > 0 && r < 20) parts.push(ones[r]);
    else if (r >= 20) parts.push(tensEn[Math.floor(r / 10)] + (r % 10 > 0 ? "-" + ones[r % 10] : ""));
    const dec = Math.round((num - Math.floor(num)) * 100);
    let result = parts.join(" ") + " SAR";
    if (dec > 0) result += ` and ${dec} Halalas`;
    return result;
  }
  if (language !== "ar") {
    // Urdu: numeric display
    return `${num.toLocaleString("ur-PK")} سعودی ریال`;
  }
  // Arabic
  if (num === 0) return "صفر ريال";
  const ones = ["", "واحد", "اثنان", "ثلاثة", "أربعة", "خمسة", "ستة", "سبعة", "ثمانية", "تسعة"];
  const tens = ["", "عشرة", "عشرون", "ثلاثون", "أربعون", "خمسون", "ستون", "سبعون", "ثمانون", "تسعون"];
  const teens = ["عشرة", "أحد عشر", "اثنا عشر", "ثلاثة عشر", "أربعة عشر", "خمسة عشر", "ستة عشر", "سبعة عشر", "ثمانية عشر", "تسعة عشر"];
  const hundreds = ["", "مائة", "مائتان", "ثلاثمائة", "أربعمائة", "خمسمائة", "ستمائة", "سبعمائة", "ثمانمائة", "تسعمائة"];
  const parts: string[] = [];
  const intPart = Math.floor(num);
  const decPart = Math.round((num - intPart) * 100);
  if (intPart >= 1000000) { const m = Math.floor(intPart / 1000000); parts.push(m === 1 ? "مليون" : m === 2 ? "مليونان" : `${ones[m] || m} ملايين`); }
  const rem = intPart % 1000000;
  if (rem >= 1000) { const t = Math.floor(rem / 1000); if (t === 1) parts.push("ألف"); else if (t === 2) parts.push("ألفان"); else if (t <= 10) parts.push(`${ones[t]} آلاف`); else parts.push(`${t} ألف`); }
  const r = rem % 1000;
  if (r >= 100) parts.push(hundreds[Math.floor(r / 100)]);
  const lastTwo = r % 100;
  if (lastTwo >= 10 && lastTwo <= 19) { parts.push(teens[lastTwo - 10]); }
  else { if (lastTwo % 10 > 0) parts.push(ones[lastTwo % 10]); if (Math.floor(lastTwo / 10) > 0) parts.push(tens[Math.floor(lastTwo / 10)]); }
  let result = parts.join(" و") + " ريال";
  if (decPart > 0) result += ` و${decPart} هللة`;
  return result;
}

export default function PurchaseOrderDetail() {
  const [, params] = useRoute("/purchase-orders/:id");
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const { t, language, dir } = useTranslation();
  const { getField } = useTranslatedField();
  const { getPOStatusLabel, getPOItemStatusLabel } = useStaticLabels();
  const locale = language === "ar" ? "ar-SA" : language === "ur" ? "ur-PK" : "en-US";
  const currency = t.common.currency;
  const poId = parseInt(params?.id || "0");
  const utils = trpc.useUtils();
  const ensurePurchasePdfAccess = async (scope: { batchId?: number; submissionId?: number } = {}) => {
    if (user?.role !== "accountant" && user?.role !== "senior_management") return user?.role !== "observer";
    const permission = await utils.purchaseOrders.documentPermission.fetch({ poId, ...scope });
    if (!canOpenApprovalPdf(user.role, permission)) {
      toast.error(approvalPdfNotice(language));
      return false;
    }
    return true;
  };
  const { data: catalogUnits = [] } = trpc.catalog.units.list.useQuery();
  const displayUnit = (value: string | null | undefined) =>
    getLocalizedCatalogUnitName(value, catalogUnits as any[], language);

  const { data: po, isLoading, refetch } = trpc.purchaseOrders.getById.useQuery({ id: poId }, { enabled: !!poId, ...independentReadOptions });
  const { data: directoryUsers } = trpc.users.list.useQuery(undefined, { enabled: !!user && !isDelegateRole(user.role) });
  const users = user && isDelegateRole(user.role) ? [
    { id: user.id, name: user.name, role: user.role },
    { id: po?.requestedById, name: (po as any)?.requestedByName },
  ] : directoryUsers;
  const { data: sites = [] } = trpc.sites.list.useQuery();
  const { data: poSections = [] } = trpc.sections.list.useQuery(
    po?.siteId ? { siteId: Number(po.siteId) } : undefined,
    { enabled: Boolean(po?.siteId) },
  );
  const { data: poAssets = [] } = trpc.assets.list.useQuery(
    po?.sectionId ? { sectionId: Number(po.sectionId) } : undefined,
    { enabled: Boolean(po?.sectionId) },
  );
  const { data: purchaseCategories = [] } = trpc.centerCategories.list.useQuery({ activeOnly: false });
  const selectedSite = (sites as any[]).find((site: any) => Number(site.id) === Number(po?.siteId));
  const selectedSection = (poSections as any[]).find((section: any) => Number(section.id) === Number(po?.sectionId));
  const selectedAsset = (poAssets as any[]).find((asset: any) => Number(asset.id) === Number(po?.assetId));
  const selectedPurchaseCategory = (purchaseCategories as any[]).find((category: any) => Number(category.id) === Number(po?.categoryId));

  // ── تجميع سجل الملاحظات حسب الصنف — الجزء 4 من إصلاحات 2026-08-10 ────────
  // بدل قسم منفصل أسفل الصفحة، كل ملاحظة تُعرض أسفل بطاقة صنفها مباشرة.
  // ملاحظات بلا purchaseOrderItemId (إجراءات على مستوى الطلب كاملًا، مثل
  // "أُعيد تقديم الطلب" أو "رُفض الطلب بالكامل") تبقى بقسم عام صغير منفصل.
  const { itemComments, generalComments } = useMemo(() => {
    const byItem = new Map<number, any[]>();
    const general: any[] = [];
    for (const c of (po?.comments || [])) {
      if (c.purchaseOrderItemId != null) {
        const list = byItem.get(c.purchaseOrderItemId) || [];
        list.push(c);
        byItem.set(c.purchaseOrderItemId, list);
      } else {
        general.push(c);
      }
    }
    return { itemComments: byItem, generalComments: general };
  }, [po?.comments]);

  // ── ترجمة حقول طلب الشراء (ملاحظات، اعتماد حسابات، اعتماد إدارة، سبب الرفض)
  const { translations: poTranslations } = useEntityTranslation(
    "PO",
    po?.id,
    ["notes", "accountingNotes", "managementNotes", "rejectionReason"],
    po?.originalLanguage
  );

  // دالة مساعدة: تُرجع الحقل المترجم للطلب أو النص الأصلي
  const getPoField = (fieldName: string, originalValue: string | null | undefined) =>
    poTranslations[fieldName] || originalValue || "";

  // دالة مساعدة: تُرجع الحقل المترجم للصنف (يستخدم الأعمدة المباشرة)
  const getItemField = (item: any, fieldName: string) =>
    getLocalizedItemField(item, fieldName, language);

  const { translationsMap: itemWorkflowTranslations } = useBatchTranslation(
    "PO_ITEM",
    (po?.items ?? []).map((item: any) => Number(item.id)).filter((id: number) => Number.isFinite(id)),
    ["delegateChangeReason", "managementRejectionReason", "itemRevisionNote", "purchaseCancelReason", "returnReason"],
  );
  const getItemWorkflowField = (item: any, fieldName: string) =>
    itemWorkflowTranslations[Number(item.id)]?.[fieldName] || item?.[fieldName] || "";

  const estimateMut = trpc.purchaseOrders.estimateCost.useMutation({ onSuccess: () => { toast.success(t.common.save); refetch(); refetchBatches(); }, onError: (e) => toast.error(localizeApiError(e.message)) });
  const pricingBundleStatus = trpc.delegatePricingBundles.status.useQuery(undefined, { enabled: isDelegateRole(user?.role), retry: false });
  const submitPricedBatchMut = trpc.purchaseOrders.submitPricedBatch.useMutation({
    onSuccess: (res: any) => {
      toast.success(t.workflow.purchase.pricingSentBatch.replace("{count}", String(res.itemCount)).replace("{batch}", String(res.batchNumber)));
      if (res.pricingDocumentArchived === false) {
        toast.warning(t.workflow.purchase.pricingDocumentWarning);
      }
      utils.attachments.listByType.invalidate({ entityType: "delegate_pricing_documents" });
      refetch();
      refetchBatches();
    },
    onError: (e: any) => toast.error(localizeApiError(e.message)),
  });
  const { data: pricingBatches = [], refetch: refetchBatches } = trpc.purchaseOrders.listPricingBatches.useQuery(
    { purchaseOrderId: poId },
    { enabled: !!poId }
  );
  const approveAccountingBatchMut = trpc.purchaseOrders.approveAccountingBatch.useMutation({
    onSuccess: async (result: any, variables: any) => {
      toast.success(t.workflow.purchase.batchApprovedSuccess);
      if (result?.financialDocumentArchived === false) {
        toast.warning(t.workflow.purchase.financialDocumentWarning);
      }
      utils.attachments.listByType.invalidate({ entityType: "po_financial_batch" });
      // Discard any read started before approval, then refresh both views from
      // the committed state before completing the mutation UI.
      await Promise.all([
        utils.purchaseOrders.getById.cancel({ id: poId }),
        utils.purchaseOrders.listPricingBatches.cancel({ purchaseOrderId: poId }),
      ]);
      await Promise.all([
        utils.purchaseOrders.getById.invalidate({ id: poId }),
        utils.purchaseOrders.listPricingBatches.invalidate({ purchaseOrderId: poId }),
      ]);
      void utils.purchaseOrders.list.invalidate();
      void utils.purchaseOrders.actionableForMe.invalidate();
      printPurchasePdf(variables.batchId);
    },
    onError: (e: any) => { toast.error(localizeApiError(e.message)); refetch(); refetchBatches(); },
  });
  const approveManagementBatchMut = trpc.purchaseOrders.approveManagementBatch.useMutation({
    onSuccess: () => { toast.success(t.workflow.purchase.batchApprovedSuccess); refetch(); refetchBatches(); },
    onError: (e: any) => { toast.error(localizeApiError(e.message)); refetch(); refetchBatches(); },
  });

  // رفض صنف فوري أثناء مراجعة الحسابات لدفعة تسعير — 2026-08-10.
  // ينفَّذ الرفض فورًا (سبب مستقل بكل صنف)، لا يُجمَّع مع اعتماد الدفعة.
  const [rejectItemDialog, setRejectItemDialog] = useState<{ itemId: number; itemName: string } | null>(null);
  const [rejectItemReason, setRejectItemReason] = useState("");
  const REJECT_ITEM_MIN_LENGTH = 10;
  const rejectAccountingBatchItemMut = trpc.purchaseOrders.rejectAccountingBatchItem.useMutation({
    onSuccess: (res: any) => {
      toast.success(
        res?.batchNowClosed ? t.workflow.purchase.batchRejectedAll :
        res?.poNowClosed ? t.workflow.purchase.orderRejectedAll :
        t.workflow.purchase.itemRejected
      );
      setRejectItemDialog(null);
      setRejectItemReason("");
      refetch(); refetchBatches();
    },
    onError: (e: any) => toast.error(localizeApiError(e.message)),
  });
  const reviewItemsMut = trpc.purchaseOrders.reviewItems.useMutation({ onSuccess: () => { toast.success(t.common.confirm); refetch(); }, onError: (e) => toast.error(localizeApiError(e.message)) });
  const approveAccMut = trpc.purchaseOrders.approveAccounting.useMutation({
    onSuccess: () => {
      toast.success(t.common.confirm);
      refetch();
      printPurchasePdf();
    },
    onError: (e: any) => toast.error(localizeApiError(e.message)),
  });
  const approveMgmtMut = trpc.purchaseOrders.approveManagement.useMutation({ onSuccess: () => { toast.success(t.common.confirm); refetch(); }, onError: (e) => toast.error(localizeApiError(e.message)) });
  const rejectMut = trpc.purchaseOrders.reject.useMutation({ onSuccess: () => { toast.success(t.common.confirm); refetch(); }, onError: (e) => toast.error(localizeApiError(e.message)) });
  const confirmPurchaseMut = trpc.purchaseOrders.confirmItemPurchase.useMutation({
    onSuccess: async (result, variables) => {
      toast.success(t.common.confirm);
      if (!await refreshPurchaseExecution(utils, result, variables)) toast.warning(purchaseRefreshNotice(language));
    }, onError: (e) => toast.error(localizeApiError(e.message)),
  });
  const cancelPurchaseMut = trpc.purchaseOrders.cancelItemPurchase.useMutation({
    onSuccess: () => { toast.success(t.purchaseOrders.cancelPurchaseSuccess); refetch(); setCancelPurchaseDialog(null); setCancelPurchaseNote(""); },
    onError: (e: any) => toast.error(localizeApiError(e.message)),
  });
  const receiveItemMut = trpc.purchaseOrders.confirmDeliveryToWarehouse.useMutation({
    onSuccess: async (result, variables) => {
      toast.success(t.common.confirm);
      if (!await refreshPurchaseExecution(utils, result, variables)) toast.warning(purchaseRefreshNotice(language));
    }, onError: (e: any) => toast.error(localizeApiError(e.message)),
  });
  const editItemMut = trpc.purchaseOrders.editItem.useMutation({ onSuccess: () => { toast.success(t.common.savedSuccessfully); setEditingItem(null); refetch(); }, onError: (e: any) => toast.error(localizeApiError(e.message)) });
  const editAndResubmitReturnedItemMut = trpc.purchaseOrders.editAndResubmitReturnedItem.useMutation({
    onSuccess: () => {
      toast.success(t.purchaseOrders.itemSavedAndResubmitted);
      setEditingItem(null);
      refetch();
    },
    onError: (e: any) => toast.error(localizeApiError(e.message)),
  });
  const cancelItemMut = trpc.purchaseOrders.cancelItem.useMutation({ onSuccess: () => { toast.success(t.purchaseOrders.cancelItemSuccess); refetch(); refetchBatches(); }, onError: (e: any) => toast.error(localizeApiError(e.message)) });
  const requestItemRevisionMut = trpc.purchaseOrders.requestItemRevision.useMutation({
  onSuccess: () => {
    toast.success(t.purchaseOrders.itemRevisionRequested);
    refetch();
  },
  onError: (e: any) => toast.error(localizeApiError(e.message))
});

  const requestDelegateChangeMut = trpc.purchaseOrders.requestDelegateChange.useMutation({
    onSuccess: () => {
      toast.success(t.workflow.purchase.delegateChangeSent);
      setDelegateChangeDialogItem(null);
      setDelegateChangeReason("");
      refetch();
    },
    onError: (e: any) => toast.error(localizeApiError(e.message)),
  });

  const resolveDelegateChangeMut = trpc.purchaseOrders.resolveDelegateChange.useMutation({
    onSuccess: () => {
      toast.success(t.workflow.purchase.itemDelegateAssigned);
      refetch();
    },
    onError: (e: any) => toast.error(localizeApiError(e.message)),
  });

const submitDraftMut = trpc.purchaseOrders.submitDraft.useMutation({
    onSuccess: () => { toast.success(t.purchaseOrders.submitDraftSuccess); refetch(); },
    onError: (e: any) => toast.error(localizeApiError(e.message)),
  });

  const resubmitItemRevisionMut = trpc.purchaseOrders.resubmitItemRevision.useMutation({
  onSuccess: () => {
    toast.success(t.purchaseOrders.itemResubmitted);
    refetch();
  },
  onError: (e: any) => toast.error(localizeApiError(e.message))
});

  const resubmitCancelledPurchaseMut = trpc.purchaseOrders.resubmitCancelledPurchase.useMutation({
    onSuccess: () => { toast.success(t.purchaseOrders.itemResubmittedToDelegate); refetch(); },
    onError: (e: any) => toast.error(localizeApiError(e.message)),
  });

  const finalizeCancelledItemMut = trpc.purchaseOrders.finalizeCancelledItem.useMutation({
    onSuccess: () => { toast.success(t.purchaseOrders.itemCancelledFinal); refetch(); },
    onError: (e: any) => toast.error(localizeApiError(e.message)),
  });
  const role = user?.role || "";
  const userId = user?.id;
  // عند فتح PR من «بانتظار إجرائي» نعرض للمندوب فقط الأصناف التي
  // تتطلب منه الإجراء الذي ضغطه: تسعير أو شراء أو كلاهما. الفتح العادي
  // للطلب يبقى كما كان ويعرض كل أصناف المندوب المرتبطة به.
  const delegateActionView =
    isDelegateRole(role) && typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("action")
      : null;
  const focusedItemId =
    typeof window !== "undefined"
      ? Number(new URLSearchParams(window.location.search).get("itemId") || 0) || null
      : null;

  // فتح الصنف من أي قائمة مسطحة (المندوب أو «متابعة أصنافي» أو «متابعة التوريد»)
  // يمرر itemId؛ نمرر الشاشة إليه ثم نعطي بطاقته نبضة قصيرة مع إبقاء إطار
  // التحديد ما دام itemId موجوداً في الرابط.
  const [focusedItemAnimating, setFocusedItemAnimating] = useState(false);
  useEffect(() => {
    if (!focusedItemId || !po?.items?.length || typeof document === "undefined") return;
    setFocusedItemAnimating(true);
    const scrollTimer = window.setTimeout(() => {
      document.getElementById(`purchase-order-item-${focusedItemId}`)?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }, 120);
    const animationTimer = window.setTimeout(() => setFocusedItemAnimating(false), 1800);
    return () => {
      window.clearTimeout(scrollTimer);
      window.clearTimeout(animationTimer);
    };
  }, [focusedItemId, po?.items?.length]);

  const [estimates, setEstimates] = useState<Record<number, string>>({});
  const [workshopDrafts, setWorkshopDrafts] = useState<Record<number, ExternalWorkshopForm>>({});
  const [rejectReason, setRejectReason] = useState("");
  const [custodyAmount, setCustodyAmount] = useState("");
  const [batchCustodyAmounts, setBatchCustodyAmounts] = useState<Record<number, string>>({});
  const [uploadingItem, setUploadingItem] = useState<string | null>(null);
  const [itemPhotos, setItemPhotos] = useState<Record<number, { invoice?: string; purchased?: string; warehouse?: string }>>({})
  const [dropZoneFor, setDropZoneFor] = useState<string | null>(null); // e.g. "123-invoice" or "123-purchased";
  const [cancelPurchaseDialog, setCancelPurchaseDialog] = useState<any>(null);
  const [cancelPurchaseNote, setCancelPurchaseNote] = useState("");
  const [receiveData, setReceiveData] = useState<Record<number, { cost: string; supplier: string; supplierItemName: string; warehousePhotoUrl: string }>>({});
  const [editingItem, setEditingItem] = useState<any>(null);
  const [selectedRevisionItemId, setSelectedRevisionItemId] = useState<number | null>(null);
  const [itemRevisionReason, setItemRevisionReason] = useState("");
  const [isItemRevisionDialogOpen, setIsItemRevisionDialogOpen] = useState(false);
  const [delegateChangeDialogItem, setDelegateChangeDialogItem] = useState<any>(null);
  const [delegateChangeReason, setDelegateChangeReason] = useState("");
  const [delegateSelections, setDelegateSelections] = useState<Record<number, string>>({});
  const [editForm, setEditForm] = useState<{ itemName: string; description: string; quantity: number; estimatedUnitCost: string; unit: string; photoUrl: string; notes: string }>({ itemName: "", description: "", quantity: 1, estimatedUnitCost: "", unit: "", photoUrl: "", notes: "" });
  const showExternalEditWorkshop = !!editingItem && needsExternalWorkshop(editingItem) && !['approved', 'partial_purchase', 'purchased', 'received'].includes(po?.status || "");
  const [reviewDecisions, setReviewDecisions] = useState<Record<number, { action: "approve" | "reject"; delegateId?: number; rejectionReason?: string }>>({});
  const [selectedReviewItemIds, setSelectedReviewItemIds] = useState<number[]>([]);
  const hasRoutedReview = (po?.items || []).some(isRoutedPurchaseItem);
  const routedReviewParentOpen = !!po && !["draft", "revision_needed", "closed", "rejected"].includes(po.status);
  const reviewableItems = useMemo(
    () => (po?.items || []).filter((item: any) => hasRoutedReview
      ? routedReviewParentOpen && canReviewPurchaseItem(user, item)
      : !["cancelled", "rejected"].includes(item.status)),
    [po?.items, hasRoutedReview, routedReviewParentOpen, user]
  );
  const selectedReviewItems = hasRoutedReview ? reviewableItems.filter((item: any) => selectedReviewItemIds.includes(Number(item.id))) : reviewableItems;

  const [bulkDelegateId, setBulkDelegateId] = useState<string | undefined>(undefined);
  const suggestedDelegateId = defaultDelegateManagerId(users || []);
  const reviewFallbackDelegateId = bulkDelegateId ? Number(bulkDelegateId) : suggestedDelegateId;
  const [lateRejections, setLateRejections] = useState<Record<number, boolean>>({});
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  const handleBulkApprove = () => {
    const newReviewDecisions: Record<number, { action: "approve" | "reject"; delegateId?: number; rejectionReason?: string }> = { ...reviewDecisions };
    if (selectedReviewItems.length > 0) {
      selectedReviewItems.forEach((item: any) => {
        newReviewDecisions[item.id] = { ...newReviewDecisions[item.id], action: "approve", delegateId: reviewDelegateId(item, newReviewDecisions[item.id], reviewFallbackDelegateId) };
      });
      setReviewDecisions(newReviewDecisions);
    }
  };

  const handleBulkAssignDelegate = (delegateId: number) => {
    const newReviewDecisions = { ...reviewDecisions };
    if (selectedReviewItems.length > 0) {
      selectedReviewItems.forEach((item: any) => {
        if (newReviewDecisions[item.id]?.action === "approve") {
          newReviewDecisions[item.id] = { ...newReviewDecisions[item.id], delegateId: delegateId };
        }
      });
      setReviewDecisions(newReviewDecisions);
    }
  };
  // ✅ إصلاح: أُزيل الزر العام لتصدير PDF لكل الطلب (بلا batchId) — كان يُصدِّر أصناف كل
  // الدفعات مجتمعة، بما يخالف طبيعة مستند "طلب عهدة مالية" الذي يجب أن يعكس دفعة واحدة
  // فقط. المستند الرسمي المعتمد الوحيد الآن هو زر "تصدير PDF لهذه الدفعة" لكل دفعة تسعير
  // (راجع docs/CHANGELOG_TECHNICAL.md وdocs/PENDING_TASKS.md).

  const [exportingBatchId, setExportingBatchId] = useState<number | null>(null);
  const [exportingSubmissionId, setExportingSubmissionId] = useState<number | null>(null);
  const handleExportBatchPdf = async (batchId: number, batchNumber: number) => {
    if (!po?.id) return;
    setExportingBatchId(batchId);
    try {
      if (!await ensurePurchasePdfAccess({ batchId })) return;
      const res = await fetch(`/api/export/po/${po.id}/pdf?batchId=${batchId}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(t.purchaseOrders.fileLoadFailed);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${po.poNumber || `po-${po.id}`}-batch${batchNumber}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(t.purchaseOrders.exportPdfFailed);
    } finally {
      setExportingBatchId(null);
    }
  };

  // إذا كانت دفعة التسعير جزءًا من purchase_package_submission فالمندوب لا
  // يحصل على PDF مستقل للـ PR. المستند الرسمي الوحيد لطلب العهدة هو مستند
  // دفعة الإرسال كاملة، لذلك نوجهه مباشرةً لتنزيل هذا المستند.
  const handleExportPackageSubmissionPdf = async (submissionId: number) => {
    if (!po?.id) return;
    setExportingSubmissionId(submissionId);
    try {
      if (!await ensurePurchasePdfAccess({ submissionId })) return;
      const res = await fetch(`/api/export/po/${po.id}/pdf?submissionId=${submissionId}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(t.purchaseOrders.fileLoadFailed);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `package-submission-${submissionId}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(t.workflow.purchase.dispatchDocumentDownloadFailed);
    } finally {
      setExportingSubmissionId(null);
    }
  };

  // ── فتح نافذة الطباعة مباشرة بعد اعتماد الحسابات (دفعة أو الطلب كامل) ──
  // ملاحظة مهمة: المتصفحات (خصوصاً Chrome) تمنع فتح نافذة/طباعة تلقائية لو
  // الاستدعاء حصل بعد أي عملية غير متزامنة (زي رد السيرفر) لأنها ما بتعتبرهاش
  // نتيجة تفاعل مباشر من المستخدم — فبتمنعها بصمت من غير أي رسالة خطأ.
  // الحل: نفتح نافذة فارغة فوراً لحظة الضغط على الزر نفسه (printWindowRef)،
  // وبعد ما يجهز الملف من السيرفر، نملأها بيه. لو المتصفح قفلها أو منعها،
  // في نسخة احتياطية مضمونة: تنزيل الملف يدوياً + رسالة توضيحية بدل ما "محصلش حاجة".
  const printWindowRef = useRef<Window | null>(null);
  const printPurchasePdf = async (batchId?: number) => {
    if (!po?.id) return;
    const win = printWindowRef.current;
    try {
      if (!await ensurePurchasePdfAccess(batchId ? { batchId } : {})) { win?.close(); return; }
      const qs = batchId ? `?batchId=${batchId}` : "";
      const res = await fetch(`/api/export/po/${po.id}/pdf${qs}`, { credentials: "include" });
      if (!res.ok) throw new Error(t.purchaseOrders.fileLoadFailed);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);

      if (win && !win.closed) {
        win.location.href = url;
        const tryPrint = () => {
          try { win.focus(); win.print(); } catch { /* بعض المتصفحات لا تدعم الطباعة التلقائية لملفات PDF */ }
        };
        win.addEventListener?.("load", tryPrint);
        setTimeout(tryPrint, 1200); // احتياطي: بعض عارضات PDF المدمجة لا تُطلق onload
      } else {
        // النافذة انسدّت أو المتصفح منعها من الأساس — تنزيل مضمون بدل فشل صامت
        const a = document.createElement("a");
        a.href = url;
        a.download = `${po.poNumber || `po-${po.id}`}${batchId ? `-batch${batchId}` : ""}.pdf`;
        a.click();
        toast.error(t.workflow.purchase.printPopupFailed);
      }
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err) {
      toast.error(t.workflow.purchase.printPrepareFailed);
    } finally {
      printWindowRef.current = null;
    }
  };

  const [revisionNote, setRevisionNote] = useState("");
  const [isRevisionDialogOpen, setIsRevisionDialogOpen] = useState(false);
  const [resubmitNote, setResubmitNote] = useState("");

  const requestRevisionMut = trpc.purchaseOrders.requestRevision.useMutation({
    onSuccess: () => { toast.success(t.purchaseOrders.submitDraftSuccess); setIsRevisionDialogOpen(false); setRevisionNote(""); refetch(); },
    onError: (e) => toast.error(localizeApiError(e.message))
  });

  const resubmitMut = trpc.purchaseOrders.resubmit.useMutation({
    onSuccess: () => { toast.success(t.purchaseOrders.resubmit); setResubmitNote(""); refetch(); },
    onError: (e) => toast.error(localizeApiError(e.message))
  });

  const closeMut = trpc.purchaseOrders.close.useMutation({
    onSuccess: () => { toast.success(t.purchaseOrders.closeOrderSuccess); refetch(); },
    onError: (e) => toast.error(localizeApiError(e.message))
  });

  const readyToSubmitCount = (po?.items || []).filter((i: any) => i.status === "estimated" && !i.batchId && !i.delegateChangeRequestedAt).length;
  const isAdminOrOwner = role === "admin" || role === "owner";
  const isDelegate = isDelegateRole(role) || isAdminOrOwner;
  const isAccountant = role === "accountant" || isAdminOrOwner;
  const isManagement = role === "senior_management" || role === "executive_director" || isAdminOrOwner;
  const isWarehouse = role === "warehouse" || isAdminOrOwner;
  const isMaintenanceManagerVariant = ["maintenance_manager", "general_maintenance_manager", "construction_procurement_manager"].includes(role);
  const isManager = isMaintenanceManagerVariant || role === "purchase_manager" || role === "food_warehouse_manager" || isAdminOrOwner;
  const canCancelItem = isAdminOrOwner ||
    (isMaintenanceManagerVariant && ["draft", "pending_review"].includes(po?.status || "")) ||
    (role === "senior_management" && po?.status === "pending_management");
  // الأدوار المسموح لها بتعديل أصناف طلب الشراء بشكل عام (يطابق صلاحية editItem في السيرفر)
  const canEditItems = isMaintenanceManagerVariant || isAdminOrOwner;
  // ⚠️ 2026-08-13: حسم طلب تغيير المندوب مقصور على نفس من راجع طلب الشراء
  // واختار المندوب لهذا الصنف أصلًا (po.reviewedById) — لا كل مدير من هذه
  // الأدوار الثلاثة. owner/admin يتجاوزان دائمًا كصمام أمان (مثلًا لو غادر
  // المراجع الأصلي الشركة). طلب قديم بلا reviewedById مسجَّل يبقى مفتوحًا
  // لكل مدير مؤهَّل — مطابقًا تمامًا لحارس السيرفر canResolvePOItemDelegateChange.
  const canManageDelegateChange = isAdminOrOwner ||
    (isMaintenanceManagerVariant &&
      (po?.reviewedById === null || po?.reviewedById === undefined || String(po?.reviewedById) === String(userId)));
  const delegateUsers = (users || []).filter((u: any) => isDelegateRole(u.role));
  const isRequester = String(po?.requestedById) === String(userId);
  // الأصناف التي أعادها المندوب لاتخاذ قرار: القرار النهائي للمنشئ أو owner/admin.
  // مدير الصيانة يحتفظ بصلاحية التعديل الحالية، لكنه لا يعيد الإرسال ولا يلغي نهائياً نيابة عن المنشئ.
  const canResolveReturnedItem = isRequester || isAdminOrOwner;
  const canEditReturnedItem = canResolveReturnedItem || (
    isMaintenanceManagerVariant &&
    ["draft", "pending_review"].includes(po?.status || "")
  );
  const isEditingReturnedItem = !!editingItem &&
    canResolveReturnedItem &&
    ["needs_item_revision", "purchase_cancelled"].includes(editingItem.status);

  // ⚠️ 2026-08-13: كانت تُحوّل السلسلة الخام إلى Date ثم .toISOString() قبل
  // الإرسال. purchaseOrderItems.updatedAt معرَّف بـ`mode: 'string'` بالمخطط —
  // القيمة الواصلة من السيرفر أصلًا سلسلة MySQL خام ("2026-08-13 10:30:00")
  // لا كائن Date ولا ISO، والسيرفر يقارنها نصًّا بنص (String(a) !== String(b)).
  // إعادة تنسيقها هنا كانت تضمن عدم التطابق دائمًا (فاصل T مفقود، لاحقة .000Z
  // زائدة، واحتمال فارق منطقة زمنية بين متصفح المستخدم والسيرفر) — فيرفض الحفظ
  // بلا أي تعارض تعديل حقيقي، في كل مرة، لا أحيانًا. القيمة رمز مطابقة خام
  // (كـETag) لا تاريخ يُعرَض، فتُمرَّر كما وصلت دون أي تحويل.
  const getLastKnownUpdatedAt = (item: any): string | undefined => {
    if (item?.updatedAt === null || item?.updatedAt === undefined) return undefined;
    return String(item.updatedAt);
  };
const visibleItems = useMemo(() => {
  if (!po?.items) return [];

  // owner/admin/maintenance_manager لديهم صلاحية تعديل الأصناف بشكل عام، فيرون كل الأصناف
  if (isAdminOrOwner || isMaintenanceManagerVariant) return po.items;

  if (isDelegateRole(role)) {
    if (isDelegateOwnPurchaseDraft({ id: userId ?? 0, role }, po)) return po.items;
    return po.items.filter((item: any) => {
      if (item.delegateId !== userId) return false;

      const needsEstimate =
        !item.batchId &&
        !item.delegateChangeRequestedAt &&
        ["pending", "estimated"].includes(item.status);
      const needsPurchase = ["approved", "funded"].includes(item.status);

      if (delegateActionView === "estimate") return needsEstimate;
      if (delegateActionView === "purchase") return needsPurchase;
      if (delegateActionView === "mixed") return needsEstimate || needsPurchase;

      return true;
    });
  }

  // منشئ الطلب دائماً يرى جميع الأصناف بما فيها needs_item_revision
  if (String(po.requestedById) === String(userId)) {
    return po.items;
  }

  if (
    role === "accountant" ||
    role === "senior_management" ||
    role === "executive_director" ||
    role === "warehouse" ||
    role === "purchase_manager" ||
    role === "food_warehouse_manager"
  ) {
    // ⚠️ 2026-08-10 (تصحيح): دور الحسابات يرى فقط الأصناف **الجاهزة فعليًا
    // لقراره الآن** — نفس الشرط تمامًا الذي يُظهر زر "{t.workflow.purchase.rejectItem}" (canRejectThisItem)
    // لا كل الأصناف التي مرّت بمرحلة الحسابات تاريخيًا. صنف مرفوض مسبقًا، أو
    // بدفعة اعتُمدت/رُفضت بالفعل، أو بطلب تجاوز مرحلة الحسابات = لا يظهر.
    if (role === "accountant") {
      return po.items.filter((item: any) => {
        if (item.status === "rejected" || item.status === "cancelled") return false;
        if (item.batchId != null) {
          const itemBatch = (pricingBatches as any[]).find((b: any) => b.id === item.batchId);
          return itemBatch?.status === "pending_accounting";
        }
        // ⚠️ إصلاح 2026-08-10: المسار الاحتياطي (صنف بلا دفعة) كان يفحص حالة
        // *الطلب* فقط — لكن الطلب قد يصبح pending_accounting بسبب أصناف أخرى
        // جاهزة، بينما هذا الصنف تحديدًا لا يزال عالقًا بمرحلة أبكر (مثال
        // مؤكَّد: بانتظار حسم "طلب تغيير المندوب" — لم يُسعَّر بعد إطلاقًا).
        // الشرط الآن على *الصنف نفسه*: مُسعَّر فعليًا (نفس معيار readyToSubmitCount
        // المستخدَم أصلًا بمكان آخر بالملف لتحديد "الصنف جاهز للإرسال").
        return po.status === "pending_accounting" &&
          item.status === "estimated" && !item.delegateChangeRequestedAt;
      });
    }
    return po.items.filter(
      (item: any) =>
        item.status !== "needs_item_revision"
    );
  }

  return po.items;
}, [po?.items, po?.status, po?.requestedById, isAdminOrOwner, isMaintenanceManagerVariant, role, userId, pricingBatches, delegateActionView]);
  const totalEstimated = useMemo(() => visibleItems.filter((item: any) => !["rejected", "cancelled", "purchase_cancelled"].includes(item.status)).reduce((sum: number, item: any) => sum + (parseFloat(item.estimatedTotalCost || "0")), 0), [visibleItems]);
  const totalActual = useMemo(() => visibleItems.filter((item: any) => !["rejected", "cancelled", "purchase_cancelled"].includes(item.status)).reduce((sum: number, item: any) => sum + (parseFloat(item.actualTotalCost || "0")), 0), [visibleItems]);

  // PM V2 Purchase context is displayed from the standard order/item notes.
  // Patch 121 links PM V2 atomically during Purchase creation, so there is no
  // manual relink action in the normal Purchase workflow.
  const pmv2PurchaseContext = useMemo(() => {
    if (!po) return null;
    const noteText = [
      po.notes,
      ...(po.items || []).map((item: any) => item.notes),
    ].filter(Boolean).join("\n");
    if (!/PM V2/i.test(noteText)) return null;
    const requestMatch = noteText.match(/طلب مواد\s*#(\d+)\s*\/\s*بند\s*#(\d+)/);
    if (!requestMatch) return null;
    const taskMatch = noteText.match(/PMV2-[A-Z0-9-]+/i);
    return {
      requestId: Number(requestMatch[1]),
      requestItemId: Number(requestMatch[2]),
      taskNumber: taskMatch?.[0] || null,
    };
  }, [po]);


  const handleUpload = async (file: File, itemId: number, type: "invoice" | "purchased" | "warehouse"): Promise<string | null> => {
    setUploadingItem(`${itemId}-${type}`);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      const data = await res.json();
      if (data.url) {
        setItemPhotos(prev => ({ ...prev, [itemId]: { ...prev[itemId], [type]: data.url } }));
        toast.success(t.common.save);
        setUploadingItem(null);
        return data.url;
      }
    } catch { toast.error(t.common.close); }
    setUploadingItem(null);
    return null;
  };

  if (isLoading) return <div className="space-y-4"><Skeleton className="h-8 w-48" /><Skeleton className="h-64 w-full" /></div>;
  if (!po) return <div className="text-center py-12 text-muted-foreground">{t.common.noData}</div>;

  const requestedBy = users?.find((u: any) => u.id === po.requestedById);

  const pendingReviewCount = (po.items || []).filter(isPendingPurchaseItemReview).length;
  const steps = [
    { key: "draft", label: getPOStatusLabel("draft"), done: true },
    { key: "pending_review", label: getPOStatusLabel("pending_review"), done: pendingReviewCount === 0 && !["draft", "revision_needed"].includes(po.status) },
    { key: "pending_estimate", label: getPOStatusLabel("pending_estimate"), done: !["draft", "pending_review", "revision_needed"].includes(po.status) },
    { key: "pending_accounting", label: getPOStatusLabel("pending_accounting"), done: !["draft", "pending_review", "pending_estimate", "revision_needed"].includes(po.status) },
    { key: "pending_management", label: getPOStatusLabel("pending_management"), done: !["draft", "pending_review", "pending_estimate", "pending_accounting", "revision_needed"].includes(po.status) },
    { key: "approved", label: getPOStatusLabel("approved"), done: ["approved", "partial_purchase", "purchased", "received", "closed"].includes(po.status) },
    { key: "purchased", label: getPOStatusLabel("purchased"), done: ["purchased", "received", "closed"].includes(po.status) },
    { key: "received", label: getPOStatusLabel("received"), done: ["received", "closed"].includes(po.status) },
  ];

  const purchasedCount = visibleItems.filter((i: any) => ["purchased", "received"].includes(i.status)).length;
  const pendingCount = visibleItems.filter((i: any) => !["purchased", "received"].includes(i.status)).length;

  return (
    <div className="space-y-6 max-w-5xl" dir={dir}>
      <ImprovementReference kind="purchase" documentId={po.id} />
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => goBackOrFallback(setLocation, "/purchase-orders")}>
          <ArrowRight className={`w-5 h-5 ${dir === "ltr" ? "rotate-180" : ""}`} />
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-sm font-mono text-muted-foreground">{po.poNumber}</span>
            <Badge className={PO_STATUS_COLORS[po.status] || "bg-gray-100 text-gray-700"}>{getPOStatusLabel(po.status)}</Badge>
          </div>
          <h1 className="text-xl font-bold mt-1">{t.purchaseOrders.title}</h1>
        </div>
        <div className="flex gap-2">
          <PricingBundleLink />
          {isDelegate && po.status === "pending_estimate" && !hasRoutedReview && (
            <Button variant="outline" className="border-rose-200 text-rose-700 hover:bg-rose-50" onClick={() => setIsRevisionDialogOpen(true)}>
              <AlertCircle className="w-4 h-4 mr-1.5" /> {t.purchaseOrders.returnForRevision}
            </Button>
          )}
          {isDelegate && readyToSubmitCount > 0 && !po.packageId && !(isDelegateRole(role) && pricingBundleStatus.data?.enabled) && (
            <Button
              className="bg-teal-600 hover:bg-teal-700 gap-1.5"
              onClick={() => submitPricedBatchMut.mutate({ purchaseOrderId: po.id })}
              disabled={submitPricedBatchMut.isPending}
            >
              {submitPricedBatchMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShoppingCart className="w-4 h-4" />}
              {t.purchaseOrders.submitForAccounting || t.purchaseOrders.approveAccounting} ({readyToSubmitCount})
            </Button>
          )}
          {po.status === "draft" && (isAdminOrOwner || String(po.requestedById) === String(userId)) && (
            <>
              <Button
                variant="outline"
                onClick={() => setLocation(`/purchase-orders/edit-draft/${po.id}`)}
                className="gap-2"
              >
                <Pencil className="w-4 h-4" />
                {t.purchaseOrders.editDraft}
              </Button>
              <Button
                onClick={() => { if (confirm(t.purchaseOrders.confirmSubmitForReview)) submitDraftMut.mutate({ id: po.id }); }}
                disabled={submitDraftMut.isPending}
                className="gap-2"
              >
                {submitDraftMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShoppingCart className="w-4 h-4" />}
                {t.purchaseOrders.submitForReview}
              </Button>
            </>
          )}
          {po.status !== "closed" && (isAdminOrOwner || String(po.requestedById) === String(userId)) && (
            <Button variant="outline" className="text-muted-foreground" onClick={() => { if (confirm(t.purchaseOrders.confirmCloseOrder)) closeMut.mutate({ id: po.id }); }}>
              <XCircle className="w-4 h-4 mr-1.5" /> {t.purchaseOrders.closeOrder}
            </Button>
          )}
        </div>
      </div>

      {pmv2PurchaseContext && isWarehouse && (
        <Card className="border-emerald-200 bg-emerald-50/60">
          <CardContent className="p-4 flex items-start gap-3">
            <CheckCircle2 className="w-5 h-5 text-emerald-700 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-emerald-900">{t.workflow.purchase.pmv2AutoLinkedShortage}</p>
              <p className="text-xs text-emerald-700 mt-1">
                {t.workflow.purchase.pmv2RequestItemRef.replace("{request}", String(pmv2PurchaseContext.requestId)).replace("{item}", String(pmv2PurchaseContext.requestItemId))}
                {pmv2PurchaseContext.taskNumber ? ` · ${pmv2PurchaseContext.taskNumber}` : ""}
              </p>
              <p className="text-xs text-emerald-700 mt-1">
                {t.workflow.purchase.pmv2LinkedNoManual}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {po.status === "revision_needed" && (
        <Card className="border-rose-200 bg-rose-50">
          <CardContent className="p-4 flex flex-col gap-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
              <div>
                <h3 className="text-sm font-bold text-rose-900">{t.purchaseOrders.resubmitDialogTitle}</h3>
                <p className="text-xs text-rose-700 mt-1">
                  {t.purchaseOrders.resubmitDialogDesc}
                </p>
              </div>
            </div>
            {(isAdminOrOwner || String(po.requestedById) === String(userId)) && (
              <div className="flex flex-col gap-2 border-t border-rose-200 pt-3">
                <Label className="text-xs text-rose-800">{t.purchaseOrders.resubmit} ({t.common.optionalNote})</Label>
                <div className="flex gap-2">
                  <Input 
                    placeholder={t.purchaseOrders.revisionNoteExample} 
                    value={resubmitNote} 
                    onChange={e => setResubmitNote(e.target.value)}
                    className="bg-white border-rose-200"
                  />
                  <Button 
                    onClick={() => resubmitMut.mutate({ id: po.id, note: resubmitNote })}
                    disabled={resubmitMut.isPending}
                    className="bg-rose-600 hover:bg-rose-700"
                  >
                    {resubmitMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-1.5" />}
                    {t.purchaseOrders.resubmit}
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-4">
          {pendingReviewCount > 0 && <p className="text-xs text-amber-700 mb-3">{getPOItemStatusLabel("pending_review")}: {pendingReviewCount}</p>}
          <div className="flex items-center justify-between gap-1 overflow-x-auto pb-1">
            {steps.map((step, i) => (
              <div key={step.key} className="flex items-center gap-1 flex-1 min-w-0">
                <div className={`flex items-center gap-1.5 shrink-0 ${step.done ? "text-primary" : "text-muted-foreground/40"}`}>
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold ${
                    po.status === step.key ? "bg-primary text-primary-foreground ring-2 ring-primary/30 ring-offset-1" :
                    step.done ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground/40"
                  }`}>
                    {step.done && po.status !== step.key ? "✓" : i + 1}
                  </div>
                  <span className="text-[10px] font-medium whitespace-nowrap hidden sm:inline">{step.label}</span>
                </div>
                {i < steps.length - 1 && <div className={`flex-1 h-0.5 mx-1 rounded ${step.done ? "bg-primary/40" : "bg-muted"}`} />}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {po.ticketId && (
        <Card className="border-teal-200 bg-teal-50/50 cursor-pointer hover:bg-teal-50 transition-colors" onClick={() => setLocation(`/tickets/${po.ticketId}`)}>
          <CardContent className="p-3 flex items-center gap-3">
            <FileText className="w-4 h-4 text-teal-600 shrink-0" />
            <span className="text-sm font-medium text-teal-800">{t.purchaseOrders.relatedTicket} #{po.ticketId}</span>
            <ExternalLink className="w-3.5 h-3.5 text-teal-600 mr-auto" />
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardContent className="p-3 flex items-center gap-2.5">
          <User className="w-4 h-4 text-muted-foreground shrink-0" />
          <div><p className="text-[10px] text-muted-foreground">{t.purchaseOrders.requestedBy}</p><p className="text-sm font-medium">{requestedBy?.name || "-"}</p></div>
        </CardContent></Card>
        <Card><CardContent className="p-3 flex items-center gap-2.5">
          <Clock className="w-4 h-4 text-muted-foreground shrink-0" />
          <div><p className="text-[10px] text-muted-foreground">{t.tickets.timeline}</p><p className="text-sm font-medium">{formatPurchaseSubmissionTime(po, locale)}</p></div>
        </CardContent></Card>
        <Card><CardContent className="p-3 flex items-center gap-2.5">
          <Package className="w-4 h-4 text-muted-foreground shrink-0" />
          <div><p className="text-[10px] text-muted-foreground">{t.purchaseOrders.items}</p><p className="text-sm font-medium">{visibleItems.length}</p></div>
        </CardContent></Card>
        <Card><CardContent className="p-3 flex items-center gap-2.5">
          <ShoppingCart className="w-4 h-4 text-muted-foreground shrink-0" />
          <div><p className="text-[10px] text-muted-foreground">{t.purchaseOrders.confirmPurchase}</p><p className="text-sm font-medium">{purchasedCount} / {visibleItems.length}</p></div>
        </CardContent></Card>
      </div>

      {(po.siteId || po.sectionId || po.assetId || po.categoryId) && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card><CardContent className="p-3">
            <p className="text-[10px] text-muted-foreground">{t.tickets.site}</p>
            <p className="text-sm font-medium">{selectedSite ? getLocalizedName(selectedSite, language) : "-"}</p>
          </CardContent></Card>
          <Card><CardContent className="p-3">
            <p className="text-[10px] text-muted-foreground">{t.tickets.section}</p>
            <p className="text-sm font-medium">{selectedSection ? getLocalizedName(selectedSection, language) : "-"}</p>
          </CardContent></Card>
          <Card><CardContent className="p-3">
            <p className="text-[10px] text-muted-foreground">{t.tickets.asset}</p>
            <p className="text-sm font-medium">{selectedAsset ? `${selectedAsset.assetNumber ? `${selectedAsset.assetNumber} — ` : ""}${selectedAsset.name}` : t.purchaseOrders.withoutAsset}</p>
          </CardContent></Card>
          <Card><CardContent className="p-3">
            <p className="text-[10px] text-muted-foreground">{t.tickets.category}</p>
            <p className="text-sm font-medium">{selectedPurchaseCategory?.name || t.purchaseOrders.withoutCategory}</p>
          </CardContent></Card>
        </div>
      )}

      {/* ── توزيع طلب الشراء على المناديب ── */}
      {(() => {
        // نجمّع الأصناف حسب المندوب المخصص له كل صنف
        const byDelegate = new Map<number, any[]>();
        for (const item of (po.items || [])) {
          if (!item.delegateId) continue;
          if (!byDelegate.has(item.delegateId)) byDelegate.set(item.delegateId, []);
          byDelegate.get(item.delegateId)!.push(item);
        }

        // القسم يظهر فقط عند توزيع الطلب على أكثر من مندوب واحد
        if (byDelegate.size < 2) return null;

        // "تم الشراء" يشمل أي صنف وصل لمرحلة الشراء أو تجاوزها
        const purchasedOrBeyond = new Set(["purchased", "delivered_to_warehouse", "delivered_to_requester"]);
        const excludedFromTotal = new Set(["rejected", "cancelled"]);

        return (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <User className="w-4 h-4" />
                {t.workflow.purchase.orderDistribution}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2.5">
              {Array.from(byDelegate.entries()).map(([delId, items]) => {
                const delegateUser = users?.find((u: any) => u.id === delId);
                const activeItems = items.filter((i: any) => !excludedFromTotal.has(i.status));
                const excludedItems = items.filter((i: any) => excludedFromTotal.has(i.status));
                const totalRequired = activeItems.length;
                const purchasedCountForDel = activeItems.filter((i: any) => purchasedOrBeyond.has(i.status)).length;
                const remaining = totalRequired - purchasedCountForDel;
                const pct = totalRequired > 0 ? Math.round((purchasedCountForDel / totalRequired) * 100) : 0;

                const stateLabel =
                  purchasedCountForDel === 0
                    ? { text: t.workflow.purchase.notStarted, color: "text-red-700 bg-red-50 border-red-200" }
                    : remaining === 0
                    ? { text: t.workflow.purchase.completedShort, color: "text-green-700 bg-green-50 border-green-200" }
                    : { text: t.workflow.purchase.inProgressShort, color: "text-amber-700 bg-amber-50 border-amber-200" };

                return (
                  <div key={delId} className="border rounded-lg p-3 space-y-2">
                    <div className="flex items-center justify-between flex-wrap gap-1.5">
                      <p className="text-sm font-medium flex items-center gap-1.5">
                        <User className="w-3.5 h-3.5 text-muted-foreground" />
                        {delegateUser?.name || t.workflow.purchase.delegateFallback.replace("{id}", String(delId))}
                      </p>
                      <div className="flex items-center gap-1.5">
                        <span className={`text-[11px] px-2 py-0.5 rounded-full border ${stateLabel.color}`}>
                          {stateLabel.text} ({pct}%)
                        </span>
                        {excludedItems.length > 0 && (
                          <span className="text-[11px] px-2 py-0.5 rounded-full border text-muted-foreground bg-muted/50">
                            +{excludedItems.length} {t.workflow.purchase.excludedShort}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div className="bg-muted/40 rounded p-1.5">
                        <p className="text-[10px] text-muted-foreground">{t.workflow.purchase.requiredToBuy}</p>
                        <p className="text-sm font-bold">{totalRequired}</p>
                      </div>
                      <div className="bg-green-50 rounded p-1.5">
                        <p className="text-[10px] text-muted-foreground">{t.workflow.purchase.purchasedShort}</p>
                        <p className="text-sm font-bold text-green-700">{purchasedCountForDel}</p>
                      </div>
                      <div className="bg-amber-50 rounded p-1.5">
                        <p className="text-[10px] text-muted-foreground">{t.workflow.purchase.remainingShort}</p>
                        <p className="text-sm font-bold text-amber-700">{remaining}</p>
                      </div>
                    </div>

                    {/* شريط تقدّم بسيط */}
                    <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${remaining === 0 ? "bg-green-500" : "bg-amber-500"}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        );
      })()}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <ShoppingCart className="w-4 h-4" />
            {t.purchaseOrders.items}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {visibleItems.map((item: any) => {
            const delegate = users?.find((u: any) => u.id === item.delegateId);
            // Admin/owner can act on all items; delegate only sees their own
            const isMyItem = isAdminOrOwner || (isDelegate && item.delegateId === userId);

            // رفض صنف فوري من الحسابات — 2026-08-10، عُمِّم لاحقًا بنفس اليوم
            // ليخدم مسارين معًا بزر واحد موحَّد أمام كل صنف بهذا الجدول (لا
            // قسم منفصل، ولا زر "رفض الطلب بالكامل" منفصل بالمسار الاحتياطي):
            // (أ) صنف بدفعة تسعير لا تزال بانتظار اعتماد الحسابات، أو
            // (ب) صنف بلا دفعة (المسار الاحتياطي القديم)، مُسعَّر فعليًا، والطلب
            //     نفسه بانتظار الحسابات. ⚠️ إصلاح 2026-08-10: أُضيف شرط
            //     "مُسعَّر فعليًا وبلا طلب تغيير مندوب معلَّق" — وإلا يظهر الزر
            //     على صنف لم يصل الحسابات أصلًا (لا يزال بانتظار حسم مدير
            //     الصيانة لطلب تغيير مندوبه)، لمجرد أن الطلب العام تحوّل
            //     لـpending_accounting بسبب أصناف أخرى جاهزة.
            const itemBatch = item.batchId ? (pricingBatches as any[]).find((b: any) => b.id === item.batchId) : null;
            const canRejectThisItem = isAccountant &&
              item.status !== "rejected" && item.status !== "cancelled" &&
              (
                itemBatch?.status === "pending_accounting" ||
                (!item.batchId && po.status === "pending_accounting" && item.status === "estimated" && !item.delegateChangeRequestedAt)
              );
            const isCancelledRaw = item.status === "cancelled";
            const isRejected = item.status === "rejected";
            const isPurchaseCancelled = item.status === "purchase_cancelled";
            const isCancelled = isCancelledRaw || isPurchaseCancelled;
            const routedReviewItem = isRoutedPurchaseItem(item);
            const routedInitialReviewBlocked = routedReviewItem && item.status === "pending_review" && !routedReviewParentOpen;
            const canManageThisDelegateChange = routedReviewItem ? canResolvePurchaseItemReviewer(user, item) : canManageDelegateChange;
            const canReviewThisItem = routedReviewItem && routedReviewParentOpen && canReviewPurchaseItem(user, item);
            const availableDays = getAvailableCalendarDays(item.requiredDate, item.delegateAssignedAt);
            return (
              <div
                key={item.id}
                id={`purchase-order-item-${item.id}`}
                className={`border rounded-xl p-4 space-y-3 transition-colors ${
                  focusedItemId === Number(item.id)
                    ? `border-primary ring-2 ring-primary/30 bg-primary/5 ${focusedItemAnimating ? "animate-pulse shadow-lg" : ""}`
                    : isCancelled
                      ? "opacity-60 bg-gray-50 border-gray-200"
                      : "hover:border-primary/20"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <h4 className={`font-medium text-sm break-words ${isCancelled ? "line-through text-gray-400" : ""}`}>{getField(item, "itemName")}</h4>
                      <Badge className={`text-[10px] ${ITEM_STATUS_COLORS[item.status] || "bg-gray-100 text-gray-700"}`}>
                        {getPOItemStatusLabel(item.status)}
                      </Badge>
                    </div>
                    {item.description && <p className={`text-xs break-words ${isCancelled ? "text-gray-400 line-through" : "text-muted-foreground"}`}>{getField(item, "description")}</p>}
                    <div className="flex items-center gap-4 mt-1.5 text-xs text-muted-foreground flex-wrap">
                      <span className={isCancelled ? "line-through" : ""}>{t.purchaseOrders.quantity}: <strong>{item.quantity} {displayUnit(item.unit)}</strong></span>
                      {delegate && <span>{t.purchaseOrders.delegate}: <strong>{delegate.name}</strong></span>}
                      {item.requiredDate && <span>{t.purchaseOrders.requiredDate}: <strong>{formatDateOnly(item.requiredDate, locale)}</strong></span>}
                      {item.delegateAssignedAt && <span>{t.purchaseOrders.delegateAssignedDate}: <strong>{formatDateOnly(item.delegateAssignedAt, locale)}</strong></span>}
                      {availableDays != null && (
                        <span className={availableDays < 0 ? "text-red-600" : ""}>
                          {t.purchaseOrders.availableDuration}: <strong>{formatAvailableDuration(availableDays, language)}</strong>
                        </span>
                      )}
                    </div>
                    {item.notes && <p className="text-xs text-muted-foreground mt-1.5 bg-muted/50 rounded-lg p-2 break-words">{getField(item, "notes")}</p>}

                    {(isCancelled || isRejected) && item.managementRejectionReason && (
                      <p className={`text-xs mt-1 ${isRejected ? "text-red-500" : "text-gray-400"}`}>
                        {isCancelled
                          ? t.purchaseOrders.cancelReason
                          : t.purchaseOrders.rejectionReason}
                        {getItemWorkflowField(item, "managementRejectionReason")}
                      </p>
                    )}
                  </div>
                  {item.photoUrl && (
                    <button
                      onClick={() => setPreviewImage(item.photoUrl)}
                      className="shrink-0 hover:opacity-80 transition-opacity"
                      title="Click to preview"
                    >
                      <img src={item.photoUrl} alt="" className={`w-16 h-16 rounded-lg object-cover border ${isCancelled ? "opacity-40 grayscale" : ""}`} />
                    </button>
                  )}
                  {/* cancelled سجل نهائي مرجعي لا يظهر له تعديل حتى لـ owner/admin.
                      بقية الأصناف تبقى مقيدة بسياسة المرحلة/الملكية الحالية. */}
                  {po && !isCancelledRaw && !routedInitialReviewBlocked && (
                    isAdminOrOwner ||
                    (
                      (
                        (routedReviewItem ? canReviewThisItem : canEditItems && ['draft', 'pending_review'].includes(po.status)) ||
                        (isRequester && po.status === 'revision_needed')
                      ) && ['pending', 'estimated', 'approved', ...(routedReviewItem ? ['pending_review'] : [])].includes(item.status)
                    )
                  ) && (
                    <Button variant="ghost" size="icon" className="shrink-0 h-8 w-8" onClick={() => {
                      setEditingItem(item);
                      setEditForm({ itemName: item.itemName, description: item.description || "", quantity: item.quantity, estimatedUnitCost: item.estimatedUnitCost || "", unit: item.unit || "", photoUrl: item.photoUrl || "", notes: item.notes || "" });
                    }}>
                      <Pencil className="w-3.5 h-3.5 text-muted-foreground" />
                    </Button>
                  )}
                  {/* Cancel button - for authorised roles, non-cancelled items */}
                  {!routedInitialReviewBlocked && (routedReviewItem ? isAdminOrOwner || canReviewThisItem || role === "senior_management" && po.status === "pending_management" && item.status !== "pending_review" : canCancelItem) && !isCancelled && item.status !== "delivered_to_requester" && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="shrink-0 h-8 w-8 text-gray-400 hover:text-red-500 hover:bg-red-50"
                      title={t.purchaseOrders.cancelItemTitle}
                      onClick={() => {
                        if (confirm(t.workflow.purchase.confirmCancelItem.replace("{item}", getField(item, "itemName")))) {
                          cancelItemMut.mutate({ itemId: item.id });
                        }
                      }}
                      disabled={cancelItemMut.isPending}
                    >
                      <XCircle className="w-3.5 h-3.5" />
                    </Button>
                  )}
                  {/* رفض صنف فوري من الحسابات — 2026-08-10. أمام كل صنف مباشرة،
                      لا زر واحد أسفل الطلب بالكامل. */}
                  {canRejectThisItem && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="shrink-0 h-8 gap-1 text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700"
                      onClick={() => { setRejectItemDialog({ itemId: item.id, itemName: getField(item, "itemName") }); setRejectItemReason(""); }}
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      {t.workflow.purchase.rejectItem}
                    </Button>
                  )}
                </div>

                {(item.estimatedUnitCost || item.actualUnitCost) && (
                  <div className="bg-muted/30 rounded-lg p-2.5 space-y-1">
                    {item.estimatedUnitCost && (
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">{t.purchaseOrders.totalEstimated}:</span>
                        <span className="font-medium">{Number(item.estimatedUnitCost).toLocaleString(locale)} {currency} × {item.quantity} = <strong>{parseFloat(item.estimatedTotalCost || "0").toLocaleString(locale)} {currency}</strong></span>
                      </div>
                    )}
                    {item.actualUnitCost && (
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-emerald-600">{t.purchaseOrders.totalActual}:</span>
                        <span className="font-medium text-emerald-700">{Number(item.actualUnitCost).toLocaleString(locale)} {currency} × {item.quantity} = <strong>{parseFloat(item.actualTotalCost || "0").toLocaleString(locale)} {currency}</strong></span>
                      </div>
                    )}
                    {item.supplierName && (
                      <div className="flex items-center justify-between text-xs pt-1 border-t border-muted">
                        <span className="text-muted-foreground">{t.purchaseOrders.supplier}:</span>
                        <span className="font-medium">{item.supplierName}</span>
                      </div>
                    )}
                  </div>
                )}

                {(item.invoicePhotoUrl || item.purchasedPhotoUrl || item.warehousePhotoUrl) && (
                  <div className="flex gap-3 border-t pt-2">
                    {item.invoicePhotoUrl && (
                      <button onClick={() => setPreviewImage(mediaUrl(item.invoicePhotoUrl))} className="group text-start hover:opacity-80 transition-opacity">
                        <p className="text-[10px] text-muted-foreground mb-1">{t.purchaseOrders.accountingNotes}</p>
                        <img src={mediaUrl(item.invoicePhotoUrl)} className="w-20 h-20 rounded-lg object-cover border group-hover:ring-2 ring-primary/30 transition-all" />
                      </button>
                    )}
                    {item.purchasedPhotoUrl && (
                      <button onClick={() => setPreviewImage(mediaUrl(item.purchasedPhotoUrl))} className="group text-start hover:opacity-80 transition-opacity">
                        <p className="text-[10px] text-muted-foreground mb-1">{t.tickets.photos}</p>
                        <img src={mediaUrl(item.purchasedPhotoUrl)} className="w-20 h-20 rounded-lg object-cover border group-hover:ring-2 ring-primary/30 transition-all" />
                      </button>
                    )}
                    {item.warehousePhotoUrl && (
                      <button onClick={() => setPreviewImage(mediaUrl(item.warehousePhotoUrl))} className="group text-start hover:opacity-80 transition-opacity">
                        <p className="text-[10px] text-muted-foreground mb-1">{t.purchaseOrders.warehousePhoto}</p>
                        <img src={mediaUrl(item.warehousePhotoUrl)} className="w-20 h-20 rounded-lg object-cover border group-hover:ring-2 ring-primary/30 transition-all" />
                      </button>
                    )}
                  </div>
                )}

{item.delegateChangeRequestedAt && (
  <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 space-y-3">
    <div className="flex items-start justify-between gap-3 flex-wrap">
      <div className="space-y-1">
        <p className="text-sm font-semibold text-blue-900 flex items-center gap-1.5">
          <User className="w-4 h-4" /> {t.workflow.purchase.delegateChangeRequest}
        </p>
        <p className="text-xs text-blue-800">
          {t.workflow.purchase.currentDelegate}: <strong>{delegate?.name || t.tickets.unspecified}</strong>
        </p>
        <p className="text-xs text-blue-800 whitespace-pre-wrap">
          {t.workflow.purchase.reason}: <strong>{getItemWorkflowField(item, "delegateChangeReason") || t.workflow.purchase.reasonNotProvided}</strong>
        </p>
        <p className="text-[11px] text-blue-600">
          {t.workflow.purchase.requestDate}: {new Date(item.delegateChangeRequestedAt).toLocaleString(locale)}
        </p>
      </div>
      {!canManageThisDelegateChange && (
        <Badge className="bg-blue-100 text-blue-800">
          {po?.reviewedByName ? t.workflow.purchase.waitingForNamedReviewer.replace("{name}", po.reviewedByName) : t.workflow.purchase.waitingMaintenanceManager}
        </Badge>
      )}
    </div>

    {canManageThisDelegateChange && (
      <div className="flex flex-col sm:flex-row gap-2 sm:items-end border-t border-blue-200 pt-3">
        <div className="flex-1 space-y-1">
          <Label className="text-xs text-blue-900">{t.workflow.purchase.selectDelegate}</Label>
          <Select
            value={delegateSelections[item.id] || String(item.delegateId || "")}
            onValueChange={(value) => setDelegateSelections((prev) => ({ ...prev, [item.id]: value }))}
          >
            <SelectTrigger className="bg-white">
              <SelectValue placeholder={t.workflow.purchase.chooseDelegate} />
            </SelectTrigger>
            <SelectContent>
              {delegateUsers
                .filter((delegateUser: any) => delegateUser.id === item.delegateId || (delegateUser.isActive !== 0 && delegateUser.isActive !== false))
                .map((delegateUser: any) => (
                <SelectItem key={delegateUser.id} value={String(delegateUser.id)}>
                  {delegateUser.name || delegateUser.username || t.workflow.purchase.delegateFallback.replace("{id}", String(delegateUser.id))}
                  {delegateUser.id === item.delegateId ? ` — ${t.workflow.purchase.current}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          size="sm"
          disabled={resolveDelegateChangeMut.isPending || !(delegateSelections[item.id] || item.delegateId)}
          onClick={() => {
            const selected = Number(delegateSelections[item.id] || item.delegateId);
            if (!selected) return;
            resolveDelegateChangeMut.mutate({ itemId: item.id, delegateId: selected });
          }}
        >
          {resolveDelegateChangeMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
          {t.workflow.purchase.assignDelegate}
        </Button>
      </div>
    )}
  </div>
)}

{isMyItem && item.status === "estimated" && !item.batchId && !item.delegateChangeRequestedAt && <PricingBundleAddButton itemId={item.id} />}

{isMyItem && item.status === "estimated" && !item.batchId && (
  <div className="bg-teal-50 border border-teal-200 rounded-lg p-2.5 flex items-center justify-between gap-2">
    <p className="text-xs text-teal-800 flex items-center gap-1.5">
      <CheckCircle2 className="w-3.5 h-3.5" /> {t.workflow.purchase.pricedWaitingAccounting}
    </p>
    <span className="text-xs font-bold text-teal-700">
      {Number(item.estimatedTotalCost || 0).toLocaleString(locale)} {currency}
    </span>
  </div>
)}

{isMyItem && item.status === "pending" && !item.batchId && !item.delegateChangeRequestedAt && (
  <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-2">
    <ExternalWorkshopPricingFields item={item} idPrefix={`external-quote-${item.id}`} value={externalWorkshopForm(item, workshopDrafts[item.id])} onChange={value => setWorkshopDrafts(previous => ({ ...previous, [item.id]: value }))} disabled={estimateMut.isPending} />
    <p className="text-xs font-medium text-amber-800 flex items-center gap-1.5">
      <DollarSign className="w-3.5 h-3.5" /> {t.purchaseOrders.estimatedUnitCost}:
    </p>

    <div className="flex gap-2 items-end">
      <div className="flex-1 space-y-1">
        <Label className="text-[11px] text-amber-700">
          {t.purchaseOrders.estimatedUnitCost} ({currency})
        </Label>

        <Input
          type="number"
          placeholder="0.00"
          value={estimates[item.id] || ""}
          onChange={e =>
            setEstimates(p => ({
              ...p,
              [item.id]: e.target.value
            }))
          }
          className="bg-white"
        />
      </div>

      {estimates[item.id] && parseFloat(estimates[item.id]) > 0 && (
        <div className="text-xs text-amber-700 pb-2">
          = {(parseFloat(estimates[item.id]) * item.quantity).toLocaleString(locale)} {currency}
        </div>
      )}

      <Button
        size="sm"
        onClick={() => {
          if (!estimates[item.id] || parseFloat(estimates[item.id]) <= 0) {
            toast.error(t.purchaseOrders.estimatedUnitCost);
            return;
          }

          const workshopIssue = externalWorkshopIssue(item, workshopDrafts[item.id]);
          if (workshopIssue) { toast.error(externalMaintenanceLabels(language)[workshopIssue]); return; }

          estimateMut.mutate({
            purchaseOrderId: po.id,
            items: [{
              id: item.id,
              estimatedUnitCost: estimates[item.id],
              ...externalWorkshopPayload(item, workshopDrafts[item.id]),
            }]
          });
        }}
        disabled={estimateMut.isPending || !!externalWorkshopIssue(item, workshopDrafts[item.id])}
        className="shrink-0"
      >
        {estimateMut.isPending
          ? <Loader2 className="w-3 h-3 animate-spin" />
          : t.common.save}
      </Button>

      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          setSelectedRevisionItemId(item.id);
          setItemRevisionReason("");
          setIsItemRevisionDialogOpen(true);
        }}
      >
        {t.workflow.purchase.itemReviewRequest}
      </Button>

      {isDelegateRole(role) && item.delegateId === userId && !item.estimatedUnitCost && (
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setDelegateChangeDialogItem(item);
            setDelegateChangeReason("");
          }}
        >
          {t.workflow.purchase.delegateChangeRequest}
        </Button>
      )}
    </div>
  </div>
)}

{item.status === "needs_item_revision" && (
  <div className="bg-red-50 border border-red-200 rounded-lg p-3 space-y-3">
    <p className="text-sm font-medium text-red-800">
      ⚠️ {t.workflow.purchase.needsReview}
    </p>

    {item.itemRevisionNote && (
      <div className="text-sm text-red-700 bg-white p-2 rounded border">
        <strong>{t.workflow.purchase.reviewReason}:</strong>
        <br />
        {getItemWorkflowField(item, "itemRevisionNote")}
      </div>
    )}

    {canEditReturnedItem && (
      <div className="flex flex-wrap gap-2">
        {canEditReturnedItem && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setEditingItem(item);
              setEditForm({
                itemName: item.itemName || "",
                description: item.description || "",
                quantity: item.quantity || 1,
                estimatedUnitCost: item.estimatedUnitCost?.toString() || "",
                unit: item.unit || "",
                photoUrl: item.photoUrl || "",
                notes: item.notes || "",
              });
            }}
          >
            {t.workflow.purchase.editItem}
          </Button>
        )}

        {canResolveReturnedItem && (
          <>
            <Button
              size="sm"
              onClick={() => resubmitItemRevisionMut.mutate({ itemId: item.id })}
              disabled={resubmitItemRevisionMut.isPending}
            >
              {resubmitItemRevisionMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
              {t.workflow.purchase.resubmitItem}
            </Button>

            <Button
              size="sm"
              variant="destructive"
              onClick={() => {
                if (confirm(t.purchaseOrders.confirmCancelItem)) {
                  finalizeCancelledItemMut.mutate({ itemId: item.id });
                }
              }}
              disabled={finalizeCancelledItemMut.isPending}
            >
              {finalizeCancelledItemMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
              {t.workflow.purchase.finalCancel}
            </Button>
          </>
        )}
      </div>
    )}
  </div>
)}

{item.status === "purchase_cancelled" && (
  <div className="bg-red-50 border border-red-200 rounded-lg p-3 space-y-3">
    <p className="text-sm font-medium text-red-800">
      ⛔ {t.workflow.purchase.purchaseUnavailable}
    </p>

    {item.purchaseCancelledByName && (
      <p className="text-xs text-red-700">{t.workflow.purchase.delegateLabel}: <strong>{item.purchaseCancelledByName}</strong></p>
    )}

    {item.purchaseCancelReason && (
      <div className="text-sm text-red-700 bg-white p-2 rounded border">
        <strong>{t.workflow.purchase.reason}:</strong>
        <br />
        {getItemWorkflowField(item, "purchaseCancelReason")}
      </div>
    )}

    {canEditReturnedItem && (
      <div className="flex flex-wrap gap-2">
        {canEditReturnedItem && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setEditingItem(item);
              setEditForm({
                itemName: item.itemName || "",
                description: item.description || "",
                quantity: item.quantity || 1,
                estimatedUnitCost: item.estimatedUnitCost?.toString() || "",
                unit: item.unit || "",
                photoUrl: item.photoUrl || "",
                notes: item.notes || "",
              });
            }}
          >
            {t.workflow.purchase.editItem}
          </Button>
        )}

        {canResolveReturnedItem && (
          <>
            <Button
              size="sm"
              onClick={() => resubmitCancelledPurchaseMut.mutate({ itemId: item.id })}
              disabled={resubmitCancelledPurchaseMut.isPending}
            >
              {resubmitCancelledPurchaseMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
              {t.workflow.purchase.resendDelegate}
            </Button>

            <Button
              size="sm"
              variant="destructive"
              onClick={() => {
                if (confirm(t.purchaseOrders.confirmCancelItem)) {
                  finalizeCancelledItemMut.mutate({ itemId: item.id });
                }
              }}
              disabled={finalizeCancelledItemMut.isPending}
            >
              {finalizeCancelledItemMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
              {t.workflow.purchase.finalCancel}
            </Button>
          </>
        )}
      </div>
    )}
  </div>
)}

                {isMyItem && item.status === "approved" && (
                  <div className="bg-teal-50 border border-teal-200 rounded-lg p-3 space-y-3">
                    <p className="text-xs font-medium text-teal-800 flex items-center gap-1.5">
                      <ShoppingCart className="w-3.5 h-3.5" /> {t.purchaseOrders.confirmPurchase}:
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-[11px] text-teal-700">{t.purchaseOrders.accountingNotes}</Label>
                        {itemPhotos[item.id]?.invoice ? (
                          <div className="relative mt-1">
                            <button onClick={() => setPreviewImage(itemPhotos[item.id]!.invoice || null)} className="w-full hover:opacity-80 transition-opacity">
                              <img src={itemPhotos[item.id]!.invoice} alt="" className="w-full h-20 rounded-lg object-cover border" />
                            </button>
                            <Button variant="destructive" size="icon" className="absolute top-1 left-1 h-5 w-5 rounded-full" onClick={() => { setItemPhotos(p => ({ ...p, [item.id]: { ...p[item.id], invoice: undefined } })); setDropZoneFor(null); }}>
                              <XCircle className="w-3 h-3" />
                            </Button>
                          </div>
                        ) : dropZoneFor === `${item.id}-invoice` ? (
                          <DropZone
                            maxFiles={1}
                            accept="image/*,application/pdf"
                            label={t.purchaseOrders.dragInvoicePhoto}
                            sublabel={t.purchaseOrders.photoOrPdf}
                            onFilesUploaded={(files: UploadedFile[]) => {
                              const done = files.find(f => f.status === "done" && f.url);
                              if (done?.url) { setItemPhotos(p => ({ ...p, [item.id]: { ...p[item.id], invoice: done.url } })); setDropZoneFor(null); }
                            }}
                          />
                        ) : (
                          <div className="flex gap-1 mt-1">
                            <Button variant="outline" size="sm" className="flex-1 h-20 border-dashed gap-1" onClick={() => {
                              const input = document.createElement("input");
                              input.type = "file"; input.accept = "image/*";
                              input.onchange = (e: any) => { if (e.target.files[0]) handleUpload(e.target.files[0], item.id, "invoice"); };
                              input.click();
                            }} disabled={uploadingItem === `${item.id}-invoice`}>
                              {uploadingItem === `${item.id}-invoice` ? <Loader2 className="w-4 h-4 animate-spin" /> : <><FileText className="w-4 h-4" /><span className="text-[10px]">{t.common.upload}</span></>}
                            </Button>
                            <Button variant="outline" size="sm" className="h-20 px-2 border-dashed" onClick={() => setDropZoneFor(`${item.id}-invoice`)} title={t.purchaseOrders.dragAndDrop}>
                              <Upload className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        )}
                      </div>
                      <div>
                        <Label className="text-[11px] text-teal-700">{t.tickets.photos}</Label>
                        {itemPhotos[item.id]?.purchased ? (
                          <div className="relative mt-1">
                            <button onClick={() => setPreviewImage(itemPhotos[item.id]!.purchased || null)} className="w-full hover:opacity-80 transition-opacity">
                              <img src={itemPhotos[item.id]!.purchased} alt="" className="w-full h-20 rounded-lg object-cover border" />
                            </button>
                            <Button variant="destructive" size="icon" className="absolute top-1 left-1 h-5 w-5 rounded-full" onClick={() => { setItemPhotos(p => ({ ...p, [item.id]: { ...p[item.id], purchased: undefined } })); setDropZoneFor(null); }}>
                              <XCircle className="w-3 h-3" />
                            </Button>
                          </div>
                        ) : dropZoneFor === `${item.id}-purchased` ? (
                          <DropZone
                            maxFiles={1}
                            accept="image/*"
                            label={t.purchaseOrders.dragItemPhoto}
                            sublabel={t.purchaseOrders.onePhoto}
                            onFilesUploaded={(files: UploadedFile[]) => {
                              const done = files.find(f => f.status === "done" && f.url);
                              if (done?.url) { setItemPhotos(p => ({ ...p, [item.id]: { ...p[item.id], purchased: done.url } })); setDropZoneFor(null); }
                            }}
                          />
                        ) : (
                          <div className="flex gap-1 mt-1">
                            <Button variant="outline" size="sm" className="flex-1 h-20 border-dashed gap-1" onClick={() => {
                              const input = document.createElement("input");
                              input.type = "file"; input.accept = "image/*";
                              input.onchange = (e: any) => { if (e.target.files[0]) handleUpload(e.target.files[0], item.id, "purchased"); };
                              input.click();
                            }} disabled={uploadingItem === `${item.id}-purchased`}>
                              {uploadingItem === `${item.id}-purchased` ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Camera className="w-4 h-4" /><span className="text-[10px]">{t.common.upload}</span></>}
                            </Button>
                            <Button variant="outline" size="sm" className="h-20 px-2 border-dashed" onClick={() => setDropZoneFor(`${item.id}-purchased`)} title={t.purchaseOrders.dragAndDrop}>
                              <Upload className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-1.5">
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5 border-red-200 text-red-700 hover:bg-red-50"
                        onClick={() => { setCancelPurchaseNote(""); setCancelPurchaseDialog(item); }}
                        disabled={confirmPurchaseMut.isPending}
                      >
                        <Ban className="w-3.5 h-3.5" />
                        {t.workflow.purchase.cancelPurchase}
                      </Button>
                      <Button size="sm" className="flex-1 gap-1.5" onClick={() => {
                        confirmPurchaseMut.mutate({
                          itemId: item.id,
                          invoicePhotoUrl: itemPhotos[item.id]?.invoice || "",
                          purchasedPhotoUrl: itemPhotos[item.id]?.purchased || "",
                        });
                      }} disabled={confirmPurchaseMut.isPending}>
                        {confirmPurchaseMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                        {t.purchaseOrders.confirmPurchase}
                      </Button>
                    </div>
                  </div>
                )}

                {false && item.status === "purchased_DISABLED" && (
                  <div className="bg-green-50 border border-green-200 rounded-lg p-3 space-y-3">
                    <p className="text-xs font-medium text-green-800 flex items-center gap-1.5">
                      <Package className="w-3.5 h-3.5" /> {t.purchaseOrders.receiveItem}:
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label className="text-[11px] text-green-700">{t.purchaseOrders.actualUnitCost} ({currency}) *</Label>
                        <Input type="number" className="bg-white" value={receiveData[item.id]?.cost || ""} onChange={e => setReceiveData(p => ({ ...p, [item.id]: { ...p[item.id], cost: e.target.value, supplier: p[item.id]?.supplier || "", supplierItemName: p[item.id]?.supplierItemName || "", warehousePhotoUrl: p[item.id]?.warehousePhotoUrl || "" } }))} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[11px] text-green-700">{t.purchaseOrders.supplier} *</Label>
                        <Input className="bg-white" value={receiveData[item.id]?.supplier || ""} onChange={e => setReceiveData(p => ({ ...p, [item.id]: { ...p[item.id], cost: p[item.id]?.cost || "", supplier: e.target.value, supplierItemName: p[item.id]?.supplierItemName || "", warehousePhotoUrl: p[item.id]?.warehousePhotoUrl || "" } }))} />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[11px] text-green-700">{t.workflow.purchase.supplierItemNameOptional}</Label>
                      <Input className="bg-white" placeholder={item.name} value={receiveData[item.id]?.supplierItemName || ""} onChange={e => setReceiveData(p => ({ ...p, [item.id]: { ...p[item.id], cost: p[item.id]?.cost || "", supplier: p[item.id]?.supplier || "", supplierItemName: e.target.value, warehousePhotoUrl: p[item.id]?.warehousePhotoUrl || "" } }))} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[11px] text-green-700">{t.workflow.purchase.receiptPhotoRequired}</Label>
                      {itemPhotos[item.id]?.warehouse ? (
                        <div className="relative mt-1">
                          <button onClick={() => setPreviewImage(itemPhotos[item.id]!.warehouse || null)} className="w-full hover:opacity-80 transition-opacity">
                            <img src={itemPhotos[item.id]!.warehouse} alt="" className="w-full h-20 rounded-lg object-cover border border-green-300" />
                          </button>
                          <Button variant="destructive" size="icon" className="absolute top-1 left-1 h-5 w-5 rounded-full" onClick={() => {
                            setItemPhotos(p => ({ ...p, [item.id]: { ...p[item.id], warehouse: undefined } }));
                            setReceiveData(p => ({ ...p, [item.id]: { ...p[item.id], warehousePhotoUrl: "" } }));
                            setDropZoneFor(null);
                          }}>
                            <XCircle className="w-3 h-3" />
                          </Button>
                        </div>
                      ) : dropZoneFor === `${item.id}-warehouse` ? (
                        <DropZone
                          maxFiles={1}
                          accept="image/*"
                          label={t.purchaseOrders.dragWarehousePhoto}
                          sublabel={t.purchaseOrders.onePhoto}
                          onFilesUploaded={(files: UploadedFile[]) => {
                            const done = files.find(f => f.status === "done" && f.url);
                            if (done?.url) {
                              setItemPhotos(p => ({ ...p, [item.id]: { ...p[item.id], warehouse: done.url } }));
                              setReceiveData(p => ({ ...p, [item.id]: { ...p[item.id], warehousePhotoUrl: done.url! } }));
                              setDropZoneFor(null);
                            }
                          }}
                        />
                      ) : (
                        <div className="flex gap-1 mt-1">
                          <Button variant="outline" size="sm" className="flex-1 h-20 border-dashed gap-1 border-green-300 text-green-700" onClick={() => {
                            const input = document.createElement("input");
                            input.type = "file"; input.accept = "image/*";
                            input.onchange = async (e: any) => {
                              if (e.target.files[0]) {
                                const url = await handleUpload(e.target.files[0], item.id, "warehouse");
                                if (url) setReceiveData(p => ({ ...p, [item.id]: { ...p[item.id], warehousePhotoUrl: url } }));
                              }
                            };
                            input.click();
                          }} disabled={uploadingItem === `${item.id}-warehouse`}>
                            {uploadingItem === `${item.id}-warehouse` ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Camera className="w-4 h-4" /><span className="text-[10px]">{t.common.photo}</span></>}
                          </Button>
                          <Button variant="outline" size="sm" className="h-20 px-2 border-dashed border-green-300" onClick={() => setDropZoneFor(`${item.id}-warehouse`)} title={t.purchaseOrders.dragAndDrop}>
                            <Upload className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      )}
                    </div>
                    <Button size="sm" className="w-full gap-1.5" onClick={() => {
                      const d = receiveData[item.id];
                      if (!d?.cost || !d?.supplier) { toast.error(t.purchaseOrders.supplier); return; }
                      if (!d?.warehousePhotoUrl) { toast.error(t.purchaseOrders.itemPhotoRequired); return; }
                      receiveItemMut.mutate({ itemId: item.id, actualUnitCost: d.cost, supplierName: d.supplier, supplierItemName: d.supplierItemName, warehousePhotoUrl: d.warehousePhotoUrl });
                    }} disabled={receiveItemMut.isPending}>
                      {receiveItemMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Package className="w-3.5 h-3.5" />}
                      {t.purchaseOrders.receiveItem}
                    </Button>
                  </div>
                )}

                {/* سجل ملاحظات هذا الصنف تحديدًا — الجزء 4 (2026-08-10)، بدل
                    قسم منفصل أسفل الصفحة يجمع كل الأصناف معًا بلا تمييز. */}
                {(itemComments.get(item.id) || []).length > 0 && (
                  <div className="border-t pt-2 space-y-2">
                    <p className="text-[11px] font-medium text-muted-foreground flex items-center gap-1.5">
                      <FileText className="w-3 h-3" /> {t.workflow.purchase.itemNotesHistory}
                    </p>
                    {(itemComments.get(item.id) || []).map((comment: any) => (
                      <div key={comment.id} className="space-y-1">
                        <div className="flex items-center justify-between flex-wrap gap-1">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[11px] font-bold">{comment.userName}</span>
                            <Badge variant="outline" className="text-[9px] py-0 h-3.5">{comment.userRole}</Badge>
                          </div>
                          <span className="text-[10px] text-muted-foreground">{new Date(comment.createdAt).toLocaleString(locale)}</span>
                        </div>
                        <EntityTranslatedText
                          as="p"
                          className="text-xs text-muted-foreground bg-muted/30 p-2 rounded-lg border-s-2 border-primary/20 whitespace-pre-wrap"
                          entityType="PO_COMMENT"
                          entityId={comment.id}
                          field="note"
                          original={comment.note}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="p-5 space-y-3">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            {t.purchaseOrders.totalEstimated}
          </h3>
          {totalEstimated > 0 && (
            <div className="space-y-1">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{t.purchaseOrders.totalEstimated}:</span>
                <span className="font-bold text-lg">{totalEstimated.toLocaleString(locale)} {currency}</span>
              </div>
              <p className="text-xs text-muted-foreground text-start">({numberToWords(totalEstimated, language)})</p>
            </div>
          )}
          {totalActual > 0 && (
            <div className="space-y-1 pt-3 border-t">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{t.purchaseOrders.totalActual}:</span>
                <span className="font-bold text-lg text-emerald-700">{totalActual.toLocaleString(locale)} {currency}</span>
              </div>
              <p className="text-xs text-emerald-600 text-start">({numberToWords(totalActual, language)})</p>
            </div>
          )}
          {totalEstimated > 0 && totalActual > 0 && (
            <div className="pt-3 border-t">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">{t.reports.comparison}:</span>
                <span className={totalActual > totalEstimated ? "text-red-600 font-semibold" : "text-emerald-600 font-semibold"}>
                  {totalActual > totalEstimated ? "+" : "-"}{Math.abs(totalActual - totalEstimated).toLocaleString(locale)} {currency}
                  ({totalEstimated > 0 ? ((Math.abs(totalActual - totalEstimated) / totalEstimated) * 100).toFixed(1) : 0}%)
                </span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {(hasRoutedReview ? reviewableItems.length > 0 : isManager && po.status === "pending_review") && (() => {
        const delegates = users?.filter((u: any) => isDelegateRole(u.role)) || [];
        const allDecided = selectedReviewItems.length > 0 && selectedReviewItems.every((item: any) => reviewDecisions[item.id]?.action);
        const isValid = selectedReviewItems.length > 0 && selectedReviewItems.every((item: any) => {
          const d = reviewDecisions[item.id];
          if (!d) return false;
          if (d.action === "approve") return !!reviewDelegateId(item, d, reviewFallbackDelegateId);
          if (d.action === "reject") return !!(d.rejectionReason?.trim());
          return false;
        }) || false;
        return (
          <Card className="border-purple-200 bg-purple-50/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-base text-purple-800">{t.workflow.purchase.reviewAssignDelegates}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2 mb-4">
                <Button
                  size="sm"
                  onClick={handleBulkApprove}
                  disabled={selectedReviewItems.length === 0}
                  className="flex-1"
                >
                  {hasRoutedReview ? t.purchaseOrders.approveSelected : t.purchaseOrders.approveAll}
                </Button>
                <Select
                  value={reviewBulkDelegateValue(selectedReviewItems, reviewDecisions, suggestedDelegateId, bulkDelegateId)}
                  onValueChange={v => {
                    setBulkDelegateId(v);
                    handleBulkAssignDelegate(parseInt(v));
                  }}
                  disabled={selectedReviewItems.length === 0 || !selectedReviewItems.some((item: any) => reviewDecisions[item.id]?.action === "approve")}
                >
                  <SelectTrigger className="flex-1 bg-white"><SelectValue placeholder={hasRoutedReview ? t.purchaseOrders.assignDelegateToSelected : t.purchaseOrders.assignDelegateToAll} /></SelectTrigger>
                  <SelectContent>
                    {delegates.map((d: any) => <SelectItem key={d.id} value={String(d.id)}>{d.name || d.email}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {reviewableItems.map((item: any) => {
                const decision = reviewDecisions[item.id] || {};
                return (
                  <div key={item.id} className="border rounded-lg p-3 space-y-3 bg-white">
                    {hasRoutedReview && <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={selectedReviewItemIds.includes(Number(item.id))} onChange={event => setSelectedReviewItemIds(ids => event.target.checked ? Array.from(new Set([...ids, Number(item.id)])) : ids.filter(id => id !== Number(item.id)))} />{t.purchaseOrders.selectReviewItem}</label>}
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium break-words">{getField(item, "itemName")}</p>
                        {item.description && <p className="text-xs text-muted-foreground break-words">{getField(item, "description")}</p>}
                        <p className="text-xs text-muted-foreground mt-0.5">{t.purchaseOrders.quantity}: <strong>{item.quantity} {displayUnit(item.unit)}</strong></p>
                      </div>
                    </div>
                    <div className="flex gap-3">
                      <Button
                        size="sm"
                        variant={decision.action === "approve" ? "default" : "outline"}
                        className="flex-1"
                        onClick={() => { if (hasRoutedReview) setSelectedReviewItemIds(ids => Array.from(new Set([...ids, Number(item.id)]))); setReviewDecisions(p => ({ ...p, [item.id]: { ...p[item.id], action: "approve" } })); }}
                      >
                        {t.common.confirm}
                      </Button>
                      <Button
                        size="sm"
                        variant={decision.action === "reject" ? "destructive" : "outline"}
                        className="flex-1"
                        onClick={() => { if (hasRoutedReview) setSelectedReviewItemIds(ids => Array.from(new Set([...ids, Number(item.id)]))); setReviewDecisions(p => ({ ...p, [item.id]: { ...p[item.id], action: "reject" } })); }}
                      >
                        {t.tickets.reject}
                      </Button>
                    </div>
                    {decision.action === "approve" && (
                      <div className="space-y-1">
                        <Label className="text-xs">{t.purchaseOrders.delegate} *</Label>
                        <Select
                          value={String(reviewDelegateId(item, decision, reviewFallbackDelegateId) || "")}
                          onValueChange={v => setReviewDecisions(p => ({ ...p, [item.id]: { ...p[item.id], delegateId: parseInt(v) } }))}
                        >
                          <SelectTrigger className="bg-white"><SelectValue placeholder={t.purchaseOrders.delegate} /></SelectTrigger>
                          <SelectContent>
                            {delegates.map((d: any) => <SelectItem key={d.id} value={String(d.id)}>{d.name || d.email}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                    {decision.action === "reject" && (
                      <div className="space-y-1">
                        <Label className="text-xs">{t.purchaseOrders.justification} *</Label>
                        <Input
                          placeholder={t.purchaseOrders.rejectReasonShort}
                          value={decision.rejectionReason || ""}
                          onChange={e => setReviewDecisions(p => ({ ...p, [item.id]: { ...p[item.id], rejectionReason: e.target.value } }))}
                          className="bg-white"
                        />
                      </div>
                    )}
                  </div>
                );
              })}
              <Button
                className="w-full gap-1.5"
                disabled={!allDecided || !isValid || reviewItemsMut.isPending}
                onClick={() => {
                  const items = selectedReviewItems.map((item: any) => {
                    const d = reviewDecisions[item.id];
                    return {
                      id: item.id,
                      action: d.action as "approve" | "reject",
                      delegateId: d.action === "approve" ? reviewDelegateId(item, d, reviewFallbackDelegateId) : undefined,
                      rejectionReason: d.action === "reject" ? d.rejectionReason : undefined,
                    };
                  });
                  reviewItemsMut.mutate({ poId: po.id, items });
                }}
              >
                {reviewItemsMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                {hasRoutedReview ? t.purchaseOrders.sendSelectedForReview : t.common.submit}
              </Button>
            </CardContent>
          </Card>
        );
      })()}

      {(() => {
        // تتبّع حالة الدفعات متاح لكل الأدوار اللي تقدر تشوف الطلب أصلاً — عرض فقط،
        // أزرار الاعتماد/الرفض/التصدير تفضل مقيّدة بصلاحياتها الأصلية زي ما هي.
        const visibleBatches = (pricingBatches as any[]).map((batch: any) => {
          const batchItems = (po?.items || []).filter((item: any) => item.batchId === batch.id);
          const activeItemCount = batchItems.filter(
            (item: any) => !["cancelled", "rejected"].includes(item.status)
          ).length;
          const isAutoClosed = ["pending_accounting", "pending_management"].includes(batch.status) && activeItemCount === 0;
          return {
            ...batch,
            originalStatus: batch.status,
            status: isAutoClosed ? "rejected" : batch.status,
            activeItemCount,
            isAutoClosed,
            batchItems,
          };
        });
        if (visibleBatches.length === 0) return null;
        const approvedCount = visibleBatches.filter((b: any) => b.status === "approved").length;
        const rejectedCount = visibleBatches.filter((b: any) => b.status === "rejected").length;
        const totalCount = visibleBatches.length;
        const progressLabel = totalCount === 1
          ? (approvedCount === 1 ? t.workflow.purchase.batchFullyApproved : rejectedCount === 1 ? t.workflow.purchase.batchRejected : t.workflow.purchase.batchPendingApproval)
          : `${t.workflow.purchase.batchApprovalProgress.replace("{approved}", String(approvedCount)).replace("{total}", String(totalCount))}${rejectedCount > 0 ? ` (${t.workflow.purchase.rejectedCount.replace("{count}", String(rejectedCount))})` : ""}`;
        return (
      <Card className="border-teal-200 bg-teal-50/40">
        <CardHeader className="pb-2">
          <CardTitle className="text-base text-teal-800">{t.workflow.purchase.pricingBatches}</CardTitle>
          <p className="text-xs text-teal-700 font-medium">{progressLabel}</p>
        </CardHeader>
        <CardContent className="space-y-3">
          {visibleBatches.map((batch: any) => (
              <div key={batch.id} className="bg-white rounded-lg border p-3 flex flex-col gap-2">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <p className="text-sm font-bold">
                      {t.workflow.purchase.batchNumber} {batch.batchNumber} — {batch.itemCount} {t.workflow.purchase.itemCount}
                      {batch.isAutoClosed ? ` — ${t.workflow.purchase.noActiveItems}` : ""}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t.workflow.purchase.total}: {Number(batch.totalEstimatedCost || 0).toLocaleString(locale)} {currency}
                    </p>
                    {batch.custodyAmount && (
                      <p className="text-xs text-amber-700 font-medium mt-0.5">
                        {t.workflow.purchase.custodyAmount}: {Number(batch.custodyAmount).toLocaleString(locale)} {currency}
                      </p>
                    )}
                  </div>
                  <Badge
                    className={
                      batch.status === "approved" ? "bg-emerald-100 text-emerald-700" :
                      batch.status === "rejected" ? "bg-red-100 text-red-700" :
                      batch.status === "pending_management" ? "bg-blue-100 text-blue-700" :
                      "bg-orange-100 text-orange-700"
                    }
                  >
                    {batch.isAutoClosed ? t.workflow.purchase.cancelledAllItems :
                     batch.status === "pending_accounting" ? t.workflow.purchase.accountingPending :
                     batch.status === "pending_management" ? t.workflow.purchase.managementPending :
                     batch.status === "approved" ? t.workflow.purchase.approved : t.workflow.purchase.rejected}
                  </Badge>
                </div>

                {(isDelegate || isAccountant || role === "senior_management") && ["pending_accounting", "pending_management", "approved"].includes(batch.status) && (() => {
                  if (!canOpenApprovalPdf(role, batch)) return <p className="text-xs text-muted-foreground">{approvalPdfNotice(language)}</p>;
                  const isPackageSubmissionBatch = batch.purchasePackageSubmissionId != null;
                  // إذا كانت دفعة التسعير جزءًا من دفعة إرسال حزمة، فالمستند الرسمي
                  // للمندوب والحسابات هو مستند purchase_package_submission فقط.
                  // الطلب المنفرد لا يصدر مستند عهدة موازيًا لنفس الإرسال.
                  const mustUsePackageDocument =
                    isPackageSubmissionBatch && (isDelegateRole(role) || isAccountant || role === "senior_management");

                  if (mustUsePackageDocument) {
                    const submissionId = Number(batch.purchasePackageSubmissionId);
                    return (
                      <div className="self-start space-y-1">
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1.5"
                          disabled={exportingSubmissionId === submissionId}
                          onClick={() => handleExportPackageSubmissionPdf(submissionId)}
                        >
                          {exportingSubmissionId === submissionId ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileDown className="w-3.5 h-3.5" />}
                          {t.workflow.purchase.downloadOfficialDispatch}
                        </Button>
                        <p className="text-[11px] text-muted-foreground">
                          {t.workflow.purchase.noStandaloneBatchPdf}
                        </p>
                      </div>
                    );
                  }

                  return (
                    <Button
                      size="sm"
                      variant="outline"
                      className="self-start gap-1.5"
                      disabled={exportingBatchId === batch.id}
                      onClick={() => handleExportBatchPdf(batch.id, batch.batchNumber)}
                    >
                      {exportingBatchId === batch.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileDown className="w-3.5 h-3.5" />}
                      {t.workflow.purchase.exportBatchCustodyPdf}
                    </Button>
                  );
                })()}

                {isAccountant && batch.status === "pending_accounting" && batch.purchasePackageSubmissionId == null && (
                  <div className="flex gap-2 items-end flex-wrap">
                    <div className="space-y-1">
                      <Label className="text-[11px] text-orange-700">{batch.replacementFunding ? "عهدة فرق سعر البديل" : t.workflow.purchase.custodyAmount} ({currency}) *</Label>
                      {batch.replacementFunding && <p className="text-[11px] text-orange-800">سعر البديل {batch.replacementFunding.quotedTotal} − رصيد المرتجع {batch.replacementFunding.creditAllocated} = الفرق {batch.replacementFunding.additionalFunding} ر.س</p>}
                      <Input
                        type="number"
                        placeholder="0.00"
                        value={batchCustodyAmounts[batch.id] ?? (batch.replacementFunding?.additionalFunding ?? "")}
                        onChange={e => setBatchCustodyAmounts(p => ({ ...p, [batch.id]: e.target.value }))}
                        className="bg-white w-40"
                      />
                    </div>
                    <Button
                      size="sm"
                      className="bg-orange-600 hover:bg-orange-700"
                      disabled={approveAccountingBatchMut.isPending || (batch.replacementFunding
                        ? Number(batchCustodyAmounts[batch.id] ?? batch.replacementFunding.additionalFunding) !== Number(batch.replacementFunding.additionalFunding)
                        : !(parseFloat(batchCustodyAmounts[batch.id] || "") > 0))}
                      onClick={() => {
                        printWindowRef.current = window.open("", "_blank");
                        approveAccountingBatchMut.mutate({
                          batchId: batch.id,
                          custodyAmount: batchCustodyAmounts[batch.id] ?? (batch.replacementFunding?.additionalFunding || undefined),
                        });
                      }}
                    >
                      {approveAccountingBatchMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                      {t.workflow.purchase.approveBatchAccounting}
                    </Button>
                  </div>
                )}

                {isAccountant && batch.status === "pending_accounting" && batch.purchasePackageSubmissionId != null && (
                  <div className="rounded-lg border border-orange-200 bg-orange-50/60 p-3 flex items-center justify-between gap-3 flex-wrap">
                    <p className="text-xs text-orange-900">
                      {t.workflow.purchase.custodyBatchOnly}
                    </p>
                    {po.packageId && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setLocation(`/purchase-packages/${po.packageId}?submissionId=${batch.purchasePackageSubmissionId}`)
                        }
                      >
                        {t.workflow.purchase.openDispatchBatch}
                      </Button>
                    )}
                  </div>
                )}


                <ReplacementRepriceButton batch={batch} onComplete={() => { refetch(); refetchBatches(); }} />
                {(role === "senior_management" || isAdminOrOwner) && batch.status === "pending_management" && (
                  <Button
                    size="sm"
                    className="bg-blue-600 hover:bg-blue-700 self-start"
                    disabled={approveManagementBatchMut.isPending}
                    onClick={() => approveManagementBatchMut.mutate({ batchId: batch.id })}
                  >
                    {approveManagementBatchMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                    {t.workflow.purchase.approveBatchManagement}
                  </Button>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
        );
      })()}

      {isAccountant && po.status === "pending_accounting" && pricingBatches.length === 0 && !hasRoutedReview && (
        <Card className="border-orange-200 bg-orange-50/50">
          <CardHeader className="pb-2"><CardTitle className="text-base text-orange-800">{t.purchaseOrders.accountingApproval}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-orange-800">{t.workflow.purchase.custodyAmount} ({currency}) *</label>
              <Input type="number" placeholder={t.purchaseOrders.custodyAmountPlaceholder} value={custodyAmount} onChange={e => setCustodyAmount(e.target.value)} className="bg-white" />
            </div>

            {/* رفض صنف مستقل بات متاحًا مباشرة أمام كل صنف بجدول "الأصناف" أعلى
                هذه البطاقة — 2026-08-10. لا حاجة لقائمة استبعاد منفصلة هنا، ولا
                زر "رفض الطلب بالكامل": رفض كل الأصناف الفعّالة يرفض الطلب تلقائيًا. */}
            <p className="text-xs text-orange-600">
              {t.workflow.purchase.rejectSpecificItemHelp}
              {t.workflow.purchase.approvalCoversNonRejected}
            </p>

            <Button onClick={() => {
                printWindowRef.current = window.open("", "_blank");
                approveAccMut.mutate({
                  id: po.id,
                  custodyAmount: custodyAmount || undefined,
                });
              }} disabled={approveAccMut.isPending || !(parseFloat(custodyAmount || "") > 0)} className="w-full gap-1.5">
                {approveAccMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                {t.common.confirm}
              </Button>
          </CardContent>
        </Card>
      )}

      {(role === "senior_management" || isAdminOrOwner) &&
        po.status === "pending_management" && pricingBatches.length === 0 && !hasRoutedReview && (
        <Card className="border-orange-200 bg-orange-50/50">
          <CardHeader className="pb-2"><CardTitle className="text-base text-orange-800">{t.purchaseOrders.managementApproval}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="bg-white p-3 rounded-md border border-orange-100 space-y-2 mb-3">
              <h4 className="text-sm font-medium text-orange-800">{t.workflow.purchase.reviewItemsOptional}</h4>
              <p className="text-xs text-orange-600 mb-2">{t.workflow.purchase.excludeItemsHelp}</p>
              {po.items?.filter((i: any) => i.status !== "rejected").map((item: any) => (
                <div key={item.id} className="flex items-center justify-between py-2 border-b border-orange-50 last:border-0">
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm break-words ${lateRejections[item.id] ? 'line-through text-gray-400' : 'text-gray-800 font-medium'}`}>{getField(item, "itemName")}</p>
                    <p className="text-xs text-gray-500">{t.workflow.purchase.estimatedCostLabel} {Number(item.estimatedTotalCost || 0).toLocaleString(locale)} {currency}</p>
                  </div>
                  <Button 
                    variant={lateRejections[item.id] ? "outline" : "ghost"} 
                    size="sm" 
                    className={lateRejections[item.id] ? "text-orange-600 border-orange-200 bg-orange-50" : "text-red-600 hover:text-red-700 hover:bg-red-50"}
                    onClick={() => setLateRejections(prev => ({ ...prev, [item.id]: !prev[item.id] }))}
                  >
                    {lateRejections[item.id] ? t.purchaseOrders.undoReject : t.purchaseOrders.rejectItem}
                  </Button>
                </div>
              ))}
            </div>

            <div className="flex gap-2">
              <Button onClick={() => {
                const rejectedIds = Object.keys(lateRejections).filter(id => lateRejections[Number(id)]).map(Number);
                if (rejectedIds.length > 0 && !rejectReason.trim()) {
                  toast.error(t.purchaseOrders.enterRejectReason);
                  return;
                }
                approveMgmtMut.mutate({ 
                  id: po.id,
                  rejectedItemIds: rejectedIds.length > 0 ? rejectedIds : undefined,
                  rejectionReason: rejectedIds.length > 0 ? rejectReason : undefined
                });
              }} disabled={approveMgmtMut.isPending} className="flex-1 gap-1.5">
                {approveMgmtMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                {Object.values(lateRejections).some(Boolean) ? t.purchaseOrders.approveWithExclusion : t.common.confirm}
              </Button>
              <Button variant="destructive" onClick={() => {
                if (!rejectReason.trim()) { toast.error(t.purchaseOrders.justification); return; }
                rejectMut.mutate({ id: po.id, reason: rejectReason });
              }} disabled={rejectMut.isPending} className="gap-1">
                <XCircle className="w-4 h-4" /> {t.workflow.purchase.rejectWholeOrder}
              </Button>
            </div>
            <Input placeholder={t.purchaseOrders.rejectReasonPlaceholder} value={rejectReason} onChange={e => setRejectReason(e.target.value)} />
          </CardContent>
        </Card>
      )}

{po.custodyAmount && (role === "senior_management" || role === "admin" || role === "owner") && (
        <Card className="border-amber-200 bg-amber-50/50">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
              <span className="text-amber-700 text-sm font-bold">{t.workflow.purchase.custodyIconLabel}</span>
            </div>
            <div>
              <p className="text-xs text-amber-700 font-medium">{t.workflow.purchase.custodyAmount}</p>
              <p className="text-lg font-bold text-amber-800">{Number(po.custodyAmount).toLocaleString(locale)} {currency}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {po.notes && (
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground mb-1">{t.purchaseOrders.justification}:</p>
            <p className="text-sm">{getPoField("notes", po.notes)}</p>
          </CardContent>
        </Card>
      )}

      {/* ملاحظات على مستوى الطلب كاملًا (لا تخص صنفًا محددًا) — الجزء 4
          (2026-08-10). ملاحظات كل صنف انتقلت لتظهر أسفل بطاقته مباشرة أعلاه. */}
      {generalComments.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <FileText className="w-4 h-4 text-muted-foreground" />
              {t.workflow.purchase.generalOrderNotes}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y">
              {generalComments.map((comment: any) => (
                <div key={comment.id} className="p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold">{comment.userName}</span>
                      <Badge variant="outline" className="text-[10px] py-0 h-4">{comment.userRole}</Badge>
                      {comment.actionType === "return_for_revision" && <Badge className="bg-rose-100 text-rose-700 text-[10px] py-0 h-4">{t.purchaseOrders.returnForRevision}</Badge>}
                      {comment.actionType === "resubmitted" && <Badge className="bg-blue-100 text-blue-700 text-[10px] py-0 h-4">{t.purchaseOrders.resubmit}</Badge>}
                    </div>
                    <span className="text-[10px] text-muted-foreground">{new Date(comment.createdAt).toLocaleString(locale)}</span>
                  </div>
                  <EntityTranslatedText
                    as="p"
                    className="text-sm text-muted-foreground bg-muted/30 p-2 rounded-lg border-s-2 border-primary/20 whitespace-pre-wrap"
                    entityType="PO_COMMENT"
                    entityId={comment.id}
                    field="note"
                    original={comment.note}
                  />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={isRevisionDialogOpen && !hasRoutedReview} onOpenChange={setIsRevisionDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.purchaseOrders.revisionDialogTitle}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              {t.purchaseOrders.revisionDialogDesc}
            </p>
            <div className="space-y-2">
              <Label>{t.purchaseOrders.revisionReason} *</Label>
              <Textarea 
                placeholder={t.purchaseOrders.revisionNoteExample} 
                value={revisionNote}
                onChange={e => setRevisionNote(e.target.value)}
                rows={4}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsRevisionDialogOpen(false)}>{t.common.cancel}</Button>
            <Button 
              variant="destructive" 
              disabled={revisionNote.length < 5 || requestRevisionMut.isPending}
              onClick={() => requestRevisionMut.mutate({ id: po.id, note: revisionNote })}
            >
              {requestRevisionMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : t.purchaseOrders.returnForRevision}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
  open={isItemRevisionDialogOpen}
  onOpenChange={setIsItemRevisionDialogOpen}
>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>
        {t.workflow.purchase.itemReviewRequest}
      </DialogTitle>
    </DialogHeader>

    <div className="space-y-4 py-2">
      <p className="text-sm text-muted-foreground">
        {t.workflow.purchase.itemReviewHelp}
      </p>

      <div className="space-y-2">
        <Label>{t.workflow.purchase.reviewReasonRequired}</Label>

        <Textarea
          value={itemRevisionReason}
          onChange={(e) => setItemRevisionReason(e.target.value)}
          placeholder={t.purchaseOrders.revisionNoteExample}
          rows={4}
        />
      </div>
    </div>

    <DialogFooter>
      <Button
        variant="outline"
        onClick={() => setIsItemRevisionDialogOpen(false)}
      >
        {t.workflow.purchase.cancel}
      </Button>

      <Button
        variant="destructive"
        disabled={
          itemRevisionReason.trim().length < 5 ||
          requestItemRevisionMut.isPending ||
          !selectedRevisionItemId
        }
        onClick={() => {
          if (!selectedRevisionItemId) return;

          requestItemRevisionMut.mutate({
            itemId: selectedRevisionItemId,
            note: itemRevisionReason,
          });

          setIsItemRevisionDialogOpen(false);
          setItemRevisionReason("");
          setSelectedRevisionItemId(null);
        }}
      >
        {requestItemRevisionMut.isPending ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          t.purchaseOrders.itemRevisionRequested
        )}
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
              {t.workflow.purchase.delegateChangeExplainer}
            </p>
            <div className="rounded-lg bg-muted/40 border p-2 text-sm">
              {t.workflow.purchase.itemColon} <strong>{delegateChangeDialogItem ? getItemField(delegateChangeDialogItem, "itemName") : ""}</strong>
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

      {/* Edit Item Dialog */}
      <Dialog open={!!editingItem} onOpenChange={(open) => { if (!open) setEditingItem(null); }}>
        <DialogContent className={`max-w-md ${showExternalEditWorkshop ? "max-h-[90vh] overflow-y-auto" : ""}`}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="w-4 h-4" />
              {t.common.edit} - {editingItem ? getItemField(editingItem, "itemName") : ""}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t.purchaseOrders.itemName}</Label>
              <Input value={editForm.itemName} onChange={e => setEditForm(p => ({ ...p, itemName: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>{t.purchaseOrders.details}</Label>
              <Textarea value={editForm.description} onChange={e => setEditForm(p => ({ ...p, description: e.target.value }))} rows={3} />
            </div>
<div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>{t.purchaseOrders.quantity}</Label>
                <Input type="number" min={1} value={editForm.quantity} onChange={e => setEditForm(p => ({ ...p, quantity: parseInt(e.target.value) || 1 }))} />
              </div>
              <div className="space-y-2">
                <Label>{t.purchaseOrders.unit}</Label>
                <Input value={editForm.unit} onChange={e => setEditForm(p => ({ ...p, unit: e.target.value }))} />
              </div>
            </div>

            {!['approved', 'partial_purchase', 'purchased', 'received'].includes(po.status) && (
              <div className="space-y-2">
                <Label>{t.purchaseOrders.estimatedUnitCost}</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={editForm.estimatedUnitCost}
                  onChange={e => setEditForm(p => ({ ...p, estimatedUnitCost: e.target.value }))}
                  placeholder="0.00"
                />
              </div>
            )}

            {showExternalEditWorkshop && <ExternalWorkshopPricingFields item={editingItem} idPrefix={`external-edit-${editingItem.id}`} value={externalWorkshopForm(editingItem, workshopDrafts[editingItem.id])} onChange={value => setWorkshopDrafts(previous => ({ ...previous, [editingItem.id]: value }))} disabled={editItemMut.isPending || editAndResubmitReturnedItemMut.isPending} />}

            <div className="space-y-2">
              <Label>Photo URL</Label>
              <Input value={editForm.photoUrl} onChange={e => setEditForm(p => ({ ...p, photoUrl: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>{t.common.notes}</Label>
              <Textarea value={editForm.notes} onChange={e => setEditForm(p => ({ ...p, notes: e.target.value }))} rows={2} />
            </div>
          </div>
          <DialogFooter className="flex-wrap gap-2">
            <Button variant="outline" onClick={() => setEditingItem(null)}>{t.common.cancel}</Button>
            <Button
              variant={isEditingReturnedItem ? "outline" : "default"}
              onClick={() => {
                if (!editingItem) return;
                const workshopIssue = showExternalEditWorkshop && editForm.estimatedUnitCost ? externalWorkshopIssue(editingItem, workshopDrafts[editingItem.id]) : null;
                if (workshopIssue) { toast.error(externalMaintenanceLabels(language)[workshopIssue]); return; }
                editItemMut.mutate({
                  lastKnownUpdatedAt: getLastKnownUpdatedAt(editingItem),
                  id: editingItem.id,
                  purchaseOrderId: po.id,
                  itemName: editForm.itemName,
                  description: editForm.description,
                  quantity: editForm.quantity,
                  estimatedUnitCost:
                    ['approved', 'partial_purchase', 'purchased', 'received'].includes(po.status)
                      ? undefined
                      : (editForm.estimatedUnitCost || undefined),
                  unit: editForm.unit || undefined,
                  photoUrl: editForm.photoUrl || undefined,
                  notes: editForm.notes || undefined,
                  ...(showExternalEditWorkshop && editForm.estimatedUnitCost ? externalWorkshopPayload(editingItem, workshopDrafts[editingItem.id]) : {}),
                });
              }}
              disabled={editItemMut.isPending || editAndResubmitReturnedItemMut.isPending || !!(showExternalEditWorkshop && editForm.estimatedUnitCost && externalWorkshopIssue(editingItem, workshopDrafts[editingItem.id]))}
            >
              {editItemMut.isPending
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : (isEditingReturnedItem ? t.purchaseOrders.saveOnly : t.common.save)}
            </Button>

            {isEditingReturnedItem && (
              <Button
                onClick={() => {
                  if (!editingItem) return;
                  const workshopIssue = showExternalEditWorkshop && editForm.estimatedUnitCost ? externalWorkshopIssue(editingItem, workshopDrafts[editingItem.id]) : null;
                  if (workshopIssue) { toast.error(externalMaintenanceLabels(language)[workshopIssue]); return; }
                  editAndResubmitReturnedItemMut.mutate({
                    lastKnownUpdatedAt: getLastKnownUpdatedAt(editingItem),
                    id: editingItem.id,
                    purchaseOrderId: po.id,
                    itemName: editForm.itemName,
                    description: editForm.description,
                    quantity: editForm.quantity,
                    estimatedUnitCost:
                      ['approved', 'partial_purchase', 'purchased', 'received'].includes(po.status)
                        ? undefined
                        : (editForm.estimatedUnitCost || undefined),
                    unit: editForm.unit || undefined,
                    photoUrl: editForm.photoUrl || undefined,
                    notes: editForm.notes || undefined,
                    ...(showExternalEditWorkshop && editForm.estimatedUnitCost ? externalWorkshopPayload(editingItem, workshopDrafts[editingItem.id]) : {}),
                  });
                }}
                disabled={editItemMut.isPending || editAndResubmitReturnedItemMut.isPending || !!(showExternalEditWorkshop && editForm.estimatedUnitCost && externalWorkshopIssue(editingItem, workshopDrafts[editingItem.id]))}
              >
                {editAndResubmitReturnedItemMut.isPending
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : t.purchaseOrders.saveAndResubmit}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* Image Preview Dialog (Lightbox) */}
      <Dialog open={!!previewImage} onOpenChange={(open) => { if (!open) setPreviewImage(null); }}>
        <DialogContent className="max-w-3xl max-h-[90vh] p-0 border-0 bg-black/90">
          <div className="relative w-full h-full flex items-center justify-center">
            {previewImage && (
              <>
                <img src={previewImage} alt="Preview" className="max-w-full max-h-[85vh] object-contain" />
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute top-2 right-2 text-white hover:bg-white/20 h-8 w-8 rounded-full"
                  onClick={() => setPreviewImage(null)}
                >
                  <XCircle className="w-5 h-5" />
                </Button>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* ==================== DIALOG: Cancel Purchase ==================== */}
      <Dialog open={!!cancelPurchaseDialog} onOpenChange={(open) => !open && setCancelPurchaseDialog(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-700">
              <Ban className="w-5 h-5" />
              {t.workflow.purchase.cancelItemPurchase}
            </DialogTitle>
          </DialogHeader>
          {cancelPurchaseDialog && (
            <div className="space-y-4">
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 space-y-1">
                <p className="font-semibold text-sm">{cancelPurchaseDialog.itemName}</p>
                <p className="text-xs text-muted-foreground">{t.purchaseOrders.quantity}: {cancelPurchaseDialog.quantity} {displayUnit(cancelPurchaseDialog.unit)}</p>
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-medium">{t.workflow.purchase.cancelPurchaseReasonRequired}</Label>
                <Textarea
                  placeholder={t.purchaseOrders.cancelPurchaseReason}
                  value={cancelPurchaseNote}
                  onChange={(e) => setCancelPurchaseNote(e.target.value)}
                  rows={4}
                  className="resize-none"
                />
                <p className="text-[11px] text-muted-foreground">{t.purchaseOrders.cancelItemWillReturn}</p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelPurchaseDialog(null)}>{t.common.cancel}</Button>
            <Button
              variant="destructive"
              className="gap-1.5"
              disabled={cancelPurchaseNote.trim().length < 3 || cancelPurchaseMut.isPending}
              onClick={() => {
                if (cancelPurchaseNote.trim().length < 3) { toast.error(t.purchaseOrders.cancelReasonRequired); return; }
                cancelPurchaseMut.mutate({ itemId: cancelPurchaseDialog.id, note: cancelPurchaseNote });
              }}
            >
              {cancelPurchaseMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Ban className="w-4 h-4" />}
              {t.workflow.purchase.confirmCancelPurchase}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* رفض صنف فوري أثناء مراجعة الحسابات — 2026-08-10 */}
      <Dialog open={!!rejectItemDialog} onOpenChange={(open) => { if (!open) { setRejectItemDialog(null); setRejectItemReason(""); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-700">
              <XCircle className="w-5 h-5" />
              {t.workflow.purchase.rejectItem}
            </DialogTitle>
          </DialogHeader>
          {rejectItemDialog && (
            <div className="space-y-4">
              <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                <p className="font-semibold text-sm">{rejectItemDialog.itemName}</p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">{t.workflow.purchase.rejectReasonRequired}</Label>
                <Textarea
                  placeholder={t.workflow.purchase.rejectReasonPlaceholder}
                  value={rejectItemReason}
                  onChange={(e) => setRejectItemReason(e.target.value)}
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
            <Button variant="outline" onClick={() => { setRejectItemDialog(null); setRejectItemReason(""); }}>{t.common.cancel}</Button>
            <Button
              variant="destructive"
              className="gap-1.5"
              disabled={rejectItemReason.trim().length < REJECT_ITEM_MIN_LENGTH || rejectAccountingBatchItemMut.isPending}
              onClick={() => {
                if (!rejectItemDialog) return;
                rejectAccountingBatchItemMut.mutate({ itemId: rejectItemDialog.itemId, reason: rejectItemReason.trim() });
              }}
            >
              {rejectAccountingBatchItemMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}
              {t.workflow.purchase.confirmRejectItemAction}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
