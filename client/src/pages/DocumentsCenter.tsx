// ============================================================
// مركز المستندات — /documents
// صفحة تجميع وقراءة فقط لمستندات الشراء والمخزون الموجودة بالنظام.
// Patch 124 أضاف نوع WIS (سند صرف مخزني تجميعي) بتسلسله وقالب طباعته
// الخاصين، مع بقاء DLV وحركات المخزون الأصلية كمصدر التأثير التشغيلي.
// مركز المستندات لا ينفذ الصرف؛ يعرض المستندات ويعيد طباعتها فقط.
// ============================================================
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { useState, useMemo, useEffect } from "react";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import {
  FileStack, Printer, Eye, Download,
} from "lucide-react";
import { toast } from "sonner";
import { buildReceiptHtml } from "@/lib/printReceiptDocument";
import { buildDeliveryReceiptHtml } from "@/lib/printDeliveryDocument";
import { buildWarehouseIssueHtml } from "@/lib/printWarehouseIssueDocument";
import { buildReturnDocumentHtml } from "@/lib/printReturnDocument";
import {
  buildDisposalHtml, buildCountHtml, buildSettlementHtml,
} from "@/lib/printInventoryOperationDocuments";
import { viewDocumentAsPdf, downloadDocumentAsPdf } from "@/lib/exportHtmlToPdf";
import { canOpenApprovalPdf, approvalPdfNotice, type ApprovalPdfPermission } from "@/lib/approvalPdfAccess";
import { downloadPricingBundlePdf } from "@/lib/downloadPricingBundlePdf";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { canReadPricingBundles, type PricingBundleRow } from "@shared/delegate-pricing-bundles";
import ApprovedPricingDocuments from "./documents/ApprovedPricingDocuments";
import { documentCenterSections, defaultDocumentKind, type DocumentKind, type ExistingDocumentKind } from "@/lib/documentCenterNavigation";
import DocumentFilters from "@/components/documents/DocumentFilters";

type DocType = ExistingDocumentKind;

type DocRow = ApprovalPdfPermission & {
  type: DocType;
  id: number;
  documentNumber: string;
  date: string | Date;
  referenceLabel: string;
  printCount: number | null;
  delegateId?: number | null; // فقط لنوع po_financial_batch — الجزء 2 (2026-08-10)
  totalEstimatedCost?: string | number | null; // الإجمالي الكلي لدفعة التسعير — ليس مبلغ العهدة على المندوب
  status?: string;
  purchaseOrders?: { id: number; poNumber: string }[];
  reviewUrl?: string | null;
};

function relativeOrDate(d: any) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("ar-SA", { year: "numeric", month: "short", day: "numeric" });
}

function formatFinancialGrandTotal(value: string | number | null | undefined) {
  if (value == null || value === "") return "—";
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "—";
  // تنسيق مالي موحد: فاصلة آلاف + خانتان عشريتان.
  return `${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ر.س.`;
}

const listRows = (data: any): any[] => Array.isArray(data) ? data : data?.rows || [];

export default function DocumentsCenter() {
  const { user } = useAuth();
  const sections = documentCenterSections(user);
  const [selection, setSelection] = useState<DocumentKind | undefined>(()=>defaultDocumentKind(user,sections));
  const selected = sections.some(section=>section.types.some(type=>type.key===selection))?selection:defaultDocumentKind(user,sections);
  const section = sections.find(section=>section.types.some(type=>type.key===selected));
  const selectedLabel = section?.types.find(type=>type.key===selected)?.label;
  if (!section || !selected) return <p role="status">لا توجد مستندات متاحة لهذا الحساب.</p>;
  return <div className="space-y-5" dir="rtl">
    <div><h1 className="text-2xl font-bold flex items-center gap-2"><FileStack className="w-6 h-6 text-primary" />مركز المستندات</h1><p className="text-sm text-muted-foreground mt-1">اختر القسم ونوع المستند للاستعراض أو التنزيل أو الطباعة.</p></div>
    <div className="flex flex-wrap gap-2" role="tablist" aria-label="أقسام مركز المستندات">
      {sections.map(item=><Button key={item.id} role="tab" aria-selected={item.id===section.id} variant={item.id===section.id?"default":"outline"} onClick={()=>setSelection(item.types[0].key)}>{item.label}</Button>)}
    </div>
    <div className="max-w-sm space-y-1"><span className="text-sm font-medium">نوع المستند</span><Select value={selected} onValueChange={value=>setSelection(value as DocumentKind)}><SelectTrigger aria-label="نوع المستند"><SelectValue>{selectedLabel}</SelectValue></SelectTrigger><SelectContent>{section.types.map(type=><SelectItem key={type.key} value={type.key}>{type.label}</SelectItem>)}</SelectContent></Select></div>
    {selected === "approved_pricing_bundle" ? <ApprovedPricingDocuments embedded /> : <ExistingDocumentsCenter key={selected} typeFilter={selected} />}
  </div>;
}

