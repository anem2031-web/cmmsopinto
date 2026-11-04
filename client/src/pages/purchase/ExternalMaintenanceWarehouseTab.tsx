import { isDelegateRole } from "@shared/roles";
import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { mediaUrl } from "@/lib/mediaUrl";
import { compressImage } from "@/hooks/useOfflineUpload";
import { printExternalMaintenanceDocument } from "@/lib/printExternalMaintenanceDocument";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Camera, CheckCircle2, FileText, Loader2, PackageCheck, Send, Truck } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "@/contexts/LanguageContext";
import { localizeApiError } from "@/i18n/apiError";
import { useBatchTranslation } from "@/hooks/useContentTranslation";
import { canWarehouseReprepareExternalAsset } from "@shared/externalMaintenanceWorkflow";

// ترتيب مراحل سجل الصيانة الخارجية كما هي مُعرَّفة في shared/externalMaintenanceWorkflow.ts،
// كل مرحلة مرتبطة (عند توفره) بالحقل الذي يسجّل وقت اكتمالها فعليًا — يُستخدم لرسم الخط الزمني.
const EXTERNAL_MAINTENANCE_STAGES: { key: string; labelKey: keyof any; tsField?: string }[] = [
  { key: "waiting_warehouse_preparation", labelKey: "stageWarehousePreparation", tsField: "warehousePreparedAt" },
  { key: "waiting_delegate_receipt", labelKey: "stageDelegateReceipt", tsField: "delegateReceiptAt" },
  { key: "waiting_gate_exit", labelKey: "stageGateExit", tsField: "gateExitApprovedAt" },
  { key: "purchase_cycle", labelKey: "stageDelegateFinance", tsField: "delegateReadyForReturnAt" },
  { key: "waiting_gate_entry", labelKey: "stageGateEntry", tsField: "gateEntryApprovedAt" },
  { key: "waiting_warehouse_receipt", labelKey: "stageWarehouseReceipt", tsField: "warehouseReceivedAt" },
  { key: "waiting_technician_handover", labelKey: "stageTechnicianHandover", tsField: "handoverAt" },
  { key: "delivered_for_reinstall", labelKey: "stageWaitingReinstall" },
  { key: "reinstall_in_progress", labelKey: "stageReinstalling" },
  { key: "ready_for_closure", labelKey: "stageReadyClosure" },
  { key: "closed", labelKey: "stageClosed" },
];

const PAGE_SIZE = 15;

// نفس فكرة الترقيم المستخدم بباقي صفحات دورة الشراء، مع عرض أول/آخر صفحة دائمًا
// ونقاط "…" بينها بدل نافذة صغيرة فقط حول الصفحة الحالية.
function Pagination({ total, page, setPage }: { total: number; page: number; setPage: (p: number) => void }) {
  const { t } = useTranslation();
  const pages = Math.ceil(total / PAGE_SIZE);
  if (pages <= 1) return null;

  const shown = new Set<number>([1, pages]);
  for (let p = page - 1; p <= page + 1; p++) if (p > 1 && p < pages) shown.add(p);
  const sorted = Array.from(shown).sort((a, b) => a - b);
  const items: (number | "gap")[] = [];
  let prev = 0;
  for (const p of sorted) {
    if (prev && p - prev > 1) items.push("gap");
    items.push(p);
    prev = p;
  }

  return (
    <div className="flex items-center justify-center gap-1 mt-3 flex-wrap">
      <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(page - 1)}>{t.workflow.purchase.previous}</Button>
      {items.map((it, i) => it === "gap" ? (
        <span key={`gap-${i}`} className="px-1 text-muted-foreground text-sm">…</span>
      ) : (
        <Button key={it} variant={it === page ? "default" : "outline"} size="sm" className="w-8 h-8 p-0" onClick={() => setPage(it as number)}>{it}</Button>
      ))}
      <Button variant="outline" size="sm" disabled={page === pages} onClick={() => setPage(page + 1)}>{t.workflow.purchase.next}</Button>
    </div>
  );
}

