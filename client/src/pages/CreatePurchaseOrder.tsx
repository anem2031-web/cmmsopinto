import { trpc } from "@/lib/trpc";
import { useLocation, useSearch, useRoute } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ArrowRight, Plus, Trash2, Loader2, ShoppingCart, Camera, Link2, Upload, BookOpen, FilePlus, Search, ChevronDown, ChevronRight, FolderOpen, Save } from "lucide-react";
import DropZone, { type UploadedFile } from "@/components/DropZone";
import { useState, useMemo, useRef, useEffect } from "react";
import { toast } from "sonner";
import { useTranslation } from "@/contexts/LanguageContext";
import { cn } from "@/lib/utils";

type ItemForm = {
  sourceType: "catalog" | "manual";

  itemName: string;
  description: string;

  quantity: number;
  unit: string;

  photoUrls: string[];
  notes: string;
};

const emptyItem = (): ItemForm => ({
  sourceType: "manual",

  itemName: "",
  description: "",

  quantity: 1,
  unit: "قطعة",

  photoUrls: [],
  notes: ""
});

// ── Catalog Item Picker Dialog ─────────────────────────────────────────────
interface CatalogNode {
  id: number;
  code: string | null;
  nameAr: string;
  nameEn: string;
  level: number;
  parentId: number | null;
}

