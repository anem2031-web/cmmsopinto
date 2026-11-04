import { trpc } from "@/lib/trpc";
import { CatalogPickerDialog } from "@/components/catalog/CatalogPickerDialog";
import { CatalogStockField } from "@/components/purchase/CatalogStockField";
import { PurchaseItemNeedFields } from "@/components/purchase/PurchaseItemNeedFields";
import { DEFAULT_PURCHASE_DELIVERY_DAYS, purchaseNeedTimingFromDate, purchaseNeedTimingFromDays, remainingPurchaseCalendarDays, validPurchaseDeliveryDays } from "@shared/purchaseItemNeedDate";
import { useAuth } from "@/_core/hooks/useAuth";
import { canRoleAccessPath } from "@shared/roles";
import { goBackOrFallback } from "@/lib/backStack";
import { useLocation, useSearch, useRoute } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowRight, Plus, Trash2, Loader2, ShoppingCart, Camera, Link2, Upload, BookOpen, Save, AlertCircle } from "lucide-react";
import DropZone, { type UploadedFile } from "@/components/common/DropZone";
import { useState, useMemo, useRef, useEffect } from "react";
import { toast } from "sonner";
import { useTranslation } from "@/contexts/LanguageContext";
import { cn } from "@/lib/utils";
import { localizeApiError } from "@/i18n/apiError";
import {
  isValidPurchaseRequiredDate,
  looksLikeRawValidationError,
  parsePurchaseOrderValidationIssues,
} from "@/lib/purchaseOrderValidation";
import { getLocalizedItemField } from "@/hooks/useContentTranslation";
import { getLocalizedCatalogDescription, getLocalizedCatalogName, getLocalizedCatalogUnitName, resolveCatalogUnit } from "@/i18n/catalogMasterData";
import { getLocalizedName } from "@/hooks/useTranslatedField";
import { WarehousePurchaseQuantities } from "../maintenance-teams/WarehousePurchaseQuantities";
import { MAX_TICKET_PURCHASE_QUANTITY, validWarehouseExtra } from "@shared/maintenance-team-tickets/purchase-quantities";
import { PURCHASE_REVIEW_ROLES, purchaseReviewRoleSchema, type PurchaseReviewRole } from "@shared/purchase-item-review";

type ItemForm = {
  sourceType: "catalog" | "manual";
  // 2B-1: رابط Master Item؛ يبقى مخفيًا عن العرض ويُحفظ مع بند الطلب.
  catalogItemId: number | null;

  itemName: string;
  description: string;

  quantity: number;
  unit: string;
  requiredDate: string;
  deliveryLeadDays: number | null;

  photoUrls: string[];
  notes: string;
  siteId: string;
  sectionId: string;
  assetId: string;
  categoryId: string;
  reviewRole: PurchaseReviewRole | "";
  _contextTouched?: Partial<Record<"siteId" | "sectionId" | "assetId" | "categoryId", boolean>>;
  _catalogNameAr?: string;
  _catalogNameEn?: string;
};

type ItemValidationField = "itemName" | "quantity" | "deliveryLeadDays" | "unit" | "siteId" | "sectionId" | "categoryId" | "reviewRole";

type PurchaseFormErrors = {
  items: Record<number, Partial<Record<ItemValidationField, string>>>;
};

const emptyPurchaseFormErrors = (): PurchaseFormErrors => ({ items: {} });

const emptyItem = (defaultUnit = "", context: Partial<Pick<ItemForm, "siteId" | "sectionId" | "assetId" | "categoryId">> = {}): ItemForm => ({
  sourceType: "catalog",
  catalogItemId: null,

  itemName: "",
  description: "",

  quantity: 1,
  unit: defaultUnit,
  ...purchaseNeedTimingFromDays(DEFAULT_PURCHASE_DELIVERY_DAYS),

  photoUrls: [],
  notes: "",
  siteId: context.siteId || "",
  sectionId: context.sectionId || "",
  assetId: context.assetId || "",
  categoryId: context.categoryId || "",
  reviewRole: "",
  _contextTouched: {},
});

