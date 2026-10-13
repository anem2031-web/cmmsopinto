import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { useTranslation } from "@/contexts/LanguageContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import BarcodeScanner from "@/components/common/BarcodeScanner";
import LotLabelsPrintScreen, { type LotLabelItem } from "@/components/inventory/LotLabelsPrintScreen";
import OpeningBalanceBulkExcel from "@/components/inventory/OpeningBalanceBulkExcel";
import {
  Trash2, Plus, Search, QrCode, Package, AlertTriangle,
  Loader2, X, ChevronRight, ChevronDown, Check, ClipboardList, BookOpen, Printer
} from "lucide-react";
import { useState, useEffect, useMemo, useRef, useCallback, type ReactNode } from "react";
import { toast } from "sonner";
import {
  fmtDate, fmtMoney,
  printCountDocument, printSettlementDocument, printDisposalDocument,
} from "@/lib/printInventoryOperationDocuments";

// تحويل آمن لأي قيمة تاريخ (قد تصل ككائن Date حقيقي بسبب transformer: superjson بـ tRPC)
// لصيغة YYYY-MM-DD المطلوبة تحديداً بـ <Input type="date"> (بعكس fmtDate أعلاه للعرض النصي)
const toDateInputValue = (d: any): string => {
  if (!d) return "";
  const date = d instanceof Date ? d : new Date(d);
  if (isNaN(date.getTime())) return "";
  return date.toISOString().split("T")[0];
};

const REASON_LABELS: Record<string, string> = {
  damaged:  "تالف",
  expired:  "منتهي الصلاحية",
  missing:  "مفقود",
  other:    "أخرى",
};

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  COMPLETED: { label: "مكتملة",  color: "bg-emerald-100 text-emerald-800 border-emerald-200" },
  PENDING:   { label: "معلقة",   color: "bg-amber-100 text-amber-800 border-amber-200" },
  APPROVED:  { label: "معتمدة",  color: "bg-blue-100 text-blue-800 border-blue-200" },
  REJECTED:  { label: "مرفوضة", color: "bg-red-100 text-red-800 border-red-200" },
  CANCELLED: { label: "ملغاة",   color: "bg-gray-100 text-gray-800 border-gray-200" },
};

type CountCatalogNode = {
  id: number;
  parentId?: number | null;
  code?: string | null;
  nameAr?: string | null;
  nameEn?: string | null;
  level?: number | null;
  sortOrder?: number | null;
};

// 2B-9 — اختيار نطاق الجرد من نفس Catalog taxonomy كشجرة منبثقة.
// أي عقدة قابلة للاختيار (وليس الأوراق فقط) لأن الـBackend يفسرها كـ subtree:
// العقدة المختارة + جميع descendants التابعة لها.
function CountCatalogTreePicker({
  nodes,
  value,
  onChange,
  language,
}: {
  nodes: CountCatalogNode[];
  value: string;
  onChange: (nodeId: string) => void;
  language: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [expandedNodeIds, setExpandedNodeIds] = useState<Set<number>>(() => new Set());
  const treeScrollRef = useRef<HTMLDivElement | null>(null);
  const [treeScrollMetrics, setTreeScrollMetrics] = useState({
    scrollTop: 0,
    scrollHeight: 1,
    clientHeight: 1,
  });

  const refreshTreeScrollMetrics = useCallback(() => {
    const el = treeScrollRef.current;
    if (!el) return;
    setTreeScrollMetrics({
      scrollTop: el.scrollTop,
      scrollHeight: Math.max(1, el.scrollHeight),
      clientHeight: Math.max(1, el.clientHeight),
    });
  }, []);

  const nodeById = useMemo(
    () => new Map(nodes.map(node => [Number(node.id), node])),
    [nodes],
  );

  const childrenByParent = useMemo(() => {
    const map = new Map<number | null, CountCatalogNode[]>();
    for (const node of nodes) {
      const rawParentId = node.parentId ? Number(node.parentId) : null;
      // لو كان الدور يرى subtree فقط، اعتبر أول عقدة مرئية Root حتى لا تختفي الشجرة.
      const parentId = rawParentId && nodeById.has(rawParentId) ? rawParentId : null;
      const list = map.get(parentId) || [];
      list.push(node);
      map.set(parentId, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => {
        const sortDiff = Number(a.sortOrder || 0) - Number(b.sortOrder || 0);
        if (sortDiff) return sortDiff;
        const codeDiff = String(a.code || "").localeCompare(String(b.code || ""), undefined, { numeric: true });
        if (codeDiff) return codeDiff;
        const aName = language === "en" ? (a.nameEn || a.nameAr || "") : (a.nameAr || a.nameEn || "");
        const bName = language === "en" ? (b.nameEn || b.nameAr || "") : (b.nameAr || b.nameEn || "");
        return String(aName).localeCompare(String(bName), language === "en" ? "en" : "ar");
      });
    }
    return map;
  }, [nodes, nodeById, language]);

  const selectedNodeId = value ? Number(value) : null;
  const selectedPath = useMemo(() => {
    if (!selectedNodeId) return [] as CountCatalogNode[];
    const path: CountCatalogNode[] = [];
    const visited = new Set<number>();
    let current = nodeById.get(selectedNodeId);
    while (current && !visited.has(Number(current.id))) {
      path.push(current);
      visited.add(Number(current.id));
      current = current.parentId ? nodeById.get(Number(current.parentId)) : undefined;
    }
    return path.reverse();
  }, [selectedNodeId, nodeById]);

  useEffect(() => {
    if (!selectedNodeId) return;
    setExpandedNodeIds(prev => {
      const next = new Set(prev);
      const visited = new Set<number>();
      let current = nodeById.get(selectedNodeId);
      while (current?.parentId && !visited.has(Number(current.id))) {
        visited.add(Number(current.id));
        next.add(Number(current.parentId));
        current = nodeById.get(Number(current.parentId));
      }
      return next;
    });
  }, [selectedNodeId, nodeById]);

  const normalizedSearch = search.trim().toLowerCase();
  const visibleNodeIds = useMemo(() => {
    if (!normalizedSearch) return null;
    const visible = new Set<number>();

    const addAncestors = (node: CountCatalogNode) => {
      const visited = new Set<number>();
      let current: CountCatalogNode | undefined = node;
      while (current && !visited.has(Number(current.id))) {
        visible.add(Number(current.id));
        visited.add(Number(current.id));
        current = current.parentId ? nodeById.get(Number(current.parentId)) : undefined;
      }
    };
    const addDescendants = (nodeId: number) => {
      const queue = [nodeId];
      const visited = new Set<number>();
      while (queue.length) {
        const currentId = queue.shift()!;
        if (visited.has(currentId)) continue;
        visited.add(currentId);
        visible.add(currentId);
        for (const child of childrenByParent.get(currentId) || []) queue.push(Number(child.id));
      }
    };

    for (const node of nodes) {
      const haystack = `${node.nameAr || ""} ${node.nameEn || ""} ${node.code || ""}`.toLowerCase();
      if (!haystack.includes(normalizedSearch)) continue;
      addAncestors(node);
      addDescendants(Number(node.id));
    }
    return visible;
  }, [nodes, normalizedSearch, nodeById, childrenByParent]);

  const nodeLabel = (node: CountCatalogNode) =>
    language === "en"
      ? (node.nameEn || node.nameAr || `#${node.id}`)
      : (node.nameAr || node.nameEn || `#${node.id}`);

  const selectedPathLabel = selectedPath.map(nodeLabel).join(language === "en" ? " > " : " › ");

  const toggleExpanded = (nodeId: number) => {
    setExpandedNodeIds(prev => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  };

  const chooseNode = (nodeId: number) => {
    onChange(String(nodeId));
    setOpen(false);
  };

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(refreshTreeScrollMetrics);
    const onResize = () => refreshTreeScrollMetrics();
    window.addEventListener("resize", onResize);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", onResize);
    };
  }, [open, search, expandedNodeIds, nodes, refreshTreeScrollMetrics]);

  const treeCanScroll = treeScrollMetrics.scrollHeight > treeScrollMetrics.clientHeight + 1;
  const treeTrackHeight = treeScrollMetrics.clientHeight;
  const treeThumbHeight = treeCanScroll
    ? Math.max(42, (treeScrollMetrics.clientHeight / treeScrollMetrics.scrollHeight) * treeTrackHeight)
    : treeTrackHeight;
  const treeMaxScrollTop = Math.max(0, treeScrollMetrics.scrollHeight - treeScrollMetrics.clientHeight);
  const treeMaxThumbTop = Math.max(0, treeTrackHeight - treeThumbHeight);
  const treeThumbTop = treeCanScroll && treeMaxScrollTop > 0
    ? (treeScrollMetrics.scrollTop / treeMaxScrollTop) * treeMaxThumbTop
    : 0;

  const handleTreeThumbPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const el = treeScrollRef.current;
    if (!el || !treeCanScroll) return;

    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const startY = event.clientY;
    const startScrollTop = el.scrollTop;

    const onMove = (moveEvent: PointerEvent) => {
      const deltaY = moveEvent.clientY - startY;
      const scrollDelta = treeMaxThumbTop > 0
        ? (deltaY / treeMaxThumbTop) * treeMaxScrollTop
        : 0;
      el.scrollTop = Math.min(treeMaxScrollTop, Math.max(0, startScrollTop + scrollDelta));
      refreshTreeScrollMetrics();
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  const handleTreeTrackPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const el = treeScrollRef.current;
    if (!el || !treeCanScroll || event.target !== event.currentTarget) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const clickY = event.clientY - rect.top;
    const wantedThumbTop = Math.min(treeMaxThumbTop, Math.max(0, clickY - treeThumbHeight / 2));
    el.scrollTop = treeMaxThumbTop > 0
      ? (wantedThumbTop / treeMaxThumbTop) * treeMaxScrollTop
      : 0;
    refreshTreeScrollMetrics();
  };

  const renderNode = (node: CountCatalogNode, depth: number): ReactNode => {
    if (visibleNodeIds && !visibleNodeIds.has(Number(node.id))) return null;
    const nodeId = Number(node.id);
    const children = childrenByParent.get(nodeId) || [];
    const hasChildren = children.length > 0;
    const expanded = !!normalizedSearch || expandedNodeIds.has(nodeId);
    const selected = selectedNodeId === nodeId;

    return (
      <div key={nodeId}>
        <div
          className={`flex items-center gap-1 rounded-md border px-1.5 py-1 mb-1 transition-colors ${
            selected ? "border-blue-500 bg-blue-50 text-blue-900" : "border-transparent hover:border-slate-200 hover:bg-slate-50"
          }`}
          style={{ paddingInlineStart: `${depth * 16 + 6}px` }}
        >
          <button
            type="button"
            className="w-7 h-7 shrink-0 inline-flex items-center justify-center rounded hover:bg-slate-100 disabled:opacity-30"
            disabled={!hasChildren}
            onClick={() => hasChildren && toggleExpanded(nodeId)}
            aria-label={expanded ? "طي التصنيف" : "فتح التصنيف"}
          >
            {hasChildren ? (expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />) : <span className="w-4" />}
          </button>
          <button
            type="button"
            onClick={() => chooseNode(nodeId)}
            className="min-w-0 flex-1 text-start flex items-center justify-between gap-2 rounded px-1 py-1"
            title="اختيار هذا المستوى — يشمل جميع الفروع التابعة له"
          >
            <span className="min-w-0">
              <span className="block text-sm font-medium truncate">
                {node.code ? `${node.code} · ` : ""}{nodeLabel(node)}
              </span>
              {hasChildren && (
                <span className="block text-[11px] text-muted-foreground">
                  يمكن اختيار هذا المستوى — وسيشمل جميع الفروع تحته
                </span>
              )}
            </span>
            {selected && <Check className="w-4 h-4 text-blue-600 shrink-0" />}
          </button>
        </div>
        {hasChildren && expanded && children.map(child => renderNode(child, depth + 1))}
      </div>
    );
  };

  const roots = childrenByParent.get(null) || [];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" className="w-full justify-between font-normal min-h-10 h-auto py-2">
          <span className={`truncate ${selectedPathLabel ? "text-foreground" : "text-muted-foreground"}`}>
            {selectedPathLabel || "اختر التصنيف من شجرة الكتالوج..."}
          </span>
          <ChevronDown className="w-4 h-4 shrink-0 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(520px,calc(100vw-2rem))] p-3" align="start">
        <div className="space-y-2">
          <div>
            <p className="text-sm font-semibold">شجرة تصنيفات الكتالوج</p>
            <p className="text-xs text-muted-foreground mt-0.5">اختر أي مستوى؛ الاختيار يشمل العقدة المختارة وجميع الفروع التابعة لها.</p>
          </div>
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="ابحث بالاسم أو الكود..."
            className="h-9"
          />
          {selectedPath.length > 0 && (
            <div className="rounded-md border border-blue-100 bg-blue-50 px-2.5 py-2 text-xs text-blue-900">
              <span className="font-semibold">التصنيف المختار:</span> {selectedPathLabel}
            </div>
          )}
          <div
            className="grid h-80 grid-cols-[minmax(0,1fr)_20px] overflow-hidden rounded-md border bg-background"
            dir="ltr"
          >
            <div
              ref={treeScrollRef}
              dir="rtl"
              onScroll={refreshTreeScrollMetrics}
              className="h-full min-w-0 overflow-y-auto overscroll-contain p-2 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
            >
              {roots.length === 0 ? (
                <p className="text-sm text-muted-foreground py-5 text-center">لا توجد تصنيفات نشطة.</p>
              ) : visibleNodeIds && visibleNodeIds.size === 0 ? (
                <p className="text-sm text-muted-foreground py-5 text-center">لا يوجد تصنيف مطابق للبحث.</p>
              ) : (
                roots.map(node => renderNode(node, 0))
              )}
            </div>

            <div
              className="relative h-full w-5 shrink-0 border-s border-slate-400 bg-slate-200 shadow-inner cursor-pointer"
              onPointerDown={handleTreeTrackPointerDown}
              aria-label="شريط تمرير شجرة التصنيفات"
              role="scrollbar"
              aria-orientation="vertical"
              aria-valuemin={0}
              aria-valuemax={Math.max(0, Math.round(treeMaxScrollTop))}
              aria-valuenow={Math.max(0, Math.round(treeScrollMetrics.scrollTop))}
            >
              <div
                className={`absolute left-1 right-1 rounded-full border-2 border-slate-700 bg-slate-700 shadow-md ${
                  treeCanScroll ? "cursor-grab active:cursor-grabbing" : "opacity-45 cursor-default"
                }`}
                style={{
                  height: `${Math.max(28, treeThumbHeight)}px`,
                  top: `${Math.max(0, treeThumbTop)}px`,
                }}
                onPointerDown={handleTreeThumbPointerDown}
                title="اسحب للتحكم في التمرير"
              />
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}


