import { isDelegateRole } from "@shared/roles";
import { ExternalWorkshopPricingFields, externalWorkshopForm, externalWorkshopIssue, externalWorkshopPayload, type ExternalWorkshopForm } from "@/components/purchase/ExternalWorkshopPricingFields";
import { externalMaintenanceLabels } from "@/i18n/externalMaintenanceFollowup";
import { isItTeamRole, MAINTENANCE_RESPONSIBLE_DEPARTMENT } from "@shared/roles";
import { useState, useRef } from "react";
import QRCode from "qrcode";
import { mediaUrl } from "@/lib/mediaUrl";
import { trpc } from "@/lib/trpc";
import { independentReadOptions } from "@/lib/read-transport";
import { refreshPurchaseExecution, purchaseRefreshNotice } from "@/lib/purchaseExecutionRefresh";
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
  IssueCostAllocationEditor,
  buildIssueCostAllocationPayload,
  createIssueCostAllocationDraft,
  type IssueCostAllocationDraft,
} from "@/components/inventory/IssueCostAllocationEditor";
import {
  ShoppingCart, Package, Truck, CheckCircle2, Camera, Loader2,
  Clock, ArrowLeft, ArrowRight, Image as ImageIcon, FileText,
  AlertCircle, User, Hash, Calendar, Ban, Archive, Sparkles,
  Search, QrCode, X, Send, Boxes,
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { printDeliveryReceipt } from "@/lib/printDeliveryDocument";
import { documentSignatureHtml } from "@/lib/documentSignatureHtml";
import { sortPurchaseCycleItemsNewestFirst } from "./purchaseCycleSorting";
import { localizeApiError } from "@/i18n/apiError";
import { EntityTranslatedText } from "@/components/i18n/EntityTranslatedText";
import { useBatchTranslation, getLocalizedItemField } from "@/hooks/useContentTranslation";
import { getLocalizedCatalogUnitName } from "@/i18n/catalogMasterData";
import { formatAvailableDuration, formatDateOnly, getAvailableCalendarDays } from "@/lib/purchaseItemTiming";

// ── مكوّنات مستقلة (خارج الـ component لمنع إعادة الإنشاء) ──────

const PAGE_SIZE = 10;

function Pagination({ total, page, setPage }: { total: number; page: number; setPage: (p: number) => void }) {
  const { dir } = useTranslation();
  const pages = Math.ceil(total / PAGE_SIZE);
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-center gap-1 mt-3">
      <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(page - 1)}>
        {dir === "rtl" ? "→" : "←"}
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
        {dir === "rtl" ? "←" : "→"}
      </Button>
    </div>
  );
}

// ── مكوّن خانة البحث والتاريخ ───────────────────────────────
function FilterBar({
  search, setSearch, from, setFrom, to, setTo, placeholder
}: {
  search: string; setSearch: (v: string) => void;
  from?: string; setFrom?: (v: string) => void;
  to?: string;   setTo?:   (v: string) => void;
  placeholder?: string;
}) {
  const { t, dir } = useTranslation();
  const effectivePlaceholder = placeholder || t.workflow.purchase.search;
  return (
    <div className="flex flex-wrap gap-2 mb-3">
      <div className="relative flex-1 min-w-[180px]">
        <input
          dir="auto"
          className={`w-full border rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary ${dir === "rtl" ? "pr-8" : "pl-8"}`}
          placeholder={effectivePlaceholder}
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <span className={`absolute top-1/2 -translate-y-1/2 text-muted-foreground text-xs ${dir === "rtl" ? "right-2.5" : "left-2.5"}`}>🔍</span>
      </div>
      {setFrom && (
        <input type="date" dir="ltr" className="border rounded-md px-2 py-1.5 text-sm" value={from} onChange={e => { setFrom(e.target.value); }} />
      )}
      {setTo && (
        <input type="date" dir="ltr" className="border rounded-md px-2 py-1.5 text-sm" value={to} onChange={e => { setTo(e.target.value); }} />
      )}
      {(search || from || to) && (
        <Button variant="ghost" size="sm" className="text-xs text-muted-foreground" onClick={() => { setSearch(""); if(setFrom) setFrom(""); if(setTo) setTo(""); }}>
          {t.workflow.purchase.clear}
        </Button>
      )}
    </div>
  );
}


