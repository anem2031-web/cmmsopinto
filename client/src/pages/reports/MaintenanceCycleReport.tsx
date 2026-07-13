import { useState, useMemo } from "react";
import { useTranslatedField } from "@/hooks/useTranslatedField";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useLocation } from "wouter";
import { cn } from "@/lib/utils";
import {
  Wrench, Clock, TrendingUp, AlertTriangle, CheckCircle2,
  ChevronDown, ChevronUp, ExternalLink, BarChart3,
  Timer, Hourglass, RefreshCw, Filter, ArrowRight,
  Calendar, User, MapPin, Flame
} from "lucide-react";

// ─── Helpers ─────────────────────────────────────────────────────────────────
function formatHours(h: number | null): string {
  if (h === null) return "—";
  if (h < 1) return `${Math.round(h * 60)} دقيقة`;
  if (h < 24) return `${h} ساعة`;
  const days = Math.floor(h / 24);
  const rem = Math.round(h % 24);
  return rem > 0 ? `${days} يوم ${rem} ساعة` : `${days} يوم`;
}

function getPriorityColor(p: string) {
  const map: Record<string, string> = {
    critical: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
    high: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
    medium: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300",
    low: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  };
  return map[p] || "bg-gray-100 text-gray-600";
}

function getPriorityLabel(p: string) {
  const map: Record<string, string> = {
    critical: "حرجة", high: "عالية", medium: "متوسطة", low: "منخفضة",
  };
  return map[p] || p;
}

function getStatusLabel(s: string) {
  const map: Record<string, string> = {
    new: "جديد", pending_triage: "انتظار الفرز", under_inspection: "قيد الفحص",
    work_approved: "موافقة على العمل", approved: "موافقة الإدارة", assigned: "مُسند",
    in_progress: "قيد التنفيذ", needs_purchase: "يحتاج شراء",
    purchase_pending_estimate: "انتظار تسعير", purchase_pending_accounting: "انتظار الحسابات",
    purchase_pending_management: "انتظار الإدارة", purchase_approved: "شراء معتمد",
    partial_purchase: "شراء جزئي", purchased: "تم الشراء",
    received_warehouse: "استلام مستودع", repaired: "تم الإصلاح",
    verified: "تم التحقق", ready_for_closure: "جاهز للإغلاق",
    out_for_repair: "خارج للإصلاح", closed: "مغلق",
  };
  return map[s] || s;
}

function getStatusColor(s: string) {
  if (s === "closed") return "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300";
  if (s === "in_progress") return "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300";
  if (s === "pending_triage" || s === "under_inspection") return "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300";
  return "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300";
}

function getCategoryLabel(c: string) {
  const map: Record<string, string> = {
    electrical: "كهربائي", plumbing: "سباكة", hvac: "تكييف",
    structural: "هيكلي", mechanical: "ميكانيكي", general: "عام",
    safety: "سلامة", cleaning: "نظافة",
  };
  return map[c] || c;
}

// ─── Phase Colors ─────────────────────────────────────────────────────────────
const PHASE_COLORS = [
  "bg-blue-500", "bg-indigo-500", "bg-violet-500", "bg-purple-500",
  "bg-pink-500", "bg-rose-500", "bg-orange-500", "bg-amber-500",
  "bg-yellow-500", "bg-lime-500", "bg-green-500", "bg-teal-500",
];

