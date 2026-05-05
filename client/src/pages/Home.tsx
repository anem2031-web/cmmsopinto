import { useAuth } from "@/_core/hooks/useAuth";
import { useTranslatedField } from "@/hooks/useTranslatedField";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";
import {
  ClipboardList, CheckCircle2, AlertTriangle, ShoppingCart,
  DollarSign, Package, Clock, Search, Microscope,
  DoorOpen, Wrench, TrendingUp, TrendingDown, Minus,
  Maximize2, Minimize2, X, ChevronRight, AlertCircle,
  Shield, Activity, CalendarCheck, CalendarClock, AlertOctagon,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useTranslation } from "@/contexts/LanguageContext";
import { useState, useCallback, useMemo } from "react";

// ─── Sparkline ────────────────────────────────────────────────────────────────
function Sparkline({ data, color = "#6366f1" }: { data: number[]; color?: string }) {
  if (!data || data.length < 2) return null;
  const max = Math.max(...data, 1);
  const min = Math.min(...data);
  const range = max - min || 1;
  const w = 80, h = 28, pad = 2;
  const pts = data.map((v, i) => {
    const x = pad + (i / (data.length - 1)) * (w - pad * 2);
    const y = h - pad - ((v - min) / range) * (h - pad * 2);
    return `${x},${y}`;
  }).join(" ");
  const last = data[data.length - 1];
  const prev = data[data.length - 2];
  const trend = last > prev ? "up" : last < prev ? "down" : "flat";
  return (
    <div className="flex items-end gap-1.5">
      <svg width={w} height={h} className="opacity-70">
        <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {trend === "up" && <TrendingUp className="h-3.5 w-3.5 text-emerald-500" />}
      {trend === "down" && <TrendingDown className="h-3.5 w-3.5 text-red-500" />}
      {trend === "flat" && <Minus className="h-3.5 w-3.5 text-muted-foreground" />}
    </div>
  );
}

// ─── Slide-over Panel ─────────────────────────────────────────────────────────
function SlideoverPanel({
  open, onClose, title, children,
}: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div className="flex-1 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      {/* Panel */}
      <div className="w-full max-w-md bg-background border-l shadow-2xl flex flex-col animate-in slide-in-from-right duration-300">
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h2 className="font-semibold text-base">{title}</h2>
          <button onClick={onClose} className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-muted transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  );
}

// ─── Ticket Row in Slideover ──────────────────────────────────────────────────
function TicketRow({ ticket, onNavigate }: { ticket: any; onNavigate: (id: number) => void }) {
  const { getField } = useTranslatedField();
  const priorityColors: Record<string, string> = {
    critical: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
    high: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
    medium: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
    low: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  };
  const hoursAgo = ticket.createdAt
    ? Math.floor((Date.now() - new Date(ticket.createdAt).getTime()) / 3600000)
    : null;
  const isSLABreach = hoursAgo !== null && hoursAgo > 48;
  const isSLAWarning = hoursAgo !== null && hoursAgo > 24 && !isSLABreach;

  return (
    <div
      className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer hover:bg-muted/50 transition-colors mb-2 ${isSLABreach ? "border-red-300 dark:border-red-800 bg-red-50/50 dark:bg-red-950/20" : isSLAWarning ? "border-amber-300 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20" : "border-border"}`}
      onClick={() => onNavigate(ticket.id)}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-mono text-muted-foreground">{ticket.ticketNumber}</span>
          {ticket.priority && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${priorityColors[ticket.priority] || ""}`}>
              {ticket.priority}
            </span>
          )}
          {isSLABreach && <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 font-medium">SLA ⚠</span>}
        </div>
        <p className="text-sm font-medium truncate">{getField(ticket, "title")}</p>
        {hoursAgo !== null && (
          <p className={`text-[11px] mt-0.5 ${isSLABreach ? "text-red-500" : isSLAWarning ? "text-amber-500" : "text-muted-foreground"}`}>
            منذ {hoursAgo} ساعة
          </p>
        )}
      </div>
      <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
    </div>
  );
}