function DeliveryDocumentsTab({ deliveryDocsQuery, returnDocsQuery, searchDocs, setSearchDocs, docRecipient, setDocRecipient, docDateFrom, setDocDateFrom, docDateTo, setDocDateTo, pageDocs, setPageDocs, incrementDocPrintMut, incrementReturnDocPrintMut }: any) {
  const { t, language, dir } = useTranslation();
  const utils = trpc.useUtils();
  const locale = language === "ar" ? "ar-SA" : language === "ur" ? "ur-PK" : "en-US";
  const { data: catalogUnits = [] } = trpc.catalog.units.list.useQuery();
  const displayUnit = (value: string | null | undefined) =>
    getLocalizedCatalogUnitName(value, catalogUnits as any[], language);
  const rawDeliveryDocs = deliveryDocsQuery.data ?? [];
  const rawReturnDocs = returnDocsQuery?.data ?? [];
  const deliveryDocIds = rawDeliveryDocs.map((d: any) => Number(d.id)).filter((id: number) => Number.isFinite(id));
  const returnDocIds = rawReturnDocs.map((d: any) => Number(d.id)).filter((id: number) => Number.isFinite(id));
  const { translationsMap: deliveryDocTranslations } = useBatchTranslation(
    "DELIVERY_DOCUMENT",
    deliveryDocIds,
    ["itemName", "notes"],
  );
  const { translationsMap: returnDocTranslations } = useBatchTranslation(
    "RETURN_DOCUMENT",
    returnDocIds,
    ["itemName", "reason"],
  );
  const deliveryDocs = rawDeliveryDocs.map((d: any) => ({
    ...d,
    itemName: deliveryDocTranslations[Number(d.id)]?.itemName || d.itemName,
    notes: deliveryDocTranslations[Number(d.id)]?.notes || d.notes,
    docType: "delivery" as const,
  }));
  const returnDocsRaw = rawReturnDocs.map((d: any) => ({
    ...d,
    itemName: returnDocTranslations[Number(d.id)]?.itemName || d.itemName,
    reason: returnDocTranslations[Number(d.id)]?.reason || d.reason,
    docType: "return" as const,
  }));
  const docs = sortPurchaseCycleItemsNewestFirst([...deliveryDocs, ...returnDocsRaw]);

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
<html dir="${dir}" lang="${language}">
<head><meta charset="UTF-8"/><title>${doc.returnNumber}</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700&display=swap');
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:${dir === "rtl" ? "'Cairo',Arial,sans-serif" : "Arial,sans-serif"};background:#fff;color:#1a1a1a;padding:32px 40px;font-size:13px}
.header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #7f1d1d;padding-bottom:14px;margin-bottom:20px}
.header-title{font-size:20px;font-weight:700;color:#7f1d1d}
.header-sub{font-size:11px;color:#555;margin-top:4px}
.header-meta{text-align:start;font-size:11px;color:#555;line-height:2}
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
    <div class="header-title">↩️ ${t.workflow.purchase.docReturnTitle}</div>
    <div class="header-sub">${t.workflow.purchase.integratedCmms}</div>
  </div>
  <div class="header-meta">
    <div>${t.workflow.purchase.dateWord}: <strong>${new Date(doc.createdAt).toLocaleDateString(locale,{year:"numeric",month:"long",day:"numeric"})}</strong></div>
    <div><span class="badge">${doc.returnNumber}</span></div>
    ${doc.poNumber ? `<div>${t.workflow.purchase.purchaseOrderWord}: <strong>${doc.poNumber}</strong></div>` : ""}
  </div>
</div>
${qrDataUrl ? `<div class="item-id-row">
  <img src="${qrDataUrl}" width="90" height="90" style="border:1px solid #eee;border-radius:6px"/>
  <div>
    <div class="field-label">${t.workflow.purchase.manufacturerBarcode}</div>
    <div class="field-value" style="font-size:16px;font-family:monospace">${doc.manufacturerBarcode || doc.internalCode || "—"}</div>
  </div>
</div>` : ""}
<div class="section">
  <div class="section-title">${t.workflow.purchase.returnData}</div>
  <div class="grid">
    <div class="field"><span class="field-label">${t.workflow.purchase.itemNameLabel}</span><span class="field-value">${doc.itemName}</span></div>
    <div class="field"><span class="field-label">${t.workflow.purchase.returnedQuantity}</span><span class="field-value">${doc.returnedQuantity} ${doc.unit||""}</span></div>
    <div class="field"><span class="field-label">${t.workflow.purchase.returnPerformedBy}</span><span class="field-value">${doc.returnedByName}</span></div>
    ${doc.receiptNumber ? `<div class="field"><span class="field-label">${t.workflow.purchase.linkedReceipt}</span><span class="field-value">${doc.receiptNumber}</span></div>` : `<div class="field"><span class="field-label">${t.workflow.purchase.receiptLabel}</span><span class="field-value">${t.workflow.purchase.generalReturnNoSource}</span></div>`}
    ${doc.invoiceNumber ? `<div class="field"><span class="field-label">${t.workflow.purchase.supplierInvoiceNumber}</span><span class="field-value">${doc.invoiceNumber}</span></div>` : ""}
    ${doc.vendorName ? `<div class="field"><span class="field-label">${t.workflow.purchase.supplierLabel}</span><span class="field-value">${doc.vendorName}</span></div>` : ""}
    <div class="field" style="grid-column:1/-1"><span class="field-label">${t.workflow.purchase.returnReasonLabel2}</span><span class="field-value">${doc.reason}</span></div>
  </div>
</div>
<div class="sig-section">
  <div class="sig-box">${t.workflow.purchase.returnExecutorSignature}<br/>${doc.returnedByName}</div>
  <div class="sig-box">${t.workflow.purchase.recipientSignature}<br/>${doc.recipientName || "&nbsp;"}</div>
</div>
<div class="footer">
  <span>${t.workflow.purchase.automatedCmmsDocument}</span>
  <span class="print-count">${t.workflow.purchase.printCountLabel}: <strong>${doc.printCount + 1}</strong></span>
</div>
<script>window.onload=()=>{window.print();window.onafterprint=()=>window.close();}<\/script>
</body></html>`;

    if (win) { win.document.write(html); win.document.close(); }
  };

  const handleDownload = async (doc: any) => {
    if (doc.docType === "return") {
      handleDownloadReturn(doc);
      return;
    }
    try {
      const saved = await utils.deliveryDocuments.getForPrint.fetch({ id: doc.id });
      doc = { ...doc, deliveredByName: saved.deliveredByName, deliveredBySignature: saved.deliveredBySignature };
    } catch {
      toast.error(t.workflow.purchase.printPrepareFailed);
      return;
    }
    incrementDocPrintMut.mutate({ id: doc.id });
    // توليد PDF مباشرة في المتصفح بدون سيرفر
    const imgTag = doc.warehousePhotoUrl
      ? `<div class="photo-wrap"><p class="photo-label">${t.workflow.purchase.itemPhoto}</p><img src="${doc.warehousePhotoUrl}" style="width:140px;height:140px;object-fit:cover;border-radius:8px;border:1px solid #dde3ea" /></div>`
      : "";

    const html = `<!DOCTYPE html>
<html dir="${dir}" lang="${language}">
<head><meta charset="UTF-8"/><title>${doc.deliveryNumber}</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700&display=swap');
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:${dir === "rtl" ? "'Cairo',Arial,sans-serif" : "Arial,sans-serif"};background:#fff;color:#1a1a1a;padding:32px 40px;font-size:13px}
.header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #1e3a5f;padding-bottom:14px;margin-bottom:20px}
.header-title{font-size:20px;font-weight:700;color:#1e3a5f}
.header-sub{font-size:11px;color:#555;margin-top:4px}
.header-meta{text-align:start;font-size:11px;color:#555;line-height:2}
.badge{display:inline-block;background:#1e3a5f;color:#fff;padding:3px 10px;border-radius:4px;font-size:13px;font-weight:700}
.parties{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin-bottom:16px}
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
    <div class="header-title">🚚 ${t.workflow.purchase.materialDeliveryDocument}</div>
    <div class="header-sub">${t.workflow.purchase.integratedCmms}</div>
  </div>
  <div class="header-meta">
    <div>${t.workflow.purchase.dateWord}: <strong>${new Date(doc.createdAt).toLocaleDateString(locale,{year:"numeric",month:"long",day:"numeric"})}</strong></div>
    <div><span class="badge">${doc.deliveryNumber}</span></div>
    ${doc.poNumber ? `<div>${t.workflow.purchase.poWord}: <strong>${doc.poNumber}</strong></div>` : ""}
    ${doc.ticketNumber ? `<div>${t.workflow.purchase.ticketWord}: <strong>${doc.ticketNumber}</strong></div>` : ""}
  </div>
</div>
<div class="parties">
  <div class="party-box"><div class="party-role">${t.workflow.purchase.delivererLabel}</div><div class="party-name">${doc.deliveredByName}</div></div>
  ${doc.assignedTechnicianName ? `<div class="party-box"><div class="party-role">${t.workflow.purchase.assignedTicketResponsible}</div><div class="party-name">${doc.assignedTechnicianName}</div></div>` : ""}
  <div class="party-box"><div class="party-role">${t.workflow.purchase.actualTechnicianRecipient}</div><div class="party-name">${doc.deliveredToName}</div></div>
</div>
<div class="section">
  <div class="section-title">${t.workflow.purchase.itemData}</div>
  <div class="grid">
    <div class="field"><span class="field-label">${t.workflow.purchase.itemNameLabel}</span><span class="field-value">${doc.itemName}</span></div>
    <div class="field"><span class="field-label">${t.workflow.purchase.deliveredQuantity}</span><span class="field-value">${doc.quantity} ${doc.unit||""}</span></div>
    ${doc.supplierName ? `<div class="field"><span class="field-label">${t.workflow.purchase.supplierLabel}</span><span class="field-value">${doc.supplierName}</span></div>` : ""}
    ${doc.actualUnitCost ? `<div class="field"><span class="field-label">${t.workflow.purchase.unitCostLabel}</span><span class="field-value">${parseFloat(doc.actualUnitCost).toLocaleString(locale)} ${t.common.currency}</span></div>` : ""}
    ${doc.notes ? `<div class="field" style="grid-column:1/-1"><span class="field-label">${t.workflow.purchase.notesLabel2}</span><span class="field-value">${doc.notes}</span></div>` : ""}
  </div>
  ${imgTag}
</div>
<div class="sig-section">
  <div class="sig-box">${t.workflow.purchase.delivererSignature}<br/>${doc.deliveredByName}${documentSignatureHtml(doc.deliveredBySignature)}</div>
  <div class="sig-box">${t.workflow.purchase.receiverSignature}<br/>${doc.deliveredToName}</div>
</div>
<div class="footer">
  <span>${t.workflow.purchase.automatedCmmsDocument}</span>
  <span class="print-count">${t.workflow.purchase.printCountLabel}: <strong>${doc.printCount + 1}</strong></span>
</div>
<script>window.onload=()=>{window.print();window.onafterprint=()=>window.close();}<\/script>
</body></html>`;

    const win = window.open("", "_blank", "width=860,height=780");
    if (win) { win.document.write(html); win.document.close(); }
  };

  if (deliveryDocsQuery.isLoading || returnDocsQuery?.isLoading) {
    return <Card><CardContent className="p-8 text-center text-muted-foreground">{t.common.loading}</CardContent></Card>;
  }

  if (docs.length === 0) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-muted-foreground">
          <FileText className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="font-medium">{t.workflow.purchase.noDocumentsYet}</p>
          <p className="text-xs mt-1">{t.workflow.purchase.documentsAppearHint}</p>
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
            className={`w-full border rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary ${dir === "rtl" ? "pr-8" : "pl-8"}`}
            dir="auto"
            placeholder={t.workflow.purchase.searchDocuments}
            defaultValue={searchDocs}
            onInput={e => { setSearchDocs((e.target as HTMLInputElement).value); setPageDocs(1); }}
          />
          <span className={`absolute top-1/2 -translate-y-1/2 text-muted-foreground text-xs ${dir === "rtl" ? "right-2.5" : "left-2.5"}`}>🔍</span>
        </div>
        <select
          className="border rounded-md px-2 py-1.5 text-sm bg-white"
          value={docRecipient}
          onChange={e => { setDocRecipient(e.target.value); setPageDocs(1); }}
        >
          <option value="all">{t.workflow.purchase.allRecipients}</option>
          {recipients.map((r: any) => <option key={r} value={r}>{r}</option>)}
        </select>
        <input type="date" dir="ltr" className="border rounded-md px-2 py-1.5 text-sm" value={docDateFrom} onChange={e => { setDocDateFrom(e.target.value); setPageDocs(1); }} />
        <input type="date" dir="ltr" className="border rounded-md px-2 py-1.5 text-sm" value={docDateTo} onChange={e => { setDocDateTo(e.target.value); setPageDocs(1); }} />
        {(searchDocs || docRecipient !== "all" || docDateFrom || docDateTo) && (
          <button className="text-xs text-muted-foreground underline" onClick={() => { setSearchDocs(""); setDocRecipient("all"); setDocDateFrom(""); setDocDateTo(""); setPageDocs(1); }}>{t.workflow.purchase.clear}</button>
        )}
      </div>
      <div className="text-sm text-muted-foreground">{filteredDocs.length} {t.workflow.purchase.documentCount}{filteredDocs.length !== docs.length ? ` ${t.workflow.purchase.ofCount} ${docs.length}` : ""}</div>
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
                  <span>{new Date(doc.createdAt).toLocaleDateString(locale, { year: "numeric", month: "short", day: "numeric" })}</span>
                  {doc.docType === "return" ? (
                    <>
                      <span>{t.workflow.purchase.returnedByInline} {doc.returnedByName}</span>
                      <span>{t.workflow.purchase.quantityColon} {doc.returnedQuantity} {displayUnit(doc.unit)}</span>
                    </>
                  ) : (
                    <>
                      <span>{t.workflow.purchase.delivererInline} {doc.deliveredByName}</span>
                      {doc.assignedTechnicianName && <span>{t.workflow.purchase.assignedTechnicianInline} {doc.assignedTechnicianName}</span>}
                      <span>{t.workflow.purchase.actualRecipientInline} {doc.deliveredToName}</span>
                      {doc.ticketNumber && <span>{t.workflow.purchase.ticketInline} {doc.ticketNumber}</span>}
                      <span>{t.workflow.purchase.quantityColon} {doc.quantity} {displayUnit(doc.unit)}</span>
                    </>
                  )}
                </div>
                <div className="text-xs text-muted-foreground">
                  {t.workflow.purchase.printed} {doc.printCount} {doc.printCount === 1 ? t.workflow.purchase.once : t.workflow.purchase.times}
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
                {t.workflow.purchase.downloadPdf}
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
  const [deliveryLotInfo, setDeliveryLotInfo] = useState<any>(null);
  const [deliveryCostAllocations, setDeliveryCostAllocations] = useState<IssueCostAllocationDraft[]>(() => [createIssueCostAllocationDraft()]);

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
      toast.error(localizeApiError(err.message || "Upload error"));
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

  // Step indicator component

  const { t, language, dir } = useTranslation();
  const locale = language === "ar" ? "ar-SA" : language === "ur" ? "ur-PK" : "en-US";
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const { data: catalogUnits = [] } = trpc.catalog.units.list.useQuery();
  const displayUnit = (value: string | null | undefined) =>
    getLocalizedCatalogUnitName(value, catalogUnits as any[], language);
  const displayItemName = (item: any) => getLocalizedItemField(item, "itemName", language) || item?.itemName || "";
  const displayItemDescription = (item: any) => getLocalizedItemField(item, "description", language) || item?.description || "";
  const isRTL = language === "ar" || language === "ur";
  const role = user?.role || "";
  const isAdminOrOwner = role === "admin" || role === "owner";
  const isDelegate = isDelegateRole(role) || isAdminOrOwner;
  const isWarehouse = role === "warehouse" || isAdminOrOwner;

  // Determine active tab based on role
  const defaultTab = isAdminOrOwner ? "purchase" : isDelegate ? "purchase" : isWarehouse ? "warehouse" : "purchase";
  const [activeTab, setActiveTab] = useState(defaultTab);

  // Data queries - admin/owner always enabled
  const { data: pendingEstimate = [], refetch: refetchEstimate } = trpc.purchaseOrders.pendingEstimateItems.useQuery(undefined, { enabled: isDelegate || isAdminOrOwner });
  const { data: pendingPurchase = [], refetch: refetchPurchase } = trpc.purchaseOrders.pendingPurchaseItems.useQuery(undefined, { enabled: isDelegate || isAdminOrOwner, ...independentReadOptions });
  const { data: pendingWarehouse = [], refetch: refetchWarehouse } = trpc.purchaseOrders.pendingWarehouseItems.useQuery(undefined, { enabled: isWarehouse || isAdminOrOwner, ...independentReadOptions });
  const { data: pendingDelivery = [], refetch: refetchDelivery } = trpc.purchaseOrders.pendingDeliveryItems.useQuery(undefined, { enabled: isWarehouse || isAdminOrOwner, ...independentReadOptions });
  // أصناف المخزون الجاهزة للتسليم (من OCR الفعلي)
  const { data: inventoryItems = [], refetch: refetchInventory } = trpc.purchaseOrders.inventoryReadyForDelivery.useQuery(undefined, { enabled: isWarehouse || isAdminOrOwner });
  const { data: lotTrackingStatus } = trpc.inventoryCount.lotTrackingStatus.useQuery(undefined, { enabled: isWarehouse || isAdminOrOwner });
  const lotsEnabled = !!lotTrackingStatus?.enabled;
  // إدخال المخزون — أصناف وصلت للمستودع وبانتظار إدخال المخزون
  const pendingInventoryEntry = (pendingDelivery as any[]).filter((i: any) => !i.inventoryEntered);
  const newestPendingDelivery = sortPurchaseCycleItemsNewestFirst(pendingDelivery as any[]);
  const newestInventoryItems = sortPurchaseCycleItemsNewestFirst(inventoryItems as any[]);
  // تجميع حسب رقم فاتورة المورد بعد ترتيب الأصناف من الأحدث إلى الأقدم.
  // وبذلك يظهر أحدث رقم فاتورة أولاً، وتظهر أحدث أصناف الفاتورة في بدايتها.
  const groupedByInvoiceNumber = newestPendingDelivery.reduce((groups: any, item: any) => {
    // An absent invoice number is not a shared invoice identity.
    const key = item.supplierInvoiceNumber || `${t.workflow.purchase.withoutInvoiceNumber} #${item.purchaseOrderId}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(item);
    return groups;
  }, {});
  const { data: allUsers = [] } = trpc.users.list.useQuery();

  const refetchAll = () => { refetchEstimate(); refetchPurchase(); refetchWarehouse(); refetchDelivery(); };

  // Mutations
  const estimateCostMut = trpc.purchaseOrders.estimateCost.useMutation({ onSuccess: () => { toast.success(t.purchaseOrders.pricingSaved); refetchAll(); }, onError: (e: any) => toast.error(localizeApiError(e.message)) });
  const submitPricedBatchMut = trpc.purchaseOrders.submitPricedBatch.useMutation({
    onSuccess: (res: any) => {
      toast.success(t.workflow.purchase.pricingSentAccounting);
      if (res?.pricingDocumentArchived === false) {
        toast.warning(t.workflow.purchase.pricingDocumentWarning);
      }
      utils.attachments.listByType.invalidate({ entityType: "delegate_pricing_documents" });
      refetchAll();
    },
    onError: (e: any) => toast.error(localizeApiError(e.message)),
  });
  // [PB 2026-08-29] إرسال دفعة فرعية من حزمة — تنشأ دفعة تسعير مستقلة لكل
  // طلب داخل الحزمة، مرتبطة كلها برقم إرسال واحد (PB01-1، PB01-2...).
  // الفشل الجزئي طبيعي: طلب بلا أصناف جاهزة يُتجاوَز ويُبلَّغ عنه.
  const submitPackageBatchMut = trpc.purchasePackages.submitPackageBatch.useMutation({
    onSuccess: (res: any) => {
      toast.success(t.workflow.purchase.packageBatchSent.replace("{number}", res.submissionNumber).replace("{count}", String(res.sent.length)));
      if (res.skipped?.length > 0) {
        toast.info(t.workflow.purchase.packageSkipped.replace("{count}", String(res.skipped.length)));
      }
      if (res.pricingDocumentArchived === false) {
        toast.warning(t.workflow.purchase.packagePricingDocumentWarning);
      }
      utils.attachments.listByType.invalidate({ entityType: "delegate_pricing_documents" });
      refetchAll();
    },
    onError: (e: any) => toast.error(localizeApiError(e.message)),
  });
  const confirmPurchaseMut = trpc.purchaseOrders.confirmItemPurchase.useMutation({ onSuccess: async (result, variables) => { toast.success(t.purchaseOrders.purchased); if (!await refreshPurchaseExecution(utils, result, variables)) toast.warning(purchaseRefreshNotice(language)); }, onError: (e: any) => toast.error(localizeApiError(e.message)) });
  const cancelPurchaseMut = trpc.purchaseOrders.cancelItemPurchase.useMutation({ onSuccess: () => { toast.success(t.purchaseOrders.cancelPurchaseSuccess); refetchAll(); setCancelDialog(null); setCancelNote(""); }, onError: (e: any) => toast.error(localizeApiError(e.message)) });
  const confirmWarehouseMut = trpc.purchaseOrders.confirmDeliveryToWarehouse.useMutation({ onSuccess: async (result, variables) => { toast.success(t.purchaseOrders.deliveredToWarehouse); if (!await refreshPurchaseExecution(utils, result, variables)) toast.warning(purchaseRefreshNotice(language)); }, onError: (e: any) => toast.error(localizeApiError(e.message)) });
  const resolveDeliveryLotMut = trpc.inventory.resolveDeliveryLot.useMutation({
    onSuccess: (data: any) => {
      setDeliveryLotInfo(data);
      setDeliveryDialog((current: any) => current ? {
        ...current,
        poNumber: data.poNumber,
        ticketNumber: data.ticketNumber,
        ticketAssignedToId: data.ticketAssignedToId,
        ticketAssignedToName: data.ticketAssignedToName,
        ticketResponsibleDepartment: data.ticketResponsibleDepartment,
        supplierName: data.supplierName,
        actualUnitCost: data.issueUnitCost,
      } : current);
      if (data.unit) setDeliveryUnit(data.unit);
      toast.success(t.workflow.purchase.lotRecognized.replace("{code}", data.lotCode));
    },
    onError: (e: any) => {
      setDeliveryLotInfo(null);
      toast.error(localizeApiError(e.message));
    },
  });

  const deliverInventoryMut = trpc.purchaseOrders.deliverInventoryItem.useMutation({
    onSuccess: (data) => {
      toast.success(`${t.purchaseOrders.deliveredToRequester}${data?.allocatedCostTotal != null ? ` — ${t.workflow.purchase.allocatedLotCost.replace("{amount}", Number(data.allocatedCostTotal).toFixed(2)).replace("{currency}", t.common.currency)}` : ""}`);
      refetchInventory();
      refetchDelivery();
      deliveryDocsQuery.refetch();
      void printCompletedDelivery(data);
      setDeliveryLotInfo(null);
    },
    onError: (e: any) => toast.error(localizeApiError(e.message)),
  });

  const confirmDeliveryMut = trpc.purchaseOrders.confirmDeliveryToRequester.useMutation({
    onSuccess: (data) => {
      toast.success(`${t.purchaseOrders.deliveredToRequester}${data?.allocatedCostTotal != null ? ` — ${t.workflow.purchase.allocatedLotCost.replace("{amount}", Number(data.allocatedCostTotal).toFixed(2)).replace("{currency}", t.common.currency)}` : ""}`);
      refetchAll();
      refetchInventory();
      deliveryDocsQuery.refetch();
      void printCompletedDelivery(data);
      setDeliveryLotInfo(null);
    },
    onError: (e: any) => { toast.error(localizeApiError(e.message)); setDeliveryPrintData(null); },
  });

  async function printCompletedDelivery(result: any) {
    const pending = deliveryPrintData;
    setDeliveryPrintData(null);
    if (!pending) return;
    try {
      const saved = await utils.deliveryDocuments.getForPrint.fetch({ id: result.deliveryDocumentId });
      // The committed document is the authority for the actual warehouse signer.
      // Printing failure never retries the stock issue or creates another DLV.
      printDeliveryReceipt({ ...pending, deliveredByName: saved.deliveredByName,
        deliveredBySignature: saved.deliveredBySignature, deliveryNumber: saved.deliveryNumber,
        lotCode: result.lotCode || undefined }, language);
    } catch {
      toast.error(t.workflow.purchase.printPrepareFailed);
    }
  }

  // Estimate state
  const [estimateValues, setEstimateValues] = useState<Record<number, string>>({});
  const [workshopDrafts, setWorkshopDrafts] = useState<Record<number, ExternalWorkshopForm>>({});

  // ── فلاتر كل تبويب ──────────────────────────────────────────
  const [searchEstimate,   setSearchEstimate]   = useState("");
  const [searchPurchase,   setSearchPurchase]   = useState("");
  const [searchWarehouse,  setSearchWarehouse]  = useState("");
  const [searchDelivery,   setSearchDelivery]   = useState("");
  const [deliverySearchMode, setDeliverySearchMode] = useState<"name" | "code" | "qr">("name");
  const [deliveryQrInventoryIds, setDeliveryQrInventoryIds] = useState<number[]>([]);
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

  // 2B-8 — بحث QR الحقيقي: trackingToken/lotCode → Lot Balance → Inventory.
  const resolveLotSearchMut = trpc.inventory.resolveLotSearch.useMutation({
    onSuccess: (data: any) => {
      const matchedIds = (data.matches || []).map((row: any) => Number(row.inventoryId));
      setDeliveryQrInventoryIds(matchedIds);
      setSearchDelivery(data.trackingToken || data.lotCode || "");
      setDeliverySearchMode("qr");
      setPageDelivery(1);
      toast.success(t.workflow.purchase.lotRecognized.replace("{code}", data.lotCode));
    },
    onError: (e: any) => {
      setDeliveryQrInventoryIds([]);
      toast.error(localizeApiError(e.message));
    },
  });

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
      if (deliverySearchMode === "qr") {
        return deliveryQrInventoryIds.includes(Number(item.id));
      }
      if (deliverySearchMode === "code") {
        // البحث التاريخي بالرقم يبقى على كود Inventory/باركود المصنع فقط.
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
    const availableDays = getAvailableCalendarDays(item.requiredDate, item.delegateAssignedAt);
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
                <h3 className="font-semibold text-sm truncate">{displayItemName(item)}</h3>
                <Badge variant="outline" className={`text-[10px] ${statusColors[item.status] || ""}`}>
                  {item.isExternalMaintenance ? t.workflow.purchase.externalMaintenanceExecution : (statusLabels[item.status] || item.status)}
                </Badge>
                {item.isExternalMaintenance && <Badge className="text-[10px] bg-purple-100 text-purple-700">{t.workflow.purchase.pathC}</Badge>}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span className="flex items-center gap-1"><Hash className="w-3 h-3" /> {t.purchaseOrders.quantity}: <strong className="text-foreground">{item.quantity} {displayUnit(item.unit)}</strong></span>
                <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> {new Date(item.createdAt).toLocaleDateString(locale)}</span>
                {item.requiredDate && <span>{t.purchaseOrders.requiredDate}: <strong className="text-foreground">{formatDateOnly(item.requiredDate, locale)}</strong></span>}
                {item.delegateAssignedAt && <span>{t.purchaseOrders.delegateAssignedDate}: <strong className="text-foreground">{formatDateOnly(item.delegateAssignedAt, locale)}</strong></span>}
                {availableDays != null && <span className={availableDays < 0 ? "text-red-600" : ""}>{t.purchaseOrders.availableDuration}: <strong>{formatAvailableDuration(availableDays, language)}</strong></span>}
                {displayItemDescription(item) && <span className="col-span-2 sm:col-span-1 truncate">{displayItemDescription(item)}</span>}
              </div>

              {item.estimatedUnitCost && (
                <div className="text-xs text-muted-foreground">
                  {t.purchaseOrders.estimatedUnitCost}: <strong className="text-foreground">{parseFloat(item.estimatedUnitCost).toLocaleString(locale)} {t.common.currency}</strong>
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
              {step === 1 && <><ShoppingCart className="w-4 h-4" /> {item.isExternalMaintenance ? t.workflow.purchase.externalMaintenanceComplete : t.purchaseOrders.confirmPurchase}</>}
              {step === 2 && <><Package className="w-4 h-4" /> {t.purchaseOrders.confirmDeliveryToWarehouse}</>}
              {step === 3 && <><Truck className="w-4 h-4" /> {t.workflow.purchase.stageTechnicianHandover}</>}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  };

  // ── تبويب الوثائق ─────────────────────────────────────────

  // ── وثيقة تسليم المواد للفني ──────────────────────────────



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
        <TabsList className={`grid w-full ${isAdminOrOwner ? "grid-cols-6" : isDelegate ? "grid-cols-2" : "grid-cols-4"}`}>
          {isDelegate && (
            <>
              <TabsTrigger value="estimate" className="gap-1.5">
                <Clock className="w-4 h-4" />
                <span className="hidden sm:inline">{t.workflow.purchase.pricing}</span>
                {pendingEstimate.length > 0 && <Badge variant="destructive" className="text-[10px] px-1.5 py-0">{pendingEstimate.length}</Badge>}
              </TabsTrigger>
              <TabsTrigger value="purchase" className="gap-1.5">
                <ShoppingCart className="w-4 h-4" />
                <span className="hidden sm:inline">{t.purchaseOrders.step1Purchase}</span>
                {pendingPurchase.length > 0 && <Badge variant="destructive" className="text-[10px] px-1.5 py-0">{pendingPurchase.length}</Badge>}
              </TabsTrigger>
            </>
          )}
          {isWarehouse && (
            <>
              <TabsTrigger value="warehouse" className="gap-1.5">
                <Package className="w-4 h-4" />
                <span className="hidden sm:inline">{t.purchaseOrders.step2Warehouse}</span>
                {pendingWarehouse.length > 0 && <Badge variant="destructive" className="text-[10px] px-1.5 py-0">{pendingWarehouse.length}</Badge>}
              </TabsTrigger>
              <TabsTrigger value="inventory-entry" className="gap-1.5">
                <Archive className="w-4 h-4" />
                <span className="hidden sm:inline">{t.workflow.purchase.inventoryEntry}</span>
                {Object.keys(groupedByInvoiceNumber).length > 0 && <Badge variant="destructive" className="text-[10px] px-1.5 py-0">{pendingDelivery.length}</Badge>}
              </TabsTrigger>
              <TabsTrigger value="delivery" className="gap-1.5">
                <Truck className="w-4 h-4" />
                <span className="hidden sm:inline">{t.purchaseOrders.step3Delivery}</span>
                {(inventoryItems as any[]).length > 0 && <Badge variant="destructive" className="text-[10px] px-1.5 py-0">{(inventoryItems as any[]).length}</Badge>}
              </TabsTrigger>
              <TabsTrigger value="documents" className="gap-1.5">
                <FileText className="w-4 h-4" />
                <span className="hidden sm:inline">{t.workflow.purchase.documents}</span>
              </TabsTrigger>
            </>
          )}
        </TabsList>

        {/* ==================== TAB 0: Estimate (Delegate - Revision Items) ==================== */}
        <TabsContent value="estimate" className="mt-4 space-y-4">
          <FilterBar search={searchEstimate} setSearch={v => { setSearchEstimate(v); setPageEstimate(1); }} from={dateFrom} setFrom={v => { setDateFrom(v); setPageEstimate(1); }} to={dateTo} setTo={v => { setDateTo(v); setPageEstimate(1); }} placeholder={t.workflow.purchase.searchItems} />
          {filterItems(sortPurchaseCycleItemsNewestFirst(pendingEstimate), searchEstimate, dateFrom, dateTo).length === 0 ? (
            <Card><CardContent className="p-8 text-center text-muted-foreground">
              <CheckCircle2 className="w-10 h-10 mx-auto mb-3 text-green-500" />
              <p className="font-medium">{t.workflow.purchase.noPricingItems}</p>
            </CardContent></Card>
          ) : (
            <><div className="space-y-3">
              {(() => {
                // [PB 2026-08-29] تجميع بصري: الأصناف التابعة لطلبات داخل حزمة
                // تُعرض تحت رأس حزمتها مع زر إرسال موحّد، وغيرها تبقى بطاقات
                // مفردة بشكلها وسلوكها الحاليين حرفيًا. الترتيب والفلترة
                // والترقيم لم تتغيّر — التجميع يقع على الصفحة المعروضة فقط.
                const pageItems = filterItems(sortPurchaseCycleItemsNewestFirst(pendingEstimate), searchEstimate, dateFrom, dateTo).slice((pageEstimate-1)*PAGE_SIZE, pageEstimate*PAGE_SIZE);
                const groups: { key: string; packageId?: number; packageNumber?: string; items: any[] }[] = [];
                const byPackage = new Map<number, any>();

                for (const it of pageItems as any[]) {
                  if (!it.packageId) {
                    groups.push({ key: `item:${it.id}`, items: [it] });
                    continue;
                  }
                  let g = byPackage.get(it.packageId);
                  if (!g) {
                    g = { key: `pkg:${it.packageId}`, packageId: it.packageId, packageNumber: it.packageNumber, items: [] };
                    byPackage.set(it.packageId, g);
                    groups.push(g);
                  }
                  g.items.push(it);
                }

                const renderItemCard = (item: any) => {
                  const availableDays = getAvailableCalendarDays(item.requiredDate, item.delegateAssignedAt);
                  return (
                <Card key={item.id} className="border-amber-200 bg-amber-50">
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate" dir="auto">{displayItemName(item)}</p>
                        {displayItemDescription(item) && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2" dir="auto">{displayItemDescription(item)}</p>}
                        <div className="flex flex-wrap gap-2 mt-1.5">
                          <Badge variant="outline" className="text-[10px]">{t.workflow.purchase.quantityColon} {item.quantity} {displayUnit(item.unit)}</Badge>
                          {item.purchaseOrderNumber && <Badge variant="outline" className="text-[10px]">{item.purchaseOrderNumber}</Badge>}
                          {item.requiredDate && <Badge variant="outline" className="text-[10px]">{t.purchaseOrders.requiredDate}: {formatDateOnly(item.requiredDate, locale)}</Badge>}
                          {item.delegateAssignedAt && <Badge variant="outline" className="text-[10px]">{t.purchaseOrders.delegateAssignedDate}: {formatDateOnly(item.delegateAssignedAt, locale)}</Badge>}
                          {availableDays != null && <Badge variant="outline" className={`text-[10px] ${availableDays < 0 ? "border-red-300 text-red-700" : ""}`}>{t.purchaseOrders.availableDuration}: {formatAvailableDuration(availableDays, language)}</Badge>}
                          {item.isExternalMaintenance && <Badge className="text-[10px] bg-purple-100 text-purple-700 border-purple-200">{t.workflow.purchase.externalAssetMaintenance}</Badge>}
                        </div>
                        {item.itemRevisionNote && (
                          <div className="mt-2 text-xs bg-red-50 border border-red-200 rounded p-2 text-red-700">
                            <strong>{t.workflow.purchase.previousReviewReason}</strong>{" "}<EntityTranslatedText entityType="PO_ITEM" entityId={item.id} field="itemRevisionNote" original={item.itemRevisionNote} />
                          </div>
                        )}
                      </div>
                    </div>
                    {item.status === "estimated" ? (
                      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                        <div>
                          <div className="text-xs text-emerald-700">{t.workflow.purchase.savedPrice}</div>
                          <div className="font-semibold text-emerald-900">{Number(item.estimatedTotalCost || item.estimatedUnitCost || 0).toLocaleString(locale)} {t.common.currency}</div>
                        </div>
                        {/* داخل حزمة: الإرسال يتم من زر الحزمة الموحّد أعلاه،
                            فلا يُعرض زر مستقل لكل صنف تفاديًا لإرسالين متوازيين. */}
                        {!item.packageId && (
                          <Button
                            size="sm"
                            disabled={submitPricedBatchMut.isPending}
                            onClick={() => submitPricedBatchMut.mutate({ purchaseOrderId: item.purchaseOrderId })}
                            className="gap-2 bg-emerald-600 hover:bg-emerald-700"
                          >
                            {submitPricedBatchMut.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                            {t.workflow.purchase.sendAccounting}
                          </Button>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-3">
                      <ExternalWorkshopPricingFields item={item} idPrefix={`external-cycle-${item.id}`} value={externalWorkshopForm(item, workshopDrafts[item.id])} onChange={value => setWorkshopDrafts(previous => ({ ...previous, [item.id]: value }))} disabled={estimateCostMut.isPending} />
                      <div className="flex gap-2 items-end">
                        <div className="flex-1">
                          <Label className="text-xs text-amber-700">{t.workflow.purchase.estimatedUnitPriceCurrency.replace("{currency}", t.common.currency)}</Label>
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
                            = {(parseFloat(estimateValues[item.id]) * item.quantity).toLocaleString(locale)} {t.common.currency}
                          </div>
                        )}
                        <Button
                          size="sm"
                          disabled={!estimateValues[item.id] || parseFloat(estimateValues[item.id]) <= 0 || estimateCostMut.isPending || !!externalWorkshopIssue(item, workshopDrafts[item.id])}
                          onClick={() => {
                            if (!estimateValues[item.id] || parseFloat(estimateValues[item.id]) <= 0) {
                              toast.error(t.purchaseOrders.enterPrice);
                              return;
                            }
                            const workshopIssue = externalWorkshopIssue(item, workshopDrafts[item.id]);
                            if (workshopIssue) { toast.error(externalMaintenanceLabels(language)[workshopIssue]); return; }
                            estimateCostMut.mutate({
                              purchaseOrderId: item.purchaseOrderId,
                              items: [{ id: item.id, estimatedUnitCost: estimateValues[item.id], ...externalWorkshopPayload(item, workshopDrafts[item.id]) }]
                            });
                          }}
                          className="shrink-0"
                        >
                          {estimateCostMut.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : t.purchaseOrders.savePricing}
                        </Button>
                      </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
                );
                };

                return groups.map(g => {
                  if (!g.packageId) return renderItemCard(g.items[0]);
                  const pricedCount = g.items.filter((i: any) => i.status === "estimated").length;
                  return (
                    <Card key={g.key} className="border-primary/40">
                      <CardContent className="p-4 space-y-3">
                        <div className="flex items-center justify-between gap-3 flex-wrap pb-2 border-b">
                          <div className="flex items-center gap-2">
                            <Boxes className="w-4 h-4 text-primary" />
                            <span className="font-semibold font-mono text-sm">{g.packageNumber}</span>
                            <Badge variant="secondary" className="text-[10px]">{g.items.length} {t.workflow.purchase.itemCount}</Badge>
                            {pricedCount > 0 && (
                              <Badge className="text-[10px] bg-emerald-100 text-emerald-700">{t.workflow.purchase.pricedCount.replace("{count}", String(pricedCount))}</Badge>
                            )}
                          </div>
                          <Button
                            size="sm"
                            disabled={pricedCount === 0 || submitPackageBatchMut.isPending}
                            onClick={() => submitPackageBatchMut.mutate({ packageId: g.packageId! })}
                            className="gap-2 bg-emerald-600 hover:bg-emerald-700"
                          >
                            {submitPackageBatchMut.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                            {t.workflow.purchase.sendPricedAccounting}
                          </Button>
                        </div>
                        <div className="space-y-3">
                          {g.items.map((it: any) => renderItemCard(it))}
                        </div>
                      </CardContent>
                    </Card>
                  );
                });
              })()}
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
              {filterItems(sortPurchaseCycleItemsNewestFirst(pendingPurchase), searchPurchase, dateFrom, dateTo).slice((pagePurchase-1)*PAGE_SIZE, pagePurchase*PAGE_SIZE).map((item: any) => (
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
              {filterItems(sortPurchaseCycleItemsNewestFirst(pendingWarehouse), searchWarehouse, dateFrom, dateTo).slice((pageWarehouse-1)*PAGE_SIZE, pageWarehouse*PAGE_SIZE).map((item: any) => (
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
              <p className="font-medium">{t.workflow.purchase.noPendingInventoryEntry}</p>
              <p className="text-xs mt-1">{t.workflow.purchase.confirmWarehouseFirst}</p>
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
                          <p className="font-semibold text-sm font-mono">{items[0]?.supplierInvoiceNumber || t.workflow.purchase.withoutInvoiceNumber}</p>
                          <p className="text-xs text-muted-foreground">{t.workflow.purchase.sameInvoiceItems.replace("{count}", String(items.length))}</p>
                        </div>
                      </div>
                      <Button
                        size="sm"
                        className="gap-1.5 bg-emerald-600 hover:bg-emerald-700"
                        onClick={() => {
                          const poId = items[0]?.purchaseOrderId;
                          const purchaseOrderIds = Array.from(new Set<number>(items.map((item: any) => Number(item.purchaseOrderId))));
                          const sourceInvoice = items[0]?.supplierInvoiceNumber || "بدون رقم فاتورة";
                          if (poId) window.location.href = `/warehouse/receive-v2?poId=${poId}&invoiceNumber=${encodeURIComponent(sourceInvoice)}&purchaseOrderIds=${purchaseOrderIds.join(",")}`;
                        }}
                      >
                        <Sparkles className="w-3.5 h-3.5" />
                        {t.workflow.purchase.uploadSupplierInvoice}
                      </Button>
                    </div>
                    {/* قائمة الأصناف */}
                    <div className="space-y-1.5 border-t pt-3">
                      {items.map((item: any) => (
                        <div key={item.id} className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground truncate flex-1" dir="auto">{displayItemName(item)}</span>
                          <span className="font-mono text-xs text-muted-foreground mr-2">
                            {item.receivedQuantity ?? item.quantity} {displayUnit(item.unit)}
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
              <Button size="sm" variant={deliverySearchMode === "name" ? "default" : "outline"} onClick={() => { setDeliverySearchMode("name"); setSearchDelivery(""); setDeliveryQrInventoryIds([]); }} className="gap-1">
                <Search className="w-3.5 h-3.5" /> {t.workflow.purchase.searchByName}
              </Button>
              <Button size="sm" variant={deliverySearchMode === "code" ? "default" : "outline"} onClick={() => { setDeliverySearchMode("code"); setSearchDelivery(""); setDeliveryQrInventoryIds([]); }} className="gap-1">
                <Package className="w-3.5 h-3.5" /> {t.workflow.purchase.searchByNumber}
              </Button>
              <Button size="sm" variant={deliverySearchMode === "qr" ? "default" : "outline"} onClick={() => { setDeliverySearchMode("qr"); setSearchDelivery(""); setDeliveryQrInventoryIds([]); }} className="gap-1">
                <QrCode className="w-3.5 h-3.5" /> QR Code
              </Button>
              {searchDelivery && (
                <Button size="sm" variant="ghost" className="text-muted-foreground mr-auto" onClick={() => { setSearchDelivery(""); setDeliverySearchMode("name"); setDeliveryQrInventoryIds([]); }}>
                  <X className="w-3.5 h-3.5" />
                </Button>
              )}
            </div>

            {deliverySearchMode === "qr" ? (
              <BarcodeScanner
                onScan={(code) => {
                  setSearchDelivery(code);
                  setDeliveryQrInventoryIds([]);
                  setPageDelivery(1);
                  resolveLotSearchMut.mutate({ code });
                }}
                placeholder={t.workflow.purchase.scanLotPlaceholder}
              />
            ) : (
              <div className="relative">
                <input
                  dir="auto"
                  className={`w-full border rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary ${dir === "rtl" ? "pr-8" : "pl-8"}`}
                  placeholder={deliverySearchMode === "name" ? t.workflow.purchase.searchItemByName : t.workflow.purchase.searchItemByCode}
                  value={searchDelivery}
                  onChange={e => { setSearchDelivery(e.target.value); setPageDelivery(1); }}
                />
                <Search className={`absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground ${dir === "rtl" ? "right-2.5" : "left-2.5"}`} />
              </div>
            )}
          </div>
          {filterDeliveryItems(newestInventoryItems, searchDelivery).length === 0 ? (
            <Card><CardContent className="p-8 text-center text-muted-foreground">
              <CheckCircle2 className="w-10 h-10 mx-auto mb-3 text-green-500" />
              <p className="font-medium">{t.purchaseOrders.noItemsPending}</p>
              <p className="text-xs mt-1">{t.workflow.purchase.noInventoryReady}</p>
            </CardContent></Card>
          ) : (
            <><div className="space-y-3">
              {filterDeliveryItems(newestInventoryItems, searchDelivery).slice((pageDelivery-1)*PAGE_SIZE, pageDelivery*PAGE_SIZE).map((item: any) => (
                <Card key={item.id} className="hover:shadow-md transition-shadow">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        {/* اسم الصنف من OCR */}
                        <p className="font-medium text-sm" dir="auto">{displayItemName(item)}</p>
                        {displayItemDescription(item) && <p className="text-xs text-muted-foreground" dir="auto">{displayItemDescription(item)}</p>}
                        <div className="flex flex-wrap gap-2 mt-1.5 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Package className="w-3 h-3" />
                            {item.quantity} {displayUnit(item.unit)}
                          </span>
                          {!lotsEnabled && item.vendorName && (
                            <span className="flex items-center gap-1">
                              🏪 {item.vendorName}
                            </span>
                          )}
                          {!lotsEnabled && item.poNumber && (
                            <span className="font-mono text-[10px] bg-muted px-1.5 py-0.5 rounded">
                              {item.poNumber}
                            </span>
                          )}
                          {!lotsEnabled && item.ticketNumber && item.ticketAssignedToName && (
                            <span className="text-[10px] bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded">
                              {t.workflow.purchase.ticketAssignedSummary.replace("{ticket}", item.ticketNumber).replace("{name}", item.ticketAssignedToName)}
                            </span>
                          )}
                          {!lotsEnabled && item.averageCost > 0 && (
                            <span className="font-mono">{parseFloat(item.averageCost).toFixed(2)} {t.common.currency}</span>
                          )}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        className="gap-1.5 shrink-0"
                        onClick={() => {
                          // المستلم الفعلي اختيار صريح وإلزامي حتى لو كان هو نفس الفني المسند.
                          setDeliveryUserId("");
                          setDeliveryQty("");
                          setDeliveryUnit(item.unit || t.workflow.purchase.pieceUnit);
                          setDeliveryNotes("");
                          setDeliveryLotInfo(null);
                          setDeliveryCostAllocations([createIssueCostAllocationDraft()]);
                          // نمرر بيانات الصنف من المخزون للـ dialog
                          setDeliveryDialog({
                            ...item,
                            ...(lotsEnabled ? {
                              poNumber: null,
                              ticketNumber: null,
                              ticketAssignedToId: null,
                              ticketAssignedToName: null,
                              ticketResponsibleDepartment: null,
                              supplierName: null,
                              actualUnitCost: null,
                            } : {}),
                            id:           item.id,
                            itemName:     displayItemName(item),
                            quantity:     item.quantity,
                            unit:         item.unit,
                            supplierName: lotsEnabled ? null : item.vendorName,
                            actualUnitCost: lotsEnabled ? null : item.averageCost,
                            isInventoryItem: true,
                          });
                        }}
                      >
                        <Truck className="w-3.5 h-3.5" />
                        {t.workflow.purchase.stageTechnicianHandover}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}


            </div>
            <Pagination total={filterDeliveryItems(newestInventoryItems, searchDelivery).length} page={pageDelivery} setPage={setPageDelivery} /></>)}
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
              {purchaseDialog?.isExternalMaintenance ? t.workflow.purchase.externalMaintenanceCompleteTitle : t.purchaseOrders.confirmPurchase}
            </DialogTitle>
          </DialogHeader>

          {purchaseDialog && (
            <div className="space-y-4">
              {/* Item info */}
              <div className="bg-muted/50 rounded-lg p-3 space-y-1">
                <p className="font-semibold text-sm">{displayItemName(purchaseDialog)}</p>
                <p className="text-xs text-muted-foreground">{t.purchaseOrders.quantity}: {purchaseDialog.quantity} {displayUnit(purchaseDialog.unit)}</p>
                {purchaseDialog.description && <p className="text-xs text-muted-foreground">{purchaseDialog.description}</p>}
              </div>

              {/* Photo uploads */}
              <div className="grid grid-cols-2 gap-4">
                {/* Purchased item photo */}
                <div className="space-y-2">
                  <Label className="text-xs font-medium flex items-center gap-1">
                    <Camera className="w-3.5 h-3.5" /> {purchaseDialog?.isExternalMaintenance ? t.workflow.purchase.assetAfterMaintenancePhoto : t.purchaseOrders.purchasedItemPhoto} *
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
                    <FileText className="w-3.5 h-3.5" /> {purchaseDialog?.isExternalMaintenance ? t.workflow.purchase.workshopInvoiceReport : t.purchaseOrders.invoicePhoto} *
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
              {t.workflow.purchase.cancelPurchase}
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
              {purchaseDialog?.isExternalMaintenance ? t.workflow.purchase.externalMaintenanceComplete : t.purchaseOrders.confirmPurchase}
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
              {t.workflow.purchase.cancelItemPurchase}
            </DialogTitle>
          </DialogHeader>
          {cancelDialog && (
            <div className="space-y-4">
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 space-y-1">
                <p className="font-semibold text-sm">{displayItemName(cancelDialog)}</p>
                <p className="text-xs text-muted-foreground">{t.purchaseOrders.quantity}: {cancelDialog.quantity} {displayUnit(cancelDialog.unit)}</p>
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
                <p className="font-semibold text-sm">{displayItemName(warehouseDialog)}</p>
                <p className="text-xs text-muted-foreground">{t.purchaseOrders.quantity}: {warehouseDialog.quantity} {displayUnit(warehouseDialog.unit)}</p>
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
                  <Label className="text-xs">{t.workflow.purchase.supplierInvoiceRequired}</Label>
                  <Input value={warehouseForm.supplierInvoiceNumber} onChange={e => setWarehouseForm(p => ({ ...p, supplierInvoiceNumber: e.target.value }))} placeholder={t.workflow.purchase.supplierInvoiceNumber} dir="ltr" className="font-mono" />
                  <p className="text-[10px] text-muted-foreground">{t.workflow.purchase.supplierInvoiceGroupingHint}</p>
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
      <Dialog
        open={!!deliveryDialog}
        onOpenChange={(open) => {
          if (!open) {
            setDeliveryDialog(null);
            setDeliveryUserId("");
            setDeliveryNotes("");
            setDeliveryLotInfo(null);
            setDeliveryCostAllocations([createIssueCostAllocationDraft()]);
          }
        }}
      >
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto" dir={isRTL ? "rtl" : "ltr"}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Truck className="w-5 h-5 text-blue-600" />
              {t.workflow.purchase.deliverMaterialsTechnician}
            </DialogTitle>
          </DialogHeader>

          {deliveryDialog && (
            <div className="space-y-4">
              {/* Item info */}
              <div className="bg-muted/50 rounded-lg p-3 space-y-2">
                <p className="font-semibold text-sm">{displayItemName(deliveryDialog)}</p>
                <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                  <span>{t.purchaseOrders.quantity}: <strong className="text-foreground">{deliveryDialog.quantity} {displayUnit(deliveryDialog.unit)}</strong></span>
                  {deliveryDialog.supplierName && <span>{t.purchaseOrders.supplier}: <strong className="text-foreground">{deliveryDialog.supplierName}</strong></span>}
                  {deliveryDialog.actualUnitCost && <span>{t.purchaseOrders.itemCost}: <strong className="text-foreground">{parseFloat(deliveryDialog.actualUnitCost).toLocaleString(locale)} {t.common.currency}</strong></span>}
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

              {lotsEnabled && (
                <div className="space-y-2 rounded-lg border border-blue-200 bg-blue-50/60 p-3">
                  <Label className="text-xs flex items-center gap-1">
                    <QrCode className="w-3.5 h-3.5" /> {t.workflow.purchase.lotQrRequired}
                  </Label>
                  <BarcodeScanner
                    onScan={(code) => {
                      setDeliveryLotInfo(null);
                      resolveDeliveryLotMut.mutate({ inventoryId: deliveryDialog.id, trackingToken: code });
                    }}
                    placeholder={t.workflow.purchase.scanLotForIssue}
                  />
                  {resolveDeliveryLotMut.isPending && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> {t.workflow.purchase.checkingLot}</p>
                  )}
                  {deliveryLotInfo && (
                    <div className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded p-2">
                      <strong>{deliveryLotInfo.lotCode}</strong> — {t.workflow.purchase.lotAvailableHere.replace("{qty}", String(deliveryLotInfo.availableQuantity)).replace("{unit}", displayUnit(deliveryDialog.unit) || t.workflow.purchase.unitGeneric)}
                    </div>
                  )}
                </div>
              )}

              {/* الكمية والوحدة */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">{t.workflow.purchase.deliveredQtyRequired}</Label>
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
                    <p className="text-xs text-destructive">{t.workflow.purchase.qtyGreaterZero}</p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{t.workflow.purchase.unitLabel2}</Label>
                  <Input
                    value={deliveryUnit}
                    readOnly={lotsEnabled && !!deliveryLotInfo}
                    onChange={e => setDeliveryUnit(e.target.value)}
                    placeholder={t.workflow.purchase.unitExamples}
                  />
                </div>
              </div>

              {lotsEnabled && deliveryLotInfo && (
                <IssueCostAllocationEditor
                  value={deliveryCostAllocations}
                  onChange={setDeliveryCostAllocations}
                  totalQuantity={Number(deliveryQty) || 0}
                  lotUnitCost={Number(deliveryLotInfo.issueUnitCost || 0)}
                  unitLabel={deliveryUnit || deliveryDialog.unit || t.workflow.purchase.unitGeneric}
                />
              )}

              {/* حلقة الربط مع البلاغ: المسؤول المسند ثابت ولا يتغير من المستودع */}
              {deliveryDialog.ticketAssignedToId && deliveryDialog.ticketAssignedToName && (
                <div className="space-y-1.5">
                  <Label className="text-xs flex items-center gap-1">
                    <User className="w-3.5 h-3.5" /> {t.workflow.purchase.assignedTicketResponsible}
                  </Label>
                  <Input
                    value={deliveryDialog.ticketAssignedToName}
                    readOnly
                    disabled
                    className="font-medium bg-muted"
                  />
                  {deliveryDialog.ticketNumber && (
                    <p className="text-xs text-muted-foreground">
                      {t.workflow.purchase.ticketReadonlyHint.replace("{ticket}", deliveryDialog.ticketNumber)}
                    </p>
                  )}
                </div>
              )}

              {/* المستلم الفعلي إلزامي ويمكن أن يكون المسؤول المسند نفسه أو فنيًا بديلًا */}
              <div className="space-y-1.5">
                <Label className="text-xs flex items-center gap-1">
                  <User className="w-3.5 h-3.5" /> {t.workflow.purchase.actualRecipientRequired2}
                </Label>
                <TechnicianCombobox
                  value={deliveryUserId}
                  onValueChange={setDeliveryUserId}
                  placeholder={t.workflow.purchase.chooseActualRecipient}
                  options={allUsers
                    .filter((u: any) =>
                      u.isActive !== 0 &&
                      (
                        u.role === "technician" ||
                        (
                          isItTeamRole(u.role) &&
                          deliveryDialog.ticketResponsibleDepartment === MAINTENANCE_RESPONSIBLE_DEPARTMENT.IT
                        )
                      )
                    )
                    .map((u: any) => ({
                      value: String(u.id),
                      label: `${u.name}${String(u.id) === String(deliveryDialog.ticketAssignedToId || "") ? ` — ${t.workflow.purchase.assignedResponsibleSuffix}` : ""}`,
                    }))}
                />
                <p className="text-xs text-muted-foreground">
                  {t.workflow.purchase.recipientSelectionHint}
                </p>
              </div>

              {/* ملاحظات — تظهر بعد اختيار الفني، كتابتها اختيارية */}
              {deliveryUserId && (
                <div className="space-y-1.5">
                  <Label className="text-xs">{t.workflow.purchase.notesOptional}</Label>
                  <Textarea
                    value={deliveryNotes}
                    onChange={e => setDeliveryNotes(e.target.value)}
                    placeholder={t.workflow.purchase.deliveryNotesPlaceholder}
                    rows={2}
                  />
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => { setDeliveryDialog(null); setDeliveryNotes(""); setDeliveryUserId(""); setDeliveryLotInfo(null); setDeliveryCostAllocations([createIssueCostAllocationDraft()]); }}>{t.common.cancel}</Button>
            <Button
              className="gap-1.5"
              disabled={
                confirmDeliveryMut.isPending ||
                deliverInventoryMut.isPending ||
                !deliveryUserId ||
                !deliveryQty ||
                Number.isNaN(parseFloat(deliveryQty)) ||
                parseFloat(deliveryQty) <= 0 ||
                resolveDeliveryLotMut.isPending ||
                (lotsEnabled && !deliveryLotInfo)
              }
              onClick={() => {
                // التحقق من الكمية أولاً
                const qty = parseFloat(deliveryQty);
                if (!deliveryQty || isNaN(qty) || qty <= 0) {
                  toast.error(t.workflow.purchase.enterValidPositiveQty);
                  return;
                }
                if (qty > (deliveryDialog.quantity || 0)) {
                  toast.error(t.workflow.purchase.qtyExceedsAvailable.replace("{qty}", String(qty)).replace("{available}", String(deliveryDialog.quantity)));
                  return;
                }
                if (!deliveryUserId) {
                  toast.error(t.workflow.purchase.recipientRequiredError);
                  return;
                }
                if (lotsEnabled && !deliveryLotInfo) {
                  toast.error(t.workflow.purchase.lotQrRequiredError);
                  return;
                }
                if (lotsEnabled && qty > Number(deliveryLotInfo?.availableQuantity || 0)) {
                  toast.error(t.workflow.purchase.qtyExceedsLot.replace("{qty}", String(qty)).replace("{available}", String(deliveryLotInfo?.availableQuantity || 0)));
                  return;
                }
                let costAllocations;
                try {
                  costAllocations = lotsEnabled
                    ? buildIssueCostAllocationPayload(deliveryCostAllocations, qty)
                    : undefined;
                } catch (error: any) {
                  toast.error(error?.message ? localizeApiError(error.message) : t.workflow.purchase.verifyCostAllocation);
                  return;
                }
                // حفظ بيانات الطباعة مع الفصل بين الفني المسند والمستلم الفعلي.
                const selectedUser = allUsers.find((u: any) => String(u.id) === deliveryUserId);
                setDeliveryPrintData({
                  itemName: displayItemName(deliveryDialog),
                  quantity: qty,
                  unit: displayUnit(deliveryUnit || deliveryDialog.unit || ""),
                  supplierName: deliveryDialog.supplierName,
                  actualUnitCost: deliveryDialog.actualUnitCost,
                  warehousePhotoUrl: deliveryDialog.warehousePhotoUrl ? mediaUrl(deliveryDialog.warehousePhotoUrl) : undefined,
                  deliveredByName: user?.name || t.workflow.purchase.warehouseUserFallback,
                  deliveredToName: selectedUser?.name || t.workflow.purchase.technicianFallback,
                  assignedTechnicianName: deliveryDialog.ticketAssignedToName || undefined,
                  ticketNumber: deliveryDialog.ticketNumber || undefined,
                  poNumber: deliveryDialog.poNumber,
                  itemId: deliveryDialog.id,
                  initialPrintCount: deliveryDialog.printCount ?? 0,
                  notes: deliveryNotes || undefined,
                  deliveredAt: new Date().toLocaleDateString(locale, { year: "numeric", month: "long", day: "numeric" }),
                });
                if (deliveryDialog.isInventoryItem) {
                  deliverInventoryMut.mutate({
                    inventoryId:   deliveryDialog.id,
                    deliveredToId: parseInt(deliveryUserId),
                    deliveryQty:   qty,
                    deliveryUnit:  deliveryUnit || deliveryDialog.unit || t.workflow.purchase.pieceUnit,
                    lotTrackingToken: lotsEnabled ? deliveryLotInfo?.trackingToken : undefined,
                    costAllocations,
                    notes:         deliveryNotes || undefined,
                  });
                } else {
                  confirmDeliveryMut.mutate({
                    itemId:        deliveryDialog.id,
                    deliveredToId: parseInt(deliveryUserId),
                    deliveryQty:   qty,
                    deliveryUnit:  deliveryUnit || deliveryDialog.unit || t.workflow.purchase.pieceUnit,
                    lotTrackingToken: lotsEnabled ? deliveryLotInfo?.trackingToken : undefined,
                    costAllocations,
                    notes:         deliveryNotes || undefined,
                  });
                }
                setDeliveryDialog(null);
                setDeliveryNotes("");
                setDeliveryUserId("");
                setDeliveryLotInfo(null);
                setDeliveryCostAllocations([createIssueCostAllocationDraft()]);
              }}
            >
              {(confirmDeliveryMut.isPending || deliverInventoryMut.isPending) ? <Loader2 className="w-4 h-4 animate-spin" /> : <Truck className="w-4 h-4" />}
              {t.workflow.purchase.confirmDeliveryTechnician}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
