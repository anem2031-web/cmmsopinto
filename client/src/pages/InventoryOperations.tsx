import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import BarcodeScanner from "@/components/BarcodeScanner";
import {
  Trash2, Plus, Search, QrCode, Package, AlertTriangle,
  Loader2, X, ChevronRight, ClipboardList, BookOpen, Printer
} from "lucide-react";
import { useState, useEffect } from "react";
import { toast } from "sonner";

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

function fmtDate(d: any) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("ar-SA");
}
function fmtMoney(v: any) {
  if (!v) return "0 ر.س";
  return `${parseFloat(String(v)).toLocaleString()} ر.س`;
}

// ── بطاقة صنف مضاف للعملية ──
function DisposalItemCard({ item, onRemove }: { item: any; onRemove: () => void }) {
  return (
    <div className="flex items-center gap-3 p-3 rounded-lg border bg-muted/30">
      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm truncate">{item.itemName}</p>
        <div className="flex gap-3 text-xs text-muted-foreground mt-0.5">
          <span>الكمية: <strong className="text-foreground">{item.quantity} {item.unit}</strong></span>
          <span>السبب: <strong className="text-foreground">{REASON_LABELS[item.reason]}</strong></span>
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
  const isWarehouse = ["warehouse", "admin", "owner"].includes(user?.role || "");

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

  // ══════════════════════════════════════════════════════════
  // وحدة الجرد وتسوية المخزون
  // ══════════════════════════════════════════════════════════
  const { data: countOperations, refetch: refetchCounts } = trpc.inventoryCount.listOperations.useQuery();
  const [activeCountId, setActiveCountId] = useState<number | null>(null);
  const { data: countDetail, refetch: refetchCountDetail } = trpc.inventoryCount.operationDetails.useQuery(
    { operationId: activeCountId! }, { enabled: !!activeCountId }
  );
  const [showUncountedOnly, setShowUncountedOnly] = useState(false);

  // ── لوحة إضافة/مسح صنف داخل جرد جزئي جارٍ (باركود/رقم/اختيار) ──
  const [scanMode, setScanMode] = useState<"name" | "code" | "qr">("qr");
  const [scanQuery, setScanQuery] = useState("");
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
    onError: (e: any) => toast.error(e.message),
  });
  function handleScanResolved(code: string) {
    const found = ((inventoryList as any[]) || []).find((i: any) =>
      i.internalCode === code || i.manufacturerBarcode === code || String(i.id) === code
    );
    if (!found) { toast.error(`لم يتم العثور على صنف برقم: ${code}`); return; }
    if (!activeCountId) return;
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
  const { data: catalogUnits } = trpc.catalog.units.list.useQuery();
  const addNewItemMut = trpc.inventoryCount.addNewItem.useMutation({
    onSuccess: (data) => {
      toast.success(`تم إضافة "${data.itemName}" للمخزون — كود الصنف ${data.internalCode} / باركود ${data.manufacturerBarcode}`);
      refetchCountDetail();
      setShowNewItem(false);
      setNewItemName("");
      setNewItemUnit("");
      setNewItemQty("");
      setNewItemCost("");
    },
    onError: (e: any) => toast.error(e.message),
  });
  function submitNewItem() {
    if (!activeCountId) return;
    addNewItemMut.mutate({
      operationId: activeCountId,
      itemName: newItemName.trim(),
      unit: newItemUnit,
      quantity: parseFloat(newItemQty || "0"),
      cost: newItemCost.trim() !== "" ? parseFloat(newItemCost) : undefined,
    });
  }

  // ── بدء جرد جديد ──
  const [showNewCount, setShowNewCount] = useState(false);
  const [countScope, setCountScope] = useState<"full" | "partial">("full");
  const [countUiMode, setCountUiMode] = useState<"auto" | "manual">("auto"); // auto = تحميل كل الأصناف دفعة، manual = بالباركود/الرقم/الاختيار تباعاً
  const [countTitle, setCountTitle] = useState("");

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
      toast.success("تم تسجيل الكمية");
      refetchCountDetail();
      setEditingItem(null);
    },
    onError: (e: any) => toast.error(e.message),
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
  const [settlementSearchMode, setSettlementSearchMode] = useState<"name" | "code" | "qr">("name");

  // مسح باركود/QR مباشر لإضافة صنف للتسوية المستقلة
  function handleSettlementScanResolved(code: string) {
    const found = ((inventoryList as any[]) || []).find((i: any) =>
      i.internalCode === code || i.manufacturerBarcode === code || String(i.id) === code
    );
    if (!found) { toast.error(`لم يتم العثور على صنف برقم: ${code}`); return; }
    if (settlementItems.some(s => s.inventoryId === found.id)) { toast.error("الصنف مضاف بالفعل للتسوية"); return; }
    setSettlementItems(prev => [...prev, { inventoryId: found.id, afterQuantity: found.quantity, itemName: found.itemName }]);
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
    onSuccess: (data) => {
      toast.success(`تم تطبيق التسوية ${data.settlementNumber} بنجاح`);
      setShowSettlement(false);
      setSettlementItems([]);
      setSettlementReason("");
      setSettlementSourceCountId(null);
      refetchCounts();
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
  function printCountDocument(data: { operation: any; items: any[] }) {
    const op = data.operation;
    const itemsRows = (data.items || []).map((it: any) => {
      const diff = it.diffQuantity !== null && it.diffQuantity !== undefined ? parseFloat(it.diffQuantity) : null;
      const diffCell = diff === null
        ? `<span style="color:#999">لم يُعدّ بعد</span>`
        : diff === 0
          ? `<span style="color:#059669;font-weight:700">مطابق</span>`
          : `<span style="color:${diff > 0 ? "#2563eb" : "#dc2626"};font-weight:700">${diff > 0 ? `+${diff}` : diff}</span>`;
      return `
      <tr>
        <td>${it.itemName}</td>
        <td style="text-align:center;font-family:monospace">${parseFloat(it.systemQuantity).toLocaleString()} ${it.unit || ""}</td>
        <td style="text-align:center;font-family:monospace">${it.countedQuantity !== null && it.countedQuantity !== undefined ? parseFloat(it.countedQuantity).toLocaleString() + " " + (it.unit || "") : "—"}</td>
        <td style="text-align:center">${diffCell}</td>
        <td style="text-align:center;font-size:11px">${it.lotNumber || "—"}${it.expiryDate ? ` / ${fmtDate(it.expiryDate)}` : ""}</td>
        <td style="font-size:11px;color:#555">${it.notes || "—"}</td>
      </tr>`;
    }).join("");

    const countedItems = (data.items || []).filter((it: any) => it.countedQuantity !== null && it.countedQuantity !== undefined);
    const discrepancies = countedItems.filter((it: any) => parseFloat(it.diffQuantity || "0") !== 0);
    const isFinal = op.status === "completed";
    const themeColor = "#0f766e"; // teal — يميّز وثيقة الجرد عن وثيقة الاستبعاد (أحمر)

    const html = `<!DOCTYPE html><html dir="rtl" lang="ar"><head>
<meta charset="UTF-8"/><title>وثيقة جرد ${op.operationNumber}</title>
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;900&display=swap" rel="stylesheet"/>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Cairo',Arial,sans-serif;background:#fff;color:#1a1a1a;padding:32px 40px;font-size:13px}
.header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid ${themeColor};padding-bottom:16px;margin-bottom:20px}
.header-title{font-size:22px;font-weight:900;color:${themeColor}}
.header-sub{font-size:11px;color:#666;margin-top:4px}
.header-meta{text-align:left;font-size:11px;color:#555;line-height:2.2}
.badge{display:inline-block;background:${themeColor};color:#fff;padding:4px 14px;border-radius:6px;font-size:14px;font-weight:700}
.status-badge{display:inline-block;padding:3px 10px;border-radius:5px;font-size:11px;font-weight:700;margin-right:6px}
.info-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px}
.info-box{border:1px solid #e5e7eb;border-radius:8px;padding:10px 14px;background:#fafafa}
.info-label{font-size:10px;color:#888;margin-bottom:3px}
.info-value{font-size:13px;font-weight:700;color:#111}
.section-title{font-size:12px;font-weight:700;color:${themeColor};background:#f0fdfa;padding:6px 12px;border-radius:6px;margin-bottom:12px;border-right:4px solid ${themeColor}}
table{width:100%;border-collapse:collapse;margin-bottom:16px;font-size:12px}
thead tr{background:${themeColor};color:#fff}
thead th{padding:8px 10px;text-align:right;font-weight:600}
tbody tr:nth-child(even){background:#f0fdfa}
tbody tr:nth-child(odd){background:#fff}
tbody td{padding:8px 10px;border-bottom:1px solid #f3f4f6}
.totals-row{background:#1a1a1a!important;color:#fff!important;font-weight:700}
.totals-row td{padding:10px;border:none!important;color:#fff}
.sig-section{margin-top:36px;display:grid;grid-template-columns:1fr 1fr;gap:40px}
.sig-box{border-top:2px solid ${themeColor};padding-top:10px;text-align:center;font-size:11px;color:#555}
.sig-name{font-size:14px;font-weight:700;color:#1a1a1a;margin-top:4px}
.footer{margin-top:24px;border-top:1px solid #e5e7eb;padding-top:10px;display:flex;justify-content:space-between;font-size:10px;color:#aaa}
@media print{@page{margin:12mm}body{padding:0}}
</style></head><body>
<div class="header">
  <div>
    <div class="header-title">📋 وثيقة جرد مخزون</div>
    <div class="header-sub">نظام إدارة الصيانة المتكامل — CMMS</div>
  </div>
  <div class="header-meta">
    <div>التاريخ: <strong>${new Date(op.operationDate).toLocaleDateString("ar-SA",{year:"numeric",month:"long",day:"numeric"})}</strong> — اليوم: <strong>${op.riyadhDayName || "—"}</strong></div>
    <div>وقت البدء: <strong>${op.riyadhStartTime || "—"}</strong> (بتوقيت الرياض)</div>
    <div><span class="badge">${op.operationNumber}</span></div>
  </div>
</div>
<div class="info-grid">
  <div class="info-box"><div class="info-label">نطاق الجرد</div><div class="info-value">${op.scope === "full" ? "شامل" : "جزئي"}</div></div>
  <div class="info-box"><div class="info-label">المنفذ</div><div class="info-value">${op.creatorName || "—"}</div></div>
  <div class="info-box"><div class="info-label">عدد الأصناف المعدودة</div><div class="info-value">${countedItems.length} من ${data.items?.length || 0}</div></div>
  <div class="info-box"><div class="info-label">الحالة</div><div class="info-value"><span class="status-badge" style="background:${isFinal ? "#dcfce7" : "#fef3c7"};color:${isFinal ? "#166534" : "#92400e"}">${isFinal ? "✅ نهائي (مقفل)" : "مسودة"}</span></div></div>
</div>
<div class="section-title">تفاصيل الأصناف</div>
<table>
  <thead><tr>
    <th>اسم الصنف</th>
    <th style="text-align:center">كمية النظام</th>
    <th style="text-align:center">الكمية المعدودة</th>
    <th style="text-align:center">الفرق</th>
    <th style="text-align:center">دفعة/صلاحية</th>
    <th>ملاحظة</th>
  </tr></thead>
  <tbody>
    ${itemsRows}
    <tr class="totals-row">
      <td>الإجمالي</td>
      <td style="text-align:center">${data.items?.length || 0} صنف</td>
      <td style="text-align:center">${countedItems.length} معدود</td>
      <td style="text-align:center">${discrepancies.length} فرق</td>
      <td></td><td></td>
    </tr>
  </tbody>
</table>
<div class="sig-section">
  <div class="sig-box"><div>توقيع المنفذ</div><div class="sig-name">${op.creatorName || "—"}</div></div>
  <div class="sig-box"><div>اعتماد المسؤول</div><div class="sig-name">&nbsp;</div></div>
</div>
<div class="footer">
  <span>وثيقة آلية — نظام CMMS | ${op.operationNumber}</span>
  <span>تاريخ الطباعة: ${new Date().toLocaleDateString("ar-SA")}</span>
</div>
<script>window.onload=()=>{window.print();window.onafterprint=()=>window.close();}<\/script>
</body></html>`;
    const win = window.open("", "_blank", "width=900,height=800");
    if (win) { win.document.write(html); win.document.close(); }
  }

  // ── طباعة وثيقة تسوية مخزون رسمية ──────────────────────────────────────────
  function printSettlementDocument(data: { settlement: any; items: any[] }) {
    const s = data.settlement;
    const itemsRows = (data.items || []).map((it: any) => {
      const diff = parseFloat(it.diffQuantity || "0");
      const diffCell = diff === 0
        ? `<span style="color:#059669;font-weight:700">لا يوجد فرق</span>`
        : `<span style="color:${diff > 0 ? "#2563eb" : "#dc2626"};font-weight:700">${diff > 0 ? `+${diff}` : diff}</span>`;
      return `
      <tr>
        <td>${it.itemName}</td>
        <td style="text-align:center;font-family:monospace">${parseFloat(it.beforeQuantity).toLocaleString()} ${it.unit || ""}</td>
        <td style="text-align:center;font-family:monospace">${parseFloat(it.afterQuantity).toLocaleString()} ${it.unit || ""}</td>
        <td style="text-align:center">${diffCell}</td>
        <td style="text-align:center;font-size:11px">${it.lotNumber || "—"}${it.expiryDate ? ` / ${fmtDate(it.expiryDate)}` : ""}</td>
      </tr>`;
    }).join("");
    const themeColor = "#7e22ce"; // بنفسجي — يميّز وثيقة التسوية

    const html = `<!DOCTYPE html><html dir="rtl" lang="ar"><head>
<meta charset="UTF-8"/><title>وثيقة تسوية ${s.settlementNumber}</title>
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;900&display=swap" rel="stylesheet"/>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Cairo',Arial,sans-serif;background:#fff;color:#1a1a1a;padding:32px 40px;font-size:13px}
.header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid ${themeColor};padding-bottom:16px;margin-bottom:20px}
.header-title{font-size:22px;font-weight:900;color:${themeColor}}
.header-sub{font-size:11px;color:#666;margin-top:4px}
.header-meta{text-align:left;font-size:11px;color:#555;line-height:2.2}
.badge{display:inline-block;background:${themeColor};color:#fff;padding:4px 14px;border-radius:6px;font-size:14px;font-weight:700}
.info-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:16px}
.info-box{border:1px solid #e5e7eb;border-radius:8px;padding:10px 14px;background:#fafafa}
.info-label{font-size:10px;color:#888;margin-bottom:3px}
.info-value{font-size:13px;font-weight:700;color:#111}
.section-title{font-size:12px;font-weight:700;color:${themeColor};background:#faf5ff;padding:6px 12px;border-radius:6px;margin-bottom:12px;border-right:4px solid ${themeColor}}
.notes-box{border:1px solid #e5e7eb;border-radius:6px;padding:10px 14px;background:#fffbf0;font-size:12px;margin-bottom:16px}
table{width:100%;border-collapse:collapse;margin-bottom:16px;font-size:12px}
thead tr{background:${themeColor};color:#fff}
thead th{padding:8px 10px;text-align:right;font-weight:600}
tbody tr:nth-child(even){background:#faf5ff}
tbody tr:nth-child(odd){background:#fff}
tbody td{padding:8px 10px;border-bottom:1px solid #f3f4f6}
.sig-section{margin-top:36px;display:grid;grid-template-columns:1fr 1fr;gap:40px}
.sig-box{border-top:2px solid ${themeColor};padding-top:10px;text-align:center;font-size:11px;color:#555}
.sig-name{font-size:14px;font-weight:700;color:#1a1a1a;margin-top:4px}
.footer{margin-top:24px;border-top:1px solid #e5e7eb;padding-top:10px;display:flex;justify-content:space-between;font-size:10px;color:#aaa}
@media print{@page{margin:12mm}body{padding:0}}
</style></head><body>
<div class="header">
  <div>
    <div class="header-title">🧾 وثيقة تسوية مخزون</div>
    <div class="header-sub">نظام إدارة الصيانة المتكامل — CMMS</div>
  </div>
  <div class="header-meta">
    <div>التاريخ: <strong>${new Date(s.appliedAt).toLocaleDateString("ar-SA",{year:"numeric",month:"long",day:"numeric"})}</strong></div>
    <div>وقت الإصدار: <strong>${new Date().toLocaleTimeString("ar-SA")}</strong></div>
    <div><span class="badge">${s.settlementNumber}</span></div>
  </div>
</div>
<div class="info-grid">
  <div class="info-box"><div class="info-label">المصدر</div><div class="info-value">${s.sourceType === "from_count" ? "من عملية جرد" : "تسوية مستقلة"}</div></div>
  <div class="info-box"><div class="info-label">المسؤول</div><div class="info-value">${s.appliedByName || "—"}</div></div>
  <div class="info-box"><div class="info-label">عدد الأصناف</div><div class="info-value">${data.items?.length || 0} صنف</div></div>
</div>
<div class="notes-box">📝 <strong>سبب التسوية:</strong> ${s.reason}</div>
<div class="section-title">تفاصيل الأصناف المسوّاة</div>
<table>
  <thead><tr>
    <th>اسم الصنف</th>
    <th style="text-align:center">الكمية قبل</th>
    <th style="text-align:center">الكمية بعد</th>
    <th style="text-align:center">الفرق</th>
    <th style="text-align:center">دفعة/صلاحية</th>
  </tr></thead>
  <tbody>${itemsRows}</tbody>
</table>
<div class="sig-section">
  <div class="sig-box"><div>توقيع المنفذ</div><div class="sig-name">${s.appliedByName || "—"}</div></div>
  <div class="sig-box"><div>اعتماد المسؤول</div><div class="sig-name">&nbsp;</div></div>
</div>
<div class="footer">
  <span>وثيقة آلية — نظام CMMS | ${s.settlementNumber}</span>
  <span>تاريخ الطباعة: ${new Date().toLocaleDateString("ar-SA")}</span>
</div>
<script>window.onload=()=>{window.print();window.onafterprint=()=>window.close();}<\/script>
</body></html>`;
    const win = window.open("", "_blank", "width=900,height=800");
    if (win) { win.document.write(html); win.document.close(); }
  }

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
    setFoundItem(item);
    setSearchQuery("");
    setQty(String(item.quantity));
    setSearchMode("name"); // رجوع لوضع البحث الافتراضي
  }

  // معالج مسح QR — يبحث عن الصنف برقمه أو باركوده تلقائياً
  function handleQRScan(code: string) {
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
    if (!foundItem) { toast.error("اختر صنفاً أولاً"); return; }
    if (!qty || parseFloat(qty) <= 0) { toast.error("أدخل كمية صحيحة"); return; }
    if (parseFloat(qty) > foundItem.quantity) { toast.error(`الكمية أكبر من الرصيد (${foundItem.quantity})`); return; }
    if (!reason) { toast.error("اختر سبب الاستبعاد"); return; }

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
      notes:       itemNotes || undefined,
    }]);

    setFoundItem(null);
    setQty("");
    setReason("");
    setItemNotes("");
    setSearchQuery("");
    setSearchMode("name");
    toast.success("تم إضافة الصنف — يمكنك إضافة صنف آخر أو حفظ العملية");
  }

  function resetNew() {
    setShowNew(false);
    setSearchQuery("");
    setFoundItem(null);
    setDisposalItems([]);
    setOperationNotes("");
    setQty("");
    setReason("");
    setItemNotes("");
    setOperationDate(new Date().toISOString().split("T")[0]);
  }

  function submitDisposal() {
    if (disposalItems.length === 0) { toast.error("أضف صنفاً واحداً على الأقل"); return; }
    createMut.mutate({
      operationDate,
      notes: operationNotes || undefined,
      items: disposalItems,
    });
  }

  // ── طباعة وثيقة الاستبعاد ──────────────────────────────────
  function printDisposalDocument(op: any) {
    const REASON_AR: Record<string, string> = {
      damaged: "تالف", expired: "منتهي الصلاحية", missing: "مفقود", other: "أخرى"
    };
    const itemsRows = (op.items || []).map((item: any) => `
      <tr>
        <td>${item.itemName}</td>
        <td style="text-align:center">${parseFloat(item.quantity).toLocaleString()} ${item.unit || ""}</td>
        <td style="text-align:center">${REASON_AR[item.reason] || item.reason}</td>
        <td style="text-align:left;font-family:monospace">${parseFloat(item.unitCost || 0) > 0 ? parseFloat(item.unitCost).toLocaleString() + " ر.س" : "—"}</td>
        <td style="text-align:left;font-family:monospace;font-weight:700">${parseFloat(item.totalCost || 0) > 0 ? parseFloat(item.totalCost).toLocaleString() + " ر.س" : "—"}</td>
      </tr>`).join("");
    const totalValue = (op.items || []).reduce((s: number, i: any) => s + parseFloat(i.totalCost || 0), 0);
    const totalQty   = (op.items || []).reduce((s: number, i: any) => s + parseFloat(i.quantity || 0), 0);
    const html = `<!DOCTYPE html><html dir="rtl" lang="ar"><head>
<meta charset="UTF-8"/><title>وثيقة استبعاد ${op.operationNumber}</title>
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;900&display=swap" rel="stylesheet"/>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Cairo',Arial,sans-serif;background:#fff;color:#1a1a1a;padding:32px 40px;font-size:13px}
.header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #7f1d1d;padding-bottom:16px;margin-bottom:20px}
.header-title{font-size:22px;font-weight:900;color:#7f1d1d}
.header-sub{font-size:11px;color:#666;margin-top:4px}
.header-meta{text-align:left;font-size:11px;color:#555;line-height:2.2}
.badge{display:inline-block;background:#7f1d1d;color:#fff;padding:4px 14px;border-radius:6px;font-size:14px;font-weight:700}
.info-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:20px}
.info-box{border:1px solid #e5e7eb;border-radius:8px;padding:10px 14px;background:#fafafa}
.info-label{font-size:10px;color:#888;margin-bottom:3px}
.info-value{font-size:13px;font-weight:700;color:#111}
.section-title{font-size:12px;font-weight:700;color:#7f1d1d;background:#fef2f2;padding:6px 12px;border-radius:6px;margin-bottom:12px;border-right:4px solid #7f1d1d}
table{width:100%;border-collapse:collapse;margin-bottom:16px;font-size:12px}
thead tr{background:#7f1d1d;color:#fff}
thead th{padding:8px 10px;text-align:right;font-weight:600}
tbody tr:nth-child(even){background:#fef2f2}
tbody tr:nth-child(odd){background:#fff}
tbody td{padding:8px 10px;border-bottom:1px solid #f3f4f6}
.totals-row{background:#1a1a1a!important;color:#fff!important;font-weight:700}
.totals-row td{padding:10px;border:none!important;color:#fff}
.sig-section{margin-top:36px;display:grid;grid-template-columns:1fr 1fr;gap:40px}
.sig-box{border-top:2px solid #7f1d1d;padding-top:10px;text-align:center;font-size:11px;color:#555}
.sig-name{font-size:14px;font-weight:700;color:#1a1a1a;margin-top:4px}
.footer{margin-top:24px;border-top:1px solid #e5e7eb;padding-top:10px;display:flex;justify-content:space-between;font-size:10px;color:#aaa}
.notes-box{border:1px solid #e5e7eb;border-radius:6px;padding:10px 14px;background:#fffbf0;font-size:12px;margin-bottom:16px}
@media print{@page{margin:12mm}body{padding:0}}
</style></head><body>
<div class="header">
  <div>
    <div class="header-title">📋 وثيقة استبعاد مخزون</div>
    <div class="header-sub">نظام إدارة الصيانة المتكامل — CMMS</div>
  </div>
  <div class="header-meta">
    <div>التاريخ: <strong>${new Date(op.operationDate).toLocaleDateString("ar-SA",{year:"numeric",month:"long",day:"numeric"})}</strong></div>
    <div>وقت الإصدار: <strong>${new Date().toLocaleTimeString("ar-SA")}</strong></div>
    <div><span class="badge">${op.operationNumber}</span></div>
  </div>
</div>
<div class="info-grid">
  <div class="info-box"><div class="info-label">المنفذ</div><div class="info-value">${op.creatorName || "—"}</div></div>
  <div class="info-box"><div class="info-label">عدد الأصناف</div><div class="info-value">${op.items?.length || 0} صنف</div></div>
  <div class="info-box"><div class="info-label">الحالة</div><div class="info-value">${op.status === "COMPLETED" ? "✅ مكتملة" : op.status}</div></div>
</div>
<div class="section-title">تفاصيل الأصناف المستبعدة</div>
<table>
  <thead><tr>
    <th>اسم الصنف</th>
    <th style="text-align:center">الكمية</th>
    <th style="text-align:center">سبب الاستبعاد</th>
    <th style="text-align:left">تكلفة الوحدة</th>
    <th style="text-align:left">إجمالي القيمة</th>
  </tr></thead>
  <tbody>
    ${itemsRows}
    <tr class="totals-row">
      <td>الإجمالي</td>
      <td style="text-align:center">${totalQty.toLocaleString()}</td>
      <td></td><td></td>
      <td style="text-align:left">${totalValue > 0 ? totalValue.toLocaleString() + " ر.س" : "—"}</td>
    </tr>
  </tbody>
</table>
${op.notes ? `<div class="notes-box">📝 <strong>ملاحظات:</strong> ${op.notes}</div>` : ""}
<div class="sig-section">
  <div class="sig-box"><div>توقيع المنفذ</div><div class="sig-name">${op.creatorName || "—"}</div></div>
  <div class="sig-box"><div>اعتماد المسؤول</div><div class="sig-name">&nbsp;</div></div>
</div>
<div class="footer">
  <span>وثيقة آلية — نظام CMMS | ${op.operationNumber}</span>
  <span>تاريخ الطباعة: ${new Date().toLocaleDateString("ar-SA")}</span>
</div>
<script>window.onload=()=>{window.print();window.onafterprint=()=>window.close();}<\/script>
</body></html>`;
    const win = window.open("", "_blank", "width=900,height=800");
    if (win) { win.document.write(html); win.document.close(); }
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
              <Button className="gap-2" onClick={() => setShowNew(true)}>
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
                    <th className="text-right font-medium px-3 py-2.5">عدد الأصناف</th>
                    <th className="text-right font-medium px-3 py-2.5">إجمالي الكمية</th>
                    <th className="text-right font-medium px-3 py-2.5">إجمالي القيمة</th>
                    <th className="text-right font-medium px-3 py-2.5">المنفذ</th>
                    <th className="text-right font-medium px-3 py-2.5">الحالة</th>
                    <th className="px-3 py-2.5"></th>
                  </tr>
                </thead>
                <tbody>
                  {(operations as any[]).map((op: any) => {
                    const statusMeta = STATUS_LABELS[op.status] || { label: op.status, color: "bg-gray-100 text-gray-800" };
                    return (
                      <tr key={op.id} className="border-t hover:bg-muted/30 cursor-pointer transition-colors" onClick={() => setDetailId(op.id)}>
                        <td className="px-3 py-2.5 font-mono font-semibold">{op.operationNumber}</td>
                        <td className="px-3 py-2.5 text-muted-foreground">{fmtDate(op.operationDate)}</td>
                        <td className="px-3 py-2.5 text-center">{op.totalItems}</td>
                        <td className="px-3 py-2.5 text-center">{op.totalQuantity?.toLocaleString()}</td>
                        <td className="px-3 py-2.5">{fmtMoney(op.totalValue)}</td>
                        <td className="px-3 py-2.5 text-muted-foreground">{op.creatorName}</td>
                        <td className="px-3 py-2.5">
                          <Badge className={`text-[10px] ${statusMeta.color}`}>{statusMeta.label}</Badge>
                        </td>
                        <td className="px-3 py-2.5">
                          <ChevronRight className="w-4 h-4 text-muted-foreground" />
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
                          {op.scope === "full" ? "شامل" : "جزئي"} — {fmtDate(op.operationDate)} — {op.totalItemsCounted} صنف
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
                    {countDetail.operation.operationNumber} — {countDetail.operation.scope === "full" ? "جرد شامل" : "جرد جزئي"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    التاريخ: {fmtDate(countDetail.operation.operationDate)} — اليوم: {countDetail.operation.riyadhDayName || "—"} — وقت البدء: {countDetail.operation.riyadhStartTime || "—"} (بتوقيت الرياض)
                  </p>
                  {countDetail.operation.status === "in_progress" && !countDetail.items.some((it: any) => it.countedQuantity !== null) && (
                    <p className="text-xs text-amber-600 mt-1">أضف/عُدَّ صنفاً واحداً على الأقل ليظهر خيار الحفظ النهائي</p>
                  )}
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
                  {countDetail.operation.status === "completed" && (
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

              {/* لوحة إضافة/مسح صنف — تظهر فقط للجرد الجزئي الجاري (وضع يدوي/باركود) */}
              {countDetail.operation.status === "in_progress" && countDetail.operation.scope === "partial" && (
                <Card className="bg-muted/20">
                  <CardContent className="p-3 space-y-2">
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
                  </CardContent>
                </Card>
              )}

              <div className="border rounded-lg overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="p-2 text-right">الصنف</th>
                      <th className="p-2 text-right">كمية النظام</th>
                      <th className="p-2 text-right">الكمية المعدودة</th>
                      <th className="p-2 text-right">الفرق</th>
                      <th className="p-2 text-right">دفعة/صلاحية</th>
                      <th className="p-2 text-right">ملاحظة</th>
                      <th className="p-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {countDetail.items
                      .filter((it: any) => !showUncountedOnly || it.countedQuantity === null)
                      .map((it: any) => {
                        const diff = it.diffQuantity !== null ? parseFloat(it.diffQuantity) : null;
                        return (
                          <tr key={it.countItemId} className="border-t">
                            <td className="p-2">{it.itemName}</td>
                            <td className="p-2">{it.systemQuantity} {it.unit}</td>
                            <td className="p-2">{it.countedQuantity ?? "—"}</td>
                            <td className={`p-2 font-medium ${diff !== null && diff !== 0 ? (diff > 0 ? "text-blue-600" : "text-red-600") : ""}`}>
                              {diff !== null ? (diff > 0 ? `+${diff}` : diff) : "—"}
                            </td>
                            <td className="p-2 text-xs text-muted-foreground">
                              {it.lotNumber || "—"} {it.expiryDate ? `/ ${fmtDate(it.expiryDate)}` : ""}
                            </td>
                            <td className="p-2 text-xs text-muted-foreground">{it.notes || "—"}</td>
                            <td className="p-2">
                              {countDetail.operation.status === "in_progress" && (
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
                            {op.scope === "full" ? "شامل" : "جزئي"} — {fmtDate(op.operationDate)} — {op.totalItemsCounted} صنف معدود
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
            <Button
              className="gap-1.5"
              onClick={() => { setSettlementSourceCountId(null); setSettlementItems([]); setShowSettlement(true); }}
            >
              <Plus className="w-4 h-4" />
              تسوية مستقلة (بدون جرد)
            </Button>
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
            <div className="space-y-1.5">
              <Label className="text-xs">عنوان الجرد (اختياري)</Label>
              <Input
                placeholder={`افتراضي: جرد يوم ${riyadhPreview.dayName} بتاريخ ${riyadhPreview.date}`}
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
                    .filter(i => i.itemName.includes(countItemSearch))
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
          </div>
          <DialogFooter>
            <Button
              onClick={() => createCountMut.mutate({
                operationTitle: countTitle.trim() || undefined,
                scope: countScope,
                itemIds: countUiMode === "auto" && countScope === "partial" ? selectedPartialIds : undefined,
                allowEmpty: countUiMode === "manual",
              })}
              disabled={
                createCountMut.isPending ||
                (countUiMode === "auto" && countScope === "partial" && selectedPartialIds.length === 0)
              }
            >
              {createCountMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "بدء الجرد"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ══ نافذة عدّ صنف ══ */}
      <Dialog open={!!editingItem} onOpenChange={(v) => !v && setEditingItem(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>عدّ الصنف</DialogTitle></DialogHeader>
          <div className="space-y-3">
            {/* بطاقة تفاصيل الصنف */}
            <div className="flex items-center gap-3 p-3 rounded-lg border bg-muted/30">
              <Package className="w-8 h-8 text-primary shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm truncate">{editingItem?.itemName}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  كمية النظام الحالية: <strong className="text-foreground">{editingItem?.systemQuantity} {editingItem?.unit}</strong>
                </p>
              </div>
            </div>

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
            <div className="space-y-1.5">
              <Label className="text-xs">رقم الدفعة (اختياري)</Label>
              <Input value={editLot} onChange={e => setEditLot(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">تاريخ الصلاحية (اختياري)</Label>
              <Input type="date" value={editExpiry} onChange={e => setEditExpiry(e.target.value)} />
            </div>
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

      {/* ══ نافذة إضافة صنف جديد كليّاً أثناء الجرد ══ */}
      <Dialog open={showNewItem} onOpenChange={(v) => !v && setShowNewItem(false)}>
        <DialogContent className="max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle>إضافة صنف جديد للمخزون</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              يُستخدم فقط لصنف فعلي موجود بالمستودع وغير مسجّل بالنظام إطلاقاً. سيُنشأ
              الصنف بكود داخلي وباركود مصنع تلقائيَين، ويدخل رصيد المخزون فوراً بالكمية أدناه.
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
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">الكمية *</Label>
                <Input type="number" min={0.001} step={0.5} value={newItemQty} onChange={e => setNewItemQty(e.target.value)} dir="ltr" className="font-mono" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">التكلفة (اختياري)</Label>
                <Input type="number" min={0} step={0.01} value={newItemCost} onChange={e => setNewItemCost(e.target.value)} dir="ltr" className="font-mono" placeholder="0" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewItem(false)}>إلغاء</Button>
            <Button
              className="gap-1.5"
              disabled={!newItemName.trim() || !newItemUnit || !newItemQty || parseFloat(newItemQty || "0") <= 0 || addNewItemMut.isPending}
              onClick={submitNewItem}
            >
              {addNewItemMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              إضافة للمخزون
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ══ نافذة تسوية المخزون ══ */}
      <Dialog open={showSettlement} onOpenChange={setShowSettlement}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {settlementSourceCountId ? "تسوية من نتائج الجرد" : "تسوية مستقلة"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 max-h-[60vh] overflow-y-auto">
            {settlementSourceCountId && discrepancies && (
              <div className="border rounded-lg overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="p-2 text-right">الصنف</th>
                      <th className="p-2 text-right">قبل</th>
                      <th className="p-2 text-right">بعد (قابل للتعديل)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(discrepancies as any[]).map((d) => {
                      const current = settlementItems.find(s => s.inventoryId === d.inventoryId);
                      const afterVal = current ? current.afterQuantity : d.countedQuantity;
                      return (
                        <tr key={d.inventoryId} className="border-t">
                          <td className="p-2">{d.itemName}</td>
                          <td className="p-2">{d.systemQuantity} {d.unit}</td>
                          <td className="p-2">
                            <Input
                              type="number" className="w-28"
                              value={afterVal}
                              onChange={e => {
                                const val = parseFloat(e.target.value || "0");
                                setSettlementItems(prev => {
                                  const others = prev.filter(s => s.inventoryId !== d.inventoryId);
                                  return [...others, {
                                    inventoryId: d.inventoryId,
                                    afterQuantity: val,
                                    lotNumber: d.lotNumber,
                                    expiryDate: toDateInputValue(d.expiryDate) || undefined,
                                  }];
                                });
                              }}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {!settlementSourceCountId && (
              <div className="space-y-1.5">
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
                            inventoryId: i.id, afterQuantity: i.quantity, itemName: i.itemName,
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
                      <tbody>
                        {settlementItems.map((s, idx) => (
                          <tr key={s.inventoryId} className="border-t">
                            <td className="p-2">{s.itemName || s.inventoryId}</td>
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
                            <td className="p-2">
                              <Button variant="ghost" size="icon" onClick={() =>
                                setSettlementItems(prev => prev.filter((_, i) => i !== idx))
                              }><X className="w-4 h-4" /></Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
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
                  ? (discrepancies as any[])?.map(d => {
                      const edited = settlementItems.find(s => s.inventoryId === d.inventoryId);
                      return {
                        inventoryId: d.inventoryId,
                        afterQuantity: edited ? edited.afterQuantity : parseFloat(d.countedQuantity),
                        lotNumber: d.lotNumber || undefined,
                        expiryDate: toDateInputValue(d.expiryDate) || undefined,
                      };
                    }) || []
                  : settlementItems.map(s => ({ inventoryId: s.inventoryId, afterQuantity: s.afterQuantity }));

                applySettlementMut.mutate({
                  sourceType: settlementSourceCountId ? "from_count" : "manual",
                  sourceCountOperationId: settlementSourceCountId || undefined,
                  reason: settlementReason,
                  items,
                });
              }}
              disabled={applySettlementMut.isPending || settlementReason.trim().length < 10}
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

              {/* QR Scanner الحقيقي */}
              {searchMode === "qr" && !foundItem && (
                <BarcodeScanner
                  onScan={handleQRScan}
                  placeholder="امسح QR Code الصنف..."
                />
              )}

              {/* خانة البحث النصي */}
              {(searchMode === "name" || searchMode === "code") && !foundItem && (
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
                          <p>الرصيد المتاح: <strong className="text-foreground">{foundItem.quantity} {foundItem.unit}</strong></p>
                          {foundItem.location && <p>الموقع: {foundItem.location}</p>}
                        </div>
                      </div>
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => { setFoundItem(null); setQty(""); setReason(""); }}>
                        <X className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">الكمية *</Label>
                      <Input type="number" min={0.001} step={0.5} value={qty} onChange={e => setQty(e.target.value)} placeholder="0" dir="ltr" className="font-mono" />
                      {qty && parseFloat(qty) > foundItem.quantity && (
                        <p className="text-xs text-destructive flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> أكبر من الرصيد</p>
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
                      <th className="text-right font-medium px-2.5 py-2">الكمية</th>
                      <th className="text-right font-medium px-2.5 py-2">السبب</th>
                      <th className="text-right font-medium px-2.5 py-2">القيمة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.items?.map((item: any) => (
                      <tr key={item.id} className="border-t">
                        <td className="px-2.5 py-2">
                          <p className="font-medium">{item.itemName}</p>
                          {item.notes && <p className="text-xs text-muted-foreground">{item.notes}</p>}
                        </td>
                        <td className="px-2.5 py-2">{parseFloat(item.quantity).toLocaleString()} {item.unit}</td>
                        <td className="px-2.5 py-2"><Badge variant="outline" className="text-[10px]">{REASON_LABELS[item.reason]}</Badge></td>
                        <td className="px-2.5 py-2">{fmtMoney(item.totalCost)}</td>
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