// ── بطاقة صنف مضاف للعملية ──
function DisposalItemCard({ item, onRemove }: { item: any; onRemove: () => void }) {
  return (
    <div className="flex items-center gap-3 p-3 rounded-lg border bg-muted/30">
      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm truncate">{item.itemName}</p>
        <div className="flex gap-3 text-xs text-muted-foreground mt-0.5 flex-wrap">
          <span>الكمية: <strong className="text-foreground">{item.quantity} {item.unit}</strong></span>
          <span>السبب: <strong className="text-foreground">{REASON_LABELS[item.reason]}</strong></span>
          {item.lotCode && <span>الدفعة: <strong className="text-foreground font-mono">{item.lotCode}</strong></span>}
          {item.unitCost > 0 && <span>القيمة: <strong className="text-foreground">{fmtMoney(item.totalCost)}</strong></span>}
        </div>
      </div>
      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive shrink-0" onClick={onRemove}>
        <X className="w-3.5 h-3.5" />
      </Button>
    </div>
  );
}

export default function InventoryOperations() {
  const { user } = useAuth();
  const { t, language } = useTranslation();
  const isWarehouse = ["warehouse", "admin", "owner"].includes(user?.role || "");
  const canApplySettlement = ["admin", "owner"].includes(user?.role || "");

  // ── بيانات القائمة ──
  const { data: operations, isLoading, refetch } = trpc.disposal.list.useQuery();

  // ── حالة نافذة الاستبعاد ──
  const [showNew, setShowNew]           = useState(false);
  const [searchQuery, setSearchQuery]   = useState("");
  const [searchMode, setSearchMode]     = useState<"name" | "code" | "qr">("name");
  const [foundItem, setFoundItem]       = useState<any>(null);
  const [disposalItems, setDisposalItems] = useState<any[]>([]);
  const [operationNotes, setOperationNotes] = useState("");
  const [operationDate, setOperationDate]   = useState(new Date().toISOString().split("T")[0]);
  const [disposalLotInfo, setDisposalLotInfo] = useState<any>(null);
  const [disposalWarehouseId, setDisposalWarehouseId] = useState("");

  // ── حقول بيانات الاستبعاد للصنف الحالي ──
  const [qty, setQty]           = useState("");
  const [reason, setReason]     = useState("");
  const [itemNotes, setItemNotes] = useState("");

  // ── تفاصيل عملية ──
  const [detailId, setDetailId] = useState<number | null>(null);
  const { data: detail } = trpc.disposal.getById.useQuery(
    { id: detailId! }, { enabled: !!detailId }
  );

  // ── mutation ──
  const createMut = trpc.disposal.create.useMutation({
    onSuccess: (data) => {
      toast.success(`تم إنشاء عملية الاستبعاد ${data.operationNumber} بنجاح`);
      refetch();
      resetNew();
    },
    onError: (e: any) => toast.error(e.message),
  });

  // ── البحث عن صنف ──
  const { data: inventoryList } = trpc.inventory.list.useQuery();
  const { data: warehousesList } = trpc.warehouse.list.useQuery();
  const { data: countCatalogNodes = [] } = trpc.catalog.nodes.list.useQuery({ isActive: true });

  // ══════════════════════════════════════════════════════════
  // وحدة الجرد وتسوية المخزون
  // ══════════════════════════════════════════════════════════
  const { data: countOperations, refetch: refetchCounts } = trpc.inventoryCount.listOperations.useQuery();
  const { data: lotTrackingStatus } = trpc.inventoryCount.lotTrackingStatus.useQuery();
  const lotsEnabled = !!lotTrackingStatus?.enabled;
  const resolveDisposalLotMut = trpc.disposal.resolveLot.useMutation({
    onSuccess: (data) => {
      setDisposalLotInfo(data);
      setFoundItem({
        id: data.inventoryId,
        itemName: data.itemName,
        internalCode: data.internalCode,
        unit: data.unit || "",
        location: data.location,
        averageCost: data.averageCost || "0",
        quantity: data.inventoryQuantity,
      });
      setQty(String(data.availableQuantity));
      setSearchQuery("");
      setSearchMode("qr");
      toast.success(`تم التحقق من الدفعة ${data.lotCode}: ${data.itemName}`);
    },
    onError: (e: any) => {
      setDisposalLotInfo(null);
      setFoundItem(null);
      setQty("");
      toast.error(e.message);
    },
  });
  const [activeCountId, setActiveCountId] = useState<number | null>(null);
  const { data: countDetail, refetch: refetchCountDetail } = trpc.inventoryCount.operationDetails.useQuery(
    { operationId: activeCountId! }, { enabled: !!activeCountId }
  );
  const [showUncountedOnly, setShowUncountedOnly] = useState(false);

  // ── لوحة إضافة/مسح صنف داخل جرد جزئي جارٍ (باركود/رقم/اختيار) ──
  const [scanMode, setScanMode] = useState<"name" | "code" | "qr">("qr");
  const [scanQuery, setScanQuery] = useState("");
  const [periodicCountSearch, setPeriodicCountSearch] = useState("");
  const [periodicCountCatalogNodeId, setPeriodicCountCatalogNodeId] = useState("");
  const countLotEntryModeRef = useRef<"qr" | "manual">("qr");
  // إضافة صنف للجرد: لا يُخمَّن أي كمية — يُنشأ سطر بانتظار العدّ ثم تُفتح
  // نافذة "عدّ الصنف" مباشرة ليُدخل المستخدم الكمية الفعلية بنفسه.
  const addItemMut = trpc.inventoryCount.addItem.useMutation({
    onSuccess: (data) => {
      setEditingItem({
        countItemId: data.countItemId,
        itemName: data.itemName,
        unit: data.unit,
        systemQuantity: data.systemQuantity,
      });
      setEditCountedQty(data.countedQuantity !== null ? String(data.countedQuantity) : "");
      setEditLot(data.lotNumber ?? "");
      setEditExpiry(toDateInputValue(data.expiryDate));
      setEditNotes(data.notes ?? "");
      refetchCountDetail();
      setScanQuery("");
    },
    onError: (e: any) => {
      if (e.message === "COUNT_ITEM_NOT_IN_OPENING_SNAPSHOT") {
        toast.error(t.inventory.countItemNotInOpeningSnapshot);
        return;
      }
      toast.error(e.message);
    },
  });
  const scanCountLotMut = trpc.inventoryCount.scanLot.useMutation({
    onSuccess: (data: any) => {
      setEditingItem({
        countItemId: data.countItemId,
        inventoryId: data.inventoryId,
        lotId: data.lotId,
        lotCode: data.lotCode,
        trackingToken: data.trackingToken,
        entryMode: countLotEntryModeRef.current,
        itemName: data.itemName,
        unit: data.unit,
        systemQuantity: data.systemQuantity,
      });
      setEditCountedQty(data.countedQuantity !== null ? String(data.countedQuantity) : "");
      setEditLot("");
      setEditExpiry("");
      setEditNotes(data.notes ?? "");
      refetchCountDetail();
      setScanQuery("");
      toast.success(`تم التعرف على الدفعة ${data.lotCode}`);
      countLotEntryModeRef.current = "qr";
    },
    onError: (e: any) => {
      if (e.message === "COUNT_LOT_OUTSIDE_CATEGORY_SCOPE") {
        toast.error(t.inventory.countLotOutsideCategoryScope);
        return;
      }
      if (e.message === "COUNT_LOT_NOT_IN_OPENING_SNAPSHOT") {
        toast.error(t.inventory.countLotNotInOpeningSnapshot);
        return;
      }
      toast.error(e.message);
    },
  });
  function handleScanResolved(code: string) {
    if (!activeCountId) return;
    const isPeriodicLotCountActive = lotsEnabled && (countDetail?.operation as any)?.countType === "periodic";
    if (isPeriodicLotCountActive) {
      countLotEntryModeRef.current = "qr";
      scanCountLotMut.mutate({ operationId: activeCountId, trackingToken: code });
      return;
    }

    const found = ((inventoryList as any[]) || []).find((i: any) =>
      i.internalCode === code || i.manufacturerBarcode === code || String(i.id) === code
    );
    if (!found) { toast.error(`لم يتم العثور على صنف برقم: ${code}`); return; }
    addItemMut.mutate({ operationId: activeCountId, inventoryId: found.id });
  }
  const scanSearchResults = scanMode !== "qr" && scanQuery.trim().length > 0
    ? ((inventoryList as any[]) || []).filter((i: any) => {
        const q = scanQuery.toLowerCase();
        if (scanMode === "code") return i.internalCode?.toLowerCase().includes(q) || i.manufacturerBarcode?.toLowerCase().includes(q);
        return i.itemName?.toLowerCase().includes(q);
      }).slice(0, 8)
    : [];

  // ── إضافة صنف جديد كليّاً (غير موجود بالمخزون أصلاً) أثناء جرد يدوي جارٍ ──
  const [showNewItem, setShowNewItem] = useState(false);
  const [newItemName, setNewItemName] = useState("");
  const [newItemUnit, setNewItemUnit] = useState("");
  const [newItemQty, setNewItemQty] = useState("");
  const [newItemCost, setNewItemCost] = useState("");
  const [openingCatalogSearch, setOpeningCatalogSearch] = useState("");
  const [openingCatalogNodeId, setOpeningCatalogNodeId] = useState("");
  const [selectedOpeningCatalogItem, setSelectedOpeningCatalogItem] = useState<any>(null);
  const { data: catalogUnits } = trpc.catalog.units.list.useQuery();
  const isOpeningBalanceCount = (countDetail?.operation as any)?.countType === "opening_balance";
  const isPeriodicLotCount = lotsEnabled && (countDetail?.operation as any)?.countType === "periodic";

  useEffect(() => {
    setPeriodicCountSearch("");
    setPeriodicCountCatalogNodeId("");
    setOpeningCatalogSearch("");
    setOpeningCatalogNodeId("");
    setSelectedOpeningCatalogItem(null);
  }, [activeCountId]);

  const periodicSearchCatalogNodes = useMemo(() => {
    const allNodes = (countCatalogNodes as CountCatalogNode[]) || [];
    const operationNodeId = Number((countDetail?.operation as any)?.catalogNodeId || 0);
    if (!operationNodeId) return allNodes;

    const childrenByParent = new Map<number, number[]>();
    for (const node of allNodes) {
      if (!node.parentId) continue;
      const list = childrenByParent.get(Number(node.parentId)) || [];
      list.push(Number(node.id));
      childrenByParent.set(Number(node.parentId), list);
    }
    const allowed = new Set<number>();
    const queue = [operationNodeId];
    while (queue.length) {
      const nodeId = queue.shift()!;
      if (allowed.has(nodeId)) continue;
      allowed.add(nodeId);
      for (const childId of childrenByParent.get(nodeId) || []) queue.push(childId);
    }
    return allNodes.filter(node => allowed.has(Number(node.id)));
  }, [countCatalogNodes, countDetail?.operation]);

  const countCatalogPathLabel = useCallback((nodeId: number | null | undefined) => {
    const numericNodeId = Number(nodeId || 0);
    if (!numericNodeId) return "";
    const nodeById = new Map((countCatalogNodes as CountCatalogNode[]).map(node => [Number(node.id), node]));
    const path: CountCatalogNode[] = [];
    const visited = new Set<number>();
    let current = nodeById.get(numericNodeId);
    while (current && !visited.has(Number(current.id))) {
      path.unshift(current);
      visited.add(Number(current.id));
      current = current.parentId ? nodeById.get(Number(current.parentId)) : undefined;
    }
    return path.map(node => language === "en"
      ? (node.nameEn || node.nameAr || `#${node.id}`)
      : (node.nameAr || node.nameEn || `#${node.id}`)
    ).join(language === "en" ? " > " : " › ");
  }, [countCatalogNodes, language]);

  const { data: periodicLotSearchResults = [], isFetching: periodicLotSearchLoading } = trpc.inventoryCount.searchCandidates.useQuery(
    {
      operationId: activeCountId || 0,
      search: periodicCountSearch.trim() || undefined,
      catalogNodeId: periodicCountCatalogNodeId ? Number(periodicCountCatalogNodeId) : undefined,
      limit: 30,
    },
    {
      enabled: !!activeCountId
        && countDetail?.operation?.status === "in_progress"
        && isPeriodicLotCount
        && (!!periodicCountSearch.trim() || !!periodicCountCatalogNodeId),
    },
  );

  const { data: openingCatalogItems = [], isFetching: openingCatalogLoading } = trpc.inventoryCount.searchCandidates.useQuery(
    {
      operationId: activeCountId || 0,
      search: openingCatalogSearch.trim() || undefined,
      catalogNodeId: openingCatalogNodeId ? Number(openingCatalogNodeId) : undefined,
      limit: 30,
    },
    { enabled: !!activeCountId && showNewItem && isOpeningBalanceCount },
  );
  const addNewItemMut = trpc.inventoryCount.addNewItem.useMutation({
    onSuccess: (data: any) => {
      if (data.openingBalancePending) {
        toast.success(`تمت إضافة "${data.itemName}" للرصد الافتتاحي — لن يتغير المخزون حتى تطبيق التسوية`);
      } else {
        toast.success(`تم إضافة "${data.itemName}" للمخزون — كود الصنف ${data.internalCode} / باركود ${data.manufacturerBarcode}`);
      }
      refetchCountDetail();
      setShowNewItem(false);
      setNewItemName("");
      setNewItemUnit("");
      setNewItemQty("");
      setNewItemCost("");
      setOpeningCatalogSearch("");
      setOpeningCatalogNodeId("");
      setSelectedOpeningCatalogItem(null);
    },
    onError: (e: any) => toast.error(e.message),
  });
  function selectPeriodicLotFromSearch(item: any) {
    if (!activeCountId || !item?.trackingToken) return;
    countLotEntryModeRef.current = "manual";
    scanCountLotMut.mutate({ operationId: activeCountId, trackingToken: item.trackingToken });
  }

  function submitNewItem() {
    if (!activeCountId) return;
    const quantity = parseFloat(newItemQty || "0");
    const cost = newItemCost.trim() !== "" ? parseFloat(newItemCost) : undefined;
    if (isOpeningBalanceCount) {
      if (!selectedOpeningCatalogItem) { toast.error("اختر صنفاً من Master Catalog"); return; }
      addNewItemMut.mutate({
        operationId: activeCountId,
        catalogItemId: selectedOpeningCatalogItem.id,
        quantity,
        cost,
      });
      return;
    }
    addNewItemMut.mutate({
      operationId: activeCountId,
      itemName: newItemName.trim(),
      unit: newItemUnit,
      quantity,
      cost,
    });
  }

  // ── بدء جرد جديد ──
  const [showNewCount, setShowNewCount] = useState(false);
  const [countType, setCountType] = useState<"periodic" | "opening_balance">("periodic");
  const [countScope, setCountScope] = useState<"full" | "partial">("full");
  // 2B-9: في Lot mode نفصل بين كامل المخزن، Catalog subtree، والجرد اليدوي بالـQR.
  const [countLotScopeMode, setCountLotScopeMode] = useState<"full" | "category" | "manual">("full");
  const [countCatalogNodeId, setCountCatalogNodeId] = useState<string>("");
  const [countUiMode, setCountUiMode] = useState<"auto" | "manual">("auto"); // auto = تحميل كل الأصناف دفعة، manual = بالباركود/الرقم/الاختيار تباعاً
  const [countTitle, setCountTitle] = useState("");

  // اختيار المخزن — أول خطوة عند بدء أي جرد (2026-08-05). إلزامي؛ يُختار
  // المخزن الرئيسي تلقائيًا عند فتح النافذة أول مرة، والمستخدم يقدر يغيّره.
  const [countWarehouseId, setCountWarehouseId] = useState<string>("");
  useEffect(() => {
    if (showNewCount && !countWarehouseId && warehousesList?.length) {
      const main = (warehousesList as any[]).find((w: any) => w.type === "main");
      setCountWarehouseId(String((main || warehousesList[0]).id));
    }
  }, [showNewCount, warehousesList, countWarehouseId]);

  const warehouseName = (id: number | null | undefined) =>
    id ? ((warehousesList as any[]) || []).find((w: any) => w.id === id)?.nameAr || `#${id}` : "—";

  const countScopeCategoryName = (operation: any) => {
    if (!operation?.catalogNodeId) return null;
    return language === "en"
      ? (operation.catalogNodeNameEn || operation.catalogNodeNameAr || `#${operation.catalogNodeId}`)
      : (operation.catalogNodeNameAr || operation.catalogNodeNameEn || `#${operation.catalogNodeId}`);
  };

  // معاينة توقيت الرياض بالواجهة فقط — للعرض قبل الإنشاء (القيمة المعتمدة فعلياً
  // تُحسب من ساعة الخادم نفسها عند الإنشاء، مو من هذا العرض ولا من جهاز المستخدم)
  const [riyadhPreview, setRiyadhPreview] = useState({ date: "", dayName: "", time: "" });
  useEffect(() => {
    const update = () => {
      const now = new Date();
      setRiyadhPreview({
        date: now.toLocaleDateString("en-CA", { timeZone: "Asia/Riyadh" }),
        dayName: now.toLocaleDateString("ar-SA-u-ca-gregory", { timeZone: "Asia/Riyadh", weekday: "long" }),
        time: now.toLocaleTimeString("en-GB", { timeZone: "Asia/Riyadh", hour12: false }),
      });
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, []);
  const [countItemSearch, setCountItemSearch] = useState("");
  const [selectedPartialIds, setSelectedPartialIds] = useState<number[]>([]);

  const createCountMut = trpc.inventoryCount.createOperation.useMutation({
    onSuccess: (data) => {
      toast.success(`تم بدء الجرد ${data.operationNumber} — ${data.itemCount} صنف`);
      refetchCounts();
      setActiveCountId(data.operationId);
      setShowNewCount(false);
      setCountTitle("");
      setCountType("periodic");
      setCountWarehouseId("");
      setCountLotScopeMode("full");
      setCountCatalogNodeId("");
      setSelectedPartialIds([]);
    },
    onError: (e: any) => toast.error(e.message),
  });

  // ── تسجيل عد صنف ──
  const [editingItem, setEditingItem] = useState<any>(null);
  const [editCountedQty, setEditCountedQty] = useState("");
  const [editLot, setEditLot] = useState("");
  const [editExpiry, setEditExpiry] = useState("");
  const [editNotes, setEditNotes] = useState("");

  const recordItemMut = trpc.inventoryCount.recordItem.useMutation({
    onSuccess: () => {
      toast.success(t.inventory.countQuantityRecorded);
      refetchCountDetail();
      setEditingItem(null);
    },
    onError: (e: any) => {
      if (e.message === "COUNT_LOT_OUTSIDE_CATEGORY_SCOPE") {
        toast.error(t.inventory.countLotOutsideCategoryScope);
        return;
      }
      if (e.message === "COUNT_LOT_NOT_IN_OPENING_SNAPSHOT") {
        toast.error(t.inventory.countLotNotInOpeningSnapshot);
        return;
      }
      toast.error(e.message);
    },
  });

  const completeCountMut = trpc.inventoryCount.completeOperation.useMutation({
    onSuccess: (data) => {
      toast.success(`تم إنهاء الجرد — ${data.totalDiscrepancies} فرق من أصل ${data.totalItemsCounted}`);
      refetchCounts();
      refetchCountDetail();
    },
    onError: (e: any) => toast.error(e.message),
  });

  // ── حذف مسودة جرد (المسودات فقط، قابلة للحذف قبل الحفظ النهائي) ──
  const deleteCountMut = trpc.inventoryCount.deleteOperation.useMutation({
    onSuccess: () => {
      toast.success("تم حذف مسودة الجرد");
      setActiveCountId(null);
      refetchCounts();
    },
    onError: (e: any) => toast.error(e.message),
  });

  // ── تسوية المخزون ──
  const [showSettlement, setShowSettlement] = useState(false);
  const [settlementSourceCountId, setSettlementSourceCountId] = useState<number | null>(null);
  const { data: discrepancies } = trpc.inventoryCount.countDiscrepancies.useQuery(
    { operationId: settlementSourceCountId! }, { enabled: !!settlementSourceCountId }
  );
  const [settlementItems, setSettlementItems] = useState<any[]>([]);
  const [settlementReason, setSettlementReason] = useState("");
  const [settlementReference, setSettlementReference] = useState("");
  const [settlementSearchMode, setSettlementSearchMode] = useState<"name" | "code" | "qr">("name");
  const [openingLotLabels, setOpeningLotLabels] = useState<LotLabelItem[]>([]);

  // مسح باركود/QR مباشر لإضافة صنف للتسوية المستقلة
  function handleSettlementScanResolved(code: string) {
    const found = ((inventoryList as any[]) || []).find((i: any) =>
      i.internalCode === code || i.manufacturerBarcode === code || String(i.id) === code
    );
    if (!found) { toast.error(`لم يتم العثور على صنف برقم: ${code}`); return; }
    if (settlementItems.some(s => s.inventoryId === found.id)) { toast.error("الصنف مضاف بالفعل للتسوية"); return; }
    setSettlementItems(prev => [...prev, {
      inventoryId: found.id,
      afterQuantity: Number(found.quantity || 0),
      currentQuantity: Number(found.quantity || 0),
      averageCost: Number(found.averageCost || 0),
      unit: found.unit,
      itemName: found.itemName,
    }]);
  }
  // نتائج البحث بالاسم أو بالرقم (كود داخلي/باركود مصنع) للتسوية المستقلة
  const settlementSearchResults = settlementSearchMode !== "qr" && countItemSearch.trim().length > 0
    ? ((inventoryList as any[]) || []).filter((i: any) => {
        const q = countItemSearch.toLowerCase();
        const matches = settlementSearchMode === "code"
          ? (i.internalCode?.toLowerCase().includes(q) || i.manufacturerBarcode?.toLowerCase().includes(q))
          : i.itemName?.toLowerCase().includes(q);
        return matches && !settlementItems.some(s => s.inventoryId === i.id);
      }).slice(0, 20)
    : [];

  const applySettlementMut = trpc.inventoryCount.applySettlement.useMutation({
    onSuccess: (data: any) => {
      toast.success(`تم تطبيق التسوية ${data.settlementNumber} بنجاح`);
      setShowSettlement(false);
      setSettlementItems([]);
      setSettlementReason("");
      setSettlementReference("");
      setSettlementSourceCountId(null);
      if (data.lotLabels?.length) setOpeningLotLabels(data.lotLabels);
      refetchCounts();
      refetchCountDetail();
      refetchSettlements();
    },
    onError: (e: any) => toast.error(e.message),
  });

  // ── الأرشيف (عمليات جرد + تسويات) ──
  const [countView, setCountView] = useState<"active" | "archive">("active");
  const { data: settlementsList, refetch: refetchSettlements } = trpc.inventoryCount.listSettlements.useQuery();
  const [printSettlementId, setPrintSettlementId] = useState<number | null>(null);
  const { data: printSettlementDetail } = trpc.inventoryCount.settlementDetails.useQuery(
    { settlementId: printSettlementId! }, { enabled: !!printSettlementId }
  );
  const [printCountId, setPrintCountId] = useState<number | null>(null);
  const { data: printCountDetail } = trpc.inventoryCount.operationDetails.useQuery(
    { operationId: printCountId! }, { enabled: !!printCountId }
  );

  // ── طباعة وثيقة جرد رسمية (تصميم كامل، بنفس مستوى وثيقة الاستبعاد) ──────────

  // ── طباعة وثيقة تسوية مخزون رسمية ──────────────────────────────────────────

  useEffect(() => {
    if (printCountId && printCountDetail) {
      printCountDocument(printCountDetail as any);
      setPrintCountId(null);
    }
  }, [printCountId, printCountDetail]);

  useEffect(() => {
    if (printSettlementId && printSettlementDetail) {
      printSettlementDocument(printSettlementDetail as any);
      setPrintSettlementId(null);
    }
  }, [printSettlementId, printSettlementDetail]);

  const searchResults = searchQuery.trim().length > 0
    ? ((inventoryList as any[]) || []).filter((i: any) => {
        const q = searchQuery.toLowerCase();
        if (searchMode === "code") return i.internalCode?.toLowerCase().includes(q) || i.manufacturerBarcode?.toLowerCase().includes(q);
        return i.itemName?.toLowerCase().includes(q);
      }).slice(0, 8)
    : [];

  function selectItem(item: any) {
    setDisposalLotInfo(null);
    setFoundItem(item);
    setSearchQuery("");
    setQty(String(item.quantity));
    setSearchMode("name"); // رجوع لوضع البحث الافتراضي
  }

  // مع Feature Gate يكون QR هنا QR الدفعة وليس باركود Inventory القديم.
  // الخادم يحل Tracking Token إلى Lot + Inventory ولا يثق بمعرّف من العميل.
  function handleQRScan(code: string) {
    if (lotsEnabled) {
      if (!disposalWarehouseId) {
        toast.error("اختر المستودع أولاً ثم امسح QR الدفعة");
        return;
      }
      resolveDisposalLotMut.mutate({ warehouseId: Number(disposalWarehouseId), trackingToken: code });
      return;
    }

    const found = ((inventoryList as any[]) || []).find((i: any) =>
      i.internalCode === code ||
      i.manufacturerBarcode === code ||
      String(i.id) === code
    );
    if (found) {
      selectItem(found);
      toast.success(`تم العثور على الصنف: ${found.itemName}`);
    } else {
      toast.error(`لم يتم العثور على صنف برقم: ${code}`);
    }
  }

  function addItemToList() {
    if (!foundItem) { toast.error(lotsEnabled ? "امسح QR الدفعة أولاً" : "اختر صنفاً أولاً"); return; }
    if (lotsEnabled && !disposalLotInfo) { toast.error("يجب مسح QR دفعة صالح قبل إضافة البند"); return; }
    if (!qty || parseFloat(qty) <= 0) { toast.error("أدخل كمية صحيحة"); return; }
    const availableQuantity = lotsEnabled
      ? Number(disposalLotInfo?.availableQuantity || 0)
      : Number(foundItem.quantity || 0);
    if (parseFloat(qty) > availableQuantity) { toast.error(`الكمية أكبر من رصيد الدفعة المتاح (${availableQuantity})`); return; }
    if (!reason) { toast.error("اختر سبب الاستبعاد"); return; }
    if (lotsEnabled && disposalItems.some(item => item.lotTrackingToken === disposalLotInfo?.trackingToken)) {
      toast.error("هذه الدفعة مضافة للعملية بالفعل؛ عدّل الكمية في بند واحد بدل تكرارها");
      return;
    }

    const unitCost  = parseFloat(foundItem.averageCost || "0");
    const totalCost = unitCost * parseFloat(qty);

    setDisposalItems(prev => [...prev, {
      inventoryId: foundItem.id,
      itemName:    foundItem.itemName,
      unit:        foundItem.unit || "",
      quantity:    parseFloat(qty),
      reason,
      unitCost,
      totalCost,
      lotTrackingToken: lotsEnabled ? disposalLotInfo?.trackingToken : undefined,
      lotCode:     lotsEnabled ? disposalLotInfo?.lotCode : undefined,
      notes:       itemNotes || undefined,
    }]);

    setFoundItem(null);
    setDisposalLotInfo(null);
    setQty("");
    setReason("");
    setItemNotes("");
    setSearchQuery("");
    setSearchMode(lotsEnabled ? "qr" : "name");
    toast.success("تم إضافة الصنف — يمكنك إضافة صنف آخر أو حفظ العملية");
  }

  function resetNew() {
    setShowNew(false);
    setSearchQuery("");
    setFoundItem(null);
    setDisposalLotInfo(null);
    setDisposalItems([]);
    setOperationNotes("");
    setQty("");
    setReason("");
    setItemNotes("");
    setOperationDate(new Date().toISOString().split("T")[0]);
    setDisposalWarehouseId("");
    setSearchMode(lotsEnabled ? "qr" : "name");
  }

  function submitDisposal() {
    if (disposalItems.length === 0) { toast.error("أضف صنفاً واحداً على الأقل"); return; }
    if (lotsEnabled) {
      if (!disposalWarehouseId) { toast.error("يجب اختيار المستودع قبل حفظ عملية الاستبعاد"); return; }
      if (disposalItems.some(item => !item.lotTrackingToken)) {
        toast.error("يجب أن يكون لكل بند استبعاد QR دفعة صالح");
        return;
      }
    }
    createMut.mutate({
      operationDate,
      warehouseId: lotsEnabled && disposalWarehouseId ? Number(disposalWarehouseId) : undefined,
      notes: operationNotes || undefined,
      items: disposalItems,
    });
  }


  if (openingLotLabels.length > 0) {
    return <LotLabelsPrintScreen items={openingLotLabels} onDone={() => setOpeningLotLabels([])} />;
  }

  return (
    <div className="space-y-6">
      {/* العنوان */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ClipboardList className="w-6 h-6 text-primary" />
            عمليات المخزون
          </h1>
          <p className="text-sm text-muted-foreground mt-1">إدارة عمليات الاستبعاد والجرد</p>
        </div>
      </div>

      <Tabs defaultValue="disposal">
        <TabsList className="grid grid-cols-3 w-full max-w-md">
          <TabsTrigger value="disposal" className="gap-1.5">
            <Trash2 className="w-3.5 h-3.5" />
            الاستبعاد
          </TabsTrigger>
          <TabsTrigger value="inventory_count" className="gap-1.5">
            <BookOpen className="w-3.5 h-3.5" />
            الجرد
          </TabsTrigger>
          <TabsTrigger value="settlements" className="gap-1.5">
            <ClipboardList className="w-3.5 h-3.5" />
            التسويات
          </TabsTrigger>
        </TabsList>

        {/* ══ تبويب الاستبعاد ══ */}
        <TabsContent value="disposal" className="mt-6 space-y-4">
          {isWarehouse && (
            <div className="flex justify-end">
              <Button className="gap-2" onClick={() => { setSearchMode(lotsEnabled ? "qr" : "name"); setShowNew(true); }}>
                <Plus className="w-4 h-4" />
                استبعاد جديد
              </Button>
            </div>
          )}

          {/* جدول العمليات */}
          {isLoading ? (
            <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
          ) : !operations?.length ? (
            <Card><CardContent className="p-12 text-center">
              <Trash2 className="w-12 h-12 mx-auto text-muted-foreground/40 mb-4" />
              <h3 className="font-semibold text-lg mb-1">لا توجد عمليات استبعاد</h3>
              <p className="text-sm text-muted-foreground">اضغط "استبعاد جديد" لإنشاء أول عملية</p>
            </CardContent></Card>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/50 text-xs text-muted-foreground">
                    <th className="text-right font-medium px-3 py-2.5">رقم العملية</th>
                    <th className="text-right font-medium px-3 py-2.5">التاريخ</th>
                    <th className="text-center font-medium px-3 py-2.5">عدد الأصناف</th>
                    <th className="text-center font-medium px-3 py-2.5">إجمالي الكمية</th>
                    <th className="text-center font-medium px-3 py-2.5">إجمالي القيمة</th>
                    <th className="text-right font-medium px-3 py-2.5">المنفذ</th>
                    <th className="text-center font-medium px-3 py-2.5">الحالة</th>
                    <th className="text-center px-3 py-2.5"></th>
                  </tr>
                </thead>
                <tbody>
                  {(operations as any[]).map((op: any) => {
                    const statusMeta = STATUS_LABELS[op.status] || { label: op.status, color: "bg-gray-100 text-gray-800" };
                    return (
                      <tr key={op.id} className="border-t hover:bg-muted/30 cursor-pointer transition-colors" onClick={() => setDetailId(op.id)}>
                        <td className="px-3 py-2.5 text-right align-middle font-mono font-semibold">{op.operationNumber}</td>
                        <td className="px-3 py-2.5 text-right align-middle text-muted-foreground">{fmtDate(op.operationDate)}</td>
                        <td className="px-3 py-2.5 text-center align-middle">{op.totalItems}</td>
                        <td className="px-3 py-2.5 text-center align-middle">{op.totalQuantity?.toLocaleString()}</td>
                        <td className="px-3 py-2.5 text-center align-middle">{fmtMoney(op.totalValue)}</td>
                        <td className="px-3 py-2.5 text-right align-middle text-muted-foreground">{op.creatorName}</td>
                        <td className="px-3 py-2.5 text-center align-middle">
                          <Badge className={`text-[10px] ${statusMeta.color}`}>{statusMeta.label}</Badge>
                        </td>
                        <td className="px-3 py-2.5 text-center align-middle">
                          <ChevronRight className="w-4 h-4 mx-auto text-muted-foreground" />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        {/* ══ تبويب الجرد وتسوية المخزون ══ */}
        <TabsContent value="inventory_count" className="mt-6 space-y-4">

          <div className="flex gap-2">
            <Button size="sm" variant={countView === "active" ? "default" : "outline"} onClick={() => setCountView("active")}>
              العمليات الحالية
            </Button>
            <Button size="sm" variant={countView === "archive" ? "default" : "outline"} onClick={() => setCountView("archive")}>
              الأرشيف
            </Button>
          </div>

          {countView === "archive" ? (
            <div className="space-y-4">
              <div className="space-y-2">
                {((countOperations as any[]) || []).filter(op => op.status === "completed").map((op) => (
                  <Card key={op.id}>
                    <CardContent className="p-4 flex items-center justify-between">
                      <div className="cursor-pointer flex-1" onClick={() => { setActiveCountId(op.id); setCountView("active"); }}>
                        <p className="font-medium">{op.operationTitle || op.operationNumber}</p>
                        <p className="text-[11px] text-muted-foreground">{op.operationNumber}</p>
                        <p className="text-xs text-muted-foreground">
                          <span className="font-medium text-foreground/80">{warehouseName(op.warehouseId)}</span>
                          {" — "}
                          {op.scope === "full" ? "شامل" : "جزئي"}
                          {countScopeCategoryName(op) && ` — التصنيف: ${countScopeCategoryName(op)}`}
                          {" — "}{fmtDate(op.operationDate)} — {op.totalItemsCounted} صنف
                          {op.totalDiscrepancies > 0 && ` — ${op.totalDiscrepancies} فرق`}
                        </p>
                      </div>
                      <Badge variant={op.status === "completed" ? "default" : "secondary"} className="ml-2">
                        {op.status === "completed" ? "نهائي" : "مسودة"}
                      </Badge>
                      <Button variant="ghost" size="icon" onClick={() => setPrintCountId(op.id)} title="طباعة">
                        <Printer className="w-4 h-4" />
                      </Button>
                    </CardContent>
                  </Card>
                ))}
                {!(countOperations as any[])?.some(op => op.status === "completed") && (
                  <p className="text-sm text-muted-foreground text-center py-8">لا توجد عمليات جرد بالأرشيف</p>
                )}
              </div>
            </div>
          ) : (
          <>
          {/* ─── شاشة تفاصيل جرد نشط/مكتمل ─── */}
          {activeCountId && countDetail ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <Button variant="ghost" size="sm" onClick={() => setActiveCountId(null)} className="mb-1">
                    ← رجوع لقائمة عمليات الجرد
                  </Button>
                  <h3 className="font-semibold text-lg">
                    {countDetail.operation.operationTitle || countDetail.operation.operationNumber}
                    <Badge className="mr-2" variant={countDetail.operation.status === "completed" ? "default" : "secondary"}>
                      {countDetail.operation.status === "completed" ? "نهائي (مقفل)" : "مسودة (قابلة للتعديل)"}
                    </Badge>
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    <span className="font-medium text-foreground/80">{warehouseName(countDetail.operation.warehouseId)}</span>
                    {" — "}
                    {countDetail.operation.operationNumber} — {countDetail.operation.scope === "full" ? "جرد شامل" : "جرد جزئي"}
                    {countScopeCategoryName(countDetail.operation) && ` — التصنيف: ${countScopeCategoryName(countDetail.operation)}`}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    التاريخ: {fmtDate(countDetail.operation.operationDate)} — اليوم: {countDetail.operation.riyadhDayName || "—"} — وقت البدء: {countDetail.operation.riyadhStartTime || "—"} (بتوقيت الرياض)
                  </p>
                  {countDetail.operation.status === "in_progress" && !countDetail.items.some((it: any) => it.countedQuantity !== null) && (
                    <p className="text-xs text-amber-600 mt-1">أضف/عُدَّ صنفاً واحداً على الأقل ليظهر خيار الحفظ النهائي</p>
                  )}
                  {/* ── مؤشر تقدّم الجرد — كم صنف اتعدّ من إجمالي أصناف العملية ── */}
                  {countDetail.items.length > 0 && (() => {
                    const total = countDetail.items.length;
                    const counted = countDetail.items.filter((it: any) => it.countedQuantity !== null).length;
                    const pct = Math.round((counted / total) * 100);
                    return (
                      <div className="mt-2 max-w-xs">
                        <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                          <span>تقدّم الجرد</span>
                          <span className="font-medium text-foreground">{counted} / {total} ({pct}%)</span>
                        </div>
                        <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${pct === 100 ? "bg-emerald-500" : "bg-primary"}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })()}
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline" size="sm"
                    onClick={() => setShowUncountedOnly(!showUncountedOnly)}
                  >
                    {showUncountedOnly ? "عرض الكل" : "عرض الأصناف الغير مجرودة فقط"}
                  </Button>
                  {countDetail.operation.status === "in_progress" && (
                    <>
                      <Button
                        variant="destructive" size="icon"
                        title="حذف مسودة الجرد"
                        onClick={() => {
                          if (window.confirm("سيتم حذف مسودة الجرد هذه بكل ما تم عدّه فيها نهائياً. هل أنت متأكد؟")) {
                            deleteCountMut.mutate({ operationId: activeCountId });
                          }
                        }}
                        disabled={deleteCountMut.isPending}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                      {countDetail.items.some((it: any) => it.countedQuantity !== null) && (
                        <Button
                          size="sm"
                          onClick={() => {
                            if (window.confirm("بعد الحفظ النهائي لا يمكن التعديل على هذا الجرد إطلاقاً. هل أنت متأكد؟")) {
                              completeCountMut.mutate({ operationId: activeCountId });
                            }
                          }}
                          disabled={completeCountMut.isPending}
                        >
                          حفظ نهائي (لا يمكن التعديل لاحقاً)
                        </Button>
                      )}
                    </>
                  )}
                  {countDetail.operation.status === "completed" && canApplySettlement && (
                    <Button
                      size="sm"
                      onClick={() => {
                        setSettlementSourceCountId(activeCountId);
                        setShowSettlement(true);
                      }}
                    >
                      فتح تسوية من هذا الجرد
                    </Button>
                  )}
                </div>
              </div>

              {/* لوحة المسح أثناء الجرد الدوري */}
              {countDetail.operation.status === "in_progress" && !isOpeningBalanceCount && (isPeriodicLotCount || countDetail.operation.scope === "partial") && (
                <Card className={isPeriodicLotCount ? "border-blue-200 bg-blue-50/30" : "bg-muted/20"}>
                  <CardContent className="p-3 space-y-2">
                    {isPeriodicLotCount ? (
                      <>
                        <div className="flex items-center gap-2">
                          <QrCode className="w-4 h-4 text-blue-700" />
                          <p className="text-sm font-medium">مسح QR أو البحث عن الدفعة</p>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          QR يبقى الطريقة الأساسية للجرد بالـLot. عند الحاجة يمكنك البحث بكود الصنف، الاسم العربي أو الإنجليزي، باركود المصنع، رقم LOT أو شجرة التصنيف.
                          {" "}{t.inventory.countManualEntryHint}
                        </p>
                        <BarcodeScanner onScan={handleScanResolved} placeholder="امسح QR الدفعة CMMS-LOT-..." />

                        <div className="border-t pt-3 mt-3 space-y-2">
                          <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(260px,0.75fr)]">
                            <div className="relative">
                              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                              <Input
                                value={periodicCountSearch}
                                onChange={e => setPeriodicCountSearch(e.target.value)}
                                placeholder="كود الصنف، الاسم، باركود المصنع أو LOT-2026-00001"
                                className="pr-9"
                              />
                            </div>
                            <div className="flex gap-2">
                              <div className="flex-1 min-w-0">
                                <CountCatalogTreePicker
                                  nodes={periodicSearchCatalogNodes}
                                  value={periodicCountCatalogNodeId}
                                  onChange={setPeriodicCountCatalogNodeId}
                                  language={language}
                                />
                              </div>
                              {periodicCountCatalogNodeId && (
                                <Button
                                  type="button" variant="outline" size="icon" title="مسح فلتر التصنيف"
                                  onClick={() => setPeriodicCountCatalogNodeId("")}
                                >
                                  <X className="w-4 h-4" />
                                </Button>
                              )}
                            </div>
                          </div>

                          {(periodicCountSearch.trim() || periodicCountCatalogNodeId) && (
                            <div className="max-h-64 overflow-y-auto rounded-md border bg-background divide-y">
                              {periodicLotSearchLoading && (
                                <div className="p-3 text-xs text-muted-foreground flex items-center gap-2">
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> جاري البحث...
                                </div>
                              )}
                              {!periodicLotSearchLoading && (periodicLotSearchResults as any[]).length === 0 && (
                                <div className="p-3 text-xs text-muted-foreground">لا توجد دفعة مطابقة داخل Snapshot افتتاح هذا الجرد.</div>
                              )}
                              {(periodicLotSearchResults as any[]).map((item: any) => (
                                <button
                                  type="button"
                                  key={`${item.inventoryId}-${item.lotId}`}
                                  className="w-full p-3 text-right hover:bg-muted/50"
                                  onClick={() => selectPeriodicLotFromSearch(item)}
                                  disabled={scanCountLotMut.isPending}
                                >
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                      <div className="text-sm font-medium">{item.nameAr || item.itemName}</div>
                                      {item.nameEn && <div className="text-xs text-muted-foreground" dir="ltr">{item.nameEn}</div>}
                                    </div>
                                    <Badge variant="outline" className="font-mono shrink-0" dir="ltr">{item.lotCode}</Badge>
                                  </div>
                                  <div className="mt-1 flex gap-x-3 gap-y-1 flex-wrap text-[11px] text-muted-foreground">
                                    {item.code && <span dir="ltr">كود الصنف: {item.code}</span>}
                                    {item.manufacturerBarcode && <span dir="ltr">باركود المصنع: {item.manufacturerBarcode}</span>}
                                    <span>رصيد النظام عند الفتح: {item.systemQuantity} {item.unit || ""}</span>
                                  </div>
                                  {countCatalogPathLabel(item.nodeId) && (
                                    <div className="mt-1 text-[11px] text-muted-foreground truncate">{countCatalogPathLabel(item.nodeId)}</div>
                                  )}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </>
                    ) : (
                      <>
                        <p className="text-sm font-medium">إضافة صنف للجرد</p>
                        <div className="flex gap-2">
                          <Button size="sm" variant={scanMode === "qr" ? "default" : "outline"} onClick={() => setScanMode("qr")} className="gap-1">
                            <QrCode className="w-3.5 h-3.5" /> باركود/QR
                          </Button>
                          <Button size="sm" variant={scanMode === "code" ? "default" : "outline"} onClick={() => setScanMode("code")} className="gap-1">
                            <Package className="w-3.5 h-3.5" /> بالرقم
                          </Button>
                          <Button size="sm" variant={scanMode === "name" ? "default" : "outline"} onClick={() => setScanMode("name")} className="gap-1">
                            <Search className="w-3.5 h-3.5" /> بالاسم
                          </Button>
                          <Button size="sm" variant="outline" className="gap-1 mr-auto" onClick={() => setShowNewItem(true)}>
                            <Plus className="w-3.5 h-3.5" /> صنف جديد
                          </Button>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          صنف غير موجود بالمخزون أصلاً؟ استخدم زر "صنف جديد" لإضافته مباشرة.
                        </p>

                        {scanMode === "qr" && (
                          <BarcodeScanner onScan={handleScanResolved} placeholder="امسح باركود/QR الصنف..." />
                        )}

                        {scanMode !== "qr" && (
                          <div className="relative">
                            <Input
                              placeholder={scanMode === "name" ? "ابحث باسم الصنف..." : "ابحث برقم الصنف أو الباركود..."}
                              value={scanQuery}
                              onChange={e => setScanQuery(e.target.value)}
                            />
                            {scanSearchResults.length > 0 && (
                              <div className="absolute z-10 w-full bg-background border rounded-md mt-1 max-h-48 overflow-y-auto">
                                {scanSearchResults.map((i: any) => (
                                  <div
                                    key={i.id}
                                    className="p-2 text-sm cursor-pointer hover:bg-muted/50"
                                    onClick={() => {
                                      if (!activeCountId) return;
                                      addItemMut.mutate({ operationId: activeCountId, inventoryId: i.id });
                                    }}
                                  >
                                    {i.itemName} <span className="text-muted-foreground text-xs">({i.quantity} {i.unit})</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </>
                    )}
                  </CardContent>
                </Card>
              )}

              {isOpeningBalanceCount && (
                <Card className="border-blue-200 bg-blue-50/40">
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div>
                        <p className="text-sm font-medium">الرصيد الافتتاحي من Master Catalog</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          المستودع محدد من العملية. يمكنك إضافة صنف يدويًا أو استخدام قالب Excel. الاستيراد يضيف الصفوف للرصد فقط، ثم يبقى الحفظ والتسوية الحالية هما بوابة إنشاء LOT وQR وتحديث المخزون.
                        </p>
                      </div>
                      {countDetail.operation.status === "in_progress" && (
                        <Button size="sm" className="gap-1" onClick={() => setShowNewItem(true)}>
                          <Plus className="w-3.5 h-3.5" /> إضافة صنف من الكتالوج
                        </Button>
                      )}
                    </div>
                    <OpeningBalanceBulkExcel
                      operationId={Number(countDetail.operation.id)}
                      canImport={countDetail.operation.status === "in_progress"}
                      onImported={refetchCountDetail}
                    />
                  </CardContent>
                </Card>
              )}

              {/* ══ تقرير الفروقات المالي — بقيمة Snapshot وقت فتح الجرد ══ */}
              {(() => {
                const withDiff = countDetail.items.filter(
                  (it: any) => it.countedQuantity !== null && parseFloat(it.diffQuantity || "0") !== 0
                );
                if (withDiff.length === 0) return null;

                const valuatedDiff = withDiff.filter((it: any) => it.diffValue !== null && it.diffValue !== undefined);
                const unvaluatedCount = withDiff.length - valuatedDiff.length;
                if (valuatedDiff.length === 0) {
                  return (
                    <Card className="border-amber-200 bg-amber-50/60">
                      <CardContent className="p-3 text-sm text-amber-800">
                        توجد فروقات كمية، لكن التقييم المالي غير متاح لأن هذه العملية لا تحتوي Snapshot تكلفة افتتاحية موثوقة.
                      </CardContent>
                    </Card>
                  );
                }

                const shortageValue = valuatedDiff
                  .filter((it: any) => parseFloat(it.diffQuantity) < 0)
                  .reduce((sum: number, it: any) => sum + Math.abs(parseFloat(it.diffValue || "0")), 0);
                const surplusValue = valuatedDiff
                  .filter((it: any) => parseFloat(it.diffQuantity) > 0)
                  .reduce((sum: number, it: any) => sum + parseFloat(it.diffValue || "0"), 0);
                const net = surplusValue - shortageValue;
                return (
                  <div className="space-y-2">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <Card className="border-slate-200 bg-slate-50/50">
                        <CardContent className="p-3 text-center">
                          <p className="text-2xl font-bold text-slate-800">{withDiff.length}</p>
                          <p className="text-[10px] text-slate-600">عدد الأصناف المختلفة</p>
                        </CardContent>
                      </Card>
                      <Card className="border-red-200 bg-red-50/50">
                        <CardContent className="p-3 text-center">
                          <p className="text-2xl font-bold text-red-700">-{shortageValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}</p>
                          <p className="text-[10px] text-red-600">إجمالي قيمة النقص — تكلفة وقت الفتح</p>
                        </CardContent>
                      </Card>
                      <Card className="border-emerald-200 bg-emerald-50/50">
                        <CardContent className="p-3 text-center">
                          <p className="text-2xl font-bold text-emerald-700">+{surplusValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}</p>
                          <p className="text-[10px] text-emerald-600">إجمالي قيمة الزيادة — تكلفة وقت الفتح</p>
                        </CardContent>
                      </Card>
                      <Card className={net < 0 ? "border-red-200 bg-red-50/50" : "border-blue-200 bg-blue-50/50"}>
                        <CardContent className="p-3 text-center">
                          <p className={`text-2xl font-bold ${net < 0 ? "text-red-700" : "text-blue-700"}`}>
                            {net > 0 ? "+" : ""}{net.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                          </p>
                          <p className={`text-[10px] ${net < 0 ? "text-red-600" : "text-blue-600"}`}>صافي الأثر المالي — Snapshot</p>
                        </CardContent>
                      </Card>
                    </div>
                    {unvaluatedCount > 0 && (
                      <p className="text-xs text-amber-700">
                        {unvaluatedCount} بند/بنود لها فرق كمية بدون Snapshot تكلفة افتتاحية؛ لم تدخل في الإجمالي المالي.
                      </p>
                    )}
                  </div>
                );
              })()}

              <div className="border rounded-lg overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="p-2 text-right">الصنف</th>
                      <th className="p-2 text-center">كمية النظام</th>
                      <th className="p-2 text-center">الكمية المعدودة</th>
                      <th className="p-2 text-center">الفرق</th>
                      <th className="p-2 text-center">متوسط التكلفة وقت الفتح</th>
                      <th className="p-2 text-center">قيمة الفرق</th>
                      <th className="p-2 text-center">الدفعة / الصلاحية</th>
                      <th className="p-2 text-right">ملاحظة</th>
                      <th className="p-2 text-center"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {countDetail.items
                      .filter((it: any) => !showUncountedOnly || it.countedQuantity === null)
                      .map((it: any) => {
                        const diff = it.diffQuantity !== null ? parseFloat(it.diffQuantity) : null;
                        return (
                          <tr key={it.countItemId} className="border-t">
                            <td className="p-2 text-right align-middle">{it.itemName}</td>
                            <td className="p-2 text-center align-middle">{it.systemQuantity} {it.unit}</td>
                            <td className="p-2 text-center align-middle">{it.countedQuantity ?? "—"}</td>
                            <td className={`p-2 text-center align-middle font-medium ${diff !== null && diff !== 0 ? (diff > 0 ? "text-blue-600" : "text-red-600") : ""}`}>
                              {diff !== null ? (diff > 0 ? `+${diff}` : diff) : "—"}
                            </td>
                            <td className="p-2 text-center align-middle font-mono text-xs">
                              {it.averageCostSnapshot !== null && it.averageCostSnapshot !== undefined
                                ? parseFloat(it.averageCostSnapshot).toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 })
                                : "—"}
                            </td>
                            <td className={`p-2 text-center align-middle font-medium ${diff !== null && diff !== 0 ? (diff > 0 ? "text-emerald-600" : "text-red-600") : "text-muted-foreground"}`}>
                              {diff !== null && diff !== 0 && it.diffValue !== null && it.diffValue !== undefined
                                ? `${diff > 0 ? "+" : ""}${parseFloat(it.diffValue).toLocaleString(undefined, { maximumFractionDigits: 2 })}`
                                : "—"}
                            </td>
                            <td className="p-2 text-center align-middle text-xs text-muted-foreground">
                              {isPeriodicLotCount ? (
                                <>
                                  <span className="font-mono text-foreground">{it.lotCode || `Lot #${it.lotId}`}</span>
                                  {(it.lotExpiryDate || it.expiryDate) ? ` / ${fmtDate(it.lotExpiryDate || it.expiryDate)}` : ""}
                                </>
                              ) : (
                                <>{it.lotNumber || "—"} {it.expiryDate ? `/ ${fmtDate(it.expiryDate)}` : ""}</>
                              )}
                            </td>
                            <td className="p-2 text-right align-middle text-xs text-muted-foreground">{it.notes || "—"}</td>
                            <td className="p-2 text-center align-middle">
                              {countDetail.operation.status === "in_progress" && (
                                isPeriodicLotCount ? (
                                  <div className="flex items-center justify-center gap-1.5 whitespace-nowrap">
                                    <span className="text-[11px] text-blue-700">مسح QR من الأعلى</span>
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      className="h-7 px-2 text-xs"
                                      onClick={() => {
                                        setEditingItem({ ...it, entryMode: "manual" });
                                        setEditCountedQty(it.countedQuantity ?? "");
                                        setEditLot("");
                                        setEditExpiry("");
                                        setEditNotes(it.notes ?? "");
                                      }}
                                    >
                                      {t.inventory.countManualEntry}
                                    </Button>
                                  </div>
                                ) : (
                                  <Button
                                    variant="ghost" size="sm"
                                    onClick={() => {
                                      setEditingItem(it);
                                      setEditCountedQty(it.countedQuantity ?? "");
                                      setEditLot(it.lotNumber ?? "");
                                      setEditExpiry(toDateInputValue(it.expiryDate));
                                      setEditNotes(it.notes ?? "");
                                    }}
                                  >
                                    عد الصنف
                                  </Button>
                                )
                              )}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            /* ─── قائمة عمليات الجرد ─── */
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <h3 className="font-semibold text-lg">عمليات الجرد</h3>
                <Button onClick={() => setShowNewCount(true)} className="gap-1.5">
                  <Plus className="w-4 h-4" /> بدء جرد جديد
                </Button>
              </div>

              {!countOperations?.length ? (
                <Card><CardContent className="p-12 text-center">
                  <BookOpen className="w-12 h-12 mx-auto text-muted-foreground/40 mb-4" />
                  <p className="text-sm text-muted-foreground">لا توجد مسودات جرد جارية</p>
                </CardContent></Card>
              ) : (
                <div className="space-y-2">
                  {(countOperations as any[]).filter(op => op.status === "in_progress").map((op) => (
                    <Card key={op.id} className="cursor-pointer hover:border-primary" onClick={() => setActiveCountId(op.id)}>
                      <CardContent className="p-4 flex items-center justify-between">
                        <div>
                          <p className="font-medium">{op.operationTitle || op.operationNumber}</p>
                          <p className="text-[11px] text-muted-foreground">{op.operationNumber}</p>
                          <p className="text-xs text-muted-foreground">
                            <span className="font-medium text-foreground/80">{warehouseName(op.warehouseId)}</span>
                            {" — "}
                            {op.scope === "full" ? "شامل" : "جزئي"}
                            {countScopeCategoryName(op) && ` — التصنيف: ${countScopeCategoryName(op)}`}
                            {" — "}{fmtDate(op.operationDate)} — {op.totalItemsCounted} صنف معدود
                            {op.totalDiscrepancies > 0 && ` — ${op.totalDiscrepancies} فرق`}
                          </p>
                        </div>
                        <div className="flex items-center gap-1">
                          <Badge variant="secondary">مسودة</Badge>
                          <Button
                            variant="ghost" size="icon" className="h-8 w-8 text-destructive"
                            title="حذف المسودة"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (window.confirm(`سيتم حذف مسودة الجرد "${op.operationTitle || op.operationNumber}" نهائياً. هل أنت متأكد؟`)) {
                                deleteCountMut.mutate({ operationId: op.id });
                              }
                            }}
                            disabled={deleteCountMut.isPending}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}

            </div>
          )}
          </>
          )}
        </TabsContent>

        {/* ══ تبويب التسويات ══ */}
        <TabsContent value="settlements" className="mt-6 space-y-4">
          <div className="flex justify-between items-center">
            <p className="text-sm text-muted-foreground">كل تسويات المخزون — من عمليات جرد أو مستقلة — برقمها المرجعي الفريد</p>
            {canApplySettlement && <Button
              className="gap-1.5"
              onClick={() => { setSettlementSourceCountId(null); setSettlementItems([]); setSettlementReference(""); setShowSettlement(true); }}
              disabled={lotsEnabled}
              title={lotsEnabled ? "بعد تفعيل Lots، التسوية اليدوية Aggregate-only موقوفة؛ استخدم الجرد الدوري بالـQR" : undefined}
            >
              <Plus className="w-4 h-4" />
              تسوية مستقلة (بدون جرد)
            </Button>}
          </div>

          <div className="space-y-2">
            {((settlementsList as any[]) || []).map((s) => (
              <Card key={s.id}>
                <CardContent className="p-4 flex items-center justify-between">
                  <div className="flex-1">
                    <p className="font-medium">{s.settlementNumber}</p>
                    <p className="text-xs text-muted-foreground">
                      {s.sourceType === "from_count" ? "من عملية جرد" : "تسوية مستقلة"} — {fmtDate(s.appliedAt)}
                    </p>
                    <p className="text-xs text-muted-foreground">{s.reason}</p>
                    {s.reference && <p className="text-xs text-muted-foreground">المرجع: <span className="font-mono">{s.reference}</span></p>}
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => setPrintSettlementId(s.id)} title="طباعة">
                    <Printer className="w-4 h-4" />
                  </Button>
                </CardContent>
              </Card>
            ))}
            {!settlementsList?.length && (
              <p className="text-sm text-muted-foreground text-center py-8">لا توجد تسويات محفوظة بعد</p>
            )}
          </div>
        </TabsContent>
      </Tabs>

      {/* ══ نافذة بدء جرد جديد ══ */}
      <Dialog open={showNewCount} onOpenChange={setShowNewCount}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>بدء جرد جديد</DialogTitle></DialogHeader>
          <div className="space-y-3">
            {/* ══ أول ما يظهر: اختيار المخزن — إلزامي، ويحدّد نطاق الأصناف بالكامل ══ */}
            <div className="space-y-1.5">
              <Label className="text-xs">المخزن *</Label>
              <Select value={countWarehouseId} onValueChange={(v) => { setCountWarehouseId(v); setSelectedPartialIds([]); setCountCatalogNodeId(""); }}>
                <SelectTrigger><SelectValue placeholder="اختر المخزن..." /></SelectTrigger>
                <SelectContent>
                  {((warehousesList as any[]) || []).map((w: any) => (
                    <SelectItem key={w.id} value={String(w.id)}>{w.nameAr}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">نوع العملية</Label>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant={countType === "periodic" ? "default" : "outline"}
                  onClick={() => { setCountType("periodic"); if (lotsEnabled) { setCountScope("full"); setCountLotScopeMode("full"); setCountCatalogNodeId(""); setSelectedPartialIds([]); } }}
                >
                  جرد دوري
                </Button>
                <Button
                  type="button"
                  variant={countType === "opening_balance" ? "default" : "outline"}
                  disabled={!lotTrackingStatus?.enabled}
                  onClick={() => { setCountType("opening_balance"); setCountScope("partial"); setCountLotScopeMode("manual"); setCountCatalogNodeId(""); setCountUiMode("manual"); setSelectedPartialIds([]); }}
                >
                  رصيد افتتاحي
                </Button>
              </div>
              {!lotTrackingStatus?.enabled && (
                <p className="text-xs text-amber-700">الرصيد الافتتاحي بالـQR جاهز بالكود لكنه غير مفعّل تشغيلياً حتى اكتمال ربط كل حركات المخزون بالـLot.</p>
              )}
              {countType === "opening_balance" && (
                <p className="text-xs text-blue-700">سيبدأ الرصيد فارغاً، وتختار الأصناف من Master Catalog. لا تتغير الكمية إلا عند تطبيق التسوية التي تنشئ Opening Balance Lot + QR.</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">عنوان الجرد (اختياري)</Label>
              <Input
                placeholder={countType === "opening_balance"
                  ? `افتراضي: رصيد افتتاحي ${riyadhPreview.date}`
                  : `افتراضي: جرد يوم ${riyadhPreview.dayName} بتاريخ ${riyadhPreview.date}`}
                value={countTitle}
                onChange={e => setCountTitle(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">التاريخ (الرياض)</Label>
                <Input value={riyadhPreview.date} disabled dir="ltr" className="bg-muted/40" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">اليوم</Label>
                <Input value={riyadhPreview.dayName} disabled className="bg-muted/40" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">وقت البدء</Label>
                <Input value={riyadhPreview.time} disabled dir="ltr" className="bg-muted/40" />
              </div>
            </div>

            {countType === "periodic" && lotsEnabled ? (
              <div className="space-y-2 rounded-lg border border-blue-200 bg-blue-50/40 p-3">
                <div className="flex items-center gap-2 text-blue-800">
                  <QrCode className="w-4 h-4" />
                  <span className="text-sm font-medium">الجرد الدوري بالـLot/QR</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  لا يتم العدّ بباركود Inventory أو الاسم. كل دفعة تُعد بعد مسح QR الخاص بها، وأي فرق يُطبّق على نفس Lot فقط.
                </p>
                <div className="space-y-1.5">
                  <Label className="text-xs">نطاق الجرد</Label>
                  <Select
                    value={countLotScopeMode}
                    onValueChange={(v: any) => {
                      setCountLotScopeMode(v);
                      setCountCatalogNodeId("");
                    }}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="full">كل المخزن — جميع الدفعات ذات الرصيد</SelectItem>
                      <SelectItem value="category">تصنيف محدد — من Catalog وجميع فروعه</SelectItem>
                      <SelectItem value="manual">جزئي يدوي — أضف الدفعات المطلوبة بمسح QR</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {countLotScopeMode === "category" && (
                  <div className="space-y-1.5">
                    <Label className="text-xs">تصنيف الكتالوج *</Label>
                    <CountCatalogTreePicker
                      nodes={(countCatalogNodes as CountCatalogNode[]) || []}
                      value={countCatalogNodeId}
                      onChange={setCountCatalogNodeId}
                      language={language}
                    />
                    <p className="text-[11px] text-muted-foreground">
                      يمكنك اختيار أي مستوى من نفس شجرة الكتالوج. الجرد سيشمل المستوى المختار وكل الفروع التابعة له داخل المخزن المحدد.
                    </p>
                  </div>
                )}
                <p className="text-xs text-blue-700">
                  {countLotScopeMode === "full"
                    ? "سيأخذ النظام Snapshot لكل Lot له رصيد موجب في المستودع. لا يمكن إنهاء الجرد حتى يتم مسح وعدّ كل هذه الدفعات."
                    : countLotScopeMode === "category"
                      ? "سيأخذ النظام Snapshot لكل Lot تابع للتصنيف المختار أو أحد فروعه داخل هذا المخزن. أي QR لصنف خارج هذا النطاق سيُرفض من الخادم مع رسالة واضحة للمستخدم."
                      : "سيبدأ الجرد فارغاً، وتدخل فقط الدفعات التي تمسح QR لها."}
                </p>
              </div>
            ) : countType === "periodic" ? (
              <>
                <div className="space-y-1.5">
                  <Label className="text-xs">طريقة الجرد</Label>
                  <div className="flex gap-2">
                    <Button
                      size="sm" variant={countUiMode === "auto" ? "default" : "outline"}
                      onClick={() => setCountUiMode("auto")} className="gap-1"
                    >
                      تحميل الأصناف مسبقاً
                    </Button>
                    <Button
                      size="sm" variant={countUiMode === "manual" ? "default" : "outline"}
                      onClick={() => { setCountUiMode("manual"); setCountScope("partial"); }} className="gap-1"
                    >
                      <QrCode className="w-3.5 h-3.5" /> يدوي (باركود/رقم/اختيار)
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {countUiMode === "auto"
                      ? "تُحمَّل كل أصناف النطاق دفعة واحدة، وتدخل الكمية المعدودة لكل صنف."
                      : "يبدأ الجرد فاضياً، وتضيف الأصناف تباعاً بمسح الباركود أو كتابة الرقم أو الاختيار من القائمة."}
                  </p>
                </div>

                {countUiMode === "auto" && (
                  <div className="space-y-1.5">
                    <Label className="text-xs">النطاق</Label>
                    <Select value={countScope} onValueChange={(v: any) => setCountScope(v)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="full">جرد شامل (كل الأصناف)</SelectItem>
                        <SelectItem value="partial">جرد جزئي (اختيار أصناف)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {countUiMode === "auto" && countScope === "partial" && (
                  <div className="space-y-1.5">
                    <Label className="text-xs">اختر الأصناف ({selectedPartialIds.length} محدد)</Label>
                    <Input
                      placeholder="ابحث باسم الصنف..."
                      value={countItemSearch}
                      onChange={e => setCountItemSearch(e.target.value)}
                    />
                    <div className="max-h-48 overflow-y-auto border rounded-md divide-y">
                      {((inventoryList as any[]) || [])
                        .filter(i => {
                          if (!i.itemName.includes(countItemSearch)) return false;
                          if (!countWarehouseId) return true;
                          if (String(i.warehouseId) === countWarehouseId) return true;
                          const wh = ((warehousesList as any[]) || []).find((w: any) => String(w.id) === countWarehouseId);
                          if (wh?.type === "main" && !i.warehouseId) return true;
                          return false;
                        })
                        .slice(0, 30)
                        .map(i => (
                          <label key={i.id} className="flex items-center gap-2 p-2 text-sm cursor-pointer hover:bg-muted/50">
                            <input
                              type="checkbox"
                              checked={selectedPartialIds.includes(i.id)}
                              onChange={e => {
                                setSelectedPartialIds(prev =>
                                  e.target.checked ? [...prev, i.id] : prev.filter(id => id !== i.id)
                                );
                              }}
                            />
                            {i.itemName} <span className="text-muted-foreground text-xs">({i.quantity} {i.unit})</span>
                          </label>
                        ))}
                    </div>
                  </div>
                )}
              </>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              onClick={() => createCountMut.mutate({
                operationTitle: countTitle.trim() || undefined,
                countType,
                scope: countType === "opening_balance"
                  ? "partial"
                  : lotsEnabled && countType === "periodic"
                    ? (countLotScopeMode === "full" ? "full" : "partial")
                    : countScope,
                catalogNodeId: lotsEnabled && countType === "periodic" && countLotScopeMode === "category"
                  ? Number(countCatalogNodeId)
                  : undefined,
                warehouseId: Number(countWarehouseId),
                itemIds: !lotsEnabled && countType === "periodic" && countUiMode === "auto" && countScope === "partial" ? selectedPartialIds : undefined,
                allowEmpty: countType === "opening_balance" || (lotsEnabled && countType === "periodic" ? countLotScopeMode === "manual" : countUiMode === "manual"),
              })}
              disabled={
                createCountMut.isPending ||
                !countWarehouseId ||
                (countType === "opening_balance" && !lotTrackingStatus?.enabled) ||
                (lotsEnabled && countType === "periodic" && countLotScopeMode === "category" && !countCatalogNodeId) ||
                (!lotsEnabled && countType === "periodic" && countUiMode === "auto" && countScope === "partial" && selectedPartialIds.length === 0)
              }
            >
              {createCountMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : (countType === "opening_balance" ? "بدء الرصيد الافتتاحي" : "بدء الجرد")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ══ نافذة عدّ صنف ══ */}
      <Dialog open={!!editingItem} onOpenChange={(v) => !v && setEditingItem(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {isPeriodicLotCount
                ? (editingItem?.entryMode === "manual" ? t.inventory.countManualEntryTitle : "عدّ الدفعة")
                : "عدّ الصنف"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {/* بطاقة تفاصيل الصنف */}
            <div className="flex items-center gap-3 p-3 rounded-lg border bg-muted/30">
              <Package className="w-8 h-8 text-primary shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm truncate">{editingItem?.itemName}</p>
                {isPeriodicLotCount && editingItem?.lotCode && (
                  <p className="text-xs font-mono text-blue-700 mt-0.5">{editingItem.lotCode}</p>
                )}
                <p className="text-xs text-muted-foreground mt-0.5">
                  {isPeriodicLotCount ? "رصيد الدفعة بالنظام" : "كمية النظام الحالية"}: <strong className="text-foreground">{editingItem?.systemQuantity} {editingItem?.unit}</strong>
                </p>
              </div>
            </div>

            {isPeriodicLotCount && editingItem?.entryMode === "manual" && (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                {t.inventory.countManualEntryNotice}
              </div>
            )}

            <div className="space-y-1.5">
              <Label className="text-xs">الكمية الفعلية المعدودة *</Label>
              <Input type="number" value={editCountedQty} onChange={e => setEditCountedQty(e.target.value)} autoFocus />
              {editCountedQty !== "" && editingItem && (() => {
                const d = parseFloat(editCountedQty || "0") - parseFloat(String(editingItem.systemQuantity || 0));
                if (d === 0) return <p className="text-xs text-emerald-600">مطابق لكمية النظام — لا يوجد فرق</p>;
                return (
                  <p className={`text-xs flex items-center gap-1 ${d > 0 ? "text-blue-600" : "text-red-600"}`}>
                    <AlertTriangle className="w-3 h-3" /> فرق {d > 0 ? `زيادة +${d}` : `نقص ${d}`}
                  </p>
                );
              })()}
            </div>
            {!isPeriodicLotCount && (
              <>
                <div className="space-y-1.5">
                  <Label className="text-xs">رقم الدفعة (اختياري)</Label>
                  <Input value={editLot} onChange={e => setEditLot(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">تاريخ الصلاحية (اختياري)</Label>
                  <Input type="date" value={editExpiry} onChange={e => setEditExpiry(e.target.value)} />
                </div>
              </>
            )}
            <div className="space-y-1.5">
              <Label className="text-xs">ملاحظة (اختياري)</Label>
              <Textarea value={editNotes} onChange={e => setEditNotes(e.target.value)} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={() => recordItemMut.mutate({
                countItemId: editingItem.countItemId,
                countedQuantity: parseFloat(editCountedQty || "0"),
                entryMode: isPeriodicLotCount
                  ? (editingItem.entryMode === "manual" ? "manual" : "qr")
                  : undefined,
                trackingToken: isPeriodicLotCount && editingItem.entryMode !== "manual"
                  ? editingItem.trackingToken
                  : undefined,
                lotNumber: editLot || undefined,
                expiryDate: editExpiry || undefined,
                notes: editNotes || undefined,
              })}
              disabled={recordItemMut.isPending || editCountedQty === ""}
            >
              حفظ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ══ نافذة إضافة صنف أثناء الجرد / الرصيد الافتتاحي ══ */}
      <Dialog open={showNewItem} onOpenChange={(v) => {
        if (!v) {
          setShowNewItem(false);
          setOpeningCatalogSearch("");
          setOpeningCatalogNodeId("");
          setSelectedOpeningCatalogItem(null);
        }
      }}>
        <DialogContent className="max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle>{isOpeningBalanceCount ? "إضافة رصيد افتتاحي من الكتالوج" : "إضافة صنف جديد للمخزون"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {isOpeningBalanceCount ? (
              <>
                <p className="text-xs text-muted-foreground">
                  اختر Master Catalog Item. لن تدخل الكمية للمخزون الآن؛ تُنشأ الكمية وOpening Balance Lot والـQR معاً عند تطبيق التسوية.
                </p>
                <div className="space-y-1.5">
                  <Label className="text-xs">صنف الكتالوج *</Label>
                  {selectedOpeningCatalogItem ? (
                    <div className="p-3 border rounded-md bg-muted/30 flex justify-between gap-2 items-center">
                      <div>
                        <p className="text-sm font-medium">{selectedOpeningCatalogItem.nameAr}</p>
                        <p className="text-xs text-muted-foreground" dir="ltr">
                          {selectedOpeningCatalogItem.code || `#${selectedOpeningCatalogItem.id}`} — {selectedOpeningCatalogItem.nameEn}
                        </p>
                        <p className="text-xs text-muted-foreground">الوحدة: {selectedOpeningCatalogItem.unit || "—"}</p>
                        {Array.isArray(selectedOpeningCatalogItem.manufacturerBarcodes) && selectedOpeningCatalogItem.manufacturerBarcodes.length > 0 && (
                          <p className="text-xs text-muted-foreground" dir="ltr">باركود المصنع: {selectedOpeningCatalogItem.manufacturerBarcodes.slice(0, 3).join("، ")}</p>
                        )}
                        {countCatalogPathLabel(selectedOpeningCatalogItem.nodeId) && (
                          <p className="text-xs text-muted-foreground">{countCatalogPathLabel(selectedOpeningCatalogItem.nodeId)}</p>
                        )}
                      </div>
                      <Button variant="ghost" size="sm" onClick={() => setSelectedOpeningCatalogItem(null)}>تغيير</Button>
                    </div>
                  ) : (
                    <>
                      <Input
                        value={openingCatalogSearch}
                        onChange={e => setOpeningCatalogSearch(e.target.value)}
                        placeholder="ابحث بكود الصنف، الاسم العربي/الإنجليزي أو باركود المصنع..."
                        autoFocus
                      />
                      <div className="flex gap-2">
                        <div className="flex-1 min-w-0">
                          <CountCatalogTreePicker
                            nodes={(countCatalogNodes as CountCatalogNode[]) || []}
                            value={openingCatalogNodeId}
                            onChange={setOpeningCatalogNodeId}
                            language={language}
                          />
                        </div>
                        {openingCatalogNodeId && (
                          <Button
                            type="button" variant="outline" size="icon" title="مسح فلتر التصنيف"
                            onClick={() => setOpeningCatalogNodeId("")}
                          >
                            <X className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        باركود المصنع يُبحث من السجلات المرتبطة بهذا Catalog Item. رقم LOT لا يتوفر للرصد الافتتاحي قبل تطبيق التسوية وإنشاء الـLot.
                      </p>
                      <div className="max-h-64 overflow-y-auto border rounded-md divide-y">
                        {openingCatalogLoading && (
                          <div className="p-3 text-xs text-muted-foreground flex items-center gap-2">
                            <Loader2 className="w-3.5 h-3.5 animate-spin" /> جاري البحث...
                          </div>
                        )}
                        {!openingCatalogLoading && (openingCatalogItems as any[]).length === 0 && (
                          <div className="p-3 text-xs text-muted-foreground">لا يوجد صنف مطابق للبحث أو التصنيف المحدد.</div>
                        )}
                        {(openingCatalogItems as any[]).map((item: any) => (
                          <button
                            type="button"
                            key={item.id}
                            className="w-full p-2 text-right hover:bg-muted/50"
                            onClick={() => setSelectedOpeningCatalogItem(item)}
                          >
                            <div className="text-sm font-medium">{item.nameAr}</div>
                            <div className="text-xs text-muted-foreground" dir="ltr">{item.code || `#${item.id}`} — {item.nameEn}</div>
                            {Array.isArray(item.manufacturerBarcodes) && item.manufacturerBarcodes.length > 0 && (
                              <div className="text-[11px] text-muted-foreground mt-0.5" dir="ltr">
                                باركود المصنع: {item.manufacturerBarcodes.slice(0, 3).join("، ")}
                              </div>
                            )}
                            {countCatalogPathLabel(item.nodeId) && (
                              <div className="text-[11px] text-muted-foreground mt-0.5 truncate">{countCatalogPathLabel(item.nodeId)}</div>
                            )}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </>
            ) : (
              <>
                <p className="text-xs text-muted-foreground">
                  يُستخدم فقط لصنف فعلي موجود بالمستودع وغير مسجّل بالنظام إطلاقاً. هذا هو مسار الجرد الدوري التاريخي.
                </p>
                <div className="space-y-1.5">
                  <Label className="text-xs">اسم الصنف *</Label>
                  <Input value={newItemName} onChange={e => setNewItemName(e.target.value)} autoFocus />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">الوحدة *</Label>
                  <Select value={newItemUnit} onValueChange={setNewItemUnit}>
                    <SelectTrigger><SelectValue placeholder="اختر الوحدة..." /></SelectTrigger>
                    <SelectContent>
                      {((catalogUnits as any[]) || []).map((u: any) => (
                        <SelectItem key={u.id} value={u.nameAr}>{u.nameAr}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">الكمية *</Label>
                <Input type="number" min={0.001} step={0.001} value={newItemQty} onChange={e => setNewItemQty(e.target.value)} dir="ltr" className="font-mono" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">التكلفة الافتتاحية {isOpeningBalanceCount ? "" : "(اختياري)"}</Label>
                <Input type="number" min={0} step={0.01} value={newItemCost} onChange={e => setNewItemCost(e.target.value)} dir="ltr" className="font-mono" placeholder="0" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewItem(false)}>إلغاء</Button>
            <Button
              className="gap-1.5"
              disabled={
                (isOpeningBalanceCount ? !selectedOpeningCatalogItem : (!newItemName.trim() || !newItemUnit)) ||
                !newItemQty || parseFloat(newItemQty || "0") <= 0 || addNewItemMut.isPending
              }
              onClick={submitNewItem}
            >
              {addNewItemMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              {isOpeningBalanceCount ? "إضافة للرصد الافتتاحي" : "إضافة للمخزون"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ══ نافذة تسوية المخزون ══ */}
      <Dialog open={canApplySettlement && showSettlement} onOpenChange={setShowSettlement}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {settlementSourceCountId ? "تسوية من نتائج الجرد" : "تسوية مستقلة"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 max-h-[60vh] overflow-y-auto">
            {settlementSourceCountId && discrepancies && (
              <div className="space-y-2">
                <div className="rounded-md border border-blue-200 bg-blue-50 p-2 text-xs text-blue-800 space-y-1">
                  <p>التسوية تطبق فرق الجرد المحفوظ فقط على الرصيد الحالي للدفعة. أي دفعات جديدة من الاستلام بعد فتح الجرد تبقى مستقلة ولا يتم دمجها أو حذف حركاتها.</p>
                  <p className="font-medium">
                    {isOpeningBalanceCount
                      ? "الرصيد الافتتاحي يحافظ على أساس التكلفة الافتتاحية المعتمد في مساره الحالي."
                      : "في الجرد الدوري، التقييم المالي يستخدم متوسط التكلفة المثبت عند فتح الجرد (Opening Snapshot)، وليس متوسط التكلفة الحالي، ولا يمكن تعديل تكلفة الـSnapshot من شاشة التسوية."}
                  </p>
                </div>
                <div className="border rounded-lg overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="p-2 text-right">الصنف</th>
                        <th className="p-2 text-right">كمية النظام</th>
                        <th className="p-2 text-right">المعدود</th>
                        <th className="p-2 text-right">فرق التسوية</th>
                        <th className="p-2 text-right">{isOpeningBalanceCount ? "التكلفة الافتتاحية" : "تكلفة Snapshot"}</th>
                        <th className="p-2 text-right">قيمة التسوية</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(discrepancies as any[]).map((d) => (
                        <tr key={`${d.inventoryId}-${d.lotId ?? "legacy"}`} className="border-t">
                          <td className="p-2">
                            <div>{d.itemName}</div>
                            {d.lotCode && <div className="text-[11px] font-mono text-blue-700">{d.lotCode}</div>}
                          </td>
                          <td className="p-2 font-mono">{d.systemQuantity} {d.unit}</td>
                          <td className="p-2 font-mono">{d.countedQuantity} {d.unit}</td>
                          <td className={`p-2 font-mono font-semibold ${Number(d.diffQuantity || 0) > 0 ? "text-green-700" : "text-red-700"}`}>
                            {Number(d.diffQuantity || 0) > 0 ? "+" : ""}{d.diffQuantity} {d.unit}
                          </td>
                          <td className="p-2 font-mono">
                            {(isOpeningBalanceCount ? d.averageCost : d.averageCostSnapshot) != null
                              ? Number(isOpeningBalanceCount ? d.averageCost : d.averageCostSnapshot).toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 })
                              : "—"}
                          </td>
                          <td className={`p-2 font-mono font-semibold ${Number(isOpeningBalanceCount ? Number(d.diffQuantity || 0) * Number(d.averageCost || 0) : d.diffValue || 0) > 0 ? "text-green-700" : Number(isOpeningBalanceCount ? Number(d.diffQuantity || 0) * Number(d.averageCost || 0) : d.diffValue || 0) < 0 ? "text-red-700" : ""}`}>
                            {isOpeningBalanceCount
                              ? `${Number(d.diffQuantity || 0) * Number(d.averageCost || 0) > 0 ? "+" : ""}${(Number(d.diffQuantity || 0) * Number(d.averageCost || 0)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                              : d.diffValue != null
                                ? `${Number(d.diffValue) > 0 ? "+" : ""}${Number(d.diffValue).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                                : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {!settlementSourceCountId && (
              <div className="space-y-1.5">
                <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
                  التسوية اليدوية المدعومة تستخدم متوسط التكلفة الحالي وقت الترحيل. التكلفة لا تُدخل يدوياً، ويعيد الـBackend قراءة القيمة الحالية عند التطبيق.
                </div>
                <Label className="text-xs">ابحث عن صنف لإضافته للتسوية</Label>
                <div className="flex gap-2">
                  <Button size="sm" variant={settlementSearchMode === "qr" ? "default" : "outline"} onClick={() => setSettlementSearchMode("qr")} className="gap-1">
                    <QrCode className="w-3.5 h-3.5" /> باركود/QR
                  </Button>
                  <Button size="sm" variant={settlementSearchMode === "code" ? "default" : "outline"} onClick={() => setSettlementSearchMode("code")} className="gap-1">
                    <Package className="w-3.5 h-3.5" /> بالرقم
                  </Button>
                  <Button size="sm" variant={settlementSearchMode === "name" ? "default" : "outline"} onClick={() => setSettlementSearchMode("name")} className="gap-1">
                    <Search className="w-3.5 h-3.5" /> بالاسم
                  </Button>
                </div>

                {settlementSearchMode === "qr" ? (
                  <BarcodeScanner onScan={handleSettlementScanResolved} placeholder="امسح باركود/QR الصنف..." />
                ) : (
                  <>
                    <Input
                      placeholder={settlementSearchMode === "name" ? "ابحث باسم الصنف..." : "ابحث برقم الصنف أو باركود المصنع..."}
                      value={countItemSearch}
                      onChange={e => setCountItemSearch(e.target.value)}
                    />
                    <div className="max-h-40 overflow-y-auto border rounded-md divide-y">
                      {settlementSearchResults.map((i: any) => (
                        <div
                          key={i.id}
                          className="p-2 text-sm cursor-pointer hover:bg-muted/50 flex justify-between"
                          onClick={() => setSettlementItems(prev => [...prev, {
                            inventoryId: i.id,
                            afterQuantity: Number(i.quantity || 0),
                            currentQuantity: Number(i.quantity || 0),
                            averageCost: Number(i.averageCost || 0),
                            unit: i.unit,
                            itemName: i.itemName,
                          }])}
                        >
                          <span>{i.itemName}</span>
                          <span className="text-muted-foreground text-xs">الحالي: {i.quantity} {i.unit}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
                {settlementItems.length > 0 && (
                  <div className="border rounded-lg overflow-x-auto mt-2">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50">
                        <tr>
                          <th className="p-2 text-right">الصنف</th>
                          <th className="p-2 text-right">الحالي</th>
                          <th className="p-2 text-right">بعد التسوية</th>
                          <th className="p-2 text-right">متوسط التكلفة الحالي</th>
                          <th className="p-2 text-right">قيمة تقديرية</th>
                          <th className="p-2"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {settlementItems.map((s, idx) => {
                          const diff = Number(s.afterQuantity || 0) - Number(s.currentQuantity || 0);
                          const estimatedValue = diff * Number(s.averageCost || 0);
                          return (
                          <tr key={s.inventoryId} className="border-t">
                            <td className="p-2">{s.itemName || s.inventoryId}</td>
                            <td className="p-2 font-mono">{Number(s.currentQuantity || 0).toLocaleString()} {s.unit || ""}</td>
                            <td className="p-2">
                              <Input
                                type="number" className="w-28"
                                value={s.afterQuantity}
                                onChange={e => {
                                  const val = parseFloat(e.target.value || "0");
                                  setSettlementItems(prev => prev.map((x, i) => i === idx ? { ...x, afterQuantity: val } : x));
                                }}
                              />
                            </td>
                            <td className="p-2 font-mono">{Number(s.averageCost || 0).toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 })}</td>
                            <td className={`p-2 font-mono ${estimatedValue > 0 ? "text-green-700" : estimatedValue < 0 ? "text-red-700" : ""}`}>
                              {estimatedValue > 0 ? "+" : ""}{estimatedValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </td>
                            <td className="p-2">
                              <Button variant="ghost" size="icon" onClick={() =>
                                setSettlementItems(prev => prev.filter((_, i) => i !== idx))
                              }><X className="w-4 h-4" /></Button>
                            </td>
                          </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {!settlementSourceCountId && (
              <div className="space-y-1.5">
                <Label className="text-xs">المرجع (اختياري)</Label>
                <Input
                  value={settlementReference}
                  onChange={e => setSettlementReference(e.target.value)}
                  maxLength={255}
                  placeholder="مثال: رقم مستند أو مرجع أعمال خارجي"
                />
                <p className="text-[11px] text-muted-foreground">حتى 255 حرفاً. لا يُستخدم بدلاً من رقم عملية الجرد.</p>
              </div>
            )}

            <div className="space-y-1.5">
              <Label className="text-xs text-red-600">سبب التسوية (إلزامي) *</Label>
              <Textarea
                value={settlementReason}
                onChange={e => setSettlementReason(e.target.value)}
                placeholder="مثال: فرق جرد دوري، تصحيح خطأ إدخال..."
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={() => {
                const items = settlementSourceCountId
                  ? (discrepancies as any[])?.map(d => ({
                      inventoryId: d.inventoryId,
                      lotId: d.lotId ?? undefined,
                      // Backend settles the immutable finalized count and does not trust
                      // this field for periodic Lot counts; keep it for API compatibility.
                      afterQuantity: parseFloat(d.countedQuantity),
                      lotNumber: d.lotNumber || undefined,
                      expiryDate: toDateInputValue(d.expiryDate) || undefined,
                    })) || []
                  : settlementItems.map(s => ({ inventoryId: s.inventoryId, afterQuantity: s.afterQuantity }));

                applySettlementMut.mutate({
                  sourceType: settlementSourceCountId ? "from_count" : "manual",
                  sourceCountOperationId: settlementSourceCountId || undefined,
                  reason: settlementReason,
                  reference: !settlementSourceCountId ? settlementReference.trim() || undefined : undefined,
                  items,
                });
              }}
              disabled={applySettlementMut.isPending || settlementReason.trim().length < 10 || (lotsEnabled && !settlementSourceCountId)}
            >
              {applySettlementMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "تطبيق التسوية"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={showNew} onOpenChange={(open) => {
        // المشكلة 2: منع إغلاق النافذة بالضغط خارجها — تُغلق فقط بزر "إلغاء"
        if (!open) return;
      }}>
        <DialogContent
          className="max-w-2xl max-h-[90vh] overflow-y-auto"
          dir="rtl"
          onInteractOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Trash2 className="w-5 h-5 text-destructive" />
              استبعاد جديد
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-5">
            {/* تاريخ العملية */}
            <div className="space-y-1.5">
              <Label className="text-xs">تاريخ العملية *</Label>
              <Input type="date" value={operationDate} onChange={e => setOperationDate(e.target.value)} />
            </div>

            {/* البحث عن الصنف */}
            <div className="space-y-2 p-4 border rounded-lg bg-muted/20">
              <p className="text-sm font-medium">إضافة صنف</p>

              {/* طريقة البحث */}
              {lotsEnabled ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-xs rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
                    <QrCode className="w-4 h-4 shrink-0" />
                    اختر المستودع أولًا، ثم امسح QR. الاستبعاد سيخصم من رصيد نفس الـLot داخل المستودع المحدد فقط.
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">المستودع *</Label>
                    <Select
                      value={disposalWarehouseId}
                      onValueChange={(value) => {
                        setDisposalWarehouseId(value);
                        setFoundItem(null);
                        setDisposalLotInfo(null);
                        setQty("");
                      }}
                      disabled={disposalItems.length > 0 || !!foundItem}
                    >
                      <SelectTrigger><SelectValue placeholder="اختر المستودع قبل المسح..." /></SelectTrigger>
                      <SelectContent>
                        {((warehousesList as any[]) || []).filter((w: any) => !!w.isActive).map((w: any) => (
                          <SelectItem key={w.id} value={String(w.id)}>{w.nameAr || w.nameEn || `#${w.id}`}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {disposalItems.length > 0 && (
                      <p className="text-[11px] text-muted-foreground">المستودع ثابت بعد إضافة أول بند للعملية.</p>
                    )}
                  </div>
                  {!foundItem && disposalWarehouseId && (
                    <BarcodeScanner
                      onScan={handleQRScan}
                      placeholder="امسح QR الدفعة للاستبعاد..."
                    />
                  )}
                  {!foundItem && !disposalWarehouseId && (
                    <p className="text-xs text-amber-700">اختر المستودع لتمكين مسح QR.</p>
                  )}
                  {resolveDisposalLotMut.isPending && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" /> جارٍ التحقق من الدفعة...
                    </p>
                  )}
                </div>
              ) : (
                <>
                  <div className="flex gap-2">
                    <Button size="sm" variant={searchMode === "name" ? "default" : "outline"} onClick={() => setSearchMode("name")} className="gap-1">
                      <Search className="w-3.5 h-3.5" /> بالاسم
                    </Button>
                    <Button size="sm" variant={searchMode === "code" ? "default" : "outline"} onClick={() => setSearchMode("code")} className="gap-1">
                      <Package className="w-3.5 h-3.5" /> بالرقم
                    </Button>
                    <Button size="sm" variant={searchMode === "qr" ? "default" : "outline"} onClick={() => setSearchMode("qr")} className="gap-1">
                      <QrCode className="w-3.5 h-3.5" /> QR Code
                    </Button>
                  </div>

                  {searchMode === "qr" && !foundItem && (
                    <BarcodeScanner
                      onScan={handleQRScan}
                      placeholder="امسح QR Code الصنف..."
                    />
                  )}
                </>
              )}

              {/* خانة البحث النصي — فقط في Workflow القديم */}
              {!lotsEnabled && (searchMode === "name" || searchMode === "code") && !foundItem && (
                <div className="relative">
                  <Input
                    placeholder={searchMode === "name" ? "ابحث باسم الصنف..." : "ابحث برقم الصنف أو الباركود..."}
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    dir="rtl"
                  />
                  {searchResults.length > 0 && (
                    <div className="absolute top-full right-0 left-0 z-50 bg-white border rounded-lg shadow-lg mt-1 max-h-48 overflow-y-auto">
                      {searchResults.map((item: any) => (
                        <button
                          key={item.id}
                          className="w-full text-right px-3 py-2 hover:bg-muted/50 text-sm flex items-center justify-between"
                          onClick={() => selectItem(item)}
                        >
                          <span className="font-medium">{item.itemName}</span>
                          <span className="text-xs text-muted-foreground">رصيد: {item.quantity} {item.unit}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* بيانات الصنف المختار */}
              {foundItem && (
                <div className="space-y-3">
                  <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-semibold text-sm">{foundItem.itemName}</p>
                        <div className="text-xs text-muted-foreground mt-1 space-y-0.5">
                          {foundItem.internalCode && <p>الكود: <span className="font-mono">{foundItem.internalCode}</span></p>}
                          {lotsEnabled && disposalLotInfo?.lotCode && <p>الدفعة: <span className="font-mono font-semibold">{disposalLotInfo.lotCode}</span></p>}
                          {lotsEnabled && disposalLotInfo?.warehouseName && <p>المستودع: <strong className="text-foreground">{disposalLotInfo.warehouseName}</strong></p>}
                          <p>الرصيد المتاح: <strong className="text-foreground">{lotsEnabled ? disposalLotInfo?.availableQuantity : foundItem.quantity} {foundItem.unit}</strong></p>
                          {lotsEnabled && <p>إجمالي Inventory: {foundItem.quantity} {foundItem.unit}</p>}
                          {foundItem.location && <p>الموقع: {foundItem.location}</p>}
                        </div>
                      </div>
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => { setFoundItem(null); setDisposalLotInfo(null); setQty(""); setReason(""); }}>
                        <X className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">الكمية *</Label>
                      <Input type="number" min={0.001} step={0.5} value={qty} onChange={e => setQty(e.target.value)} placeholder="0" dir="ltr" className="font-mono" />
                      {qty && parseFloat(qty) > Number(lotsEnabled ? disposalLotInfo?.availableQuantity || 0 : foundItem.quantity) && (
                        <p className="text-xs text-destructive flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> أكبر من الرصيد المتاح للدفعة</p>
                      )}
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">سبب الاستبعاد *</Label>
                      <Select value={reason} onValueChange={setReason}>
                        <SelectTrigger><SelectValue placeholder="اختر السبب..." /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="damaged">تالف</SelectItem>
                          <SelectItem value="expired">منتهي الصلاحية</SelectItem>
                          <SelectItem value="missing">مفقود</SelectItem>
                          <SelectItem value="other">أخرى</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {/* إجمالي القيمة المحسوبة تلقائياً من averageCost */}
                  {qty && parseFloat(foundItem.averageCost || "0") > 0 && (
                    <div className="flex items-center justify-between text-sm px-3 py-2 bg-muted/40 rounded-lg">
                      <span className="text-muted-foreground">إجمالي القيمة المستبعدة</span>
                      <span className="font-bold">
                        {(parseFloat(qty || "0") * parseFloat(foundItem.averageCost || "0")).toLocaleString()} ر.س
                      </span>
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <Label className="text-xs">ملاحظات على هذا الصنف (اختياري)</Label>
                    <Input value={itemNotes} onChange={e => setItemNotes(e.target.value)} placeholder="أي تفاصيل إضافية..." />
                  </div>

                  <Button className="w-full gap-2" variant="outline" onClick={addItemToList}>
                    <Plus className="w-4 h-4" />
                    إضافة هذا الصنف للعملية
                  </Button>
                </div>
              )}
            </div>

            {/* قائمة الأصناف المضافة */}
            {disposalItems.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium">الأصناف المضافة ({disposalItems.length})</p>
                {disposalItems.map((item, idx) => (
                  <DisposalItemCard
                    key={idx}
                    item={item}
                    onRemove={() => setDisposalItems(prev => prev.filter((_, i) => i !== idx))}
                  />
                ))}
                <div className="flex justify-between text-sm pt-1 border-t">
                  <span className="text-muted-foreground">إجمالي القيمة:</span>
                  <span className="font-bold">{fmtMoney(disposalItems.reduce((s, i) => s + i.totalCost, 0))}</span>
                </div>
              </div>
            )}

            {/* ملاحظات العملية */}
            <div className="space-y-1.5">
              <Label className="text-xs">ملاحظات العملية (اختياري)</Label>
              <Textarea value={operationNotes} onChange={e => setOperationNotes(e.target.value)} placeholder="ملاحظات عامة على عملية الاستبعاد..." rows={2} />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={resetNew}>إلغاء</Button>
            <Button
              variant="destructive"
              className="gap-1.5"
              disabled={disposalItems.length === 0 || createMut.isPending}
              onClick={submitDisposal}
            >
              {createMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
              حفظ عملية الاستبعاد
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ══ نافذة تفاصيل عملية ══ */}
      <Dialog open={!!detailId} onOpenChange={(open) => !open && setDetailId(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Trash2 className="w-5 h-5 text-destructive" />
              {detail?.operationNumber || "تفاصيل العملية"}
            </DialogTitle>
          </DialogHeader>

          {!detail ? (
            <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : (
            <div className="space-y-4">
              {/* بيانات العملية */}
              <div className="grid grid-cols-2 gap-3 p-3 bg-muted/30 rounded-lg text-sm">
                <div><span className="text-muted-foreground">التاريخ: </span><strong>{fmtDate(detail.operationDate)}</strong></div>
                <div><span className="text-muted-foreground">المنفذ: </span><strong>{detail.creatorName}</strong></div>
                <div><span className="text-muted-foreground">الحالة: </span>
                  <Badge className={`text-[10px] ${STATUS_LABELS[detail.status]?.color}`}>{STATUS_LABELS[detail.status]?.label}</Badge>
                </div>
                <div><span className="text-muted-foreground">عدد الأصناف: </span><strong>{detail.items?.length}</strong></div>
                {detail.notes && <div className="col-span-2"><span className="text-muted-foreground">الملاحظات: </span>{detail.notes}</div>}
              </div>

              {/* جدول الأصناف */}
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/50 text-xs text-muted-foreground">
                      <th className="text-right font-medium px-2.5 py-2">الصنف</th>
                      <th className="text-center font-medium px-2.5 py-2">الكمية</th>
                      <th className="text-center font-medium px-2.5 py-2">السبب</th>
                      <th className="text-center font-medium px-2.5 py-2">القيمة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.items?.map((item: any) => (
                      <tr key={item.id} className="border-t">
                        <td className="px-2.5 py-2 text-right align-middle">
                          <p className="font-medium">{item.itemName}</p>
                          {item.lotCode && <p className="text-xs text-muted-foreground">الدفعة: <span className="font-mono">{item.lotCode}</span></p>}
                          {item.notes && <p className="text-xs text-muted-foreground">{item.notes}</p>}
                        </td>
                        <td className="px-2.5 py-2 text-center align-middle">{parseFloat(item.quantity).toLocaleString()} {item.unit}</td>
                        <td className="px-2.5 py-2 text-center align-middle"><Badge variant="outline" className="text-[10px]">{REASON_LABELS[item.reason]}</Badge></td>
                        <td className="px-2.5 py-2 text-center align-middle">{fmtMoney(item.totalCost)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {detail && (
            <DialogFooter>
              <Button variant="outline" onClick={() => setDetailId(null)}>إغلاق</Button>
              <Button
                className="gap-2"
                onClick={() => printDisposalDocument(detail)}
              >
                <Printer className="w-4 h-4" />
                طباعة الوثيقة
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