// ─── Smart Card ───────────────────────────────────────────────────────────────
type SmartCard = {
  id: string;
  title: string;
  value: number | string;
  icon: any;
  color: string;
  borderColor?: string;
  sparkColor?: string;
  trend?: number[];
  urgent?: boolean;
  slaBreached?: boolean;
  onClick?: () => void;
  onDrilldown?: () => void;
  isLarge?: boolean;
};

function DashboardCard({ card, monitorMode }: { card: SmartCard; monitorMode: boolean }) {
  const borderClass = card.slaBreached
    ? "border-red-400 dark:border-red-600 shadow-red-100 dark:shadow-red-950/30"
    : card.urgent
    ? "border-amber-400 dark:border-amber-600"
    : "border-border";

  return (
    <Card
      className={`group relative overflow-hidden cursor-pointer transition-all duration-200 hover:shadow-md border ${borderClass} ${monitorMode ? "bg-card/80" : ""}`}
      onClick={card.onDrilldown || card.onClick}
    >
      {/* SLA breach top bar */}
      {card.slaBreached && (
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-red-500 to-red-400" />
      )}
      {card.urgent && !card.slaBreached && (
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-amber-500 to-amber-400" />
      )}

      <CardContent className={`${monitorMode ? "p-6" : "p-5"}`}>
        <div className="flex items-start justify-between mb-2">
          <span className={`font-medium text-muted-foreground leading-tight ${monitorMode ? "text-sm" : "text-xs"}`}>
            {card.title}
          </span>
          <div className="flex items-center gap-1.5 shrink-0">
            {card.urgent && !card.slaBreached && (
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-ping" />
            )}
            {card.slaBreached && (
              <AlertCircle className="h-3.5 w-3.5 text-red-500 animate-pulse" />
            )}
            <div className={`rounded-xl flex items-center justify-center ${card.color} transition-transform group-hover:scale-105 ${monitorMode ? "w-12 h-12" : "w-9 h-9"}`}>
              <card.icon className={monitorMode ? "w-6 h-6" : "w-4 w-4"} />
            </div>
          </div>
        </div>

        <p className={`font-bold tracking-tight ${monitorMode ? "text-4xl" : "text-2xl"}`}>{card.value}</p>

        {/* Sparkline */}
        {card.trend && card.trend.length > 1 && (
          <div className="mt-2">
            <Sparkline data={card.trend} color={card.sparkColor || "#6366f1"} />
          </div>
        )}

        {card.slaBreached && (
          <p className="text-[11px] text-red-500 dark:text-red-400 mt-1 font-medium">تجاوز SLA 48 ساعة</p>
        )}
        {card.urgent && !card.slaBreached && (
          <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1 font-medium">⚠ يحتاج مراجعة فورية</p>
        )}
      </CardContent>
    </Card>
  );
}