function ExternalMaintenanceTimeline({ job }: { job: any }) {
  const { t, language } = useTranslation();
  const currentIndex = EXTERNAL_MAINTENANCE_STAGES.findIndex(s => s.key === job.status);
  return (
    <div className="flex items-start gap-1 overflow-x-auto py-2">
      {EXTERNAL_MAINTENANCE_STAGES.map((stage, i) => {
        const done = currentIndex > i;
        const isCurrent = i === currentIndex;
        const ts = stage.tsField ? job[stage.tsField] : null;
        return (
          <div key={stage.key} className="flex items-start gap-1 flex-1 min-w-[86px]">
            <div className={`flex flex-col items-center gap-1 w-full ${done || isCurrent ? "text-primary" : "text-muted-foreground/40"}`}>
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${
                isCurrent ? "bg-primary text-primary-foreground ring-2 ring-primary/30" :
                done ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground/40"
              }`}>
                {done ? "✓" : i + 1}
              </div>
              <span className="text-[10px] font-medium text-center leading-tight">{(t.workflow.purchase as any)[stage.labelKey]}</span>
              {ts && (done || isCurrent) && (
                <span className="text-[9px] text-muted-foreground">{new Date(ts).toLocaleDateString(language === "ar" ? "ar-SA" : language === "ur" ? "ur-PK" : "en-GB")}</span>
              )}
            </div>
            {i < EXTERNAL_MAINTENANCE_STAGES.length - 1 && (
              <div className={`h-px mt-3 flex-1 ${done ? "bg-primary/40" : "bg-muted"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

const RECIPIENT_ROLES = new Set([
  "technician",
  "supervisor",
  "maintenance_manager",
  "general_maintenance_manager",
  "construction_procurement_manager",
  "it_manager", "it_member",
  "admin",
  "owner",
]);

// ── رفع الملفات ─────────────────────────────────────────────────────────────
// النسخة السابقة كانت ترسل الملف الأصلي كما هو إلى /api/upload بلا ضغط ولا مهلة
// ولا معالجة للردود غير JSON — وهو سبب "أحيانًا يرفع وأحيانًا يفشل":
//   • صور الجوال 5-15MB تتجاوز المهلة أو حدود الوسيط (413) على الشبكات البطيئة.
//   • Android/iOS يرسلان أحيانًا mimetype فارغًا أو application/octet-stream
//     فيرفضها fileFilter بالسيرفر رغم أنها صورة سليمة.
//   • أي رد غير JSON (413/429/502 من الوسيط) كان يفجّر response.json() برسالة مبهمة.
// الحل: نفس نمط useOfflineUpload المستخدم ببقية الصفحات — ضغط داخل المتصفح أولًا.
const IMAGE_EXT_RE = /\.(jpe?g|png|gif|webp|heic|heif|bmp|tiff?)$/i;
const UPLOAD_TIMEOUT_MS = 90_000;

function isImageFile(file: File) {
  return (
    file.type.startsWith("image/") ||
    ((file.type === "" || file.type === "application/octet-stream") && IMAGE_EXT_RE.test(file.name))
  );
}

async function readUploadError(response: Response, t: any): Promise<string> {
  const text = await response.text().catch(() => "");
  try {
    const parsed = JSON.parse(text);
    if (parsed?.error) return String(parsed.error);
  } catch {
    // رد غير JSON (صفحة خطأ من الوسيط) — نعتمد على رمز الحالة أدناه
  }
  if (response.status === 401) return t.workflow.purchase.uploadSessionExpired;
  if (response.status === 413) return t.workflow.purchase.uploadTooLarge;
  if (response.status === 415) return t.workflow.purchase.uploadUnsupported;
  if (response.status === 429) return t.workflow.purchase.uploadRateLimited;
  return `${t.workflow.purchase.uploadHttpFailed} (HTTP ${response.status})`;
}

async function postUpload(payload: Blob, filename: string, t: any): Promise<string> {
  const formData = new FormData();
  formData.append("file", payload, filename);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);
  try {
    const response = await fetch("/api/upload", {
      method: "POST",
      body: formData,
      credentials: "include",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(await readUploadError(response, t));
    const text = await response.text();
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(t.workflow.purchase.uploadUnexpectedResponse);
    }
    if (!data?.url) throw new Error(data?.error || t.workflow.purchase.uploadFailed);
    return data.url as string;
  } finally {
    clearTimeout(timer);
  }
}

async function uploadFile(file: File, t: any): Promise<string> {
  let payload: Blob = file;
  let filename = file.name || "upload";

  if (isImageFile(file)) {
    // 5-15MB → ~200-400KB: يقصّر زمن الرفع كثيرًا ويمنع أخطاء المهلة والحجم
    const compressed = await compressImage(file, 1600, 0.8);
    if (compressed && compressed.size > 0 && compressed.size < file.size) {
      payload = compressed;
      filename = `${filename.replace(/\.[^.]+$/, "")}.jpg`;
    }
  }

  if (payload.size === 0) throw new Error(t.workflow.purchase.uploadEmpty);
  if (payload.size > 15 * 1024 * 1024) throw new Error(t.workflow.purchase.uploadOver15Mb);

  try {
    return await postUpload(payload, filename, t);
  } catch (error: any) {
    if (error?.name === "AbortError") {
      throw new Error(t.workflow.purchase.uploadTimeout);
    }
    // TypeError = انقطاع شبكة مؤقت؛ محاولة ثانية واحدة فقط
    if (error instanceof TypeError) {
      return await postUpload(payload, filename, t);
    }
    throw error;
  }
}

function stageLabel(status: string, t: any) {
  const labels: Record<string, string> = {
    waiting_delegate_receipt: t.workflow.purchase.statusWaitingDelegateReceipt,
    waiting_gate_exit: t.workflow.purchase.statusWaitingGateExit,
    purchase_cycle: t.workflow.purchase.statusPurchaseCycle,
    waiting_gate_entry: t.workflow.purchase.statusWaitingGateEntry,
    waiting_warehouse_receipt: t.workflow.purchase.statusWaitingWarehouseReceipt,
    waiting_technician_handover: t.workflow.purchase.statusWaitingTechnicianHandover,
    delivered_for_reinstall: t.workflow.purchase.statusDeliveredReinstall,
    reinstall_in_progress: t.workflow.purchase.statusReinstalling,
    ready_for_closure: t.workflow.purchase.stageReadyClosure,
    closed: t.workflow.purchase.stageClosed,
  };
  return labels[status] || status;
}

export function externalPreparationRows(waiting: any[], jobs: any[]) {
  const existing = jobs.filter(row => canWarehouseReprepareExternalAsset(row.job));
  const result = new Map<string, any>();
  for (const row of [...waiting, ...existing]) {
    const ticket = { ...row, ticketId: row.ticketId ?? row.job?.ticketId, ticketItemId: row.ticketItemId ?? row.job?.ticketItemId ?? undefined };
    result.set(ticket.ticketItemId != null ? `item:${ticket.ticketItemId}` : `ticket:${ticket.ticketId}`, ticket);
  }
  return Array.from(result.values());
}

export function externalPreparationDraft(ticket: any) {
  const job = ticket.job;
  return {
    purchaseTitle: job?.purchaseTitle || "",
    assetName: job?.assetName || ticket.assetName || ticket.assetRegisteredName || ticket.ticketTitle || "",
    assetBeforePhotoUrl: job?.assetBeforePhotoUrl || ticket.assetPhotoUrl || "",
    assetBeforeCondition: job?.assetBeforeCondition || "",
    delegateId: job?.delegateId ? String(job.delegateId) : "",
    warehouseNotes: job?.warehouseNotes || "",
  };
}

export default function ExternalMaintenanceWarehouseTab() {
  const { t, language, dir } = useTranslation();
  const utils = trpc.useUtils();
  const { user } = useAuth();
  const { data, isLoading } = trpc.externalMaintenance.listForWarehouse.useQuery();
  const { data: users = [] } = trpc.users.list.useQuery();

  const [prepareTicket, setPrepareTicket] = useState<any>(null);
  const [returnTicket, setReturnTicket] = useState<any>(null);
  const [returnReason, setReturnReason] = useState("");
  const routeText = (ar: string, en: string, ur: string) => language === "ar" ? ar : language === "ur" ? ur : en;
  const returnRoute = trpc.externalMaintenance.returnForRouteReview.useMutation({
    onSuccess: () => {
      setReturnTicket(null); setReturnReason("");
      void utils.externalMaintenance.listForWarehouse.invalidate();
      toast.success(routeText("تمت إعادة الطلب للمسؤول", "Returned to the approving manager", "درخواست ذمہ دار کو واپس کردی گئی"));
    },
  });
  const [receiveRow, setReceiveRow] = useState<any>(null);
  const [handoverRow, setHandoverRow] = useState<any>(null);
  const [uploading, setUploading] = useState<string | null>(null);

  const [prepareForm, setPrepareForm] = useState({
    purchaseTitle: "",
    assetName: "",
    assetBeforePhotoUrl: "",
    assetBeforeCondition: "",
    delegateId: "",
    warehouseNotes: "",
  });
  const [receiveForm, setReceiveForm] = useState({
    assetAfterReturnPhotoUrl: "",
    returnCondition: "",
    workshopReportUrl: "",
    notes: "",
  });
  const [handoverForm, setHandoverForm] = useState({ actualRecipientId: "", notes: "" });

  const [pagePreparation, setPagePreparation] = useState(1);
  const [pageReceipt, setPageReceipt] = useState(1);
  const [pageHandover, setPageHandover] = useState(1);
  const [pageMonitoring, setPageMonitoring] = useState(1);

  const delegates = useMemo(() => (users as any[]).filter(user => isDelegateRole(user.role) && user.isActive !== 0), [users]);
  const recipients = useMemo(() => (users as any[]).filter(user =>
    RECIPIENT_ROLES.has(user.role) &&
    user.isActive !== 0
  ), [users]);

  const refetch = () => utils.externalMaintenance.listForWarehouse.invalidate();

  const prepareMut = trpc.externalMaintenance.prepareByWarehouse.useMutation({
    onSuccess: (result) => {
      toast.success(t.workflow.purchase.assetPreparedSuccess);
      const row = {
        job: { ...prepareForm, status: "waiting_delegate_receipt", delegateReceiptStatus: "pending", exitDocumentNumber: result.exitDocumentNumber, warehousePreparedAt: new Date() },
        ticketNumber: prepareTicket?.ticketNumber,
        assetRegisteredName: prepareTicket?.assetName,
        assignedTechnicianName: prepareTicket?.assignedTechnicianName,
        warehousePreparedByName: user?.name || user?.username,
        delegateName: delegates.find((d: any) => d.id === Number(prepareForm.delegateId))?.name,
      };
      printExternalMaintenanceDocument("exit", localizeExternalRow(row));
      setPrepareTicket(null);
      refetch();
    },
    onError: (error: any) => toast.error(localizeApiError(error.message)),
  });

  const receiveMut = trpc.externalMaintenance.receiveByWarehouse.useMutation({
    onSuccess: (result) => {
      toast.success(t.workflow.purchase.assetReceivedSuccess);
      printExternalMaintenanceDocument("return", {
        ...receiveRow,
        warehouseReceivedByName: user?.name || user?.username,
        job: { ...receiveRow.job, ...receiveForm, returnDocumentNumber: result.returnDocumentNumber, warehouseReceivedAt: new Date() },
      });
      setReceiveRow(null);
      refetch();
    },
    onError: (error: any) => toast.error(localizeApiError(error.message)),
  });

  const handoverMut = trpc.externalMaintenance.handoverByWarehouse.useMutation({
    onSuccess: (result) => {
      toast.success(t.workflow.purchase.assetHandoverSuccess);
      const recipient = recipients.find((u: any) => u.id === Number(handoverForm.actualRecipientId));
      printExternalMaintenanceDocument("handover", {
        ...handoverRow,
        actualRecipientName: recipient?.name,
        handoverByName: user?.name || user?.username,
        job: { ...handoverRow.job, ...handoverForm, handoverDocumentNumber: result.handoverDocumentNumber, handoverAt: new Date() },
      });
      setHandoverRow(null);
      refetch();
    },
    onError: (error: any) => toast.error(localizeApiError(error.message)),
  });

  const handleUpload = async (file: File, target: "before" | "after" | "report") => {
    setUploading(target);
    try {
      const url = await uploadFile(file, t);
      if (target === "before") setPrepareForm(form => ({ ...form, assetBeforePhotoUrl: url }));
      if (target === "after") setReceiveForm(form => ({ ...form, assetAfterReturnPhotoUrl: url }));
      if (target === "report") setReceiveForm(form => ({ ...form, workshopReportUrl: url }));
      toast.success(t.workflow.purchase.fileUploaded);
    } catch (error: any) {
      toast.error(localizeApiError(error.message));
    } finally {
      setUploading(null);
    }
  };

  const jobs = (data?.jobs || []) as any[];
  const waitingPreparation = externalPreparationRows(data?.waitingPreparation || [], jobs);
  const externalJobIds = useMemo(
    () => jobs.map(row => Number(row.job?.id)).filter((id: number) => Number.isFinite(id)),
    [jobs],
  );
  const { translationsMap: externalJobTranslations } = useBatchTranslation(
    "EXTERNAL_MAINTENANCE_JOB",
    externalJobIds,
    ["assetName", "assetBeforeCondition", "warehouseNotes", "gateExitNotes", "gateEntryNotes", "returnCondition", "warehouseReturnNotes", "handoverNotes"],
  );
  const localizeExternalRow = (row: any) => {
    const jobId = Number(row?.job?.id);
    const translated = externalJobTranslations[jobId] || {};
    return {
      ...row,
      job: {
        ...row.job,
        assetName: translated.assetName || row.job?.assetName,
        assetBeforeCondition: translated.assetBeforeCondition || row.job?.assetBeforeCondition,
        warehouseNotes: translated.warehouseNotes || row.job?.warehouseNotes,
        gateExitNotes: translated.gateExitNotes || row.job?.gateExitNotes,
        gateEntryNotes: translated.gateEntryNotes || row.job?.gateEntryNotes,
        returnCondition: translated.returnCondition || row.job?.returnCondition,
        warehouseReturnNotes: translated.warehouseReturnNotes || row.job?.warehouseReturnNotes,
        handoverNotes: translated.handoverNotes || row.job?.handoverNotes,
      },
    };
  };
  const waitingReceipt = jobs.filter(row => row.job.status === "waiting_warehouse_receipt");
  const waitingHandover = jobs.filter(row => row.job.status === "waiting_technician_handover");
  const preparationIds = new Set(waitingPreparation.map(row => row.job?.id).filter(Boolean));
  const monitoring = jobs.filter(row => !preparationIds.has(row.job.id) && !["waiting_warehouse_receipt", "waiting_technician_handover"].includes(row.job.status));

  // عرض 15 عملية فقط بكل تبويب دفعة واحدة — يقلّل عدد العناصر المرسومة فعليًا
  // بالصفحة (خصوصًا تبويب "متابعة المسار C" اللي يرسم خطًا زمنيًا كاملًا لكل بلاغ).
  const pagedPreparation = waitingPreparation.slice((pagePreparation - 1) * PAGE_SIZE, pagePreparation * PAGE_SIZE);
  const pagedReceipt = waitingReceipt.slice((pageReceipt - 1) * PAGE_SIZE, pageReceipt * PAGE_SIZE);
  const pagedHandover = waitingHandover.slice((pageHandover - 1) * PAGE_SIZE, pageHandover * PAGE_SIZE);
  const pagedMonitoring = monitoring.slice((pageMonitoring - 1) * PAGE_SIZE, pageMonitoring * PAGE_SIZE);

  if (isLoading) return <div className="py-12 text-center text-muted-foreground">{t.workflow.purchase.loadingExternal}</div>;

  return (
    <div className="space-y-6">
      <div className="rounded-xl border bg-slate-50 p-4 text-sm text-slate-700">
        {t.workflow.purchase.externalFlowHelp}
      </div>

      <Tabs defaultValue="preparation">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="preparation" className="gap-1.5">
            <PackageCheck className="w-4 h-4"/>
            <span className="hidden sm:inline">{t.workflow.purchase.tabWaitingPreparation}</span>
            {waitingPreparation.length > 0 && <Badge variant="destructive" className="text-[10px] px-1.5 py-0">{waitingPreparation.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="receipt" className="gap-1.5">
            <PackageCheck className="w-4 h-4"/>
            <span className="hidden sm:inline">{t.workflow.purchase.tabWaitingReceipt}</span>
            {waitingReceipt.length > 0 && <Badge variant="destructive" className="text-[10px] px-1.5 py-0">{waitingReceipt.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="handover" className="gap-1.5">
            <Send className="w-4 h-4"/>
            <span className="hidden sm:inline">{t.workflow.purchase.tabWaitingHandover}</span>
            {waitingHandover.length > 0 && <Badge variant="destructive" className="text-[10px] px-1.5 py-0">{waitingHandover.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="monitoring" className="gap-1.5">
            <FileText className="w-4 h-4"/>
            <span className="hidden sm:inline">{t.workflow.purchase.tabPathCMonitoring}</span>
            {monitoring.length > 0 && <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{monitoring.length}</Badge>}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="preparation" className="mt-4 space-y-3">
          {waitingPreparation.length === 0 ? (
            <Card><CardContent className="py-7 text-center text-muted-foreground">{t.workflow.purchase.noWaitingPreparation}</CardContent></Card>
          ) : <>{pagedPreparation.map((ticket: any) => (
            <Card key={ticket.ticketItemId ?? ticket.ticketId} className="border-orange-200">
              <CardContent className="p-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="font-semibold flex items-center gap-2 flex-wrap">
                    {ticket.ticketNumber} — {ticket.ticketTitle}
                    {ticket.ticketItemNumber && ticket.ticketItemNumber > 1 && (
                      <Badge variant="outline" className="text-[10px]">{t.workflow.purchase.itemNumber} {ticket.ticketItemNumber}</Badge>
                    )}
                  </div>
                  {ticket.itemDescription && (
                    <div className="text-xs text-muted-foreground mt-0.5">{ticket.itemDescription}</div>
                  )}
                  <div className="text-xs text-muted-foreground mt-1">{t.workflow.purchase.asset}: {ticket.assetName || t.workflow.purchase.notRegistered} · {t.workflow.purchase.assignedTechnician}: {ticket.assignedTechnicianName || t.workflow.purchase.notAssigned}</div>
                  {ticket.job?.delegateReceiptStatus === "rejected" && <p role="alert" className="mt-2 text-sm text-destructive">{t.workflow.purchase.delegateReceiptRejected}: {ticket.job.delegateReceiptReason}</p>}
                  {ticket.ticketBeforePhotoUrl && (
                    <div className="mt-3">
                      <div className="text-xs font-medium mb-1">{t.workflow.purchase.ticketInitialPhoto}</div>
                      <img
                        src={mediaUrl(ticket.ticketBeforePhotoUrl)}
                        alt={t.workflow.purchase.ticketInitialPhoto}
                        className="h-24 w-32 rounded-md border object-contain bg-background"
                      />
                    </div>
                  )}
                </div>
                <Button onClick={() => {
                  setPrepareTicket(ticket);
                  setPrepareForm(externalPreparationDraft(ticket));
                }} className="gap-2"><Truck className="w-4 h-4"/> {t.workflow.purchase.prepareAsset}</Button>
                {!ticket.job && <Button variant="outline" onClick={() => { setReturnTicket(ticket); setReturnReason(""); returnRoute.reset(); }}>
                  {routeText("إعادة للمسؤول لمراجعة المسار", "Return for route review", "راستے کے جائزے کیلئے واپس")}
                </Button>}
              </CardContent>
            </Card>
          ))}
          <Pagination total={waitingPreparation.length} page={pagePreparation} setPage={setPagePreparation} /></>}
        </TabsContent>

        <TabsContent value="receipt" className="mt-4 space-y-3">
          {waitingReceipt.length === 0 ? (
            <Card><CardContent className="py-7 text-center text-muted-foreground">{t.workflow.purchase.noWaitingReceipt}</CardContent></Card>
          ) : <>{pagedReceipt.map((row: any) => (
            <Card key={row.job.id} className="border-green-200">
              <CardContent className="p-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="font-semibold">{row.ticketNumber} — {(externalJobTranslations[Number(row.job.id)]?.assetName || row.job.assetName)}</div>
                  <div className="text-xs text-muted-foreground mt-1">{t.workflow.purchase.returnedBy}: {row.job.gateEntryCarrierName || "—"} · {t.workflow.purchase.gateEntryApproval}: {row.job.gateEntryApprovedAt ? new Date(row.job.gateEntryApprovedAt).toLocaleString(language === "ar" ? "ar-SA" : language === "ur" ? "ur-PK" : "en-GB") : "—"}</div>
                </div>
                <Button onClick={() => { setReceiveRow(row); setReceiveForm({ assetAfterReturnPhotoUrl: "", returnCondition: "", workshopReportUrl: "", notes: "" }); }} className="gap-2"><PackageCheck className="w-4 h-4"/> {t.workflow.purchase.receiveAsset}</Button>
              </CardContent>
            </Card>
          ))}
          <Pagination total={waitingReceipt.length} page={pageReceipt} setPage={setPageReceipt} /></>}
        </TabsContent>

        <TabsContent value="handover" className="mt-4 space-y-3">
          {waitingHandover.length === 0 ? (
            <Card><CardContent className="py-7 text-center text-muted-foreground">{t.workflow.purchase.noWaitingHandover}</CardContent></Card>
          ) : <>{pagedHandover.map((row: any) => (
            <Card key={row.job.id} className="border-indigo-200">
              <CardContent className="p-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="font-semibold">{row.ticketNumber} — {(externalJobTranslations[Number(row.job.id)]?.assetName || row.job.assetName)}</div>
                  <div className="text-xs text-muted-foreground mt-1">{t.workflow.purchase.ticketAssignedTechnician}: {row.assignedTechnicianName || t.workflow.purchase.notAssigned}</div>
                </div>
                <Button onClick={() => { setHandoverRow(row); setHandoverForm({ actualRecipientId: String(row.ticketAssignedToId || ""), notes: "" }); }} className="gap-2"><Send className="w-4 h-4"/> {t.workflow.purchase.handoverAsset}</Button>
              </CardContent>
            </Card>
          ))}
          <Pagination total={waitingHandover.length} page={pageHandover} setPage={setPageHandover} /></>}
        </TabsContent>

        <TabsContent value="monitoring" className="mt-4 space-y-3">
          {monitoring.length === 0 ? (
            <Card><CardContent className="py-7 text-center text-muted-foreground">{t.workflow.purchase.noOtherOperations}</CardContent></Card>
          ) : <>{pagedMonitoring.map((row: any) => (
            <Card key={row.job.id}>
              <CardContent className="p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="font-semibold">{row.ticketNumber} — {(externalJobTranslations[Number(row.job.id)]?.assetName || row.job.assetName)}</div>
                    <div className="flex flex-wrap gap-2 mt-2">
                      <Badge variant="outline">{stageLabel(row.job.status, t)}</Badge>
                      {row.delegateName && <Badge variant="secondary">{t.workflow.purchase.delegateLabelColon} {row.delegateName}</Badge>}
                      {row.poNumber && <Badge variant="secondary">{row.poNumber}</Badge>}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {row.job.exitDocumentNumber && <Button variant="outline" size="sm" onClick={() => printExternalMaintenanceDocument("exit", localizeExternalRow(row))}><FileText className="w-4 h-4 me-1"/>{t.workflow.purchase.exitDocument}</Button>}
                    {row.job.returnDocumentNumber && <Button variant="outline" size="sm" onClick={() => printExternalMaintenanceDocument("return", localizeExternalRow(row))}><FileText className="w-4 h-4 me-1"/>{t.workflow.purchase.returnDocument}</Button>}
                    {row.job.handoverDocumentNumber && <Button variant="outline" size="sm" onClick={() => printExternalMaintenanceDocument("handover", localizeExternalRow(row))}><FileText className="w-4 h-4 me-1"/>{t.workflow.purchase.handoverDocument}</Button>}
                  </div>
                </div>
                <div className="border-t pt-2">
                  <ExternalMaintenanceTimeline job={row.job} />
                </div>
              </CardContent>
            </Card>
          ))}
          <Pagination total={monitoring.length} page={pageMonitoring} setPage={setPageMonitoring} /></>}
        </TabsContent>
      </Tabs>

      <Dialog open={!!returnTicket} onOpenChange={open => { if (!open && !returnRoute.isPending) setReturnTicket(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{routeText("إعادة للمسؤول لمراجعة المسار", "Return for route review", "راستے کے جائزے کیلئے واپس")}</DialogTitle></DialogHeader>
          <Label>{routeText("سبب الإعادة (مطلوب)", "Return reason (required)", "واپسی کی وجہ (ضروری)")}</Label>
          <Textarea value={returnReason} maxLength={4000} onChange={e => setReturnReason(e.target.value)} disabled={returnRoute.isPending} />
          {returnRoute.error && <p role="alert" className="text-destructive">{returnRoute.error.message}</p>}
          <DialogFooter><Button disabled={!returnReason.trim() || returnRoute.isPending} onClick={() => returnRoute.mutate({ ticketId: returnTicket.ticketId, ticketItemId: returnTicket.ticketItemId, reason: returnReason })}>{routeText("تأكيد الإعادة", "Confirm return", "واپسی کی تصدیق")}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={!!prepareTicket} onOpenChange={open => !open && setPrepareTicket(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{t.workflow.purchase.prepareExternalTitle}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>{t.workflow.purchase.ticketInitialPhoto}</Label>
              {prepareTicket?.ticketBeforePhotoUrl ? (
                <img
                  src={mediaUrl(prepareTicket.ticketBeforePhotoUrl)}
                  alt={t.workflow.purchase.ticketInitialPhoto}
                  className="mt-2 max-h-64 w-full rounded-lg border object-contain bg-background"
                />
              ) : (
                <div className="mt-2 rounded-md border border-dashed p-3 text-xs text-muted-foreground">{t.workflow.purchase.noInitialPhoto}</div>
              )}
            </div>
            <div><Label htmlFor="external-purchase-title">{t.workflow.purchase.externalPurchaseTitle} *</Label><Input id="external-purchase-title" required maxLength={300} placeholder={t.workflow.purchase.externalPurchaseTitlePlaceholder} value={prepareForm.purchaseTitle} onChange={e => setPrepareForm(f => ({ ...f, purchaseTitle: e.target.value }))}/></div>
            <div><Label>{t.workflow.purchase.assetNameRequired}</Label><Input value={prepareForm.assetName} onChange={e => setPrepareForm(f => ({ ...f, assetName: e.target.value }))}/></div>
            <div><Label>{t.workflow.purchase.assetBeforeConditionRequired}</Label><Textarea value={prepareForm.assetBeforeCondition} onChange={e => setPrepareForm(f => ({ ...f, assetBeforeCondition: e.target.value }))}/></div>
            <div><Label>{t.workflow.purchase.responsibleDelegateRequired}</Label><select className="w-full border rounded-md h-10 px-3 bg-background" value={prepareForm.delegateId} onChange={e => setPrepareForm(f => ({ ...f, delegateId: e.target.value }))}><option value="">{t.workflow.purchase.chooseDelegate}</option>{delegates.map((u: any) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></div>
            <div><Label>{t.workflow.purchase.assetBeforePhotoRequired}</Label>{prepareForm.assetBeforePhotoUrl ? <img src={mediaUrl(prepareForm.assetBeforePhotoUrl)} className="max-h-44 rounded border mt-2"/> : null}<Input type="file" accept="image/*" disabled={uploading === "before"} onChange={e => { const file = e.target.files?.[0]; e.target.value = ""; if (file) handleUpload(file, "before"); }}/></div>
            <div><Label>{t.workflow.purchase.warehouseNotes}</Label><Textarea value={prepareForm.warehouseNotes} onChange={e => setPrepareForm(f => ({ ...f, warehouseNotes: e.target.value }))}/></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setPrepareTicket(null)}>{t.workflow.purchase.cancel}</Button><Button disabled={prepareMut.isPending || !prepareForm.purchaseTitle.trim() || prepareForm.purchaseTitle.trim().length > 300 || !prepareForm.assetName.trim() || !prepareForm.assetBeforeCondition.trim() || !prepareForm.assetBeforePhotoUrl || !prepareForm.delegateId} onClick={() => prepareMut.mutate({ ticketId: prepareTicket.ticketId, ticketItemId: prepareTicket.ticketItemId, ...(prepareTicket.job ? { jobId: prepareTicket.job.id, expectedRevision: prepareTicket.job.preparationRevision } : {}), purchaseTitle: prepareForm.purchaseTitle.trim(), assetName: prepareForm.assetName.trim(), assetBeforePhotoUrl: prepareForm.assetBeforePhotoUrl, assetBeforeCondition: prepareForm.assetBeforeCondition.trim(), delegateId: Number(prepareForm.delegateId), warehouseNotes: prepareForm.warehouseNotes.trim() || undefined })}>{prepareMut.isPending ? <Loader2 className="w-4 h-4 animate-spin"/> : <CheckCircle2 className="w-4 h-4 me-1"/>} {t.workflow.purchase.saveIssueDocument}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!receiveRow} onOpenChange={open => !open && setReceiveRow(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{t.workflow.purchase.receiveExternalTitle}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>{t.workflow.purchase.returnConditionRequired}</Label><Textarea value={receiveForm.returnCondition} onChange={e => setReceiveForm(f => ({ ...f, returnCondition: e.target.value }))}/></div>
            <div><Label>{t.workflow.purchase.assetAfterReturnPhotoRequired}</Label>{receiveForm.assetAfterReturnPhotoUrl ? <img src={mediaUrl(receiveForm.assetAfterReturnPhotoUrl)} className="max-h-44 rounded border mt-2"/> : null}<Input type="file" accept="image/*" disabled={uploading === "after"} onChange={e => { const file = e.target.files?.[0]; e.target.value = ""; if (file) handleUpload(file, "after"); }}/></div>
            <div><Label>{t.workflow.purchase.workshopInvoiceReport}</Label><Input type="file" disabled={uploading === "report"} onChange={e => { const file = e.target.files?.[0]; e.target.value = ""; if (file) handleUpload(file, "report"); }}/></div>
            <div><Label>{t.workflow.purchase.warehouseNotes}</Label><Textarea value={receiveForm.notes} onChange={e => setReceiveForm(f => ({ ...f, notes: e.target.value }))}/></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setReceiveRow(null)}>{t.workflow.purchase.cancel}</Button><Button disabled={receiveMut.isPending || !receiveForm.assetAfterReturnPhotoUrl || !receiveForm.returnCondition.trim()} onClick={() => receiveMut.mutate({ jobId: receiveRow.job.id, assetAfterReturnPhotoUrl: receiveForm.assetAfterReturnPhotoUrl, returnCondition: receiveForm.returnCondition.trim(), workshopReportUrl: receiveForm.workshopReportUrl || undefined, notes: receiveForm.notes.trim() || undefined })}>{receiveMut.isPending ? <Loader2 className="w-4 h-4 animate-spin"/> : <PackageCheck className="w-4 h-4 me-1"/>} {t.workflow.purchase.confirmReceipt}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!handoverRow} onOpenChange={open => !open && setHandoverRow(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{t.workflow.purchase.handoverReinstallTitle}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="rounded-md border bg-muted/40 p-3"><div className="text-xs text-muted-foreground">{t.workflow.purchase.assignedResponsibleReadOnly}</div><div className="font-semibold">{handoverRow?.assignedTechnicianName || t.workflow.purchase.notAssigned}</div></div>
            <div><Label>{t.workflow.purchase.actualRecipientRequired}</Label><select className="w-full border rounded-md h-10 px-3 bg-background" value={handoverForm.actualRecipientId} onChange={e => setHandoverForm(f => ({ ...f, actualRecipientId: e.target.value }))}><option value="">{t.workflow.purchase.chooseRecipient}</option>{recipients.map((u: any) => <option key={u.id} value={u.id}>{u.name} — {u.role}</option>)}</select></div>
            <div><Label>{t.workflow.purchase.handoverNotes}</Label><Textarea value={handoverForm.notes} onChange={e => setHandoverForm(f => ({ ...f, notes: e.target.value }))}/></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setHandoverRow(null)}>{t.workflow.purchase.cancel}</Button><Button disabled={handoverMut.isPending || !handoverForm.actualRecipientId} onClick={() => handoverMut.mutate({ jobId: handoverRow.job.id, actualRecipientId: Number(handoverForm.actualRecipientId), notes: handoverForm.notes.trim() || undefined })}>{handoverMut.isPending ? <Loader2 className="w-4 h-4 animate-spin"/> : <Send className="w-4 h-4 me-1"/>} {t.workflow.purchase.confirmHandover}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
