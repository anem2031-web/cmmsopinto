import { useState, useRef } from "react";
import QRCode from "qrcode";
import { mediaUrl } from "@/lib/mediaUrl";
import { trpc } from "@/lib/trpc";
import { useTranslation } from "@/contexts/LanguageContext";
import { useAuth } from "@/_core/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { TechnicianCombobox } from "@/components/tickets/TechnicianCombobox";
import BarcodeScanner from "@/components/common/BarcodeScanner";
import {
  ShoppingCart, Package, Truck, CheckCircle2, Camera, Loader2,
  Clock, ArrowLeft, ArrowRight, Image as ImageIcon, FileText,
  AlertCircle, User, Hash, Calendar, Ban, Archive, Sparkles,
  Search, QrCode, X
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

// ── مكوّنات مستقلة (خارج الـ component لمنع إعادة الإنشاء) ──────

const PAGE_SIZE = 10;

function Pagination({ total, page, setPage }: { total: number; page: number; setPage: (p: number) => void }) {
  const pages = Math.ceil(total / PAGE_SIZE);
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-center gap-1 mt-3">
      <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(page - 1)}>
        ←
      </Button>
      {Array.from({ length: Math.min(pages, 5) }, (_, i) => {
        const p = page <= 3 ? i + 1 : page - 2 + i;
        if (p < 1 || p > pages) return null;
        return (
          <Button key={p} variant={p === page ? "default" : "outline"} size="sm" className="w-8 h-8 p-0" onClick={() => setPage(p)}>
            {p}
          </Button>
        );
      })}
      <Button variant="outline" size="sm" disabled={page === pages} onClick={() => setPage(page + 1)}>
        →
      </Button>
    </div>
  );
}

