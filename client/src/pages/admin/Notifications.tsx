import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useTranslation, useLanguage } from "@/contexts/LanguageContext";
import { useLocation } from "wouter";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  Bell, BellOff, CheckCheck, AlertTriangle, Info,
  CheckCircle2, XCircle, Clock, Ticket, ShoppingCart,
  Trash2, RefreshCw, Smartphone, Activity
} from "lucide-react";
import KpiTimeline from "@/components/dashboard/KpiTimeline";

// ─── Types ───────────────────────────────────────────────────────────────────
type NotifFilter = "all" | "unread" | "critical" | "warning" | "success" | "info";

// ─── Helpers ─────────────────────────────────────────────────────────────────
function getTypeIcon(type: string) {
  switch (type) {
    case "critical":
    case "error":    return <XCircle className="w-4 h-4 text-red-500" />;
    case "warning":  return <AlertTriangle className="w-4 h-4 text-orange-500" />;
    case "success":  return <CheckCircle2 className="w-4 h-4 text-green-500" />;
    default:         return <Info className="w-4 h-4 text-blue-500" />;
  }
}

function getTypeBg(type: string, isRead: boolean) {
  if (isRead) return "bg-card border-border";
  switch (type) {
    case "critical":
    case "error":    return "bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-800";
    case "warning":  return "bg-orange-50 border-orange-200 dark:bg-orange-950/30 dark:border-orange-800";
    case "success":  return "bg-green-50 border-green-200 dark:bg-green-950/30 dark:border-green-800";
    default:         return "bg-blue-50 border-blue-200 dark:bg-blue-950/30 dark:border-blue-800";
  }
}

function getTypeLabel(type: string) {
  switch (type) {
    case "critical": return "حرجة";
    case "error":    return "خطأ";
    case "warning":  return "تنبيه";
    case "success":  return "إنجاز";
    default:         return "معلومة";
  }
}

function getTypeLabelClass(type: string) {
  switch (type) {
    case "critical":
    case "error":    return "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300";
    case "warning":  return "bg-orange-100 text-orange-700 dark:bg-orange-900/50 dark:text-orange-300";
    case "success":  return "bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300";
    default:         return "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300";
  }
}

function getIconBg(type: string) {
  switch (type) {
    case "critical":
    case "error":    return "bg-red-100 dark:bg-red-900/40";
    case "warning":  return "bg-orange-100 dark:bg-orange-900/40";
    case "success":  return "bg-green-100 dark:bg-green-900/40";
    default:         return "bg-blue-100 dark:bg-blue-900/40";
  }
}

// ─── Filter Card Config ───────────────────────────────────────────────────────
const FILTER_CARDS: {
  id: NotifFilter;
  label: string;
  icon: React.ReactNode;
  activeClass: string;
  badgeClass: string;
  iconClass: string;
}[] = [
  {
    id: "all",
    label: "الكل",
    icon: <Bell className="w-5 h-5" />,
    activeClass: "bg-slate-800 text-white border-transparent dark:bg-slate-100 dark:text-slate-900",
    badgeClass: "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200",
    iconClass: "text-slate-600 dark:text-slate-300",
  },
  {
    id: "unread",
    label: "غير مقروءة",
    icon: <BellOff className="w-5 h-5" />,
    activeClass: "bg-yellow-500 text-white border-transparent",
    badgeClass: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/50 dark:text-yellow-300",
    iconClass: "text-yellow-600 dark:text-yellow-400",
  },
  {
    id: "critical",
    label: "حرجة",
    icon: <XCircle className="w-5 h-5" />,
    activeClass: "bg-red-600 text-white border-transparent",
    badgeClass: "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300",
    iconClass: "text-red-600 dark:text-red-400",
  },
  {
    id: "warning",
    label: "تنبيهات",
    icon: <AlertTriangle className="w-5 h-5" />,
    activeClass: "bg-orange-500 text-white border-transparent",
    badgeClass: "bg-orange-100 text-orange-700 dark:bg-orange-900/50 dark:text-orange-300",
    iconClass: "text-orange-600 dark:text-orange-400",
  },
  {
    id: "success",
    label: "إنجازات",
    icon: <CheckCircle2 className="w-5 h-5" />,
    activeClass: "bg-green-600 text-white border-transparent",
    badgeClass: "bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300",
    iconClass: "text-green-600 dark:text-green-400",
  },
  {
    id: "info",
    label: "معلومات",
    icon: <Info className="w-5 h-5" />,
    activeClass: "bg-blue-600 text-white border-transparent",
    badgeClass: "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300",
    iconClass: "text-blue-600 dark:text-blue-400",
  },
];

