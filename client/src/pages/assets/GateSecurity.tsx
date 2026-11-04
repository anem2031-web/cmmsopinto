import { trpc } from "@/lib/trpc";
import { mediaUrl } from "@/lib/mediaUrl";
import { printExternalMaintenanceDocument } from "@/lib/printExternalMaintenanceDocument";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CheckCircle2, Clock, FileText, History, LogIn, LogOut, Shield, Truck } from "lucide-react";
import { toast } from "sonner";
import { usePurchaseOpsText } from "@/i18n/purchaseOpsUi";
import { localizeApiError } from "@/i18n/apiError";
import { useBatchTranslation } from "@/hooks/useContentTranslation";
import { useMemo, useState } from "react";
import { hasCurrentExternalDelegateReceipt } from "@shared/externalMaintenanceWorkflow";

function statusLabel(status: string, p: (source: string, vars?: Record<string, any>) => string) {
  const labels: Record<string, string> = {
    waiting_gate_exit: p("بانتظار موافقة الخروج"),
    purchase_cycle: p("خارج الشركة — دورة الصيانة والاعتمادات"),
    waiting_gate_entry: p("بانتظار موافقة الدخول"),
    waiting_warehouse_receipt: p("دخل الشركة — بانتظار استلام المستودع"),
    waiting_technician_handover: p("بالمستودع — بانتظار التسليم للفني"),
    delivered_for_reinstall: p("تم التسليم لإعادة التركيب"),
    reinstall_in_progress: p("إعادة التركيب قيد التنفيذ"),
    ready_for_closure: p("جاهز للإغلاق"),
    closed: p("مغلق"),
  };
  return labels[status] || status;
}