function ExistingDocumentsCenter({typeFilter}: {typeFilter:DocType}) {
  const { user } = useAuth();
  const role = (user?.role as string) || "";
  // الحسابات ترى الأنواع المالية الثلاثة فقط؛ لا تُجلب مستندات المخزون لها.
  const isAccountantOnly = role === "accountant";
  // المندوب لم يكن يملك مركز المستندات سابقًا. بعد إضافة تبويب مستندات
  // التسعير نمنحه المركز لهذا التبويب فقط، دون جلب بقية أنواع المستندات.
  const isDelegateOnly = role === "delegate";
  const canViewGeneralDocs = !isAccountantOnly && !isDelegateOnly;

  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  // فلترة "الوثائق المالية المعتمدة" حسب المندوب — الجزء 2 (2026-08-10)
  const [delegateFilter, setDelegateFilter] = useState<string>("all");
  const [dateTo, setDateTo] = useState("");
  const [sort, setSort] = useState<"newest" | "oldest">("newest");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 20;
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  useEffect(() => { const timer = setTimeout(() => setDebouncedSearch(search), 300); return () => clearTimeout(timer); }, [search]);
  const paginated = ["po_financial_batch", "delegate_pricing_documents", "delegate_pricing_bundle"].includes(typeFilter);
  const pagination = { page, pageSize: PAGE_SIZE, search: debouncedSearch,
    dateFrom: dateFrom || undefined, dateTo: dateTo || undefined,
    delegateId: delegateFilter === "all" ? undefined : Number(delegateFilter), sort };
  const wants = (type: DocType) => !!user && typeFilter === type;
  const [printingKey, setPrintingKey] = useState<string | null>(null);
  const [viewingKey, setViewingKey] = useState<string | null>(null);
  const [downloadingKey, setDownloadingKey] = useState<string | null>(null);
  const [selectedBundleId, setSelectedBundleId] = useState<number | null>(null);

  // ── نفس الاستعلامات المستخدمة أصلاً في كل صفحة (نفس الصلاحيات والنطاق) ──
  // لا تُجلَب إطلاقًا لدور الحسابات (enabled) — راجع isAccountantOnly أعلاه.
  const poQ       = trpc.purchaseOrders.list.useQuery({}, { enabled: canViewGeneralDocs && wants("purchase_order") });
  const receiptsQ = trpc.warehouseReceipts.list.useQuery(undefined, { enabled: canViewGeneralDocs && wants("receipt") });
  const deliveryQ = trpc.deliveryDocuments.list.useQuery(undefined, { enabled: canViewGeneralDocs && wants("delivery") });
  const warehouseIssueQ = trpc.warehouseIssueBatches.list.useQuery(undefined, { enabled: canViewGeneralDocs && wants("warehouse_issue") });
  const returnQ   = trpc.returnDocuments.list.useQuery(undefined, { enabled: canViewGeneralDocs && wants("return") });
  const disposalQ = trpc.disposal.list.useQuery(undefined, { enabled: canViewGeneralDocs && wants("disposal") });
  const countQ    = trpc.inventoryCount.listOperations.useQuery(undefined, { enabled: canViewGeneralDocs && wants("count") });
  const settleQ   = trpc.inventoryCount.listSettlements.useQuery(undefined, { enabled: canViewGeneralDocs && wants("settlement") });

  // ── الوثائق المالية المعتمدة (2026-08-10) ──────────────────────────────
  // نسخ PDF مؤرشفة فعليًا عند اعتماد الحسابات لدفعة تسعير. مندمجة بنفس جدول
  // وفلاتر بقية الأنواع (طلب صريح من صاحب المشروع)، لا قسم منفصل — الفرق
  // الوحيد أن الملف مُخزَّن سلفًا (لا يُعاد توليده حيًا)، ومقيَّدة بأدوار مالية
  // (الخادم يرفض الاستعلام لغير المخوَّلين تلقائيًا؛ enabled هنا تحسين عرض
  // فقط، لا حارس صلاحية حقيقي — راجع attachments.router.ts::listByType).
  const financialRoles = ["accountant", "senior_management", "owner", "admin"];
  const canViewFinancialDocs = financialRoles.includes(role);
  const delegatePricingRoles = ["delegate", "accountant", "senior_management", "owner", "admin"];
  const canViewDelegatePricingDocs = delegatePricingRoles.includes(role);
  const financialDocsQ = trpc.attachments.listByType.useQuery(
    { entityType: "po_financial_batch", pagination: paginated ? pagination : undefined },
    { enabled: canViewFinancialDocs && wants("po_financial_batch") },
  );
  const delegatePricingDocsQ = trpc.attachments.listByType.useQuery(
    { entityType: "delegate_pricing_documents", pagination: paginated ? pagination : undefined },
    { enabled: canViewDelegatePricingDocs && wants("delegate_pricing_documents") },
  );
  const canViewBundles = !!user && !isDelegateOnly && role !== "observer" && canReadPricingBundles(user);
  const bundleStatusQ = trpc.delegatePricingBundles.status.useQuery(undefined, { enabled: canViewBundles && wants("delegate_pricing_bundle"), retry: false });
  const bundlesEnabled = canViewBundles && bundleStatusQ.data?.enabled === true;
  const bundlesPageQ = trpc.delegatePricingBundles.listPage.useQuery(pagination, { enabled: bundlesEnabled && typeFilter === "delegate_pricing_bundle", retry: false });
  const bundlesQ = bundlesPageQ;
  const bundleDetailQ = trpc.delegatePricingBundles.detail.useQuery({ id: selectedBundleId || 0 }, { enabled: !!selectedBundleId && bundlesEnabled, retry: false });
  const bundlePdf = trpc.delegatePricingBundles.pdf.useMutation();

  const queryEntries = [
    ["purchase_order", poQ, canViewGeneralDocs], ["receipt", receiptsQ, canViewGeneralDocs],
    ["delivery", deliveryQ, canViewGeneralDocs], ["warehouse_issue", warehouseIssueQ, canViewGeneralDocs],
    ["return", returnQ, canViewGeneralDocs], ["disposal", disposalQ, canViewGeneralDocs],
    ["count", countQ, canViewGeneralDocs], ["settlement", settleQ, canViewGeneralDocs],
    ["po_financial_batch", financialDocsQ, canViewFinancialDocs],
    ["delegate_pricing_documents", delegatePricingDocsQ, canViewDelegatePricingDocs],
    ["delegate_pricing_bundle", bundlesQ, bundlesEnabled],
  ] as const;
  const activeQueries = queryEntries.filter(([type, , allowed]) => allowed && wants(type)).map(([, query]) => query);
  const loadingBundles = wants("delegate_pricing_bundle") && canViewBundles && bundleStatusQ.isLoading;
  // Keep the selected list visible while its supporting status query loads.
  const pendingLists = loadingBundles || activeQueries.some(query => query.isLoading);
  const isLoading = pendingLists && activeQueries.every(query => query.data === undefined);
  const activeError = activeQueries.some(query => query.error) || (wants("delegate_pricing_bundle") && !!bundleStatusQ.error);
  const pageResult = paginated ? typeFilter === "po_financial_batch" ? financialDocsQ.data
    : typeFilter === "delegate_pricing_documents" ? delegatePricingDocsQ.data : bundlesQ.data : undefined;
  const serverPage = pageResult && !Array.isArray(pageResult) ? pageResult : undefined;
  const refresh = () => {
    activeQueries.forEach(query => query.refetch());
    if (canViewBundles && wants("delegate_pricing_bundle")) bundleStatusQ.refetch();
  };

  // ── تطبيع كل الأنواع لشكل صف موحّد للعرض فقط (لا تُستخدم للطباعة) ──
  const rows: DocRow[] = useMemo(() => {
    const out: DocRow[] = [];
    if (canViewGeneralDocs) {
    (poQ.data as any[] || []).forEach(po => out.push({
      type: "purchase_order", id: po.id, documentNumber: po.poNumber,
      date: po.createdAt, referenceLabel: po.requestedByName || "—", printCount: null,
      pdfAllowed: po.pdfAllowed, pdfBlockedReason: po.pdfBlockedReason,
    }));
    (receiptsQ.data as any[] || []).forEach(r => out.push({
      type: "receipt", id: r.id, documentNumber: r.receiptNumber,
      date: r.receivedAt || r.createdAt, referenceLabel: r.vendorName || "استلام مستقل", printCount: r.printCount ?? 0,
    }));
    (deliveryQ.data as any[] || []).forEach(d => out.push({
      type: "delivery", id: d.id, documentNumber: d.deliveryNumber,
      date: d.createdAt, referenceLabel: d.deliveredToName || "—", printCount: d.printCount ?? 0,
    }));
    (warehouseIssueQ.data as any[] || []).forEach(w => out.push({
      type: "warehouse_issue", id: w.id, documentNumber: w.issueNumber,
      date: w.createdAt, referenceLabel: `${w.warehouseName || "—"} ← ${w.deliveredToName || "—"}`, printCount: w.printCount ?? 0,
    }));
    (returnQ.data as any[] || []).forEach(r => out.push({
      type: "return", id: r.id, documentNumber: r.returnNumber,
      date: r.createdAt, referenceLabel: r.returnedByName || "—", printCount: r.printCount ?? 0,
    }));
    (disposalQ.data as any[] || []).forEach(op => out.push({
      type: "disposal", id: op.id, documentNumber: op.operationNumber,
      date: op.operationDate || op.createdAt, referenceLabel: op.notes || "—", printCount: null,
    }));
    (countQ.data as any[] || []).forEach(op => out.push({
      type: "count", id: op.id, documentNumber: op.operationNumber,
      date: op.operationDate || op.createdAt, referenceLabel: op.operationTitle || (op.scope === "full" ? "جرد شامل" : "جرد جزئي"), printCount: null,
    }));
    (settleQ.data as any[] || []).forEach(s => out.push({
      type: "settlement", id: s.id, documentNumber: s.settlementNumber,
      date: s.appliedAt || s.createdAt, referenceLabel: s.reason || "—", printCount: null,
    }));
    }
    if (canViewDelegatePricingDocs) {
      listRows(delegatePricingDocsQ.data).forEach(doc => out.push({
        type: "delegate_pricing_documents", id: doc.id, documentNumber: doc.fileName,
        date: doc.createdAt, referenceLabel: doc.delegateName || "بلا مندوب", printCount: null,
        delegateId: doc.delegateId ?? null,
        totalEstimatedCost: doc.totalEstimatedCost ?? null,
        pdfAllowed: doc.pdfAllowed, pdfBlockedReason: doc.pdfBlockedReason,
        reviewUrl: doc.reviewUrl,
      }));
    }
    if (canViewFinancialDocs) {
      listRows(financialDocsQ.data).forEach(doc => out.push({
        type: "po_financial_batch", id: doc.id, documentNumber: doc.fileName,
        date: doc.createdAt, referenceLabel: doc.delegateName || "بلا مندوب", printCount: null,
        delegateId: doc.delegateId ?? null,
        totalEstimatedCost: doc.totalEstimatedCost ?? null,
        pdfAllowed: doc.pdfAllowed, pdfBlockedReason: doc.pdfBlockedReason,
        reviewUrl: doc.reviewUrl,
      }));
    }
    if (bundlesEnabled) {
      listRows(bundlesQ.data).filter(bundle => bundle.status !== "open").forEach((bundle: any) => out.push({
        type: "delegate_pricing_bundle", id: bundle.id, documentNumber: bundle.bundleNumber,
        date: bundle.sentAt || bundle.createdAt, referenceLabel: bundle.delegateName || "بلا مندوب", printCount: null,
        delegateId: bundle.delegateId, totalEstimatedCost: bundle.total, status: bundle.status,
        purchaseOrders: bundle.purchaseOrders || [], pdfAllowed: bundle.pdfAllowed, pdfBlockedReason: bundle.pdfBlockedReason,
      }));
    }
    return out;
  }, [poQ.data, receiptsQ.data, deliveryQ.data, warehouseIssueQ.data, returnQ.data, disposalQ.data, countQ.data, settleQ.data, canViewGeneralDocs, canViewFinancialDocs, canViewDelegatePricingDocs, financialDocsQ.data, delegatePricingDocsQ.data, bundlesEnabled, bundlesQ.data]);

  // ── الفلترة والبحث والترتيب — على القائمة المجمَّعة كاملة ──
  const filtered = useMemo(() => {
    if (paginated) return rows.filter(row => row.type === typeFilter);
    const q = search.trim().toLowerCase();
    const from = dateFrom ? new Date(`${dateFrom}T00:00:00`) : null;
    const to   = dateTo   ? new Date(`${dateTo}T23:59:59.999`) : null;
    let list = rows.filter(r => {
      if (r.type !== typeFilter) return false;
      // فلترة المندوب — تنطبق فقط على نوع "الوثائق المالية المعتمدة"
      if (["po_financial_batch", "delegate_pricing_documents", "delegate_pricing_bundle"].includes(r.type) && delegateFilter !== "all") {
        if (String(r.delegateId ?? "") !== delegateFilter) return false;
      }
      const d = r.date ? new Date(r.date) : null;
      if (from && (!d || d < from)) return false;
      if (to && (!d || d > to)) return false;
      if (q) {
        const hay = `${r.documentNumber} ${r.referenceLabel} ${(r.purchaseOrders || []).map(po => po.poNumber).join(" ")}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    list.sort((a, b) => {
      const da = a.date ? new Date(a.date).getTime() : 0;
      const db = b.date ? new Date(b.date).getTime() : 0;
      return sort === "newest" ? db - da : da - db;
    });
    return list;
  }, [rows, search, typeFilter, delegateFilter, dateFrom, dateTo, sort, paginated]);

  const resultCount = serverPage?.total ?? filtered.length;
  const visiblePage = serverPage?.page ?? page;
  const totalPages = Math.max(1, Math.ceil(resultCount / PAGE_SIZE));
  const pageRows = paginated ? filtered : filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // قائمة المندوبين الفريدة لهذا الفلتر — من بيانات "الوثائق المالية المعتمدة" فقط
  const financialDelegateOptions = useMemo(() => {
    const map = new Map<string, string>();
    if (serverPage) return serverPage.delegates.map(person => [String(person.id), person.name] as [string, string]);
    [...listRows(financialDocsQ.data), ...listRows(delegatePricingDocsQ.data), ...listRows(bundlesQ.data)].forEach((doc: any) => {
      if (doc.delegateId != null) map.set(String(doc.delegateId), doc.delegateName || `مستخدم #${doc.delegateId}`);
    });
    return Array.from(map.entries());
  }, [financialDocsQ.data, delegatePricingDocsQ.data, bundlesQ.data, serverPage]);

  const utils = trpc.useUtils();
  const incrementDeliveryPrintMut = trpc.deliveryDocuments.incrementPrint.useMutation();
  const incrementWarehouseIssuePrintMut = trpc.warehouseIssueBatches.incrementPrint.useMutation();
  const incrementReturnPrintMut   = trpc.returnDocuments.incrementPrint.useMutation();
  const incrementReceiptPrintMut  = trpc.warehouseReceipts.incrementPrint.useMutation();

  // يبني بيانات وثيقة التسليم من صف القائمة (نفس الحقول التي يتوقعها القالب)
  const buildDeliveryData = async (row: DocRow) => {
    const full = await utils.deliveryDocuments.getForPrint.fetch({ id: row.id });
    if (!full) throw new Error("تعذر إيجاد بيانات سند التسليم");
    return {
      itemName: full.itemName, quantity: full.quantity, unit: full.unit || "",
      supplierName: full.supplierName ?? undefined, actualUnitCost: full.actualUnitCost ?? undefined,
      warehousePhotoUrl: full.warehousePhotoUrl ?? undefined, deliveredByName: full.deliveredByName,
      deliveredBySignature: full.deliveredBySignature,
      deliveredToName: full.deliveredToName, notes: full.notes ?? undefined, poNumber: full.poNumber ?? undefined,
      deliveryNumber: full.deliveryNumber,
      deliveredAt: relativeOrDate(full.createdAt),
      itemId: full.poItemId, initialPrintCount: full.printCount,
    };
  };

  // يبني نص HTML الموحّد للأنواع الستة غير طلب الشراء (نفس القوالب حرفيًا)
  // يُستخدم من الطباعة المباشرة ومن عرض/تنزيل PDF الحقيقي، بلا أي تكرار منطق
  const buildHtmlForRow = async (row: DocRow): Promise<string> => {
    switch (row.type) {
      case "receipt": {
        const receipt = await utils.warehouseReceipts.getForPrint.fetch({ id: row.id });
        return buildReceiptHtml(receipt);
      }
      case "delivery":
        return buildDeliveryReceiptHtml(await buildDeliveryData(row));
      case "warehouse_issue": {
        const data = await utils.warehouseIssueBatches.getById.fetch({ id: row.id });
        return buildWarehouseIssueHtml(data as any);
      }
      case "return": {
        const full = (returnQ.data as any[] || []).find(r => r.id === row.id);
        if (!full) throw new Error("تعذر إيجاد بيانات سند المرتجع");
        return buildReturnDocumentHtml(full);
      }
      case "disposal": {
        const op = await utils.disposal.getById.fetch({ id: row.id });
        return buildDisposalHtml(op);
      }
      case "count": {
        const data = await utils.inventoryCount.operationDetails.fetch({ operationId: row.id });
        return buildCountHtml(data as any);
      }
      case "settlement": {
        const data = await utils.inventoryCount.settlementDetails.fetch({ settlementId: row.id });
        return buildSettlementHtml(data as any);
      }
      default:
        throw new Error("نوع غير مدعوم");
    }
  };

  // عدّاد الطباعة الخاص بالنوع (إن وُجد) — يُستدعى فقط عند الطباعة الفعلية
  const incrementPrintForRow = (row: DocRow) => {
    if (row.type === "receipt") incrementReceiptPrintMut.mutate({ id: row.id });
    else if (row.type === "delivery") incrementDeliveryPrintMut.mutate({ id: row.id });
    else if (row.type === "warehouse_issue") incrementWarehouseIssuePrintMut.mutate({ id: row.id });
    else if (row.type === "return") incrementReturnPrintMut.mutate({ id: row.id });
  };

  // ── الطباعة: كل نوع يستدعي بالضبط نفس القالب المستخدم بصفحته الأصلية ──
  // يجلب رابط الملف المؤرشف فعليًا (لا توليد حي) لصف "الوثائق المالية المعتمدة"
  const getArchivedDoc = (row: DocRow): any => {
    const source = row.type === "delegate_pricing_documents" ? delegatePricingDocsQ.data : financialDocsQ.data;
    const doc = listRows(source).find(d => d.id === row.id);
    if (!doc?.fileUrl) throw new Error("تعذر إيجاد رابط الملف المؤرشف");
    return doc;
  };
  const getArchivedDocUrl = (row: DocRow): string => getArchivedDoc(row).fileUrl as string;
  const rowPdfAllowed = (row: DocRow) => role !== "observer" && (!["purchase_order", "po_financial_batch", "delegate_pricing_documents", "delegate_pricing_bundle"].includes(row.type) || canOpenApprovalPdf(role, row));

  const openBundlePdf = async (id:number) => {
    const preview = window.open("", "_blank");
    if(!preview)throw Error("اسمح بفتح النوافذ لعرض الوثيقة وطباعتها");
    preview.opener=null;
    try {
      const file=await bundlePdf.mutateAsync({id,approvedDocument:role!=="delegate"});
      const bytes=Uint8Array.from(atob(file.content),char=>char.charCodeAt(0));
      const url=URL.createObjectURL(new Blob([bytes],{type:"application/pdf"}));
      preview.location.replace(url);setTimeout(()=>URL.revokeObjectURL(url),60000);
    }catch(error){preview.close();throw error;}
  };
  const downloadBundlePdf = async (id:number) => downloadPricingBundlePdf(await bundlePdf.mutateAsync({id,approvedDocument:role!=="delegate"}));

  const handlePrint = async (row: DocRow) => {
    if (!rowPdfAllowed(row)) return toast.error(approvalPdfNotice());
    const key = `${row.type}-${row.id}`;
    setPrintingKey(key);
    try {
      if(row.type === "delegate_pricing_bundle") {
        await openBundlePdf(row.id);
      } else if (["po_financial_batch", "delegate_pricing_documents"].includes(row.type)) {
        window.open(getArchivedDocUrl(row), "_blank");
      } else if (row.type === "purchase_order") {
        const res = await fetch(`/api/export/po/${row.id}/pdf`, { credentials: "include" });
        if (!res.ok) throw new Error("تعذر تجهيز ملف طلب الشراء");
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const win = window.open(url, "_blank");
        if (!win) { const a = document.createElement("a"); a.href = url; a.download = `${row.documentNumber}.pdf`; a.click(); }
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      } else {
        const html = await buildHtmlForRow(row);
        const win = window.open("", "_blank", "width=900,height=800");
        if (win) { win.document.write(html); win.document.close(); }
        incrementPrintForRow(row);
      }
    } catch (e: any) {
      toast.error(e.message || "تعذرت الطباعة");
    } finally {
      setPrintingKey(null);
    }
  };

  // ── عرض/تنزيل PDF حقيقي — يبني نفس HTML أعلاه ويحوّله عبر الخادم (Puppeteer) ──
  const handleViewPdf = async (row: DocRow) => {
    if (!rowPdfAllowed(row)) return toast.error(approvalPdfNotice());
    const key = `${row.type}-${row.id}`;
    setViewingKey(key);
    try {
      if(row.type === "delegate_pricing_bundle") {
        await openBundlePdf(row.id);
      } else if (["po_financial_batch", "delegate_pricing_documents"].includes(row.type)) {
        window.open(getArchivedDocUrl(row), "_blank");
      } else if (row.type === "purchase_order") {
        const res = await fetch(`/api/export/po/${row.id}/pdf`, { credentials: "include" });
        if (!res.ok) throw new Error("تعذر تجهيز ملف طلب الشراء");
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        window.open(url, "_blank");
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      } else {
        const html = await buildHtmlForRow(row);
        await viewDocumentAsPdf(html, row.documentNumber, { type: row.type as "receipt" | "delivery" | "warehouse_issue" | "return" | "disposal" | "count" | "settlement", id: row.id });
      }
    } catch (e: any) {
      toast.error(e.message || "تعذر عرض الملف");
    } finally {
      setViewingKey(null);
    }
  };

  const handleDownloadPdf = async (row: DocRow) => {
    if (!rowPdfAllowed(row)) return toast.error(approvalPdfNotice());
    const key = `${row.type}-${row.id}`;
    setDownloadingKey(key);
    try {
      if(row.type === "delegate_pricing_bundle") {
        await downloadBundlePdf(row.id);
      } else if (["po_financial_batch", "delegate_pricing_documents"].includes(row.type)) {
        const doc = getArchivedDoc(row);
        const baseUrl = getArchivedDocUrl(row);
        // نستخدم دعم البروكسي المدمج لفرض التنزيل (download=1) بدل الاعتماد
        // فقط على سمة a.download — أكثر موثوقية عبر المتصفحات المختلفة.
        const sep = baseUrl.includes("?") ? "&" : "?";
        const downloadUrl = `${baseUrl}${sep}download=1&filename=${encodeURIComponent(doc?.fileName || `${row.documentNumber}.pdf`)}`;
        const a = document.createElement("a");
        a.href = downloadUrl; a.download = doc?.fileName || `${row.documentNumber}.pdf`; a.click();
      } else if (row.type === "purchase_order") {
        const res = await fetch(`/api/export/po/${row.id}/pdf`, { credentials: "include" });
        if (!res.ok) throw new Error("تعذر تجهيز ملف طلب الشراء");
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = `${row.documentNumber}.pdf`; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      } else {
        const html = await buildHtmlForRow(row);
        await downloadDocumentAsPdf(html, row.documentNumber, { type: row.type as "receipt" | "delivery" | "warehouse_issue" | "return" | "disposal" | "count" | "settlement", id: row.id });
      }
    } catch (e: any) {
      toast.error(e.message || "تعذر تنزيل الملف");
    } finally {
      setDownloadingKey(null);
    }
  };


  return (
    <div className="space-y-4">
      <DocumentFilters values={{search,dateFrom,dateTo,sort,delegateId:delegateFilter}}
        onChange={value=>{setSearch(value.search);setDateFrom(value.dateFrom);setDateTo(value.dateTo);setSort(value.sort);setDelegateFilter(value.delegateId||"all");setPage(1);}}
        onRefresh={refresh} refreshing={isLoading}
        delegates={role!=="delegate"&&["po_financial_batch","delegate_pricing_documents","delegate_pricing_bundle"].includes(typeFilter)?financialDelegateOptions:undefined} />
      {!isLoading&&!activeError&&<p className="text-sm text-muted-foreground" role="status">{resultCount} مستند مطابق</p>}

      {(role === "accountant" || role === "senior_management") && typeFilter !== "delegate_pricing_bundle" && <p className="text-sm text-muted-foreground">{approvalPdfNotice()}</p>}
      {activeError && <p role="alert">تعذر تحميل بعض المستندات. أعد المحاولة من تحديث البيانات.</p>}
      {pendingLists && !isLoading && <p role="status">جارٍ تحميل بقية المستندات…</p>}
      {typeFilter === "delegate_pricing_bundle" && canViewBundles && bundleStatusQ.data?.enabled === false && <p role="status">حزم التسعير غير مفعلة حاليًا.</p>}

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Card key={i}><CardContent className="p-4"><Skeleton className="h-12 w-full" /></CardContent></Card>
          ))}
        </div>
      ) : pageRows.length === 0 && !activeError ? (
        <Card><CardContent className="p-12 text-center text-muted-foreground">لا توجد مستندات مطابقة</CardContent></Card>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-start">رقم المستند</TableHead>
                {["po_financial_batch", "delegate_pricing_documents", "delegate_pricing_bundle"].includes(typeFilter) && (
                  <TableHead className="text-start whitespace-nowrap">الإجمالي الكلي</TableHead>
                )}
                <TableHead className="text-start">التاريخ</TableHead>
                <TableHead className="text-start">المرجع</TableHead>
                <TableHead className="text-start">إجراء</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageRows.map(row => {
                const key = `${row.type}-${row.id}`;
                const pdfAllowed = rowPdfAllowed(row);
                return (
                  <TableRow key={key}>
                    <TableCell className="font-mono text-sm">{row.documentNumber}</TableCell>
                    {["po_financial_batch", "delegate_pricing_documents", "delegate_pricing_bundle"].includes(typeFilter) && (
                      <TableCell className="font-mono text-sm font-semibold whitespace-nowrap">
                        {formatFinancialGrandTotal(row.totalEstimatedCost)}
                      </TableCell>
                    )}
                    <TableCell className="text-sm text-muted-foreground whitespace-nowrap">{relativeOrDate(row.date)}</TableCell>
                    <TableCell className="text-sm max-w-[220px] truncate">{row.referenceLabel}</TableCell>
                    <TableCell>
                      <div className="flex flex-col items-start gap-1.5 sm:flex-row">
                        {row.type === "delegate_pricing_bundle" && <Button size="sm" variant="ghost" onClick={() => setSelectedBundleId(row.id)}>تفاصيل</Button>}
                        {row.reviewUrl && <Link href={row.reviewUrl} className="text-sm text-primary underline self-center px-2">بيانات المعاملة</Link>}
                        {pdfAllowed ? <>
                        <Button
                          size="sm" variant="outline" className="gap-1.5 px-2"
                          disabled={viewingKey === key}
                          title="عرض PDF"
                          onClick={() => handleViewPdf(row)}
                        >
                          <Eye className="w-3.5 h-3.5" />استعراض
                        </Button>
                        <Button
                            size="sm" variant="outline" className="gap-1.5 px-2"
                            disabled={downloadingKey === key}
                            title="تنزيل PDF"
                            onClick={() => handleDownloadPdf(row)}
                          >
                            <Download className="w-3.5 h-3.5" />
                            تنزيل PDF
                          </Button>
                        <Button
                          size="sm" variant="outline" className="gap-1.5"
                          disabled={printingKey === key}
                          onClick={() => handlePrint(row)}
                        >
                          <Printer className="w-3.5 h-3.5" />
                          {printingKey === key ? "..." : "طباعة"}
                        </Button>
                        </> : <span className="text-xs text-muted-foreground self-center">{role === "observer" ? "استعراض فقط" : "PDF متاح بعد اعتمادك"}</span>}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}

      <Dialog open={selectedBundleId != null} onOpenChange={open => { if (!open) setSelectedBundleId(null); }}>
        <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto" dir="rtl">
          <DialogHeader><DialogTitle>تفاصيل حزمة التسعير {bundleDetailQ.data?.bundleNumber}</DialogTitle></DialogHeader>
          {bundleDetailQ.isLoading ? <p>جارٍ التحميل…</p> : bundleDetailQ.error ? <p role="alert">تعذر تحميل تفاصيل الحزمة. أعد المحاولة.</p> : bundleDetailQ.data ? <div className="space-y-4">
            <p>المندوب: {bundleDetailQ.data.delegateName} — التاريخ: {relativeOrDate(bundleDetailQ.data.createdAt)}</p>
            <div className="overflow-x-auto"><Table><TableHeader><TableRow>{["الصنف", "طلب الشراء", "القسم", "الكمية", "الوحدة", "السعر", "المورد", "الإجمالي"].map(label => <TableHead key={label}>{label}</TableHead>)}</TableRow></TableHeader><TableBody>{bundleDetailQ.data.items.map((item: PricingBundleRow) => <TableRow key={item.id}><TableCell>{item.itemName}</TableCell><TableCell><Link href={`/purchase-orders/${item.purchaseOrderId}?itemId=${item.id}`} className="text-primary underline">{item.poNumber}</Link></TableCell><TableCell>{item.sectionName}</TableCell><TableCell>{item.quantity}</TableCell><TableCell>{item.unit}</TableCell><TableCell>{formatFinancialGrandTotal(item.estimatedUnitCost)}</TableCell><TableCell>{item.supplierName}</TableCell><TableCell>{formatFinancialGrandTotal(item.estimatedTotalCost)}</TableCell></TableRow>)}</TableBody></Table></div>
            <p>الإجمالي: {formatFinancialGrandTotal(bundleDetailQ.data.total)}</p>
            {canOpenApprovalPdf(role, rows.find(row => row.type === "delegate_pricing_bundle" && row.id === selectedBundleId)) ? <Button disabled={bundlePdf.isPending} onClick={async()=>{try{await downloadBundlePdf(bundleDetailQ.data!.id);}catch(error:any){toast.error(error.message||"تعذر تنزيل الملف");}}}>تنزيل PDF</Button> : <p>{approvalPdfNotice()}</p>}
          </div> : null}
          <Button variant="outline" onClick={() => setSelectedBundleId(null)}>إغلاق</Button>
        </DialogContent>
      </Dialog>

      {!isLoading && resultCount > 0 && totalPages > 1 && (
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">النتائج: {resultCount}</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={visiblePage <= 1} onClick={() => setPage(visiblePage - 1)}>السابق</Button>
            <span className="text-xs text-muted-foreground self-center">{visiblePage} / {totalPages}</span>
            <Button variant="outline" size="sm" disabled={visiblePage >= totalPages} onClick={() => setPage(visiblePage + 1)}>التالي</Button>
          </div>
        </div>
      )}
    </div>
  );
}