// ─── Timeline Bar ─────────────────────────────────────────────────────────────
function TimelineBar({ phases, totalHours }: { phases: any[]; totalHours: number }) {
  const phasesWithDuration = phases.filter(p => p.durationHours !== null && p.durationHours > 0);
  if (phasesWithDuration.length === 0) return null;
  const total = phasesWithDuration.reduce((s, p) => s + (p.durationHours || 0), 0);

  return (
    <div className="space-y-2">
      <div className="flex h-4 rounded-full overflow-hidden gap-0.5">
        {phasesWithDuration.map((p, i) => {
          const pct = total > 0 ? ((p.durationHours || 0) / total) * 100 : 0;
          return (
            <div
              key={i}
              className={cn("transition-all", PHASE_COLORS[i % PHASE_COLORS.length])}
              style={{ width: `${pct}%` }}
              title={`${p.label}: ${formatHours(p.durationHours)}`}
            />
          );
        })}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {phasesWithDuration.map((p, i) => (
          <div key={i} className="flex items-center gap-1 text-xs">
            <span className={cn("w-2 h-2 rounded-sm flex-shrink-0", PHASE_COLORS[i % PHASE_COLORS.length])} />
            <span className="text-muted-foreground">{p.label}</span>
            <span className="font-semibold">{formatHours(p.durationHours)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Ticket Card ──────────────────────────────────────────────────────────────
function TicketCard({ ticket }: { ticket: any }) {
  const { getField } = useTranslatedField();
  const [expanded, setExpanded] = useState(false);
  const [, setLocation] = useLocation();

  const phasesWithDuration = ticket.phases.filter((p: any) => p.durationHours !== null && p.durationHours > 0);

  return (
    <Card className={cn(
      "overflow-hidden transition-all",
      ticket.bottleneck && ticket.bottleneck.hours > 48 && "border-orange-200 dark:border-orange-800"
    )}>
      <div
        className="flex items-start gap-3 p-4 cursor-pointer hover:bg-muted/30 transition-colors"
        onClick={() => setExpanded(e => !e)}
      >
        <div className={cn(
          "w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0",
          ticket.isClosed ? "bg-green-100 dark:bg-green-900/40" : "bg-primary/10"
        )}>
          {ticket.isClosed
            ? <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400" />
            : <Wrench className="w-5 h-5 text-primary" />
          }
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={(e) => { e.stopPropagation(); setLocation(`/tickets/${ticket.ticketId}`); }}
              className="font-bold text-base hover:text-primary transition-colors flex items-center gap-1"
            >
              {ticket.ticketNumber}
              <ExternalLink className="w-3 h-3 opacity-50" />
            </button>
            <span className={cn("text-xs px-2 py-0.5 rounded-full font-medium", getPriorityColor(ticket.priority))}>
              {getPriorityLabel(ticket.priority)}
            </span>
            <span className={cn("text-xs px-2 py-0.5 rounded-full font-medium", getStatusColor(ticket.status))}>
              {getStatusLabel(ticket.status)}
            </span>
          </div>

          <p className="text-sm text-muted-foreground mt-0.5 truncate">{getField(ticket, "title")}</p>

          <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground flex-wrap">
            {ticket.site && (
              <span className="flex items-center gap-1">
                <MapPin className="w-3 h-3" />
                {ticket.site}
              </span>
            )}
            <span className="flex items-center gap-1">
              <User className="w-3 h-3" />
              {ticket.assignedTo}
            </span>
            <span className="flex items-center gap-1">
              <Calendar className="w-3 h-3" />
              {new Date(ticket.createdAt).toLocaleDateString("ar-SA")}
            </span>
            <span>{getCategoryLabel(ticket.category)}</span>
          </div>

          {/* Mini timeline bar */}
          {phasesWithDuration.length > 0 && !expanded && (
            <div className="mt-2">
              <div className="flex h-2 rounded-full overflow-hidden gap-0.5">
                {phasesWithDuration.map((p: any, i: number) => {
                  const total = phasesWithDuration.reduce((s: number, x: any) => s + (x.durationHours || 0), 0);
                  const pct = total > 0 ? ((p.durationHours || 0) / total) * 100 : 0;
                  return (
                    <div
                      key={i}
                      className={cn(PHASE_COLORS[i % PHASE_COLORS.length])}
                      style={{ width: `${pct}%` }}
                      title={`${p.label}: ${formatHours(p.durationHours)}`}
                    />
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-col items-end gap-2 flex-shrink-0">
          <div className={cn(
            "flex items-center gap-1 text-sm px-3 py-1.5 rounded-full font-semibold",
            ticket.isClosed ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
              : "bg-primary/10 text-primary"
          )}>
            <Timer className="w-4 h-4" />
            {formatHours(ticket.totalHours)}
          </div>
          {ticket.bottleneck && (
            <div className="flex items-center gap-1 text-xs text-orange-600 dark:text-orange-400">
              <AlertTriangle className="w-3 h-3" />
              <span className="truncate max-w-[100px]">{ticket.bottleneck.phase}</span>
            </div>
          )}
          {expanded ? <ChevronUp className="w-5 h-5 text-muted-foreground" /> : <ChevronDown className="w-5 h-5 text-muted-foreground" />}
        </div>
      </div>

      {expanded && (
        <div className="border-t border-border">
          {/* Timeline visualization */}
          {phasesWithDuration.length > 0 && (
            <div className="p-4 bg-muted/20 border-b border-border">
              <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-primary" />
                توزيع الوقت على المراحل
              </h4>
              <TimelineBar phases={phasesWithDuration} totalHours={ticket.totalHours} />
            </div>
          )}

          {/* Phases table */}
          <div className="p-4">
            <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <ArrowRight className="w-4 h-4 text-primary" />
              تسلسل المراحل من المهد للحد
            </h4>

            {/* Vertical timeline */}
            <div className="relative">
              <div className="absolute right-4 top-0 bottom-0 w-0.5 bg-border" />
              <div className="space-y-0">
                {ticket.phases.map((p: any, i: number) => (
                  <div key={i} className="relative flex items-start gap-4 pb-4 last:pb-0">
                    {/* Dot */}
                    <div className={cn(
                      "relative z-10 w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 border-2 border-background",
                      p.durationHours !== null ? PHASE_COLORS[i % PHASE_COLORS.length] : "bg-muted"
                    )}>
                      <span className="text-white text-xs font-bold">{i + 1}</span>
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0 pt-1">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div>
                          <span className="font-semibold text-sm">{p.label}</span>
                          {p.changedBy && (
                            <span className="text-xs text-muted-foreground mr-2">بواسطة: {p.changedBy}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {p.durationHours !== null ? (
                            <span className={cn(
                              "text-sm font-bold px-2 py-0.5 rounded-full",
                              p.durationHours > 48 ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
                                : p.durationHours > 24 ? "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300"
                                  : "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
                            )}>
                              {formatHours(p.durationHours)}
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground flex items-center gap-1">
                              <Hourglass className="w-3 h-3" />
                              جارٍ
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
                        <span>{new Date(p.startAt).toLocaleString("ar-SA")}</span>
                        {p.endAt && (
                          <>
                            <ArrowRight className="w-3 h-3" />
                            <span>{new Date(p.endAt).toLocaleString("ar-SA")}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                ))}

                {/* Final closed state */}
                {ticket.isClosed && (
                  <div className="relative flex items-start gap-4">
                    <div className="relative z-10 w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 border-2 border-background bg-green-500">
                      <CheckCircle2 className="w-4 h-4 text-white" />
                    </div>
                    <div className="flex-1 pt-1">
                      <span className="font-semibold text-sm text-green-600 dark:text-green-400">مغلق</span>
                      {ticket.closedAt && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {new Date(ticket.closedAt).toLocaleString("ar-SA")}
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Summary */}
            <div className="mt-4 p-3 rounded-lg bg-muted/50 flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2 text-sm">
                <Timer className="w-4 h-4 text-primary" />
                <span className="text-muted-foreground">إجمالي الوقت:</span>
                <span className="font-bold">{formatHours(ticket.totalHours)}</span>
                <span className="text-muted-foreground">({ticket.totalDays} يوم)</span>
              </div>
              {ticket.bottleneck && (
                <div className="flex items-center gap-2 text-sm text-orange-600 dark:text-orange-400">
                  <AlertTriangle className="w-4 h-4" />
                  <span>نقطة التأخير: <strong>{ticket.bottleneck.phase}</strong> ({formatHours(ticket.bottleneck.hours)})</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function MaintenanceCycleReport() {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [filterInput, setFilterInput] = useState({ dateFrom: "", dateTo: "", status: "" });
  const [showFilters, setShowFilters] = useState(false);
  const [sortBy, setSortBy] = useState<"totalHours" | "createdAt">("totalHours");

  const { data, isLoading, refetch } = trpc.reports.maintenanceCycleReport.useQuery(
    (filterInput.dateFrom || filterInput.dateTo || filterInput.status)
      ? {
          dateFrom: filterInput.dateFrom || undefined,
          dateTo: filterInput.dateTo || undefined,
          status: filterInput.status || undefined,
        }
      : undefined,
    { refetchInterval: 60000 }
  );

  const handleApplyFilter = () => {
    setFilterInput({ dateFrom, dateTo, status: statusFilter });
  };

  const handleClearFilter = () => {
    setDateFrom(""); setDateTo(""); setStatusFilter("");
    setFilterInput({ dateFrom: "", dateTo: "", status: "" });
  };

  const sortedTickets = useMemo(() => {
    if (!data?.tickets) return [];
    return [...data.tickets].sort((a, b) =>
      sortBy === "totalHours"
        ? b.totalHours - a.totalHours
        : new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }, [data, sortBy]);

  return (
    <div className="space-y-6" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <Wrench className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">تقرير دورة الصيانة</h1>
            <p className="text-sm text-muted-foreground">وقت كل مرحلة من المهد إلى اللحد</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant={sortBy === "totalHours" ? "default" : "outline"}
            size="sm"
            onClick={() => setSortBy("totalHours")}
            className="gap-1 text-xs"
          >
            <Timer className="w-3 h-3" />
            ترتيب بالوقت
          </Button>
          <Button
            variant={sortBy === "createdAt" ? "default" : "outline"}
            size="sm"
            onClick={() => setSortBy("createdAt")}
            className="gap-1 text-xs"
          >
            <Calendar className="w-3 h-3" />
            ترتيب بالتاريخ
          </Button>
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

      {/* Filters */}
      {showFilters && (
        <Card>
          <CardContent className="p-4">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 items-end">
              <div className="space-y-1.5">
                <Label className="text-xs">من تاريخ</Label>
                <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">إلى تاريخ</Label>
                <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">الحالة</Label>
                <select
                  value={statusFilter}
                  onChange={e => setStatusFilter(e.target.value)}
                  className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">الكل</option>
                  <option value="closed">مغلق</option>
                  <option value="in_progress">قيد التنفيذ</option>
                  <option value="pending_triage">انتظار الفرز</option>
                  <option value="under_inspection">قيد الفحص</option>
                </select>
              </div>
              <Button size="sm" onClick={handleApplyFilter}>تطبيق</Button>
              <Button size="sm" variant="outline" onClick={handleClearFilter}>مسح</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Summary Cards */}
      {isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
      ) : data && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-950/40 dark:to-blue-900/20 border-blue-200 dark:border-blue-800">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <Wrench className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                <span className="text-xs text-blue-600 dark:text-blue-400 font-medium">إجمالي البلاغات</span>
              </div>
              <p className="text-3xl font-bold text-blue-700 dark:text-blue-300">{data.total}</p>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-green-50 to-green-100 dark:from-green-950/40 dark:to-green-900/20 border-green-200 dark:border-green-800">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle2 className="w-4 h-4 text-green-600 dark:text-green-400" />
                <span className="text-xs text-green-600 dark:text-green-400 font-medium">مغلقة</span>
              </div>
              <p className="text-3xl font-bold text-green-700 dark:text-green-300">{data.closedCount}</p>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-purple-50 to-purple-100 dark:from-purple-950/40 dark:to-purple-900/20 border-purple-200 dark:border-purple-800">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <Timer className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                <span className="text-xs text-purple-600 dark:text-purple-400 font-medium">متوسط وقت الإغلاق</span>
              </div>
              <p className="text-xl font-bold text-purple-700 dark:text-purple-300">
                {data.avgTotalDays !== null ? `${data.avgTotalDays} يوم` : "—"}
              </p>
              <p className="text-xs text-purple-600 dark:text-purple-400 mt-0.5">
                {formatHours(data.avgTotalHours)}
              </p>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-orange-50 to-orange-100 dark:from-orange-950/40 dark:to-orange-900/20 border-orange-200 dark:border-orange-800">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <Flame className="w-4 h-4 text-orange-600 dark:text-orange-400" />
                <span className="text-xs text-orange-600 dark:text-orange-400 font-medium">أكثر مرحلة تأخيراً</span>
              </div>
              <p className="text-sm font-bold text-orange-700 dark:text-orange-300 truncate">
                {data.phaseAvgs[0]?.phase || "—"}
              </p>
              <p className="text-xs text-orange-600 dark:text-orange-400 mt-0.5">
                {formatHours(data.phaseAvgs[0]?.avgHours || null)}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Phase Averages Chart */}
      {data && data.phaseAvgs.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-primary" />
              متوسط وقت كل مرحلة (نقاط التأخير)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {data.phaseAvgs.slice(0, 10).map((p, i) => {
                const maxHours = data.phaseAvgs[0]?.avgHours || 1;
                const pct = maxHours > 0 ? ((p.avgHours || 0) / maxHours) * 100 : 0;
                const isBottleneck = i === 0;
                return (
                  <div key={i} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        {isBottleneck && <AlertTriangle className="w-3.5 h-3.5 text-orange-500" />}
                        <span className={cn("font-medium", isBottleneck && "text-orange-600 dark:text-orange-400")}>
                          {p.phase}
                        </span>
                        <span className="text-xs text-muted-foreground">({p.count} بلاغ)</span>
                      </div>
                      <span className={cn("font-bold", isBottleneck && "text-orange-600 dark:text-orange-400")}>
                        {formatHours(p.avgHours)}
                      </span>
                    </div>
                    <div className="h-2.5 bg-muted rounded-full overflow-hidden">
                      <div
                        className={cn(
                          "h-full rounded-full transition-all",
                          isBottleneck ? "bg-orange-500" : PHASE_COLORS[i % PHASE_COLORS.length]
                        )}
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

      {/* Tickets List */}
      <div className="space-y-3">
        <h2 className="text-base font-semibold flex items-center gap-2">
          <Wrench className="w-4 h-4 text-primary" />
          البلاغات ({sortedTickets.length})
          <span className="text-xs text-muted-foreground font-normal">
            {sortBy === "totalHours" ? "مرتبة من الأطول وقتاً" : "مرتبة من الأحدث"}
          </span>
        </h2>

        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
          </div>
        ) : sortedTickets.length === 0 ? (
          <Card>
            <CardContent className="p-12 text-center">
              <Wrench className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-muted-foreground">لا توجد بلاغات في هذه الفترة</p>
            </CardContent>
          </Card>
        ) : (
          sortedTickets.map(ticket => <TicketCard key={ticket.ticketId} ticket={ticket} />)
        )}
      </div>
    </div>
  );
}
