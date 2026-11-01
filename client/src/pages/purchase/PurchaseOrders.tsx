import { PricingBundleLink, PricingBundleAddButton } from "@/components/purchase/PricingBundleActions";
import { DelegateSupplyRows } from "@/components/purchase/DelegateSupplyRows";
import { DelegateCompletedItems, completedLabels } from "@/components/purchase/DelegateCompletedItems";
import { SupplierReturns } from "@/components/purchase/SupplierReturns";
import { BundleApprovalCards } from "@/components/purchase/UnifiedBundleApproval";
import { trpc } from "@/lib/trpc";
import { independentReadOptions } from "@/lib/read-transport";
import { readHistoryEntryState, writeHistoryEntryState } from "@/lib/backStack";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationPrevious,
  PaginationNext,
} from "@/components/ui/pagination";
import { Input } from "@/components/ui/input";
import { Plus, ShoppingCart, Trash2, User, Package, Search, History, Truck, CalendarDays, Clock3, Banknote, ChevronLeft } from "lucide-react";
import { useState, useEffect, Fragment, useMemo, useRef } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { useTranslation } from "@/contexts/LanguageContext";
import { useStaticLabels, getLocalizedItemField } from "@/hooks/useContentTranslation";
import { useAuth } from "@/_core/hooks/useAuth";
import { toast } from "sonner";
import { ExportButton } from "@/components/common/ExportButton";
import { PurchaseCardList } from "@/components/purchase/PurchaseCardList";
import { PurchaseBatchCard } from "@/components/purchase/PurchaseBatchCard";
import { Boxes } from "lucide-react";
import { localizeApiError } from "@/i18n/apiError";
import { getLocalizedCatalogUnitName } from "@/i18n/catalogMasterData";
import { formatAvailableDuration, formatDateOnly, formatOverdueDuration, formatRemainingPurchaseDuration, getAvailableCalendarDays, getOverdueCalendarDays } from "@/lib/purchaseItemTiming";
import { comparePurchaseRequiredDates, remainingPurchaseCalendarDays } from "@shared/purchaseItemNeedDate";
import { canRoleAccessPurchaseSupplyTracking, canRoleViewAllPurchaseSupplyTracking } from "@shared/roles";
import { formatPurchaseSubmissionTime } from "@shared/purchaseSubmissionTime";

const PO_STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
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

// الأدوار التي تملك صلاحية رؤية فلتر المستخدم
const FULL_ACCESS_ROLES = ["owner", "admin", "maintenance_manager", "general_maintenance_manager", "construction_procurement_manager", "purchase_manager", "senior_management", "executive_director", "accountant", "warehouse"];

type PurchaseOrdersHistoryState = {
  statusFilter: string;
  dateFrom: string;
  dateTo: string;
  requestedById: string;
  searchQuery: string;
  currentPage: number;
  view: "actionable" | "items" | "tracking" | "supply" | "completed" | "returns" | "all";
};

type DelegateActionFilter = "all" | "estimate" | "purchase";
type DelegateDateFilter = "all" | "today" | "7d" | "30d" | "custom";
type SupplyDelayFilter = "all" | "1" | "3" | "7" | "custom";
type SupplyOwnershipFilter = "all" | "mine";

const PURCHASE_ORDERS_HISTORY_KEY = "__cmmsPurchaseOrdersState";