function CatalogPickerDialog({
  open,
  onClose,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
onSelect: (item: {
  nameAr: string;
  nameEn: string;
  primaryImageUrl?: string;
  unit?: string;
}) => void;
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedNodeId, setSelectedNodeId] = useState<number | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const inputRef = useRef<HTMLInputElement>(null);

  // debounce: انتظر 350ms بعد توقف الكتابة ثم ابعث للسيرفر
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchQuery.trim()), 350);
    return () => clearTimeout(t);
  }, [searchQuery]);

  const { data: allNodes } = trpc.catalog.nodes.list.useQuery(
    { isActive: true },
    { enabled: open }
  );

  // جمع ID التصنيف المختار + كل أحفاده بشكل تكراري
  const getDescendantIds = (nodeId: number, nodes: CatalogNode[]): number[] => {
    const children = nodes.filter(n => n.parentId === nodeId);
    return [nodeId, ...children.flatMap(c => getDescendantIds(c.id, nodes))];
  };

  const selectedNodeIds = useMemo(() => {
    if (!selectedNodeId || !allNodes) return undefined;
    return getDescendantIds(selectedNodeId, allNodes);
  }, [selectedNodeId, allNodes]);

  // ✅ البحث على السيرفر — يجلب فقط ما يطابق البحث أو التصنيف المختار
  const { data: serverItems, isFetching } = trpc.catalog.items.list.useQuery(
    {
      isActive: true,
      limit: 80,
      search: debouncedSearch || undefined,
      nodeIds: selectedNodeIds,
    },
    { enabled: open }
  );

  // إعادة ضبط الحالة عند كل فتح للنافذة
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 100);
      setSearchQuery("");
      setDebouncedSearch("");
      setSelectedNodeId(null);
    }
  }, [open]);

  const roots = useMemo(
    () => (allNodes || []).filter((n: CatalogNode) => !n.parentId),
    [allNodes]
  );

  const getChildren = (parentId: number) =>
    (allNodes || []).filter((n: CatalogNode) => n.parentId === parentId);

  const toggle = (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const items = serverItems || [];

  const renderNode = (node: CatalogNode, depth = 0): React.ReactNode => {
    const children = getChildren(node.id);
    const hasChildren = children.length > 0;
    const isExpanded = expandedIds.has(node.id);
    const isSelected = selectedNodeId === node.id;

    return (
      <div key={node.id}>
        <div
          className={cn(
            "flex items-center gap-1.5 py-1.5 px-2 rounded cursor-pointer hover:bg-muted/60 transition-colors text-sm",
            isSelected && "bg-primary/10 text-primary font-medium"
          )}
          style={{ paddingRight: `${depth * 14 + 8}px` }}
          onClick={() => setSelectedNodeId(isSelected ? null : node.id)}
        >
          <button
            onClick={e => toggle(node.id, e)}
            className={cn("w-4 h-4 shrink-0 text-muted-foreground", !hasChildren && "invisible")}
          >
            {isExpanded
              ? <ChevronDown className="w-3.5 h-3.5" />
              : <ChevronRight className="w-3.5 h-3.5" />}
          </button>
          {node.code && (
            <span className="text-xs font-mono bg-muted px-1 py-0.5 rounded text-muted-foreground shrink-0">
              {node.code}
            </span>
          )}
          <span className="truncate">{node.nameAr}</span>
        </div>
        {isExpanded && hasChildren && (
          <div>{children.map(child => renderNode(child, depth + 1))}</div>
        )}
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="!max-w-none w-[42rem] max-h-[85vh] flex flex-col p-0 resize overflow-auto min-w-[320px] min-h-[300px]">
        <DialogHeader className="px-5 pt-5 pb-3 border-b">
          <DialogTitle className="flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-primary" />
            اختر صنفاً من الكاتلوج
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-1 overflow-hidden">

          {/* Sidebar — شجرة التصنيفات */}
          <div className="w-48 shrink-0 border-l overflow-y-auto p-2 bg-muted/20">
            <p className="text-xs text-muted-foreground px-2 pb-2 font-medium">التصنيفات</p>
            <button
              onClick={() => setSelectedNodeId(null)}
              className={cn(
                "w-full text-right text-sm px-2 py-1.5 rounded hover:bg-muted/60 transition-colors",
                !selectedNodeId && "bg-primary/10 text-primary font-medium"
              )}
            >
              الكل
            </button>
            {roots.map(node => renderNode(node))}
          </div>

          {/* Main — البحث والنتائج */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Search */}
            <div className="p-3 border-b">
              <div className="relative">
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  ref={inputRef}
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="ابحث بالاسم أو الكود..."
                  className="pr-9"
                  dir="rtl"
                />
              </div>
              <p className="text-xs text-muted-foreground mt-1.5 h-4">
                {isFetching
                  ? "جارٍ البحث..."
                  : items.length > 0
                    ? `${items.length} صنف${items.length === 80 ? " (الأحدث أولاً)" : ""}`
                    : ""}
              </p>
            </div>

            {/* Results */}
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {isFetching ? (
                <div className="text-center py-10 text-sm text-muted-foreground">
                  <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" />
                  جارٍ التحميل...
                </div>
              ) : items.length === 0 ? (
                <div className="text-center py-10 text-sm text-muted-foreground">
                  لا توجد نتائج
                </div>
              ) : (
                items.map((item: any) => (
                  <button
                    key={item.id}
                    onClick={() => {
                        onSelect({
                          nameAr: item.nameAr,
                          nameEn: item.nameEn,
                          primaryImageUrl: item.primaryImageUrl || "",
                          unit: item.unit || "",
                        });

                      onClose();
                    }}

                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-primary/5 hover:border-primary/20 border border-transparent transition-colors text-right"
                  >
                    {/* صورة */}
                    <div className="w-10 h-10 rounded-md bg-muted shrink-0 overflow-hidden flex items-center justify-center">
                      {item.primaryImageUrl ? (
                        <img src={item.primaryImageUrl} alt={item.nameAr} className="w-full h-full object-cover" />
                      ) : (
                        <FolderOpen className="w-4 h-4 text-muted-foreground/40" />
                      )}
                    </div>
                    {/* Info */}
                    <div className="flex-1 min-w-0 text-right">
                      <p className="text-sm font-medium truncate">{item.nameAr}</p>
                      <p className="text-xs text-muted-foreground truncate">{item.nameEn}</p>
                    </div>
                    {/* Code */}
                    {item.code && (
                      <span className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded text-muted-foreground shrink-0">
                        {item.code}
                      </span>
                    )}
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Add Item Choice Dialog ─────────────────────────────────────────────────
function AddItemChoiceDialog({
  open,
  onClose,
  onChooseCatalog,
  onChooseNew,
}: {
  open: boolean;
  onClose: () => void;
  onChooseCatalog: () => void;
  onChooseNew: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-center">إضافة صنف</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3 pt-2">
          <button
            onClick={() => { onClose(); onChooseCatalog(); }}
            className="flex flex-col items-center gap-3 p-5 rounded-xl border-2 border-primary/20 hover:border-primary hover:bg-primary/5 transition-all"
          >
            <div className="p-3 rounded-full bg-primary/10">
              <BookOpen className="w-6 h-6 text-primary" />
            </div>
            <div className="text-center">
              <p className="font-semibold text-sm">من الكاتلوج</p>
              <p className="text-xs text-muted-foreground mt-0.5">اختر من الأصناف المسجلة</p>
            </div>
          </button>
          <button
            onClick={() => { onClose(); onChooseNew(); }}
            className="flex flex-col items-center gap-3 p-5 rounded-xl border-2 border-muted hover:border-muted-foreground/40 hover:bg-muted/30 transition-all"
          >
            <div className="p-3 rounded-full bg-muted">
              <FilePlus className="w-6 h-6 text-muted-foreground" />
            </div>
            <div className="text-center">
              <p className="font-semibold text-sm">صنف جديد</p>
              <p className="text-xs text-muted-foreground mt-0.5">أدخل البيانات يدوياً</p>
            </div>
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────
export default function CreatePurchaseOrder() {
  const [, setLocation] = useLocation();
  const { t } = useTranslation();
  const searchStr = useSearch();
  const params = new URLSearchParams(searchStr);
  const ticketId = params.get("ticketId") ? parseInt(params.get("ticketId")!) : undefined;
  const fromIdeaId = params.get("fromIdeaId") ? parseInt(params.get("fromIdeaId")!) : undefined;
  const prefillNotes = params.get("prefillNotes") || "";
  const linkIdeaMut = trpc.improvementIdeas.linkToPurchaseOrder.useMutation();

  // قراءة draftId من الـ URL إذا كنا نعدّل مسودة
  const [matchEdit, editParams] = useRoute("/purchase-orders/edit-draft/:id");
  const draftId = matchEdit ? parseInt(editParams?.id || "0") : undefined;

  const { data: draftPO } = trpc.purchaseOrders.getById.useQuery(
    { id: draftId || 0 },
    { enabled: !!draftId }
  );

  const { data: ticket } = trpc.tickets.getById.useQuery(
    { id: ticketId || 0 },
    { enabled: !!ticketId }
  );

  // ✅ وحدات القياس من الكاتلوج — تُحدّث القائمة فور إضافة وحدة جديدة من تبويب الكاتلوج
  const { data: catalogUnits } = trpc.catalog.units.list.useQuery();

  const createMut = trpc.purchaseOrders.create.useMutation({
    onSuccess: (data) => {
      toast.success(`${t.purchaseOrders.createNew} ${data.poNumber}`);
      if (fromIdeaId) {
        linkIdeaMut.mutate({ id: fromIdeaId, purchaseOrderId: data.id! });
      }
      setLocation(`/purchase-orders/${data.id}`);
    },
    onError: (err) => toast.error(err.message),
  });

  const saveDraftMut = trpc.purchaseOrders.saveDraft.useMutation({
    onSuccess: (data) => {
      toast.success(`تم حفظ المسودة ${data.poNumber}`);
      setLocation(`/purchase-orders/${data.id}`);
    },
    onError: (err) => toast.error(err.message),
  });

  const updateDraftMut = trpc.purchaseOrders.updateDraft.useMutation({
    onSuccess: () => {
      toast.success("تم حفظ التعديلات");
      setLocation(`/purchase-orders/${draftId}`);
    },
    onError: (err) => toast.error(err.message),
  });

  const [draftLoaded, setDraftLoaded] = useState(false);
  const [items, setItems] = useState<ItemForm[]>([emptyItem()]);

  // تحميل أصناف المسودة عند فتح صفحة التعديل
  useEffect(() => {
    if (draftPO && !draftLoaded) {
      setNotes(draftPO.notes || "");
      if (draftPO.items && draftPO.items.length > 0) {
        setItems(draftPO.items.map((i: any) => ({
          sourceType: "manual" as const,
          itemName: i.itemName || "",
          description: i.description || "",
          quantity: i.quantity || 1,
          unit: i.unit || "قطعة",
          photoUrls: i.photoUrls || (i.photoUrl ? [i.photoUrl] : []),
          notes: i.notes || "",
          _existingId: i.id, // نحفظ id الصنف الأصلي
        })));
      }
      setDraftLoaded(true);
    }
  }, [draftPO, draftLoaded]);
  const [notes, setNotes] = useState(prefillNotes);
  const [uploadingIdx, setUploadingIdx] = useState<number | null>(null);
  const [showDropZoneIdx, setShowDropZoneIdx] = useState<number | null>(null);

  // ── Dialog States ──────────────────────────────────────────
  const [showChoiceDialog, setShowChoiceDialog] = useState(true);
  const [showCatalogPicker, setShowCatalogPicker] = useState(false);
  const [catalogTargetIndex, setCatalogTargetIndex] = useState<number | null>(null);

  const updateItem = (idx: number, field: keyof ItemForm, value: any) => {
    setItems(prev => prev.map((item, i) => i === idx ? { ...item, [field]: value } : item));
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
        toast.error("الحد الأقصى 4 صور");
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

            itemName: catalogItem.nameAr || "",
            description: catalogItem.nameEn || "",
            // ✅ سحب وحدة الصنف من الكاتلوج تلقائياً — "قطعة" كافتراضي إذا لم تكن محددة
            unit: catalogItem.unit?.trim() || "قطعة",

            photoUrls: catalogItem.primaryImageUrl ? [catalogItem.primaryImageUrl] : [],
          }
        : item
    )
  );
};

  const buildItemsPayload = () =>
    items.filter(i => i.itemName.trim()).map(i => ({
      itemName:    i.itemName,
      description: i.description || undefined,
      quantity:    i.quantity,
      unit:        i.unit || undefined,
      photoUrl:    i.photoUrls?.[0] || undefined,
      photoUrls:   i.photoUrls?.length ? i.photoUrls : undefined,
      notes:       i.notes || undefined,
    }));

  const handleUpdateDraft = () => {
    const validItems = buildItemsPayload();
    if (validItems.length === 0) { toast.error(t.purchaseOrders.items); return; }
    updateDraftMut.mutate({
      id: draftId!,
      notes: notes || undefined,
      items: (items as any[]).map(i => ({
        id: i._existingId || undefined,
        itemName: i.itemName,
        description: i.description || undefined,
        quantity: i.quantity,
        unit: i.unit || undefined,
        photoUrl: i.photoUrls?.[0] || undefined,
        photoUrls: i.photoUrls?.length ? i.photoUrls : undefined,
        notes: i.notes || undefined,
      })),
    });
  };

  const handleSaveDraft = () => {
    const validItems = buildItemsPayload();
    if (validItems.length === 0) { toast.error(t.purchaseOrders.items); return; }
    saveDraftMut.mutate({ ticketId, notes: notes || undefined, items: validItems });
  };

  const handleSubmit = () => {
    const validItems = items.filter(i => i.itemName.trim());
    if (validItems.length === 0) { toast.error(t.purchaseOrders.items); return; }
    createMut.mutate({
      ticketId,
      notes: notes || undefined,
      items: buildItemsPayload(),
    });
  };

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => setLocation(ticketId ? `/tickets/${ticketId}` : "/purchase-orders")}>
          <ArrowRight className="w-5 h-5" />
        </Button>
        <div>
          <h1 className="text-xl font-bold">{draftId ? `تعديل مسودة ${draftPO?.poNumber || ""}` : t.purchaseOrders.createNew}</h1>
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
            <Button variant="ghost" size="sm" className="mr-auto text-xs" onClick={() => setLocation(`/tickets/${ticketId}`)}>
              {t.common.back}
            </Button>
          </CardContent>
        </Card>
      )}

{items.map((item, idx) => (
  <Card key={idx}>
    <CardHeader className="pb-3">
      <div className="flex items-center justify-between">
        <CardTitle className="text-sm">
          {t.purchaseOrders.itemName} #{idx + 1}
        </CardTitle>

        {items.length > 1 && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-destructive hover:text-destructive"
            onClick={() =>
              setItems(prev => prev.filter((_, i) => i !== idx))
            }
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
          onChange={(e) => {
            const value = e.target.value as "catalog" | "manual";

            updateItem(idx, "sourceType", value);

            if (value === "catalog") {
              setCatalogTargetIndex(idx);
              setShowCatalogPicker(true);
            }
          }}
          className="w-full h-10 rounded-md border bg-background px-3 text-sm"
        >
          <option value="manual">{t.purchaseOrders.itemSourceManual}</option>
          <option value="catalog">{t.purchaseOrders.itemSourceCatalog}</option>
        </select>
      </div>

      {/* اسم الصنف */}
      <div className="space-y-2">
        <Label>{t.purchaseOrders.itemName} *</Label>

        <Textarea
          dir="auto"
          value={item.itemName}
          readOnly={item.sourceType === "catalog"}
          maxLength={300}
          rows={2}
          onClick={() => {
            if (item.sourceType === "catalog") {
              setCatalogTargetIndex(idx);
              setShowCatalogPicker(true);
            }
          }}
          onChange={e =>
            updateItem(idx, "itemName", e.target.value.slice(0, 300))
          }
        />
        <p className="text-[11px] text-muted-foreground text-left">
          {item.itemName.length} / 300
        </p>
      </div>

      {/* الوصف */}
      <div className="space-y-2">
        <Label>{t.tickets.description}</Label>

        <Textarea
          dir="auto"
          value={item.description}
          maxLength={1500}
          onChange={e =>
            updateItem(idx, "description", e.target.value.slice(0, 1500))
          }
          rows={2}
        />
        <p className="text-[11px] text-muted-foreground text-left">
          {item.description.length} / 1500
        </p>
      </div>

      {/* الكمية والوحدة والصورة */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">

        {/* الكمية */}
        <div className="space-y-2">
          <Label>{t.purchaseOrders.quantity} *</Label>

          <Input
            type="number"
            min={1}
            value={item.quantity}
            onChange={e =>
              updateItem(
                idx,
                "quantity",
                parseInt(e.target.value) || 1
              )
            }
          />
        </div>

        {/* الوحدة */}
        <div className="space-y-2">
          <Label>{t.purchaseOrders.unit}</Label>

          <Select
            value={item.unit}
            onValueChange={value => updateItem(idx, "unit", value)}
          >
            <SelectTrigger dir="auto">
              <SelectValue placeholder={t.purchaseOrders.unit} />
            </SelectTrigger>
            <SelectContent>
              {(catalogUnits || []).map((u: any) => (
                <SelectItem key={u.id} value={u.nameAr}>
                  {u.nameAr}
                </SelectItem>
              ))}
              {/* في حال القيمة الحالية غير موجودة ضمن وحدات الكاتلوج (بيانات قديمة) */}
              {item.unit && !(catalogUnits || []).some((u: any) => u.nameAr === item.unit) && (
                <SelectItem value={item.unit}>{item.unit}</SelectItem>
              )}
            </SelectContent>
          </Select>
        </div>

{/* الصور — حتى 4 */}
<div className="space-y-2">
  <Label>
    {t.tickets.photos}
    <span className="text-xs text-muted-foreground mr-2">
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
        label="اسحب صور الصنف"
        sublabel={`حتى ${4 - (item.photoUrls || []).length} صور`}
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
          title="سحب وإفلات"
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
        <p className="text-[11px] text-muted-foreground text-left">
          {item.notes.length} / 200
        </p>
      </div>

    </CardContent>
  </Card>
))}

{/* زر إضافة صنف */}
<Button
  variant="outline"
  onClick={() => setItems(prev => [...prev, emptyItem()])}
  className="w-full gap-2 border-dashed h-12"
>
  <Plus className="w-4 h-4" /> {t.common.add}
</Button>

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
                disabled={updateDraftMut.isPending}
                className="w-full gap-2"
                size="lg"
              >
                {updateDraftMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                حفظ التعديلات
              </Button>
            ) : (
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={handleSaveDraft}
                disabled={saveDraftMut.isPending || createMut.isPending}
                className="flex-1 gap-2"
                size="lg"
              >
                {saveDraftMut.isPending
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <BookOpen className="w-4 h-4" />}
                حفظ كمسودة
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={createMut.isPending || saveDraftMut.isPending}
                className="flex-1 gap-2"
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

      {/* Dialog اختيار طريقة الإضافة */}

      {/* Dialog الكاتلوج */}
      <CatalogPickerDialog
        open={showCatalogPicker}
        onClose={() => setShowCatalogPicker(false)}
        onSelect={handleCatalogSelect}
      />
    </div>
  );
}
