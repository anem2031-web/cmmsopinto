import { InventoryBooks, loadBookLots } from "@/components/inventory/InventoryBooks";
import { InventoryQuantitySummary } from "@/components/inventory/InventoryQuantitySummary";
import { planBookFifo } from "@shared/inventory-book";
import { isOwnerOrAdminRole } from "@shared/restricted-module-policy";
import { trpc } from "@/lib/trpc";
import { useLocation } from "wouter";
import { InventoryItemCard } from "@/components/inventory/InventoryItemCard";
import {
  IssueCostAllocationEditor,
  buildIssueCostAllocationPayload,
  createIssueCostAllocationDraft,
  type IssueCostAllocationDraft,
} from "@/components/inventory/IssueCostAllocationEditor";
import LotLabelsPrintScreen, { type LotLabelItem } from "@/components/inventory/LotLabelsPrintScreen";
import BarcodeScanner from "@/components/common/BarcodeScanner";
import { useAuth } from "@/_core/hooks/useAuth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { TechnicianCombobox } from "@/components/tickets/TechnicianCombobox";
import {
  Package, Plus, AlertTriangle, Loader2,
  Pencil, Trash2, QrCode, Printer, Search, X, ArrowDownUp, CalendarDays, Truck,
  ChevronRight, ChevronDown, ChevronLeft, Check
} from "lucide-react";
import { useState, useEffect, useRef, useMemo, type ReactNode } from "react";
import QRCode from "qrcode";
import { toast } from "sonner";
import { ExportButton } from "@/components/common/ExportButton";
import { useTranslation } from "@/contexts/LanguageContext";


type InventoryCatalogNode = {
  id: number;
  parentId?: number | null;
  code?: string | null;
  nameAr?: string | null;
  nameEn?: string | null;
  level?: number | null;
  sortOrder?: number | null;
};

