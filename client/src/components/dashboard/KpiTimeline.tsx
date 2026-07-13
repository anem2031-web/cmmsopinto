import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  Activity, AlertTriangle, CheckCircle2, Clock, XCircle,
  ChevronDown, ChevronUp, Ticket, ShoppingCart,
  Zap, User, Wrench, Lock, FileText, Calculator, Building2, Package
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────
type StepStatus = "ok" | "warning" | "overdue" | "pending" | "done" | "rejected";

interface TimelineStep {
  label: string;
  icon: string;
  completedAt: Date | string | null;
  durationMin: number | null;
  status: StepStatus;
  slaMin: number | null;
}

interface TicketTimeline {
  id: number;
  ticketNumber: string;
  title: string;
  status: string;
  priority: string;
  overallStatus: string;
  bottleneck: string | null;
  totalMinutes: number;
  steps: TimelineStep[];
}

interface POTimeline {
  id: number;
  poNumber: string;
  status: string;
  overallStatus: string;
  bottleneck: string | null;
  totalMinutes: number;
  steps: TimelineStep[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} د`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h < 24) return m > 0 ? `${h}س ${m}د` : `${h}س`;
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return rh > 0 ? `${d}ي ${rh}س` : `${d}ي`;
}

function getStepIcon(icon: string) {
  const cls = "w-3.5 h-3.5";
  switch (icon) {
    case "create":     return <FileText className={cls} />;
    case "triage":     return <Zap className={cls} />;
    case "assign":     return <User className={cls} />;
    case "field":      return <Wrench className={cls} />;
    case "close":      return <Lock className={cls} />;
    case "estimate":   return <Calculator className={cls} />;
    case "accounting": return <FileText className={cls} />;
    case "management": return <Building2 className={cls} />;
    case "purchase":   return <Package className={cls} />;
    default:           return <Activity className={cls} />;
  }
}

function getStatusConfig(status: StepStatus) {
  switch (status) {
    case "done":
    case "ok":
      return {
        dot: "bg-emerald-500 shadow-emerald-200",
        line: "bg-emerald-400",
        badge: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
        icon: "bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-400",
        label: status === "done" ? "مكتمل" : "في الوقت",
        glow: "",
      };
    case "warning":
      return {
        dot: "bg-amber-500 shadow-amber-200 animate-pulse",
        line: "bg-amber-400",
        badge: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
        icon: "bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-400",
        label: "اقترب من التجاوز",
        glow: "ring-1 ring-amber-300 dark:ring-amber-700",
      };
    case "overdue":
      return {
        dot: "bg-red-500 shadow-red-200 animate-pulse",
        line: "bg-red-400",
        badge: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
        icon: "bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-400",
        label: "تأخير",
        glow: "ring-1 ring-red-300 dark:ring-red-700",
      };
    case "rejected":
      return {
        dot: "bg-gray-400",
        line: "bg-gray-300",
        badge: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
        icon: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400",
        label: "مرفوض",
        glow: "",
      };
    default: // pending
      return {
        dot: "bg-slate-300 dark:bg-slate-600",
        line: "bg-slate-200 dark:bg-slate-700",
        badge: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
        icon: "bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500",
        label: "في الانتظار",
        glow: "",
      };
  }
}

function getOverallConfig(status: string) {
  switch (status) {
    case "done":     return { bg: "bg-emerald-50 border-emerald-200 dark:bg-emerald-950/20 dark:border-emerald-800", header: "bg-emerald-500", icon: <CheckCircle2 className="w-4 h-4" />, label: "مكتمل" };
    case "overdue":  return { bg: "bg-red-50 border-red-200 dark:bg-red-950/20 dark:border-red-800", header: "bg-red-500", icon: <XCircle className="w-4 h-4" />, label: "متأخر" };
    case "warning":  return { bg: "bg-amber-50 border-amber-200 dark:bg-amber-950/20 dark:border-amber-800", header: "bg-amber-500", icon: <AlertTriangle className="w-4 h-4" />, label: "تحذير" };
    case "rejected": return { bg: "bg-gray-50 border-gray-200 dark:bg-gray-950/20 dark:border-gray-800", header: "bg-gray-400", icon: <XCircle className="w-4 h-4" />, label: "مرفوض" };
    default:         return { bg: "bg-blue-50 border-blue-200 dark:bg-blue-950/20 dark:border-blue-800", header: "bg-blue-500", icon: <Activity className="w-4 h-4" />, label: "جارٍ" };
  }
}

// ─── Single Timeline Card ─────────────────────────────────────────────────────
function TimelineCard({ item, type }: { item: TicketTimeline | POTimeline; type: "ticket" | "po" }) {
  const [expanded, setExpanded] = useState(false);
  const overall = getOverallConfig(item.overallStatus);

  const title = type === "ticket"
    ? `بلاغ #${(item as TicketTimeline).ticketNumber}`
    : `طلب شراء #${(item as POTimeline).poNumber}`;

