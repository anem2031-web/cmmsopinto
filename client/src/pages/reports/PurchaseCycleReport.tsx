import { useState, useMemo } from "react";
import { useLanguage } from "@/contexts/LanguageContext";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useLocation } from "wouter";
import { cn } from "@/lib/utils";
import {
  ShoppingCart, Clock, TrendingUp, AlertTriangle, CheckCircle2,
  ChevronDown, ChevronUp, ExternalLink, BarChart3, Package,
  Timer, Hourglass, RefreshCw, Filter
} from "lucide-react";

// ─── Helpers ─────────────────────────────────────────────────────────────────
function formatHours(h: number | null, tr?: any): string {
  if (h === null) return "—";
  if (h < 1) return `${Math.round(h * 60)} ${tr?.common?.minutes || "دقيقة"}`;
  if (h < 24) return `${h} ${tr?.purchaseCycleReport?.hour || "ساعة"}`;
  const days = Math.floor(h / 24);
  const rem = Math.round(h % 24);
  return rem > 0 ? `${days} ${tr?.purchaseCycleReport?.day || "يوم"} ${rem} ${tr?.purchaseCycleReport?.hour || "ساعة"}` : `${days} ${tr?.purchaseCycleReport?.day || "يوم"}`;
}

function getStatusLabel(s: string, tr?: any): string {
  const map: Record<string, string> = {
    pending: tr?.poItemStatus?.pending || "بانتظار التسعير", estimated: tr?.poItemStatus?.estimated || "مُسعَّر", approved: tr?.poItemStatus?.approved || "معتمد",
    funded: tr?.purchaseCycleReport?.funded || "ممول", purchased: tr?.poItemStatus?.purchased || "تم الشراء", delivered_to_warehouse: tr?.purchaseCycleReport?.deliveredToWarehouse || "في المستودع",
    delivered_to_requester: tr?.purchaseCycleReport?.deliveredToRequester || "تم التسليم",
  };
  return map[s] || s;
}

function getStatusColor(s: string): string {
  const map: Record<string, string> = {
    pending: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300",
    estimated: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
    approved: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300",
    funded: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
    purchased: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
    delivered_to_warehouse: "bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300",
    delivered_to_requester: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  };
  return map[s] || "bg-gray-100 text-gray-700";
}

function getPOStatusColor(s: string): string {
  const map: Record<string, string> = {
    draft: "bg-gray-100 text-gray-600",
    pending_estimate: "bg-yellow-100 text-yellow-700",
    pending_accounting: "bg-blue-100 text-blue-700",
    pending_management: "bg-indigo-100 text-indigo-700",
    approved: "bg-purple-100 text-purple-700",
    partial_purchase: "bg-orange-100 text-orange-700",
    purchased: "bg-teal-100 text-teal-700",
    received: "bg-green-100 text-green-700",
    closed: "bg-green-200 text-green-800",
    rejected: "bg-red-100 text-red-700",
  };
  return map[s] || "bg-gray-100 text-gray-600";
}

function getPOStatusLabel(s: string, tr?: any): string {
  const map: Record<string, string> = {
    draft: tr?.poStatus?.draft || "مسودة", pending_estimate: tr?.poStatus?.pending_estimate || "بانتظار التسعير", pending_accounting: tr?.poStatus?.pending_accounting || "بانتظار الحسابات",
    pending_management: tr?.poStatus?.pending_management || "بانتظار الإدارة", approved: tr?.poStatus?.approved || "معتمد", partial_purchase: tr?.poStatus?.partial_purchase || "شراء جزئي",
    purchased: tr?.poStatus?.purchased || "تم الشراء", received: tr?.poStatus?.received || "مستلم", closed: tr?.poStatus?.closed || "مغلق", rejected: tr?.poStatus?.rejected || "مرفوض",
  };
  return map[s] || s;
}

