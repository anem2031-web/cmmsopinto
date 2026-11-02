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
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import {
  FileStack, Search, RefreshCw, Printer, ShoppingCart, PackageCheck,
  Truck, RotateCcw, Trash2, ClipboardCheck, Scale, Eye, Download, Landmark, FileText,
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
import { canReadApprovedPricingDocuments, EXISTING_DOCUMENT_CENTER_ROLES, APPROVED_PRICING_DOCUMENT_TITLE } from "@shared/approved-pricing-documents";
import ApprovedPricingDocuments from "./documents/ApprovedPricingDocuments";

type DocType = "purchase_order" | "receipt" | "delivery" | "warehouse_issue" | "return" | "disposal" | "count" | "settlement" | "delegate_pricing_documents" | "po_financial_batch" | "delegate_pricing_bundle";

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

const TYPE_META: Record<DocType, { label: string; icon: any; color: string }> = {
  purchase_order: { label: "طلب شراء",      icon: ShoppingCart,   color: "bg-indigo-100 text-indigo-700 border-indigo-200" },
  receipt:        { label: "سند استلام",    icon: PackageCheck,   color: "bg-green-100 text-green-700 border-green-200" },
  delivery:       { label: "سند تسليم",     icon: Truck,          color: "bg-blue-100 text-blue-700 border-blue-200" },
  warehouse_issue:{ label: "سند صرف مخزني", icon: Truck,          color: "bg-cyan-100 text-cyan-800 border-cyan-200" },
  return:         { label: "سند مرتجع",     icon: RotateCcw,      color: "bg-orange-100 text-orange-700 border-orange-200" },
  disposal:       { label: "عملية استبعاد", icon: Trash2,         color: "bg-red-100 text-red-700 border-red-200" },
  count:          { label: "عملية جرد",     icon: ClipboardCheck, color: "bg-teal-100 text-teal-700 border-teal-200" },
  settlement:     { label: "تسوية جرد",     icon: Scale,          color: "bg-purple-100 text-purple-700 border-purple-200" },
  // آخر عنصر بالقائمة = أقصى اليسار بصف الفلاتر (الصفحة RTL) — طلب صريح من
  // صاحب المشروع (2026-08-10): "جوار طلب الشراء من اليسار"، لا قسم منفصل.
  delegate_pricing_documents: { label: "وثائق التسعير الصادرة من المندوبين", icon: FileText, color: "bg-sky-100 text-sky-700 border-sky-200" },
  po_financial_batch: { label: "الوثائق المالية المعتمدة", icon: Landmark, color: "bg-emerald-100 text-emerald-700 border-emerald-200" },
  delegate_pricing_bundle: { label: "حزم التسعير", icon: FileStack, color: "bg-violet-100 text-violet-700 border-violet-200" },
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
  const allowed = canReadApprovedPricingDocuments(user);
  const hasExisting = EXISTING_DOCUMENT_CENTER_ROLES.includes(user?.role || "");
  const [selection, setSelection] = useState<"existing" | "approved">("existing");
  if (!allowed) return <ExistingDocumentsCenter />;
  const approved = !hasExisting || selection === "approved";
  return <div className="space-y-5">
    <div className="flex flex-wrap gap-2" role="tablist" aria-label="أنواع المستندات">
      {hasExisting && <Button role="tab" aria-selected={!approved} variant={!approved ? "default" : "outline"} onClick={() => setSelection("existing")}>المستندات الحالية</Button>}
      <Button role="tab" aria-selected={approved} variant={approved ? "default" : "outline"} onClick={() => setSelection("approved")}>{APPROVED_PRICING_DOCUMENT_TITLE}</Button>
    </div>
    {approved ? <ApprovedPricingDocuments /> : <ExistingDocumentsCenter />}
  </div>;
}

function ExistingDocumentsCenter() {
  const { user } = useAuth();
  const role = (user?.role as string) || "";
  // الحسابات ترى الأنواع المالية الثلاثة فقط؛ لا تُجلب مستندات المخزون لها.
  const isAccountantOnly = role === "accountant";
  // المندوب لم يكن يملك مركز المستندات سابقًا. بعد إضافة تبويب مستندات
  // التسعير نمنحه المركز لهذا التبويب فقط، دون جلب بقية أنواع المستندات.
  const isDelegateOnly = role === "delegate";
  const canViewGeneralDocs = !isAccountantOnly && !isDelegateOnly;

  const [search, setSearch] = useState("");
  const [selectedType, setTypeFilter] = useState<DocType | "all">(() => isAccountantOnly ? "po_financial_batch" : isDelegateOnly ? "delegate_pricing_documents" : "purchase_order");
  const typeFilter = isDelegateOnly ? "delegate_pricing_documents"
    : isAccountantOnly && !["po_financial_batch", "delegate_pricing_documents", "delegate_pricing_bundle"].includes(selectedType) ? "po_financial_batch" : selectedType;
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
  const wants = (type: DocType) => !!user && (typeFilter === "all" || typeFilter === type);
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
  const bundlesAllQ = trpc.delegatePricingBundles.list.useQuery(undefined, { enabled: bundlesEnabled && typeFilter === "all", retry: false });
  const bundlesPageQ = trpc.delegatePricingBundles.listPage.useQuery(pagination, { enabled: bundlesEnabled && typeFilter === "delegate_pricing_bundle", retry: false });
  const bundlesQ = typeFilter === "all" ? bundlesAllQ : bundlesPageQ;
  const bundleDetailQ = trpc.delegatePricingBundles.detail.useQuery({ id: selectedBundleId || 0 }, { enabled: !!selectedBundleId && bundlesEnabled, retry: false });
  const bundlePdf = trpc.delegatePricingBundles.pdf.useMutation({
    onSuccess: result => { try { downloadPricingBundlePdf(result); } catch { toast.error("تعذر تنزيل الملف"); } },
    onError: error => toast.error(error.message),
  });

  // تُبقي زر "الوثائق المالية المعتمدة" ظاهرًا كمُحدَّد لدور الحسابات — تجميلي
  // فقط، النتيجة المعروضة صحيحة أصلًا حتى بلا هذا (سطر واحد ممكن دون تأثير وظيفي).
  useEffect(() => {
    if (isAccountantOnly) setTypeFilter("po_financial_batch");
    else if (isDelegateOnly) setTypeFilter("delegate_pricing_documents");
  }, [isAccountantOnly, isDelegateOnly]);

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
  // "All" renders completed lists immediately while the remaining lists load.
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
      if (typeFilter !== "all" && r.type !== typeFilter) return false;
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

  const counts = useMemo(() => {
    const c: Record<string, number | undefined> = {};
    queryEntries.forEach(([type, query]) => {
      if (query.data !== undefined) c[type] = Array.isArray(query.data) ? listRows(query.data).filter(row => type !== "delegate_pricing_bundle" || row.status !== "open").length : query.data.count;
    });
    if (typeFilter === "all" && !pendingLists && !activeError) c.all = rows.length;
    return c;
  }, [rows, typeFilter, pendingLists, activeError, financialDocsQ.data, delegatePricingDocsQ.data, bundlesQ.data]);

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

  const handlePrint = async (row: DocRow) => {
    if (!rowPdfAllowed(row)) return toast.error(approvalPdfNotice());
    const key = `${row.type}-${row.id}`;
    setPrintingKey(key);
    try {
      if (["po_financial_batch", "delegate_pricing_documents"].includes(row.type)) {
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
      if (["po_financial_batch", "delegate_pricing_documents"].includes(row.type)) {
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
      if (["po_financial_batch", "delegate_pricing_documents"].includes(row.type)) {
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


  const quickFilters: { key: DocType | "all"; label: string }[] = isAccountantOnly
    ? (["delegate_pricing_documents", "po_financial_batch", "delegate_pricing_bundle"] as DocType[]).map(key => ({ key, label: TYPE_META[key].label }))
    : isDelegateOnly
      ? [{ key: "delegate_pricing_documents", label: TYPE_META.delegate_pricing_documents.label }]
      : [
          { key: "all", label: "الكل" },
          ...(Object.keys(TYPE_META) as DocType[])
            .filter(t => {
              if (t === "po_financial_batch") return canViewFinancialDocs;
              if (t === "delegate_pricing_documents") return canViewDelegatePricingDocs;
              if (t === "delegate_pricing_bundle") return canViewBundles;
              return true;
            })
            .map(t => ({ key: t, label: TYPE_META[t].label })),
        ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <FileStack className="w-6 h-6 text-primary" />
            مركز المستندات
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            كل مستندات الشراء والمخزون في مكان واحد — للاطلاع وإعادة الطباعة
          </p>
        </div>
        <Button variant="outline" onClick={refresh} className="gap-2" disabled={isLoading}>
          <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
          تحديث البيانات
        </Button>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="ابحث برقم المستند أو الجهة..."
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1); }}
          className="pr-10"
        />
      </div>

      <div className="flex gap-2 flex-wrap">
        {quickFilters.map(f => (
          <Button
            key={f.key}
            size="sm"
            variant={typeFilter === f.key ? "default" : "outline"}
            className="gap-2 h-8"
            onClick={() => { setTypeFilter(f.key); setPage(1); }}
          >
            {f.label}
            <Badge
              variant="secondary"
              className={`text-[11px] px-1.5 min-w-5 justify-center ${typeFilter === f.key ? "bg-primary-foreground/20 text-primary-foreground" : ""}`}
            >
              {counts[f.key] ?? "—"}
            </Badge>
          </Button>
        ))}
      </div>

      <div className="flex flex-wrap gap-3 items-end">
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">من تاريخ</span>
          <Input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(1); }} className="w-[150px]" max={dateTo || undefined} />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">إلى تاريخ</span>
          <Input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(1); }} className="w-[150px]" min={dateFrom || undefined} />
        </div>
        {role !== "delegate" && ["po_financial_batch", "delegate_pricing_documents", "delegate_pricing_bundle"].includes(typeFilter) && financialDelegateOptions.length > 0 && (
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">المندوب</span>
            <Select value={delegateFilter} onValueChange={v => { setDelegateFilter(v); setPage(1); }}>
              <SelectTrigger className="w-[170px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل المندوبين</SelectItem>
                {financialDelegateOptions.map(([id, name]) => (
                  <SelectItem key={id} value={id}>{name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">الترتيب</span>
          <Select value={sort} onValueChange={v => { setSort(v as any); setPage(1); }}>
            <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="newest">الأحدث أولًا</SelectItem>
              <SelectItem value="oldest">الأقدم أولًا</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {(search || typeFilter !== "all" || dateFrom || dateTo || delegateFilter !== "all") && (
          <Button variant="ghost" size="sm" className="h-9" onClick={() => { setSearch(""); setDateFrom(""); setDateTo(""); setDelegateFilter("all"); setPage(1); }}>
            مسح الفلاتر
          </Button>
        )}
      </div>

      {(role === "accountant" || role === "senior_management") && <p className="text-sm text-muted-foreground">{approvalPdfNotice()}</p>}
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
                <TableHead className="text-start">النوع</TableHead>
                <TableHead className="text-start">رقم المستند</TableHead>
                {["po_financial_batch", "delegate_pricing_documents", "delegate_pricing_bundle"].includes(typeFilter) && (
                  <TableHead className="text-start whitespace-nowrap">الإجمالي الكلي</TableHead>
                )}
                <TableHead className="text-start">التاريخ</TableHead>
                <TableHead className="text-start">المرجع</TableHead>
                {typeFilter === "delegate_pricing_bundle" && <><TableHead className="text-start">الحالة</TableHead><TableHead className="text-start">طلبات الشراء المرتبطة</TableHead></>}
                <TableHead className="text-start">مرات الطباعة</TableHead>
                <TableHead className="text-start">إجراء</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageRows.map(row => {
                const meta = TYPE_META[row.type];
                const Icon = meta.icon;
                const key = `${row.type}-${row.id}`;
                const pdfAllowed = rowPdfAllowed(row);
                return (
                  <TableRow key={key}>
                    <TableCell>
                      <Badge variant="outline" className={`gap-1.5 ${meta.color}`}>
                        <Icon className="w-3.5 h-3.5" />
                        {meta.label}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-sm">{row.documentNumber}</TableCell>
                    {["po_financial_batch", "delegate_pricing_documents", "delegate_pricing_bundle"].includes(typeFilter) && (
                      <TableCell className="font-mono text-sm font-semibold whitespace-nowrap">
                        {formatFinancialGrandTotal(row.totalEstimatedCost)}
                      </TableCell>
                    )}
                    <TableCell className="text-sm text-muted-foreground whitespace-nowrap">{relativeOrDate(row.date)}</TableCell>
                    <TableCell className="text-sm max-w-[220px] truncate">{row.referenceLabel}</TableCell>
                    {typeFilter === "delegate_pricing_bundle" && <><TableCell>{row.status === "archived" ? "مؤرشفة — مرسلة للحسابات" : "مرسلة للحسابات"}</TableCell><TableCell><div className="flex gap-2 flex-wrap">{row.purchaseOrders?.length ? row.purchaseOrders.map(po => <Link key={po.id} href={`/purchase-orders/${po.id}`} className="text-primary underline font-mono">{po.poNumber}</Link>) : "—"}</div></TableCell></>}
                    <TableCell className="text-sm text-muted-foreground">{row.printCount ?? "—"}</TableCell>
                    <TableCell>
                      <div className="flex gap-1.5">
                        {row.type === "delegate_pricing_bundle" ? <>
                          <Button size="sm" variant="outline" onClick={() => setSelectedBundleId(row.id)}>تفاصيل الحزمة</Button>
                          {pdfAllowed && <Button size="sm" variant="outline" disabled={bundlePdf.isPending} onClick={() => bundlePdf.mutate({ id: row.id, approvedDocument: role !== "delegate" })}><Download className="w-3.5 h-3.5" />تنزيل PDF</Button>}
                        </> : <>
                        {row.reviewUrl && <Link href={row.reviewUrl} className="text-sm text-primary underline self-center px-2">بيانات المعاملة</Link>}
                        {pdfAllowed ? <>
                        <Button
                          size="sm" variant="outline" className="gap-1.5"
                          disabled={printingKey === key}
                          onClick={() => handlePrint(row)}
                        >
                          <Printer className="w-3.5 h-3.5" />
                          {printingKey === key ? "..." : "طباعة"}
                        </Button>
                        <Button
                          size="sm" variant="outline" className="gap-1.5 px-2"
                          disabled={viewingKey === key}
                          title="عرض PDF"
                          onClick={() => handleViewPdf(row)}
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                            size="sm" variant="outline" className="gap-1.5 px-2"
                            disabled={downloadingKey === key}
                            title="تنزيل PDF"
                            onClick={() => handleDownloadPdf(row)}
                          >
                            <Download className="w-3.5 h-3.5" />
                            {row.type === "po_financial_batch" && "تنزيل PDF"}
                          </Button>
                        </> : <span className="text-xs text-muted-foreground self-center">{role === "observer" ? "استعراض فقط" : "PDF متاح بعد اعتمادك"}</span>}
                        </>}
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
            {canOpenApprovalPdf(role, bundleDetailQ.data) ? <Button disabled={bundlePdf.isPending} onClick={() => bundlePdf.mutate({ id: bundleDetailQ.data!.id, approvedDocument: role !== "delegate" })}>تنزيل PDF</Button> : <p>{approvalPdfNotice()}</p>}
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