// ── مكوّن خانة البحث والتاريخ ───────────────────────────────
function FilterBar({
  search, setSearch, from, setFrom, to, setTo, placeholder = "بحث..."
}: {
  search: string; setSearch: (v: string) => void;
  from?: string; setFrom?: (v: string) => void;
  to?: string;   setTo?:   (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="flex flex-wrap gap-2 mb-3">
      <div className="relative flex-1 min-w-[180px]">
        <input
          className="w-full border rounded-md px-3 py-1.5 text-sm pr-8 focus:outline-none focus:ring-1 focus:ring-primary"
          placeholder={placeholder}
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">🔍</span>
      </div>
      {setFrom && (
        <input type="date" className="border rounded-md px-2 py-1.5 text-sm" value={from} onChange={e => { setFrom(e.target.value); }} />
      )}
      {setTo && (
        <input type="date" className="border rounded-md px-2 py-1.5 text-sm" value={to} onChange={e => { setTo(e.target.value); }} />
      )}
      {(search || from || to) && (
        <Button variant="ghost" size="sm" className="text-xs text-muted-foreground" onClick={() => { setSearch(""); if(setFrom) setFrom(""); if(setTo) setTo(""); }}>
          مسح
        </Button>
      )}
    </div>
  );
}


function DeliveryDocumentsTab({ deliveryDocsQuery, returnDocsQuery, searchDocs, setSearchDocs, docRecipient, setDocRecipient, docDateFrom, setDocDateFrom, docDateTo, setDocDateTo, pageDocs, setPageDocs, incrementDocPrintMut, incrementReturnDocPrintMut }: any) {
  const deliveryDocs = (deliveryDocsQuery.data ?? []).map((d: any) => ({ ...d, docType: "delivery" as const }));
  const returnDocsRaw = (returnDocsQuery?.data ?? []).map((d: any) => ({ ...d, docType: "return" as const }));
  const docs = [...deliveryDocs, ...returnDocsRaw].sort(
    (a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  // فلتر الوثائق
  const recipients = [...new Set(deliveryDocs.map((d: any) => d.deliveredToName).filter(Boolean))];
  const filteredDocs = docs.filter((doc: any) => {
    const q = searchDocs.trim().toLowerCase();
    if (q) {
      const fields = Object.values(doc).map(v => String(v ?? "").toLowerCase());
      if (!fields.some(f => f.includes(q))) return false;
    }
    if (docRecipient !== "all" && doc.docType === "delivery" && doc.deliveredToName !== docRecipient) return false;
    if (docRecipient !== "all" && doc.docType === "return") return false;
    if (docDateFrom || docDateTo) {
      const d = new Date(doc.createdAt);
      if (docDateFrom && d < new Date(docDateFrom)) return false;
      if (docDateTo   && d > new Date(docDateTo + "T23:59:59")) return false;
    }
    return true;
  });
  const pagedDocs = filteredDocs.slice((pageDocs-1)*PAGE_SIZE, pageDocs*PAGE_SIZE);

  const handleDownloadReturn = async (doc: any) => {
    incrementReturnDocPrintMut.mutate({ id: doc.id });
    // نفتح النافذة فوراً (بشكل متزامن مع الضغطة) لتفادي حظر المتصفح للنوافذ
    // المنبثقة، ثم نكتب المحتوى بعد جهوزية الـQR (عملية غير متزامنة)
    const win = window.open("", "_blank", "width=860,height=780");

    const qrValue = doc.manufacturerBarcode || doc.internalCode || doc.returnNumber;
    let qrDataUrl = "";
    try {
      qrDataUrl = await QRCode.toDataURL(qrValue, { width: 130, margin: 1 });
    } catch { /* لو فشل التوليد، نعرض الوثيقة بدون QR بدل ما نوقف الطباعة */ }

    const html = `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head><meta charset="UTF-8"/><title>${doc.returnNumber}</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700&display=swap');
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Cairo',Arial,sans-serif;background:#fff;color:#1a1a1a;padding:32px 40px;font-size:13px}
.header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #7f1d1d;padding-bottom:14px;margin-bottom:20px}
.header-title{font-size:20px;font-weight:700;color:#7f1d1d}
.header-sub{font-size:11px;color:#555;margin-top:4px}
.header-meta{text-align:left;font-size:11px;color:#555;line-height:2}
.badge{display:inline-block;background:#7f1d1d;color:#fff;padding:3px 10px;border-radius:4px;font-size:13px;font-weight:700}
.section{margin-bottom:16px}
.section-title{font-size:12px;font-weight:700;color:#7f1d1d;background:#fef2f2;padding:5px 10px;border-radius:4px;margin-bottom:10px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:8px 24px}
.field{display:flex;flex-direction:column;gap:2px}
.field-label{font-size:10px;color:#777}
.field-value{font-size:13px;font-weight:600;color:#111}
.item-id-row{display:flex;align-items:center;gap:16px;border:1px solid #f3d2d2;border-radius:8px;padding:10px 14px;margin-bottom:16px;background:#fffafa}
.sig-section{margin-top:32px;display:grid;grid-template-columns:1fr 1fr;gap:32px}
.sig-box{border-top:1px solid #bbb;padding-top:8px;text-align:center;font-size:11px;color:#555}
.footer{margin-top:24px;border-top:1px solid #eee;padding-top:10px;display:flex;justify-content:space-between;font-size:10px;color:#aaa}
.print-count{font-size:11px;color:#888;background:#f4f6fa;border:1px solid #dde3ea;border-radius:20px;padding:2px 12px}
@media print{@page{size:A4;margin:10mm}}
</style></head>
<body>
<div class="header">
  <div>
    <div class="header-title">↩️ وثيقة مرتجع</div>
    <div class="header-sub">نظام إدارة الصيانة المتكامل</div>
  </div>
  <div class="header-meta">
    <div>التاريخ: <strong>${new Date(doc.createdAt).toLocaleDateString("ar-SA",{year:"numeric",month:"long",day:"numeric"})}</strong></div>
    <div><span class="badge">${doc.returnNumber}</span></div>
    ${doc.poNumber ? `<div>طلب شراء: <strong>${doc.poNumber}</strong></div>` : ""}
  </div>
</div>
${qrDataUrl ? `<div class="item-id-row">
  <img src="${qrDataUrl}" width="90" height="90" style="border:1px solid #eee;border-radius:6px"/>
  <div>
    <div class="field-label">رقم الصنف (باركود المصنع)</div>
    <div class="field-value" style="font-size:16px;font-family:monospace">${doc.manufacturerBarcode || doc.internalCode || "—"}</div>
  </div>
</div>` : ""}
<div class="section">
  <div class="section-title">بيانات المرتجع</div>
  <div class="grid">
    <div class="field"><span class="field-label">اسم الصنف</span><span class="field-value">${doc.itemName}</span></div>
    <div class="field"><span class="field-label">الكمية المُرجَعة</span><span class="field-value">${doc.returnedQuantity} ${doc.unit||""}</span></div>
    <div class="field"><span class="field-label">نفّذ الإرجاع</span><span class="field-value">${doc.returnedByName}</span></div>
    ${doc.receiptNumber ? `<div class="field"><span class="field-label">سند الاستلام المرتبط</span><span class="field-value">${doc.receiptNumber}</span></div>` : `<div class="field"><span class="field-label">سند الاستلام</span><span class="field-value">— (إرجاع عام بلا مصدر معروف)</span></div>`}
    ${doc.invoiceNumber ? `<div class="field"><span class="field-label">رقم فاتورة المورد</span><span class="field-value">${doc.invoiceNumber}</span></div>` : ""}
    ${doc.vendorName ? `<div class="field"><span class="field-label">المورد</span><span class="field-value">${doc.vendorName}</span></div>` : ""}
    <div class="field" style="grid-column:1/-1"><span class="field-label">سبب الإرجاع</span><span class="field-value">${doc.reason}</span></div>
  </div>
</div>
<div class="sig-section">
  <div class="sig-box">توقيع منفّذ الإرجاع<br/>${doc.returnedByName}</div>
  <div class="sig-box">توقيع المستلم<br/>${doc.recipientName || "&nbsp;"}</div>
</div>
<div class="footer">
  <span>وثيقة آلية — نظام CMMS</span>
  <span class="print-count">عدد مرات الطباعة: <strong>${doc.printCount + 1}</strong></span>
</div>
<script>window.onload=()=>{window.print();window.onafterprint=()=>window.close();}<\/script>
</body></html>`;

    if (win) { win.document.write(html); win.document.close(); }
  };

  const handleDownload = (doc: any) => {
    if (doc.docType === "return") {
      handleDownloadReturn(doc);
      return;
    }
    incrementDocPrintMut.mutate({ id: doc.id });
    // توليد PDF مباشرة في المتصفح بدون سيرفر
    const imgTag = doc.warehousePhotoUrl
      ? `<div class="photo-wrap"><p class="photo-label">صورة الصنف</p><img src="${doc.warehousePhotoUrl}" style="width:140px;height:140px;object-fit:cover;border-radius:8px;border:1px solid #dde3ea" /></div>`
      : "";

    const html = `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head><meta charset="UTF-8"/><title>${doc.deliveryNumber}</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700&display=swap');
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Cairo',Arial,sans-serif;background:#fff;color:#1a1a1a;padding:32px 40px;font-size:13px}
.header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #1e3a5f;padding-bottom:14px;margin-bottom:20px}
.header-title{font-size:20px;font-weight:700;color:#1e3a5f}
.header-sub{font-size:11px;color:#555;margin-top:4px}
.header-meta{text-align:left;font-size:11px;color:#555;line-height:2}
.badge{display:inline-block;background:#1e3a5f;color:#fff;padding:3px 10px;border-radius:4px;font-size:13px;font-weight:700}
.parties{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px}
.party-box{border:1px solid #dde3ea;border-radius:8px;padding:12px 14px}
.party-role{font-size:10px;color:#777;margin-bottom:4px}
.party-name{font-size:15px;font-weight:700;color:#1e3a5f}
.section{margin-bottom:16px}
.section-title{font-size:12px;font-weight:700;color:#1e3a5f;background:#eef3f9;padding:5px 10px;border-radius:4px;margin-bottom:10px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:8px 24px}
.field{display:flex;flex-direction:column;gap:2px}
.field-label{font-size:10px;color:#777}
.field-value{font-size:13px;font-weight:600;color:#111}
.sig-section{margin-top:32px;display:grid;grid-template-columns:1fr 1fr;gap:32px}
.sig-box{border-top:1px solid #bbb;padding-top:8px;text-align:center;font-size:11px;color:#555}
.footer{margin-top:24px;border-top:1px solid #eee;padding-top:10px;display:flex;justify-content:space-between;font-size:10px;color:#aaa}
.print-count{font-size:11px;color:#888;background:#f4f6fa;border:1px solid #dde3ea;border-radius:20px;padding:2px 12px}
@media print{@page{size:A4;margin:10mm}}
</style></head>
<body>
<div class="header">
  <div>
    <div class="header-title">🚚 وثيقة تسليم مواد</div>
    <div class="header-sub">نظام إدارة الصيانة المتكامل</div>
  </div>
  <div class="header-meta">
    <div>التاريخ: <strong>${new Date(doc.createdAt).toLocaleDateString("ar-SA",{year:"numeric",month:"long",day:"numeric"})}</strong></div>
    <div><span class="badge">${doc.deliveryNumber}</span></div>
    ${doc.poNumber ? `<div>أمر شراء: <strong>${doc.poNumber}</strong></div>` : ""}
  </div>
</div>
<div class="parties">
  <div class="party-box"><div class="party-role">المُسلِّم</div><div class="party-name">${doc.deliveredByName}</div></div>
  <div class="party-box"><div class="party-role">المُستلِم (الفني)</div><div class="party-name">${doc.deliveredToName}</div></div>
</div>
<div class="section">
  <div class="section-title">بيانات الصنف</div>
  <div class="grid">
    <div class="field"><span class="field-label">اسم الصنف</span><span class="field-value">${doc.itemName}</span></div>
    <div class="field"><span class="field-label">الكمية المسلَّمة</span><span class="field-value">${doc.quantity} ${doc.unit||""}</span></div>
    ${doc.supplierName ? `<div class="field"><span class="field-label">المورد</span><span class="field-value">${doc.supplierName}</span></div>` : ""}
    ${doc.actualUnitCost ? `<div class="field"><span class="field-label">تكلفة الوحدة</span><span class="field-value">${parseFloat(doc.actualUnitCost).toLocaleString()} ر.س</span></div>` : ""}
    ${doc.notes ? `<div class="field" style="grid-column:1/-1"><span class="field-label">ملاحظات</span><span class="field-value">${doc.notes}</span></div>` : ""}
  </div>
  ${imgTag}
</div>
<div class="sig-section">
  <div class="sig-box">توقيع المُسلِّم<br/>${doc.deliveredByName}</div>
  <div class="sig-box">توقيع المُستلِم<br/>${doc.deliveredToName}</div>
</div>
<div class="footer">
  <span>وثيقة آلية — نظام CMMS</span>
  <span class="print-count">عدد مرات الطباعة: <strong>${doc.printCount + 1}</strong></span>
</div>
<script>window.onload=()=>{window.print();window.onafterprint=()=>window.close();}<\/script>
</body></html>`;

    const win = window.open("", "_blank", "width=860,height=780");
    if (win) { win.document.write(html); win.document.close(); }
  };

  if (deliveryDocsQuery.isLoading || returnDocsQuery?.isLoading) {
    return <Card><CardContent className="p-8 text-center text-muted-foreground">جاري التحميل...</CardContent></Card>;
  }

  if (docs.length === 0) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-muted-foreground">
          <FileText className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="font-medium">لا توجد وثائق بعد</p>
          <p className="text-xs mt-1">ستظهر هنا كل وثيقة عند تأكيد تسليم مادة للفني أو إتمام مرتجع</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {/* فلاتر تبويب الوثائق */}
      <div className="flex flex-wrap gap-2 mb-3">
        <div className="relative flex-1 min-w-[180px]">
          <input
            className="w-full border rounded-md px-3 py-1.5 text-sm pr-8 focus:outline-none focus:ring-1 focus:ring-primary"
            placeholder="بحث في الوثائق..."
            defaultValue={searchDocs}
            onInput={e => { setSearchDocs((e.target as HTMLInputElement).value); setPageDocs(1); }}
          />
          <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">🔍</span>
        </div>
        <select
          className="border rounded-md px-2 py-1.5 text-sm bg-white"
          value={docRecipient}
          onChange={e => { setDocRecipient(e.target.value); setPageDocs(1); }}
        >
          <option value="all">كل المستلمين</option>
          {recipients.map((r: any) => <option key={r} value={r}>{r}</option>)}
        </select>
        <input type="date" className="border rounded-md px-2 py-1.5 text-sm" value={docDateFrom} onChange={e => { setDocDateFrom(e.target.value); setPageDocs(1); }} />
        <input type="date" className="border rounded-md px-2 py-1.5 text-sm" value={docDateTo} onChange={e => { setDocDateTo(e.target.value); setPageDocs(1); }} />
        {(searchDocs || docRecipient !== "all" || docDateFrom || docDateTo) && (
          <button className="text-xs text-muted-foreground underline" onClick={() => { setSearchDocs(""); setDocRecipient("all"); setDocDateFrom(""); setDocDateTo(""); setPageDocs(1); }}>مسح</button>
        )}
      </div>
      <div className="text-sm text-muted-foreground">{filteredDocs.length} وثيقة{filteredDocs.length !== docs.length ? ` من ${docs.length}` : ""}</div>
      {pagedDocs.map((doc: any) => (
        <Card
          key={`${doc.docType}-${doc.id}`}
          className={`hover:shadow-md transition-shadow border-r-4 ${
            doc.docType === "return" ? "border-r-red-700/60" : "border-r-primary/60"
          }`}
        >
          <CardContent className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0 space-y-1">
                {/* العنوان = اسم الصنف */}
                <p className="font-semibold text-base truncate">
                  {doc.docType === "return" ? "↩️ " : ""}{doc.itemName}
                </p>
                <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                  {/* رقم الوثيقة */}
                  <span className={`font-bold px-2 py-0.5 rounded ${
                    doc.docType === "return" ? "bg-red-50 text-red-700" : "bg-primary/10 text-primary"
                  }`}>
                    {doc.docType === "return" ? doc.returnNumber : doc.deliveryNumber}
                  </span>
                  {/* التاريخ */}
                  <span>{new Date(doc.createdAt).toLocaleDateString("ar-SA", { year: "numeric", month: "short", day: "numeric" })}</span>
                  {doc.docType === "return" ? (
                    <>
                      <span>نفّذ الإرجاع: {doc.returnedByName}</span>
                      <span>الكمية: {doc.returnedQuantity} {doc.unit || ""}</span>
                    </>
                  ) : (
                    <>
                      <span>المُسلِّم: {doc.deliveredByName}</span>
                      <span>المُستلِم: {doc.deliveredToName}</span>
                      <span>الكمية: {doc.quantity} {doc.unit || ""}</span>
                    </>
                  )}
                </div>
                <div className="text-xs text-muted-foreground">
                  طُبعت {doc.printCount} {doc.printCount === 1 ? "مرة" : "مرات"}
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5 shrink-0"
                onClick={() => handleDownload(doc)}
                disabled={false}
              >
                <FileText className="w-4 h-4" />
                "تنزيل PDF"
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
export default function PurchaseCycle() {
  // Dialog states
  const [purchaseDialog, setPurchaseDialog] = useState<any>(null);
  const [cancelDialog, setCancelDialog] = useState<any>(null);
  const [cancelNote, setCancelNote] = useState("");
  const [warehouseDialog, setWarehouseDialog] = useState<any>(null);
  const [deliveryDialog, setDeliveryDialog] = useState<any>(null);
  const [deliveryPrintData, setDeliveryPrintData] = useState<any>(null);

  // Delivery documents tab
  const deliveryDocsQuery = trpc.deliveryDocuments.list.useQuery();
  const generateDocMut = trpc.deliveryDocuments.generate.useMutation({
    onSuccess: () => { deliveryDocsQuery.refetch(); },
  });
  const incrementDocPrintMut = trpc.deliveryDocuments.incrementPrint.useMutation();

  // Return documents (نفس تبويب "التوثيق" — تُنشأ تلقائياً بالخادم مع كل مرتجع)
  const returnDocsQuery = trpc.returnDocuments.list.useQuery();
  const incrementReturnDocPrintMut = trpc.returnDocuments.incrementPrint.useMutation();

  // Upload states
  const [uploading, setUploading] = useState<string | null>(null);
  const [purchasePhotos, setPurchasePhotos] = useState<{ purchased?: string; invoice?: string }>({});
  const [warehouseForm, setWarehouseForm] = useState({ receivedQuantity: "", supplierInvoiceNumber: "", warehousePhotoUrl: "" });
  const [deliveryUserId, setDeliveryUserId] = useState<string>("");
  const [deliveryQty, setDeliveryQty]       = useState<string>("");
  const [deliveryUnit, setDeliveryUnit]     = useState<string>("");
  const [deliveryNotes, setDeliveryNotes]   = useState<string>("");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const currentUploadTarget = useRef<string>("");

  // Upload handler
  const handleUpload = async (file: File, target: string) => {
    setUploading(target);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");

      if (target === "purchased") setPurchasePhotos(p => ({ ...p, purchased: data.url }));
      else if (target === "invoice") setPurchasePhotos(p => ({ ...p, invoice: data.url }));
      else if (target === "warehouse") setWarehouseForm(p => ({ ...p, warehousePhotoUrl: data.url }));
      toast.success(t.common.upload);
    } catch (err: any) {
      toast.error(err.message || "Upload error");
    } finally {
      setUploading(null);
    }
  };

  const triggerUpload = (target: string) => {
    currentUploadTarget.current = target;
    fileInputRef.current?.click();
  };

  const onFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleUpload(file, currentUploadTarget.current);
    e.target.value = "";
  };

  // Sort items by date (oldest first)
  const sortByDate = (items: any[]) => [...items].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  // Step indicator component

  const { t, language } = useTranslation();
  const { user } = useAuth();
  const isRTL = language === "ar" || language === "ur";
  const role = user?.role || "";
  const isAdminOrOwner = role === "admin" || role === "owner";
  const isDelegate = role === "delegate" || isAdminOrOwner;
  const isWarehouse = role === "warehouse" || isAdminOrOwner;

  // Determine active tab based on role
  const defaultTab = isAdminOrOwner ? "purchase" : isDelegate ? "purchase" : isWarehouse ? "warehouse" : "purchase";
  const [activeTab, setActiveTab] = useState(defaultTab);

  // Data queries - admin/owner always enabled
  const { data: pendingEstimate = [], refetch: refetchEstimate } = trpc.purchaseOrders.pendingEstimateItems.useQuery(undefined, { enabled: isDelegate || isAdminOrOwner });
  const { data: pendingPurchase = [], refetch: refetchPurchase } = trpc.purchaseOrders.pendingPurchaseItems.useQuery(undefined, { enabled: isDelegate || isAdminOrOwner });
  const { data: pendingWarehouse = [], refetch: refetchWarehouse } = trpc.purchaseOrders.pendingWarehouseItems.useQuery(undefined, { enabled: isWarehouse || isAdminOrOwner });
  const { data: pendingDelivery = [], refetch: refetchDelivery } = trpc.purchaseOrders.pendingDeliveryItems.useQuery(undefined, { enabled: isWarehouse || isAdminOrOwner });
  // أصناف المخزون الجاهزة للتسليم (من OCR الفعلي)
  const { data: inventoryItems = [], refetch: refetchInventory } = trpc.purchaseOrders.inventoryReadyForDelivery.useQuery(undefined, { enabled: isWarehouse || isAdminOrOwner });
  // إدخال المخزون — أصناف وصلت للمستودع وبانتظار إدخال المخزون
  const pendingInventoryEntry = (pendingDelivery as any[]).filter((i: any) => !i.inventoryEntered);
  // تجميع حسب رقم فاتورة المورد (وليس اسم المورد — أدق لأنه مكتوب مباشرة من الفاتورة الورقية)
  const groupedByInvoiceNumber = (pendingDelivery as any[]).reduce((groups: any, item: any) => {
    const key = item.supplierInvoiceNumber || "بدون رقم فاتورة";
    if (!groups[key]) groups[key] = [];
    groups[key].push(item);
    return groups;
  }, {});
  const { data: allUsers = [] } = trpc.users.list.useQuery();

  const refetchAll = () => { refetchEstimate(); refetchPurchase(); refetchWarehouse(); refetchDelivery(); };

  // Mutations
  const estimateCostMut = trpc.purchaseOrders.estimateCost.useMutation({ onSuccess: () => { toast.success(t.purchaseOrders.pricingSaved); refetchAll(); }, onError: (e: any) => toast.error(e.message) });
  const confirmPurchaseMut = trpc.purchaseOrders.confirmItemPurchase.useMutation({ onSuccess: () => { toast.success(t.purchaseOrders.purchased); refetchAll(); }, onError: (e: any) => toast.error(e.message) });
  const cancelPurchaseMut = trpc.purchaseOrders.cancelItemPurchase.useMutation({ onSuccess: () => { toast.success(t.purchaseOrders.cancelPurchaseSuccess); refetchAll(); setCancelDialog(null); setCancelNote(""); }, onError: (e: any) => toast.error(e.message) });
  const confirmWarehouseMut = trpc.purchaseOrders.confirmDeliveryToWarehouse.useMutation({ onSuccess: () => { toast.success(t.purchaseOrders.deliveredToWarehouse); refetchAll(); }, onError: (e: any) => toast.error(e.message) });
  const deliverInventoryMut = trpc.purchaseOrders.deliverInventoryItem.useMutation({
    onSuccess: (data) => {
      toast.success(t.purchaseOrders.deliveredToRequester);
      refetchInventory();
      refetchDelivery();
      deliveryDocsQuery.refetch();
      setDeliveryPrintData((prev: any) => {
        if (prev) {
          const fullData = { ...prev, deliveryNumber: data?.deliveryNumber };
          printDeliveryReceipt(fullData);
          // ملاحظة: لا نستدعي generateDocMut هنا — السيرفر ينشئ وثيقة التسليم
          // تلقائيًا ضمن db.issueDelivery() لعناصر المخزون المباشرة، فأي استدعاء
          // إضافي هنا يسبب وثيقة مكررة لنفس عملية التسليم.
        }
        return null;
      });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const confirmDeliveryMut = trpc.purchaseOrders.confirmDeliveryToRequester.useMutation({
    onSuccess: (data) => {
      toast.success(t.purchaseOrders.deliveredToRequester);
      refetchAll();
      setDeliveryPrintData((prev: any) => {
        if (prev) {
          const fullData = { ...prev, deliveryNumber: data?.deliveryNumber };
          printDeliveryReceipt(fullData);
          // حفظ الوثيقة — نستخدم setTimeout لأن setState callback ليس المكان المناسب لـ mutate
          setTimeout(() => {
            generateDocMut.mutate({
              deliveryNumber: data?.deliveryNumber ?? "",
              poItemId: fullData.itemId,
              itemName: fullData.itemName,
              deliveredByName: fullData.deliveredByName,
              deliveredToName: fullData.deliveredToName,
              quantity: fullData.quantity,
              unit: fullData.unit,
              supplierName: fullData.supplierName,
              actualUnitCost: fullData.actualUnitCost,
              poNumber: fullData.poNumber,
              warehousePhotoUrl: fullData.warehousePhotoUrl,
              notes: fullData.notes,
              deliveredAt: fullData.deliveredAt,
            });
          }, 0);
        }
        return null;
      });
    },
    onError: (e: any) => { toast.error(e.message); setDeliveryPrintData(null); },
  });

  // Estimate state
  const [estimateValues, setEstimateValues] = useState<Record<number, string>>({});

  // ── فلاتر كل تبويب ──────────────────────────────────────────
  const [searchEstimate,   setSearchEstimate]   = useState("");
  const [searchPurchase,   setSearchPurchase]   = useState("");
  const [searchWarehouse,  setSearchWarehouse]  = useState("");
  const [searchDelivery,   setSearchDelivery]   = useState("");
  const [deliverySearchMode, setDeliverySearchMode] = useState<"name" | "code" | "qr">("name");
  const [searchDocs,       setSearchDocs]       = useState("");

  const [dateFrom, setDateFrom] = useState("");
  const [dateTo,   setDateTo]   = useState("");
  const [docDateFrom, setDocDateFrom] = useState("");
  const [docDateTo,   setDocDateTo]   = useState("");
  const [docRecipient, setDocRecipient] = useState("all");

  // ── صفحات ──────────────────────────────────────────────────
  const [pageEstimate,  setPageEstimate]  = useState(1);
  const [pagePurchase,  setPagePurchase]  = useState(1);
  const [pageWarehouse, setPageWarehouse] = useState(1);
  const [pageDelivery,  setPageDelivery]  = useState(1);
  const [pageDocs,      setPageDocs]      = useState(1);

  // ── دالة الفلترة الشاملة ────────────────────────────────────
  const filterItems = (items: any[], search: string, from?: string, to?: string) => {
    const q = search.trim().toLowerCase();
    return items.filter(item => {
      // فلتر البحث النصي — يبحث في كل الحقول
      if (q) {
        const fields = Object.values(item).map(v => String(v ?? "").toLowerCase());
        if (!fields.some(f => f.includes(q))) return false;
      }
      // فلتر التاريخ
      if (from || to) {
        const d = new Date(item.createdAt || item.deliveredAt || item.date || 0);
        if (from && d < new Date(from)) return false;
        if (to   && d > new Date(to + "T23:59:59")) return false;
      }
      return true;
    });
  };

  // ── دالة فلترة التسليم — تحترم وضع البحث (اسم / رقم / QR) ──
  const filterDeliveryItems = (items: any[], search: string) => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(item => {
      if (deliverySearchMode === "code" || deliverySearchMode === "qr") {
        // بالرقم أو QR: يبحث في الكود الداخلي وباركود المصنع فقط
        return (
          String(item.internalCode ?? "").toLowerCase().includes(q) ||
          String(item.manufacturerBarcode ?? "").toLowerCase().includes(q)
        );
      }
      // بالاسم: يبحث في اسم الصنف (عربي/إنجليزي)
      return (
        String(item.itemName ?? "").toLowerCase().includes(q) ||
        String(item.itemName_ar ?? "").toLowerCase().includes(q) ||
        String(item.itemName_en ?? "").toLowerCase().includes(q)
      );
    });
  };

  // ── مكوّن الصفحات ───────────────────────────────────────────
  const StepIndicator = ({ currentStep }: { currentStep: number }) => {
    const steps = [
      { num: 1, label: t.purchaseOrders.step1Purchase, icon: ShoppingCart },
      { num: 2, label: t.purchaseOrders.step2Warehouse, icon: Package },
      { num: 3, label: t.purchaseOrders.step3Delivery, icon: Truck },
    ];
    return (
      <div className="flex items-center justify-center gap-0 mb-6">
        {steps.map((step, idx) => {
          const Icon = step.icon;
          const isActive = step.num === currentStep;
          const isDone = step.num < currentStep;
          return (
            <div key={step.num} className="flex items-center">
              <div className={`flex flex-col items-center ${isActive ? "scale-110" : ""}`}>
                <div className={`w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all ${
                  isDone ? "bg-green-500 border-green-500 text-white" :
                  isActive ? "bg-primary border-primary text-primary-foreground shadow-lg" :
                  "bg-muted border-muted-foreground/30 text-muted-foreground"
                }`}>
                  {isDone ? <CheckCircle2 className="w-5 h-5" /> : <Icon className="w-5 h-5" />}
                </div>
                <span className={`text-[10px] mt-1 font-medium text-center max-w-[70px] leading-tight ${
                  isActive ? "text-primary" : isDone ? "text-green-600" : "text-muted-foreground"
                }`}>{step.label}</span>
              </div>
              {idx < steps.length - 1 && (
                <div className={`w-12 h-0.5 mx-1 mt-[-16px] ${isDone ? "bg-green-500" : "bg-muted-foreground/20"}`} />
              )}
            </div>
          );
        })}
      </div>
    );
  };

  // Item card component
  const ItemCard = ({ item, step, onAction }: { item: any; step: number; onAction: () => void }) => {
    const statusColors: Record<string, string> = {
      approved: "bg-blue-100 text-blue-800",
      funded: "bg-indigo-100 text-indigo-800",
      purchased: "bg-amber-100 text-amber-800",
      delivered_to_warehouse: "bg-emerald-100 text-emerald-800",
      delivered_to_requester: "bg-green-100 text-green-800",
    };
    const statusLabels: Record<string, string> = {
      approved: t.purchaseOrders.pendingPurchase,
      funded: t.purchaseOrders.pendingPurchase,
      purchased: t.purchaseOrders.pendingWarehouse,
      delivered_to_warehouse: t.purchaseOrders.pendingDelivery,
      delivered_to_requester: t.purchaseOrders.deliveredToRequester,
    };

    return (
      <Card className="hover:shadow-md transition-shadow border-l-4 border-l-primary/60">
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-semibold text-sm truncate">{item.itemName}</h3>
                <Badge variant="outline" className={`text-[10px] ${statusColors[item.status] || ""}`}>
                  {statusLabels[item.status] || item.status}
                </Badge>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span className="flex items-center gap-1"><Hash className="w-3 h-3" /> {t.purchaseOrders.quantity}: <strong className="text-foreground">{item.quantity} {item.unit}</strong></span>
                <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> {new Date(item.createdAt).toLocaleDateString(language === "ar" ? "ar-SA" : "en-US")}</span>
                {item.description && <span className="col-span-2 sm:col-span-1 truncate">{item.description}</span>}
              </div>

              {item.estimatedUnitCost && (
                <div className="text-xs text-muted-foreground">
                  {t.purchaseOrders.estimatedUnitCost}: <strong className="text-foreground">{parseFloat(item.estimatedUnitCost).toLocaleString()} ر.س</strong>
                </div>
              )}

              {/* Show photos if available */}
              <div className="flex gap-2 flex-wrap">
                {item.purchasedPhotoUrl && (
                  <img src={mediaUrl(item.purchasedPhotoUrl)} alt="purchased" className="w-12 h-12 object-cover rounded border cursor-pointer hover:opacity-80" onClick={() => window.open(mediaUrl(item.purchasedPhotoUrl), "_blank")} />
                )}
                {item.invoicePhotoUrl && (
                  <img src={mediaUrl(item.invoicePhotoUrl)} alt="invoice" className="w-12 h-12 object-cover rounded border cursor-pointer hover:opacity-80" onClick={() => window.open(mediaUrl(item.invoicePhotoUrl), "_blank")} />
                )}
                {item.warehousePhotoUrl && (
                  <img src={mediaUrl(item.warehousePhotoUrl)} alt="warehouse" className="w-12 h-12 object-cover rounded border cursor-pointer hover:opacity-80" onClick={() => window.open(mediaUrl(item.warehousePhotoUrl), "_blank")} />
                )}
              </div>
            </div>

            <Button size="sm" className="shrink-0 gap-1.5" onClick={onAction}>
              {step === 1 && <><ShoppingCart className="w-4 h-4" /> {t.purchaseOrders.confirmPurchase}</>}
              {step === 2 && <><Package className="w-4 h-4" /> {t.purchaseOrders.confirmDeliveryToWarehouse}</>}
              {step === 3 && <><Truck className="w-4 h-4" /> تسليم للفني</>}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  };

  // ── تبويب الوثائق ─────────────────────────────────────────

  // ── وثيقة تسليم المواد للفني ──────────────────────────────
  const printDeliveryReceipt = (data: {
    itemName: string;
    quantity: number;
    unit: string;
    supplierName?: string;
    actualUnitCost?: string;
    warehousePhotoUrl?: string;
    deliveredByName: string;
    deliveredToName: string;
    notes?: string;
    poNumber?: string;
    deliveryNumber?: string;
    deliveredAt: string;
    itemId: number;
    initialPrintCount?: number;
  }) => {
    const imgTag = data.warehousePhotoUrl
      ? `<div class="photo-wrap"><p class="photo-label">صورة الصنف</p><img src="${data.warehousePhotoUrl}" alt="صورة الصنف" /></div>`
      : "";

    const docTitle = (data.deliveryNumber || "سند-تسليم") + " — " + data.itemName;
    const initialCount = (data.initialPrintCount ?? 0) + 1;

    const html = `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
<meta charset="UTF-8"/>
<title>${docTitle}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Cairo', Arial, sans-serif; background: #f4f6fa; color: #1a1a1a; font-size: 13px; }

  /* ── toolbar (hidden in print) ── */
  .toolbar { background: #1e3a5f; padding: 12px 24px; display: flex; align-items: center; gap: 12px; }
  .toolbar-title { color: #fff; font-size: 14px; font-weight: 700; flex: 1; }
  .btn { display: inline-flex; align-items: center; gap: 6px; padding: 8px 18px; border-radius: 6px; font-family: inherit; font-size: 13px; font-weight: 600; cursor: pointer; border: none; }
  .btn-print { background: #fff; color: #1e3a5f; }
  .btn-pdf   { background: #e8f0fe; color: #1e3a5f; }
  .btn:hover { opacity: .88; }

  /* ── page ── */
  .page { background: #fff; max-width: 740px; margin: 24px auto; padding: 36px 44px; border-radius: 10px; box-shadow: 0 2px 12px rgba(0,0,0,.1); }
  .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #1e3a5f; padding-bottom: 14px; margin-bottom: 20px; }
  .header-title { font-size: 20px; font-weight: 700; color: #1e3a5f; }
  .header-sub { font-size: 11px; color: #555; margin-top: 4px; }
  .header-meta { text-align: left; font-size: 11px; color: #555; line-height: 2; }
  .badge { display: inline-block; background: #1e3a5f; color: #fff; padding: 3px 10px; border-radius: 4px; font-size: 13px; font-weight: 700; }
  .section { margin-bottom: 16px; }
  .section-title { font-size: 12px; font-weight: 700; color: #1e3a5f; background: #eef3f9; padding: 5px 10px; border-radius: 4px; margin-bottom: 10px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 24px; }
  .field { display: flex; flex-direction: column; gap: 2px; }
  .field-label { font-size: 10px; color: #777; }
  .field-value { font-size: 13px; font-weight: 600; color: #111; }
  .parties { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px; }
  .party-box { border: 1px solid #dde3ea; border-radius: 8px; padding: 12px 14px; }
  .party-role { font-size: 10px; color: #777; margin-bottom: 4px; }
  .party-name { font-size: 15px; font-weight: 700; color: #1e3a5f; }
  .photo-wrap { margin-top: 8px; }
  .photo-label { font-size: 10px; color: #777; margin-bottom: 6px; }
  .photo-wrap img { width: 140px; height: 140px; object-fit: cover; border-radius: 8px; border: 1px solid #dde3ea; }
  .sig-section { margin-top: 32px; display: grid; grid-template-columns: 1fr 1fr; gap: 32px; }
  .sig-box { border-top: 1px solid #bbb; padding-top: 8px; text-align: center; font-size: 11px; color: #555; }
  .footer { margin-top: 24px; border-top: 1px solid #eee; padding-top: 10px; display: flex; justify-content: space-between; align-items: center; font-size: 10px; color: #aaa; }
  .print-count { font-size: 11px; color: #888; background: #f4f6fa; border: 1px solid #dde3ea; border-radius: 20px; padding: 2px 12px; }

  @media print {
    .toolbar { display: none !important; }
    body { background: #fff; }
    .page { box-shadow: none; margin: 0; padding: 20px 28px; border-radius: 0; }
    @page { size: A4; margin: 10mm; }
  }
</style>
</head>
<body>

<div class="toolbar">
  <span class="toolbar-title">🚚 ${docTitle}</span>
  <button class="btn btn-print" onclick="doPrint()">🖨️ طباعة</button>
  <button class="btn btn-pdf"   onclick="doSavePDF()">⬇️ تنزيل PDF</button>
</div>

<div class="page" id="doc">
  <div class="header">
    <div>
      <div class="header-title">🚚 وثيقة تسليم مواد</div>
      <div class="header-sub">نظام إدارة الصيانة المتكامل</div>
    </div>
    <div class="header-meta">
      <div>التاريخ: <strong>${data.deliveredAt}</strong></div>
      ${data.deliveryNumber ? "<div><span class=\"badge\">" + data.deliveryNumber + "</span></div>" : ""}
      ${data.poNumber ? "<div>أمر شراء: <strong>" + data.poNumber + "</strong></div>" : ""}
    </div>
  </div>

  <div class="parties">
    <div class="party-box">
      <div class="party-role">المُسلِّم</div>
      <div class="party-name">${data.deliveredByName}</div>
    </div>
    <div class="party-box">
      <div class="party-role">المُستلِم (الفني)</div>
      <div class="party-name">${data.deliveredToName}</div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">بيانات الصنف</div>
    <div class="grid">
      <div class="field"><span class="field-label">اسم الصنف</span><span class="field-value">${data.itemName}</span></div>
      <div class="field"><span class="field-label">الكمية المسلَّمة</span><span class="field-value">${data.quantity} ${data.unit || ""}</span></div>
      ${data.supplierName ? "<div class=\"field\"><span class=\"field-label\">المورد</span><span class=\"field-value\">" + data.supplierName + "</span></div>" : ""}
      ${data.actualUnitCost ? "<div class=\"field\"><span class=\"field-label\">تكلفة الوحدة</span><span class=\"field-value\">" + parseFloat(data.actualUnitCost).toLocaleString() + " ر.س</span></div>" : ""}
      ${data.notes ? "<div class=\"field\" style=\"grid-column:1/-1\"><span class=\"field-label\">ملاحظات</span><span class=\"field-value\">" + data.notes + "</span></div>" : ""}
    </div>
    ${imgTag}
  </div>

  <div class="sig-section">
    <div class="sig-box">توقيع المُسلِّم<br/>${data.deliveredByName}</div>
    <div class="sig-box">توقيع المُستلِم<br/>${data.deliveredToName}</div>
  </div>

  <div class="footer">
    <span>وثيقة آلية — نظام CMMS</span>
    <span class="print-count" id="pc">عدد مرات الطباعة: <strong>${initialCount}</strong></span>
  </div>
</div>

<script>
  const ITEM_ID = ${data.itemId};
  let printCount = ${initialCount};

  async function incrementCount() {
    try {
      const res = await fetch('/api/trpc/purchaseOrders.incrementPrintCount', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ json: { itemId: ITEM_ID } })
      });
      const json = await res.json();
      printCount = json?.result?.data?.json?.printCount ?? printCount;
      document.getElementById('pc').innerHTML = 'عدد مرات الطباعة: <strong>' + printCount + '</strong>';
    } catch(e) { console.warn('count update failed', e); }
  }

  function doPrint() {
    incrementCount();
    window.print();
  }

  function doSavePDF() {
    incrementCount();
    document.title = '${docTitle}';
    const style = document.createElement('style');
    style.textContent = '.toolbar{display:none!important}';
    document.head.appendChild(style);
    window.print();
    setTimeout(() => style.remove(), 1000);
  }
<\/script>
</body>
</html>`;

    const win = window.open("", "_blank", "width=860,height=780");
    if (win) {
      win.document.write(html);
      win.document.close();
    }
  };



  return (
    <div className="space-y-6" dir={isRTL ? "rtl" : "ltr"}>
      {/* Hidden file input */}
      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={onFileSelect} />

      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <ShoppingCart className="w-6 h-6 text-primary" />
          {t.purchaseOrders.purchaseCycle}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {t.purchaseOrders.step1Purchase} → {t.purchaseOrders.step2Warehouse} → {t.purchaseOrders.step3Delivery}
        </p>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-6">
          <TabsTrigger value="estimate" className="gap-1.5">
            <Clock className="w-4 h-4" />
            <span className="hidden sm:inline">التسعير</span>
            {pendingEstimate.length > 0 && <Badge variant="destructive" className="text-[10px] px-1.5 py-0">{pendingEstimate.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="purchase" className="gap-1.5">
            <ShoppingCart className="w-4 h-4" />
            <span className="hidden sm:inline">{t.purchaseOrders.step1Purchase}</span>
            {pendingPurchase.length > 0 && <Badge variant="destructive" className="text-[10px] px-1.5 py-0">{pendingPurchase.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="warehouse" className="gap-1.5">
            <Package className="w-4 h-4" />
            <span className="hidden sm:inline">{t.purchaseOrders.step2Warehouse}</span>
            {pendingWarehouse.length > 0 && <Badge variant="destructive" className="text-[10px] px-1.5 py-0">{pendingWarehouse.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="inventory-entry" className="gap-1.5">
            <Archive className="w-4 h-4" />
            <span className="hidden sm:inline">إدخال المخزون</span>
            {Object.keys(groupedByInvoiceNumber).length > 0 && <Badge variant="destructive" className="text-[10px] px-1.5 py-0">{pendingDelivery.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="delivery" className="gap-1.5">
            <Truck className="w-4 h-4" />
            <span className="hidden sm:inline">{t.purchaseOrders.step3Delivery}</span>
            {(inventoryItems as any[]).length > 0 && <Badge variant="destructive" className="text-[10px] px-1.5 py-0">{(inventoryItems as any[]).length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="documents" className="gap-1.5">
            <FileText className="w-4 h-4" />
            <span className="hidden sm:inline">الوثائق</span>
          </TabsTrigger>
        </TabsList>

        {/* ==================== TAB 0: Estimate (Delegate - Revision Items) ==================== */}
        <TabsContent value="estimate" className="mt-4 space-y-4">
          <FilterBar search={searchEstimate} setSearch={v => { setSearchEstimate(v); setPageEstimate(1); }} from={dateFrom} setFrom={v => { setDateFrom(v); setPageEstimate(1); }} to={dateTo} setTo={v => { setDateTo(v); setPageEstimate(1); }} placeholder="بحث في الأصناف..." />
          {filterItems(sortByDate(pendingEstimate), searchEstimate, dateFrom, dateTo).length === 0 ? (
            <Card><CardContent className="p-8 text-center text-muted-foreground">
              <CheckCircle2 className="w-10 h-10 mx-auto mb-3 text-green-500" />
              <p className="font-medium">لا توجد أصناف بانتظار التسعير</p>
            </CardContent></Card>
          ) : (
            <><div className="space-y-3">
              {filterItems(sortByDate(pendingEstimate), searchEstimate, dateFrom, dateTo).slice((pageEstimate-1)*PAGE_SIZE, pageEstimate*PAGE_SIZE).map((item: any) => (
                <Card key={item.id} className="border-amber-200 bg-amber-50">
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">{item.itemName}</p>
                        {item.description && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{item.description}</p>}
                        <div className="flex flex-wrap gap-2 mt-1.5">
                          <Badge variant="outline" className="text-[10px]">الكمية: {item.quantity} {item.unit || ""}</Badge>
                          {item.purchaseOrderNumber && <Badge variant="outline" className="text-[10px]">{item.purchaseOrderNumber}</Badge>}
                        </div>
                        {item.itemRevisionNote && (
                          <div className="mt-2 text-xs bg-red-50 border border-red-200 rounded p-2 text-red-700">
                            <strong>سبب المراجعة السابقة:</strong> {item.itemRevisionNote}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2 items-end">
                      <div className="flex-1">
                        <Label className="text-xs text-amber-700">السعر التقديري للوحدة (ر.س)</Label>
                        <Input
                          type="number"
                          placeholder="0.00"
                          value={estimateValues[item.id] || ""}
                          onChange={e => setEstimateValues(p => ({ ...p, [item.id]: e.target.value }))}
                          className="mt-1 bg-white"
                        />
                      </div>
                      {estimateValues[item.id] && parseFloat(estimateValues[item.id]) > 0 && (
                        <div className="text-xs text-amber-700 pb-2">
                          = {(parseFloat(estimateValues[item.id]) * item.quantity).toLocaleString()} ر.س
                        </div>
                      )}
                      <Button
                        size="sm"
                        disabled={!estimateValues[item.id] || parseFloat(estimateValues[item.id]) <= 0 || estimateCostMut.isPending}
                        onClick={() => {
                          if (!estimateValues[item.id] || parseFloat(estimateValues[item.id]) <= 0) {
                            toast.error(t.purchaseOrders.enterPrice);
                            return;
                          }
                          estimateCostMut.mutate({
                            purchaseOrderId: item.purchaseOrderId,
                            items: [{ id: item.id, estimatedUnitCost: estimateValues[item.id] }]
                          });
                        }}
                        className="shrink-0"
                      >
                        {estimateCostMut.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : t.purchaseOrders.savePricing}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
            <Pagination total={filterItems(pendingEstimate, searchEstimate, dateFrom, dateTo).length} page={pageEstimate} setPage={setPageEstimate} /></>)}
        </TabsContent>

        {/* ==================== TAB 1: Purchase (Delegate) ==================== */}
        <TabsContent value="purchase" className="mt-4 space-y-4">
          <StepIndicator currentStep={1} />
          {pendingPurchase.length === 0 ? (
            <Card><CardContent className="p-8 text-center text-muted-foreground">
              <CheckCircle2 className="w-10 h-10 mx-auto mb-3 text-green-500" />
              <p className="font-medium">{t.purchaseOrders.noItemsPending}</p>
            </CardContent></Card>
          ) : (
            <><div className="space-y-3">
              {filterItems(sortByDate(pendingPurchase), searchPurchase, dateFrom, dateTo).slice((pagePurchase-1)*PAGE_SIZE, pagePurchase*PAGE_SIZE).map((item: any) => (
                <ItemCard key={item.id} item={item} step={1} onAction={() => {
                  setPurchasePhotos({});
                  setPurchaseDialog(item);
                }} />
              ))}
            </div>
            <Pagination total={filterItems(pendingPurchase, searchPurchase, dateFrom, dateTo).length} page={pagePurchase} setPage={setPagePurchase} /></>)}
        </TabsContent>

        {/* ==================== TAB 2: Warehouse Receiving ==================== */}
        <TabsContent value="warehouse" className="mt-4 space-y-4">
          <StepIndicator currentStep={2} />
          {pendingWarehouse.length === 0 ? (
            <Card><CardContent className="p-8 text-center text-muted-foreground">
              <CheckCircle2 className="w-10 h-10 mx-auto mb-3 text-green-500" />
              <p className="font-medium">{t.purchaseOrders.noItemsPending}</p>
            </CardContent></Card>
          ) : (
            <><div className="space-y-3">
              {filterItems(sortByDate(pendingWarehouse), searchWarehouse, dateFrom, dateTo).slice((pageWarehouse-1)*PAGE_SIZE, pageWarehouse*PAGE_SIZE).map((item: any) => (
                <ItemCard key={item.id} item={item} step={2} onAction={() => {
                  setWarehouseForm({ receivedQuantity: String(item.quantity || ""), supplierInvoiceNumber: "", warehousePhotoUrl: "" });
                  setWarehouseDialog(item);
                }} />
              ))}
            </div>
            <Pagination total={filterItems(pendingWarehouse, searchWarehouse, dateFrom, dateTo).length} page={pageWarehouse} setPage={setPageWarehouse} /></>)}
        </TabsContent>

        {/* ==================== TAB NEW: إدخال المخزون ==================== */}
        <TabsContent value="inventory-entry" className="mt-4 space-y-4">
          <StepIndicator currentStep={3} />
          {Object.keys(groupedByInvoiceNumber).length === 0 ? (
            <Card><CardContent className="p-8 text-center text-muted-foreground">
              <Archive className="w-10 h-10 mx-auto mb-3 text-muted-foreground/40" />
              <p className="font-medium">لا توجد أصناف بانتظار إدخال المخزون</p>
              <p className="text-xs mt-1">يجب أولاً تأكيد التوريد للمستودع</p>
            </CardContent></Card>
          ) : (
            <div className="space-y-4">
              {Object.entries(groupedByInvoiceNumber).map(([invoiceNumber, items]: [string, any]) => (
                <Card key={invoiceNumber} className="border-emerald-200">
                  <CardContent className="pt-4 pb-4">
                    {/* رأس المجموعة */}
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <Package className="w-4 h-4 text-emerald-600" />
                        <div>
                          <p className="font-semibold text-sm font-mono">{invoiceNumber}</p>
                          <p className="text-xs text-muted-foreground">{items.length} صنف من نفس الفاتورة</p>
                        </div>
                      </div>
                      <Button
                        size="sm"
                        className="gap-1.5 bg-emerald-600 hover:bg-emerald-700"
                        onClick={() => {
                          const poId = items[0]?.purchaseOrderId;
                          if (poId) window.location.href = `/warehouse/receive-v2?poId=${poId}&invoiceNumber=${encodeURIComponent(invoiceNumber)}`;
                        }}
                      >
                        <Sparkles className="w-3.5 h-3.5" />
                        رفع فاتورة المورد
                      </Button>
                    </div>
                    {/* قائمة الأصناف */}
                    <div className="space-y-1.5 border-t pt-3">
                      {items.map((item: any) => (
                        <div key={item.id} className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground truncate flex-1">{item.itemName}</span>
                          <span className="font-mono text-xs text-muted-foreground mr-2">
                            {item.receivedQuantity ?? item.quantity} {item.unit}
                          </span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ==================== TAB 3: Delivery to Assigned Technician ==================== */}
        <TabsContent value="delivery" className="mt-4 space-y-4">
          <StepIndicator currentStep={3} />

          {/* ── خانة البحث الذكية ── */}
          <div className="space-y-2 p-3 border rounded-lg bg-muted/20">
            <div className="flex gap-2">
              <Button size="sm" variant={deliverySearchMode === "name" ? "default" : "outline"} onClick={() => setDeliverySearchMode("name")} className="gap-1">
                <Search className="w-3.5 h-3.5" /> بالاسم
              </Button>
              <Button size="sm" variant={deliverySearchMode === "code" ? "default" : "outline"} onClick={() => setDeliverySearchMode("code")} className="gap-1">
                <Package className="w-3.5 h-3.5" /> بالرقم
              </Button>
              <Button size="sm" variant={deliverySearchMode === "qr" ? "default" : "outline"} onClick={() => setDeliverySearchMode("qr")} className="gap-1">
                <QrCode className="w-3.5 h-3.5" /> QR Code
              </Button>
              {searchDelivery && (
                <Button size="sm" variant="ghost" className="text-muted-foreground mr-auto" onClick={() => { setSearchDelivery(""); setDeliverySearchMode("name"); }}>
                  <X className="w-3.5 h-3.5" />
                </Button>
              )}
            </div>

            {deliverySearchMode === "qr" ? (
              <BarcodeScanner
                onScan={(code) => {
                  setSearchDelivery(code);
                  setDeliverySearchMode("name");
                }}
                placeholder="امسح QR Code الصنف..."
              />
            ) : (
              <div className="relative">
                <input
                  className="w-full border rounded-md px-3 py-1.5 text-sm pr-8 focus:outline-none focus:ring-1 focus:ring-primary"
                  placeholder={deliverySearchMode === "name" ? "ابحث باسم الصنف..." : "ابحث برقم الصنف أو الباركود..."}
                  value={searchDelivery}
                  onChange={e => { setSearchDelivery(e.target.value); setPageDelivery(1); }}
                />
                <Search className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              </div>
            )}
          </div>
          {filterDeliveryItems(inventoryItems as any[], searchDelivery).length === 0 ? (
            <Card><CardContent className="p-8 text-center text-muted-foreground">
              <CheckCircle2 className="w-10 h-10 mx-auto mb-3 text-green-500" />
              <p className="font-medium">{t.purchaseOrders.noItemsPending}</p>
              <p className="text-xs mt-1">لا توجد أصناف في المخزون جاهزة للتسليم</p>
            </CardContent></Card>
          ) : (
            <><div className="space-y-3">
              {filterDeliveryItems(inventoryItems as any[], searchDelivery).slice((pageDelivery-1)*PAGE_SIZE, pageDelivery*PAGE_SIZE).map((item: any) => (
                <Card key={item.id} className="hover:shadow-md transition-shadow">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        {/* اسم الصنف من OCR */}
                        <p className="font-medium text-sm">{item.itemName}</p>
                        {item.itemName_en && <p className="text-xs text-muted-foreground">{item.itemName_en}</p>}
                        <div className="flex flex-wrap gap-2 mt-1.5 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Package className="w-3 h-3" />
                            {item.quantity} {item.unit}
                          </span>
                          {item.vendorName && (
                            <span className="flex items-center gap-1">
                              🏪 {item.vendorName}
                            </span>
                          )}
                          {item.poNumber && (
                            <span className="font-mono text-[10px] bg-muted px-1.5 py-0.5 rounded">
                              {item.poNumber}
                            </span>
                          )}
                          {item.averageCost > 0 && (
                            <span className="font-mono">{parseFloat(item.averageCost).toFixed(2)} ر.س</span>
                          )}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        className="gap-1.5 shrink-0"
                        onClick={() => {
                          const preselect = item.ticketAssignedToId ? String(item.ticketAssignedToId) : "";
                          setDeliveryUserId(preselect);
                          setDeliveryQty(String(item.quantity || ""));
                          setDeliveryUnit(item.unit || "قطعة");
                          setDeliveryNotes("");
                          // نمرر بيانات الصنف من المخزون للـ dialog
                          setDeliveryDialog({
                            ...item,
                            id:           item.id,
                            itemName:     item.itemName,
                            quantity:     item.quantity,
                            unit:         item.unit,
                            supplierName: item.vendorName,
                            actualUnitCost: item.averageCost,
                            isInventoryItem: true,
                          });
                        }}
                      >
                        <Truck className="w-3.5 h-3.5" />
                        تسليم للفني
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}


            </div>
            <Pagination total={filterDeliveryItems(inventoryItems as any[], searchDelivery).length} page={pageDelivery} setPage={setPageDelivery} /></>)}
        </TabsContent>

        {/* ==================== TAB 5: Delivery Documents ==================== */}
        <TabsContent value="documents" className="mt-4">
          <DeliveryDocumentsTab deliveryDocsQuery={deliveryDocsQuery} returnDocsQuery={returnDocsQuery} searchDocs={searchDocs} setSearchDocs={setSearchDocs} docRecipient={docRecipient} setDocRecipient={setDocRecipient} docDateFrom={docDateFrom} setDocDateFrom={setDocDateFrom} docDateTo={docDateTo} setDocDateTo={setDocDateTo} pageDocs={pageDocs} setPageDocs={setPageDocs} incrementDocPrintMut={incrementDocPrintMut} incrementReturnDocPrintMut={incrementReturnDocPrintMut} />
        </TabsContent>
      </Tabs>

      {/* ==================== DIALOG 1: Purchase Confirmation ==================== */}
      <Dialog open={!!purchaseDialog} onOpenChange={(open) => !open && setPurchaseDialog(null)}>
        <DialogContent className="max-w-md" dir={isRTL ? "rtl" : "ltr"}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShoppingCart className="w-5 h-5 text-primary" />
              {t.purchaseOrders.confirmPurchase}
            </DialogTitle>
          </DialogHeader>

          {purchaseDialog && (
            <div className="space-y-4">
              {/* Item info */}
              <div className="bg-muted/50 rounded-lg p-3 space-y-1">
                <p className="font-semibold text-sm">{purchaseDialog.itemName}</p>
                <p className="text-xs text-muted-foreground">{t.purchaseOrders.quantity}: {purchaseDialog.quantity} {purchaseDialog.unit}</p>
                {purchaseDialog.description && <p className="text-xs text-muted-foreground">{purchaseDialog.description}</p>}
              </div>

              {/* Photo uploads */}
              <div className="grid grid-cols-2 gap-4">
                {/* Purchased item photo */}
                <div className="space-y-2">
                  <Label className="text-xs font-medium flex items-center gap-1">
                    <Camera className="w-3.5 h-3.5" /> {t.purchaseOrders.purchasedItemPhoto} *
                  </Label>
                  {purchasePhotos.purchased ? (
                    <div className="relative">
                      <img src={purchasePhotos.purchased} alt="purchased" className="w-full h-28 object-cover rounded-lg border" />
                      <Button size="sm" variant="destructive" className="absolute top-1 end-1 h-6 w-6 p-0" onClick={() => setPurchasePhotos(p => ({ ...p, purchased: undefined }))}>×</Button>
                    </div>
                  ) : (
                    <Button variant="outline" className="w-full h-28 flex flex-col gap-2 border-dashed" onClick={() => triggerUpload("purchased")} disabled={uploading === "purchased"}>
                      {uploading === "purchased" ? <Loader2 className="w-6 h-6 animate-spin" /> : <><ImageIcon className="w-6 h-6 text-muted-foreground" /><span className="text-[10px] text-muted-foreground">{t.common.upload}</span></>}
                    </Button>
                  )}
                </div>

                {/* Invoice photo */}
                <div className="space-y-2">
                  <Label className="text-xs font-medium flex items-center gap-1">
                    <FileText className="w-3.5 h-3.5" /> {t.purchaseOrders.invoicePhoto} *
                  </Label>
                  {purchasePhotos.invoice ? (
                    <div className="relative">
                      <img src={purchasePhotos.invoice} alt="invoice" className="w-full h-28 object-cover rounded-lg border" />
                      <Button size="sm" variant="destructive" className="absolute top-1 end-1 h-6 w-6 p-0" onClick={() => setPurchasePhotos(p => ({ ...p, invoice: undefined }))}>×</Button>
                    </div>
                  ) : (
                    <Button variant="outline" className="w-full h-28 flex flex-col gap-2 border-dashed" onClick={() => triggerUpload("invoice")} disabled={uploading === "invoice"}>
                      {uploading === "invoice" ? <Loader2 className="w-6 h-6 animate-spin" /> : <><FileText className="w-6 h-6 text-muted-foreground" /><span className="text-[10px] text-muted-foreground">{t.common.upload}</span></>}
                    </Button>
                  )}
                </div>
              </div>
            </div>
          )}

          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button
              variant="outline"
              className="hidden gap-1.5 border-red-200 text-red-700 hover:bg-red-50 w-full sm:w-auto"
              onClick={() => {
                setCancelNote("");
                setCancelDialog(purchaseDialog);
                setPurchaseDialog(null);
              }}
            >
              <Ban className="w-4 h-4" />
              إلغاء الشراء
            </Button>
            <div className="flex-1" />
            <Button variant="outline" onClick={() => setPurchaseDialog(null)}>{t.common.cancel}</Button>
            <Button
              className="gap-1.5"
              disabled={!purchasePhotos.purchased || !purchasePhotos.invoice || confirmPurchaseMut.isPending}
              onClick={() => {
                if (!purchasePhotos.purchased || !purchasePhotos.invoice) {
                  toast.error(t.purchaseOrders.uploadRequired);
                  return;
                }
                confirmPurchaseMut.mutate({
                  itemId: purchaseDialog.id,
                  purchasedPhotoUrl: purchasePhotos.purchased,
                  invoicePhotoUrl: purchasePhotos.invoice,
                });
                setPurchaseDialog(null);
              }}
            >
              {confirmPurchaseMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              {t.purchaseOrders.confirmPurchase}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ==================== DIALOG: Cancel Purchase ==================== */}
      <Dialog open={!!cancelDialog} onOpenChange={(open) => !open && setCancelDialog(null)}>
        <DialogContent className="max-w-md" dir={isRTL ? "rtl" : "ltr"}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-700">
              <Ban className="w-5 h-5" />
              إلغاء شراء الصنف
            </DialogTitle>
          </DialogHeader>
          {cancelDialog && (
            <div className="space-y-4">
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 space-y-1">
                <p className="font-semibold text-sm">{cancelDialog.itemName}</p>
                <p className="text-xs text-muted-foreground">{t.purchaseOrders.quantity}: {cancelDialog.quantity} {cancelDialog.unit}</p>
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-medium">{t.purchaseOrders.revisionReason} *</Label>
                <Textarea
                  placeholder={t.purchaseOrders.cancelPurchaseReason}
                  value={cancelNote}
                  onChange={(e) => setCancelNote(e.target.value)}
                  rows={4}
                  className="resize-none"
                />
                <p className="text-[11px] text-muted-foreground">{t.purchaseOrders.cancelItemWillReturn}</p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelDialog(null)}>{t.common.cancel}</Button>
            <Button
              variant="destructive"
              className="gap-1.5"
              disabled={cancelNote.trim().length < 3 || cancelPurchaseMut.isPending}
              onClick={() => {
                if (cancelNote.trim().length < 3) { toast.error(t.purchaseOrders.cancelReasonRequired); return; }
                cancelPurchaseMut.mutate({ itemId: cancelDialog.id, note: cancelNote });
              }}
            >
              {cancelPurchaseMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Ban className="w-4 h-4" />}
              {t.common.confirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ==================== DIALOG 2: Warehouse Receiving ==================== */}
      <Dialog open={!!warehouseDialog} onOpenChange={(open) => !open && setWarehouseDialog(null)}>
        <DialogContent className="max-w-md" dir={isRTL ? "rtl" : "ltr"}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Package className="w-5 h-5 text-emerald-600" />
              {t.purchaseOrders.confirmDeliveryToWarehouse}
            </DialogTitle>
          </DialogHeader>

          {warehouseDialog && (
            <div className="space-y-4">
              {/* Item info */}
              <div className="bg-muted/50 rounded-lg p-3 space-y-1">
                <p className="font-semibold text-sm">{warehouseDialog.itemName}</p>
                <p className="text-xs text-muted-foreground">{t.purchaseOrders.quantity}: {warehouseDialog.quantity} {warehouseDialog.unit}</p>
              </div>

              {/* Show purchase photos */}
              {(warehouseDialog.purchasedPhotoUrl || warehouseDialog.invoicePhotoUrl) && (
                <div className="flex gap-2">
                  {warehouseDialog.purchasedPhotoUrl && (
                    <div className="flex-1">
                      <p className="text-[10px] text-muted-foreground mb-1">{t.purchaseOrders.purchasedItemPhoto}</p>
                      <img src={mediaUrl(warehouseDialog.purchasedPhotoUrl)} alt="purchased" className="w-full h-20 object-cover rounded border cursor-pointer" onClick={() => window.open(mediaUrl(warehouseDialog.purchasedPhotoUrl), "_blank")} />
                    </div>
                  )}
                  {warehouseDialog.invoicePhotoUrl && (
                    <div className="flex-1">
                      <p className="text-[10px] text-muted-foreground mb-1">{t.purchaseOrders.invoicePhoto}</p>
                      <img src={mediaUrl(warehouseDialog.invoicePhotoUrl)} alt="invoice" className="w-full h-20 object-cover rounded border cursor-pointer" onClick={() => window.open(mediaUrl(warehouseDialog.invoicePhotoUrl), "_blank")} />
                    </div>
                  )}
                </div>
              )}

              {/* Form fields */}
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">{t.purchaseOrders.quantity} *</Label>
                  <Input type="number" min={1} value={warehouseForm.receivedQuantity} onChange={e => setWarehouseForm(p => ({ ...p, receivedQuantity: e.target.value }))} placeholder="0" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">رقم فاتورة المورد *</Label>
                  <Input value={warehouseForm.supplierInvoiceNumber} onChange={e => setWarehouseForm(p => ({ ...p, supplierInvoiceNumber: e.target.value }))} placeholder="رقم فاتورة المورد" dir="ltr" className="font-mono" />
                  <p className="text-[10px] text-muted-foreground">يُستخدم لاحقاً لتجميع الأصناف من نفس الفاتورة عند إدخال المخزون</p>
                </div>

                {/* Warehouse photo */}
                <div className="space-y-1.5">
                  <Label className="text-xs flex items-center gap-1"><Camera className="w-3.5 h-3.5" /> {t.purchaseOrders.warehousePhoto} *</Label>
                  {warehouseForm.warehousePhotoUrl ? (
                    <div className="relative">
                      <img src={mediaUrl(warehouseForm.warehousePhotoUrl)} alt="warehouse" className="w-full h-32 object-cover rounded-lg border" />
                      <Button size="sm" variant="destructive" className="absolute top-1 end-1 h-6 w-6 p-0" onClick={() => setWarehouseForm(p => ({ ...p, warehousePhotoUrl: "" }))}>×</Button>
                    </div>
                  ) : (
                    <Button variant="outline" className="w-full h-24 flex flex-col gap-2 border-dashed" onClick={() => triggerUpload("warehouse")} disabled={uploading === "warehouse"}>
                      {uploading === "warehouse" ? <Loader2 className="w-6 h-6 animate-spin" /> : <><Camera className="w-6 h-6 text-muted-foreground" /><span className="text-[10px] text-muted-foreground">{t.common.upload}</span></>}
                    </Button>
                  )}
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setWarehouseDialog(null)}>{t.common.cancel}</Button>
            <Button
              className="gap-1.5"
              disabled={!warehouseForm.receivedQuantity || parseFloat(warehouseForm.receivedQuantity) <= 0 || !warehouseForm.supplierInvoiceNumber || !warehouseForm.warehousePhotoUrl || confirmWarehouseMut.isPending}
              onClick={() => {
                confirmWarehouseMut.mutate({
                  itemId: warehouseDialog.id,
                  receivedQuantity: parseFloat(warehouseForm.receivedQuantity),
                  supplierInvoiceNumber: warehouseForm.supplierInvoiceNumber,
                  warehousePhotoUrl: warehouseForm.warehousePhotoUrl,
                });
                setWarehouseDialog(null);
              }}
            >
              {confirmWarehouseMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Package className="w-4 h-4" />}
              {t.purchaseOrders.confirmDeliveryToWarehouse}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ==================== DIALOG 3: Delivery to Assigned Technician ==================== */}
      <Dialog open={!!deliveryDialog} onOpenChange={(open) => !open && setDeliveryDialog(null)}>
        <DialogContent className="max-w-md" dir={isRTL ? "rtl" : "ltr"}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Truck className="w-5 h-5 text-blue-600" />
              تسليم للفني المسند
            </DialogTitle>
          </DialogHeader>

          {deliveryDialog && (
            <div className="space-y-4">
              {/* Item info */}
              <div className="bg-muted/50 rounded-lg p-3 space-y-2">
                <p className="font-semibold text-sm">{deliveryDialog.itemName}</p>
                <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                  <span>{t.purchaseOrders.quantity}: <strong className="text-foreground">{deliveryDialog.quantity} {deliveryDialog.unit}</strong></span>
                  {deliveryDialog.supplierName && <span>{t.purchaseOrders.supplier}: <strong className="text-foreground">{deliveryDialog.supplierName}</strong></span>}
                  {deliveryDialog.actualUnitCost && <span>{t.purchaseOrders.itemCost}: <strong className="text-foreground">{parseFloat(deliveryDialog.actualUnitCost).toLocaleString()} ر.س</strong></span>}
                </div>
              </div>

              {/* Show all photos */}
              <div className="flex gap-2 flex-wrap">
                {deliveryDialog.purchasedPhotoUrl && (
                  <div>
                    <p className="text-[10px] text-muted-foreground mb-1">{t.purchaseOrders.purchasedItemPhoto}</p>
                    <img src={mediaUrl(deliveryDialog.purchasedPhotoUrl)} alt="purchased" className="w-16 h-16 object-cover rounded border cursor-pointer" onClick={() => window.open(mediaUrl(deliveryDialog.purchasedPhotoUrl), "_blank")} />
                  </div>
                )}
                {deliveryDialog.invoicePhotoUrl && (
                  <div>
                    <p className="text-[10px] text-muted-foreground mb-1">{t.purchaseOrders.invoicePhoto}</p>
                    <img src={mediaUrl(deliveryDialog.invoicePhotoUrl)} alt="invoice" className="w-16 h-16 object-cover rounded border cursor-pointer" onClick={() => window.open(mediaUrl(deliveryDialog.invoicePhotoUrl), "_blank")} />
                  </div>
                )}
                {deliveryDialog.warehousePhotoUrl && (
                  <div>
                    <p className="text-[10px] text-muted-foreground mb-1">{t.purchaseOrders.warehousePhoto}</p>
                    <img src={mediaUrl(deliveryDialog.warehousePhotoUrl)} alt="warehouse" className="w-16 h-16 object-cover rounded border cursor-pointer" onClick={() => window.open(mediaUrl(deliveryDialog.warehousePhotoUrl), "_blank")} />
                  </div>
                )}
              </div>

              {/* الكمية والوحدة */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">الكمية المُسلَّمة *</Label>
                  <Input
                    type="number"
                    min={0.001}
                    step={0.5}
                    dir="ltr"
                    placeholder="0"
                    value={deliveryQty}
                    onChange={e => setDeliveryQty(e.target.value)}
                    className="font-mono"
                  />
                  {deliveryQty && parseFloat(deliveryQty) <= 0 && (
                    <p className="text-xs text-destructive">الكمية يجب أن تكون أكبر من صفر</p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">الوحدة</Label>
                  <Input
                    value={deliveryUnit}
                    onChange={e => setDeliveryUnit(e.target.value)}
                    placeholder="قطعة / كيلو / كرتون"
                  />
                </div>
              </div>

              {/* Select technician to deliver to - preselected from ticket assignment */}
              <div className="space-y-1.5">
                <Label className="text-xs flex items-center gap-1"><User className="w-3.5 h-3.5" /> الفني المسند</Label>
                {deliveryDialog.ticketAssignedToId && (
                  <p className="text-xs text-emerald-600 font-medium">
                    ✅ تم تحديد الفني تلقائيًا من بيانات البلاغ
                  </p>
                )}
                <TechnicianCombobox
                  value={deliveryUserId}
                  onValueChange={setDeliveryUserId}
                  placeholder={t.common.technician + "..."}
                  options={allUsers
                    .filter((u: any) => u.role === "technician" || u.role === "supervisor" || u.role === "maintenance_manager")
                    .map((u: any) => ({
                      value: String(u.id),
                      label: `${u.name} (${u.role})`,
                    }))}
                />
              </div>

              {/* ملاحظات — تظهر بعد اختيار الفني، كتابتها اختيارية */}
              {deliveryUserId && (
                <div className="space-y-1.5">
                  <Label className="text-xs">ملاحظات (اختياري)</Label>
                  <Textarea
                    value={deliveryNotes}
                    onChange={e => setDeliveryNotes(e.target.value)}
                    placeholder="أي ملاحظات إضافية على عملية التسليم..."
                    rows={2}
                  />
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => { setDeliveryDialog(null); setDeliveryNotes(""); }}>{t.common.cancel}</Button>
            <Button
              className="gap-1.5"
              disabled={confirmDeliveryMut.isPending}
              onClick={() => {
                // التحقق من الكمية أولاً
                const qty = parseFloat(deliveryQty);
                if (!deliveryQty || isNaN(qty) || qty <= 0) {
                  toast.error("يرجى إدخال كمية صحيحة أكبر من صفر");
                  return;
                }
                if (qty > (deliveryDialog.quantity || 0)) {
                  toast.error(`الكمية المطلوبة (${qty}) أكبر من الكمية المتاحة (${deliveryDialog.quantity})`);
                  return;
                }
                // حفظ بيانات الطباعة
                const selectedUser = allUsers.find((u: any) => String(u.id) === deliveryUserId);
                setDeliveryPrintData({
                  itemName: deliveryDialog.itemName,
                  quantity: qty,
                  unit: deliveryUnit || deliveryDialog.unit || "",
                  supplierName: deliveryDialog.supplierName,
                  actualUnitCost: deliveryDialog.actualUnitCost,
                  warehousePhotoUrl: deliveryDialog.warehousePhotoUrl ? mediaUrl(deliveryDialog.warehousePhotoUrl) : undefined,
                  deliveredByName: user?.name || "مستخدم المستودع",
                  deliveredToName: selectedUser?.name || "الفني",
                  poNumber: deliveryDialog.poNumber,
                  itemId: deliveryDialog.id,
                  initialPrintCount: deliveryDialog.printCount ?? 0,
                  notes: deliveryNotes || undefined,
                  deliveredAt: new Date().toLocaleDateString("ar-SA", { year: "numeric", month: "long", day: "numeric" }),
                });
                if (deliveryDialog.isInventoryItem) {
                  deliverInventoryMut.mutate({
                    inventoryId:   deliveryDialog.id,
                    deliveredToId: deliveryUserId ? parseInt(deliveryUserId) : undefined,
                    deliveryQty:   qty,
                    deliveryUnit:  deliveryUnit || deliveryDialog.unit || "قطعة",
                    notes:         deliveryNotes || undefined,
                  });
                } else {
                  confirmDeliveryMut.mutate({
                    itemId:        deliveryDialog.id,
                    deliveredToId: deliveryUserId ? parseInt(deliveryUserId) : undefined,
                    deliveryQty:   qty,
                    deliveryUnit:  deliveryUnit || deliveryDialog.unit || "قطعة",
                    notes:         deliveryNotes || undefined,
                  });
                }
                setDeliveryDialog(null);
                setDeliveryNotes("");
              }}
            >
              {confirmDeliveryMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Truck className="w-4 h-4" />}
              تأكيد التسليم للفني
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
