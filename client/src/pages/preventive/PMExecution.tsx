import { useState, useEffect, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  CheckCircle2, Wrench, AlertTriangle, ChevronRight,
  Clock, MapPin, Tag, ClipboardList, ArrowLeft, Loader2,
  CheckSquare, Flag,
} from "lucide-react";
import { useLocation } from "wouter";
import { useLanguage } from "@/contexts/LanguageContext";

interface PMExecutionProps {
  workOrderId: number;
  onClose?: () => void;
}

export default function PMExecution({ workOrderId, onClose }: PMExecutionProps) {
  const { t } = useLanguage();
  const [, setLocation] = useLocation();
  const [activeItemId, setActiveItemId] = useState<number | null>(null);
  const [showIssueDialog, setShowIssueDialog] = useState(false);
  const [showFixedDialog, setShowFixedDialog] = useState(false);
  const [showCompleteDialog, setShowCompleteDialog] = useState(false);
  const [issueDescription, setIssueDescription] = useState("");
  const [fixNotes, setFixNotes] = useState("");
  const [generalNotes, setGeneralNotes] = useState("");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startMutation = trpc.preventive.startExecution.useMutation();
  const submitItemMutation = trpc.preventive.submitItemResult.useMutation();
  const completeMutation = trpc.preventive.completeExecution.useMutation();
  const createTicketMutation = trpc.preventive.createIssueTicket.useMutation();

  const { data: progressData, refetch: refetchProgress, isLoading } =
    trpc.preventive.getExecutionProgress.useQuery({ workOrderId }, { enabled: false });

  const utils = trpc.useUtils();

  useEffect(() => {
    startMutation.mutate({ workOrderId }, {
      onSuccess: () => {
        refetchProgress();
        timerRef.current = setInterval(() => {
          setElapsedSeconds(s => s + 1);
        }, 1000);
      },
      onError: (err) => {
        toast.error(t.pmExecution.startSessionError + err.message);
      }
    });
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [workOrderId]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60).toString().padStart(2, "0");
    const s = (seconds % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  };

  const items = progressData?.items ?? [];
  const results = progressData?.results ?? [];
  const workOrder = progressData?.workOrder as any;
  const totalItems = items.length;
  const completedItems = results.length;
  const progressPercent = totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0;
  const isAllDone = completedItems >= totalItems && totalItems > 0;
  const activeItem = items.find((it: any) => it.id === activeItemId);

  const getItemResult = (itemId: number) =>
    results.find((r: any) => r.checklistItemId === itemId);

  const groupedItems: { branchTitle: string; items: any[] }[] = [];
  {
    const indexByTitle = new Map<string, number>();
    for (const item of items) {
      const branchTitle = item.planTitle || "بنود الفحص";
      if (!indexByTitle.has(branchTitle)) {
        indexByTitle.set(branchTitle, groupedItems.length);
        groupedItems.push({ branchTitle, items: [] });
      }
      groupedItems[indexByTitle.get(branchTitle)!].items.push(item);
    }
  }

  const handleOk = (itemId: number) => {
    submitItemMutation.mutate({
      workOrderId,
      checklistItemId: itemId,
      status: "ok",
    }, {
      onSuccess: () => refetchProgress(),
      onError: (err) => toast.error(t.pmExecution.error + err.message),
    });
  };

  const openFixedDialog = (itemId: number) => {
    setActiveItemId(itemId);
    setFixNotes("");
    setShowFixedDialog(true);
  };

  const handleFixedSubmit = () => {
    if (!activeItemId) return;
    submitItemMutation.mutate({
      workOrderId,
      checklistItemId: activeItemId,
      status: "fixed",
      fixNotes,
    }, {
      onSuccess: () => {
        setShowFixedDialog(false);
        setFixNotes("");
        setActiveItemId(null);
        refetchProgress();
      },
      onError: (err) => toast.error(t.pmExecution.error + err.message),
    });
  };

  const openIssueDialog = (itemId: number) => {
    setActiveItemId(itemId);
    setIssueDescription("");
    setShowIssueDialog(true);
  };

  const handleIssueSubmit = () => {
    if (!activeItemId) return;
    submitItemMutation.mutate({
      workOrderId,
      checklistItemId: activeItemId,
      status: "issue",
    }, {
      onSuccess: () => {
        createTicketMutation.mutate({
          workOrderId,
          checklistItemId: activeItemId,
          assetId: workOrder?.assetId ?? undefined,
          siteId: workOrder?.siteId ?? undefined,
          description: issueDescription,
        }, {
          onSuccess: (data) => {
            toast.success(`${t.pmExecution.openTicketError} ${data.ticketNumber}`);
            setShowIssueDialog(false);
            setIssueDescription("");
            setActiveItemId(null);
            refetchProgress();
          },
          onError: (err) => toast.error(t.pmExecution.openTicketError + err.message),
        });
      },
      onError: (err) => toast.error(t.pmExecution.error + err.message),
    });
  };

  const handleComplete = () => {
    setShowCompleteDialog(true);
  };

  const handleCompleteSubmit = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    completeMutation.mutate({ workOrderId, generalNotes }, {
      onSuccess: (data) => {
        toast.success(t.pmExecution.finishedSuccess);
        utils.preventive.listWorkOrders.invalidate();
        setShowCompleteDialog(false);
        if (onClose) onClose();
        else setLocation("/preventive-maintenance");
      },
      onError: (err) => toast.error(t.pmExecution.error + err.message),
    });
  };

  if (isLoading || startMutation.isPending) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <Loader2 className="w-10 h-10 animate-spin text-primary" />
        <p className="text-muted-foreground">{t.pmExecution.loadingItems}</p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-4" dir="rtl">
      <div className="flex items-center justify-between">
        <button
          onClick={() => { if (onClose) onClose(); else setLocation("/preventive-maintenance"); }}
          className="flex items-center gap-1 text-muted-foreground hover:text-foreground text-sm"
        >
          <ArrowLeft className="w-4 h-4" />
          رجوع
        </button>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Clock className="w-4 h-4" />
          <span className="font-mono">{formatTime(elapsedSeconds)}</span>
        </div>
      </div>

      {workOrder && (
        <div className="bg-card border rounded-xl p-4 space-y-2">
          <h2 className="font-bold text-lg">{workOrder.title}</h2>
          <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
            {workOrder.assetName && (
              <span className="flex items-center gap-1">
                <Tag className="w-3.5 h-3.5" />
                {workOrder.assetName}
              </span>
            )}
            {workOrder.siteName && (
              <span className="flex items-center gap-1">
                <MapPin className="w-3.5 h-3.5" />
                {workOrder.siteName}
              </span>
            )}
          </div>
        </div>
      )}

      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium text-foreground">
            {isAllDone ? t.pmExecution.inspectionCompleteCheck : `${completedItems} / ${totalItems} بند`}
          </span>
          <span className="text-muted-foreground">{progressPercent}%</span>
        </div>
        <Progress value={progressPercent} className="h-3" />
        <div className="flex gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
            {t.pmExecution.ok}: {results.filter((r: any) => r.status === "ok").length}
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-blue-500 inline-block" />
            {t.pmExecution.fixed}: {results.filter((r: any) => r.status === "fixed").length}
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-red-500 inline-block" />
            {t.pmExecution.defective}: {results.filter((r: any) => r.status === "issue").length}
          </span>
        </div>
      </div>

      {totalItems > 0 && (
        <div className="space-y-5">
          {groupedItems.map((group) => (
            <div key={group.branchTitle} className="space-y-2">
              {groupedItems.length > 1 && (
                <h4 className="text-sm font-semibold text-muted-foreground flex items-center gap-1.5">
                  <ClipboardList className="w-3.5 h-3.5" /> {group.branchTitle}
                </h4>
              )}
              <div className="space-y-2">
                {group.items.map((item: any) => {
                  const result = getItemResult(item.id);
                  return (
                    <div
                      key={item.id}
                      className={`rounded-xl border-2 p-3 flex items-center gap-3 ${
                        !result ? "bg-card border-primary/15" :
                        result.status === "ok" ? "bg-green-50 border-green-200" :
                        result.status === "fixed" ? "bg-blue-50 border-blue-200" :
                        "bg-red-50 border-red-200"
                      }`}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm leading-relaxed">{item.text}</p>
                        {item.isRequired && !result && (
                          <Badge variant="destructive" className="text-[10px] px-1.5 py-0 mt-1">{t.pmExecution.required}</Badge>
                        )}
                        {result?.status === "fixed" && result.fixNotes && (
                          <p className="text-xs text-blue-700 mt-1">🔧 {result.fixNotes}</p>
                        )}
                      </div>

                      {!result ? (
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            onClick={() => handleOk(item.id)}
                            disabled={submitItemMutation.isPending}
                            title={t.pmExecution.ok}
                            className="w-10 h-10 rounded-lg bg-green-100 hover:bg-green-200 border border-green-300 flex items-center justify-center transition-colors disabled:opacity-50"
                          >
                            <CheckCircle2 className="w-5 h-5 text-green-700" />
                          </button>
                          <button
                            onClick={() => openFixedDialog(item.id)}
                            disabled={submitItemMutation.isPending}
                            title={t.pmExecution.fixed}
                            className="w-10 h-10 rounded-lg bg-blue-100 hover:bg-blue-200 border border-blue-300 flex items-center justify-center transition-colors disabled:opacity-50"
                          >
                            <Wrench className="w-5 h-5 text-blue-700" />
                          </button>
                          <button
                            onClick={() => openIssueDialog(item.id)}
                            disabled={submitItemMutation.isPending}
                            title={t.pmExecution.defective}
                            className="w-10 h-10 rounded-lg bg-red-100 hover:bg-red-200 border border-red-300 flex items-center justify-center transition-colors disabled:opacity-50"
                          >
                            <AlertTriangle className="w-5 h-5 text-red-700" />
                          </button>
                        </div>
                      ) : (
                        <div className="shrink-0">
                          {result.status === "ok" && <CheckCircle2 className="w-6 h-6 text-green-600" />}
                          {result.status === "fixed" && <Wrench className="w-6 h-6 text-blue-600" />}
                          {result.status === "issue" && <AlertTriangle className="w-6 h-6 text-red-600" />}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {isAllDone && (
        <div className="bg-green-50 border-2 border-green-200 rounded-2xl p-8 text-center space-y-4">
          <CheckSquare className="w-16 h-16 text-green-600 mx-auto" />
          <h3 className="text-xl font-bold text-green-800">{t.pmExecution.inspectionComplete}</h3>
          <p className="text-green-700 text-sm">
            تم فحص جميع {totalItems} بند بنجاح
          </p>
          <Button onClick={handleComplete} className="w-full bg-green-600 hover:bg-green-700 text-white">
            <Flag className="w-4 h-4 ml-2" />
            إنهاء وإرسال التقرير
          </Button>
        </div>
      )}

      <Dialog open={showFixedDialog} onOpenChange={(o) => { setShowFixedDialog(o); if (!o) setActiveItemId(null); }}>
        <DialogContent dir="rtl" className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wrench className="w-5 h-5 text-blue-600" />
              وصف الإصلاح الفوري
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">البند: <strong>{activeItem?.text}</strong></p>
            <div>
              <Label>ماذا تم إصلاحه؟</Label>
              <Textarea
                value={fixNotes}
                onChange={e => setFixNotes(e.target.value)}
                placeholder="اكتب وصفاً مختصراً للإصلاح الذي قمت به..."
                rows={3}
                className="mt-1"
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setShowFixedDialog(false); setActiveItemId(null); }}>إلغاء</Button>
            <Button
              onClick={handleFixedSubmit}
              disabled={!fixNotes.trim() || submitItemMutation.isPending}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              {submitItemMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "تأكيد الإصلاح"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showIssueDialog} onOpenChange={(o) => { setShowIssueDialog(o); if (!o) setActiveItemId(null); }}>
        <DialogContent dir="rtl" className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <AlertTriangle className="w-5 h-5" />
              فتح بلاغ عطل
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">البند: <strong>{activeItem?.text}</strong></p>
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
              سيتم فتح بلاغ عطل تلقائياً وإرساله لمدير الصيانة
            </div>
            <div>
              <Label>وصف الخلل</Label>
              <Textarea
                value={issueDescription}
                onChange={e => setIssueDescription(e.target.value)}
                placeholder="اكتب وصفاً للخلل الذي اكتشفته..."
                rows={3}
                className="mt-1"
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setShowIssueDialog(false); setActiveItemId(null); }}>إلغاء</Button>
            <Button
              onClick={handleIssueSubmit}
              disabled={!issueDescription.trim() || submitItemMutation.isPending || createTicketMutation.isPending}
              variant="destructive"
            >
              {(submitItemMutation.isPending || createTicketMutation.isPending)
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : "فتح بلاغ عطل"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showCompleteDialog} onOpenChange={setShowCompleteDialog}>
        <DialogContent dir="rtl" className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-green-600">
              <CheckSquare className="w-5 h-5" />
              إنهاء الفحص الدوري
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="bg-green-50 rounded-lg p-2">
                <div className="text-2xl font-bold text-green-700">
                  {results.filter((r: any) => r.status === "ok").length}
                </div>
                <div className="text-xs text-green-600">سليم</div>
              </div>
              <div className="bg-blue-50 rounded-lg p-2">
                <div className="text-2xl font-bold text-blue-700">
                  {results.filter((r: any) => r.status === "fixed").length}
                </div>
                <div className="text-xs text-blue-600">تم إصلاحه</div>
              </div>
              <div className="bg-red-50 rounded-lg p-2">
                <div className="text-2xl font-bold text-red-700">
                  {results.filter((r: any) => r.status === "issue").length}
                </div>
                <div className="text-xs text-red-600">خلل</div>
              </div>
            </div>
            <div>
              <Label>ملاحظات عامة (اختياري)</Label>
              <Textarea
                value={generalNotes}
                onChange={e => setGeneralNotes(e.target.value)}
                placeholder="أي ملاحظات إضافية تريد إضافتها..."
                rows={2}
                className="mt-1"
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowCompleteDialog(false)}>إلغاء</Button>
            <Button
              onClick={handleCompleteSubmit}
              disabled={completeMutation.isPending}
              className="bg-green-600 hover:bg-green-700 text-white"
            >
              {completeMutation.isPending
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : "إنهاء وإرسال"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
