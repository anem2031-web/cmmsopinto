import { trpc } from "@/lib/trpc";
import QRCode from "qrcode";
import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowRight, RotateCcw, FileText, Loader2, Plus } from "lucide-react";

function fmtDate(d: any) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("ar-SA", { year: "numeric", month: "short", day: "numeric" });
}

// طباعة وثيقة المرتجع — نفس القالب المستخدم بتبويب "التوثيق"
async function printReturnDocument(doc: any, onPrinted: () => void) {
  onPrinted();
  // نفتح النافذة فوراً (متزامن مع الضغطة) لتفادي حظر المتصفح للنوافذ
  // المنبثقة، ثم نكتب المحتوى بعد جهوزية الـQR
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
@media print{@page{margin:10mm}}
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
}

export default function WarehouseReturnsList() {
  const [, navigate] = useLocation();
  const { data: docs, isLoading } = trpc.returnDocuments.list.useQuery();
  const incrementPrintMut = trpc.returnDocuments.incrementPrint.useMutation();

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate("/inventory")}>
          <ArrowRight className="w-5 h-5" />
        </Button>
        <div className="flex-1">
          <h1 className="text-xl font-bold">المرتجعات</h1>
          <p className="text-sm text-muted-foreground">كل عمليات الإرجاع المحفوظة</p>
        </div>
        <Button size="sm" className="gap-1.5" onClick={() => navigate("/warehouse/return")}>
          <Plus className="w-4 h-4" /> مرتجع جديد
        </Button>
      </div>

      {isLoading && (
        <Card><CardContent className="p-8 text-center text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin mx-auto" />
        </CardContent></Card>
      )}

      {!isLoading && (!docs || docs.length === 0) && (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            <RotateCcw className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="font-medium">لا توجد مرتجعات بعد</p>
          </CardContent>
        </Card>
      )}

      {!isLoading && docs && docs.length > 0 && (
        <div className="space-y-3">
          {docs.map((doc: any) => (
            <Card key={doc.id} className="border-r-4 border-r-red-700/60">
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0 space-y-1">
                    <p className="font-semibold text-base truncate">↩️ {doc.itemName}</p>
                    <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                      <span className="bg-red-50 text-red-700 font-bold px-2 py-0.5 rounded">
                        {doc.returnNumber}
                      </span>
                      <span>{fmtDate(doc.createdAt)}</span>
                      <span>نفّذ الإرجاع: {doc.returnedByName}</span>
                      <span>الكمية: {doc.returnedQuantity} {doc.unit || ""}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {doc.receiptNumber ? `مرتبط بسند ${doc.receiptNumber}` : "إرجاع عام بلا سند معروف"}
                      {doc.poNumber ? ` · طلب ${doc.poNumber}` : ""}
                    </p>
                    <p className="text-xs text-muted-foreground">السبب: {doc.reason}</p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5 shrink-0"
                    onClick={() => printReturnDocument(doc, () => incrementPrintMut.mutate({ id: doc.id }))}
                  >
                    <FileText className="w-4 h-4" /> طباعة الوثيقة
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
