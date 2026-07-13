import { useState } from "react";
import { useTranslatedField } from "@/hooks/useTranslatedField";
import { trpc } from "@/lib/trpc";
import { useLanguage } from "@/contexts/LanguageContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  Shield, LogOut, LogIn, CheckCircle2, Clock, AlertTriangle,
  Eye, History, MapPin, Tag, Timer, Truck,
} from "lucide-react";

function getElapsedTime(dateStr: string | Date): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays > 0) return `${diffDays} يوم`;
  if (diffHours > 0) return `${diffHours} ساعة`;
  return "أقل من ساعة";
}

function getElapsedColor(dateStr: string | Date): string {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays >= 7) return "text-red-600 font-bold";
  if (diffDays >= 3) return "text-amber-600 font-semibold";
  return "text-muted-foreground";
}

export default function GateSecurity() {
  const { getField } = useTranslatedField();
  const { t } = useLanguage();
  const utils = trpc.useUtils();

  const { data: allTickets = [], isLoading } = trpc.tickets.list.useQuery({});

  // Path C tickets awaiting gate exit approval (work_approved + path C)
  const pendingExitTickets = allTickets.filter((t: any) =>
    t.maintenancePath === "C" && t.status === "work_approved"
  );
  // Currently out for repair
  const outForRepairTickets = allTickets.filter((t: any) =>
    t.status === "out_for_repair"
  );
  // Completed external repair - awaiting gate entry
  const awaitingEntryTickets = allTickets.filter((t: any) =>
    t.maintenancePath === "C" && t.status === "out_for_repair" && t.externalRepairCompletedAt
  );
  // Completed full cycle (ready_for_closure or closed)
  const completedTickets = allTickets.filter((t: any) =>
    t.maintenancePath === "C" && ["ready_for_closure", "closed"].includes(t.status)
  );

  const [confirmDialog, setConfirmDialog] = useState<{ ticket: any; action: "exit" | "entry" } | null>(null);
  const [detailTicket, setDetailTicket] = useState<any | null>(null);

  const approveExitMut = trpc.tickets.approveGateExit.useMutation({
    onSuccess: () => {
      toast.success(t.gate.approvedExit);
      utils.tickets.list.invalidate();
      setConfirmDialog(null);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const approveEntryMut = trpc.tickets.approveGateEntry.useMutation({
    onSuccess: () => {
      toast.success(t.gate.approvedEntry);
      utils.tickets.list.invalidate();
      setConfirmDialog(null);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const handleConfirm = () => {
    if (!confirmDialog) return;
    if (confirmDialog.action === "exit") {
      approveExitMut.mutate({ id: confirmDialog.ticket.id });
    } else {
      approveEntryMut.mutate({ id: confirmDialog.ticket.id });
    }
  };

  const TicketCard = ({ ticket, action }: { ticket: any; action: "exit" | "entry" | "history" }) => (
    <Card className={`hover:shadow-md transition-all border-l-4 ${
      action === "exit" ? "border-l-orange-400" :
      action === "entry" ? "border-l-green-400" :
      "border-l-slate-300"
    }`}>
      <CardContent className="py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <span className="text-sm font-mono text-muted-foreground">{ticket.ticketNumber}</span>
              <Badge variant="outline" className="text-xs bg-blue-50 text-blue-700 border-blue-200">
                <Truck className="w-3 h-3 mr-1" />
                مسار خارجي
              </Badge>
              {ticket.status === "out_for_repair" && !ticket.externalRepairCompletedAt && (
                <Badge className="bg-orange-100 text-orange-700 text-xs border-orange-200">
                  <Timer className="w-3 h-3 mr-1" />
                  خارج منذ {getElapsedTime(ticket.updatedAt)}
                </Badge>
              )}
              {ticket.externalRepairCompletedAt && (
                <Badge className="bg-green-100 text-green-700 text-xs border-green-200">
                  <CheckCircle2 className="w-3 h-3 mr-1" />
                  تم الإصلاح الخارجي
                </Badge>
              )}
              {action === "history" && (
                <Badge className={`text-xs ${ticket.status === "closed" ? "bg-slate-100 text-slate-600" : "bg-teal-100 text-teal-700"}`}>
                  {ticket.status === "closed" ? t.gate.closed : t.gate.readyToClose}
                </Badge>
              )}
            </div>
            <h3 className="font-semibold text-base truncate">{getField(ticket, "title")}</h3>
            {ticket.justification && (
              <p className="text-sm text-muted-foreground mt-1 line-clamp-1">
                <span className="font-medium">{t.triage.justification} </span>{ticket.justification}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-3 mt-2 text-xs text-muted-foreground">
              {ticket.siteId && (
                <span className="flex items-center gap-1">
                  <MapPin className="w-3 h-3" />
                  الموقع: {ticket.siteId}
                </span>
              )}
              {ticket.asset?.rfidTag && (
                <span className="flex items-center gap-1 font-mono bg-slate-100 px-1.5 py-0.5 rounded">
                  <Tag className="w-3 h-3" />
                  {ticket.asset.rfidTag}
                </span>
              )}
              <span>تاريخ الإنشاء: {new Date(ticket.createdAt).toLocaleDateString("ar-SA")}</span>
              {ticket.status === "out_for_repair" && (
                <span className={`flex items-center gap-1 ${getElapsedColor(ticket.updatedAt)}`}>
                  <Clock className="w-3 h-3" />
                  خارج منذ: {getElapsedTime(ticket.updatedAt)}
                </span>
              )}
            </div>
          </div>
          <div className="flex gap-2 shrink-0">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setDetailTicket(ticket)}
              title="عرض التفاصيل"
            >
              <Eye className="w-4 h-4" />
            </Button>
            {action === "exit" && (
              <Button
                size="sm"
                onClick={() => setConfirmDialog({ ticket, action: "exit" })}
                className="bg-orange-500 hover:bg-orange-600 text-white"
              >
                <LogOut className="w-4 h-4 ml-1" />
                موافقة الخروج
              </Button>
            )}
            {action === "entry" && (
              <Button
                size="sm"
                onClick={() => setConfirmDialog({ ticket, action: "entry" })}
                className="bg-green-600 hover:bg-green-700 text-white"
              >
                <LogIn className="w-4 h-4 ml-1" />
                موافقة الدخول
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-xl bg-slate-900 dark:bg-slate-700 flex items-center justify-center shadow-md">
          <Shield className="w-6 h-6 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t.gate.title}</h1>
          <p className="text-sm text-muted-foreground">{t.gate.subtitle}</p>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="border-orange-200 bg-orange-50/60 dark:bg-orange-950/20">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground mb-1">{t.gate.awaitingExit}</p>
                <p className="text-2xl font-bold text-orange-700">{pendingExitTickets.length}</p>
              </div>
              <div className="w-10 h-10 rounded-xl bg-orange-100 flex items-center justify-center">
                <LogOut className="w-5 h-5 text-orange-500" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-red-200 bg-red-50/60 dark:bg-red-950/20">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground mb-1">{t.gate.outsideForRepair}</p>
                <p className="text-2xl font-bold text-red-700">{outForRepairTickets.length}</p>
              </div>
              <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center">
                <Clock className="w-5 h-5 text-red-500" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-green-200 bg-green-50/60 dark:bg-green-950/20">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground mb-1">{t.gate.awaitingEntry}</p>
                <p className="text-2xl font-bold text-green-700">{awaitingEntryTickets.length}</p>
              </div>
              <div className="w-10 h-10 rounded-xl bg-green-100 flex items-center justify-center">
                <LogIn className="w-5 h-5 text-green-500" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-slate-200 bg-slate-50/60 dark:bg-slate-800/30">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground mb-1">{t.gate.completed}</p>
                <p className="text-2xl font-bold text-slate-700">{completedTickets.length}</p>
              </div>
              <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center">
                <CheckCircle2 className="w-5 h-5 text-slate-500" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="exit">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="exit" className="gap-2 text-xs sm:text-sm">
            <LogOut className="w-4 h-4" />
            الخروج
            {pendingExitTickets.length > 0 && (
              <Badge className="bg-orange-500 text-white text-xs px-1.5 py-0 h-4">{pendingExitTickets.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="entry" className="gap-2 text-xs sm:text-sm">
            <LogIn className="w-4 h-4" />
            الدخول
            {awaitingEntryTickets.length > 0 && (
              <Badge className="bg-green-600 text-white text-xs px-1.5 py-0 h-4">{awaitingEntryTickets.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="history" className="gap-2 text-xs sm:text-sm">
            <History className="w-4 h-4" />
            السجل
          </TabsTrigger>
        </TabsList>

        {/* Exit Tab */}
        <TabsContent value="exit" className="space-y-3 mt-4">
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">{t.gate.loading}</div>
          ) : pendingExitTickets.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <CheckCircle2 className="w-12 h-12 text-green-400 mx-auto mb-3" />
                <p className="font-medium">لا توجد أصول بانتظار الخروج</p>
                <p className="text-sm text-muted-foreground mt-1">جميع الأصول المعتمدة للصيانة الخارجية قد غادرت</p>
              </CardContent>
            </Card>
          ) : (
            pendingExitTickets.map((ticket: any) => (
              <TicketCard key={ticket.id} ticket={ticket} action="exit" />
            ))
          )}
        </TabsContent>

        {/* Entry Tab */}
        <TabsContent value="entry" className="space-y-3 mt-4">
          {/* Currently out for repair - monitoring */}
          {outForRepairTickets.filter((t: any) => !t.externalRepairCompletedAt).length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide px-1">
                خارج حالياً — قيد الإصلاح
              </p>
              {outForRepairTickets
                .filter((t: any) => !t.externalRepairCompletedAt)
                .map((ticket: any) => (
                  <Card key={ticket.id} className="border-l-4 border-l-red-300 opacity-80">
                    <CardContent className="py-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <span className="text-sm font-mono text-muted-foreground">{ticket.ticketNumber}</span>
                          <p className="font-medium text-sm">{getField(ticket, "title")}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`text-xs flex items-center gap-1 ${getElapsedColor(ticket.updatedAt)}`}>
                            <Timer className="w-3 h-3" />
                            {getElapsedTime(ticket.updatedAt)}
                          </span>
                          <Button size="sm" variant="outline" onClick={() => setDetailTicket(ticket)}>
                            <Eye className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
            </div>
          )}

          {/* Awaiting entry approval */}
          {awaitingEntryTickets.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide px-1">
                بانتظار موافقة الدخول
              </p>
              {awaitingEntryTickets.map((ticket: any) => (
                <TicketCard key={ticket.id} ticket={ticket} action="entry" />
              ))}
            </div>
          )}

          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">{t.gate.loading}</div>
          ) : awaitingEntryTickets.length === 0 && outForRepairTickets.filter((t: any) => !t.externalRepairCompletedAt).length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <CheckCircle2 className="w-12 h-12 text-green-400 mx-auto mb-3" />
                <p className="font-medium">لا توجد أصول خارجة حالياً</p>
                <p className="text-sm text-muted-foreground mt-1">جميع الأصول موجودة داخل المنشأة</p>
              </CardContent>
            </Card>
          ) : null}
        </TabsContent>

        {/* History Tab */}
        <TabsContent value="history" className="space-y-3 mt-4">
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">{t.gate.loading}</div>
          ) : completedTickets.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <History className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                <p className="font-medium">لا يوجد سجل حركات بعد</p>
                <p className="text-sm text-muted-foreground mt-1">ستظهر هنا الأصول التي أكملت دورة الصيانة الخارجية</p>
              </CardContent>
            </Card>
          ) : (
            completedTickets.map((ticket: any) => (
              <TicketCard key={ticket.id} ticket={ticket} action="history" />
            ))
          )}
        </TabsContent>
      </Tabs>

      {/* Confirmation Dialog */}
      <Dialog open={!!confirmDialog} onOpenChange={() => setConfirmDialog(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {confirmDialog?.action === "exit" ? (
                <><LogOut className="w-5 h-5 text-orange-500" />تأكيد الموافقة على الخروج</>
              ) : (
                <><LogIn className="w-5 h-5 text-green-500" />تأكيد الموافقة على الدخول</>
              )}
            </DialogTitle>
          </DialogHeader>
          {confirmDialog && (
            <div className="py-2 space-y-3">
              <div className="p-3 bg-muted rounded-lg">
                <p className="font-semibold text-sm">{confirmDialog.ticket.ticketNumber}</p>
                <p className="text-sm text-muted-foreground">{getField(confirmDialog.ticket, "title")}</p>
                {confirmDialog.ticket.asset?.rfidTag && (
                  <p className="text-xs font-mono mt-1 text-slate-500">
                    RFID: {confirmDialog.ticket.asset.rfidTag}
                  </p>
                )}
              </div>
              <div className={`flex items-start gap-2 p-3 rounded-lg border ${
                confirmDialog.action === "exit"
                  ? "bg-orange-50 border-orange-200 dark:bg-orange-950/20 dark:border-orange-800"
                  : "bg-green-50 border-green-200 dark:bg-green-950/20 dark:border-green-800"
              }`}>
                <AlertTriangle className={`w-4 h-4 mt-0.5 shrink-0 ${
                  confirmDialog.action === "exit" ? "text-orange-500" : "text-green-500"
                }`} />
                <p className="text-sm">
                  {confirmDialog.action === "exit"
                    ? "بالموافقة، ستسجل خروج الأصل رسمياً من المنشأة للصيانة الخارجية. هذا الإجراء لا يمكن التراجع عنه."
                    : "بالموافقة، ستسجل دخول الأصل رسمياً إلى المنشأة بعد الصيانة الخارجية وسيُحدَّث حالة البلاغ."
                  }
                </p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDialog(null)}>إلغاء</Button>
            <Button
              onClick={handleConfirm}
              disabled={approveExitMut.isPending || approveEntryMut.isPending}
              className={confirmDialog?.action === "exit"
                ? "bg-orange-500 hover:bg-orange-600 text-white"
                : "bg-green-600 hover:bg-green-700 text-white"
              }
            >
              {(approveExitMut.isPending || approveEntryMut.isPending) ? "جاري التسجيل..." : "تأكيد الموافقة"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detail Dialog */}
      <Dialog open={!!detailTicket} onOpenChange={() => setDetailTicket(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Eye className="w-5 h-5 text-slate-500" />
              تفاصيل البلاغ
            </DialogTitle>
          </DialogHeader>
          {detailTicket && (
            <div className="space-y-3 py-2">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">رقم البلاغ</p>
                  <p className="font-mono font-medium">{detailTicket.ticketNumber}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">الحالة</p>
                  <Badge variant="outline" className="text-xs">{detailTicket.status}</Badge>
                </div>
                <div className="col-span-2">
                  <p className="text-xs text-muted-foreground">العنوان</p>
                  <p className="font-medium">{detailTicket.title}</p>
                </div>
                {detailTicket.justification && (
                  <div className="col-span-2">
                    <p className="text-xs text-muted-foreground">مبرر الإصلاح الخارجي</p>
                    <p className="text-sm">{detailTicket.justification}</p>
                  </div>
                )}
                <div>
                  <p className="text-xs text-muted-foreground">تاريخ الإنشاء</p>
                  <p>{new Date(detailTicket.createdAt).toLocaleDateString("ar-SA")}</p>
                </div>
                {detailTicket.status === "out_for_repair" && (
                  <div>
                    <p className="text-xs text-muted-foreground">مدة الخروج</p>
                    <p className={getElapsedColor(detailTicket.updatedAt)}>
                      {getElapsedTime(detailTicket.updatedAt)}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDetailTicket(null)}>إغلاق</Button>
            <Button onClick={() => { window.location.href = `/tickets/${detailTicket?.id}`; }}>
              <Eye className="w-4 h-4 ml-1" />
              فتح البلاغ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