// ─── PM Monthly Summary Card ──────────────────────────────────────────────────
function PMSummaryCard({ onNavigate }: { onNavigate: () => void }) {
  const { data: pm, isLoading } = trpc.dashboard.pmMonthlySummary.useQuery();

  // اسم الشهر الحالي
  const now = new Date();
  const monthName = now.toLocaleDateString("ar-SA", { month: "long", year: "numeric" });

  if (isLoading) {
    return (
      <Card className="border-border">
        <CardContent className="p-5">
          <Skeleton className="h-4 w-40 mb-4" />
          <div className="grid grid-cols-3 gap-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="space-y-1.5">
                <Skeleton className="h-7 w-10" />
                <Skeleton className="h-3 w-16" />
              </div>
            ))}
          </div>
          <Skeleton className="h-2 w-full mt-4 rounded-full" />
        </CardContent>
      </Card>
    );
  }

  const completionRate = pm?.completionRate ?? 0;
  const rateColor =
    completionRate >= 80 ? "bg-emerald-500"
    : completionRate >= 50 ? "bg-amber-500"
    : "bg-red-500";
  const rateTextColor =
    completionRate >= 80 ? "text-emerald-600 dark:text-emerald-400"
    : completionRate >= 50 ? "text-amber-600 dark:text-amber-400"
    : "text-red-600 dark:text-red-400";

  return (
    <Card
      className="border-teal-200 dark:border-teal-800/50 hover:shadow-md hover:border-teal-400/50 transition-all duration-200 cursor-pointer group overflow-hidden relative"
      onClick={onNavigate}
    >
      {/* Top accent bar */}
      <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-teal-500 to-cyan-400" />

      <CardContent className="p-5">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-teal-500/10 flex items-center justify-center">
              <CalendarCheck className="w-4 h-4 text-teal-600 dark:text-teal-400" />
            </div>
            <div>
              <p className="text-xs font-semibold text-teal-700 dark:text-teal-300">الصيانة الوقائية</p>
              <p className="text-[10px] text-muted-foreground">{monthName}</p>
            </div>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-teal-500 transition-colors" />
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-4 gap-2 mb-4">
          {/* الخطط النشطة */}
          <div className="text-center">
            <p className="text-xl font-bold text-foreground">{pm?.activePlans ?? 0}</p>
            <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">خطة نشطة</p>
          </div>
          {/* المكتملة */}
          <div className="text-center">
            <p className="text-xl font-bold text-emerald-600 dark:text-emerald-400">{pm?.completedThisMonth ?? 0}</p>
            <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">مكتمل</p>
          </div>
          {/* المعلقة */}
          <div className="text-center">
            <p className="text-xl font-bold text-amber-600 dark:text-amber-400">{pm?.pendingThisMonth ?? 0}</p>
            <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">معلق</p>
          </div>
          {/* المتأخرة */}
          <div className="text-center">
            <p className={`text-xl font-bold ${(pm?.overdueCount ?? 0) > 0 ? "text-red-600 dark:text-red-400" : "text-muted-foreground"}`}>
              {pm?.overdueCount ?? 0}
            </p>
            <div className="flex items-center justify-center gap-0.5 mt-0.5">
              {(pm?.overdueCount ?? 0) > 0 && <AlertOctagon className="w-2.5 h-2.5 text-red-500" />}
              <p className="text-[10px] text-muted-foreground leading-tight">متأخر</p>
            </div>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground">نسبة الإنجاز هذا الشهر</span>
            <span className={`text-[11px] font-bold ${rateTextColor}`}>{completionRate}%</span>
          </div>
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-700 ${rateColor}`}
              style={{ width: `${completionRate}%` }}
            />
          </div>
          {pm?.totalWorkOrders === 0 && (
            <p className="text-[10px] text-muted-foreground text-center">لا توجد أوامر عمل مجدولة هذا الشهر</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function Home() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const { data: stats, isLoading } = trpc.dashboard.stats.useQuery();
  const { t, language } = useTranslation();
  const [monitorMode, setMonitorMode] = useState(false);
  const [slideover, setSlideover] = useState<{ open: boolean; title: string; filter: any }>({
    open: false, title: "", filter: {},
  });

  const role = user?.role || "user";
  // ── Redirect non-admin/owner roles away from dashboard ──
  if (role && role !== "admin" && role !== "owner") {
    const roleRedirect: Record<string, string> = {
      maintenance_manager: "/tickets",
      supervisor: "/tickets",
      technician: "/tickets",
      accountant: "/purchase-orders",
      warehouse: "/inventory",
      delegate: "/purchase-orders",
      procurement_officer: "/purchase-orders",
      senior_management: "/reports",
      gate_security: "/gate-security",
      operator: "/tickets",
    };
    const target = roleRedirect[role] || "/tickets";
    setLocation(target);
    return null;
  }

  // Fetch tickets for slideover
  const { data: slideoverTickets } = trpc.tickets.list.useQuery(slideover.filter, {
    enabled: slideover.open,
  });

  const openSlideover = useCallback((title: string, filter: any) => {
    setSlideover({ open: true, title, filter });
  }, []);

  // ── Build role-based cards ──
  const cards = useMemo((): SmartCard[] => {
    const trend = stats?.trend7 || [];
    
    const r = role as string;

    const isAdminOrOwner = ["admin", "owner", "senior_management"].includes(r);
    const isManager = r === "maintenance_manager";
    const isSupervisor = r === "supervisor";
    const isTechnician = ["technician", "operator"].includes(r);
    const isGate = r === "gate_security";
    const isAccountant = r === "accountant";

    if (isGate) {
      return [
        {
          id: "gate_out",
          title: "أصول خارج للإصلاح",
          value: stats?.openTickets ?? 0,
          icon: DoorOpen,
          color: "text-orange-600 bg-orange-50 dark:bg-orange-950/30",
          sparkColor: "#f97316",
          trend,
          onClick: () => setLocation("/gate-security"),
          onDrilldown: () => openSlideover("أصول خارج للإصلاح", { status: "out_for_repair" }),
        },
        {
          id: "gate_pending",
          title: "بانتظار موافقة البوابة",
          value: stats?.pendingTriage ?? 0,
          icon: Shield,
          color: "text-blue-600 bg-blue-50 dark:bg-blue-950/30",
          onClick: () => setLocation("/gate-security"),
        },
      ];
    }

    if (isTechnician) {
      return [
        {
          id: "my_tickets",
          title: "بلاغاتي النشطة",
          value: stats?.openTickets ?? 0,
          icon: ClipboardList,
          color: "text-blue-600 bg-blue-50 dark:bg-blue-950/30",
          sparkColor: "#3b82f6",
          trend,
          onDrilldown: () => openSlideover("بلاغاتي النشطة", { status: "assigned" }),
        },
        {
          id: "closed_today",
          title: t.dashboard.closedToday,
          value: stats?.closedToday ?? 0,
          icon: CheckCircle2,
          color: "text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30",
          onClick: () => setLocation("/tickets?status=closed"),
        },
        {
          id: "in_progress",
          title: "قيد التنفيذ",
          value: stats?.underInspection ?? 0,
          icon: Wrench,
          color: "text-indigo-600 bg-indigo-50 dark:bg-indigo-950/30",
          onClick: () => setLocation("/tickets?status=in_progress"),
        },
      ];
    }

    if (isSupervisor) {
      return [
        {
          id: "pending_triage",
          title: "بانتظار الفرز",
          value: stats?.pendingTriage ?? 0,
          icon: Search,
          color: "text-amber-600 bg-amber-50 dark:bg-amber-950/30",
          sparkColor: "#f59e0b",
          trend,
          urgent: (stats?.pendingTriage ?? 0) > 0,
          onDrilldown: () => openSlideover("بانتظار الفرز", { status: "pending_triage" }),
        },
        {
          id: "under_inspection",
          title: "قيد الفحص",
          value: stats?.underInspection ?? 0,
          icon: Microscope,
          color: "text-blue-600 bg-blue-50 dark:bg-blue-950/30",
          onDrilldown: () => openSlideover("قيد الفحص", { status: "under_inspection" }),
        },
        {
          id: "critical",
          title: t.dashboard.criticalTickets,
          value: stats?.criticalTickets ?? 0,
          icon: AlertTriangle,
          color: "text-red-600 bg-red-50 dark:bg-red-950/30",
          slaBreached: (stats?.slaBreaches ?? 0) > 0,
          onDrilldown: () => openSlideover(t.dashboard.criticalTickets, { priority: "critical" }),
        },
        {
          id: "open",
          title: t.dashboard.openTickets,
          value: stats?.openTickets ?? 0,
          icon: ClipboardList,
          color: "text-indigo-600 bg-indigo-50 dark:bg-indigo-950/30",
          onClick: () => setLocation("/tickets"),
        },
      ];
    }

    if (isManager) {
      return [
        {
          id: "sla",
          title: "تجاوزات SLA (> 48 ساعة)",
          value: stats?.slaBreaches ?? 0,
          icon: AlertCircle,
          color: "text-red-600 bg-red-50 dark:bg-red-950/30",
          sparkColor: "#ef4444",
          trend,
          slaBreached: (stats?.slaBreaches ?? 0) > 0,
          onDrilldown: () => openSlideover("تجاوزات SLA", { status: "open" }),
        },
        {
          id: "pending_triage",
          title: "بانتظار الفرز",
          value: stats?.pendingTriage ?? 0,
          icon: Search,
          color: "text-amber-600 bg-amber-50 dark:bg-amber-950/30",
          urgent: (stats?.pendingTriage ?? 0) > 0,
          onDrilldown: () => openSlideover("بانتظار الفرز", { status: "pending_triage" }),
        },
        {
          id: "under_inspection",
          title: "قيد الفحص",
          value: stats?.underInspection ?? 0,
          icon: Microscope,
          color: "text-blue-600 bg-blue-50 dark:bg-blue-950/30",
          onDrilldown: () => openSlideover("قيد الفحص", { status: "under_inspection" }),
        },
        {
          id: "pending_po",
          title: t.dashboard.pendingApprovals,
          value: stats?.pendingApprovals ?? 0,
          icon: Clock,
          color: "text-orange-600 bg-orange-50 dark:bg-orange-950/30",
          onClick: () => setLocation("/purchase-orders?status=pending"),
        },
      ];
    }

    if (isAccountant) {
      return [
        {
          id: "pending_po",
          title: t.dashboard.pendingApprovals,
          value: stats?.pendingApprovals ?? 0,
          icon: Clock,
          color: "text-amber-600 bg-amber-50 dark:bg-amber-950/30",
          onClick: () => setLocation("/purchase-orders?status=pending"),
        },
        {
          id: "purchased",
          title: t.dashboard.purchasedItems,
          value: stats?.purchasedItems ?? 0,
          icon: ShoppingCart,
          color: "text-teal-600 bg-teal-50 dark:bg-teal-950/30",
          onClick: () => setLocation("/purchase-orders"),
        },
      ];
    }

    // Admin / Owner / Senior Management — full view
    return [
      {
        id: "sla",
        title: "تجاوزات SLA (> 48 ساعة)",
        value: stats?.slaBreaches ?? 0,
        icon: Activity,
        color: "text-red-600 bg-red-50 dark:bg-red-950/30",
        sparkColor: "#ef4444",
        trend,
        slaBreached: (stats?.slaBreaches ?? 0) > 0,
        onDrilldown: () => openSlideover("تجاوزات SLA", { status: "open" }),
      },
      {
        id: "open",
        title: t.dashboard.openTickets,
        value: stats?.openTickets ?? 0,
        icon: ClipboardList,
        color: "text-blue-600 bg-blue-50 dark:bg-blue-950/30",
        onDrilldown: () => openSlideover(t.dashboard.openTickets, { status: "open" }),
      },
      {
        id: "critical",
        title: t.dashboard.criticalTickets,
        value: stats?.criticalTickets ?? 0,
        icon: AlertTriangle,
        color: "text-red-600 bg-red-50 dark:bg-red-950/30",
        onDrilldown: () => openSlideover(t.dashboard.criticalTickets, { priority: "critical" }),
      },
      {
        id: "closed_today",
        title: t.dashboard.closedToday,
        value: stats?.closedToday ?? 0,
        icon: CheckCircle2,
        color: "text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30",
        onClick: () => setLocation("/tickets?status=closed"),
      },
      {
        id: "pending_triage",
        title: "بانتظار الفرز",
        value: stats?.pendingTriage ?? 0,
        icon: Search,
        color: "text-amber-600 bg-amber-50 dark:bg-amber-950/30",
        urgent: (stats?.pendingTriage ?? 0) > 0,
        onDrilldown: () => openSlideover("بانتظار الفرز", { status: "pending_triage" }),
      },
      {
        id: "under_inspection",
        title: "قيد الفحص",
        value: stats?.underInspection ?? 0,
        icon: Microscope,
        color: "text-indigo-600 bg-indigo-50 dark:bg-indigo-950/30",
        onDrilldown: () => openSlideover("قيد الفحص", { status: "under_inspection" }),
      },
      {
        id: "budget",
        title: t.dashboard.totalCost,
        value: stats?.totalMaintenanceCost
          ? `${Number(stats.totalMaintenanceCost).toLocaleString(language === "ar" ? "ar-SA" : "en-US")} ر.س`
          : "0 ر.س",
        icon: DollarSign,
        color: "text-violet-600 bg-violet-50 dark:bg-violet-950/30",
        sparkColor: "#8b5cf6",
        onClick: () => setLocation("/reports/cost"),
        isLarge: true,
      },
      {
        id: "pending_po",
        title: t.dashboard.pendingApprovals,
        value: stats?.pendingApprovals ?? 0,
        icon: Clock,
        color: "text-orange-600 bg-orange-50 dark:bg-orange-950/30",
        onClick: () => setLocation("/purchase-orders?status=pending"),
      },
      {
        id: "pending_purchase",
        title: t.dashboard.pendingPurchase,
        value: stats?.pendingPurchaseItems ?? 0,
        icon: Package,
        color: "text-teal-600 bg-teal-50 dark:bg-teal-950/30",
        onClick: () => setLocation("/purchase-orders"),
      },
    ];
  }, [stats, role, t, language, setLocation, openSlideover]);

  // Roles that should see PM summary card
  const showPMSummary = ["admin", "owner", "senior_management", "maintenance_manager", "supervisor"].includes(role);

  const greeting = language === "en"
    ? `Welcome, ${user?.name || "User"}`
    : language === "ur"
    ? `خوش آمدید، ${user?.name || "صارف"}`
    : `مرحباً، ${user?.name || "المستخدم"}`;

  return (
    <>
      {/* Monitor Mode Overlay */}
      {monitorMode && (
        <div className="fixed inset-0 z-40 bg-background/95 backdrop-blur-sm overflow-auto p-8">
          <div className="max-w-7xl mx-auto">
            <div className="flex items-center justify-between mb-8">
              <div>
                <h1 className="text-3xl font-bold tracking-tight">{greeting}</h1>
                <p className="text-muted-foreground mt-1">{(t.roles as any)[role] || role} — {t.dashboard.title}</p>
              </div>
              <Button variant="outline" size="sm" onClick={() => setMonitorMode(false)} className="gap-2">
                <Minimize2 className="h-4 w-4" />
                خروج من وضع المراقبة
              </Button>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-6">
              {cards.map(card => (
                <DashboardCard key={card.id} card={card} monitorMode={true} />
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{greeting}</h1>
            <p className="text-muted-foreground text-sm mt-1">
              {(t.roles as any)[role] || role} — {t.dashboard.title}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setMonitorMode(true)}
            className="gap-2 hidden sm:flex"
          >
            <Maximize2 className="h-4 w-4" />
            وضع المراقبة
          </Button>
        </div>

        {/* Cards Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {isLoading
            ? Array.from({ length: 6 }).map((_, i) => (
                <Card key={i} className="p-5">
                  <Skeleton className="h-3.5 w-24 mb-3" />
                  <Skeleton className="h-8 w-16 mb-2" />
                  <Skeleton className="h-7 w-20" />
                </Card>
              ))
            : cards.map(card => (
                <div key={card.id} className={card.isLarge ? "sm:col-span-2 lg:col-span-1" : ""}>
                  <DashboardCard card={card} monitorMode={false} />
                </div>
              ))}
        </div>

        {/* PM Monthly Summary — for managers, supervisors, admins */}
        {showPMSummary && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <CalendarClock className="h-4 w-4 text-teal-600 dark:text-teal-400" />
              <h2 className="text-sm font-semibold text-foreground">ملخص الصيانة الوقائية</h2>
            </div>
            <PMSummaryCard onNavigate={() => setLocation("/preventive-maintenance")} />
          </div>
        )}


      </div>

      {/* Slide-over Panel */}
      <SlideoverPanel
        open={slideover.open}
        onClose={() => setSlideover(s => ({ ...s, open: false }))}
        title={slideover.title}
      >
        {slideoverTickets && slideoverTickets.length > 0 ? (
          <>
            <div className="flex items-center justify-between mb-3">
              <Badge variant="secondary">{slideoverTickets.length} بلاغ</Badge>
              <Button
                size="sm"
                variant="outline"
                onClick={() => { setLocation("/tickets"); setSlideover(s => ({ ...s, open: false })); }}
                className="text-xs"
              >
                عرض الكل
              </Button>
            </div>
            {slideoverTickets.slice(0, 20).map((ticket: any) => (
              <TicketRow
                key={ticket.id}
                ticket={ticket}
                onNavigate={(id) => {
                  setLocation(`/tickets/${id}`);
                  setSlideover(s => ({ ...s, open: false }));
                }}
              />
            ))}
          </>
        ) : (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <CheckCircle2 className="h-12 w-12 mb-3 opacity-30" />
            <p className="text-sm">لا توجد بلاغات في هذه الفئة</p>
          </div>
        )}
      </SlideoverPanel>
    </>
  );
}
