import { useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { useTranslation } from "@/contexts/LanguageContext";
import { trpc } from "@/lib/trpc";
import { canReadWarehouseRequestDocuments, type WarehouseDocumentSource, type WarehouseRequestDocumentRow } from "@shared/warehouse-request-documents";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { buildDeliveryReceiptHtml } from "@/lib/printDeliveryDocument";
import { buildWarehouseIssueHtml } from "@/lib/printWarehouseIssueDocument";
import { buildReturnDocumentHtml } from "@/lib/printReturnDocument";
import { downloadDocumentAsPdf } from "@/lib/exportHtmlToPdf";
import { Printer, Eye, Download, RefreshCw } from "lucide-react";
import { toast } from "sonner";

export async function buildWarehouseRequestHtml(row: WarehouseRequestDocumentRow, document: any) {
  if (row.kind === "warehouse_issue") return buildWarehouseIssueHtml(document);
  if (row.kind === "return") return buildReturnDocumentHtml(document);
  return buildDeliveryReceiptHtml({ ...document, unit: document.unit || "", itemId: document.poItemId,
    initialPrintCount: document.printCount, deliveredAt: new Date(document.createdAt).toLocaleDateString("ar-SA", { timeZone: "Asia/Riyadh" }) });
}

export default function WarehouseRequestDocuments({ source }: { source: WarehouseDocumentSource }) {
  const { authenticatedUser, user } = useAuth();
  const { language, dir } = useTranslation();
  const l = (ar: string, en: string, ur: string) => language === "ar" ? ar : language === "ur" ? ur : en;
  const allowed = canReadWarehouseRequestDocuments(authenticatedUser ?? user);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<"newest" | "oldest">("newest");
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState<string | null>(null);
  const [details, setDetails] = useState<{ row: WarehouseRequestDocumentRow; document: any } | null>(null);
  const list = trpc.warehouseRequestDocuments.list.useQuery({ source, search, sort, page, pageSize: 20 }, { enabled: allowed, retry: false });
  const utils = trpc.useUtils();
  const recordPrint = trpc.warehouseRequestDocuments.recordPrint.useMutation();
  const sourceLabel = source === "pmv2" ? "PMV2" : source === "tickets" ? l("تذاكر الصيانة", "Maintenance tickets", "مرمت کے ٹکٹ") : l("الصرف التشغيلي", "Operational issues", "آپریشنل اجرا");
  const kindLabel = (kind: string) => kind === "return" ? l("سند مرتجع", "Return", "واپسی") : kind === "warehouse_issue" ? l("سند صرف مجمع", "Combined issue", "اجتماعی اجرا") : l("سند صرف", "Issue receipt", "اجرا کی رسید");
  const date = (value: string) => new Date(value).toLocaleString(language === "ar" ? "ar-SA" : language === "ur" ? "ur-PK" : "en-GB", { timeZone: "Asia/Riyadh" });
  const action = async (row: WarehouseRequestDocumentRow, mode: "details" | "view" | "download" | "print") => {
    const selection = { source, id: row.id, kind: row.kind };
    const popup = mode === "print" || mode === "view" ? window.open("", "_blank", "width=950,height=850") : null;
    if ((mode === "print" || mode === "view") && !popup) return toast.error(l("اسمح بفتح نافذة المستند", "Allow the document window", "دستاویز کی ونڈو کی اجازت دیں"));
    if (popup) popup.opener = null;
    setBusy(`${row.kind}:${row.id}`);
    try {
      // Fetch at every action boundary; a list row is not permission to print a later snapshot.
      const result = await utils.warehouseRequestDocuments.detail.fetch(selection, { staleTime: 0 });
      if (mode === "details") { setDetails(result); return; }
      const html = await buildWarehouseRequestHtml(result.row, result.document);
      if (mode === "view" && popup) {
        const response = await fetch("/api/export/html-to-pdf?download=0", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ html, filename: row.number, source: { type: row.kind, id: row.id } }) });
        if (!response.ok) throw Error((await response.json().catch(() => null))?.error || l("تعذر إنشاء PDF", "Unable to create PDF", "PDF نہیں بن سکی"));
        const url = URL.createObjectURL(await response.blob());
        popup.location.replace(url); setTimeout(() => URL.revokeObjectURL(url), 60000);
      }
      if (mode === "download") await downloadDocumentAsPdf(html, row.number, { type: row.kind, id: row.id });
      if (mode === "print" && popup) {
        // The existing document body is reused. The legacy toolbar has a PO-item
        // counter; this entry point uses the scoped document counter instead.
        await recordPrint.mutateAsync(selection);
        popup.document.write(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ""));
        popup.document.close(); popup.document.querySelector(".toolbar")?.remove();
        await popup.document.fonts?.ready;
        await Promise.all(Array.from(popup.document.images).map(image => Promise.race([
          image.decode().catch(() => {}), new Promise(resolve => setTimeout(resolve, 5000)),
        ])));
        popup.focus(); popup.print();
      }
    } catch (error) { popup?.close(); toast.error(error instanceof Error ? error.message : l("تعذر فتح المستند", "Unable to open document", "دستاویز نہیں کھل سکی")); }
    finally { setBusy(null); }
  };
  if (!allowed) return <p role="alert">{l("ليس لديك صلاحية مستندات طلبات المستودع", "Warehouse document access is unavailable", "گودام کی دستاویزات کی اجازت نہیں")}</p>;
  const data = list.data;
  return <div className="space-y-4" dir={dir}>
    <div className="flex flex-wrap items-end gap-3">
      <div className="min-w-56 flex-1"><label htmlFor="warehouse-document-search" className="text-sm font-medium">{l("البحث في المستندات", "Search documents", "دستاویز تلاش کریں")}</label>
        <Input id="warehouse-document-search" type="search" value={search} placeholder={l("رقم السند أو البلاغ أو المهمة أو أمر الصرف أو الصنف أو المستلم", "Document, ticket, task, order, item or recipient", "سند، ٹکٹ، کام، درخواست، مواد یا وصول کنندہ")}
          onChange={e => { setSearch(e.target.value); setPage(1); }} /></div>
      <div><label htmlFor="warehouse-document-sort" className="text-sm font-medium">{l("الترتيب", "Sort", "ترتیب")}</label>
        <select id="warehouse-document-sort" className="block h-10 rounded-md border bg-background px-3" value={sort} onChange={e => { setSort(e.target.value as typeof sort); setPage(1); }}>
          <option value="newest">{l("الأحدث أولًا", "Newest first", "نیا پہلے")}</option><option value="oldest">{l("الأقدم أولًا", "Oldest first", "پرانا پہلے")}</option>
        </select></div>
      <Button variant="outline" disabled={list.isFetching} onClick={() => void list.refetch()}><RefreshCw className="h-4 w-4 me-1"/>{l("تحديث", "Refresh", "تازہ کریں")}</Button>
    </div>
    <p className="text-sm text-muted-foreground">{l("سندات الصرف والمرتجعات المرتبطة بهذا المصدر", "Issue and return documents linked to this source", "اس ماخذ سے متعلق اجرا اور واپسی کی دستاویزات")} · {data?.total ?? 0}</p>
    {list.error && <p role="alert" className="text-destructive">{list.error.message}</p>}
    {list.isLoading && <p role="status">{l("جارٍ التحميل…", "Loading…", "لوڈ ہو رہا ہے…")}</p>}
    {!list.isLoading && !list.error && !data?.rows.length && <p>{l("لا توجد مستندات مطابقة", "No matching documents", "کوئی دستاویز نہیں ملی")}</p>}
    <div className="grid gap-3 lg:grid-cols-2">{data?.rows.map(row => <Card key={`${row.kind}:${row.id}`}><CardContent className="space-y-3 p-4">
      <div className="flex flex-wrap justify-between gap-2"><strong dir="ltr">{row.number}</strong><div className="flex flex-wrap gap-2"><Badge>{row.mixedSources ? l("مصادر متعددة", "Multiple sources", "متعدد ذرائع") : sourceLabel}</Badge><Badge variant="outline">{kindLabel(row.kind)}</Badge></div></div>
      <p className="text-xs text-muted-foreground">{date(row.createdAt)}</p>
      <p className="font-medium break-words line-clamp-2">{row.referenceNumber || "—"} · {row.referenceTitle || "—"}</p>
      <p className="line-clamp-2">{row.itemName} {row.quantity != null && <strong>— {row.quantity} {row.unit}</strong>}{row.itemCount > 1 && <Badge variant="secondary" className="ms-2">{row.itemCount} {l("مواد", "items", "مواد")}</Badge>}</p>
      <div className="grid gap-1 text-sm sm:grid-cols-2"><p>{l("المخزن", "Warehouse", "گودام")}: {row.warehouseName || "—"}</p><p>{l("المستلم", "Recipient", "وصول کنندہ")}: {row.recipientName || "—"}</p><p>{l("نفّذ العملية", "Performed by", "کارروائی کرنے والا")}: {row.issuerName || "—"}</p>{row.lotCode && <p dir="ltr">{row.lotCode}</p>}</div>
      <div className="flex flex-wrap gap-2">{(["details", "view", "download", "print"] as const).map(mode => <Button key={mode} size="sm" variant="outline" disabled={busy !== null} onClick={() => void action(row, mode)}>
        {mode === "print" ? <Printer className="h-4 w-4 me-1"/> : mode === "download" ? <Download className="h-4 w-4 me-1"/> : <Eye className="h-4 w-4 me-1"/>}
        {mode === "details" ? l("تفاصيل", "Details", "تفصیل") : mode === "view" ? l("عرض PDF", "View PDF", "PDF دیکھیں") : mode === "download" ? l("تنزيل PDF", "Download PDF", "PDF ڈاؤن لوڈ") : l("طباعة", "Print", "پرنٹ")}
      </Button>)}</div>
    </CardContent></Card>)}</div>
    {data && data.total > data.pageSize && <div className="flex items-center justify-center gap-3"><Button variant="outline" disabled={data.page <= 1 || list.isFetching} onClick={() => setPage(data.page - 1)}>{l("السابق", "Previous", "پچھلا")}</Button><span>{data.page} / {Math.ceil(data.total / data.pageSize)}</span><Button variant="outline" disabled={data.page * data.pageSize >= data.total || list.isFetching} onClick={() => setPage(data.page + 1)}>{l("التالي", "Next", "اگلا")}</Button></div>}
    <Dialog open={!!details} onOpenChange={open => !open && setDetails(null)}><DialogContent className="max-h-[85vh] overflow-auto sm:max-w-2xl"><DialogHeader><DialogTitle>{details?.row.number}</DialogTitle></DialogHeader>
      {details && <div className="space-y-3"><p>{sourceLabel} · {details.row.referenceNumber}</p><p>{details.row.referenceTitle}</p><p>{date(details.row.createdAt)}</p><p>{details.row.warehouseName} · {details.row.recipientName} · {details.row.issuerName}</p>
        {(details.document.items ?? [details.document]).map((item: any, index: number) => <div className="rounded border p-3" key={item.id ?? index}><strong>{item.itemName}</strong><p>{item.quantity ?? item.returnedQuantity} {item.unit}</p><p>{item.lotCode ?? details.row.lotCode} · {item.deliveryNumber ?? item.sourceDeliveryNumber ?? details.row.number}</p>{item.referenceNumber && <p>{item.referenceType === "pmv2" ? "PMV2" : item.referenceType === "ticket" ? l("تذاكر الصيانة", "Maintenance tickets", "مرمت کے ٹکٹ") : item.referenceType} · {item.referenceNumber}</p>}{details.row.kind === "delivery" && <p>{l("الكمية المرتجعة", "Returned quantity", "واپس کی گئی مقدار")}: {item.returnedQuantity ?? 0} {item.unit}</p>}</div>)}
        {(details.document.notes || details.document.reason) && <p className="whitespace-pre-wrap">{details.document.notes || details.document.reason}</p>}
      </div>}
    </DialogContent></Dialog>
  </div>;
}