export default function PurchaseOrders() {
  const [, setLocation] = useLocation();
  const { t, language, dir } = useTranslation();
  const { getPOStatusLabel, getPOItemStatusLabel } = useStaticLabels();
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const { data: catalogUnits = [] } = trpc.catalog.units.list.useQuery();
  const displayUnit = (value: string | null | undefined) =>
    getLocalizedCatalogUnitName(value, catalogUnits as any[], language);

  const savedHistoryState = useMemo(
    () => readHistoryEntryState<PurchaseOrdersHistoryState>(PURCHASE_ORDERS_HISTORY_KEY),
    [],
  );

  // فلاتر
  const [statusFilter, setStatusFilter] = useState(savedHistoryState?.statusFilter ?? "all");
  const [dateFrom, setDateFrom] = useState(savedHistoryState?.dateFrom ?? "");
  const [dateTo, setDateTo] = useState(savedHistoryState?.dateTo ?? "");
  const [requestedById, setRequestedById] = useState(savedHistoryState?.requestedById ?? "all");
  const [searchQuery, setSearchQuery] = useState(savedHistoryState?.searchQuery ?? "");

  // فلاتر تبويب المندوب «أصنافي بانتظار المعالجة» فقط.
  // تبقى منفصلة عن فلاتر الطلبات العامة حتى لا تؤثر على بقية الأدوار/التبويبات.
  const [delegateItemsSearch, setDelegateItemsSearch] = useState("");
  const [delegateActionFilter, setDelegateActionFilter] = useState<DelegateActionFilter>("all");
  const [delegateDateFilter, setDelegateDateFilter] = useState<DelegateDateFilter>("all");
  const [delegateDateFrom, setDelegateDateFrom] = useState("");
  const [delegateDateTo, setDelegateDateTo] = useState("");
  const [delegateClock, setDelegateClock] = useState(() => new Date());
  useEffect(() => {
    if (user?.role !== "delegate") return;
    const timer = window.setInterval(() => setDelegateClock(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, [user?.role]);

  // فلاتر «متابعة التوريد». فلتر التأخير يعني: تجاوز تاريخ الاحتياج بهذه
  // المدة أو أكثر، ويطبّق فقط على الأصناف التي لم تصل لمرحلة الشراء.
  const [supplySearch, setSupplySearch] = useState("");
  const [supplyOwnershipFilter, setSupplyOwnershipFilter] = useState<SupplyOwnershipFilter>("all");
  const [supplyDelayFilter, setSupplyDelayFilter] = useState<SupplyDelayFilter>("all");
  const [supplyCustomDays, setSupplyCustomDays] = useState("5");
  const [supplyDelegateFilter, setSupplyDelegateFilter] = useState("all");

  // ── تقسيم الصفحات (Pagination): 10 طلبات بكل صفحة ──
  const PAGE_SIZE = 10;
  const [currentPage, setCurrentPage] = useState(savedHistoryState?.currentPage && savedHistoryState.currentPage > 0 ? savedHistoryState.currentPage : 1);
  const didMountFilters = useRef(false);

  // ── عرض "بانتظار إجرائي" مقابل "جميع الطلبات" ──
  // مدير الصيانة دوره إشرافي ويتابع جميع الطلبات بغض النظر عن منشئها، لذلك
  // يبدأ من العرض الكامل. المندوب يبدأ بأصنافه، وبقية الأدوار تبدأ بانتظار إجرائها.
  const [selectedView, setView] = useState<"actionable" | "items" | "tracking" | "supply" | "completed" | "returns" | "all">(savedHistoryState?.view ?? "actionable");
  // Old saved views remain valid for other roles; delegates enter their existing item queue.
  const canViewReturns = ["delegate", "admin", "owner", "maintenance_manager", "general_maintenance_manager", "construction_procurement_manager", "it_manager", "purchase_manager", "accountant", "senior_management", "executive_director", "user", "operator", "technician", "it_member", "supervisor", "purchase_requester", "food_warehouse_manager", "food_warehouse_assistant"].includes(user?.role || "");
  const returnStatus = trpc.supplierReturns.status.useQuery(undefined, { enabled: canViewReturns });
  const view = user?.role === "delegate" && selectedView !== "items" && selectedView !== "supply" && selectedView !== "completed" && selectedView !== "returns" ? "items" : selectedView;
  useEffect(() => {
    if (["maintenance_manager", "general_maintenance_manager", "construction_procurement_manager"].includes(user?.role || "")) {
      setView("all");
    }
  }, [user?.role]);
  useEffect(() => {
    if (user?.role && user.role !== "delegate" && (view === "items" || view === "completed" || (view === "returns" && !canViewReturns))) {
      setView("actionable");
    }
  }, [user?.role, view, canViewReturns]);
  const canAccessSupplyTracking = canRoleAccessPurchaseSupplyTracking(user?.role);
  const canViewAllSupplyTracking = canRoleViewAllPurchaseSupplyTracking(user?.role);
  const canAccessMyItemsTracking = ![
    "maintenance_manager",
    "general_maintenance_manager",
    "construction_procurement_manager",
  ].includes(user?.role || "");
  useEffect(() => {
    if (view === "supply" && user?.role && !canAccessSupplyTracking) setView("actionable");
  }, [view, user?.role, canAccessSupplyTracking]);
  useEffect(() => {
    if (view === "tracking" && user?.role && !canAccessMyItemsTracking) {
      setView(canAccessSupplyTracking ? "supply" : "actionable");
    }
  }, [view, user?.role, canAccessMyItemsTracking, canAccessSupplyTracking]);

  const { data: actionable, isLoading: actionableLoading } =
    trpc.purchaseOrders.actionableForMe.useQuery(undefined, { enabled: !!user && user.role !== "delegate", ...independentReadOptions });
  const actionableItems = actionable?.items ?? [];

  // [PB-ACTIONABLE 2026-08-31] الحسابات والإدارة العليا تعملان على مستوى
  // دفعة الإرسال داخل الحزمة. نجلب تمثيل الدفعات مرة واحدة لتبويب
  // «بانتظار إجرائي» فقط، مع إبقاء الطلبات المفردة القديمة كما هي.
  const isPackageSubmissionActionRole =
    user?.role === "accountant" || user?.role === "senior_management";
  const unifiedApprovalQ=trpc.delegatePricingBundles.approvalQueue.useQuery(undefined,{enabled:isPackageSubmissionActionRole,retry:false,...independentReadOptions});
  const unifiedApprovalItems=unifiedApprovalQ.data?.items||[];
  const unifiedSubmissionIds=new Set(unifiedApprovalItems.flatMap((row:any)=>row.submissionIds));
  const unifiedOrderIds=new Set(unifiedApprovalItems.flatMap((row:any)=>row.coveredOrderIds));
  const { data: actionableSubmissions, isLoading: actionableSubmissionsLoading } =
    trpc.purchasePackages.actionableSubmissionsForMe.useQuery(undefined, {
      enabled: isPackageSubmissionActionRole,
      ...independentReadOptions,
    });
  const actionableSubmissionItems = (actionableSubmissions?.items ?? []).filter((row:any)=>!unifiedSubmissionIds.has(Number(row.submissionId)));

  const actionableSubmissionOrderIds = useMemo(() => {
    const ids = new Set<number>();
    for (const sub of actionableSubmissionItems as any[]) {
      for (const id of sub.orderIds ?? []) ids.add(Number(id));
    }
    return ids;
  }, [actionableSubmissionItems]);

  // Legacy package-pricing view retained, but its query stays disabled while
  // delegates use only the existing item queue and supply-tracking view.
  const isDelegatePricingActionRole = user?.role === "delegate";
  const { data: delegatePendingEstimateItems = [], isLoading: delegatePendingEstimateItemsLoading } =
    trpc.purchaseOrders.pendingEstimateItems.useQuery(undefined, {
      enabled: isDelegatePricingActionRole && view === "actionable",
    });

  // عرض مسطح لكل صنف يحتاج تدخل المندوب الآن، بغض النظر عن عدد طلبات PR.
  // هذا هو مصدر تبويب «أصنافي بانتظار المعالجة».
  const { data: delegateActionableItemsData, isLoading: delegateActionableItemsLoading } =
    trpc.purchaseOrders.actionableItemsForMe.useQuery(undefined, {
      enabled: isDelegatePricingActionRole,
      ...independentReadOptions,
    });
  const delegateActionableItems = delegateActionableItemsData?.items ?? [];
  const delegateActionableItemsCount = delegateActionableItemsData?.total ?? 0;

  const filteredDelegateActionableItems = useMemo(() => {
    const query = delegateItemsSearch.trim().toLowerCase();
    const normalizedAmountQuery = query.replace(/[,\s]/g, "");
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const getItemDate = (item: any) => {
      const raw = item.updatedAt || item.createdAt;
      if (!raw) return null;
      const parsed = new Date(raw);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    };

    const matchesDate = (item: any) => {
      if (delegateDateFilter === "all") return true;
      const itemDate = getItemDate(item);
      if (!itemDate) return false;

      if (delegateDateFilter === "today") return itemDate >= startOfToday;
      if (delegateDateFilter === "7d") {
        const from = new Date(startOfToday);
        from.setDate(from.getDate() - 6);
        return itemDate >= from;
      }
      if (delegateDateFilter === "30d") {
        const from = new Date(startOfToday);
        from.setDate(from.getDate() - 29);
        return itemDate >= from;
      }

      const from = delegateDateFrom ? new Date(`${delegateDateFrom}T00:00:00`) : null;
      const to = delegateDateTo ? new Date(`${delegateDateTo}T23:59:59.999`) : null;
      if (from && itemDate < from) return false;
      if (to && itemDate > to) return false;
      return true;
    };

    const matchesSearch = (item: any) => {
      if (!query) return true;
      const localizedName = getLocalizedItemField(item, "itemName", language) || item.itemName || "";
      const orderNumber = String(item.purchaseOrderNumber || "");
      const amountValues = [
        item.estimatedUnitCost,
        item.estimatedTotalCost,
        item.actualUnitCost,
        item.actualTotalCost,
      ]
        .filter((value) => value !== null && value !== undefined && value !== "")
        .map((value) => String(value).replace(/[,\s]/g, ""));

      return localizedName.toLowerCase().includes(query)
        || String(item.itemName || "").toLowerCase().includes(query)
        || orderNumber.toLowerCase().includes(query)
        || String(item.requestedByName || "").toLowerCase().includes(query)
        || String(item.requiredDate || "").includes(query)
        || (normalizedAmountQuery.length > 0 && amountValues.some((value) => value.includes(normalizedAmountQuery)));
    };

    return [...delegateActionableItems]
      .filter((item: any) => delegateActionFilter === "all" || item.actionMode === delegateActionFilter)
      .filter(matchesDate)
      .filter(matchesSearch)
      .sort(comparePurchaseRequiredDates);
  }, [
    delegateActionableItems,
    delegateItemsSearch,
    delegateActionFilter,
    delegateDateFilter,
    delegateDateFrom,
    delegateDateTo,
    language,
  ]);

  // Creator follow-up stays with the other roles. Delegate follow-up uses the
  // existing supply query, already scoped by the server to the assigned delegate.
  const { data: myRequestedItemsData, isLoading: myRequestedItemsLoading } =
    trpc.purchaseOrders.myRequestedItems.useQuery(undefined, { enabled: !!user && canAccessMyItemsTracking && user.role !== "delegate" });
  const myRequestedItems = myRequestedItemsData?.items ?? [];
  const myRequestedItemsCount = myRequestedItemsData?.total ?? 0;

  const { data: supplyTrackingData, isLoading: supplyTrackingLoading } =
    trpc.purchaseOrders.supplyTracking.useQuery(undefined, { enabled: !!user && canAccessSupplyTracking, refetchInterval: user?.role === "delegate" && view === "supply" ? 30_000 : false });
  const supplyTrackingItems = supplyTrackingData?.items ?? [];
  const supplyTrackingCount = supplyTrackingData?.total ?? 0;

  const [historyItem, setHistoryItem] = useState<any | null>(null);
  const { data: itemHistoryData, isLoading: itemHistoryLoading } =
    trpc.purchaseOrders.itemHistory.useQuery(
      { itemId: historyItem?.id ?? 0 },
      { enabled: !!historyItem?.id },
    );

  // [PB-REVIEWER-ACTIONABLE 2026-08-31] بعد أن يجمع المراجع طلبات pending_review
  // داخل حزمة، تصبح الحزمة هي وحدة العرض في «بانتظار إجرائي». لا نغيّر
  // actionableForMe ولا صلاحية reviewItems؛ كل PR يبقى مستقلاً عند فتحه.
  const isReviewerGroupingActionRole = !!user && [
    "owner",
    "admin",
    "maintenance_manager",
    "general_maintenance_manager",
    "construction_procurement_manager",
    "purchase_manager",
    "food_warehouse_manager",
  ].includes(user.role);
  const needsActionablePackageCards = isReviewerGroupingActionRole;
  const { data: actionablePackageCards = [], isLoading: actionablePackageCardsLoading } =
    trpc.purchasePackages.cards.useQuery(undefined, {
      enabled: needsActionablePackageCards,
      ...independentReadOptions,
    });

  const delegatePricingPackages = useMemo(() => {
    if (!isDelegatePricingActionRole) return [];

    const packages = new Map<number, any>();
    for (const item of delegatePendingEstimateItems as any[]) {
      const packageId = Number(item.packageId || 0);
      if (!packageId) continue;

      let pkg = packages.get(packageId);
      if (!pkg) {
        pkg = {
          id: packageId,
          packageNumber: item.packageNumber || `#${packageId}`,
          actionableOrders: [],
          _orders: new Map<number, any>(),
        };
        packages.set(packageId, pkg);
      }

      const orderId = Number(item.purchaseOrderId);
      let order = pkg._orders.get(orderId);
      if (!order) {
        order = {
          id: orderId,
          poNumber: item.purchaseOrderNumber || `#${orderId}`,
          items: [],
        };
        pkg._orders.set(orderId, order);
        pkg.actionableOrders.push(order);
      }
      order.items.push(item);
    }

    return Array.from(packages.values()).map(({ _orders, ...pkg }) => pkg);
  }, [delegatePendingEstimateItems, isDelegatePricingActionRole]);

  const delegatePricingPackagedOrderIds = useMemo(() => {
    const ids = new Set<number>();
    for (const pkg of delegatePricingPackages as any[]) {
      for (const po of pkg.actionableOrders ?? []) ids.add(Number(po.id));
    }
    return ids;
  }, [delegatePricingPackages]);

  const reviewerActionableOrderIds = useMemo(() =>
    new Set(
      actionableItems
        .filter((it: any) => it.status === "pending_review")
        .map((it: any) => Number(it.id))
    ),
  [actionableItems]);

  const reviewerActionablePackages = useMemo(() => {
    if (!isReviewerGroupingActionRole || reviewerActionableOrderIds.size === 0) return [];

    return (actionablePackageCards as any[]).flatMap((card: any) => {
      if (card.cardType !== "package") return [];
      const actionableOrders = (card.orders ?? []).filter((po: any) =>
        reviewerActionableOrderIds.has(Number(po.id)) && po.status === "pending_review"
      );
      return actionableOrders.length > 0 ? [{ ...card, actionableOrders }] : [];
    });
  }, [actionablePackageCards, isReviewerGroupingActionRole, reviewerActionableOrderIds]);

  const reviewerPackagedOrderIds = useMemo(() => {
    const ids = new Set<number>();
    for (const pkg of reviewerActionablePackages as any[]) {
      for (const po of pkg.actionableOrders ?? []) ids.add(Number(po.id));
    }
    return ids;
  }, [reviewerActionablePackages]);

  // نخفي PR فقط عندما أصبح له تمثيل موحّد في نفس تبويب «بانتظار إجرائي»:
  // - المراجع أثناء pending_review: بطاقة حزمة التجميع PB.
  // - الحسابات/الإدارة: دفعة الإرسال.
  // - المندوب أثناء التسعير: بطاقة الحزمة PB.
  // بعد اعتماد الإدارة يبقى شراء المندوب PR منفردًا كما اتفقنا.
  const standaloneActionableItems = useMemo(() =>
    actionableItems.filter((it: any) => {
      const id = Number(it.id);
      if(isPackageSubmissionActionRole&&unifiedOrderIds.has(id))return false;
      if (isPackageSubmissionActionRole && actionableSubmissionOrderIds.has(id)) return false;
      if (isDelegatePricingActionRole && it.actionMode === "estimate" && delegatePricingPackagedOrderIds.has(id)) return false;
      if (isReviewerGroupingActionRole && it.status === "pending_review" && reviewerPackagedOrderIds.has(id)) return false;
      return true;
    }),
  [
    actionableItems,
    actionableSubmissionOrderIds,
    delegatePricingPackagedOrderIds,
    reviewerPackagedOrderIds,
    isPackageSubmissionActionRole,
    isDelegatePricingActionRole,
    isReviewerGroupingActionRole,
    unifiedApprovalQ.data,
  ]);

  const actionableDisplayCount =
    standaloneActionableItems.length +
    unifiedApprovalItems.length +
    (isPackageSubmissionActionRole ? actionableSubmissionItems.length : 0) +
    (isDelegatePricingActionRole ? delegatePricingPackages.length : 0) +
    (isReviewerGroupingActionRole ? reviewerActionablePackages.length : 0);
  const actionableViewLoading =
    actionableLoading ||
    (isPackageSubmissionActionRole&&unifiedApprovalQ.isLoading)||
    (isPackageSubmissionActionRole && actionableSubmissionsLoading) ||
    (isDelegatePricingActionRole && delegatePendingEstimateItemsLoading) ||
    (needsActionablePackageCards && actionablePackageCardsLoading);

  const canDelete = user && ["owner", "admin"].includes(user.role);
  const canFilterByUser = user && FULL_ACCESS_ROLES.includes(user.role);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [selectedPO, setSelectedPO] = useState<any>(null);

  // جلب قائمة المستخدمين للفلتر (فقط للأدوار الكاملة الصلاحيات)
  const { data: allUsers = [] } = trpc.users.list.useQuery(undefined, {
    enabled: !!canFilterByUser,
  });

  // بناء الفلاتر المُرسلة للسيرفر
  const queryInput = {
    ...(statusFilter !== "all" && { status: statusFilter }),
    ...(dateFrom && { dateFrom }),
    ...(dateTo && { dateTo }),
    ...(canFilterByUser && requestedById !== "all" && { requestedById: Number(requestedById) }),
  };

  const { data: pos, isLoading } = trpc.purchaseOrders.list.useQuery(
    Object.keys(queryInput).length > 0 ? queryInput : undefined,
    { enabled: !!user && user.role !== "delegate", ...independentReadOptions },
  );

  const deleteMutation = trpc.purchaseOrders.delete.useMutation({
    onSuccess: () => {
      toast.success(t.common.deletedSuccessfully);
      utils.purchaseOrders.list.invalidate();
      setDeleteOpen(false);
    },
    onError: (err) => toast.error(localizeApiError(err.message)),
  });

  const openDelete = (po: any, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedPO(po);
    setDeleteOpen(true);
  };

  const locale = language === "ar" ? "ar-SA" : language === "ur" ? "ur-PK" : "en-US";
  const currency = t.common.currency;

  const supplyDelegates = useMemo(() => {
    const seen = new Map<number, string>();
    for (const item of supplyTrackingItems as any[]) {
      if (item.delegateId && item.delegateName) seen.set(Number(item.delegateId), String(item.delegateName));
    }
    return Array.from(seen.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, locale));
  }, [supplyTrackingItems, locale]);

  const filteredSupplyTrackingItems = useMemo(() => {
    const normalized = supplySearch.trim().toLowerCase();
    const normalizedAmount = normalized.replace(/[,\s]/g, "");
    const completedStatuses = new Set(["delivered_to_warehouse", "delivered_to_requester", "rejected", "cancelled", "needs_item_revision", "purchase_cancelled"]);
    const threshold = user?.role === "delegate" || supplyDelayFilter === "all"
      ? null
      : supplyDelayFilter === "custom"
        ? Math.max(1, Number.parseInt(supplyCustomDays || "1", 10) || 1)
        : Number(supplyDelayFilter);

    const slashDate = (value: unknown) => {
      const raw = String(value || "").slice(0, 10);
      const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      return match ? `${match[3]}/${match[2]}/${match[1]}` : "";
    };

    return [...(supplyTrackingItems as any[])]
      .filter((item: any) => {
        if (canViewAllSupplyTracking && supplyOwnershipFilter === "mine" && Number(item.requestedById) !== Number(user?.id)) return false;
        if (canViewAllSupplyTracking && supplyDelegateFilter !== "all" && Number(item.delegateId) !== Number(supplyDelegateFilter)) return false;
        if (threshold != null) {
          if (completedStatuses.has(String(item.status))) return false;
          const overdueDays = getOverdueCalendarDays(item.requiredDate);
          if (overdueDays == null || overdueDays < threshold) return false;
        }
        if (!normalized) return true;

        const amountValues = [item.estimatedUnitCost, item.estimatedTotalCost, item.actualUnitCost, item.actualTotalCost]
          .filter((value) => value !== null && value !== undefined && value !== "")
          .map((value) => String(value).replace(/[,\s]/g, ""));
        const localizedName = getLocalizedItemField(item, "itemName", language) || item.itemName || "";
        const searchable = [
          localizedName,
          item.itemName,
          item.purchaseOrderNumber,
          item.delegateName,
          item.requiredDate,
          slashDate(item.requiredDate),
          item.delegateAssignedAt,
          slashDate(item.delegateAssignedAt),
          item.requiredDate ? formatDateOnly(item.requiredDate, locale) : "",
          item.delegateAssignedAt ? formatDateOnly(item.delegateAssignedAt, locale) : "",
        ].filter(Boolean).map(String);

        return searchable.some((value) => value.toLowerCase().includes(normalized))
          || (normalizedAmount.length > 0 && amountValues.some((value) => value.includes(normalizedAmount)));
      })
      .sort((a: any, b: any) => {
        const aDate = String(a.requiredDate || "9999-12-31").slice(0, 10);
        const bDate = String(b.requiredDate || "9999-12-31").slice(0, 10);
        const byRequiredDate = aDate.localeCompare(bDate);
        return byRequiredDate !== 0 ? byRequiredDate : Number(a.id) - Number(b.id);
      });
  }, [
    supplyTrackingItems,
    supplySearch,
    supplyOwnershipFilter,
    supplyDelayFilter,
    supplyCustomDays,
    supplyDelegateFilter,
    canViewAllSupplyTracking,
    user?.id,
    user?.role,
    language,
    locale,
  ]);

  // البحث الديناميكي: رقم الطلب، اسم المنشئ، عدد الأصناف، أسماء الأصناف (مترجمة)، الحالة، الملاحظات، التاريخ
  const normalizedSearch = searchQuery.trim().toLowerCase();
  const filteredPos = (pos ?? []).filter((po: any) => {
    if (!normalizedSearch) return true;
    // اختر الأسماء بلغة المستخدم الحالية، وإلا ارجع للأصلية
    const localizedNames: string[] =
      language === "en" && (po.itemNames_en ?? []).length > 0 ? po.itemNames_en :
      language === "ur" && (po.itemNames_ur ?? []).length > 0 ? po.itemNames_ur :
      language === "ar" && (po.itemNames_ar ?? []).length > 0 ? po.itemNames_ar :
      (po.itemNames ?? []);
    const haystack: string[] = [
      po.poNumber,
      po.requestedByName,
      String(po.itemCount ?? ""),
      ...localizedNames,
      ...(po.itemNames ?? []), // أضف الأصلي دائماً للبحث الشامل
      getPOStatusLabel(po.status),
      po.notes,
      po.totalEstimatedCost != null ? String(po.totalEstimatedCost) : "",
      po.totalActualCost != null ? String(po.totalActualCost) : "",
      po.createdAt ? formatPurchaseSubmissionTime(po, locale) : "",
    ].filter(Boolean).map(String);
    return haystack.some(field => field.toLowerCase().includes(normalizedSearch));
  });

  // إعادة التعيين للصفحة الأولى تلقائياً عند تغيّر أي فلتر أو البحث
  useEffect(() => {
    if (!didMountFilters.current) {
      didMountFilters.current = true;
      return;
    }
    setCurrentPage(1);
  }, [statusFilter, dateFrom, dateTo, requestedById, searchQuery]);

  useEffect(() => {
    writeHistoryEntryState<PurchaseOrdersHistoryState>(PURCHASE_ORDERS_HISTORY_KEY, {
      statusFilter,
      dateFrom,
      dateTo,
      requestedById,
      searchQuery,
      currentPage,
      view,
    });
  }, [statusFilter, dateFrom, dateTo, requestedById, searchQuery, currentPage, view]);

  // ── [PB] بناء البطاقات الموحّدة (2026-08-29) ──
  // القائمة تعرض نوعين من البطاقات: حزمة تضم عدة طلبات، أو طلب مفرد غير
  // مجمّع. التجميع يقع **بعد** الفلترة والبحث مباشرة، فتبقى دلالتهما كما
  // هي حرفيًا: الحزمة تظهر لو طابق أي طلب من طلباتها معايير البحث.
  // الترقيم ينتقل من مستوى الطلب لمستوى البطاقة — وهذا مقصود: البطاقة هي
  // الوحدة المعروضة للمستخدم. الطلب غير المجمّع (packageId = null، وهو حال
  // كل الطلبات القائمة) يبقى بطاقة مفردة بشكلها وسلوكها الحاليين تمامًا.
  const purchaseCards = useMemo(() => {
    const packagesMap = new Map<number, any>();
    const cards: any[] = [];
    const delegateIndividualStatuses = new Set([
      "approved",
      "partial_purchase",
      "purchased",
      "received",
      "closed",
    ]);

    for (const po of filteredPos as any[]) {
      // [PB-DELEGATE 2026-08-31] بعد اعتماد الإدارة تنتهي حاجة المندوب
      // لبطاقة الحزمة كوحدة عمل، ويعود التعامل إلى مستوى طلب الشراء ثم الصنف.
      // لذلك في "جميع الطلبات" نعرض PR منفردًا للمندوب في مراحل الشراء وما
      // بعدها، مطابقًا لسلوك "بانتظار إجرائي". أما أثناء التسعير/الحسابات/
      // الإدارة فتبقى PB مجمّعة حتى يظل الإرسال المتكرر للحسابات على مستوى
      // الحزمة كما هو، دون أي تغيير في الـWorkflow أو البيانات.
      const showAsIndividualDelegateOrder =
        user?.role === "delegate" && delegateIndividualStatuses.has(po.status);

      if (!po.packageId || showAsIndividualDelegateOrder) {
        cards.push({ cardType: "order", key: `po:${po.id}`, id: po.id, order: po });
        continue;
      }
      let pkg = packagesMap.get(po.packageId);
      if (!pkg) {
        pkg = {
          cardType: "package",
          key: `package:${po.packageId}`,
          id: po.packageId,
          packageNumber: po.packageNumber ?? `#${po.packageId}`,
          createdAt: po.createdAt,
          orders: [],
        };
        packagesMap.set(po.packageId, pkg);
        cards.push(pkg);
      }
      pkg.orders.push(po);
      // تاريخ الحزمة = أحدث طلب فيها، حتى لا تهبط لأسفل القائمة
      if (new Date(po.createdAt) > new Date(pkg.createdAt)) pkg.createdAt = po.createdAt;
    }

    return cards;
  }, [filteredPos, user?.role]);

  // ── [PB] تحديد الطلبات للتجميع ──
  // متاح فقط لأدوار المراجعة، وفقط على الطلبات بحالة pending_review غير
  // المنتمية لحزمة — نفس شرط الخادم بالضبط (purchase-packages.router.ts).
  const canGroup = user && ["owner", "admin", "maintenance_manager", "general_maintenance_manager", "construction_procurement_manager", "purchase_manager", "food_warehouse_manager"].includes(user.role);
  const [selectedForPackage, setSelectedForPackage] = useState<number[]>([]);

  const isGroupable = (po: any) => po.status === "pending_review" && !po.packageId;

  const toggleSelect = (poId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedForPackage(prev =>
      prev.includes(poId) ? prev.filter(id => id !== poId) : [...prev, poId]
    );
  };

  const createPackageMutation = trpc.purchasePackages.create.useMutation({
    onSuccess: (res) => {
      toast.success(t.workflow.purchase.createdPackage.replace("{number}", res.packageNumber));
      setSelectedForPackage([]);
      utils.purchaseOrders.list.invalidate();
      // تحديث تمثيل «بانتظار إجرائي» فورًا بعد التجميع بدون Refresh يدوي.
      utils.purchasePackages.cards.invalidate();
    },
    onError: (err) => toast.error(localizeApiError(err.message)),
  });

  const totalPages = Math.max(1, Math.ceil(purchaseCards.length / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedCards = purchaseCards.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t.purchaseOrders.title}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t.purchaseOrders.justification}</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <ExportButton endpoint="purchase-orders" filename="purchase-orders" />
          <Button onClick={() => setLocation("/purchase-orders/new")} className="gap-2">
            <Plus className="w-4 h-4" /> {t.purchaseOrders.createNew}
          </Button>
        </div>
      </div>

      <PricingBundleLink />
      {/* ── ملخص + تبويبات العرض ─────────────────────────────────── */}
      {view === "items" && isDelegatePricingActionRole ? (
        delegateActionableItemsLoading ? (
          <Skeleton className="h-6 w-64" />
        ) : (
          <p className="text-base font-medium">
            {delegateActionableItemsCount > 0
              ? t.workflow.purchase.delegateItemsCount.replace("{count}", String(delegateActionableItemsCount))
              : t.workflow.purchase.noDelegateItems}
          </p>
        )
      ) : view === "supply" && canAccessSupplyTracking ? (
        supplyTrackingLoading ? (
          <Skeleton className="h-6 w-64" />
        ) : (
          <p className="text-base font-medium">
            {t.workflow.purchase.supplyTrackingCount.replace("{count}", String(filteredSupplyTrackingItems.length))}
          </p>
        )
      ) : view === "completed" && user?.role === "delegate" ? (
        <p className="text-base font-medium">{completedLabels[language].title}</p>
      ) : view === "tracking" && canAccessMyItemsTracking ? (
        myRequestedItemsLoading ? (
          <Skeleton className="h-6 w-64" />
        ) : (
          <p className="text-base font-medium">
            {myRequestedItemsCount > 0
              ? t.workflow.purchase.myRequestedItemsCount.replace("{count}", String(myRequestedItemsCount))
              : t.workflow.purchase.noMyItems}
          </p>
        )
      ) : actionableViewLoading ? (
        <Skeleton className="h-6 w-64" />
      ) : (
        <p className="text-base font-medium">
          {actionableDisplayCount > 0
            ? (isPackageSubmissionActionRole || isReviewerGroupingActionRole)
              ? t.workflow.purchase.actionableCount.replace("{count}", String(actionableDisplayCount))
              : t.workflow.purchase.actionableCount.replace("{count}", String(actionableDisplayCount))
            : t.workflow.purchase.noDelegateItems}
        </p>
      )}

      <div className="flex gap-2 flex-wrap">
        {user?.role !== "delegate" && (
        <Button
          variant={view === "actionable" ? "default" : "outline"}
          size="sm"
          onClick={() => setView("actionable")}
        >
          {t.workflow.purchase.actionableTab} {actionableDisplayCount > 0 && `(${actionableDisplayCount})`}
        </Button>
        )}
        {isDelegatePricingActionRole && (
          <Button
            variant={view === "items" ? "default" : "outline"}
            size="sm"
            onClick={() => setView("items")}
          >
            {t.workflow.purchase.delegateItemsTab} {delegateActionableItemsCount > 0 && `(${delegateActionableItemsCount})`}
          </Button>
        )}
        {canAccessMyItemsTracking && user?.role !== "delegate" && (
          <Button
            variant={view === "tracking" ? "default" : "outline"}
            size="sm"
            onClick={() => setView("tracking")}
            className="gap-1.5"
          >
            <History className="w-4 h-4" />
            {t.workflow.purchase.myItemsFollowupTab} {myRequestedItemsCount > 0 && `(${myRequestedItemsCount})`}
          </Button>
        )}
        {canAccessSupplyTracking && (
          <Button
            variant={view === "supply" ? "default" : "outline"}
            size="sm"
            onClick={() => setView("supply")}
            className="gap-1.5"
          >
            <Truck className="w-4 h-4" />
            {user?.role === "delegate" ? t.workflow.purchase.myItemsFollowupTab : t.workflow.purchase.supplyTrackingTab} {supplyTrackingCount > 0 && `(${supplyTrackingCount})`}
          </Button>
        )}
        {user?.role === "delegate" && <Button variant={view === "completed" ? "default" : "outline"} size="sm" onClick={() => setView("completed")}>{completedLabels[language].title}</Button>}
        {canViewReturns && returnStatus.data?.enabled && <Button variant={view === "returns" ? "default" : "outline"} size="sm" onClick={() => setView("returns")}>المرتجعات</Button>}
        {user?.role !== "delegate" && <Button
          variant={view === "all" ? "default" : "outline"}
          size="sm"
          onClick={() => setView("all")}
        >
          {t.workflow.purchase.allOrdersTab}
        </Button>}
      </div>

      {/* ── قائمة "بانتظار إجرائي" ────────────────────────────────── */}
      {view === "actionable" && (
        <div className="space-y-2">
          {isPackageSubmissionActionRole&&unifiedApprovalQ.error&&<p role="alert">{unifiedApprovalQ.error.message}</p>}
          {actionableViewLoading ? (
            <>
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </>
          ) : actionableDisplayCount === 0 ? (
            <Card>
              <CardContent className="py-10 text-center text-muted-foreground">
                <Package className="w-10 h-10 mx-auto mb-3 opacity-40" />
                {t.workflow.purchase.noDelegateItems}
              </CardContent>
            </Card>
          ) : (
            <>
              {isPackageSubmissionActionRole&&<><BundleApprovalCards items={unifiedApprovalItems}/>
                {unifiedApprovalQ.data?.nextId&&<Link href="/delegate-pricing-bundles" className="text-primary underline">عرض بقية حزم التسعير للاعتماد</Link>}</>}
              {isReviewerGroupingActionRole && reviewerActionablePackages.map((pkg: any) => (
                <PurchaseBatchCard
                  key={`review-package:${pkg.id}`}
                  packageNumber={pkg.packageNumber}
                  createdAt={pkg.createdAt}
                  orders={pkg.actionableOrders ?? []}
                  defaultExpanded
                  locale={locale}
                  onOpenOrder={(orderId) => setLocation(`/purchase-orders/${orderId}`)}
                  actions={<Badge variant="outline">{t.workflow.purchase.pendingReviewBadge}</Badge>}
                />
              ))}

              {isDelegatePricingActionRole && delegatePricingPackages.map((pkg: any) => {
                const remainingPricingCount = (pkg.actionableOrders ?? []).reduce(
                  (sum: number, po: any) =>
                    sum + (po.items ?? []).filter((item: any) => item.status === "pending").length,
                  0
                );
                const readyToSendCount = (pkg.actionableOrders ?? []).reduce(
                  (sum: number, po: any) =>
                    sum + (po.items ?? []).filter((item: any) => item.status === "estimated").length,
                  0
                );

                return (
                  <Card key={`delegate-package:${pkg.id}`} className="hover:shadow-sm transition-shadow border-amber-200">
                    <CardContent className="py-4 flex items-center justify-between gap-4 flex-wrap">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Boxes className="w-4 h-4 text-amber-700" />
                          <div className="font-semibold font-mono">{pkg.packageNumber}</div>
                          <Badge variant="outline">{t.workflow.purchase.purchasePackage}</Badge>
                        </div>
                        <div className="text-sm text-muted-foreground mt-1">{t.workflow.purchase.packageWaitingPricing}</div>
                        <div className="text-xs text-muted-foreground mt-1 flex gap-3 flex-wrap">
                          <span>{pkg.actionableOrders.length} {pkg.actionableOrders.length === 1 ? t.workflow.purchase.orderWord : t.workflow.purchase.ordersWord}</span>
                          {remainingPricingCount > 0 && (
                            <span className="font-semibold text-amber-800">{t.workflow.purchase.remainingPricing} {remainingPricingCount} {t.workflow.purchase.itemCount}</span>
                          )}
                          {readyToSendCount > 0 && (
                            <span className="font-semibold text-emerald-700">{t.workflow.purchase.readyToSend} {readyToSendCount} {t.workflow.purchase.itemCount}</span>
                          )}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        onClick={() => setLocation(`/purchase-packages/${pkg.id}?action=pricing`)}
                      >
                        {t.workflow.purchase.openPricing}
                      </Button>
                    </CardContent>
                  </Card>
                );
              })}

              {isPackageSubmissionActionRole && actionableSubmissionItems.map((sub: any) => (
                <Card key={`submission:${sub.submissionId}`} className="hover:shadow-sm transition-shadow border-primary/20">
                  <CardContent className="py-4 flex items-center justify-between gap-4 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Boxes className="w-4 h-4 text-primary" />
                        <div className="font-semibold font-mono">{sub.submissionNumber}</div>
                        <Badge variant="outline">{t.workflow.purchase.dispatchBatch}</Badge>
                      </div>
                      <div className="text-sm text-muted-foreground mt-1">{sub.reason}</div>
                      <div className="text-xs text-muted-foreground mt-1 flex gap-3 flex-wrap">
                        <span>{sub.orderCount} {sub.orderCount === 1 ? t.workflow.purchase.orderWord : t.workflow.purchase.ordersWord}</span>
                        {sub.poNumbers?.length > 0 && (
                          <span>{sub.poNumbers.join(language === "en" ? ", " : "، ")}</span>
                        )}
                        {Number(sub.totalEstimatedCost || 0) > 0 && (
                          <span>{t.workflow.purchase.estimatedTotal} {Number(sub.totalEstimatedCost).toLocaleString(locale)} {currency}</span>
                        )}
                        {sub.custodyBalance != null && (
                          <span>{t.workflow.purchase.custodyBalanceTotal} {Number(sub.custodyBalance).toLocaleString(locale)} {currency}</span>
                        )}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => setLocation(`/purchase-packages/${sub.packageId}?submissionId=${sub.submissionId}`)}
                    >
                      {sub.actionLabel}
                    </Button>
                  </CardContent>
                </Card>
              ))}

              {standaloneActionableItems.map((it: any) => (
                <Card key={`po:${it.id}`} className="hover:shadow-sm transition-shadow">
                  <CardContent className="py-4 flex items-center justify-between gap-4 flex-wrap">
                    <div className="min-w-0">
                      <div className="font-semibold">{it.poNumber}</div>
                      <div className="text-sm text-muted-foreground mt-0.5">{it.reason}</div>
                      {it.itemsSummary && (
                        <div className="text-xs text-muted-foreground mt-1">{it.itemsSummary}</div>
                      )}
                    </div>
                    <Button
                      size="sm"
                      onClick={() => {
                        const delegateActionQuery = user?.role !== "delegate"
                          ? ""
                          : it.actionMode === "purchase"
                            ? "?action=purchase"
                            : it.actionMode === "estimate"
                              ? "?action=estimate"
                              : it.actionMode === "mixed"
                                ? "?action=mixed"
                                : "";
                        setLocation(`/purchase-orders/${it.id}${delegateActionQuery}`);
                      }}
                    >
                      {it.actionLabel}
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </>
          )}
        </div>
      )}

      {/* ── أصناف المندوب التي تحتاج معالجة الآن ─────────────────── */}
      {view === "items" && isDelegatePricingActionRole && (
        <div className="space-y-3">
          <Card>
            <CardContent className="py-3">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <Input
                  value={delegateItemsSearch}
                  onChange={(event) => setDelegateItemsSearch(event.target.value)}
                  placeholder={t.workflow.purchase.delegateItemsSearchPlaceholder}
                  dir="auto"
                />
                <Select
                  value={delegateActionFilter}
                  onValueChange={(value) => setDelegateActionFilter(value as DelegateActionFilter)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t.workflow.purchase.delegateActionType} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t.workflow.purchase.delegateActionAll}</SelectItem>
                    <SelectItem value="estimate">{t.workflow.purchase.delegateNeedsPricing}</SelectItem>
                    <SelectItem value="purchase">{t.workflow.purchase.delegateNeedsPurchase}</SelectItem>
                  </SelectContent>
                </Select>
                <Select
                  value={delegateDateFilter}
                  onValueChange={(value) => setDelegateDateFilter(value as DelegateDateFilter)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t.workflow.purchase.delegateDateFilter} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t.workflow.purchase.delegateDateAll}</SelectItem>
                    <SelectItem value="today">{t.workflow.purchase.delegateDateToday}</SelectItem>
                    <SelectItem value="7d">{t.workflow.purchase.delegateDateLast7}</SelectItem>
                    <SelectItem value="30d">{t.workflow.purchase.delegateDateLast30}</SelectItem>
                    <SelectItem value="custom">{t.workflow.purchase.delegateDateCustom}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {delegateDateFilter === "custom" && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
                  <Input
                    type="date"
                    value={delegateDateFrom}
                    onChange={(event) => setDelegateDateFrom(event.target.value)}
                    aria-label={t.common.fromDate}
                    dir="ltr"
                  />
                  <Input
                    type="date"
                    value={delegateDateTo}
                    onChange={(event) => setDelegateDateTo(event.target.value)}
                    aria-label={t.common.toDate}
                    dir="ltr"
                  />
                </div>
              )}
            </CardContent>
          </Card>
          {delegateActionableItemsLoading ? (
            <>
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </>
          ) : filteredDelegateActionableItems.length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center text-muted-foreground">
                <Package className="w-10 h-10 mx-auto mb-3 opacity-40" />
                {delegateActionableItems.length === 0
                  ? t.workflow.purchase.noDelegateItems
                  : t.workflow.purchase.delegateNoFilterResults}
              </CardContent>
            </Card>
          ) : (
            filteredDelegateActionableItems.map((item: any) => {
              const availableDays = getAvailableCalendarDays(item.requiredDate, item.delegateAssignedAt);
              const remainingDays = remainingPurchaseCalendarDays(item.requiredDate, delegateClock);
              return (
              <Card
                key={`delegate-action-item:${item.id}`}
                className="hover:shadow-sm hover:border-primary/30 transition-all cursor-pointer"
                onClick={() => setLocation(`/purchase-orders/${item.purchaseOrderId}?action=${item.actionMode}&itemId=${item.id}`)}
              >
                <CardContent className="py-3 flex items-center justify-between gap-4 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-sm break-words">{getLocalizedItemField(item, "itemName", language) || item.itemName || t.workflow.purchase.unnamedItem}</div>
                    <div className="text-xs text-muted-foreground mt-1 flex items-center gap-3 flex-wrap">
                      <span className="font-mono">{item.purchaseOrderNumber}</span>
                      <span>{t.workflow.purchase.quantityColon} {item.quantity} {displayUnit(item.unit)}</span>
                      <span>{t.purchaseOrders.requiredDate}: {formatDateOnly(item.requiredDate, locale)}</span>
                      <span className={remainingDays != null && remainingDays < 0 ? "font-medium text-destructive" : remainingDays === 0 ? "font-medium text-amber-700 dark:text-amber-400" : ""}>
                        {t.purchaseOrders.remainingDuration}: {formatRemainingPurchaseDuration(remainingDays, language)}
                      </span>
                      <span>{t.common.createdBy}: {item.requestedByName || "—"}</span>
                      {item.delegateAssignedAt && <span>{t.purchaseOrders.delegateAssignedDate}: {formatDateOnly(item.delegateAssignedAt, locale)}</span>}
                      {availableDays != null && <span className={availableDays < 0 ? "text-red-600" : ""}>{t.purchaseOrders.availableDuration}: {formatAvailableDuration(availableDays, language)}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {item.status === "estimated" && !item.batchId && !item.delegateChangeRequestedAt && <PricingBundleAddButton itemId={item.id} />}
                    <Badge variant={item.actionMode === "purchase" ? "default" : "outline"}>
                      {item.actionMode === "purchase"
                        ? t.workflow.purchase.delegateNeedsPurchase
                        : (item.status === "estimated"
                          ? t.workflow.purchase.delegateReadyToSend
                          : t.workflow.purchase.delegateNeedsPricing)}
                    </Badge>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={(event) => {
                        event.stopPropagation();
                        setLocation(`/purchase-orders/${item.purchaseOrderId}?action=${item.actionMode}&itemId=${item.id}`);
                      }}
                    >
                      {t.workflow.purchase.openOrder}
                    </Button>
                  </div>
                </CardContent>
              </Card>
              );
            })
          )}
        </div>
      )}

      {/* ── متابعة أصناف طلباتي عبر كل طلبات الشراء ───────────────── */}
      {view === "tracking" && canAccessMyItemsTracking && (
        <div className="space-y-2">
          {myRequestedItemsLoading ? (
            <>
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </>
          ) : myRequestedItems.length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center text-muted-foreground">
                <Package className="w-10 h-10 mx-auto mb-3 opacity-40" />
                {t.workflow.purchase.noRequestedItems}
              </CardContent>
            </Card>
          ) : (
            myRequestedItems.map((item: any) => {
              const availableDays = getAvailableCalendarDays(item.requiredDate, item.delegateAssignedAt);
              return (
              <Card
                key={`my-requested-item:${item.id}`}
                className="hover:shadow-sm hover:border-primary/30 transition-all cursor-pointer"
                onClick={() => setLocation(`/purchase-orders/${item.purchaseOrderId}?itemId=${item.id}`)}
              >
                <CardContent className="py-3 flex items-center justify-between gap-4 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-sm break-words">{getLocalizedItemField(item, "itemName", language) || item.itemName || t.workflow.purchase.unnamedItem}</div>
                    <div className="text-xs text-muted-foreground mt-1 flex items-center gap-3 flex-wrap">
                      <span className="font-mono">{item.purchaseOrderNumber}</span>
                      <span>{t.workflow.purchase.quantityColon} {item.quantity} {displayUnit(item.unit)}</span>
                      <span>{t.workflow.purchase.delegateLabelColon} {item.delegateName || t.workflow.purchase.noDelegateAssigned}</span>
                      {item.requiredDate && <span>{t.purchaseOrders.requiredDate}: {formatDateOnly(item.requiredDate, locale)}</span>}
                      {item.delegateAssignedAt && <span>{t.purchaseOrders.delegateAssignedDate}: {formatDateOnly(item.delegateAssignedAt, locale)}</span>}
                      {availableDays != null && <span className={availableDays < 0 ? "text-red-600" : ""}>{t.purchaseOrders.availableDuration}: {formatAvailableDuration(availableDays, language)}</span>}
                      {item.updatedAt && <span>{t.workflow.purchase.lastUpdate} {new Date(item.updatedAt).toLocaleDateString(locale)}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 flex-wrap">
                    <Badge variant="outline">{getPOItemStatusLabel(item.status)}</Badge>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="gap-1.5"
                      onClick={(event) => {
                        event.stopPropagation();
                        setHistoryItem(item);
                      }}
                    >
                      <History className="w-4 h-4" />
                      {t.workflow.purchase.dateLabel}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={(event) => {
                        event.stopPropagation();
                        setLocation(`/purchase-orders/${item.purchaseOrderId}?itemId=${item.id}`);
                      }}
                    >
                      {t.workflow.purchase.openOrder}
                    </Button>
                  </div>
                </CardContent>
              </Card>
              );
            })
          )}
        </div>
      )}

      {/* ── متابعة التوريد: صف بطاقة واضح لكل صنف ───────────────── */}
      {view === "completed" && user?.role === "delegate" && <DelegateCompletedItems />}
      {view === "returns" && canViewReturns && <SupplierReturns />}
      {view === "supply" && canAccessSupplyTracking && (
        <div className="space-y-4">
          <Card className="border-primary/10">
            <CardContent className="p-4 space-y-3">
              <div className="flex flex-col xl:flex-row gap-3 xl:items-end">
                <div className="flex-1 min-w-[240px]">
                  <div className="text-xs font-medium text-muted-foreground mb-1.5">{t.workflow.purchase.supplySearch}</div>
                  <div className="relative">
                    <Search className={`absolute top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground ${dir === "rtl" ? "right-3" : "left-3"}`} />
                    <Input
                      value={supplySearch}
                      onChange={(e) => setSupplySearch(e.target.value)}
                      placeholder={t.workflow.purchase.supplySearchPlaceholder}
                      className={dir === "rtl" ? "pr-9" : "pl-9"}
                    />
                  </div>
                </div>

                {canViewAllSupplyTracking && (
                  <div className="w-full xl:w-56">
                    <div className="text-xs font-medium text-muted-foreground mb-1.5">{t.workflow.purchase.supplyDelegateFilter}</div>
                    <Select value={supplyDelegateFilter} onValueChange={setSupplyDelegateFilter}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">{t.workflow.purchase.supplyAllDelegates}</SelectItem>
                        {supplyDelegates.map((delegate) => (
                          <SelectItem key={delegate.id} value={String(delegate.id)}>{delegate.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>

              {canViewAllSupplyTracking && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-medium text-muted-foreground me-1">{t.workflow.purchase.supplyScopeFilter}</span>
                  <Button
                    type="button"
                    size="sm"
                    variant={supplyOwnershipFilter === "all" ? "default" : "outline"}
                    onClick={() => setSupplyOwnershipFilter("all")}
                  >
                    {t.workflow.purchase.supplyScopeAll}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={supplyOwnershipFilter === "mine" ? "default" : "outline"}
                    onClick={() => setSupplyOwnershipFilter("mine")}
                  >
                    {t.workflow.purchase.supplyScopeMine}
                  </Button>
                </div>
              )}

              {user?.role !== "delegate" && <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium text-muted-foreground me-1">{t.workflow.purchase.supplyDelayFilter}</span>
                {([
                  ["all", t.workflow.purchase.supplyDelayAll],
                  ["1", t.workflow.purchase.supplyDelay1],
                  ["3", t.workflow.purchase.supplyDelay3],
                  ["7", t.workflow.purchase.supplyDelay7],
                  ["custom", t.workflow.purchase.supplyDelayCustom],
                ] as const).map(([value, label]) => (
                  <Button
                    key={value}
                    type="button"
                    size="sm"
                    variant={supplyDelayFilter === value ? "default" : "outline"}
                    onClick={() => setSupplyDelayFilter(value)}
                  >
                    {label}
                  </Button>
                ))}
                {supplyDelayFilter === "custom" && (
                  <div className="flex items-center gap-2 ms-1">
                    <Input
                      type="number"
                      min={1}
                      value={supplyCustomDays}
                      onChange={(e) => setSupplyCustomDays(e.target.value.replace(/[^0-9]/g, ""))}
                      className="w-24"
                      aria-label={t.workflow.purchase.supplyCustomDays}
                    />
                    <span className="text-xs text-muted-foreground">{t.workflow.purchase.supplyDaysOrMore}</span>
                  </div>
                )}
              </div>}
            </CardContent>
          </Card>

          {supplyTrackingLoading ? (
            <>
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
            </>
          ) : filteredSupplyTrackingItems.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <Truck className="w-10 h-10 mx-auto mb-3 opacity-40" />
                {t.workflow.purchase.supplyNoResults}
              </CardContent>
            </Card>
          ) : user?.role === "delegate" ? <DelegateSupplyRows items={filteredSupplyTrackingItems} /> : (
            <div className="space-y-2">
              {filteredSupplyTrackingItems.map((item: any) => {
                const availableDays = getAvailableCalendarDays(item.requiredDate, item.delegateAssignedAt);
                const overdueDays = getOverdueCalendarDays(item.requiredDate);
                const completedStatuses = new Set(["delivered_to_warehouse", "delivered_to_requester", "rejected", "cancelled", "needs_item_revision", "purchase_cancelled"]);
                const isOverdue = overdueDays != null && overdueDays > 0 && !completedStatuses.has(String(item.status));
                const hasPricing = [item.estimatedUnitCost, item.estimatedTotalCost, item.actualUnitCost, item.actualTotalCost]
                  .some((value) => value !== null && value !== undefined && value !== "");
                const amount = item.actualTotalCost ?? item.estimatedTotalCost
                  ?? (item.actualUnitCost != null ? Number(item.actualUnitCost) * Number(item.quantity || 0) : null)
                  ?? (item.estimatedUnitCost != null ? Number(item.estimatedUnitCost) * Number(item.quantity || 0) : null);

                return (
                  <Card
                    key={`supply-item:${item.id}`}
                    className={`overflow-hidden cursor-pointer transition-all hover:shadow-md hover:border-primary/30 ${isOverdue ? "border-red-200 bg-red-50/20" : ""}`}
                    onClick={() => setLocation(`/purchase-orders/${item.purchaseOrderId}?itemId=${item.id}&source=supply`)}
                  >
                    <CardContent className="p-0">
                      <div className="flex flex-col lg:flex-row lg:items-stretch">
                        <div className="p-3.5 lg:p-4 flex-[1.8] min-w-0 border-b lg:border-b-0 lg:border-e bg-background/70">
                          <div className="flex items-start gap-2 justify-between">
                            <div className="min-w-0">
                              <div className="font-semibold text-sm truncate">{getLocalizedItemField(item, "itemName", language) || item.itemName || t.workflow.purchase.unnamedItem}</div>
                              <div className="mt-1 flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
                                <span className="font-mono font-medium text-foreground/80">{item.purchaseOrderNumber}</span>
                                <span>{t.workflow.purchase.quantityColon} {item.quantity} {displayUnit(item.unit)}</span>
                              </div>
                            </div>
                            <Badge variant="outline" className="shrink-0">{getPOItemStatusLabel(item.status)}</Badge>
                          </div>
                        </div>

                        <div className="p-3 flex-1 min-w-[145px] border-b lg:border-b-0 lg:border-e">
                          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mb-1"><CalendarDays className="w-3.5 h-3.5" />{t.purchaseOrders.requiredDate}</div>
                          <div className="font-semibold text-sm">{formatDateOnly(item.requiredDate, locale)}</div>
                          {isOverdue && <div className="text-[11px] font-semibold text-red-600 mt-1">{formatOverdueDuration(overdueDays, language)}</div>}
                        </div>

                        <div className="p-3 flex-1 min-w-[155px] border-b lg:border-b-0 lg:border-e">
                          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mb-1"><Clock3 className="w-3.5 h-3.5" />{t.workflow.purchase.supplyArrivalDate}</div>
                          <div className="font-semibold text-sm">{item.delegateAssignedAt ? formatDateOnly(item.delegateAssignedAt, locale) : "—"}</div>
                        </div>

                        <div className="p-3 flex-1 min-w-[145px] border-b lg:border-b-0 lg:border-e">
                          <div className="text-[11px] text-muted-foreground mb-1">{t.purchaseOrders.availableDuration}</div>
                          <div className={`font-bold text-sm ${availableDays != null && availableDays < 0 ? "text-red-600" : "text-foreground"}`}>
                            {formatAvailableDuration(availableDays, language)}
                          </div>
                        </div>

                        <div className="p-3 flex-1 min-w-[140px] border-b lg:border-b-0 lg:border-e">
                          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mb-1"><User className="w-3.5 h-3.5" />{t.purchaseOrders.delegate}</div>
                          <div className="font-semibold text-sm truncate">{item.delegateName || t.workflow.purchase.noDelegateAssigned}</div>
                        </div>

                        {hasPricing && amount != null && (
                          <div className="p-3 flex-1 min-w-[135px] border-b lg:border-b-0 lg:border-e">
                            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mb-1"><Banknote className="w-3.5 h-3.5" />{t.workflow.purchase.supplyAmount}</div>
                            <div className="font-bold text-sm">{Number(amount).toLocaleString(locale)} {currency}</div>
                          </div>
                        )}

                        <div className="p-3 lg:px-4 flex items-center justify-center text-muted-foreground">
                          <ChevronLeft className={`w-5 h-5 ${dir === "ltr" ? "rotate-180" : ""}`} />
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── العرض الكامل (الجدول والفلاتر الحالية كما هي) ─────────── */}
      {view === "all" && (<>

      {/* خانة البحث الديناميكية */}
      <div className="relative">
        <Search className={`absolute top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground ${dir === "rtl" ? "right-3" : "left-3"}`} />
        <Input
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder={t.common.searchPlaceholder}
          className={`${dir === "rtl" ? "pr-9" : "pl-9"} max-w-md`}
        />
      </div>

      {/* شريط الفلترة */}
      <div className="flex flex-wrap gap-3 items-end">
        {/* فلتر الحالة */}
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">{t.common.status}</span>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[180px]"><SelectValue placeholder={t.common.status} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t.common.all}</SelectItem>
              {Object.keys(t.poStatus).map(k => <SelectItem key={k} value={k}>{getPOStatusLabel(k)}</SelectItem>)}
              {/* ✅ فلترة إضافية على مستوى الصنف: طلبات تحتوي صنفًا واحدًا على الأقل بهذه
                  الحالة — وليست حالة للطلب نفسه، لذا بتسمية توضيحية مختلفة لتفادي اللبس */}
              <SelectItem value="purchase_cancelled">{`${t.common.contains}: ${getPOItemStatusLabel("purchase_cancelled")}`}</SelectItem>
              <SelectItem value="needs_item_revision">{`${t.common.contains}: ${getPOItemStatusLabel("needs_item_revision")}`}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* فلتر من تاريخ */}
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">{t.common.fromDate}</span>
          <Input
            type="date"
            value={dateFrom}
            onChange={e => setDateFrom(e.target.value)}
            className="w-[160px]"
          />
        </div>

        {/* فلتر إلى تاريخ */}
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">{t.common.toDate}</span>
          <Input
            type="date"
            value={dateTo}
            onChange={e => setDateTo(e.target.value)}
            className="w-[160px]"
          />
        </div>

        {/* فلتر المنشئ — للأدوار التي يدعم الخادم تصفيتها حسب منشئ الطلب */}
        {canFilterByUser && (
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">{t.common.createdBy}</span>
            <Select value={requestedById} onValueChange={setRequestedById}>
              <SelectTrigger className="w-[200px]"><SelectValue placeholder={t.common.all} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t.common.all}</SelectItem>
                {allUsers.map((u: any) => (
                  <SelectItem key={u.id} value={String(u.id)}>
                    {u.name || u.username}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* زر مسح الفلاتر */}
        {(statusFilter !== "all" || dateFrom || dateTo || requestedById !== "all" || searchQuery) && (
          <Button
            variant="ghost"
            size="sm"
            className="self-end text-muted-foreground"
            onClick={() => {
              setStatusFilter("all");
              setDateFrom("");
              setDateTo("");
              setRequestedById("all");
              setSearchQuery("");
            }}
          >
            {t.common.clearFilters}
          </Button>
        )}
      </div>

      {/* [PB] شريط التجميع — يظهر فقط عند تحديد طلبين أو أكثر. التجميع فعل
          عرضي بحت: يربط الطلبات بحزمة واحدة دون تغيير حالة أي طلب أو صنف. */}
      {canGroup && selectedForPackage.length > 0 && (
        <Card className="border-primary/40 bg-primary/5">
          <CardContent className="p-3 flex items-center justify-between gap-3 flex-wrap">
            <span className="text-sm flex items-center gap-2">
              <Boxes className="w-4 h-4 text-primary" />
              {t.workflow.purchase.selectedOrders.replace("{count}", String(selectedForPackage.length))}
              {selectedForPackage.length < 2 && (
                <span className="text-xs text-muted-foreground">({t.workflow.purchase.packageNeedsTwo})</span>
              )}
            </span>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => setSelectedForPackage([])}>
                {t.workflow.purchase.clearSelection}
              </Button>
              <Button
                size="sm"
                className="gap-2"
                disabled={selectedForPackage.length < 2 || createPackageMutation.isPending}
                onClick={() => createPackageMutation.mutate({ orderIds: selectedForPackage })}
              >
                <Boxes className="w-4 h-4" />
                {t.workflow.purchase.groupPackage}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <Card key={i}><CardContent className="p-4"><Skeleton className="h-16 w-full" /></CardContent></Card>)}</div>
      ) : !filteredPos?.length ? (
        <Card><CardContent className="p-12 text-center">
          <ShoppingCart className="w-12 h-12 mx-auto text-muted-foreground/40 mb-4" />
          <h3 className="font-semibold text-lg mb-1">{t.purchaseOrders.noPOs}</h3>
          <p className="text-sm text-muted-foreground">{t.common.noData}</p>
        </CardContent></Card>
      ) : (
        <PurchaseCardList
          cards={paginatedCards}
          locale={locale}
          onOpenPackage={(id) => setLocation(`/purchase-packages/${id}`)}
          onOpenOrder={(id) => setLocation(`/purchase-orders/${id}`)}
          renderOrderCard={(po: any) => (
            <Card key={po.id} className="hover:shadow-lg hover:border-primary/20 transition-all duration-200 cursor-pointer" onClick={() => setLocation(`/purchase-orders/${po.id}`)}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      {/* [PB] مربع التحديد للتجميع — يظهر فقط لأدوار المراجعة
                          وفقط على الطلبات القابلة للتجميع. لا يغيّر شكل
                          البطاقة لبقية الأدوار أو الحالات إطلاقًا. */}
                      {canGroup && isGroupable(po) && (
                        <input
                          type="checkbox"
                          className="w-4 h-4 rounded border-input accent-primary cursor-pointer shrink-0"
                          checked={selectedForPackage.includes(po.id)}
                          onClick={(e) => toggleSelect(po.id, e)}
                          onChange={() => {}}
                          aria-label={t.workflow.purchase.selectForPackage.replace("{number}", po.poNumber)}
                        />
                      )}
                      <span className="text-xs font-mono text-muted-foreground">{po.poNumber}</span>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-muted-foreground mt-1 flex-wrap">
                      {/* منشئ الطلب */}
                      {po.requestedByName && (
                        <span className="flex items-center gap-1">
                          <User className="w-3 h-3" />
                          {po.requestedByName}
                        </span>
                      )}
                      {/* عدد الأصناف */}
                      <span className="flex items-center gap-1">
                        <Package className="w-3 h-3" />
                        {(po as any).itemCount ?? 0} {t.purchaseOrders.items}
                      </span>
                      {po.totalEstimatedCost && <span>{t.purchaseOrders.totalEstimated}: {Number(po.totalEstimatedCost).toLocaleString(locale)} {currency}</span>}
                      {po.totalActualCost && <span>{t.purchaseOrders.totalActual}: {Number(po.totalActualCost).toLocaleString(locale)} {currency}</span>}
                      <span className="flex items-center gap-1 flex-wrap">
                        {formatPurchaseSubmissionTime(po, locale)}
                        {(() => {
                          const breakdown = ((po as any).delegateBreakdown ?? []) as { delegateId: number; total: number; purchased: number }[];
                          if (breakdown.length === 0) return null;

                          const renderStats = (total: number, purchased: number) => {
                            const remaining = total - purchased;
                            const pct = total > 0 ? Math.round((purchased / total) * 100) : 0;
                            const stateEmoji = purchased === 0 ? "🔴" : remaining === 0 ? "🟢" : "🟡";
                            const stateText = purchased === 0 ? t.workflow.purchase.notStarted : remaining === 0 ? t.workflow.purchase.completedShort : t.workflow.purchase.inProgressShort;
                            return t.workflow.purchase.purchaseProgress.replace("{total}", String(total)).replace("{purchased}", String(purchased)).replace("{remaining}", String(remaining)).replace("{state}", `${stateEmoji} ${stateText}`).replace("{pct}", String(pct));
                          };

                          // الأدمن/مدير الصيانة/الإدارة العليا: يشوفون تفصيل كل مندوب على حدة (سطر منفصل لكل واحد)
                          const canSeeAllDelegates = ["admin", "owner", "maintenance_manager", "general_maintenance_manager", "construction_procurement_manager", "senior_management"].includes(user?.role || "");
                          if (canSeeAllDelegates && breakdown.length > 1) {
                            return (
                              <span className="block w-full text-amber-700 mt-1 space-y-0.5">
                                {breakdown.map(d => {
                                  const delegateUser = allUsers.find((u: any) => u.id === d.delegateId);
                                  return (
                                    <span key={d.delegateId} className="block">
                                      👤 {delegateUser?.name || t.workflow.purchase.delegateFallback.replace("{id}", String(d.delegateId))}: {renderStats(d.total, d.purchased)}
                                    </span>
                                  );
                                })}
                              </span>
                            );
                          }

                          // بقية الأدوار (بما فيهم المندوب نفسه): يشوفون فقط ما يخصهم هم
                          const myEntry = user ? breakdown.find(d => d.delegateId === user.id) : undefined;
                          if (!myEntry) return null;
                          return <span className="text-amber-700"> - {renderStats(myEntry.total, myEntry.purchased)}</span>;
                        })()}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {canDelete && !["funded", "partially_purchased", "completed"].includes(po.status) && (
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={(e) => openDelete(po, e)}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    )}
                    <Badge className={`status-badge ${PO_STATUS_COLORS[po.status] || "bg-gray-100 text-gray-700"}`}>
                      {getPOStatusLabel(po.status)}
                    </Badge>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        />
      )}

      {/* شريط التنقل بين الصفحات */}
      {!isLoading && purchaseCards.length > PAGE_SIZE && (
        <div className="flex items-center justify-between flex-wrap gap-2">
          <p className="text-xs text-muted-foreground">
            {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, purchaseCards.length)} {t.common.of || t.workflow.purchase.ofWord} {purchaseCards.length} {t.common.results || t.workflow.purchase.resultWord}
          </p>
          <Pagination className="mx-0 w-auto justify-end">
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious
                  href="#"
                  onClick={(e) => { e.preventDefault(); setCurrentPage(p => Math.max(1, p - 1)); }}
                  className={safePage === 1 ? "pointer-events-none opacity-40" : ""}
                />
              </PaginationItem>
              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter(p => p === 1 || p === totalPages || Math.abs(p - safePage) <= 1)
                .map((p, idx, arr) => (
                  <Fragment key={p}>
                    {idx > 0 && arr[idx - 1] !== p - 1 && (
                      <PaginationItem><span className="px-2 text-muted-foreground">…</span></PaginationItem>
                    )}
                    <PaginationItem>
                      <PaginationLink
                        href="#"
                        isActive={p === safePage}
                        onClick={(e) => { e.preventDefault(); setCurrentPage(p); }}
                      >
                        {p}
                      </PaginationLink>
                    </PaginationItem>
                  </Fragment>
                ))}
              <PaginationItem>
                <PaginationNext
                  href="#"
                  onClick={(e) => { e.preventDefault(); setCurrentPage(p => Math.min(totalPages, p + 1)); }}
                  className={safePage === totalPages ? "pointer-events-none opacity-40" : ""}
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </div>
      )}

      </>)}

      {/* تاريخ الصنف — يجمع السجلات القديمة مع سجل الأحداث الموحد الجديد */}
      <Dialog open={!!historyItem} onOpenChange={(open) => { if (!open) setHistoryItem(null); }}>
        <DialogContent className="sm:max-w-[720px] max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t.workflow.purchase.itemHistory}</DialogTitle>
            <DialogDescription>
              {historyItem?.itemName || t.workflow.purchase.itemWord} {historyItem?.purchaseOrderNumber ? `— ${historyItem.purchaseOrderNumber}` : ""}
            </DialogDescription>
          </DialogHeader>

          {itemHistoryLoading ? (
            <div className="space-y-3 py-2">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          ) : !itemHistoryData?.events?.length ? (
            <div className="py-8 text-center text-muted-foreground">{t.workflow.purchase.noItemHistory}</div>
          ) : (
            <div className="space-y-3 py-2">
              {itemHistoryData.events.map((event: any) => (
                <div key={event.id} className="border rounded-lg p-3">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="font-medium text-sm">{event.title || t.workflow.purchase.itemEvent}</div>
                    <div className="text-xs text-muted-foreground">
                      {event.date ? new Date(event.date).toLocaleString(locale) : "—"}
                    </div>
                  </div>
                  {(event.previousStatus || event.newStatus) && event.previousStatus !== event.newStatus && (
                    <div className="text-xs mt-2 flex items-center gap-2 flex-wrap">
                      {event.previousStatus && <Badge variant="outline">{getPOItemStatusLabel(event.previousStatus)}</Badge>}
                      <span className="text-muted-foreground">←</span>
                      {event.newStatus && <Badge>{getPOItemStatusLabel(event.newStatus)}</Badge>}
                    </div>
                  )}
                  {event.actorName && (
                    <div className="text-xs text-muted-foreground mt-2">{t.workflow.purchase.byColon} {event.actorName}</div>
                  )}
                  {event.note && (
                    <div className="text-sm text-muted-foreground mt-2 whitespace-pre-wrap">{event.note}</div>
                  )}
                  {event.quantity != null && (
                    <div className="text-xs text-muted-foreground mt-2">{t.workflow.purchase.quantityColon} {String(event.quantity)}</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle className="text-destructive">{t.common.confirmDelete}</DialogTitle>
            <DialogDescription>
              {t.common.deleteWarning} <strong>{selectedPO?.poNumber}</strong>? {t.common.cannotUndo}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>{t.common.cancel}</Button>
            <Button variant="destructive" onClick={() => deleteMutation.mutate({ id: selectedPO.id })} disabled={deleteMutation.isPending}>
              {deleteMutation.isPending ? t.common.deleting : t.common.delete}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