// ─── Phase Bar ────────────────────────────────────────────────────────────────
const PHASE_COLORS = [
  "bg-blue-500", "bg-indigo-500", "bg-orange-500", "bg-teal-500", "bg-green-500",
];

function PhaseTimeline({ phases }: { phases: Array<{ phase: string; durationHours: number | null; status: string; actor?: string | null }> }) {
  const { t: tr } = useLanguage();
  const total = phases.reduce((s, p) => s + (p.durationHours || 0), 0);
  return (
    <div className="space-y-2">
      {total > 0 && (
        <div className="flex h-3 rounded-full overflow-hidden gap-0.5">
          {phases.map((p, i) => {
            const pct = total > 0 ? ((p.durationHours || 0) / total) * 100 : 0;
            return pct > 0 ? (
              <div
                key={i}
                className={cn("transition-all", PHASE_COLORS[i % PHASE_COLORS.length])}
                style={{ width: `${pct}%` }}
                title={`${translatePhase(p.phase, tr)}: ${formatHours(p.durationHours, tr)}`}
              />
            ) : null;
          })}
        </div>
      )}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-1.5">
        {phases.map((p, i) => (
          <div key={i} className="flex items-center gap-1.5 text-xs">
            <span className={cn("w-2.5 h-2.5 rounded-sm flex-shrink-0", PHASE_COLORS[i % PHASE_COLORS.length])} />
            <span className="text-muted-foreground truncate">{translatePhase(p.phase, tr)}</span>
            <span className={cn("font-semibold ml-auto", p.durationHours === null ? "text-muted-foreground" : "text-foreground")}>
              {formatHours(p.durationHours)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Phase name translator ────────────────────────────────────────────────────
// Backend returns Arabic phase names - we map them to translation keys
const PHASE_KEY_MAP: Record<string, string> = {
  "إنشاء الطلب": "createOrder",
  "مراجعة الأصناف": "reviewItems",
  "موافقة الحسابات": "accountingApproval",
  "موافقة الإدارة": "managementApproval",
  "شراء المندوب": "delegatePurchase",
  "استلام المستودع": "warehouseReceive",
  "تسليم للفني": "deliverToTechnician",
  "انتظار التسعير": "waitingPricing",
  "اعتماد الشراء": "purchaseApproval",
};

function translatePhase(phaseName: string, tr: any): string {
  const key = PHASE_KEY_MAP[phaseName];
  return (key && tr?.purchaseCycleReport?.phases?.[key]) || phaseName;
}

// ─── Actor Cell ───────────────────────────────────────────────────────────────
function ActorCell({ phase }: { phase: any }) {
  const { t: tr } = useLanguage();
  const [open, setOpen] = useState(false);

  // detect delivery-to-technician phase by Arabic key (backend always sends Arabic)
  const isDeliveryPhase = phase.phase === "تسليم للفني";

  if (isDeliveryPhase) {
    if (!phase.actor && !phase.deliveredTo) return <span className="text-muted-foreground text-xs">—</span>;
    return (
      <div className="text-xs space-y-0.5">
        {phase.actor && <div className="flex items-center gap-1"><span className="text-muted-foreground">{tr?.purchaseCycleReport?.deliveredBy}:</span><span className="font-medium">{phase.actor}</span></div>}
        {phase.deliveredTo && <div className="flex items-center gap-1"><span className="text-muted-foreground">{tr?.purchaseCycleReport?.receivedBy}:</span><span className="font-medium">{phase.deliveredTo}</span></div>}
      </div>
    );
  }

  if (Array.isArray(phase.actors)) {
    if (phase.actors.length === 0) return <span className="text-muted-foreground text-xs">—</span>;
    if (phase.actors.length === 1) {
      return <span className="font-medium text-xs">{phase.actors[0].name}</span>;
    }
    return (
      <div>
        <button
          onClick={e => { e.stopPropagation(); setOpen(o => !o); }}
          className="flex items-center gap-1 text-xs text-primary hover:underline font-medium"
        >
          {tr?.common?.results || "×"} ({phase.actors.length})
          {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </button>
        {open && (
          <div className="mt-1.5 space-y-1 border border-border rounded-md p-2 bg-background shadow-sm">
            {phase.actors.map((a: any, i: number) => (
              <div key={i} className="flex items-center justify-between gap-2 text-xs">
                {a.itemName && <span className="text-muted-foreground truncate max-w-[120px]">{a.itemName}</span>}
                <span className="font-medium">{a.name}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (!phase.actor) return <span className="text-muted-foreground text-xs">—</span>;
  return <span className="font-medium text-xs">{phase.actor}</span>;
}

// ─── Item Row ─────────────────────────────────────────────────────────────────
function ItemRow({ item }: { item: any }) {
  const { t: tr } = useLanguage();
  const [expanded, setExpanded] = useState(false);

  const phasesWithActors = item.phases.map((p: any) => ({
    ...p,
    actors: p.actor ? [{ itemName: item.itemName, name: p.actor }] : [],
  }));

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <div
        className="flex items-center gap-3 p-3 cursor-pointer hover:bg-muted/50 transition-colors"
        onClick={() => setExpanded(e => !e)}
      >
        <Package className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm">{item.itemName}</span>
            <span className="text-xs text-muted-foreground">({item.quantity} {item.unit || tr?.common?.unitLabel || "unit"})</span>
            <span className={cn("text-xs px-2 py-0.5 rounded-full font-medium", getStatusColor(item.currentStatus))}>
              {getStatusLabel(item.currentStatus, tr)}
            </span>
          </div>
          <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
            <span>{tr.purchaseCycleReport?.delegate || "المندوب"}: {item.delegate}</span>
            {item.estimatedCost && <span>{tr.purchaseCycleReport?.estimated || "مقدر"}: {item.estimatedCost.toFixed(2)} {tr.purchaseCycleReport?.currency || "ر.س"}</span>}
            {item.actualCost && <span>{tr.purchaseCycleReport?.actual || "فعلي"}: {item.actualCost.toFixed(2)} {tr.purchaseCycleReport?.currency || "ر.س"}</span>}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {item.totalHours !== null && (
            <div className="flex items-center gap-1 text-xs bg-muted px-2 py-1 rounded-full">
              <Timer className="w-3 h-3" />
              <span className="font-semibold">{formatHours(item.totalHours, tr)}</span>
            </div>
          )}
          {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </div>
      </div>

      {expanded && (
        <div className="px-3 pb-3 border-t border-border bg-muted/20">
          <div className="pt-3 space-y-3">
            <PhaseTimeline phases={item.phases} />
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-right py-1.5 font-semibold text-muted-foreground">{tr.purchaseCycleReport?.stage || "Stage"}</th>
                    <th className="text-right py-1.5 font-semibold text-muted-foreground">{tr.purchaseCycleReport?.start || "Start"}</th>
                    <th className="text-right py-1.5 font-semibold text-muted-foreground">{tr.purchaseCycleReport?.end || "End"}</th>
                    <th className="text-right py-1.5 font-semibold text-muted-foreground">{tr.purchaseCycleReport?.duration || "Duration"}</th>
                    <th className="text-right py-1.5 font-semibold text-muted-foreground">{tr.purchaseCycleReport?.delegate || "Executor"}</th>
                    <th className="text-right py-1.5 font-semibold text-muted-foreground">{tr.common?.status || "Status"}</th>
                  </tr>
                </thead>
                <tbody>
                  {phasesWithActors.map((p: any, i: number) => (
                    <tr key={i} className="border-b border-border/50 last:border-0">
                      <td className="py-1.5 pr-2">
                        <div className="flex items-center gap-1.5">
                          <span className={cn("w-2 h-2 rounded-full", PHASE_COLORS[i % PHASE_COLORS.length])} />
                          {translatePhase(p.phase, tr)}
                        </div>
                      </td>
                      <td className="py-1.5 text-muted-foreground">
                        {p.startAt ? new Date(p.startAt).toLocaleDateString("ar-SA") : "—"}
                      </td>
                      <td className="py-1.5 text-muted-foreground">
                        {p.endAt ? new Date(p.endAt).toLocaleDateString("ar-SA") : "—"}
                      </td>
                      <td className="py-1.5 font-semibold">
                        {formatHours(p.durationHours)}
                      </td>
                      <td className="py-1.5">
                        <ActorCell phase={p} />
                      </td>
                      <td className="py-1.5">
                        {p.status === "done"
                          ? <span className="text-green-600 dark:text-green-400 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" />{tr.purchaseCycleReport?.done || "منجز"}</span>
                          : p.status === "in_progress"
                            ? <span className="text-blue-600 dark:text-blue-400 flex items-center gap-1"><Hourglass className="w-3 h-3" />{tr.purchaseCycleReport?.ongoing || "جارٍ"}</span>
                            : <span className="text-muted-foreground flex items-center gap-1"><Clock className="w-3 h-3" />{tr.purchaseCycleReport?.waiting || "انتظار"}</span>
                        }
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── PO Card ──────────────────────────────────────────────────────────────────
function POCard({ po }: { po: any }) {
  const { t: tr } = useLanguage();
  const [expanded, setExpanded] = useState(false);
  const [, setLocation] = useLocation();

  return (
    <Card className="overflow-hidden">
      <div
        className="flex items-start gap-3 p-4 cursor-pointer hover:bg-muted/30 transition-colors"
        onClick={() => setExpanded(e => !e)}
      >
        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
          <ShoppingCart className="w-5 h-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold text-base">{po.poNumber}</span>
            <span className={cn("text-xs px-2 py-0.5 rounded-full font-medium", getPOStatusColor(po.status))}>
              {getPOStatusLabel(po.status, tr)}
            </span>
            {po.ticketId && (
              <button
                onClick={(e) => { e.stopPropagation(); const id = typeof po.ticketId === 'string' ? parseInt(po.ticketId) : po.ticketId; if (id && id > 0) setLocation(`/tickets/${id}`); }}
                className="text-xs text-primary hover:underline flex items-center gap-1"
              >
                <ExternalLink className="w-3 h-3" />
                {tr.purchaseCycleReport?.ticket || "بلاغ"} #{po.ticketNumber || po.ticketId}
              </button>
            )}
          </div>
          <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
            <span>{tr.purchaseCycleReport?.requester || "طالب"}: {po.requestedBy}</span>
            <span>{new Date(po.createdAt).toLocaleDateString("ar-SA")}</span>
            <span>{po.itemCount} {tr.purchaseCycleReport?.item || "صنف"}</span>
            {po.custodyAmount && <span className="text-amber-600 dark:text-amber-400 font-medium">{tr.purchaseCycleReport?.custody || "عهدة"}: {po.custodyAmount.toFixed(2)} {tr.purchaseCycleReport?.currency || "ر.س"}</span>}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {po.totalPOHours !== null && (
            <div className="flex items-center gap-1 text-sm bg-primary/10 text-primary px-3 py-1.5 rounded-full font-semibold">
              <Timer className="w-4 h-4" />
              {formatHours(po.totalPOHours)}
            </div>
          )}
          {expanded ? <ChevronUp className="w-5 h-5 text-muted-foreground" /> : <ChevronDown className="w-5 h-5 text-muted-foreground" />}
        </div>
      </div>

      {expanded && (
        <div className="border-t border-border">
<div className="p-4 bg-muted/20 border-b border-border">
  <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
    <BarChart3 className="w-4 h-4 text-primary" />
    {tr.purchaseCycleReport?.stages || "Order Stages"}
  </h4>
  <div className="overflow-x-auto">
    <table className="w-full text-xs">
      <thead>
        <tr className="border-b border-border">
          <th className="text-right py-1.5 pr-2 font-semibold text-muted-foreground">{tr.purchaseCycleReport?.stage || "Stage"}</th>
          <th className="text-right py-1.5 font-semibold text-muted-foreground">{tr.common?.date || "Date"}</th>
          <th className="text-right py-1.5 font-semibold text-muted-foreground">{tr.purchaseCycleReport?.delegate || "Executor"}</th>
          <th className="text-right py-1.5 font-semibold text-muted-foreground">{tr.common?.status || "Status"}</th>
        </tr>
      </thead>
      <tbody>
        {po.poPhases.map((p: any, i: number) => (
          <tr key={i} className="border-b border-border/50 last:border-0">
            <td className="py-1.5 pr-2">
              <div className="flex items-center gap-1.5">
                <span className={cn("w-2 h-2 rounded-full flex-shrink-0", PHASE_COLORS[i % PHASE_COLORS.length])} />
                <span className="font-medium">{translatePhase(p.phase, tr)}</span>
              </div>
            </td>
            <td className="py-1.5 text-muted-foreground">
              {p.startAt ? new Date(p.startAt).toLocaleDateString("ar-SA") : "—"}
            </td>
            <td className="py-1.5">
              <ActorCell phase={p} />
            </td>
            <td className="py-1.5">
              {p.status === "done"
                ? <span className="text-green-600 dark:text-green-400 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" />منجز</span>
                : <span className="text-muted-foreground flex items-center gap-1"><Clock className="w-3 h-3" />انتظار</span>
              }
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
</div>

          <div className="p-4 space-y-2">
            <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <Package className="w-4 h-4 text-primary" />
              الأصناف ({po.items.length})
            </h4>
            {po.items.map((item: any) => (
              <ItemRow key={item.itemId} item={item} />
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function PurchaseCycleReport() {
  const { t: tr } = useLanguage();
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [filterInput, setFilterInput] = useState({ dateFrom: "", dateTo: "" });
  const [showFilters, setShowFilters] = useState(false);

  const { data, isLoading, refetch } = trpc.reports.purchaseCycleReport.useQuery(
    filterInput.dateFrom || filterInput.dateTo
      ? { dateFrom: filterInput.dateFrom || undefined, dateTo: filterInput.dateTo || undefined }
      : undefined,
    { refetchInterval: 60000 }
  );

  const handleApplyFilter = () => setFilterInput({ dateFrom, dateTo });

  const handleClearFilter = () => {
    setDateFrom("");
    setDateTo("");
    setFilterInput({ dateFrom: "", dateTo: "" });
  };

  const sortedPOs = useMemo(() => {
    if (!data?.pos) return [];
    return [...data.pos].sort((a, b) => (b.totalPOHours || 0) - (a.totalPOHours || 0));
  }, [data]);

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <ShoppingCart className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">{tr.nav?.purchaseCycleReport || "تقرير دورة الشراء"}</h1>
            <p className="text-sm text-muted-foreground">{tr.purchaseCycleReport?.subtitle || "وقت كل مرحلة على مستوى كل صنف"}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowFilters(f => !f)} className="gap-2">
            <Filter className="w-4 h-4" />
            فلترة
          </Button>
          <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-2">
            <RefreshCw className="w-4 h-4" />
            تحديث
          </Button>
        </div>
      </div>

      {showFilters && (
        <Card>
          <CardContent className="p-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 items-end">
              <div className="space-y-1.5">
                <Label className="text-xs">{tr.common?.fromDate || "من تاريخ"}</Label>
                <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">{tr.common?.toDate || "إلى تاريخ"}</Label>
                <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="text-sm" />
              </div>
              <Button size="sm" onClick={handleApplyFilter}>{tr.common?.apply || "تطبيق"}</Button>
              <Button size="sm" variant="outline" onClick={handleClearFilter}>{tr.common?.clearFilters || "مسح"}</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
      ) : data && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-950/40 dark:to-blue-900/20 border-blue-200 dark:border-blue-800">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <ShoppingCart className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                <span className="text-xs text-blue-600 dark:text-blue-400 font-medium">{tr.purchaseCycleReport?.totalOrders || "إجمالي الطلبات"}</span>
              </div>
              <p className="text-3xl font-bold text-blue-700 dark:text-blue-300">{data.total}</p>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-green-50 to-green-100 dark:from-green-950/40 dark:to-green-900/20 border-green-200 dark:border-green-800">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <Timer className="w-4 h-4 text-green-600 dark:text-green-400" />
                <span className="text-xs text-green-600 dark:text-green-400 font-medium">{tr.purchaseCycleReport?.avgCycleTime || "متوسط وقت الدورة"}</span>
              </div>
              <p className="text-2xl font-bold text-green-700 dark:text-green-300">{formatHours(data.avgTotalHours)}</p>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-orange-50 to-orange-100 dark:from-orange-950/40 dark:to-orange-900/20 border-orange-200 dark:border-orange-800">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="w-4 h-4 text-orange-600 dark:text-orange-400" />
                <span className="text-xs text-orange-600 dark:text-orange-400 font-medium">{tr.purchaseCycleReport?.longestStage || "أطول مرحلة"}</span>
              </div>
              <p className="text-sm font-bold text-orange-700 dark:text-orange-300">
                {data.phaseAvgs.sort((a, b) => (b.avgHours || 0) - (a.avgHours || 0))[0]?.phase || "—"}
              </p>
              <p className="text-xs text-orange-600 dark:text-orange-400 mt-1">
                {formatHours(data.phaseAvgs.sort((a, b) => (b.avgHours || 0) - (a.avgHours || 0))[0]?.avgHours || null)}
              </p>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-purple-50 to-purple-100 dark:from-purple-950/40 dark:to-purple-900/20 border-purple-200 dark:border-purple-800">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                <span className="text-xs text-purple-600 dark:text-purple-400 font-medium">{tr.purchaseCycleReport?.analyzedItems || "أصناف محللة"}</span>
              </div>
              <p className="text-3xl font-bold text-purple-700 dark:text-purple-300">
                {data.pos.reduce((s, p) => s + p.itemCount, 0)}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {data && data.phaseAvgs.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-primary" />
              متوسط وقت كل مرحلة
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {data.phaseAvgs.map((p, i) => {
                const maxHours = Math.max(...data.phaseAvgs.map(x => x.avgHours || 0));
                const pct = maxHours > 0 ? ((p.avgHours || 0) / maxHours) * 100 : 0;
                return (
                  <div key={i} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <span className={cn("w-2.5 h-2.5 rounded-sm", PHASE_COLORS[i % PHASE_COLORS.length])} />
                        <span className="font-medium">{translatePhase(p.phase, tr)}</span>
                        <span className="text-xs text-muted-foreground">({p.count} {tr.purchaseCycleReport?.item || "صنف"})</span>
                      </div>
                      <span className="font-bold">{formatHours(p.avgHours)}</span>
                    </div>
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className={cn("h-full rounded-full transition-all", PHASE_COLORS[i % PHASE_COLORS.length])}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        <h2 className="text-base font-semibold flex items-center gap-2">
          <ShoppingCart className="w-4 h-4 text-primary" />
          طلبات الشراء ({sortedPOs.length})
        </h2>
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
          </div>
        ) : sortedPOs.length === 0 ? (
          <Card>
            <CardContent className="p-12 text-center">
              <ShoppingCart className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-muted-foreground">{tr.purchaseCycleReport?.noPOs || "لا توجد طلبات شراء في هذه الفترة"}</p>
            </CardContent>
          </Card>
        ) : (
          sortedPOs.map(po => <POCard key={po.poId} po={po} />)
        )}
      </div>
    </div>
  );
}