// ── Main Component ─────────────────────────────────────────────────────────
export default function CreatePurchaseOrder() {
  const utils = trpc.useUtils();
  const [, setLocation] = useLocation();
  const { t, language, dir } = useTranslation();
  const { user } = useAuth();
  const searchStr = useSearch();
  const params = new URLSearchParams(searchStr);
  const supplierReturnPlanId = Number(params.get("supplierReturnPlanId"));
  const isReturnReplacement = Number.isSafeInteger(supplierReturnPlanId) && supplierReturnPlanId > 0;
  const returnCatalogItemId = Number(params.get("returnCatalogItemId"));
  const returnQuantity = Number(params.get("returnQuantity"));
  const ticketId = params.get("ticketId") ? parseInt(params.get("ticketId")!) : undefined;
  // بند بلاغ محدد ضمن بلاغ متعدد الجهات — الخطوة 4 (2026-08-08). غير مُمرَّر
  // لأي طلب شراء "عادي" مرتبط ببلاغ أحادي البند، فيسلك المسار القديم حرفيًا.
  const ticketItemId = params.get("ticketItemId") ? parseInt(params.get("ticketItemId")!) : undefined;
  const fromIdeaId = params.get("fromIdeaId") ? parseInt(params.get("fromIdeaId")!) : undefined;
  const prefillNotes = params.get("prefillNotes") || "";
  const isTicketMaterial = params.has("ticketTeamNeedId");
  const ticketTeamAssignmentId = Number(params.get("ticketTeamAssignmentId"));
  const ticketTeamNeedId = Number(params.get("ticketTeamNeedId"));
  const ticketTeamRevision = Number(params.get("ticketTeamRevision"));
  const ticketOperationKey = useRef<{ fingerprint: string; key: string } | null>(null);
  const materialParam = (key: string) => params.get(isTicketMaterial ? ({ pmv2RequestItemId: "ticketTeamNeedId", pmv2RequestId: "ticketTeamAssignmentId", pmv2CatalogItemId: "ticketCatalogItemId", pmv2TaskNumber: "ticketNumber", pmv2ItemName: "ticketItemName", pmv2Unit: "ticketUnit", pmv2MinimumQuantity: "ticketMinimumQuantity" } as Record<string,string>)[key] ?? "__unused_ticket_parameter" : key);
  const materialRequestItemId = materialParam("pmv2RequestItemId") ? parseInt(materialParam("pmv2RequestItemId")!) : undefined;
  const materialRequestId = materialParam("pmv2RequestId") ? parseInt(materialParam("pmv2RequestId")!) : undefined;
  const materialCatalogItemId = materialParam("pmv2CatalogItemId") ? parseInt(materialParam("pmv2CatalogItemId")!) : undefined;
  const materialTaskNumber = materialParam("pmv2TaskNumber") || "";
  const materialItemName = materialParam("pmv2ItemName") || "";
  const materialItemCode = materialParam("pmv2ItemCode") || "";
  const materialUnit = materialParam("pmv2Unit") || "";
  const materialUnitIdRaw = Number(materialParam("pmv2UnitId") || 0);
  const materialUnitId = Number.isInteger(materialUnitIdRaw) && materialUnitIdRaw > 0 ? materialUnitIdRaw : undefined;
  const materialMinimumQuantityRaw = Number(materialParam("pmv2MinimumQuantity") || 0);
  const materialMinimumQuantity = Number.isFinite(materialMinimumQuantityRaw) && materialMinimumQuantityRaw > 0
    ? materialMinimumQuantityRaw
    : 0;
  const materialTaskNeedQuantityRaw = Number(materialParam("pmv2TaskNeedQuantity") || 0);
  const materialTaskNeedQuantity = Number.isFinite(materialTaskNeedQuantityRaw) && materialTaskNeedQuantityRaw > 0
    ? materialTaskNeedQuantityRaw
    : 0;
  const materialTeamAvailableAtRequestRaw = Number(materialParam("pmv2TeamAvailableAtRequest") || -1);
  const materialTeamAvailableAtRequest = Number.isFinite(materialTeamAvailableAtRequestRaw) && materialTeamAvailableAtRequestRaw >= 0
    ? materialTeamAvailableAtRequestRaw
    : null;
  const hasMaterialPurchaseContext = Boolean(materialRequestItemId && materialCatalogItemId && materialItemName && materialMinimumQuantity > 0);
  const materialMinimumPurchaseUnits = Math.max(1, Math.ceil(materialMinimumQuantity || 1));
  const [ticketWarehouseExtra, setTicketWarehouseExtra] = useState(() => params.get("ticketWarehouseExtraQuantity") ?? "0");
  const ticketWarehouseExtraQuantity = Number(ticketWarehouseExtra);
  const ticketExtraValid = validWarehouseExtra(ticketWarehouseExtraQuantity) && materialMinimumPurchaseUnits + ticketWarehouseExtraQuantity <= MAX_TICKET_PURCHASE_QUANTITY;
  const materialPurchaseTotalUnits = isTicketMaterial && ticketExtraValid ? materialMinimumPurchaseUnits + ticketWarehouseExtraQuantity : materialMinimumPurchaseUnits;
  const ticketTechnicianQuantityRaw = Number(params.get("ticketTechnicianQuantity"));
  const ticketTechnicianQuantity = Number.isSafeInteger(ticketTechnicianQuantityRaw) && ticketTechnicianQuantityRaw >= materialMinimumPurchaseUnits ? ticketTechnicianQuantityRaw : materialMinimumPurchaseUnits;

  // قراءة draftId من الـ URL إذا كنا نعدّل مسودة
  const [matchEdit, editParams] = useRoute("/purchase-orders/edit-draft/:id");
  const draftId = matchEdit ? parseInt(editParams?.id || "0") : undefined;

  const { data: draftPO } = trpc.purchaseOrders.getById.useQuery(
    { id: draftId || 0 },
    { enabled: !!draftId }
  );

  const linkedTicketId = ticketId ?? draftPO?.ticketId ?? undefined;
  const linkedTicketItemId = ticketItemId ?? draftPO?.ticketItemId ?? undefined;
  const { data: ticket, isLoading: isLinkedTicketLoading } = trpc.tickets.getById.useQuery(
    { id: linkedTicketId || 0 },
    { enabled: !!linkedTicketId }
  );
  // بند البلاغ المستهدف (إن وُجد) — للتحقق من مساره وحالته بدل البلاغ كاملًا.
  const { data: linkedTicketItems } = trpc.tickets.items.useQuery(
    { ticketId: linkedTicketId || 0 },
    { enabled: !!linkedTicketId && !!linkedTicketItemId }
  );
  const linkedTicketItem = linkedTicketItemId
    ? linkedTicketItems?.find((i: any) => i.id === linkedTicketItemId)
    : undefined;

  const allowedLinkedTicketStatuses = draftId
    ? ["work_approved", "needs_purchase"]
    : ["work_approved"];
  // ⚠️ 2026-08-08 — الخطوة 4: إن وُجد ticketItemId، يُفحص مسار وحالة *البند* بدل
  // البلاغ. البلاغ أحادي البند (الأغلبية الساحقة) لا يمرّر ticketItemId إطلاقًا
  // فيسلك المسار القديم حرفيًا (فحص على ticket مباشرة).
  const relevantMaintenancePath = linkedTicketItemId ? linkedTicketItem?.maintenancePath : ticket?.maintenancePath;
  const relevantStatus = linkedTicketItemId ? linkedTicketItem?.status : ticket?.status;
  const isLinkedTicketInvalid = Boolean(
    !isReturnReplacement && !isTicketMaterial && linkedTicketId &&
    ticket &&
    (!linkedTicketItemId || linkedTicketItem) &&
    (relevantMaintenancePath !== "B" || !allowedLinkedTicketStatuses.includes(relevantStatus || ""))
  );
  const isLinkedTicketActionBlocked = Boolean(
    !isReturnReplacement && !isTicketMaterial && linkedTicketId && (
      isLinkedTicketLoading || !ticket ||
      (linkedTicketItemId && !linkedTicketItem) ||
      isLinkedTicketInvalid
    )
  );

  // ✅ وحدات القياس من الكاتلوج — تُحدّث القائمة فور إضافة وحدة جديدة من تبويب الكاتلوج
  const { data: catalogUnits } = trpc.catalog.units.list.useQuery();
  // Defaults initialize item fields; the order context is derived at save time.
  const initialContext = {
    siteId: fromIdeaId || isTicketMaterial || isReturnReplacement ? params.get("siteId") || "" : "",
    sectionId: fromIdeaId || isTicketMaterial || isReturnReplacement ? params.get("sectionId") || "" : "",
    assetId: fromIdeaId || isTicketMaterial || isReturnReplacement ? params.get("assetId") || "" : "",
    categoryId: isReturnReplacement ? params.get("categoryId") || "" : "",
  };
  const { data: sites = [] } = trpc.sites.list.useQuery();
  const { data: allSections = [] } = trpc.sections.list.useQuery(undefined);
  const { data: allAssets = [] } = trpc.assets.list.useQuery({});
  const { data: purchaseCategories = [] } = trpc.centerCategories.list.useQuery({ activeOnly: !draftId });
  const materialResolvedCatalogUnit = useMemo(() => {
    if (!hasMaterialPurchaseContext || !catalogUnits?.length || !materialUnitId) return null;
    return (catalogUnits as any[]).find((unit: any) => Number(unit.id) === materialUnitId) || null;
  }, [hasMaterialPurchaseContext, catalogUnits, materialUnitId]);

  const [formErrors, setFormErrors] = useState<PurchaseFormErrors>(() => emptyPurchaseFormErrors());

  const itemMessage = (template: string, itemIndex: number) =>
    template.replace("{item}", String(itemIndex + 1));

  const validationMessageForPath = (path: Array<string | number>): { message: string; targetId?: string; apply: (errors: PurchaseFormErrors) => void } | null => {
    const root = path[0];
    if (["siteId", "sectionId", "categoryId"].includes(String(root))) {
      return validationMessageForPath(["items", 0, root]);
    }
    if (root !== "items" || typeof path[1] !== "number") return null;

    const itemIndex = path[1];
    const field = path[2];
    const map: Partial<Record<string, { field: ItemValidationField; message: string }>> = {
      siteId: { field: "siteId", message: itemMessage(t.purchaseOrders.validationSiteRequired, itemIndex) },
      sectionId: { field: "sectionId", message: itemMessage(t.purchaseOrders.validationSectionRequired, itemIndex) },
      categoryId: { field: "categoryId", message: itemMessage(t.purchaseOrders.validationCategoryRequired, itemIndex) },
      reviewRole: { field: "reviewRole", message: itemMessage(t.purchaseOrders.validationReviewRoleRequired, itemIndex) },
      itemName: { field: "itemName", message: itemMessage(t.purchaseOrders.validationItemNameRequired, itemIndex) },
      quantity: { field: "quantity", message: itemMessage(t.purchaseOrders.validationQuantityInvalid, itemIndex) },
      requiredDate: { field: "deliveryLeadDays", message: itemMessage(t.purchaseOrders.validationDeliveryLeadDays, itemIndex) },
      deliveryLeadDays: { field: "deliveryLeadDays", message: itemMessage(t.purchaseOrders.validationDeliveryLeadDays, itemIndex) },
      unit: { field: "unit", message: itemMessage(t.purchaseOrders.validationUnitRequired, itemIndex) },
    };
    const mapped = typeof field === "string" ? map[field] : undefined;
    if (!mapped) return null;
    return {
      message: mapped.message,
      targetId: `purchase-item-${itemIndex}-${mapped.field}`,
      apply: (errors) => {
        errors.items[itemIndex] = { ...(errors.items[itemIndex] || {}), [mapped.field]: mapped.message };
      },
    };
  };

  const focusValidationTarget = (targetId?: string) => {
    if (!targetId) return;
    window.setTimeout(() => {
      const element = document.getElementById(targetId);
      element?.scrollIntoView({ behavior: "smooth", block: "center" });
      if (element instanceof HTMLElement) element.focus({ preventScroll: true });
    }, 0);
  };

  const handlePurchaseMutationError = (message: unknown) => {
    const issues = parsePurchaseOrderValidationIssues(message);
    if (issues.length > 0) {
      const next = emptyPurchaseFormErrors();
      const mapped = issues.map(issue => validationMessageForPath(issue.path)).filter(Boolean) as Array<NonNullable<ReturnType<typeof validationMessageForPath>>>;
      mapped.forEach(issue => issue.apply(next));
      setFormErrors(next);
      const first = mapped[0];
      toast.error(first?.message || t.purchaseOrders.validationFailed);
      focusValidationTarget(first?.targetId);
      return;
    }

    const localized = localizeApiError(message, language);
    toast.error(
      looksLikeRawValidationError(message) || looksLikeRawValidationError(localized)
        ? t.purchaseOrders.validationFailed
        : (localized || t.purchaseOrders.validationFailed),
    );
  };


  const createMut = trpc.purchaseOrders.create.useMutation({
    onSuccess: async (data) => {
      toast.success(
        data.pmv2Linked
          ? `${t.purchaseOrders.createNew} ${data.poNumber} — ${t.workflow.purchase.pmv2LinkedAutomatically}`
          : `${t.purchaseOrders.createNew} ${data.poNumber}`,
      );
      setLocation(`/purchase-orders/${data.id}`);
    },
    onError: (err) => handlePurchaseMutationError(err.message),
  });

  const saveDraftMut = trpc.purchaseOrders.saveDraft.useMutation({
    onSuccess: async (data) => {
      toast.success(`${t.purchaseOrders.saveDraft} — ${data.poNumber}`);
      setLocation(`/purchase-orders/${data.id}`);
    },
    onError: (err) => handlePurchaseMutationError(err.message),
  });

  const updateDraftMut = trpc.purchaseOrders.updateDraft.useMutation({
    onSuccess: async () => {
      toast.success(t.purchaseOrders.saveChangesSuccess);
      await utils.purchaseOrders.getById.invalidate({ id: draftId! });
      setLocation(`/purchase-orders/${draftId}`);
    },
    onError: (err) => handlePurchaseMutationError(err.message),
  });

  const [draftLoaded, setDraftLoaded] = useState(false);
  const [items, setItems] = useState<ItemForm[]>(() => isReturnReplacement
    ? [{ ...emptyItem(params.get("returnUnit") || "", {
        siteId: params.get("itemSiteId") || params.get("siteId") || "",
        sectionId: params.get("itemSectionId") || params.get("sectionId") || "",
        assetId: params.get("itemAssetId") || params.get("assetId") || "",
        categoryId: params.get("itemCategoryId") || params.get("categoryId") || "",
      }), sourceType: Number.isSafeInteger(returnCatalogItemId) && returnCatalogItemId > 0 ? "catalog" : "manual",
      catalogItemId: Number.isSafeInteger(returnCatalogItemId) && returnCatalogItemId > 0 ? returnCatalogItemId : null,
      itemName: params.get("returnItemName") || "", quantity: Number.isFinite(returnQuantity) && returnQuantity > 0 ? returnQuantity : 1,
      photoUrls: params.get("returnPhotoUrl") ? [params.get("returnPhotoUrl")!] : [],
    }]
    : hasMaterialPurchaseContext
    ? [{
        sourceType: "catalog",
        catalogItemId: materialCatalogItemId!,
        reviewRole: "",
        itemName: materialItemName,
        description: "",
        quantity: materialPurchaseTotalUnits,
        unit: materialUnit,
        ...purchaseNeedTimingFromDays(DEFAULT_PURCHASE_DELIVERY_DAYS),
        photoUrls: [],
        notes: `${isTicketMaterial ? "تذكرة الصيانة" : "PM V2"} ${materialTaskNumber}${materialItemCode ? ` · ${t.workflow.purchase.pmv2CodeLabel} ${materialItemCode}` : ""} · ${t.workflow.purchase.pmv2ShortageLinkedQty} ${materialMinimumPurchaseUnits} ${materialUnit}`.trim(),
        siteId: params.get("siteId") || "",
        sectionId: params.get("sectionId") || "",
        assetId: params.get("assetId") || "",
        categoryId: "",
        _contextTouched: {},
      }]
    : [emptyItem("", initialContext)]);

  const canReadCatalogStock = canRoleAccessPath(user?.role, "/inventory");
  const stockCatalogItemIds = useMemo(() => Array.from(new Set(items
    .filter(item => item.sourceType === "catalog" && Number(item.catalogItemId) > 0)
    .map(item => Number(item.catalogItemId)))).sort((a, b) => a - b), [items]);
  const catalogStock = trpc.inventory.catalogStock.useQuery(
    { catalogItemIds: stockCatalogItemIds },
    { enabled: canReadCatalogStock && stockCatalogItemIds.length > 0, staleTime: 15_000, retry: false, refetchOnWindowFocus: false },
  );

  // Catalog item names are governed master data. If the viewer changes the UI
  // language while the form is still open, keep the read-only catalog name in
  // sync with the Arabic/English master fields (Urdu deliberately uses English).
  useEffect(() => {
    setItems(prev => prev.map(item => {
      if (item.sourceType !== "catalog" || (!item._catalogNameAr && !item._catalogNameEn)) return item;
      const localized = language === "ar"
        ? (item._catalogNameAr || item._catalogNameEn || item.itemName)
        : (item._catalogNameEn || item._catalogNameAr || item.itemName);
      return localized === item.itemName ? item : { ...item, itemName: localized };
    }));
  }, [language]);

  // PM V2 passes a stable Catalog Unit ID when the current Master Data can resolve it.
  // Canonicalize the bound PO item to the active Arabic unit name expected by this form.
  // If the unit cannot be resolved, keep the field editable as an explicit fallback.
  useEffect(() => {
    if (!hasMaterialPurchaseContext || !materialCatalogItemId || !materialResolvedCatalogUnit?.nameAr) return;
    const canonicalUnit = String(materialResolvedCatalogUnit.nameAr).trim();
    if (!canonicalUnit) return;
    setItems(prev => {
      const idx = prev.findIndex(item => Number(item.catalogItemId) === materialCatalogItemId);
      if (idx < 0 || prev[idx].unit === canonicalUnit) return prev;
      return prev.map((item, itemIndex) => itemIndex === idx ? { ...item, unit: canonicalUnit } : item);
    });
  }, [hasMaterialPurchaseContext, materialCatalogItemId, materialResolvedCatalogUnit?.nameAr]);

  // PM V2-linked Purchase is intentionally one shortage item = one Purchase item.
  // Keep identity/shortage authoritative; tickets may add separately attributed warehouse stock.
  useEffect(() => {
    if (!hasMaterialPurchaseContext || !materialCatalogItemId) return;
    setItems(prev => {
      const current = prev.find(item => Number(item.catalogItemId) === materialCatalogItemId) || prev[0];
      const canonicalUnit = String(materialResolvedCatalogUnit?.nameAr || current?.unit || materialUnit || "").trim();
      const lockedItem: ItemForm = {
        ...(current || emptyItem()),
        sourceType: "catalog",
        catalogItemId: materialCatalogItemId,
        itemName: materialItemName,
        quantity: materialPurchaseTotalUnits,
        unit: canonicalUnit,
      };
      const alreadyLocked = prev.length === 1
        && prev[0].sourceType === "catalog"
        && Number(prev[0].catalogItemId) === materialCatalogItemId
        && prev[0].itemName === materialItemName
        && Number(prev[0].quantity) === materialPurchaseTotalUnits
        && prev[0].unit === canonicalUnit;
      return alreadyLocked ? prev : [lockedItem];
    });
  }, [hasMaterialPurchaseContext, materialCatalogItemId, materialItemName, materialPurchaseTotalUnits, materialResolvedCatalogUnit?.nameAr, materialUnit, draftLoaded]);

  // تحميل أصناف المسودة عند فتح صفحة التعديل
  useEffect(() => {
    if (draftPO && !draftLoaded) {
      setNotes(draftPO.notes || "");
      if (draftPO.items && draftPO.items.length > 0) {
        setItems(draftPO.items.map((i: any) => ({
          sourceType: i.catalogItemId ? "catalog" as const : "manual" as const,
          catalogItemId: i.catalogItemId ?? null,
          itemName: getLocalizedItemField(i, "itemName", language) || i.itemName || "",
          description: getLocalizedItemField(i, "description", language) || i.description || "",
          quantity: i.quantity || 1,
          unit: i.unit || t.purchaseOrders.defaultUnit,
          ...(i.requiredDate ? purchaseNeedTimingFromDate(i.requiredDate) : purchaseNeedTimingFromDays(i.deliveryLeadDays ?? null)),
          photoUrls: i.photoUrls || (i.photoUrl ? [i.photoUrl] : []),
          notes: i.notes || "",
          siteId: String(i.siteId ?? draftPO.siteId ?? ""),
          sectionId: String(i.sectionId ?? draftPO.sectionId ?? ""),
          assetId: String(i.assetId ?? draftPO.assetId ?? ""),
          categoryId: String(i.categoryId ?? draftPO.categoryId ?? ""),
          reviewRole: purchaseReviewRoleSchema.safeParse(i.reviewRole).success ? i.reviewRole : "",
          _contextTouched: {},
          _existingId: i.id, // نحفظ id الصنف الأصلي
        })));
      }
      setDraftLoaded(true);
    }
  }, [draftPO, draftLoaded]);

  // الطلب المرتبط ببلاغ يبدأ تلقائيًا بنفس موقع/قسم/أصل البلاغ، مع بقاء الحقول قابلة للتعديل.
  useEffect(() => {
    if (draftId || !ticket) return;
    setItems(prev => prev.map(item => ({
      ...item,
      siteId: item.siteId || item._contextTouched?.siteId ? item.siteId : String(ticket.siteId || ""),
      sectionId: item.sectionId || item._contextTouched?.sectionId ? item.sectionId : String(ticket.sectionId || ""),
      assetId: item.assetId || item._contextTouched?.assetId ? item.assetId : String(ticket.assetId || ""),
    })));
  }, [draftId, ticket]);

  const [notes, setNotes] = useState(prefillNotes);
  const [uploadingIdx, setUploadingIdx] = useState<number | null>(null);
  const [showDropZoneIdx, setShowDropZoneIdx] = useState<number | null>(null);

  // ── Dialog States ──────────────────────────────────────────
  const [showCatalogPicker, setShowCatalogPicker] = useState(false);
  const [catalogTargetIndex, setCatalogTargetIndex] = useState<number | null>(null);

  const updateItem = (idx: number, field: keyof ItemForm, value: any) => {
    setItems(prev => prev.map((item, i) => i === idx ? {
      ...item,
      [field]: value,
      ...(field === "siteId" ? { sectionId: "", assetId: "" } : field === "sectionId" ? { assetId: "" } : {}),
      ...(["siteId", "sectionId", "assetId", "categoryId"].includes(field)
        ? { _contextTouched: { ...item._contextTouched, [field]: true, ...(field === "siteId" ? { sectionId: true, assetId: true } : field === "sectionId" ? { assetId: true } : {}) } }
        : {}),
    } : item));
    if (["itemName", "quantity", "deliveryLeadDays", "unit", "siteId", "sectionId", "categoryId", "reviewRole"].includes(field)) {
      setFormErrors(prev => {
        const current = prev.items[idx];
        if (!current?.[field as ItemValidationField]) return prev;
        const nextItemErrors = { ...current };
        delete nextItemErrors[field as ItemValidationField];
        return {
          ...prev,
          items: { ...prev.items, [idx]: nextItemErrors },
        };
      });
    }
  };

const handleUpload = async (idx: number, file: File) => {
  setUploadingIdx(idx);
  try {
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch("/api/upload", { method: "POST", body: formData });
    const data = await res.json();
    if (data.url) {
      const current = items[idx].photoUrls || [];
      if (current.length < 4) {
        updateItem(idx, "photoUrls", [...current, data.url]);
        toast.success(t.common.save);
      } else {
        toast.error(t.purchaseOrders.maxPhotos);
      }
    }
  } catch { toast.error(t.common.close); }
  setUploadingIdx(null);
};

  // عند اختيار صنف من الكاتلوج
const handleCatalogSelect = (catalogItem: any) => {
  if (catalogTargetIndex === null) return;

  setItems(prev =>
    prev.map((item, i) =>
      i === catalogTargetIndex
        ? {
            ...item,
            sourceType: "catalog",
            catalogItemId: catalogItem.id,

            itemName: getLocalizedCatalogName(catalogItem, language),
            description: getLocalizedCatalogDescription(catalogItem, language),
            _catalogNameAr: catalogItem.nameAr || "",
            _catalogNameEn: catalogItem.nameEn || "",
            // Keep the canonical stored value in Arabic, while the Select renders
            // the Arabic/English master label according to the viewer language.
            unit: resolveCatalogUnit(catalogItem.unit, catalogUnits as any[] | undefined)?.nameAr || "",

            photoUrls: catalogItem.primaryImageUrl ? [catalogItem.primaryImageUrl] : [],
          }
        : item
    )
  );
  setFormErrors(prev => {
    const current = prev.items[catalogTargetIndex];
    if (!current) return prev;
    const nextItemErrors = { ...current };
    delete nextItemErrors.itemName;
    delete nextItemErrors.unit;
    return { ...prev, items: { ...prev.items, [catalogTargetIndex]: nextItemErrors } };
  });
};

  const purchaseItemsForSubmit = () => {
    if (!hasMaterialPurchaseContext || !materialCatalogItemId) return items;
    const boundItem = items.find(i => Number(i.catalogItemId) === materialCatalogItemId);
    return boundItem ? [{ ...boundItem, quantity: materialPurchaseTotalUnits }] : [];
  };

  const buildItemsPayload = () =>
    purchaseItemsForSubmit().map(i => ({
      catalogItemId: i.catalogItemId,
      reviewRole: i.reviewRole || null,
      itemName:    i.itemName,
      deliveryLeadDays: i.deliveryLeadDays,
      requiredDate: i.requiredDate || null,
      description: i.description || undefined,
      quantity:    hasMaterialPurchaseContext ? materialPurchaseTotalUnits : i.quantity,
      unit:        i.unit || undefined,
      photoUrl:    i.photoUrls?.[0] || undefined,
      photoUrls:   i.photoUrls?.length ? i.photoUrls : undefined,
      notes:       i.notes || undefined,
      siteId: i.siteId ? Number(i.siteId) : null,
      sectionId: i.sectionId ? Number(i.sectionId) : null,
      assetId: i.assetId ? Number(i.assetId) : null,
      categoryId: i.categoryId ? Number(i.categoryId) : null,
    }));

  const validateMaterialLinkedPurchase = () => {
    if (isTicketMaterial && !ticketExtraValid) {
      toast.error(language === "ar" ? "أدخل كمية إضافة صحيحة وغير سالبة للمستودع" : "Enter a valid non-negative warehouse extra quantity");
      return false;
    }
    if (!hasMaterialPurchaseContext || !materialCatalogItemId) return true;
    const boundItem = items.find((item) => Number(item.catalogItemId) === materialCatalogItemId);
    if (!boundItem || items.length !== 1 || boundItem.sourceType !== "catalog") {
      toast.error(t.workflow.purchase.pmv2SingleShortageOnly);
      return false;
    }
    if (Number(boundItem.quantity || 0) !== materialPurchaseTotalUnits) {
      toast.error(`${t.workflow.purchase.pmv2ShortageQtyFixed} ${materialPurchaseTotalUnits} ${getLocalizedCatalogUnitName(materialResolvedCatalogUnit?.nameAr || materialUnit, catalogUnits as any[] | undefined, language)}`);
      return false;
    }
    if (!String(boundItem.unit || "").trim()) {
      toast.error(t.workflow.purchase.pmv2UnitAutoFailed);
      return false;
    }
    return true;
  };

  const purchaseContextPayload = () => {
    // Replacement orders must retain the original order context for the bridge.
    const context = isReturnReplacement ? initialContext : purchaseItemsForSubmit()[0];
    return {
      siteId: Number(context?.siteId),
      sectionId: Number(context?.sectionId),
      assetId: context?.assetId ? Number(context.assetId) : null,
      categoryId: context?.categoryId ? Number(context.categoryId) : null,
    };
  };

  const validatePurchaseForm = (sending = true) => {
    const next = emptyPurchaseFormErrors();
    let firstMessage = "";
    let firstTargetId: string | undefined;

    const addItemError = (itemIndex: number, field: ItemValidationField, message: string) => {
      next.items[itemIndex] = { ...(next.items[itemIndex] || {}), [field]: message };
      if (!firstMessage) {
        firstMessage = message;
        firstTargetId = `purchase-item-${itemIndex}-${field}`;
      }
    };

    if (items.length === 0) {
      firstMessage ||= t.purchaseOrders.validationNoItems;
    }

    items.forEach((item, itemIndex) => {
      if (!item.siteId) addItemError(itemIndex, "siteId", itemMessage(t.purchaseOrders.validationSiteRequired, itemIndex));
      if (!item.sectionId) addItemError(itemIndex, "sectionId", itemMessage(t.purchaseOrders.validationSectionRequired, itemIndex));
      if (!item.categoryId) addItemError(itemIndex, "categoryId", itemMessage(t.purchaseOrders.validationCategoryRequired, itemIndex));
      if (!purchaseReviewRoleSchema.safeParse(item.reviewRole).success) addItemError(itemIndex, "reviewRole", itemMessage(t.purchaseOrders.validationReviewRoleRequired, itemIndex));
      if (!item.itemName.trim()) {
        addItemError(itemIndex, "itemName", itemMessage(t.purchaseOrders.validationItemNameRequired, itemIndex));
      }

      const minimumQuantity = hasMaterialPurchaseContext && itemIndex === 0 ? materialMinimumPurchaseUnits : 1;
      if (!Number.isFinite(Number(item.quantity)) || Number(item.quantity) < minimumQuantity) {
        addItemError(itemIndex, "quantity", itemMessage(t.purchaseOrders.validationQuantityInvalid, itemIndex));
      }

      const hasTiming = item.deliveryLeadDays != null || Boolean(item.requiredDate);
      const dateDays = remainingPurchaseCalendarDays(item.requiredDate);
      if ((sending && (!isValidPurchaseRequiredDate(item.requiredDate) || !validPurchaseDeliveryDays(dateDays)))
        || (hasTiming && (item.deliveryLeadDays != null && !validPurchaseDeliveryDays(item.deliveryLeadDays)
          || Boolean(item.requiredDate) && !isValidPurchaseRequiredDate(item.requiredDate)))) {
        addItemError(itemIndex, "deliveryLeadDays", itemMessage(t.purchaseOrders.validationDeliveryLeadDays, itemIndex));
      }

      if (hasMaterialPurchaseContext && itemIndex === 0 && !String(item.unit || "").trim()) {
        addItemError(itemIndex, "unit", itemMessage(t.purchaseOrders.validationUnitRequired, itemIndex));
      }
    });

    const hasErrors = Boolean(Object.keys(next.items).length || items.length === 0);
    setFormErrors(next);
    if (!hasErrors) return true;

    toast.error(firstMessage || t.purchaseOrders.validationFailed);
    focusValidationTarget(firstTargetId);
    return false;
  };

  const handleUpdateDraft = () => {
    if (isTicketMaterial) return;
    if (!validatePurchaseForm(false)) return;
    if (isLinkedTicketActionBlocked) {
      toast.error(t.workflow.purchase.linkedPoEditPathBOnly);
      return;
    }
    if (!validateMaterialLinkedPurchase()) return;
    const sourceItems = purchaseItemsForSubmit();
    updateDraftMut.mutate({
      id: draftId!,
      ...purchaseContextPayload(),
      notes: notes || undefined,
      items: (sourceItems as any[]).map(i => ({
        id: i._existingId || undefined,
        catalogItemId: i.catalogItemId ?? null,
        reviewRole: i.reviewRole || null,
        itemName: i.itemName,
        deliveryLeadDays: i.deliveryLeadDays,
        requiredDate: i.requiredDate || null,
        description: i.description || undefined,
        quantity: hasMaterialPurchaseContext ? materialPurchaseTotalUnits : i.quantity,
        unit: i.unit || undefined,
        photoUrl: i.photoUrls?.[0] || undefined,
        photoUrls: i.photoUrls?.length ? i.photoUrls : undefined,
        notes: i.notes || undefined,
        siteId: i.siteId ? Number(i.siteId) : null,
        sectionId: i.sectionId ? Number(i.sectionId) : null,
        assetId: i.assetId ? Number(i.assetId) : null,
        categoryId: i.categoryId ? Number(i.categoryId) : null,
      })),
    });
  };

  const handleSaveDraft = () => {
    if (isTicketMaterial || isReturnReplacement) return;
    if (!validatePurchaseForm(false)) return;
    if (!validateMaterialLinkedPurchase()) return;
    if (isLinkedTicketActionBlocked) {
      toast.error(t.workflow.purchase.linkedPoSavePathBOnly);
      return;
    }
    const validItems = buildItemsPayload();
    saveDraftMut.mutate({ fromIdeaId, ticketId, ticketItemId, ...purchaseContextPayload(), notes: notes || undefined, items: validItems });
  };

  const handleSubmit = () => {
    if (!validatePurchaseForm()) return;
    if (!validateMaterialLinkedPurchase()) return;
    if (isLinkedTicketActionBlocked) {
      toast.error(t.workflow.purchase.linkedPoSubmitPathBOnly);
      return;
    }
    const body = {
      fromIdeaId,
      ticketId,
      ticketItemId,
      supplierReturnPlanId: isReturnReplacement ? supplierReturnPlanId : undefined,
      pmv2RequestItemId: hasMaterialPurchaseContext && !isTicketMaterial ? materialRequestItemId : undefined,
      ...purchaseContextPayload(),
      notes: notes || undefined,
      items: buildItemsPayload(),
    };
    const fingerprint = JSON.stringify({ ...body, ...(isTicketMaterial ? { warehouseExtraQuantity: ticketWarehouseExtraQuantity } : {}) });
    if (isTicketMaterial && ticketOperationKey.current?.fingerprint !== fingerprint) ticketOperationKey.current = { fingerprint, key: 'mtt:' + crypto.randomUUID() };
    if (isTicketMaterial && (params.has("pmv2RequestItemId") || !hasMaterialPurchaseContext || !Number.isSafeInteger(ticketTeamAssignmentId) || ticketTeamAssignmentId <= 0 || !Number.isSafeInteger(ticketTeamNeedId) || ticketTeamNeedId <= 0 || !Number.isSafeInteger(ticketTeamRevision) || ticketTeamRevision < 0)) { toast.error("سياق طلب مواد التذكرة غير صالح؛ افتح الطلب من قائمة المستودع"); return; }
    createMut.mutate({ ...body, ...(isTicketMaterial ? { ticketTeam: { assignmentId: ticketTeamAssignmentId, needId: ticketTeamNeedId, expectedRevision: ticketTeamRevision, operationKey: ticketOperationKey.current!.key, warehouseExtraQuantity: ticketWarehouseExtraQuantity } } : {}) });
  };


  return (
    <div className="max-w-4xl space-y-6">
      {isReturnReplacement && <Card className="border-amber-300 bg-amber-50"><CardContent className="p-4 text-sm text-amber-900">طلب شراء بديل للمرتجع. يُنشأ صنف واحد مرتبط بالطلب الأصلي، ويُحسب فرق السعر من رصيد المرتجع أثناء التسعير.</CardContent></Card>}
      {isTicketMaterial && <Card><CardContent className="space-y-3 p-4"><p className="font-semibold">{language === "ar" ? "طلب شراء مواد تذكرة الصيانة" : "Maintenance ticket material purchase"} — {materialTaskNumber}</p><p>{materialItemName}</p><WarehousePurchaseQuantities id="ticket-purchase" technicianQuantity={ticketTechnicianQuantity} purchaseQuantity={materialMinimumPurchaseUnits} extra={ticketWarehouseExtra} unit={materialUnit} language={language} disabled={createMut.isPending} onExtraChange={setTicketWarehouseExtra} /></CardContent></Card>}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => goBackOrFallback(setLocation, linkedTicketId ? `/tickets/${linkedTicketId}` : hasMaterialPurchaseContext ? "/scheduled-maintenance/warehouse-requests" : "/purchase-orders")}>
          <ArrowRight className={`w-5 h-5 ${dir === "ltr" ? "rotate-180" : ""}`} />
        </Button>
        <div>
          <h1 className="text-xl font-bold">{draftId ? `${t.purchaseOrders.editDraft || "Edit draft"} ${draftPO?.poNumber || ""}` : t.purchaseOrders.createNew}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{t.purchaseOrders.items}</p>
        </div>
      </div>

      {ticket && (
        <Card className="border-teal-200 bg-teal-50/50">
          <CardContent className="p-4 flex items-center gap-3">
            <Link2 className="w-5 h-5 text-teal-600 shrink-0" />
            <div>
              <p className="text-sm font-medium text-teal-800">{t.purchaseOrders.relatedTicket}: {ticket.ticketNumber}</p>
              <p className="text-xs text-teal-600">{ticket.title} — {ticket.locationDetail || ""}</p>
            </div>
            <Button variant="ghost" size="sm" className="mr-auto text-xs" onClick={() => goBackOrFallback(setLocation, `/tickets/${linkedTicketId}`)}>
              {t.common.back}
            </Button>
          </CardContent>
        </Card>
      )}

      {hasMaterialPurchaseContext && !isTicketMaterial && (
        <Card className="border-amber-200 bg-amber-50/60">
          <CardContent className="p-4 space-y-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <ShoppingCart className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-amber-900">{t.workflow.purchase.pmv2ShortagePoTitle}</p>
                  <p className="text-xs text-amber-700">{t.workflow.purchase.pmv2ShortagePoHelp}</p>
                </div>
              </div>
              <Badge variant="outline" className="border-amber-300 bg-amber-100 text-amber-900">
                {t.workflow.purchase.pmv2LinkedTask}
              </Badge>
            </div>
            <div className="grid gap-2 rounded-md border border-amber-200 bg-white/60 p-3 text-sm sm:grid-cols-2">
              <p><span className="text-muted-foreground">{t.workflow.purchase.referenceLabel}</span> <span className="font-medium">PM V2</span></p>
              <p><span className="text-muted-foreground">{t.workflow.purchase.linkedTaskLabel}</span> <span className="font-medium">{materialTaskNumber}</span></p>
              <p><span className="text-muted-foreground">{t.workflow.purchase.requestReasonLabel}</span> <span className="font-medium">{t.workflow.purchase.scheduledMaterialShortage}</span></p>
              <p><span className="text-muted-foreground">{t.workflow.purchase.linkedItemLabel}</span> <span className="font-medium">{materialItemName}{materialItemCode ? ` · ${materialItemCode}` : ""}</span></p>
              {materialTaskNeedQuantity > 0 && (
                <p><span className="text-muted-foreground">{t.workflow.purchase.taskNeedLabel}</span> <span className="font-medium">{materialTaskNeedQuantity} {materialUnit}</span></p>
              )}
              {materialTeamAvailableAtRequest != null && (
                <p><span className="text-muted-foreground">{t.workflow.purchase.teamAvailableAtShortage}</span> <span className="font-medium">{materialTeamAvailableAtRequest} {materialUnit}</span></p>
              )}
              <p><span className="text-muted-foreground">{t.workflow.purchase.purchaseQtyLabel}</span> <span className="font-semibold text-amber-900">{materialMinimumPurchaseUnits} {getLocalizedCatalogUnitName(materialResolvedCatalogUnit?.nameAr || materialUnit, catalogUnits as any[] | undefined, language)}</span></p>
              {materialRequestId && materialRequestItemId && (
                <p><span className="text-muted-foreground">{t.workflow.purchase.pmv2MaterialReference}</span> <span className="font-medium">{t.workflow.purchase.requestNumber} #{materialRequestId} · {t.workflow.purchase.itemNumber} #{materialRequestItemId}</span></p>
              )}
            </div>
            <p className="text-xs text-amber-800">
              {t.workflow.purchase.pmv2PoFixedScopeHelp}
            </p>
          </CardContent>
        </Card>
      )}

      {isLinkedTicketInvalid && ticket && (
        <Card className="border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950/20">
          <CardContent className="p-4 flex items-start gap-3 text-red-800 dark:text-red-300">
            <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="font-semibold">{t.workflow.purchase.cannotCreateEditPo}</p>
              <p className="text-sm">
                {t.workflow.purchase.linkedPoPathBHelp}
                {t.workflow.purchase.currentPath} {ticket.maintenancePath || t.workflow.purchase.unspecified} — {t.workflow.purchase.currentStatus} {ticket.status}.
              </p>
            </div>
          </CardContent>
        </Card>
      )}


{items.map((item, idx) => {
  const isMaterialBoundItem = Boolean(hasMaterialPurchaseContext && idx === 0 && item.catalogItemId === materialCatalogItemId);
  const minimumQuantity = isMaterialBoundItem ? materialMinimumPurchaseUnits : 1;
  const itemErrors = formErrors.items[idx] || {};
  return (
  <Card key={idx} className={cn(Object.keys(itemErrors).length > 0 && "border-destructive/70")}>
    <CardHeader className="pb-3">
      <div className="flex items-center justify-between">
        <CardTitle className="text-sm">
          {t.purchaseOrders.itemName} #{idx + 1}
        </CardTitle>

        {items.length > 1 && !isMaterialBoundItem && !isReturnReplacement && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-destructive hover:text-destructive"
            onClick={() => {
              setItems(prev => prev.filter((_, i) => i !== idx));
              // بعد حذف صف تتغير أرقام الأصناف؛ امسح أخطاء الأصناف القديمة كي لا
              // تنتقل رسالة الصنف المحذوف إلى الصنف الذي يليه.
              setFormErrors(prev => ({ ...prev, items: {} }));
            }}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        )}
      </div>
    </CardHeader>

    <CardContent className="space-y-4">

      {/* نوع الصنف */}
      <div className="space-y-2">
        <Label>{t.purchaseOrders.itemSourceType}</Label>

        <select
          value={item.sourceType}
          disabled={isMaterialBoundItem || isReturnReplacement}
          onChange={(e) => {
            const value = e.target.value as "catalog" | "manual";

            setItems(prev => prev.map((current, i) =>
              i === idx
                ? {
                    ...current,
                    sourceType: value,
                    // الرجوع للإدخال اليدوي يفصل الرابط فعليًا حتى لا يبقى
                    // بند يدوي مرتبطًا بصنف كتالوج قديم بالخطأ.
                    catalogItemId: value === "manual" ? null : current.catalogItemId,
                  }
                : current
            ));

            if (value === "catalog") {
              setCatalogTargetIndex(idx);
              setShowCatalogPicker(true);
            }
          }}
          className="w-full h-10 rounded-md border bg-background px-3 text-sm"
        >
          {(item as any)._existingId && item.sourceType === "manual" && (
            <option value="manual">{t.purchaseOrders.legacyManualItem}</option>
          )}
          <option value="catalog">{t.purchaseOrders.itemSourceCatalog}</option>
        </select>
        {!isMaterialBoundItem && !isReturnReplacement && (
          <Button variant="outline" size="sm" className="gap-2" onClick={() => {
            setCatalogTargetIndex(idx);
            setShowCatalogPicker(true);
          }}>
            <BookOpen className="w-4 h-4" />{t.workflow.purchase.fromCatalog}
          </Button>
        )}
      </div>

      {/* اسم الصنف */}
      <div className="space-y-2">
        <Label>{t.purchaseOrders.itemName} *</Label>

        <Textarea
          id={`purchase-item-${idx}-itemName`}
          dir="auto"
          value={item.itemName}
          readOnly={item.sourceType === "catalog"}
          maxLength={300}
          rows={2}
          aria-invalid={Boolean(itemErrors.itemName)}
          className={cn(itemErrors.itemName && "border-destructive focus-visible:ring-destructive")}
          onClick={() => {
            if (item.sourceType === "catalog" && !isMaterialBoundItem && !isReturnReplacement) {
              setCatalogTargetIndex(idx);
              setShowCatalogPicker(true);
            }
          }}
          onChange={e =>
            updateItem(idx, "itemName", e.target.value.slice(0, 300))
          }
        />
        {itemErrors.itemName && <p className="text-xs text-destructive">{itemErrors.itemName}</p>}
        <p className="text-[11px] text-muted-foreground text-start">
          {item.itemName.length} / 300
        </p>
        {item.sourceType === "catalog" && item.catalogItemId != null && (
          <CatalogStockField
            stock={catalogStock.data?.find(value => value.catalogItemId === item.catalogItemId)}
            loading={catalogStock.isFetching}
            failed={catalogStock.isError}
            canRead={canReadCatalogStock}
            units={catalogUnits || []}
          />
        )}
      </div>

      <div className="rounded-md border bg-muted/20 p-3 space-y-3">
        <p className="text-xs font-semibold">{language === "ar" ? "بيانات الصنف" : "Item context"}</p>
        <div className="space-y-1">
          <Label htmlFor={`purchase-item-${idx}-reviewRole`}>{t.purchaseOrders.reviewRoleLabel} *</Label>
          <Select value={item.reviewRole} onValueChange={value => updateItem(idx, "reviewRole", value)}>
            <SelectTrigger id={`purchase-item-${idx}-reviewRole`} aria-invalid={Boolean(itemErrors.reviewRole)} className={cn(itemErrors.reviewRole && "border-destructive focus:ring-destructive")}><SelectValue placeholder={t.purchaseOrders.reviewRolePlaceholder} /></SelectTrigger>
            <SelectContent>{PURCHASE_REVIEW_ROLES.map(role => <SelectItem key={role} value={role}>{role === "general_maintenance_manager" ? t.purchaseOrders.reviewRoleGeneral : role === "construction_procurement_manager" ? t.purchaseOrders.reviewRoleConstruction : t.purchaseOrders.reviewRoleOther}</SelectItem>)}</SelectContent>
          </Select>
          {itemErrors.reviewRole && <p className="text-xs text-destructive">{itemErrors.reviewRole}</p>}
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="space-y-1">
            <Label>{t.tickets.site} *</Label>
            <Select value={item.siteId} onValueChange={value => updateItem(idx, "siteId", value)}>
              <SelectTrigger id={`purchase-item-${idx}-siteId`} aria-invalid={Boolean(itemErrors.siteId)} className={cn(itemErrors.siteId && "border-destructive focus:ring-destructive")}><SelectValue placeholder={t.workflow.ticket.chooseSite} /></SelectTrigger>
              <SelectContent>{(sites as any[]).map((site: any) => <SelectItem key={site.id} value={String(site.id)}>{getLocalizedName(site, language)}</SelectItem>)}</SelectContent>
            </Select>
            {itemErrors.siteId && <p className="text-xs text-destructive">{itemErrors.siteId}</p>}
          </div>
          <div className="space-y-1">
            <Label>{t.tickets.section} *</Label>
            <Select value={item.sectionId} disabled={!item.siteId} onValueChange={value => updateItem(idx, "sectionId", value)}>
              <SelectTrigger id={`purchase-item-${idx}-sectionId`} aria-invalid={Boolean(itemErrors.sectionId)} className={cn(itemErrors.sectionId && "border-destructive focus:ring-destructive")}><SelectValue placeholder={item.siteId ? t.workflow.ticket.chooseSection : t.tickets.selectSiteFirst} /></SelectTrigger>
              <SelectContent>{(allSections as any[]).filter((section: any) => String(section.siteId) === item.siteId).map((section: any) => <SelectItem key={section.id} value={String(section.id)}>{getLocalizedName(section, language)}</SelectItem>)}</SelectContent>
            </Select>
            {itemErrors.sectionId && <p className="text-xs text-destructive">{itemErrors.sectionId}</p>}
          </div>
          <div className="space-y-1">
            <Label>{t.tickets.category} *</Label>
            <Select value={item.categoryId || "__none__"} onValueChange={value => updateItem(idx, "categoryId", value === "__none__" ? "" : value)}>
              <SelectTrigger id={`purchase-item-${idx}-categoryId`} aria-invalid={Boolean(itemErrors.categoryId)} className={cn(itemErrors.categoryId && "border-destructive focus:ring-destructive")}><SelectValue placeholder={t.purchaseOrders.selectCategoryOptional} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">{t.purchaseOrders.withoutCategory}</SelectItem>
                {(purchaseCategories as any[]).map((category: any) => <SelectItem key={category.id} value={String(category.id)} disabled={!category.isActive}>{category.name}</SelectItem>)}
              </SelectContent>
            </Select>
            {itemErrors.categoryId && <p className="text-xs text-destructive">{itemErrors.categoryId}</p>}
          </div>
          <div className="space-y-1">
            <Label>{language === "ar" ? "الأصل (اختياري)" : "Asset (optional)"}</Label>
            <Select value={item.assetId || "__none__"} disabled={!item.sectionId} onValueChange={value => updateItem(idx, "assetId", value === "__none__" ? "" : value)}>
              <SelectTrigger><SelectValue placeholder={t.purchaseOrders.selectAssetOptional} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">{t.purchaseOrders.withoutAsset}</SelectItem>
                {(allAssets as any[]).filter((asset: any) => String(asset.siteId) === item.siteId && String(asset.sectionId) === item.sectionId).map((asset: any) => <SelectItem key={asset.id} value={String(asset.id)}>{getLocalizedName(asset, language)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* الوصف */}
      <div className="space-y-2">
        <Label>{t.purchaseOrders.details}</Label>

        <Textarea
          dir="auto"
          value={item.description}
          maxLength={1500}
          onChange={e =>
            updateItem(idx, "description", e.target.value.slice(0, 1500))
          }
          rows={2}
        />
        <p className="text-[11px] text-muted-foreground text-start">
          {item.description.length} / 1500
        </p>
      </div>

      <PurchaseItemNeedFields
        index={idx}
        deliveryLeadDays={item.deliveryLeadDays}
        requiredDate={item.requiredDate}
        error={itemErrors.deliveryLeadDays}
        onChange={timing => {
          updateItem(idx, "deliveryLeadDays", timing.deliveryLeadDays ?? null);
          updateItem(idx, "requiredDate", timing.requiredDate || "");
        }}
      />

      {/* الكمية والوحدة والصورة */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">

        {/* الكمية */}
        <div className="space-y-2">
          <Label>{t.purchaseOrders.quantity} *</Label>

          <Input
            id={`purchase-item-${idx}-quantity`}
            type="number"
            min={minimumQuantity}
            value={item.quantity}
            disabled={isMaterialBoundItem || isReturnReplacement}
            aria-invalid={Boolean(itemErrors.quantity)}
            className={cn(isTicketMaterial && isMaterialBoundItem && "border-emerald-300 bg-emerald-50/50 font-semibold text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/20 dark:text-emerald-100", itemErrors.quantity && "border-destructive focus-visible:ring-destructive")}
            onChange={e =>
              updateItem(
                idx,
                "quantity",
                Math.max(minimumQuantity, parseInt(e.target.value) || minimumQuantity)
              )
            }
          />
          {itemErrors.quantity && <p className="text-xs text-destructive">{itemErrors.quantity}</p>}
          {isMaterialBoundItem && (
            <p className="text-xs text-muted-foreground">{t.workflow.purchase.pmv2QtyFixed}</p>
          )}
        </div>

        {/* الوحدة */}
        <div className="space-y-2">
          <Label>{t.purchaseOrders.unit}</Label>

          <Select
            value={item.unit}
            onValueChange={value => updateItem(idx, "unit", value)}
            disabled={(item.sourceType === "catalog" && item.catalogItemId != null) || (isMaterialBoundItem && Boolean(materialResolvedCatalogUnit)) || isReturnReplacement}
          >
            <SelectTrigger
              id={`purchase-item-${idx}-unit`}
              dir="auto"
              aria-invalid={Boolean(itemErrors.unit)}
              className={cn(itemErrors.unit && "border-destructive focus:ring-destructive")}
            >
              <SelectValue placeholder={t.purchaseOrders.unit}>
                {item.sourceType === "catalog" && item.catalogItemId != null && item.unit
                  ? getLocalizedCatalogUnitName(item.unit, catalogUnits as any[] | undefined, language)
                  : undefined}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {(catalogUnits || []).map((u: any) => (
                <SelectItem key={u.id} value={u.nameAr}>
                  <span dir={language === "ar" ? "rtl" : "ltr"}>{getLocalizedCatalogUnitName(u.nameAr, catalogUnits as any[] | undefined, language)}</span>
                </SelectItem>
              ))}
              {/* مسودة تاريخية فقط: نُظهر الوحدة القديمة كقيمة محفوظة غير قابلة للاختيار من جديد. */}
              {(item as any)._existingId && item.unit && !(catalogUnits || []).some((u: any) => u.nameAr === item.unit || u.nameEn === item.unit) && (
                <SelectItem value={item.unit} disabled>{getLocalizedCatalogUnitName(item.unit, catalogUnits as any[] | undefined, language)} ({t.workflow.purchase.historicalDisabled})</SelectItem>
              )}
            </SelectContent>
          </Select>
          {itemErrors.unit && <p className="text-xs text-destructive">{itemErrors.unit}</p>}
          {isMaterialBoundItem && !materialResolvedCatalogUnit && (
            <p className="text-xs text-amber-700">
              {t.workflow.purchase.pmv2UnitNeedsSelection}
            </p>
          )}
        </div>

{/* الصور — حتى 4 */}
<div className="space-y-2">
  <Label>
    {t.tickets.photos}
    <span className="text-xs text-muted-foreground ms-2">
      ({(item.photoUrls || []).length}/4)
    </span>
  </Label>

  {/* عرض الصور المرفوعة */}
  {(item.photoUrls || []).length > 0 && (
    <div className="grid grid-cols-4 gap-2">
      {(item.photoUrls || []).map((url, pIdx) => (
        <div key={pIdx} className="relative">
          <img
            src={url}
            alt=""
            className="w-full h-16 rounded-lg object-cover border"
          />
          <Button
            variant="destructive"
            size="icon"
            className="absolute top-0.5 left-0.5 h-5 w-5"
            onClick={() => {
              const updated = (item.photoUrls || []).filter((_, i) => i !== pIdx);
              updateItem(idx, "photoUrls", updated);
            }}
          >
            <Trash2 className="w-3 h-3" />
          </Button>
        </div>
      ))}
    </div>
  )}

  {/* أزرار الرفع — تظهر فقط إذا أقل من 4 */}
  {(item.photoUrls || []).length < 4 && (
    showDropZoneIdx === idx ? (
      <DropZone
        maxFiles={4 - (item.photoUrls || []).length}
        accept="image/*"
        label={t.purchaseOrders.dragItemPhoto}
        sublabel={`${t.purchaseOrders.maxPhotos}`}
        onFilesUploaded={(files: UploadedFile[]) => {
          const uploaded = files
            .filter(f => f.status === "done" && f.url)
            .map(f => f.url!);
          if (uploaded.length > 0) {
            const current = item.photoUrls || [];
            const combined = [...current, ...uploaded].slice(0, 4);
            updateItem(idx, "photoUrls", combined);
            setShowDropZoneIdx(null);
          }
        }}
      />
    ) : (
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          className="flex-1 h-16 border-dashed gap-1"
          onClick={() => {
            const input = document.createElement("input");
            input.type = "file";
            input.accept = "image/*";
            input.multiple = true;
            input.onchange = async (e: any) => {
              const files: File[] = Array.from(e.target.files || []);
              const remaining = 4 - (item.photoUrls || []).length;
              for (const file of files.slice(0, remaining)) {
                await handleUpload(idx, file);
              }
            };
            input.click();
          }}
          disabled={uploadingIdx === idx}
        >
          {uploadingIdx === idx ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Camera className="w-4 h-4" />
          )}
          {uploadingIdx === idx ? "..." : t.common.upload}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-16 px-3 border-dashed"
          onClick={() => setShowDropZoneIdx(idx)}
          title={t.purchaseOrders.dragAndDrop}
        >
          <Upload className="w-4 h-4" />
        </Button>
      </div>
    )
  )}
</div> {/* إغلاق div الصور space-y-2 */}

      </div> {/* إغلاق grid grid-cols-2 md:grid-cols-3 */}

      {/* المبررات */}
      <div className="space-y-2">
        <Label>{t.purchaseOrders.justification}</Label>

        <Textarea
          dir="auto"
          value={item.notes}
          maxLength={200}
          rows={2}
          onChange={e =>
            updateItem(idx, "notes", e.target.value.slice(0, 200))
          }
        />
        <p className="text-[11px] text-muted-foreground text-start">
          {item.notes.length} / 200
        </p>
      </div>

    </CardContent>
  </Card>
  );
})}

{/* طلب PM V2 المرتبط = عجز واحد / صنف واحد، لذلك لا يظهر زر إضافة صنف. */}
{!hasMaterialPurchaseContext && !isReturnReplacement && (
  <Button
    variant="outline"
    onClick={() => setItems(prev => [...prev, emptyItem("", prev[0] || initialContext)])}
    className="w-full gap-2 border-dashed h-12"
  >
    <Plus className="w-4 h-4" /> {t.common.add}
  </Button>
)}

      <div className="space-y-3">
        <Textarea
          dir="auto"
          placeholder={t.purchaseOrders.justification}
          value={notes}
          onChange={e => setNotes(e.target.value)}
        />
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3 text-sm">
              <span className="text-muted-foreground">
                {items.filter(i => i.itemName.trim()).length} {t.purchaseOrders.items}
              </span>
              {ticket && (
                <span className="text-xs text-muted-foreground">
                  {t.purchaseOrders.relatedTicket}: {ticket.ticketNumber}
                </span>
              )}
            </div>
            {draftId ? (
              <Button
                onClick={handleUpdateDraft}
                disabled={updateDraftMut.isPending || isLinkedTicketActionBlocked}
                className="w-full gap-2"
                size="lg"
              >
                {updateDraftMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                {t.purchaseOrders.saveChanges}
              </Button>
            ) : (
            <div className="flex gap-2">
              {!hasMaterialPurchaseContext && !isReturnReplacement && (
                <Button
                  variant="outline"
                  onClick={handleSaveDraft}
                  disabled={saveDraftMut.isPending || createMut.isPending || isLinkedTicketActionBlocked}
                  className="flex-1 gap-2"
                  size="lg"
                >
                  {saveDraftMut.isPending
                    ? <Loader2 className="w-4 h-4 animate-spin" />
                    : <BookOpen className="w-4 h-4" />}
                  {t.purchaseOrders.saveDraft}
                </Button>
              )}
              <Button
                onClick={handleSubmit}
                disabled={createMut.isPending || saveDraftMut.isPending || isLinkedTicketActionBlocked || (isTicketMaterial && !ticketExtraValid)}
                className={cn("flex-1 gap-2", isTicketMaterial && "bg-amber-600 text-white hover:bg-amber-700")}
                size="lg"
              >
                {createMut.isPending
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <ShoppingCart className="w-4 h-4" />}
                {t.common.submit}
              </Button>
            </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Dialog الكاتلوج */}
      <CatalogPickerDialog
        open={showCatalogPicker}
        onClose={() => setShowCatalogPicker(false)}
        onSelect={handleCatalogSelect}
      />
    </div>
  );
}