export default function GateSecurity() {
  const { p, dir } = usePurchaseOpsText();
  const utils = trpc.useUtils();
  const { data: rows = [], isLoading } = trpc.externalMaintenance.listForGate.useQuery();
  const [dialog, setDialog] = useState<{ row: any; action: "exit" | "entry" } | null>(null);
  const [carrierName, setCarrierName] = useState("");
  const [notes, setNotes] = useState("");

  const exitRows = (rows as any[]).filter(row => row.job.status === "waiting_gate_exit"
    && hasCurrentExternalDelegateReceipt(row.job));
  const entryRows = (rows as any[]).filter(row => row.job.status === "waiting_gate_entry");
  const historyRows = (rows as any[]).filter(row => !["waiting_gate_exit", "waiting_gate_entry"].includes(row.job.status));
  const externalJobIds = useMemo(
    () => (rows as any[]).map(row => Number(row.job?.id)).filter((id: number) => Number.isFinite(id)),
    [rows],
  );
  const { translationsMap: externalJobTranslations } = useBatchTranslation(
    "EXTERNAL_MAINTENANCE_JOB",
    externalJobIds,
    ["assetName", "assetBeforeCondition", "warehouseNotes", "gateExitNotes", "gateEntryNotes", "returnCondition", "warehouseReturnNotes", "handoverNotes"],
  );
  const localizeExternalRow = (row: any) => {
    const translated = externalJobTranslations[Number(row?.job?.id)] || {};
    return { ...row, job: { ...row.job, ...Object.fromEntries(
      Object.entries(translated).filter(([, value]) => Boolean(value)),
    ) } };
  };

  const approveExit = trpc.externalMaintenance.approveGateExit.useMutation({
    onSuccess: data => {
      toast.success(p("تم توثيق موافقة الخروج وإنشاء الطلب {poNumber}", { poNumber: data.poNumber }));
      setDialog(null);
      setCarrierName("");
      setNotes("");
      utils.externalMaintenance.listForGate.invalidate();
    },
    onError: (error: any) => toast.error(localizeApiError(error.message)),
  });

  const approveEntry = trpc.externalMaintenance.approveGateEntry.useMutation({
    onSuccess: () => {
      toast.success(p("تم توثيق موافقة دخول الأصل بعد الإصلاح"));
      setDialog(null);
      setCarrierName("");
      setNotes("");
      utils.externalMaintenance.listForGate.invalidate();
    },
    onError: (error: any) => toast.error(localizeApiError(error.message)),
  });

  const openDialog = (row: any, action: "exit" | "entry") => {
    setCarrierName(action === "exit" ? row.delegateName || "" : "");
    setNotes("");
    setDialog({ row, action });
  };

  const submit = () => {
    if (!dialog || carrierName.trim().length < 2) {
      toast.error(dialog?.action === "exit" ? p("اسم الشخص الذي أخرج الأصل مطلوب") : p("اسم الشخص الذي أعاد الأصل مطلوب"));
      return;
    }
    const input = { jobId: dialog.row.job.id, carrierName: carrierName.trim(), notes: notes.trim() || undefined };
    if (dialog.action === "exit") approveExit.mutate(input);
    else approveEntry.mutate(input);
  };

  const JobCard = ({ row, action }: { row: any; action?: "exit" | "entry" }) => (
    <Card className={action === "exit" ? "border-orange-200" : action === "entry" ? "border-green-200" : ""}>
      <CardContent className="p-4 flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm text-muted-foreground">{row.ticketNumber}</span>
            <Badge variant="outline">{p("المسار C")}</Badge>
            <Badge variant="secondary">{statusLabel(row.job.status, p)}</Badge>
          </div>
          <div className="font-semibold">{externalJobTranslations[Number(row.job.id)]?.assetName || row.job.assetName || row.assetRegisteredName || row.ticketTitle}</div>
          {row.job.purchaseTitle && <div className="text-sm">{p("عنوان طلب الشراء")}: {row.job.purchaseTitle}</div>}
          <div className="text-xs text-muted-foreground flex flex-wrap gap-3">
            <span>{p("المندوب")}: {row.delegateName || "—"}</span>
            <span>{p("الفني المسند")}: {row.assignedTechnicianName || "—"}</span>
            {row.job.exitDocumentNumber && <span>{p("وثيقة الخروج")}: {row.job.exitDocumentNumber}</span>}
            {row.poNumber && <span>{p("الدورة المالية")}: {row.poNumber}</span>}
          </div>
          {action === "exit" && row.job.assetBeforePhotoUrl && (
            <div className="pt-1">
              <div className="text-xs font-medium mb-1">{p("صورة الأصل المرفوعة من المستودع")}</div>
              <img
                src={mediaUrl(row.job.assetBeforePhotoUrl)}
                alt={p("صورة الأصل قبل الخروج")}
                className="h-28 w-36 rounded-md border object-contain bg-background"
              />
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {row.job.exitDocumentNumber && (
            <Button variant="outline" size="sm" onClick={() => printExternalMaintenanceDocument("exit", localizeExternalRow(row))}>
              <FileText className="w-4 h-4 me-1"/> {p("الوثيقة")}
            </Button>
          )}
          {action === "exit" && (
            <Button size="sm" className="bg-orange-600 hover:bg-orange-700" onClick={() => openDialog(row, "exit")}>
              <LogOut className="w-4 h-4 me-1"/> {p("موافقة الخروج")}
            </Button>
          )}
          {action === "entry" && (
            <Button size="sm" className="bg-green-600 hover:bg-green-700" onClick={() => openDialog(row, "entry")}>
              <LogIn className="w-4 h-4 me-1"/> {p("موافقة الدخول")}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className="p-6 space-y-6" dir={dir}>
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-xl bg-slate-900 flex items-center justify-center"><Shield className="w-6 h-6 text-white"/></div>
        <div><h1 className="text-2xl font-bold">{p("بوابة الحراسة — الأصول الخارجية")}</h1><p className="text-sm text-muted-foreground">{p("توثيق موافقة خروج الأصل ثم دخوله بعد إتمام الصيانة الخارجية")}</p></div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">{p("بانتظار الخروج")}</div><div className="text-2xl font-bold text-orange-600">{exitRows.length}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">{p("بانتظار الدخول")}</div><div className="text-2xl font-bold text-green-600">{entryRows.length}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">{p("في الدورة أو مكتملة")}</div><div className="text-2xl font-bold">{historyRows.length}</div></CardContent></Card>
      </div>

      <Tabs defaultValue="exit">
        <TabsList className="grid grid-cols-3 w-full">
          <TabsTrigger value="exit"><LogOut className="w-4 h-4 me-1"/>{p("الخروج")}</TabsTrigger>
          <TabsTrigger value="entry"><LogIn className="w-4 h-4 me-1"/>{p("الدخول")}</TabsTrigger>
          <TabsTrigger value="history"><History className="w-4 h-4 me-1"/>{p("السجل")}</TabsTrigger>
        </TabsList>
        <TabsContent value="exit" className="mt-4 space-y-3">
          {isLoading ? <div className="py-10 text-center">{p("جاري التحميل...")}</div> : exitRows.length ? exitRows.map(row => <JobCard key={row.job.id} row={row} action="exit"/>) : <Card><CardContent className="py-10 text-center text-muted-foreground"><CheckCircle2 className="w-10 h-10 mx-auto mb-2 text-green-500"/>{p("لا توجد أصول بانتظار موافقة الخروج")}</CardContent></Card>}
        </TabsContent>
        <TabsContent value="entry" className="mt-4 space-y-3">
          {entryRows.length ? entryRows.map(row => <JobCard key={row.job.id} row={row} action="entry"/>) : <Card><CardContent className="py-10 text-center text-muted-foreground"><CheckCircle2 className="w-10 h-10 mx-auto mb-2 text-green-500"/>{p("لا توجد أصول بانتظار موافقة الدخول")}</CardContent></Card>}
        </TabsContent>
        <TabsContent value="history" className="mt-4 space-y-3">
          {historyRows.length ? historyRows.map(row => <JobCard key={row.job.id} row={row}/>) : <Card><CardContent className="py-10 text-center text-muted-foreground"><Clock className="w-10 h-10 mx-auto mb-2"/>{p("لا يوجد سجل بعد")}</CardContent></Card>}
        </TabsContent>
      </Tabs>

      <Dialog open={!!dialog} onOpenChange={open => !open && setDialog(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{dialog?.action === "exit" ? p("توثيق موافقة خروج الأصل") : p("توثيق موافقة دخول الأصل")}</DialogTitle></DialogHeader>
          {dialog && <div className="space-y-4">
            <div className="rounded-lg bg-muted p-3 text-sm"><div className="font-semibold">{dialog.row.ticketNumber} — {externalJobTranslations[Number(dialog.row.job.id)]?.assetName || dialog.row.job.assetName}</div><div className="text-xs text-muted-foreground">{dialog.row.job.exitDocumentNumber}</div></div>
            {dialog.action === "exit" && dialog.row.job.assetBeforePhotoUrl && (
              <div>
                <Label>{p("صورة الأصل المرفوعة من المستودع قبل الخروج")}</Label>
                <img
                  src={mediaUrl(dialog.row.job.assetBeforePhotoUrl)}
                  alt={p("صورة الأصل قبل الخروج")}
                  className="mt-2 max-h-72 w-full rounded-lg border object-contain bg-background"
                />
              </div>
            )}
            <div><Label>{dialog.action === "exit" ? p("اسم الشخص الذي أخرج الأصل فعليًا *") : p("اسم الشخص الذي أعاد الأصل فعليًا *")}</Label><Input value={carrierName} onChange={e => setCarrierName(e.target.value)} placeholder={p("الاسم الكامل")}/></div>
            <div><Label>{p("ملاحظات الحراسة")}</Label><Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}/></div>
            <div className="text-xs text-muted-foreground border rounded p-3">{p("سيُحفظ اسم الحارس تلقائيًا من حساب الدخول، مع التاريخ والوقت الفعليين داخل النظام.")}</div>
          </div>}
          <DialogFooter><Button variant="outline" onClick={() => setDialog(null)}>{p("إلغاء")}</Button><Button onClick={submit} disabled={!carrierName.trim() || approveExit.isPending || approveEntry.isPending}>{dialog?.action === "exit" ? <LogOut className="w-4 h-4 me-1"/> : <LogIn className="w-4 h-4 me-1"/>} {p("تأكيد الموافقة")}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