// ─── Main Component ───────────────────────────────────────────────────────────
export default function Notifications() {
  const { t: tr } = useLanguage();
  const { t, language } = useTranslation();
  const [, setLocation] = useLocation();
  const locale = language === "ar" ? "ar-SA" : language === "ur" ? "ur-PK" : "en-US";
  const [activeFilter, setActiveFilter] = useState<NotifFilter>("all");

  const { data: notifications = [], isLoading, refetch } = trpc.notifications.list.useQuery(undefined, {
    refetchInterval: 30000,
  });

  const markReadMut = trpc.notifications.markRead.useMutation({ onSuccess: () => refetch() });
  const markAllReadMut = trpc.notifications.markAllRead.useMutation({
    onSuccess: () => { toast.success("تم تحديد الكل كمقروء"); refetch(); }
  });

  const { isSupported, permission, isSubscribed, isLoading: pushLoading, subscribe, unsubscribe } = usePushNotifications();

  // ─── Counts ──────────────────────────────────────────────────────────────
  const counts = useMemo(() => ({
    all: notifications.length,
    unread: notifications.filter(n => !n.isRead).length,
    critical: notifications.filter(n => n.type === "critical" || n.type === "error").length,
    warning: notifications.filter(n => n.type === "warning").length,
    success: notifications.filter(n => n.type === "success").length,
    info: notifications.filter(n => n.type === "info").length,
  }), [notifications]);

  // ─── Filtered ────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    switch (activeFilter) {
      case "unread":   return notifications.filter(n => !n.isRead);
      case "critical": return notifications.filter(n => n.type === "critical" || n.type === "error");
      case "warning":  return notifications.filter(n => n.type === "warning");
      case "success":  return notifications.filter(n => n.type === "success");
      case "info":     return notifications.filter(n => n.type === "info");
      default:         return notifications;
    }
  }, [notifications, activeFilter]);

  const handlePushToggle = async () => {
    if (isSubscribed) {
      await unsubscribe();
      toast.success("تم إيقاف إشعارات الجوال");
    } else {
      const ok = await subscribe();
      if (ok) toast.success("تم تفعيل إشعارات الجوال بنجاح!");
      else if (permission === "denied") toast.error("تم رفض الإذن. يرجى السماح بالإشعارات من إعدادات المتصفح.");
      else toast.error("فشل تفعيل الإشعارات");
    }
  };

  const [mainTab, setMainTab] = useState<"notifications" | "kpi">("notifications");

  return (
    <div className="space-y-6" dir="rtl">
      {/* ── Main Tab Switcher ── */}
      <div className="flex gap-2 p-1 bg-muted rounded-xl">
        <button
          onClick={() => setMainTab("notifications")}
          className={cn(
            "flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg text-sm font-semibold transition-all",
            mainTab === "notifications"
              ? "bg-background shadow-sm text-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <Bell className="w-4 h-4" />
          مركز الإشعارات
        </button>
        <button
          onClick={() => setMainTab("kpi")}
          className={cn(
            "flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg text-sm font-semibold transition-all",
            mainTab === "kpi"
              ? "bg-background shadow-sm text-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <Activity className="w-4 h-4" />
          الرقابة الوقتية
        </button>
      </div>

      {/* ── KPI Tab ── */}
      {mainTab === "kpi" && <KpiTimeline />}

      {/* ── Notifications Tab ── */}
      {mainTab === "notifications" && <>
      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <Bell className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">{t.notifications.title}</h1>
            <p className="text-sm text-muted-foreground">
              {counts.unread > 0
                ? `${counts.unread} ${t.notifications.unread}`
                : t.notifications.noNotifications}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {isSupported && (
            <Button
              variant={isSubscribed ? "default" : "outline"}
              size="sm"
              onClick={handlePushToggle}
              disabled={pushLoading || permission === "denied"}
              className="gap-2"
              title={permission === "denied" ? "الإشعارات محظورة في المتصفح" : undefined}
            >
              {isSubscribed
                ? <><BellOff className="w-4 h-4" /> إيقاف إشعارات الجوال</>
                : <><Smartphone className="w-4 h-4" /> تفعيل إشعارات الجوال</>
              }
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-2">
            <RefreshCw className="w-4 h-4" />
            تحديث
          </Button>
          {counts.unread > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => markAllReadMut.mutate()}
              disabled={markAllReadMut.isPending}
              className="gap-2"
            >
              <CheckCheck className="w-4 h-4" />
              {t.notifications.markAllRead}
            </Button>
          )}
        </div>
      </div>

      {/* ── Push banners ── */}
      {isSupported && !isSubscribed && permission !== "denied" && (
        <div className="flex items-center gap-3 p-3 rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 text-sm text-blue-700 dark:text-blue-300">
          <Smartphone className="w-4 h-4 shrink-0" />
          <span>فعّل إشعارات الجوال لتصلك التنبيهات حتى عند إغلاق التطبيق.</span>
          <Button size="sm" variant="outline" className="mr-auto text-xs h-7 border-blue-300 text-blue-700 hover:bg-blue-100" onClick={handlePushToggle} disabled={pushLoading}>
            تفعيل الآن
          </Button>
        </div>
      )}
      {permission === "denied" && (
        <div className="flex items-center gap-3 p-3 rounded-lg bg-orange-50 dark:bg-orange-950/30 border border-orange-200 dark:border-orange-800 text-sm text-orange-700 dark:text-orange-300">
          <BellOff className="w-4 h-4 shrink-0" />
          <span>إشعارات الجوال محظورة. اذهب إلى إعدادات المتصفح وأعطِ الإذن لهذا الموقع.</span>
        </div>
      )}

      {/* ── Filter Cards ── */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
        {FILTER_CARDS.map((card) => {
          const isActive = activeFilter === card.id;
          const count = counts[card.id];
          return (
            <button
              key={card.id}
              onClick={() => setActiveFilter(card.id)}
              className={cn(
                "relative flex flex-col items-center justify-center gap-2 p-3 rounded-xl border-2 transition-all duration-200",
                "hover:scale-105 hover:shadow-md active:scale-95 cursor-pointer select-none",
                isActive
                  ? card.activeClass
                  : cn("bg-card border-border", card.iconClass)
              )}
            >
              {/* Icon container */}
              <div className={cn(
                "w-9 h-9 rounded-lg flex items-center justify-center transition-colors",
                isActive ? "bg-white/20" : "bg-muted"
              )}>
                {card.icon}
              </div>

              {/* Label */}
              <span className="text-xs font-semibold leading-tight text-center">
                {card.label}
              </span>

              {/* Count badge */}
              {count > 0 && (
                <span className={cn(
                  "absolute -top-2 -left-2 min-w-[22px] h-[22px] rounded-full text-xs font-bold flex items-center justify-center px-1 shadow-sm",
                  isActive ? "bg-white/90 text-slate-800" : card.badgeClass
                )}>
                  {count > 99 ? "99+" : count}
                </span>
              )}

              {/* Active underline */}
              {isActive && (
                <span className="absolute bottom-1.5 left-1/2 -translate-x-1/2 w-4 h-0.5 bg-white/60 rounded-full" />
              )}
            </button>
          );
        })}
      </div>

      {/* ── Notifications List ── */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Card key={i}><CardContent className="p-4"><Skeleton className="h-14 w-full" /></CardContent></Card>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center mx-auto mb-4">
              <Bell className="w-8 h-8 text-muted-foreground/40" />
            </div>
            <h3 className="font-semibold text-lg mb-1">{t.notifications.noNotifications}</h3>
            {activeFilter !== "all" && (
              <p className="text-sm text-muted-foreground mt-1">
                لا توجد إشعارات في فئة "{FILTER_CARDS.find(c => c.id === activeFilter)?.label}"
              </p>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((n) => (
            <div
              key={n.id}
              className={cn(
                "group relative flex items-start gap-3 p-4 rounded-xl border transition-all duration-200",
                "hover:shadow-md hover:-translate-y-0.5 cursor-pointer",
                getTypeBg(n.type || "info", n.isRead),
                !n.isRead && "ring-2 ring-primary/20"
              )}
              onClick={() => { if (!n.isRead) markReadMut.mutate({ id: n.id }); }}
            >
              {/* Unread dot */}
              {!n.isRead && (
                <span className="absolute top-3 right-3 w-2 h-2 rounded-full bg-primary animate-pulse" />
              )}

              {/* Icon */}
              <div className={cn(
                "mt-0.5 w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0",
                getIconBg(n.type || "info")
              )}>
                {n.relatedTicketId
                  ? <Ticket className="w-4 h-4 opacity-70" />
                  : n.relatedPOId
                    ? <ShoppingCart className="w-4 h-4 opacity-70" />
                    : getTypeIcon(n.type || "info")
                }
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0 pr-4">
                <div className="flex items-start justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className={cn(
                      "text-sm text-foreground leading-tight",
                      !n.isRead ? "font-bold" : "font-medium"
                    )}>
                      {n.title}
                    </p>
                    <span className={cn(
                      "text-[10px] font-semibold px-2 py-0.5 rounded-full",
                      getTypeLabelClass(n.type || "info")
                    )}>
                      {getTypeLabel(n.type || "info")}
                    </span>
                  </div>
                  <span className="flex items-center gap-1 text-xs text-muted-foreground whitespace-nowrap">
                    <Clock className="w-3 h-3" />
                    {new Date(n.createdAt).toLocaleString(locale)}
                  </span>
                </div>

                <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
                  {n.message}
                </p>

                {/* Related links */}
                {(n.relatedTicketId || n.relatedPOId) && (
                  <div className="flex gap-3 mt-2">
                    {n.relatedTicketId && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!n.isRead) markReadMut.mutate({ id: n.id });
                          setLocation(`/tickets/${n.relatedTicketId}`);
                        }}
                        className="text-xs text-primary hover:underline flex items-center gap-1 font-medium"
                      >
                        <Ticket className="w-3 h-3" />
                        عرض البلاغ ←
                      </button>
                    )}
                    {n.relatedPOId && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!n.isRead) markReadMut.mutate({ id: n.id });
                          setLocation(`/purchase-orders/${n.relatedPOId}`);
                        }}
                        className="text-xs text-primary hover:underline flex items-center gap-1 font-medium"
                      >
                        <ShoppingCart className="w-3 h-3" />
                        عرض طلب الشراء ←
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Action buttons (visible on hover) */}
              <div className="flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                {!n.isRead && (
                  <button
                    onClick={(e) => { e.stopPropagation(); markReadMut.mutate({ id: n.id }); }}
                    className="w-7 h-7 rounded-lg bg-primary/10 hover:bg-primary/20 flex items-center justify-center transition-colors"
                    title="تحديد كمقروء"
                  >
                    <CheckCheck className="w-3.5 h-3.5 text-primary" />
                  </button>
                )}

              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Footer ── */}
      {filtered.length > 0 && (
        <p className="text-center text-xs text-muted-foreground py-2">
          عرض {filtered.length} من {notifications.length} إشعار
        </p>
      )}
      </> }
    </div>
  );
}
