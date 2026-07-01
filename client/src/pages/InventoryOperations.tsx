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
import { useState } from "react";
import { toast } from "sonner";

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
        <TabsList className="grid grid-cols-2 w-full max-w-xs">
          <TabsTrigger value="disposal" className="gap-1.5">
            <Trash2 className="w-3.5 h-3.5" />
            الاستبعاد
          </TabsTrigger>
          <TabsTrigger value="inventory_count" className="gap-1.5">
            <BookOpen className="w-3.5 h-3.5" />
            الجرد
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

        {/* ══ تبويب الجرد — مستقبلاً ══ */}
        <TabsContent value="inventory_count" className="mt-6">
          <Card><CardContent className="p-12 text-center">
            <BookOpen className="w-12 h-12 mx-auto text-muted-foreground/40 mb-4" />
            <h3 className="font-semibold text-lg mb-1">الجرد</h3>
            <p className="text-sm text-muted-foreground">هذه الميزة قيد التطوير وستكون متاحة قريباً</p>
          </CardContent></Card>
        </TabsContent>
      </Tabs>

      {/* ══ نافذة إنشاء عملية استبعاد جديدة ══ */}
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