// 2B-9 — فلتر Inventory يستخدم نفس Catalog taxonomy كشجرة منبثقة.
// اختيار أي عقدة يعني: هذه العقدة + كل descendants، بينما تبقى النتائج محصورة
// في المخزن المختار فقط. لا توجد أي شجرة تصنيفات خاصة بالمخزن.
function InventoryCatalogTreePicker({
  nodes,
  value,
  onChange,
  language,
  primaryNodeId,
  disabled,
}: {
  nodes: InventoryCatalogNode[];
  value: string;
  onChange: (nodeId: string) => void;
  language: string;
  primaryNodeId?: number | null;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [expandedNodeIds, setExpandedNodeIds] = useState<Set<number>>(() => new Set());

  const nodeById = useMemo(
    () => new Map(nodes.map(node => [Number(node.id), node])),
    [nodes],
  );

  const childrenByParent = useMemo(() => {
    const map = new Map<number | null, InventoryCatalogNode[]>();
    for (const node of nodes) {
      const rawParentId = node.parentId ? Number(node.parentId) : null;
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

  const selectedNodeId = value && value !== "all" ? Number(value) : null;
  const selectedPath = useMemo(() => {
    if (!selectedNodeId) return [] as InventoryCatalogNode[];
    const path: InventoryCatalogNode[] = [];
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

    const addAncestors = (node: InventoryCatalogNode) => {
      const visited = new Set<number>();
      let current: InventoryCatalogNode | undefined = node;
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

  const nodeLabel = (node: InventoryCatalogNode) =>
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

  const chooseValue = (nodeId: string) => {
    onChange(nodeId);
    setOpen(false);
  };

  const renderNode = (node: InventoryCatalogNode, depth: number): ReactNode => {
    if (visibleNodeIds && !visibleNodeIds.has(Number(node.id))) return null;
    const nodeId = Number(node.id);
    const children = childrenByParent.get(nodeId) || [];
    const hasChildren = children.length > 0;
    const expanded = !!normalizedSearch || expandedNodeIds.has(nodeId);
    const selected = selectedNodeId === nodeId;
    const isPrimary = !!primaryNodeId && Number(primaryNodeId) === nodeId;

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
            onClick={() => chooseValue(String(nodeId))}
            className="min-w-0 flex-1 text-start flex items-center justify-between gap-2 rounded px-1 py-1"
            title="فلترة المخزون بهذا المستوى وكل الفروع التابعة له"
          >
            <span className="min-w-0">
              <span className="block text-sm font-medium truncate">
                {node.code ? `${node.code} · ` : ""}{nodeLabel(node)}
              </span>
              {(hasChildren || isPrimary) && (
                <span className="block text-[11px] text-muted-foreground">
                  {isPrimary ? "التصنيف الرئيسي للمخزن" : "يشمل هذا المستوى وجميع الفروع تحته"}
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
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          className="w-full justify-between font-normal min-h-10 h-auto py-2"
        >
          <span className={`truncate ${selectedPathLabel ? "text-foreground" : "text-muted-foreground"}`}>
            {selectedPathLabel || "كل التصنيفات"}
          </span>
          <ChevronDown className="w-4 h-4 shrink-0 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(520px,calc(100vw-2rem))] p-3" align="start">
        <div className="space-y-2">
          <div>
            <p className="text-sm font-semibold">شجرة تصنيفات الكتالوج</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              اختر أي مستوى؛ الفلتر سيعرض هذا المستوى وجميع الفروع التابعة له داخل المخزن المحدد.
            </p>
          </div>
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="ابحث بالاسم أو الكود..."
            className="h-9"
          />
          <button
            type="button"
            onClick={() => chooseValue("all")}
            className={`w-full flex items-center justify-between rounded-md border px-3 py-2 text-sm text-start ${
              !selectedNodeId ? "border-blue-500 bg-blue-50 text-blue-900" : "hover:bg-slate-50"
            }`}
          >
            <span>كل التصنيفات</span>
            {!selectedNodeId && <Check className="w-4 h-4 text-blue-600" />}
          </button>
          {selectedPath.length > 0 && (
            <div className="rounded-md border border-blue-100 bg-blue-50 px-2.5 py-2 text-xs text-blue-900">
              <span className="font-semibold">التصنيف المختار:</span> {selectedPathLabel}
            </div>
          )}
          <div className="max-h-80 overflow-y-auto rounded-md border p-2">
            {roots.length === 0 ? (
              <p className="text-sm text-muted-foreground py-5 text-center">لا توجد تصنيفات نشطة.</p>
            ) : visibleNodeIds && visibleNodeIds.size === 0 ? (
              <p className="text-sm text-muted-foreground py-5 text-center">لا يوجد تصنيف مطابق للبحث.</p>
            ) : (
              roots.map(node => renderNode(node, 0))
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default function Inventory() {
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const [printBarcode, setPrintBarcode] = useState<any>(null);
  const [selectedItemId, setSelectedItemId] = useState<number | null>(null);
  const [deliverItem, setDeliverItem] = useState<any>(null);
  const [deliverQty, setDeliverQty] = useState("");
  const [deliverToId, setDeliverToId] = useState("");
  const [deliverNotes, setDeliverNotes] = useState("");
  const [deliverLotInfo, setDeliverLotInfo] = useState<any>(null);
  const [fifoLots, setFifoLots] = useState<any[]>([]);
  const bookOperationKey = useRef<string | null>(null);
  const [deliverCostAllocations, setDeliverCostAllocations] = useState<IssueCostAllocationDraft[]>(() => [createIssueCostAllocationDraft()]);
  const [lotCodeSearch, setLotCodeSearch] = useState("");
  const [lotDialogItem, setLotDialogItem] = useState<any>(null);
  const [printLotQr, setPrintLotQr] = useState<LotLabelItem | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchMode, setSearchMode] = useState<"name" | "code" | "qr">("name");
  const [qrSearchInventoryIds, setQrSearchInventoryIds] = useState<number[]>([]);
  const [sortBy, setSortBy] = useState<"recent" | "name" | "quantity">("recent");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  // ── ترقيم الصفحات لقائمة المخزون: 36 صنفاً في كل صفحة ──
  const [currentPage, setCurrentPage] = useState(1);
  const { t, language } = useTranslation();

  const { data: items, isLoading, refetch } = trpc.inventory.list.useQuery();
  const { data: inventoryTaxonomy = [] } = trpc.inventory.taxonomy.useQuery();
  const { data: inventoryCatalogNodes = [] } = trpc.catalog.nodes.list.useQuery({ isActive: true });
  const taxonomyByInventoryId = new Map(
    (inventoryTaxonomy as any[]).map((row: any) => [Number(row.inventoryId), row]),
  );
  const inventoryItemsWithTaxonomy = (items as any[] || []).map((item: any) => ({
    ...item,
    ...(taxonomyByInventoryId.get(Number(item.id)) || {}),
  }));
  const { data: lotTrackingStatus } = trpc.inventoryCount.lotTrackingStatus.useQuery();
  const lotsEnabled = !!lotTrackingStatus?.enabled;
  const { data: lotSummaries = [] } = trpc.inventory.lotSummaries.useQuery(undefined, {
    enabled: lotsEnabled,
  });
  const { data: selectedInventoryLots = [], isLoading: lotsDialogLoading } = trpc.inventory.listLots.useQuery(
    { inventoryId: lotDialogItem?.id || 0 },
    { enabled: lotsEnabled && !!lotDialogItem?.id },
  );
  const lotSummaryByInventoryId = new Map(
    (lotSummaries as any[]).map((row: any) => [Number(row.inventoryId), row]),
  );

  // ── اختيار المخزن — أول حقل يظهر بالصفحة، وكل التفاصيل أدناه خاصة بالمخزن المختار فقط ──
  const { data: warehousesList } = trpc.warehouse.list.useQuery();
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<string>("");
  // 2B-9 — فلتر التصنيف يستهلك Catalog taxonomy فقط؛ لا توجد تصنيفات خاصة بالمخزن.
  const [selectedCatalogNodeId, setSelectedCatalogNodeId] = useState<string>("all");

  // اختيار المخزن الرئيسي تلقائيًا أول مرة تُحمَّل فيها القائمة (بدل ترك الصفحة فارغة بانتظار اختيار يدوي)
  useEffect(() => {
    if (selectedWarehouseId || !warehousesList?.length) return;
    const main = (warehousesList as any[]).find((w: any) => w.type === "main");
    setSelectedWarehouseId(String((main || warehousesList[0]).id));
  }, [warehousesList, selectedWarehouseId]);

  const selectedWarehouse = (warehousesList as any[] || []).find(
    (w: any) => String(w.id) === selectedWarehouseId
  );

  // لا نحمل فلتر تصنيف مخزن سابق إلى مخزن جديد؛ التصنيفات الظاهرة تُشتق من محتوى المخزن الحالي.
  useEffect(() => {
    setSelectedCatalogNodeId("all");
  }, [selectedWarehouseId]);

  // أصناف المخزن المختار فقط. المخزن الرئيسي يشمل أيضًا الأصناف القديمة التي لم تُربط
  // بعد بأي مخزن (warehouseId فارغ) — تفاديًا لظهور الصفحة فارغة لصنوف لم تُنقَل بعد
  // لنظام المخازن المتعددة؛ أي مخزن فرعي يعرض فقط ما نُقل إليه فعليًا (تطابق تام).
  const warehouseItems = inventoryItemsWithTaxonomy.filter((item: any) => {
    if (!selectedWarehouseId) return true;
    if (String(item.warehouseId) === selectedWarehouseId) return true;
    if (selectedWarehouse?.type === "main" && !item.warehouseId) return true;
    return false;
  });

  // ── إخفاء الأصناف الصفرية — افتراضيًا مؤشَّر (تُخفى)، والمستخدم يقدر يغيّره ──
  const [hideZeroStock, setHideZeroStock] = useState(true);

  // الأصناف المرئية فعليًا بعد تطبيق خيار إخفاء الصفرية — هذي هي القاعدة التي
  // تُبنى عليها كل من: الإحصائيات أعلاه، والبحث/الفرز/فلتر التاريخ أدناه.
  // (بقرار صاحب المشروع: الإحصائيات تتأثر بنفس خيار الإخفاء، وليست ثابتة على كل أصناف المخزن)
  const visibleWarehouseItems = hideZeroStock
    ? warehouseItems.filter((item: any) => (Number(item.quantity) || 0) > 0)
    : warehouseItems;

  // 2B-9 — اختيار أي عقدة من شجرة Catalog الكاملة يفلتر أصناف المخزن حسب
  // وجود تلك العقدة داخل مسار الصنف؛ وبذلك يشمل الاختيار كل descendants تلقائياً.
  const categoryFilteredWarehouseItems = selectedCatalogNodeId === "all"
    ? visibleWarehouseItems
    : visibleWarehouseItems.filter((item: any) =>
        (Array.isArray(item.catalogCategoryPath) ? item.catalogCategoryPath : [])
          .some((node: any) => String(node?.id) === selectedCatalogNodeId),
      );

  const totalWarehouseQuantities = Object.entries(categoryFilteredWarehouseItems.reduce((totals:Record<string,number>, item:any)=>{
    const unit=String(item.issueUnit || item.unit || "وحدة غير محددة");totals[unit]=(totals[unit] || 0)+Number(item.quantity || 0);return totals;
  },{})).map(([unit,quantity])=>({unit,quantity:Number(quantity)}));

  const bookNodeIds = useMemo(() => {
    if (selectedCatalogNodeId === "all") return undefined;
    const nodes = inventoryCatalogNodes as any[];
    const byId = new Map(nodes.map(node => [Number(node.id), node]));
    return nodes.filter(node => {
      const seen = new Set<number>();
      let current = node;
      while (current && !seen.has(Number(current.id))) {
        if (String(current.id) === selectedCatalogNodeId) return true;
        seen.add(Number(current.id));
        current = byId.get(Number(current.parentId));
      }
      return false;
    }).map(node => Number(node.id));
  }, [inventoryCatalogNodes, selectedCatalogNodeId]);

  const utils = trpc.useUtils();
  const updateMut = trpc.inventory.update.useMutation({
    onSuccess: () => { toast.success(t.common.savedSuccessfully); utils.inventory.list.invalidate(); setEditOpen(false); },
    onError: (err: any) => toast.error(err.message),
  });
  const deleteMut = trpc.inventory.delete.useMutation({
    onSuccess: () => { toast.success(t.common.deletedSuccessfully); utils.inventory.list.invalidate(); setDeleteOpen(false); },
    onError: (err: any) => toast.error(err.message),
  });

  const { data: allUsers = [] } = trpc.users.list.useQuery();
  const resolveLotSearchMut = trpc.inventory.resolveLotSearch.useMutation({
    onSuccess: (data: any) => {
      const matchedIds = (data.matches || []).map((row: any) => Number(row.inventoryId));
      setQrSearchInventoryIds(matchedIds);
      setSearchQuery(data.trackingToken || data.lotCode || "");

      const selectedId = selectedWarehouseId ? Number(selectedWarehouseId) : null;
      const inCurrentWarehouse = (data.matches || []).filter((row: any) => {
        if (selectedId == null) return true;
        if (Number(row.warehouseId) === selectedId) return true;
        return selectedWarehouse?.type === "main" && row.warehouseId == null;
      });

      if (inCurrentWarehouse.length === 0) {
        toast.warning(`تم التعرف على الدفعة ${data.lotCode} لكنها لا تملك رصيدًا في المستودع المختار`);
      } else {
        toast.success(`تم التعرف على الدفعة ${data.lotCode}`);
      }
    },
    onError: (err: any) => {
      setQrSearchInventoryIds([]);
      toast.error(err.message);
    },
  });
  const resolveDeliveryLotMut = trpc.inventory.resolveDeliveryLot.useMutation({
    onSuccess: (data: any) => {
      setDeliverLotInfo(data);
      toast.success(`تم التعرف على الدفعة ${data.lotCode}`);
    },
    onError: (err: any) => {
      setDeliverLotInfo(null);
      toast.error(err.message);
    },
  });
  const bookDeliverMut = trpc.purchaseOrders.deliverInventoryBook.useMutation({
    onSuccess: (data: any) => { toast.success(`تم الصرف من ${data.deliveries.length} لوت — التكلفة ${Number(data.allocatedCostTotal).toFixed(2)} ر.س`);
      utils.inventory.list.invalidate(); utils.inventory.books.invalidate(); utils.inventory.bookPages.invalidate();
      setDeliverItem(null); setDeliverLotInfo(null); bookOperationKey.current = null;
    }, onError: (error: any) => toast.error(error.message),
  });
  const openBookDelivery = async (book: any, unit: string) => {
    if (!isOwnerOrAdminRole(user?.role) || Number(user?.isActive) !== 1) return;
    try {
      const lots = await loadBookLots(input => utils.client.inventory.bookPages.query(input), book.id, Number(selectedWarehouseId));
      setFifoLots(lots); bookOperationKey.current = crypto.randomUUID();
      setDeliverItem({ id: 0, linkedItemId: book.id, warehouseId: Number(selectedWarehouseId), itemName: book.nameAr || book.nameEn,
        unit, quantity: lots.filter(lot => !Number(lot.isFrozen) && String(lot.issueUnit || lot.inventoryUnit || "") === unit).reduce((sum, lot) => sum + Number(lot.balanceQuantity), 0), bookFifo: true });
      setDeliverLotInfo(null); setDeliverQty(""); setDeliverToId(""); setDeliverNotes(""); setDeliverCostAllocations([createIssueCostAllocationDraft()]);
    } catch (error: any) { toast.error(error.message); }
  };
  const fifoUnitCost = (() => { try { const plan = planBookFifo(fifoLots, Number(deliverQty), deliverItem?.unit || "");
    return plan.reduce((sum, lot) => sum + lot.quantity * Number(lot.issueUnitCost || 0), 0) / Number(deliverQty); } catch { return 0; } })();
  const deliverMut = trpc.purchaseOrders.deliverInventoryItem.useMutation({
    onSuccess: (data: any) => {
      toast.success(`تم التسليم بنجاح — سند ${data.deliveryNumber}${data.allocatedCostTotal != null ? ` — تكلفة اللوت المحملة ${Number(data.allocatedCostTotal).toFixed(2)} ر.س` : ""}`);
      utils.inventory.list.invalidate(); utils.inventory.books.invalidate(); utils.inventory.bookPages.invalidate();
      setDeliverItem(null);
      setDeliverQty("");
      setDeliverToId("");
      setDeliverNotes("");
      setDeliverLotInfo(null);
      setDeliverCostAllocations([createIssueCostAllocationDraft()]);
    },
    onError: (err: any) => toast.error(err.message),
  });

  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<any>(null);
  const [editForm, setEditForm] = useState({ itemName: "", description: "", quantity: 0, unit: "", minQuantity: 0, location: "" });

  const openEdit = (item: any) => {
    setSelectedItem(item);
    setEditForm({ itemName: item.itemName, description: item.description || "", quantity: item.quantity, unit: item.unit || "", minQuantity: item.minQuantity || 0, location: item.location || "" });
    setEditOpen(true);
  };
  const openDelete = (item: any) => { setSelectedItem(item); setDeleteOpen(true); };

  const isWarehouse = user?.role === "warehouse" || user?.role === "admin" || user?.role === "owner";

  // إعادة الصفحة إلى 1 عند تغيير أي فلتر أو بحث، حتى لا تبقى على صفحة فارغة.
  // يجب أن يُستدعى هذا الـHook دائماً قبل أي "return" مبكر (مثل return طباعة QR
  // أدناه)، وإلا يختلف عدد الـHooks بين مرات العرض ويسبب خطأ React.
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, searchMode, selectedWarehouseId, selectedCatalogNodeId, sortBy, dateFrom, dateTo, hideZeroStock]);

  if (printLotQr) {
    return <LotLabelsPrintScreen items={[printLotQr]} onDone={() => setPrintLotQr(null)} />;
  }

  // ── بحث تزايدي: يطابق أي حقل ظاهر في صف الصنف ──
  const filteredItems = categoryFilteredWarehouseItems.filter((item: any) => !lotsEnabled || !item.linkedItemId || !item.warehouseId)
    .filter((item: any) => {
      if (!searchQuery.trim()) return true;
      const q = searchQuery.trim().toLowerCase();
      if (searchMode === "qr") {
        return qrSearchInventoryIds.includes(Number(item.id));
      }
      if (searchMode === "code") {
        return (
          String(item.internalCode ?? "").toLowerCase().includes(q) ||
          String(item.manufacturerBarcode ?? "").toLowerCase().includes(q)
        );
      }
      const haystack = [
        item.itemName, item.description, item.unit,
        item.location, item.invoiceDate,
      ].filter(Boolean).join(" ").toLowerCase();
      return haystack.includes(q);
    })
    .filter((item: any) => {
      if (!dateFrom && !dateTo) return true;
      if (!item.invoiceDate) return false; // بدون تاريخ فاتورة، لا يُحتسب ضمن الفلتر
      const invDate = new Date(item.invoiceDate).getTime();
      if (dateFrom && invDate < new Date(dateFrom).setHours(0, 0, 0, 0)) return false;
      if (dateTo && invDate > new Date(dateTo).setHours(23, 59, 59, 999)) return false;
      return true;
    })
    .sort((a: any, b: any) => {
      if (sortBy === "name") return (a.itemName || "").localeCompare(b.itemName || "", "ar");
      if (sortBy === "quantity") return (a.quantity || 0) - (b.quantity || 0);
      // recent (الافتراضي): الأحدث أولاً
      return new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime();
    });

  // ── تقسيم الأصناف إلى صفحات، 36 صنفاً في كل صفحة ──
  const ITEMS_PER_PAGE = 36;
  const totalPages = Math.max(1, Math.ceil(filteredItems.length / ITEMS_PER_PAGE));
  const currentPageSafe = Math.min(currentPage, totalPages);
  const pagedItems = filteredItems.slice(
    (currentPageSafe - 1) * ITEMS_PER_PAGE,
    currentPageSafe * ITEMS_PER_PAGE,
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Package className="w-6 h-6 text-primary" /> {t.inventory.title}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">{t.common.description}</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <ExportButton
            endpoint="inventory"
            filename="inventory"
            payload={{ itemIds: filteredItems.map((item: any) => Number(item.id)),
              ...(lotsEnabled && selectedWarehouseId ? { bookFilters: {
                warehouseId: Number(selectedWarehouseId), search: searchQuery, includeZero: !hideZeroStock,
                nodeIds: bookNodeIds, sort: sortBy, dateFrom: dateFrom || undefined, dateTo: dateTo || undefined,
              } } : {}),
            }}
          />
          {isWarehouse && (
            <Button className="gap-2" onClick={() => navigate("/inventory/receive")}>
              <Plus className="w-4 h-4" /> {t.common.add}
            </Button>
          )}
        </div>
      </div>

      {/* ══ اختيار المخزن + Taxonomy الكتالوج الفعلية داخل المخزن ══ */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-w-3xl">
        <div className="space-y-1.5">
          <Label className="text-xs">المخزن</Label>
          <Select value={selectedWarehouseId} onValueChange={setSelectedWarehouseId}>
            <SelectTrigger><SelectValue placeholder="اختر المخزن..." /></SelectTrigger>
            <SelectContent>
              {(warehousesList as any[] || []).map((w: any) => (
                <SelectItem key={w.id} value={String(w.id)}>{w.nameAr}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">التصنيف — من الكتالوج</Label>
          <InventoryCatalogTreePicker
            nodes={(inventoryCatalogNodes as InventoryCatalogNode[]) || []}
            value={selectedCatalogNodeId}
            onChange={setSelectedCatalogNodeId}
            language={language}
            primaryNodeId={Number(selectedWarehouse?.catalogNodeId || 0) || null}
            disabled={!selectedWarehouseId}
          />
          <p className="text-[11px] text-muted-foreground">
            اختر أي مستوى من نفس شجرة الكتالوج؛ النتائج تشمل المستوى المختار وكل فروعه داخل المخزن الحالي.
          </p>
          {selectedWarehouse?.type === "branch" && selectedWarehouse?.catalogNodeNameAr && (
            <p className="text-[11px] text-muted-foreground">
              التصنيف الرئيسي للمخزن: <span className="font-medium text-foreground">{selectedWarehouse.catalogNodeNameAr}</span> — لا يمنع وجود أصناف من تصنيفات أخرى.
            </p>
          )}
        </div>
      </div>

      {/* يظهر فقط بعد اختيار مخزن — افتراضيًا مؤشَّر (الأصناف الصفرية مخفية)، وقابل للتغيير */}
      {selectedWarehouseId && (
        <div className="flex items-center gap-2">
          <Checkbox
            id="hide-zero-stock"
            checked={hideZeroStock}
            onCheckedChange={(checked) => setHideZeroStock(checked === true)}
          />
          <Label htmlFor="hide-zero-stock" className="text-sm font-normal cursor-pointer">
            إخفاء الأصناف ذات الرصيد صفر
          </Label>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Card className="border-blue-200 bg-blue-50/50">
          <CardContent className="p-3 text-center">
            <Package className="w-5 h-5 mx-auto text-blue-600 mb-1" />
            <p className="text-2xl font-bold text-blue-800">{new Set(categoryFilteredWarehouseItems.map((item:any)=>item.linkedItemId ? `catalog:${item.linkedItemId}` : `inventory:${item.id}`)).size}</p>
            <p className="text-[10px] text-blue-600">{selectedCatalogNodeId === "all" ? t.inventory.currentStock : "أصناف التصنيف المحدد"}</p>
          </CardContent>
        </Card>
        <Card className="border-red-200 bg-red-50/50">
          <CardContent className="p-3 text-center">
            <AlertTriangle className="w-5 h-5 mx-auto text-red-600 mb-1" />
            <p className="text-2xl font-bold text-red-800">{categoryFilteredWarehouseItems.filter((i: any) => (i.minQuantity || 0) > 0 && i.quantity <= (i.minQuantity || 0)).length}</p>
            <p className="text-[10px] text-red-600">{t.inventory.lowStock}</p>
          </CardContent>
        </Card>
        {/* إجمالي الكميات بالمخزن المختار — للعرض فقط، محسوب تلقائيًا ولا يقبل أي تعديل يدوي */}
        <InventoryQuantitySummary totals={totalWarehouseQuantities} />
      </div>

      {/* خانة البحث الذكية + الترتيب + فلتر التاريخ */}
      <div className="flex flex-col md:flex-row gap-2">
        <div className="flex-1 space-y-1.5">
          {/* أزرار طريقة البحث */}
          <div className="flex gap-1.5">
            <Button size="sm" variant={searchMode === "name" ? "default" : "outline"} onClick={() => { setSearchMode("name"); setSearchQuery(""); setQrSearchInventoryIds([]); }} className="gap-1 h-7 text-xs">
              <Search className="w-3 h-3" /> بالاسم
            </Button>
            <Button size="sm" variant={searchMode === "code" ? "default" : "outline"} onClick={() => { setSearchMode("code"); setSearchQuery(""); setQrSearchInventoryIds([]); }} className="gap-1 h-7 text-xs">
              <QrCode className="w-3 h-3" /> بالرقم
            </Button>
            <Button size="sm" variant={searchMode === "qr" ? "default" : "outline"} onClick={() => { setSearchMode("qr"); setSearchQuery(""); setQrSearchInventoryIds([]); }} className="gap-1 h-7 text-xs">
              <QrCode className="w-3 h-3" /> برقم اللوت / QR
            </Button>
            {searchQuery && (
              <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground" onClick={() => { setSearchQuery(""); setSearchMode("name"); setQrSearchInventoryIds([]); }}>
                <X className="w-3 h-3" />
              </Button>
            )}
          </div>

          {/* QR Scanner أو خانة نصية */}
          {searchMode === "qr" ? (
            <BarcodeScanner
              onScan={(code) => {
                setSearchQuery(code);
                setQrSearchInventoryIds([]);
                resolveLotSearchMut.mutate({ code });
              }}
              placeholder="اكتب رقم اللوت (مثال: LOT-2026-00123) أو امسح QR الدفعة..."
            />
          ) : (
            <div className="relative">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder={searchMode === "name" ? "بحث باسم الصنف..." : "بحث برقم الصنف أو الباركود..."}
                className="pr-9 pl-9"
              />
              {searchQuery && (
                <button className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" onClick={() => setSearchQuery("")}>
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          )}
        </div>

        <Select value={sortBy} onValueChange={(v: any) => setSortBy(v)}>
          <SelectTrigger className="w-full md:w-[170px] gap-1.5">
            <ArrowDownUp className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <SelectValue placeholder="ترتيب حسب" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="recent">الأحدث أولاً</SelectItem>
            <SelectItem value="name">أبجدياً (الاسم)</SelectItem>
            <SelectItem value="quantity">الأقل كمية أولاً</SelectItem>
          </SelectContent>
        </Select>

        <div className="flex items-center gap-1.5">
          <Input
            type="date"
            value={dateFrom}
            onChange={e => setDateFrom(e.target.value)}
            className="w-full md:w-[150px]"
            aria-label="تاريخ الفاتورة من"
            title="تاريخ الفاتورة من"
          />
          <span className="text-xs text-muted-foreground shrink-0">إلى</span>
          <Input
            type="date"
            value={dateTo}
            onChange={e => setDateTo(e.target.value)}
            className="w-full md:w-[150px]"
            aria-label="تاريخ الفاتورة إلى"
            title="تاريخ الفاتورة إلى"
          />
          {(dateFrom || dateTo) && (
            <button
              className="text-muted-foreground hover:text-destructive shrink-0"
              onClick={() => { setDateFrom(""); setDateTo(""); }}
              title="مسح فلتر التاريخ"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {selectedWarehouseId && lotsEnabled && <InventoryBooks layout="table" warehouseId={Number(selectedWarehouseId)} search={searchQuery} includeZero={!hideZeroStock} sort={sortBy} dateFrom={dateFrom} dateTo={dateTo}
        nodeIds={bookNodeIds}
        onFifo={isOwnerOrAdminRole(user?.role) && Number(user?.isActive) === 1 && lotsEnabled ? openBookDelivery : undefined}
        onPick={isWarehouse && lotsEnabled ? async ({lot,page,master}) => {
          setDeliverItem({...page, quantity:Number(page.quantity), itemName:master.nameAr || master.nameEn});
          setDeliverQty("");setDeliverToId("");setDeliverNotes("");setDeliverCostAllocations([createIssueCostAllocationDraft()]);
          setDeliverLotInfo(null); resolveDeliveryLotMut.mutate({inventoryId:page.id,trackingToken:lot.trackingToken});
        } : undefined} />}
      {filteredItems.length===0 && !isLoading ? null : isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <Card key={i}><CardContent className="p-4"><Skeleton className="h-20 w-full" /></CardContent></Card>)}
        </div>
      ) : !visibleWarehouseItems.length ? (
        <Card><CardContent className="p-12 text-center">
          <Package className="w-12 h-12 mx-auto text-muted-foreground/40 mb-4" />
          <h3 className="font-semibold text-lg mb-1">{t.common.noData}</h3>
        </CardContent></Card>
      ) : !categoryFilteredWarehouseItems.length ? (
        <Card><CardContent className="p-12 text-center">
          <Package className="w-12 h-12 mx-auto text-muted-foreground/40 mb-4" />
          <h3 className="font-semibold text-lg mb-1">لا توجد أصناف ضمن التصنيف المحدد في هذا المخزن</h3>
          <p className="text-sm text-muted-foreground">لا يوجد في هذا المخزن صنف مرتبط بالعقدة المختارة أو أحد فروعها.</p>
        </CardContent></Card>
      ) : !filteredItems.length ? (
        <Card><CardContent className="p-12 text-center">
          <Search className="w-12 h-12 mx-auto text-muted-foreground/40 mb-4" />
          <h3 className="font-semibold text-lg mb-1">لا توجد نتائج مطابقة</h3>
          <p className="text-sm text-muted-foreground">جرّب كلمة بحث أخرى</p>
        </CardContent></Card>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 text-xs text-muted-foreground">
                <th className="text-right font-medium px-3 py-2">الصنف</th>
                <th className="text-right font-medium px-3 py-2">التصنيف</th>
                <th className="text-right font-medium px-3 py-2">الكود</th>
                <th className="text-right font-medium px-3 py-2">الرصيد</th>
                <th className="text-right font-medium px-3 py-2">الوحدة</th>
                <th className="text-right font-medium px-3 py-2">آخر توريد</th>
                <th className="text-right font-medium px-3 py-2">آخر صرف</th>
                <th className="text-right font-medium px-3 py-2">آخر سعر شراء</th>
                <th className="text-right font-medium px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {pagedItems.map((item: any) => {
                const isLow = (item.minQuantity || 0) > 0 && item.quantity <= (item.minQuantity || 0);
                return (
                  <tr
                    key={item.id}
                    className="border-t hover:bg-muted/30 transition-colors cursor-pointer"
                    onClick={() => setSelectedItemId(item.id)}
                  >
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <div className="font-medium">{item.itemName}</div>
                        {lotsEnabled && Number((lotSummaryByInventoryId.get(Number(item.id)) as any)?.lotCount || 0) > 0 && (
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 rounded-md border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-[10px] font-medium text-violet-700 hover:bg-violet-100"
                            onClick={(e) => {
                              e.stopPropagation();
                              setLotDialogItem(item);
                            }}
                            title="عرض دفعات الصنف وإعادة طباعة QR"
                          >
                            <QrCode className="w-3.5 h-3.5" />
                            <span>{Number((lotSummaryByInventoryId.get(Number(item.id)) as any)?.lotCount || 0)}</span>
                          </button>
                        )}
                      </div>
                      {item.description && <div className="text-xs text-muted-foreground">{item.description}</div>}
                      {isLow && <Badge variant="destructive" className="text-[10px] gap-1 mt-1"><AlertTriangle className="w-3 h-3" /> {t.inventory.lowStock}</Badge>}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground max-w-[260px]">
                      {item.catalogCategoryPathAr ? (
                        <span title={item.catalogCategoryPathAr}>{item.catalogCategoryPathAr}</span>
                      ) : (
                        <Badge variant="outline" className="text-[10px] font-normal">غير مرتبط بالكتالوج</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground">{item.internalCode || item.manufacturerBarcode || "—"}</td>
                    <td className="px-3 py-2.5">
                      <span className={`font-bold ${isLow ? "text-destructive" : ""}`}>{item.quantity}</span>
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground">{item.unit || item.issueUnit || "—"}</td>
                    <td className="px-3 py-2.5 text-muted-foreground">
                      {item.invoiceDate ? new Date(item.invoiceDate).toLocaleDateString("ar-SA") : "—"}
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground">
                      {item.lastIssuedAt ? new Date(item.lastIssuedAt).toLocaleDateString("ar-SA") : "—"}
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground">
                      {item.lastPurchasePrice ? `${parseFloat(item.lastPurchasePrice).toLocaleString()} ر.س` : "—"}
                    </td>
                    <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-1 justify-end">
                        {item.manufacturerBarcode && (
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setPrintBarcode(item)} title="طباعة باركود">
                            <QrCode className="w-3.5 h-3.5" />
                          </Button>
                        )}
                        {isWarehouse && (
                          <>
                            {item.quantity > 0 && (
                              <Button variant="ghost" size="icon" className="h-7 w-7 text-blue-600 hover:text-blue-700" onClick={() => { setDeliverItem(item); setDeliverQty(""); setDeliverToId(""); setDeliverNotes(""); setDeliverLotInfo(null); setDeliverCostAllocations([createIssueCostAllocationDraft()]); setLotCodeSearch(""); }} title="تسليم للفني">
                                <Truck className="w-3.5 h-3.5" />
                              </Button>
                            )}
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(item)}><Pencil className="w-3.5 h-3.5" /></Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => openDelete(item)}><Trash2 className="w-3.5 h-3.5" /></Button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── أزرار التنقل بين الصفحات — 36 صنفاً في كل صفحة ── */}
      {filteredItems.length > 0 && totalPages > 1 && (
        <div className="flex items-center justify-between flex-wrap gap-3 pt-1">
          <p className="text-xs text-muted-foreground">
            عرض {(currentPageSafe - 1) * ITEMS_PER_PAGE + 1}
            {"–"}
            {Math.min(currentPageSafe * ITEMS_PER_PAGE, filteredItems.length)}
            {" من "}{filteredItems.length} صنفاً
          </p>
          <div className="flex items-center gap-1">
            <Button
              variant="outline" size="sm" className="gap-1 px-2"
              disabled={currentPageSafe <= 1}
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
            >
              <ChevronRight className="w-4 h-4" /> السابق
            </Button>
            <span className="text-xs text-muted-foreground px-2">
              صفحة {currentPageSafe} من {totalPages}
            </span>
            <Button
              variant="outline" size="sm" className="gap-1 px-2"
              disabled={currentPageSafe >= totalPages}
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
            >
              التالي <ChevronLeft className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}

      {/* 2B-8 — دفعات الصنف الموجودة في المستودع الحالي + إعادة طباعة QR */}
      <Dialog open={!!lotDialogItem} onOpenChange={(open) => { if (!open) setLotDialogItem(null); }}>
        <DialogContent className="max-w-2xl" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <QrCode className="w-5 h-5 text-violet-600" />
              دفعات الصنف — {lotDialogItem?.itemName}
            </DialogTitle>
            <DialogDescription>
              الدفعات ذات الرصيد الموجب في {selectedWarehouse?.nameAr || "المستودع الحالي"}. كل QR يعرّف Lot واحدًا مستقلًا.
            </DialogDescription>
          </DialogHeader>

          {lotsDialogLoading ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground gap-2">
              <Loader2 className="w-5 h-5 animate-spin" /> جاري تحميل الدفعات...
            </div>
          ) : !(selectedInventoryLots as any[]).length ? (
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              لا توجد دفعات برصيد موجب لهذا الصنف في المستودع الحالي.
            </div>
          ) : (
            <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
              {(selectedInventoryLots as any[]).map((lot: any) => (
                <div key={lot.lotId} className="rounded-lg border p-3 space-y-2 bg-muted/20">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div>
                      <div className="font-mono font-semibold text-sm" dir="ltr">{lot.lotCode}</div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {lot.sourceType === "opening_balance" ? "رصيد افتتاحي" : "دفعة استلام"}
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      onClick={() => setPrintLotQr({
                        lotId: lot.lotId,
                        lotCode: lot.lotCode,
                        trackingToken: lot.trackingToken,
                        itemName: lotDialogItem?.itemName || "",
                        quantity: Number(lot.originalQuantity || 0),
                        unit: lot.issueUnit || lot.purchaseUnit || lotDialogItem?.unit || undefined,
                        sourceType: lot.sourceType,
                        receiptNumber: lot.receiptNumber || undefined,
                      })}
                    >
                      <Printer className="w-3.5 h-3.5" /> عرض / طباعة QR
                    </Button>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
                    <div className="rounded bg-background p-2">
                      <div className="text-muted-foreground">الرصيد في هذا المستودع</div>
                      <div className="font-semibold mt-0.5">{lot.balanceQuantity} {lot.issueUnit || lot.purchaseUnit || lotDialogItem?.unit || ""}</div>
                    </div>
                    <div className="rounded bg-background p-2">
                      <div className="text-muted-foreground">الكمية الأصلية للدفعة</div>
                      <div className="font-semibold mt-0.5">{lot.originalQuantity}</div>
                    </div>
                    <div className="rounded bg-background p-2">
                      <div className="text-muted-foreground">المتبقي من الدفعة إجمالًا</div>
                      <div className="font-semibold mt-0.5">{lot.remainingQuantity}</div>
                    </div>
                  </div>

                  {lot.sourceType === "receipt" && (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <div><span className="font-medium text-foreground">المورد:</span> {lot.supplierName || "—"}</div>
                      <div><span className="font-medium text-foreground">الفاتورة:</span> {lot.invoiceNumber || "—"}</div>
                      <div><span className="font-medium text-foreground">الاستلام:</span> {lot.receiptNumber || "—"}</div>
                    </div>
                  )}

                  {(lot.batchNumber || lot.expiryDate) && (
                    <div className="flex gap-4 flex-wrap text-xs text-muted-foreground">
                      {lot.batchNumber && <div><span className="font-medium text-foreground">Batch:</span> {lot.batchNumber}</div>}
                      {lot.expiryDate && <div><span className="font-medium text-foreground">الصلاحية:</span> {new Date(lot.expiryDate).toLocaleDateString("ar-SA")}</div>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setLotDialogItem(null)}>إغلاق</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Inventory Item Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t.common.edit} - {selectedItem?.itemName}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2"><Label>{t.inventory.itemName} *</Label><Input value={editForm.itemName} onChange={e => setEditForm(f => ({ ...f, itemName: e.target.value }))} /></div>
            <div className="space-y-2"><Label>{t.common.description}</Label><Input value={editForm.description} onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))} /></div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-2"><Label>{t.inventory.currentStock}</Label><Input type="number" min={0} step={0.001} value={editForm.quantity} onChange={e => setEditForm(f => ({ ...f, quantity: parseFloat(e.target.value) || 0 }))} /></div>
              <div className="space-y-2"><Label>{t.inventory.unit}</Label><Input value={editForm.unit} onChange={e => setEditForm(f => ({ ...f, unit: e.target.value }))} /></div>
              <div className="space-y-2"><Label>{t.inventory.minStock}</Label><Input type="number" min={0} step={0.001} value={editForm.minQuantity} onChange={e => setEditForm(f => ({ ...f, minQuantity: parseFloat(e.target.value) || 0 }))} /></div>
            </div>
            <div className="space-y-2"><Label>{t.inventory.location}</Label><Input value={editForm.location} onChange={e => setEditForm(f => ({ ...f, location: e.target.value }))} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>{t.common.cancel}</Button>
            <Button onClick={() => { if (!editForm.itemName) { toast.error(t.inventory.itemName); return; } updateMut.mutate({ id: selectedItem.id, ...editForm }); }} disabled={updateMut.isPending}>
              {updateMut.isPending ? t.common.saving : t.common.save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── نافذة تسليم للفني ── */}
      <Dialog open={!!deliverItem} onOpenChange={(open) => { if (!open) { setDeliverItem(null); setDeliverLotInfo(null); setDeliverCostAllocations([createIssueCostAllocationDraft()]); setLotCodeSearch(""); } }}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Truck className="w-5 h-5 text-blue-600" />
              تسليم للفني
            </DialogTitle>
          </DialogHeader>
          {deliverItem && (
            <div className="space-y-4">
              <div className="bg-muted/50 rounded-lg p-3 space-y-1">
                <p className="font-semibold text-sm">{deliverItem.itemName}</p>
                <p className="text-xs text-muted-foreground">
                  الرصيد المتاح: <strong className="text-foreground">{deliverItem.quantity} {deliverItem.unit}</strong>
                </p>
              </div>

              {lotsEnabled && !deliverItem.bookFifo && (
                <div className="space-y-2 rounded-lg border border-blue-200 bg-blue-50/60 p-3">
                  <Label className="text-xs flex items-center gap-1">
                    <QrCode className="w-3.5 h-3.5" /> QR الدفعة *
                  </Label>
                  <BarcodeScanner
                    onScan={(code) => {
                      setDeliverLotInfo(null);
                      resolveDeliveryLotMut.mutate({ inventoryId: deliverItem.id, trackingToken: code });
                    }}
                    placeholder="امسح QR الدفعة التي ستُصرف منها الكمية..."
                  />

                  {/* بديل عن مسح الـQR: كتابة رقم اللوت البشري يدوياً (مثال: LOT-2026-00123) */}
                  <div className="flex items-center gap-2 pt-1">
                    <div className="flex-1 h-px bg-blue-200" />
                    <span className="text-[10px] text-muted-foreground">أو</span>
                    <div className="flex-1 h-px bg-blue-200" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">ابحث برقم اللوت</Label>
                    <div className="flex gap-1.5">
                      <Input
                        dir="ltr"
                        className="font-mono text-xs"
                        placeholder="مثال: LOT-2026-00123"
                        value={lotCodeSearch}
                        onChange={e => setLotCodeSearch(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === "Enter" && lotCodeSearch.trim()) {
                            setDeliverLotInfo(null);
                            resolveDeliveryLotMut.mutate({ inventoryId: deliverItem.id, trackingToken: lotCodeSearch.trim() });
                          }
                        }}
                      />
                      <Button
                        type="button" size="sm" variant="outline"
                        disabled={!lotCodeSearch.trim() || resolveDeliveryLotMut.isPending}
                        onClick={() => {
                          setDeliverLotInfo(null);
                          resolveDeliveryLotMut.mutate({ inventoryId: deliverItem.id, trackingToken: lotCodeSearch.trim() });
                        }}
                      >
                        <Search className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>

                  {resolveDeliveryLotMut.isPending && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> جاري التحقق من الدفعة...</p>
                  )}
                  {deliverLotInfo && (
                    <div className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded p-2">
                      <strong>{deliverLotInfo.lotCode}</strong> — المتاح في هذا المستودع: {deliverLotInfo.availableQuantity} {deliverItem.unit || "وحدة"}
                    </div>
                  )}
                </div>
              )}

              <div className="space-y-1.5">
                <Label className="text-xs">الكمية المُسلَّمة *</Label>
                <Input
                  type="number"
                  min={0.001}
                  step={0.5}
                  dir="ltr"
                  placeholder="0"
                  value={deliverQty}
                  onChange={e => setDeliverQty(e.target.value)}
                  className="font-mono"
                />
                {deliverQty && parseFloat(deliverQty) > deliverItem.quantity && (
                  <p className="text-xs text-destructive">الكمية أكبر من الرصيد المتاح</p>
                )}
              </div>

              {lotsEnabled && (deliverLotInfo || deliverItem.bookFifo) && (
                <IssueCostAllocationEditor
                  value={deliverCostAllocations}
                  onChange={setDeliverCostAllocations}
                  totalQuantity={Number(deliverQty) || 0}
                  lotUnitCost={deliverItem.bookFifo ? fifoUnitCost : Number(deliverLotInfo?.issueUnitCost || 0)}
                  unitLabel={deliverItem.unit || "وحدة"}
                />
              )}

              <div className="space-y-1.5">
                <Label className="text-xs">الفني المُسلَّم إليه</Label>
                <TechnicianCombobox
                  value={deliverToId}
                  onValueChange={setDeliverToId}
                  placeholder="اختر الفني..."
                  options={(allUsers as any[])
                    .filter((u: any) => ["technician", "supervisor", "maintenance_manager", "it_manager", "it_member"].includes(u.role))
                    .map((u: any) => ({ value: String(u.id), label: `${u.name} (${u.role})` }))}
                />
              </div>

              {/* ملاحظات — تظهر بعد اختيار الفني، كتابتها اختيارية */}
              {deliverToId && (
                <div className="space-y-1.5">
                  <Label className="text-xs">ملاحظات (اختياري)</Label>
                  <Textarea
                    value={deliverNotes}
                    onChange={e => setDeliverNotes(e.target.value)}
                    placeholder="أي ملاحظات إضافية على عملية التسليم..."
                    rows={2}
                  />
                </div>
              )}
            </div>
          )}
          {deliverItem && (
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDeliverItem(null); setDeliverLotInfo(null); setDeliverCostAllocations([createIssueCostAllocationDraft()]); setLotCodeSearch(""); }}>إلغاء</Button>
            <Button
              className="gap-1.5"
              disabled={deliverMut.isPending || bookDeliverMut.isPending || resolveDeliveryLotMut.isPending || (lotsEnabled && !deliverItem.bookFifo && !deliverLotInfo)}
              onClick={() => {
                const qty = parseFloat(deliverQty);
                if (!deliverQty || isNaN(qty) || qty <= 0) {
                  toast.error("يرجى إدخال كمية صحيحة أكبر من صفر");
                  return;
                }
                if (qty > (deliverItem.quantity || 0)) {
                  toast.error(`الكمية (${qty}) أكبر من الرصيد المتاح (${deliverItem.quantity})`);
                  return;
                }
                if (lotsEnabled && !deliverItem.bookFifo && !deliverLotInfo) {
                  toast.error("يجب مسح QR الدفعة قبل تأكيد الصرف");
                  return;
                }
                if (lotsEnabled && !deliverItem.bookFifo && qty > Number(deliverLotInfo?.availableQuantity || 0)) {
                  toast.error(`الكمية (${qty}) أكبر من رصيد الدفعة الممسوحة (${deliverLotInfo?.availableQuantity || 0})`);
                  return;
                }
                let costAllocations;
                try {
                  costAllocations = lotsEnabled
                    ? buildIssueCostAllocationPayload(deliverCostAllocations, qty)
                    : undefined;
                } catch (error: any) {
                  toast.error(error?.message || "تحقق من توزيع تكلفة الصرف");
                  return;
                }
                if (deliverItem.bookFifo) {
                  try { planBookFifo(fifoLots, qty, deliverItem.unit); } catch(error: any) { toast.error(error.message); return; }
                  bookDeliverMut.mutate({catalogItemId:deliverItem.linkedItemId,warehouseId:deliverItem.warehouseId,
                    operationKey:bookOperationKey.current!,deliveredToId:Number(deliverToId),deliveryQty:qty,deliveryUnit:deliverItem.unit,
                    costAllocations,notes:deliverNotes || undefined});
                  return;
                }
                deliverMut.mutate({
                  inventoryId:   deliverItem.id,
                  deliveredToId: Number(deliverToId),
                  deliveryQty:   qty,
                  deliveryUnit:  deliverItem.unit || "قطعة",
                  lotTrackingToken: lotsEnabled ? deliverLotInfo?.trackingToken : undefined,
                  costAllocations,
                  notes:         deliverNotes || undefined,
                });
              }}
            >
              {deliverMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Truck className="w-4 h-4" />}
              تأكيد التسليم
            </Button>
          </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      {/* طباعة الباركود — نفس ملصق WarehouseReceiveV2 (58×38مم) */}
      {printBarcode && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setPrintBarcode(null)}>
          <div className="bg-white rounded-xl p-6 max-w-xs w-full mx-4 print-hidden-wrapper" onClick={e => e.stopPropagation()}>
            <h2 className="font-bold text-center mb-4">طباعة باركود الصنف</h2>
            <div className="barcode-print-area flex justify-center">
              <div
                className="barcode-card"
                style={{
                  width: "56mm", height: "36mm",
                  display: "flex", flexDirection: "row",
                  alignItems: "center", justifyContent: "flex-start",
                  padding: "2px", gap: "4px",
                  background: "#fff", border: "1px solid #ccc", borderRadius: "4px",
                }}
              >
                <div style={{ flexShrink: 0 }}>
                  <BarcodeQRCanvas value={printBarcode.manufacturerBarcode} size={110} />
                </div>
                <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "flex-end", justifyContent: "center", overflow: "hidden", paddingRight: "2px", gap: "3px" }}>
                  <span style={{ fontFamily: "monospace", fontWeight: "bold", fontSize: "13px", color: "#000", textAlign: "right", direction: "ltr" }}>
                    {printBarcode.manufacturerBarcode}
                  </span>
                  <span style={{ fontSize: "10px", color: "#222", textAlign: "right", direction: "rtl", lineHeight: "1.3", wordBreak: "break-word", maxWidth: "100%" }}>
                    {printBarcode.itemName}
                  </span>
                </div>
              </div>
            </div>
            <div className="flex gap-2 mt-4 print-hidden">
              <button
                className="flex-1 bg-primary text-white py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-1"
                onClick={() => window.print()}
              >
                <Printer className="w-4 h-4" /> طباعة
              </button>
              <button className="flex-1 border py-2 rounded-lg text-sm" onClick={() => setPrintBarcode(null)}>
                إغلاق
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CSS طباعة الباركود — نفس مقاس الملصق 58×38مم */}
      {printBarcode && (
        <style>{`
          @media print {
            @page { size: 58mm 38mm; margin: 0; }
            html, body { height: 36mm !important; width: 58mm !important; overflow: hidden !important; }
            body * { visibility: hidden; }
            .barcode-print-area, .barcode-print-area * { visibility: visible; }
            .barcode-print-area {
              position: fixed !important; top: 0; left: 0; width: 100% !important; margin: 0 !important;
            }
            .print-hidden, .print-hidden-wrapper > h2 { display: none !important; }
            .print-hidden-wrapper { position: static !important; padding: 0 !important; box-shadow: none !important; }
            .barcode-card {
              width: 56mm !important; height: 36mm !important;
              page-break-inside: avoid;
            }
          }
        `}</style>
      )}

      {/* بطاقة الصنف الرسمية */}
      <InventoryItemCard
        itemId={selectedItemId}
        open={selectedItemId !== null}
        onOpenChange={(open) => !open && setSelectedItemId(null)}
      />

      {/* Delete Inventory Item Dialog */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle className="text-destructive">{t.common.confirmDelete}</DialogTitle>
            <DialogDescription>{t.common.deleteWarning} <strong>{selectedItem?.itemName}</strong>? {t.common.cannotUndo}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>{t.common.cancel}</Button>
            <Button variant="destructive" onClick={() => deleteMut.mutate({ id: selectedItem.id })} disabled={deleteMut.isPending}>
              {deleteMut.isPending ? t.common.deleting : t.common.delete}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── مكوّن QR Code حقيقي (نفس المستخدم في WarehouseReceiveV2) ──
function BarcodeQRCanvas({ value, size = 110 }: { value: string; size?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !value) return;
    QRCode.toCanvas(canvas, value, {
      width: size,
      margin: 1,
      color: { dark: "#000000", light: "#ffffff" },
    }).catch(console.error);
  }, [value, size]);
  return <canvas ref={canvasRef} width={size} height={size} />;
}