  const subtitle = type === "ticket"
    ? (item as TicketTimeline).title
    : `الحالة: ${(item as POTimeline).status}`;

  return (
    <div className={cn(
      "rounded-xl border transition-all duration-200",
      overall.bg,
      expanded ? "shadow-md" : "shadow-sm hover:shadow-md"
    )}>
      {/* ── Card Header ── */}
      <button
        className="w-full text-right p-4 flex items-center gap-3"
        onClick={() => setExpanded(!expanded)}
      >
        {/* Status dot + icon */}
        <div className={cn("w-9 h-9 rounded-lg flex items-center justify-center text-white flex-shrink-0", overall.header)}>
          {type === "ticket" ? <Ticket className="w-4 h-4" /> : <ShoppingCart className="w-4 h-4" />}
        </div>

        {/* Title */}
        <div className="flex-1 min-w-0 text-right">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold text-sm">{title}</span>
            <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-full text-white", overall.header)}>
              {overall.label}
            </span>
            {item.bottleneck && (
              <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 flex items-center gap-1">
                <AlertTriangle className="w-2.5 h-2.5" />
                اختناق: {item.bottleneck}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5 truncate">{subtitle}</p>
        </div>

        {/* Total time + expand */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="text-right">
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="w-3 h-3" />
              <span className="font-semibold">{formatDuration(item.totalMinutes)}</span>
            </div>
            <p className="text-[10px] text-muted-foreground">إجمالي</p>
          </div>
          {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </div>
      </button>

      {/* ── Expanded Timeline ── */}
      {expanded && (
        <div className="px-4 pb-4">
          {/* AI Bottleneck Analysis */}
          {item.bottleneck && (
            <div className="mb-4 p-3 rounded-lg bg-red-100/80 dark:bg-red-900/30 border border-red-200 dark:border-red-800 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-bold text-red-700 dark:text-red-300">تحليل الذكاء الاصطناعي</p>
                <p className="text-xs text-red-600 dark:text-red-400 mt-0.5">
                  منطقة التأخير الحالية: <strong>{item.bottleneck}</strong> — تجاوزت الوقت المعياري المحدد.
                </p>
              </div>
            </div>
          )}

          {/* Timeline Steps */}
          <div className="relative">
            {item.steps.map((step, idx) => {
              const cfg = getStatusConfig(step.status as StepStatus);
              const isLast = idx === item.steps.length - 1;

              return (
                <div key={idx} className="flex gap-3 relative">
                  {/* Vertical line */}
                  {!isLast && (
                    <div className="absolute right-[17px] top-8 bottom-0 w-0.5 bg-border dark:bg-border" />
                  )}

                  {/* Step dot */}
                  <div className="flex-shrink-0 flex flex-col items-center">
                    <div className={cn(
                      "w-9 h-9 rounded-lg flex items-center justify-center shadow-sm z-10",
                      cfg.icon,
                      cfg.glow
                    )}>
                      {getStepIcon(step.icon)}
                    </div>
                  </div>

                  {/* Step content */}
                  <div className={cn("flex-1 pb-4", isLast && "pb-0")}>
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold">{step.label}</span>
                        <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-full", cfg.badge)}>
                          {cfg.label}
                        </span>
                      </div>
                      {step.durationMin !== null && (
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Clock className="w-3 h-3" />
                          <span className="font-medium">{formatDuration(step.durationMin)}</span>
                          {step.slaMin && (
                            <span className="text-muted-foreground/60">/ {formatDuration(step.slaMin)} SLA</span>
                          )}
                        </div>
                      )}
                    </div>

                    {step.completedAt && (
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {new Date(step.completedAt).toLocaleString("ar-SA")}
                      </p>
                    )}

                    {/* SLA progress bar */}
                    {step.durationMin !== null && step.slaMin && (
                      <div className="mt-1.5 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div
                          className={cn(
                            "h-full rounded-full transition-all",
                            step.status === "ok" || step.status === "done" ? "bg-emerald-500" :
                            step.status === "warning" ? "bg-amber-500" : "bg-red-500"
                          )}
                          style={{ width: `${Math.min(100, (step.durationMin / step.slaMin) * 100)}%` }}
                        />
                      </div>
                    )}

                    {/* Overdue analysis */}
                    {step.status === "overdue" && step.slaMin && step.durationMin && (
                      <p className="text-[11px] text-red-600 dark:text-red-400 mt-1 font-medium">
                        ⚠️ تجاوز المعدل الطبيعي بـ {formatDuration(step.durationMin - step.slaMin)}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main KPI Timeline Panel ──────────────────────────────────────────────────
export default function KpiTimeline() {
  const [activeTab, setActiveTab] = useState<"tickets" | "po">("tickets");

  const { data: ticketTimelines = [], isLoading: ticketsLoading } = trpc.kpi.getTicketTimelines.useQuery(undefined, {
    refetchInterval: 60000,
  });

  const { data: poTimelines = [], isLoading: poLoading } = trpc.kpi.getPOTimelines.useQuery(undefined, {
    refetchInterval: 60000,
  });

  const isLoading = activeTab === "tickets" ? ticketsLoading : poLoading;
  const items = activeTab === "tickets" ? ticketTimelines : poTimelines;

  // Stats
  const overdueCount = items.filter(i => i.overallStatus === "overdue").length;
  const warningCount = items.filter(i => i.overallStatus === "warning").length;
  const doneCount = items.filter(i => i.overallStatus === "done").length;

  return (
    <div className="space-y-4" dir="rtl">
      {/* ── Header ── */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-violet-500/10 flex items-center justify-center">
          <Activity className="w-5 h-5 text-violet-600 dark:text-violet-400" />
        </div>
        <div>
          <h2 className="text-lg font-bold">الرقابة الوقتية اللحظية</h2>
          <p className="text-xs text-muted-foreground">تتبع مؤشرات الأداء والاختناقات في الوقت الفعلي</p>
        </div>
      </div>

      {/* ── KPI Summary Cards ── */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800 p-3 text-center">
          <div className="text-2xl font-bold text-red-600 dark:text-red-400">{overdueCount}</div>
          <div className="text-xs text-red-600/80 dark:text-red-400/80 font-medium mt-0.5">متأخرة</div>
        </div>
        <div className="rounded-xl border bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800 p-3 text-center">
          <div className="text-2xl font-bold text-amber-600 dark:text-amber-400">{warningCount}</div>
          <div className="text-xs text-amber-600/80 dark:text-amber-400/80 font-medium mt-0.5">تحذيرات</div>
        </div>
        <div className="rounded-xl border bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800 p-3 text-center">
          <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{doneCount}</div>
          <div className="text-xs text-emerald-600/80 dark:text-emerald-400/80 font-medium mt-0.5">مكتملة</div>
        </div>
      </div>

      {/* ── Tab Switcher ── */}
      <div className="flex gap-2 p-1 bg-muted rounded-xl">
        <button
          onClick={() => setActiveTab("tickets")}
          className={cn(
            "flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-sm font-medium transition-all",
            activeTab === "tickets"
              ? "bg-background shadow-sm text-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <Ticket className="w-4 h-4" />
          البلاغات
          {ticketTimelines.length > 0 && (
            <Badge variant="secondary" className="text-[10px] h-4 px-1.5">{ticketTimelines.length}</Badge>
          )}
        </button>
        <button
          onClick={() => setActiveTab("po")}
          className={cn(
            "flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-sm font-medium transition-all",
            activeTab === "po"
              ? "bg-background shadow-sm text-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <ShoppingCart className="w-4 h-4" />
          طلبات الشراء
          {poTimelines.length > 0 && (
            <Badge variant="secondary" className="text-[10px] h-4 px-1.5">{poTimelines.length}</Badge>
          )}
        </button>
      </div>

      {/* ── Timeline List ── */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}><CardContent className="p-4"><Skeleton className="h-16 w-full" /></CardContent></Card>
          ))}
        </div>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center">
            <div className="w-14 h-14 rounded-2xl bg-muted flex items-center justify-center mx-auto mb-3">
              <Activity className="w-7 h-7 text-muted-foreground/40" />
            </div>
            <h3 className="font-semibold mb-1">لا توجد بيانات</h3>
            <p className="text-sm text-muted-foreground">لا توجد {activeTab === "tickets" ? "بلاغات" : "طلبات شراء"} في آخر 7 أيام</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {/* Sort: overdue first, then warning, then others */}
          {[...items]
            .sort((a, b) => {
              const order = { overdue: 0, warning: 1, ok: 2, done: 3, rejected: 4 };
              return (order[a.overallStatus as keyof typeof order] ?? 5) - (order[b.overallStatus as keyof typeof order] ?? 5);
            })
            .map((item) => (
              <TimelineCard
                key={item.id}
                item={item as TicketTimeline | POTimeline}
                type={activeTab === "tickets" ? "ticket" : "po"}
              />
            ))
          }
        </div>
      )}

      <p className="text-center text-xs text-muted-foreground">
        يتحدث كل 60 ثانية • آخر 7 أيام
      </p>
    </div>
  );
}
