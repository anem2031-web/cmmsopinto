import { useAuth } from "@/_core/hooks/useAuth";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import Login from "@/pages/auth/Login";
import { useIsMobile } from "@/hooks/useMobile";
import {
  LayoutDashboard, LogOut, PanelLeft, ClipboardList, ShoppingCart,
  Package, BarChart3, Users, Bell, MapPin, Wrench, Shield,
  Brain, ShoppingBag, Truck, Languages, Database,
  HardDrive, CalendarClock, ScanSearch, DoorOpen, Nfc, Tag,
  ChevronDown, Search, X, Building2, UserCog, Download, Smartphone, DollarSign,
  RotateCcw, BookOpen, Lightbulb, FileText
,
  HardHat, FolderKanban} from "lucide-react";
import { CSSProperties, useEffect, useRef, useState, useMemo, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { PasswordStrengthIndicator, isPasswordValid } from "@/components/auth/PasswordStrengthIndicator";
import { KeyRound, Eye, EyeOff } from "lucide-react";
import { useLocation } from "wouter";
import { DashboardLayoutSkeleton } from '@/components/layout/DashboardLayoutSkeleton';
import { trpc } from "@/lib/trpc";
import { useTranslation } from "@/contexts/LanguageContext";
import LanguageSwitcher from "@/components/common/LanguageSwitcher";
import { usePushNotifications } from "@/hooks/usePushNotifications";

// ─── Types ────────────────────────────────────────────────────────────────────
type MenuItemDef = {
  icon: any;
  labelKey: string;
  path: string;
  roles?: string[];
};

type NavSection = {
  id: string;
  labelKey: string;
  icon: any;
  items: MenuItemDef[];
  /** roles that can see this entire section; undefined = all */
  roles?: string[];
};

// ─── Navigation Structure ─────────────────────────────────────────────────────
const NAV_SECTIONS: NavSection[] = [
  // 1. العمليات
  {
    id: "core",
    labelKey: "nav.sections.coreOps",
    icon: ClipboardList,
    items: [
      { icon: Nfc,           labelKey: "nav.scanAsset",    path: "/scan-asset",
        roles: ["operator","technician","maintenance_manager","supervisor","gate_security","owner","admin"] },
      { icon: ClipboardList, labelKey: "nav.tickets",      path: "/tickets",
        roles: ["operator","technician","maintenance_manager","supervisor","gate_security","delegate","senior_management","executive_director","owner","admin"] },
      { icon: Lightbulb,     labelKey: "nav.improvementIdeas", path: "/improvement-ideas" },
      { icon: ScanSearch,    labelKey: "nav.triage",       path: "/triage",
        roles: ["supervisor","maintenance_manager","owner","admin"] },
      { icon: DoorOpen,      labelKey: "nav.gateSecurity", path: "/gate-security",
        roles: ["gate_security","owner","admin"] },
    ],
  },
  // 2. الصيانة الوقائية
  {
    id: "preventive",
    labelKey: "nav.sections.preventiveMaint",
    icon: CalendarClock,
    roles: ["technician","supervisor","maintenance_manager","owner","admin"],
    items: [
      { icon: CalendarClock, labelKey: "nav.preventive",      path: "/preventive",
        roles: ["technician","supervisor","maintenance_manager","owner","admin"] },
      { icon: Brain,         labelKey: "nav.predictiveMaint", path: "/predictive",
        roles: ["maintenance_manager","owner","admin"] },
    ],
  },
  // 3. اللوجستيات والشراء
  {
    id: "logistics",
    labelKey: "nav.sections.logistics",
    icon: ShoppingCart,
    roles: ["delegate","warehouse","accountant","senior_management","executive_director","maintenance_manager","purchase_requester","food_warehouse_manager","food_warehouse_assistant","owner","admin"],
    items: [
      { icon: ShoppingCart, labelKey: "nav.purchaseOrders", path: "/purchase-orders" },
      { icon: ShoppingBag,  labelKey: "nav.myItems",        path: "/my-items",
        roles: ["delegate","owner","admin"] },
      { icon: Package,      labelKey: "nav.inventory",      path: "/inventory",
        roles: ["warehouse","maintenance_manager","owner","admin"] },
      { icon: ClipboardList, labelKey: "nav.inventoryOperations", path: "/inventory-operations",
        roles: ["warehouse","owner","admin"] },
      // ⛔ مُعطّلة مؤقتاً (قيد الاختبار قبل الحذف النهائي) — استُبدلت بـ WarehouseReceiveV2
      // { icon: Package,      labelKey: "nav.warehouseReceive", path: "/warehouse/receive",
      //   roles: ["warehouse","owner","admin"] },
      { icon: RotateCcw,    labelKey: "nav.warehouseReturn",  path: "/warehouse/return",
        roles: ["warehouse","owner","admin"] },
      { icon: FileText,     labelKey: "nav.warehouseReturnsList", path: "/warehouse/returns",
        roles: ["warehouse","owner","admin"] },
      { icon: Truck,        labelKey: "nav.purchaseCycle",  path: "/purchase-cycle",
        roles: ["delegate","warehouse","owner","admin"] },
      { icon: Search,       labelKey: "nav.itemTracker",    path: "/item-tracker",
        roles: ["warehouse","owner","admin","maintenance_manager","accountant"] },
    ],
  },
  // 4. الإدارة
  {
    id: "management",
    labelKey: "nav.sections.management",
    icon: Building2,
    roles: ["supervisor","maintenance_manager","owner","admin"],
    items: [
      { icon: MapPin,    labelKey: "nav.sites",        path: "/sites",
        roles: ["owner","admin","maintenance_manager"] },
      { icon: Building2, labelKey: "nav.sectionsPage",  path: "/sections",
        roles: ["owner","admin","maintenance_manager"] },
      // Phase 5: Legacy external technicians page hidden from sidebar (infrastructure preserved, route still accessible via direct URL)
      // { icon: UserCog, labelKey: "nav.technicians", path: "/technicians", roles: ["owner","admin","maintenance_manager","supervisor"] },
      { icon: HardDrive, labelKey: "nav.assets",        path: "/assets",
        roles: ["owner","admin","maintenance_manager"] },
      { icon: Tag,       labelKey: "nav.assetCategories", path: "/asset-categories",
        roles: ["owner","admin","maintenance_manager"] },
    ],
  },
  // 5. التقارير
  {
    id: "reports",
    labelKey: "nav.sections.reports",
    icon: BarChart3,
    roles: ["accountant","senior_management","executive_director","maintenance_manager","owner","admin"],
    items: [
      { icon: BarChart3,     labelKey: "nav.reports",                path: "/reports",
        roles: ["owner","admin","senior_management","executive_director","accountant","maintenance_manager"] },
      { icon: ShoppingCart,  labelKey: "nav.purchaseCycleReport",    path: "/reports/purchase-cycle",
        roles: ["owner","admin","senior_management","executive_director","accountant","maintenance_manager"] },
      { icon: Wrench,        labelKey: "nav.maintenanceCycleReport", path: "/reports/maintenance-cycle",
        roles: ["owner","admin","senior_management","executive_director","maintenance_manager"] },
      { icon: Building2,     labelKey: "nav.sectionReport",          path: "/reports/section-report",
        roles: ["owner","admin","senior_management","executive_director","maintenance_manager"] },
      { icon: CalendarClock, labelKey: "nav.preventiveReport",       path: "/reports/preventive",
        roles: ["owner","admin","senior_management","executive_director","maintenance_manager"] },
      { icon: UserCog,       labelKey: "nav.technicianReport",       path: "/reports/technicians",
        roles: ["owner","admin","senior_management","executive_director","maintenance_manager"] },
      { icon: DollarSign,    labelKey: "nav.costReport",              path: "/reports/cost",
        roles: ["owner","admin"] },
      { icon: BarChart3,     labelKey: "nav.inspectionDashboard",     path: "/inspection-dashboard",
        roles: ["owner","admin","senior_management","executive_director","maintenance_manager"] },
    ],
  },
  // 6. وحدة الكتالوج
  {
    id: "catalog",
    labelKey: "nav.sections.catalog",
    icon: BookOpen,
    roles: ["owner", "admin", "maintenance_manager", "purchase_manager", "purchase_requester", "warehouse", "food_warehouse_manager", "food_warehouse_assistant"],
    items: [
      { icon: BookOpen, labelKey: "nav.catalog", path: "/catalog",
        roles: ["owner", "admin", "maintenance_manager", "purchase_manager", "purchase_requester", "warehouse", "food_warehouse_manager", "food_warehouse_assistant"] },
    ],
  },
  // 7. وحدة التحليل AI
  {
    id: "ai",
    labelKey: "nav.sections.aiUnit",
    icon: Brain,
    roles: ["owner","admin","senior_management","executive_director","maintenance_manager"],
    items: [
      { icon: Brain, labelKey: "nav.aiAssistant", path: "/ai-assistant",
        roles: ["owner","admin","senior_management","executive_director","maintenance_manager"] },
    ],
  },
  // 7. أدوات المسؤول
  {
    id: "admin",
    labelKey: "nav.sections.adminTools",
    icon: Shield,
    roles: ["owner","admin","warehouse"],
    items: [
      { icon: Users,     labelKey: "nav.users",              path: "/users" },
      { icon: Shield,    labelKey: "nav.auditLog",           path: "/audit-log", roles: ["owner","admin"] },
      { icon: Database,  labelKey: "backup.title",           path: "/backup", roles: ["owner","admin"] },
      { icon: Languages, labelKey: "nav.translationMonitor", path: "/translation-monitor", roles: ["owner","admin"] },
    ],
  },
  {
    id: "construction",
    labelKey: "nav.sections.construction",
    icon: HardHat,
    items: [
      { icon: Building2,    labelKey: "nav.construction.dashboard", path: "/construction" },
      { icon: FolderKanban, labelKey: "nav.construction.projects",  path: "/construction/projects" },
      { icon: BarChart3,    labelKey: "nav.construction.reports",   path: "/construction/reports" },
    ],
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getNestedValue(obj: any, path: string): string {
  return path.split(".").reduce((o, k) => o?.[k], obj) || path;
}

function canSeeItem(item: MenuItemDef, role: string): boolean {
  if (!item.roles) return true;
  return item.roles.includes(role);
}

function canSeeSection(section: NavSection, role: string): boolean {
  if (!section.roles) return true;
  return section.roles.includes(role);
}

// ─── Constants ────────────────────────────────────────────────────────────────
const SIDEBAR_WIDTH_KEY = "sidebar-width";
const COLLAPSED_SECTIONS_KEY = "sidebar-collapsed-sections";
const DEFAULT_WIDTH = 268;
const MIN_WIDTH = 210;
const MAX_WIDTH = 400;

// ─── Root Component ───────────────────────────────────────────────────────────
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    return saved ? parseInt(saved, 10) : DEFAULT_WIDTH;
  });
  const { loading, user } = useAuth();

  useEffect(() => {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, sidebarWidth.toString());
  }, [sidebarWidth]);

  if (loading) return <DashboardLayoutSkeleton />;
  if (!user) return <Login />;

  return (
    <SidebarProvider style={{ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties}>
      <DashboardLayoutContent setSidebarWidth={setSidebarWidth}>{children}</DashboardLayoutContent>
    </SidebarProvider>
  );
}

// ─── Inner Component ──────────────────────────────────────────────────────────
function DashboardLayoutContent({ children, setSidebarWidth }: { children: React.ReactNode; setSidebarWidth: (w: number) => void }) {
  const { user, logout } = useAuth();
  const [location, setLocation] = useLocation();
  const { state, toggleSidebar } = useSidebar();
  const isCollapsed = state === "collapsed";
  const [isResizing, setIsResizing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // ── PWA Install Prompt ──
  const [installPrompt, setInstallPrompt] = useState<any>(null);
  const [showInstallBanner, setShowInstallBanner] = useState(false);
  const [showInstallTooltip, setShowInstallTooltip] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);

  // ── iOS Install Guide ──
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isInStandaloneMode = (window.navigator as any).standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches;
  // يظهر دائماً طالما لم يثبت — الإغلاق مؤقت للجلسة فقط (sessionStorage)
  const [showIOSGuide, setShowIOSGuide] = useState(() => {
    if (!isIOS || isInStandaloneMode) return false;
    return !sessionStorage.getItem('ios-guide-closed-this-session');
  });
  const dismissIOSGuide = () => {
    setShowIOSGuide(false);
    sessionStorage.setItem('ios-guide-closed-this-session', '1');
  };
  useEffect(() => {
    // ── قراءة الحدث المُخزَّن مسبقاً في index.html قبل تحميل React ──
    if ((window as any).__pwaInstallPrompt) {
      setInstallPrompt((window as any).__pwaInstallPrompt);
      if (!sessionStorage.getItem('pwa-banner-closed-this-session')) {
        setShowInstallBanner(true);
      }
    }
    // ── استقبال حدث pwa-prompt-ready من index.html ──
    const handlePromptReady = (e: Event) => {
      const prompt = (e as CustomEvent).detail;
      setInstallPrompt(prompt);
      if (!sessionStorage.getItem('pwa-banner-closed-this-session')) {
        setShowInstallBanner(true);
      }
    };
    // ── استقبال حدث beforeinstallprompt إذا جاء بعد تحميل React (نادر) ──
    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      (window as any).__pwaInstallPrompt = e;
      setInstallPrompt(e);
      if (!sessionStorage.getItem('pwa-banner-closed-this-session')) {
        setShowInstallBanner(true);
      }
    };
    // ── استقبال حدث appinstalled (بعد التثبيت الناجح) ──
    const handleAppInstalled = () => {
      setIsInstalled(true);
      setInstallPrompt(null);
      (window as any).__pwaInstallPrompt = null;
      setShowInstallBanner(false);
    };
    window.addEventListener('pwa-prompt-ready', handlePromptReady);
    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    window.addEventListener('pwa-app-installed', handleAppInstalled);
    window.addEventListener('appinstalled', handleAppInstalled);
    return () => {
      window.removeEventListener('pwa-prompt-ready', handlePromptReady);
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      window.removeEventListener('pwa-app-installed', handleAppInstalled);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);
  const handleInstallPWA = () => {
    // ─── Chrome/Edge/Android: استخدام BeforeInstallPromptEvent ───
    const prompt = (window as any).__pwaInstallPrompt || installPrompt;
    if (prompt) {
      // استدعاء prompt() مباشرة - يجب أن يكون synchronous في user gesture context
      const promptResult = prompt.prompt();
      // Chrome القديم: userChoice كـ Promise منفصل
      // Chrome الجديد: prompt() يُرجع Promise<{outcome, platform}>
      const handleChoice = (outcome: string) => {
        if (outcome === 'accepted') {
          setIsInstalled(true);
          setShowInstallBanner(false);
          (window as any).__pwaInstallPrompt = null;
          setInstallPrompt(null);
        } else {
          // رُفض - نحتفظ بالـ prompt للمحاولة مستقبلاً
        }
      };
      if (promptResult && typeof promptResult.then === 'function') {
        // Chrome الجديد: prompt() يُرجع Promise
        promptResult.then((result: any) => {
          handleChoice(result?.outcome || 'dismissed');
        }).catch(() => {
          // إذا فشل، نظهر tooltip
          setShowInstallTooltip(true);
          setTimeout(() => setShowInstallTooltip(false), 6000);
        });
      } else {
        // Chrome القديم: userChoice كـ Promise منفصل
        if (prompt.userChoice && typeof prompt.userChoice.then === 'function') {
          prompt.userChoice.then((choice: any) => {
            handleChoice(choice?.outcome || 'dismissed');
          }).catch(() => {});
        }
      }
      return;
    }
    // ─── iOS: دليل التثبيت اليدوي ───
    if (isIOS) {
      setShowIOSGuide(true);
      return;
    }
    // ─── متصفحات أخرى: tooltip توجيهي ───
    setShowInstallTooltip(true);
    setTimeout(() => setShowInstallTooltip(false), 6000);
  };
  const dismissInstallBanner = () => {
    setShowInstallBanner(false);
    sessionStorage.setItem('pwa-banner-closed-this-session', '1');
  };
  // زر التثبيت يظهر ما لم يكن التطبيق مثبتاً أو مفتوحاً كـ standalone
  const showInstallButton = !isInstalled && !isInStandaloneMode;
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem(COLLAPSED_SECTIONS_KEY);
      return saved ? new Set(JSON.parse(saved)) : new Set<string>();
    } catch { return new Set<string>(); }
  });
  const sidebarRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const isMobile = useIsMobile();
  const { t } = useTranslation();

  const { data: unreadCount } = trpc.notifications.unreadCount.useQuery(undefined, { refetchInterval: 5000 });
  const { data: latestNotifications } = trpc.notifications.list.useQuery(undefined, { refetchInterval: 5000 });

  // ── Live notification popup ──
  const [popupNotifs, setPopupNotifs] = useState<Array<{ id: number; title: string; message: string; type: string; relatedTicketId?: number | null }>>([]);

  // Change password dialog
  const [changePwOpen, setChangePwOpen] = useState(false);
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [showCurrentPw, setShowCurrentPw] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);

  const changePwMut = trpc.auth.changePassword.useMutation({
    onSuccess: () => {
      toast.success("تم تغيير كلمة المرور بنجاح");
      setChangePwOpen(false);
      setCurrentPw("");
      setNewPw("");
    },
    onError: (err) => toast.error(err.message),
  });
  const prevNotifIdsRef = useRef<Set<number>>(new Set());
  const [soundEnabled, setSoundEnabled] = useState<boolean>(() => {
    const saved = localStorage.getItem("notif-sound-enabled");
    return saved === null ? true : saved === "true";
  });

  // ── Push Notifications (mobile/desktop OS-level) ──
  const { isSupported: pushSupported, isSubscribed: pushSubscribed, subscribe: pushSubscribe, unsubscribe: pushUnsubscribe } = usePushNotifications();

  // ── Play notification sound ──
  const playNotifSound = useCallback(() => {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(660, ctx.currentTime + 0.12);
      gain.gain.setValueAtTime(0.35, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.4);
    } catch {}
  }, []);

  useEffect(() => {
    if (!latestNotifications) return;
    const unread = latestNotifications.filter(n => !n.isRead);
    const currentIds = new Set(unread.map(n => n.id));
    const newNotifs = unread.filter(n => !prevNotifIdsRef.current.has(n.id) && prevNotifIdsRef.current.size > 0);
    if (newNotifs.length > 0) {
      setPopupNotifs(prev => [
        ...prev,
        ...newNotifs.map(n => ({ id: n.id, title: n.title, message: n.message, type: n.type || "info", relatedTicketId: n.relatedTicketId }))
      ]);
      newNotifs.forEach(n => {
        setTimeout(() => {
          setPopupNotifs(prev => prev.filter(p => p.id !== n.id));
        }, 8000);
      });
      if (soundEnabled) playNotifSound();
    }
    prevNotifIdsRef.current = currentIds;
  }, [latestNotifications, soundEnabled, playNotifSound]);

  const dismissPopup = useCallback((id: number) => {
    setPopupNotifs(prev => prev.filter(p => p.id !== id));
  }, []);

  // ── Notification color helpers ──
  const getNotifStyle = (type: string) => {
    switch (type) {
      case "critical":
      case "urgent":
        return {
          bg: "bg-red-50 dark:bg-red-950/40",
          border: "border-red-300 dark:border-red-700",
          iconBg: "bg-red-100 dark:bg-red-900/50",
          iconColor: "text-red-600 dark:text-red-400",
          dot: "bg-red-500",
        };
      case "warning":
      case "approval":
        return {
          bg: "bg-orange-50 dark:bg-orange-950/40",
          border: "border-orange-300 dark:border-orange-700",
          iconBg: "bg-orange-100 dark:bg-orange-900/50",
          iconColor: "text-orange-600 dark:text-orange-400",
          dot: "bg-orange-500",
        };
      default: // info, success
        return {
          bg: "bg-blue-50 dark:bg-blue-950/40",
          border: "border-blue-300 dark:border-blue-700",
          iconBg: "bg-blue-100 dark:bg-blue-900/50",
          iconColor: "text-blue-600 dark:text-blue-400",
          dot: "bg-blue-500",
        };
    }
  };

  const role = user?.role || "user";

  // ── Build visible sections with translated labels ──
  const visibleSections = useMemo(() => {
    return NAV_SECTIONS
      .filter(s => canSeeSection(s, role))
      .map(s => ({
        ...s,
        label: getNestedValue(t, s.labelKey),
        items: s.items
          .filter(item => canSeeItem(item, role))
          .map(item => ({ ...item, label: getNestedValue(t, item.labelKey) })),
      }))
      .filter(s => s.items.length > 0);
  }, [t, role]);

  // ── Search filter ──
  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return null;
    const q = searchQuery.toLowerCase();
    const results: { label: string; path: string; icon: any; section: string }[] = [];
    visibleSections.forEach(s => {
      s.items.forEach(item => {
        if (item.label.toLowerCase().includes(q)) {
          results.push({ label: item.label, path: item.path, icon: item.icon, section: s.label });
        }
      });
    });
    return results;
  }, [searchQuery, visibleSections]);

  const toggleSection = (id: string) => {
    setCollapsedSections(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      localStorage.setItem(COLLAPSED_SECTIONS_KEY, JSON.stringify(Array.from(next)));
      return next;
    });
  };

  // ── Resize logic ──
  useEffect(() => {
    if (isCollapsed) setIsResizing(false);
  }, [isCollapsed]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;
      const sidebarRight = sidebarRef.current?.getBoundingClientRect().right ?? 0;
      const newWidth = sidebarRight - e.clientX;
      if (newWidth >= MIN_WIDTH && newWidth <= MAX_WIDTH) setSidebarWidth(newWidth);
    };
    const handleMouseUp = () => setIsResizing(false);
    if (isResizing) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    }
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isResizing, setSidebarWidth]);

  const isItemActive = (path: string) =>
    location === path || (path !== "/" && location.startsWith(path));

  return (
    <>
      <div className="relative" ref={sidebarRef}>
        <Sidebar collapsible="icon" className="border-l-0 border-r border-sidebar-border/40" side="right" disableTransition={isResizing}>

          {/* ── Header ── */}
          <SidebarHeader className="h-14 justify-center border-b border-sidebar-border/40 px-3">
            <div className="flex items-center gap-2.5 w-full">
              {!isCollapsed && (
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <div className="w-7 h-7 rounded-lg bg-sidebar-primary/15 flex items-center justify-center shrink-0">
                    <Wrench className="h-3.5 w-3.5 text-sidebar-primary" />
                  </div>
                  <span className="font-bold tracking-tight truncate text-[13px] text-sidebar-foreground">{t.appShort}</span>
                </div>
              )}
              <button
                onClick={toggleSidebar}
                className="h-7 w-7 flex items-center justify-center hover:bg-sidebar-accent rounded-md transition-colors shrink-0 ml-auto"
              >
                <PanelLeft className="h-3.5 w-3.5 text-sidebar-foreground/50" />
              </button>
            </div>
          </SidebarHeader>

          {/* ── Search Bar ── */}
          {!isCollapsed && (
            <div className="px-3 pt-3 pb-1">
              <div className="relative">
                <Search className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-sidebar-foreground/40 pointer-events-none" />
                <input
                  ref={searchRef}
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="بحث في القائمة..."
                  className="w-full h-8 bg-sidebar-accent/40 border border-sidebar-border/30 rounded-md pr-8 pl-7 text-[12px] text-sidebar-foreground placeholder:text-sidebar-foreground/40 focus:outline-none focus:ring-1 focus:ring-sidebar-primary/40 transition-all"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery("")}
                    className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 flex items-center justify-center hover:text-sidebar-foreground/80 text-sidebar-foreground/40"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            </div>
          )}

          {/* ── Content ── */}
          <SidebarContent className="gap-0 overflow-y-auto pt-1 pb-2">

            {/* ── لوحة التحكم مستقلة في الأعلى ── */}
            {!searchResults && (role === "admin" || role === "owner") && (
              <div className="px-2 pb-1">
                <SidebarMenu className="gap-0.5">
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      isActive={isItemActive("/")}
                      onClick={() => setLocation("/")}
                      tooltip={t.nav.dashboard}
                      className="h-9 transition-all font-normal text-[13px] group/item"
                    >
                      <LayoutDashboard className={`h-3.5 w-3.5 shrink-0 transition-colors ${isItemActive("/") ? "text-sidebar-primary" : "text-sidebar-foreground/55 group-hover/item:text-sidebar-foreground/80"}`} />
                      <span className={`truncate ${isItemActive("/") ? "font-medium" : ""}`}>{t.nav.dashboard}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
                {!isCollapsed && <div className="mx-1 mt-1 border-b border-sidebar-border/25" />}
              </div>
            )}

            {/* Search Results */}
            {searchResults !== null ? (
              <div className="px-2 py-1">
                {searchResults.length === 0 ? (
                  <p className="text-[11px] text-sidebar-foreground/40 text-center py-4">لا توجد نتائج</p>
                ) : (
                  <SidebarMenu className="gap-0.5">
                    {searchResults.map(item => (
                      <SidebarMenuItem key={item.path}>
                        <SidebarMenuButton
                          isActive={isItemActive(item.path)}
                          onClick={() => { setLocation(item.path); setSearchQuery(""); }}
                          className="h-9 transition-all font-normal text-[13px]"
                        >
                          <item.icon className={`h-3.5 w-3.5 shrink-0 ${isItemActive(item.path) ? "text-sidebar-primary" : "text-sidebar-foreground/60"}`} />
                          <div className="flex flex-col min-w-0">
                            <span className="truncate leading-none">{item.label}</span>
                            <span className="text-[10px] text-sidebar-foreground/40 truncate mt-0.5">{item.section}</span>
                          </div>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                )}
              </div>
            ) : (
              /* Grouped Sections */
              visibleSections.map((section, sIdx) => {
                const isSectionCollapsed = collapsedSections.has(section.id);
                return (
                  <div key={section.id} className={sIdx > 0 ? "mt-1" : ""}>
                    {/* Section Header */}
                    {!isCollapsed && (
                      <button
                        onClick={() => toggleSection(section.id)}
                        className="w-full flex items-center justify-between px-3 py-1.5 group"
                      >
                        <div className="flex items-center gap-1.5">
                          <section.icon className="h-3 w-3 text-sidebar-foreground/35" />
                          <span className="text-xs font-bold uppercase tracking-wider text-sidebar-foreground/70 group-hover:text-sidebar-foreground/90 transition-colors">
                            {section.label}
                          </span>
                        </div>
                        <ChevronDown
                          className={`h-3 w-3 text-sidebar-foreground/30 transition-transform duration-200 ${isSectionCollapsed ? "-rotate-90" : ""}`}
                        />
                      </button>
                    )}

                    {/* Section Items */}
                    {(!isSectionCollapsed || isCollapsed) && (
                      <SidebarMenu className={`px-2 gap-0.5 ${!isCollapsed ? "pb-1" : "py-1"}`}>
                        {section.items.map(item => {
                          const isActive = isItemActive(item.path);
                          const isComingSoon = item.path === "/predictive";
                          return (
                            <SidebarMenuItem key={item.path}>
                              <SidebarMenuButton
                                isActive={isActive}
                                onClick={() => {
                                  if (isComingSoon) {
                                    import("sonner").then(m => m.toast.info("الصيانة التنبؤية قيد التطوير"));
                                  } else {
                                    setLocation(item.path);
                                  }
                                }}
                                tooltip={item.label}
                                className={`h-9 transition-all font-normal text-[13px] group/item ${isComingSoon ? "opacity-60" : ""}`}
                              >
                                <item.icon className={`h-3.5 w-3.5 shrink-0 transition-colors ${isActive ? "text-sidebar-primary" : "text-sidebar-foreground/55 group-hover/item:text-sidebar-foreground/80"}`} />
                                <span className={`truncate ${isActive ? "font-medium" : ""}`}>{item.label}</span>
                                {isComingSoon && !isCollapsed && (
                                  <span className="mr-auto text-[9px] bg-amber-500/15 text-amber-600 dark:text-amber-400 px-1.5 py-0.5 rounded-full font-medium shrink-0">قريباً</span>
                                )}
                              </SidebarMenuButton>
                            </SidebarMenuItem>
                          );
                        })}
                      </SidebarMenu>
                    )}

                    {/* Section Divider */}
                    {!isCollapsed && sIdx < visibleSections.length - 1 && (
                      <div className="mx-3 border-b border-sidebar-border/25" />
                    )}
                  </div>
                );
              })
            )}

            {/* ── الإشعارات كقسم منظم ── */}
            <div className={`px-2 mt-1 ${!isCollapsed ? "pt-1 border-t border-sidebar-border/25" : ""}`}>
              {!isCollapsed && (
                <div className="flex items-center gap-1.5 px-1 py-1.5">
                  <Bell className="h-3 w-3 text-sidebar-foreground/35" />
                  <span className="text-xs font-bold uppercase tracking-wider text-sidebar-foreground/70">
                    {t.nav.sections.notificationsSection}
                  </span>
                </div>
              )}
              <SidebarMenu className="gap-0.5">
                <SidebarMenuItem>
                  <SidebarMenuButton
                    isActive={location === "/notifications"}
                    onClick={() => setLocation("/notifications")}
                    tooltip={t.nav.notifications}
                    className="h-9 transition-all font-normal text-[13px] group/item"
                  >
                    <div className="relative shrink-0">
                      <Bell className={`h-3.5 w-3.5 ${location === "/notifications" ? "text-sidebar-primary" : "text-sidebar-foreground/55 group-hover/item:text-sidebar-foreground/80"}`} />
                      {(unreadCount || 0) > 0 && (
                        <span className="absolute -top-1.5 -right-1.5 min-w-[14px] h-3.5 px-0.5 bg-destructive text-destructive-foreground text-[9px] rounded-full flex items-center justify-center font-bold leading-none animate-pulse">
                          {(unreadCount || 0) > 9 ? "9+" : unreadCount}
                        </span>
                      )}
                    </div>
                    <span>{t.nav.notifications}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </div>
          </SidebarContent>

          {/* ── Footer ── */}
          <SidebarFooter className="p-3 border-t border-sidebar-border/40">
            <div className="flex items-center justify-center gap-2 mb-2">
              <LanguageSwitcher compact={isCollapsed} />
              {/* ── زر التثبيت الثابت ── */}
              {showInstallButton && (
                <button
                  onClick={handleInstallPWA}
                  title="تثبيت التطبيق"
                  className="group relative flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-sidebar-primary/10 hover:bg-sidebar-primary/20 border border-sidebar-primary/20 hover:border-sidebar-primary/40 text-sidebar-primary transition-all duration-200 text-xs font-medium shrink-0"
                >
                  <Smartphone className="h-3.5 w-3.5" />
                  {!isCollapsed && (
                    <span className="whitespace-nowrap">تثبيت</span>
                  )}
                  {/* نقطة خضراء تشير للتثبيت */}
                  <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-emerald-500 ring-1 ring-sidebar-background animate-pulse" />
                  {/* Tooltip توجيهي عند عدم دعم beforeinstallprompt */}
                  {showInstallTooltip && (
                    <div className="absolute bottom-full mb-2 right-0 w-56 bg-popover text-popover-foreground text-xs rounded-lg shadow-lg border border-border p-3 z-50 text-right">
                      <p className="font-semibold mb-1">تثبيت التطبيق</p>
                      <p className="text-muted-foreground leading-relaxed">افتح القائمة في المتصفح ثم اختر "تثبيت التطبيق" أو "إضافة إلى الشاشة الرئيسية"</p>
                      <div className="absolute bottom-[-5px] right-3 w-2.5 h-2.5 bg-popover border-b border-r border-border rotate-45" />
                    </div>
                  )}
                </button>
              )}
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-2.5 rounded-lg px-2 py-2 hover:bg-sidebar-accent/50 transition-colors w-full text-right">
                  <Avatar className="h-8 w-8 border border-sidebar-border shrink-0">
                    <AvatarFallback className="text-[11px] font-bold bg-sidebar-primary/15 text-sidebar-primary">
                      {user?.name?.charAt(0)?.toUpperCase() || "U"}
                    </AvatarFallback>
                  </Avatar>
                  {!isCollapsed && (
                    <div className="flex-1 min-w-0">
                      <p className="text-[12.5px] font-medium truncate leading-none text-sidebar-foreground">{user?.name || "-"}</p>
                      <p className="text-[10.5px] text-sidebar-foreground/50 truncate mt-0.5">
                        {(t.roles as any)[user?.role || "user"] || user?.role}
                      </p>
                    </div>
                  )}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <div className="px-2 py-2 text-xs text-muted-foreground">{user?.email || user?.username || ""}</div>
                <DropdownMenuSeparator />
                {user?.username && (
                  <DropdownMenuItem
                    onClick={() => { setChangePwOpen(true); setCurrentPw(""); setNewPw(""); }}
                    className="cursor-pointer gap-2"
                  >
                    <KeyRound className="ml-2 h-4 w-4" />
                    <span>تغيير كلمة المرور</span>
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={logout} className="cursor-pointer text-destructive focus:text-destructive">
                  <LogOut className="ml-2 h-4 w-4" />
                  <span>{t.logout}</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {/* ── Version indicator ── */}
            {!isCollapsed && (
              <p className="text-[10px] text-sidebar-foreground/30 text-center mt-1 select-none">
                v{__APP_VERSION__}
              </p>
            )}
          </SidebarFooter>
        </Sidebar>

        {/* Resize Handle */}
        <div
          className={`absolute top-0 left-0 w-1 h-full cursor-col-resize hover:bg-primary/20 transition-colors ${isCollapsed ? "hidden" : ""}`}
          onMouseDown={() => { if (!isCollapsed) setIsResizing(true); }}
          style={{ zIndex: 50 }}
        />
      </div>

      <SidebarInset>
        {isMobile && (
          <div className="flex border-b h-13 items-center justify-between bg-background/95 px-3 backdrop-blur sticky top-0 z-40">
            <div className="flex items-center gap-2">
              <SidebarTrigger className="h-8 w-8 rounded-lg" />
              <span className="font-medium text-[13px]">
                {visibleSections.flatMap(s => s.items).find(i => isItemActive(i.path))?.label ?? t.nav.menu}
              </span>
            </div>
            <div className="relative cursor-pointer" onClick={() => setLocation("/notifications")}>
              <Bell className="h-5 w-5 text-muted-foreground" />
              {(unreadCount || 0) > 0 && (
                <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 bg-destructive text-destructive-foreground text-[10px] rounded-full flex items-center justify-center font-bold animate-pulse">
                  {(unreadCount || 0) > 9 ? "9+" : unreadCount}
                </span>
              )}
            </div>
          </div>
        )}
        {/* PWA Install Banner */}
        {showInstallBanner && (
          <div className="sticky top-0 z-50 flex items-center justify-between gap-3 bg-indigo-600 text-white px-4 py-2.5 text-sm shadow-md" dir="rtl">
            <div className="flex items-center gap-2">
              <span className="text-lg">📲</span>
              <span className="font-medium">ثبّت التطبيق على جهازك للوصول السريع</span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={handleInstallPWA}
                className="bg-white text-indigo-600 font-semibold text-xs px-3 py-1.5 rounded-lg hover:bg-indigo-50 transition-colors"
              >
                تثبيت
              </button>
              <button
                onClick={dismissInstallBanner}
                className="text-white/70 hover:text-white transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
        <main className="flex-1 p-4 md:p-6">{children}</main>
      </SidebarInset>

      {/* ── iOS Install Guide ── */}
      {showIOSGuide && (
        <div className="fixed inset-0 z-[9998] flex items-end justify-center pb-6 px-4 bg-black/40 backdrop-blur-sm" dir="rtl">
          <div className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-sm p-5 animate-in slide-in-from-bottom-4 duration-300">
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <span className="text-2xl">📱</span>
                <div>
                  <p className="font-bold text-sm text-foreground">ثبّت التطبيق على iPhone</p>
                  <p className="text-xs text-muted-foreground">للوصول السريع بدون فتح المتصفح</p>
                </div>
              </div>
              <button onClick={dismissIOSGuide} className="text-muted-foreground hover:text-foreground transition-colors p-1">
                <X className="w-5 h-5" />
              </button>
            </div>
            {/* Steps */}
            <div className="space-y-3 mb-5">
              <div className="flex items-center gap-3 bg-muted/50 rounded-xl p-3">
                <div className="w-7 h-7 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center shrink-0">1</div>
                <p className="text-sm text-foreground">افتح هذا الرابط من متصفح <span className="font-bold text-primary">Safari</span></p>
              </div>
              <div className="flex items-center gap-3 bg-muted/50 rounded-xl p-3">
                <div className="w-7 h-7 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center shrink-0">2</div>
                <p className="text-sm text-foreground">اضغط على أيقونة المشاركة <span className="font-bold">⬆️</span> في أسفل الشاشة</p>
              </div>
              <div className="flex items-center gap-3 bg-muted/50 rounded-xl p-3">
                <div className="w-7 h-7 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center shrink-0">3</div>
                <p className="text-sm text-foreground">اختر <span className="font-bold text-primary">"إضافة إلى الشاشة الرئيسية"</span> من القائمة</p>
              </div>
              <div className="flex items-center gap-3 bg-muted/50 rounded-xl p-3">
                <div className="w-7 h-7 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center shrink-0">4</div>
                <p className="text-sm text-foreground">اضغط <span className="font-bold text-primary">"إضافة"</span> — يظهر التطبيق فوراً على شاشتك</p>
              </div>
            </div>
            {/* Dismiss */}
            <button
              onClick={dismissIOSGuide}
              className="w-full bg-primary text-primary-foreground font-semibold text-sm py-2.5 rounded-xl hover:opacity-90 transition-opacity"
            >
              فهمت، شكراً
            </button>
          </div>
        </div>
      )}

      {/* ── Change Password Dialog ── */}
      <Dialog open={changePwOpen} onOpenChange={(open) => { setChangePwOpen(open); if (!open) { setCurrentPw(""); setNewPw(""); } }}>
        <DialogContent className="sm:max-w-[420px]" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="w-5 h-5" />
              تغيير كلمة المرور
            </DialogTitle>
            <DialogDescription>أدخل كلمة المرور الحالية ثم الجديدة</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>كلمة المرور الحالية</Label>
              <div className="relative">
                <Input
                  type={showCurrentPw ? "text" : "password"}
                  value={currentPw}
                  onChange={e => setCurrentPw(e.target.value)}
                  placeholder="كلمة المرور الحالية"
                  dir="ltr"
                  className="pl-10"
                />
                <button
                  type="button"
                  className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowCurrentPw(!showCurrentPw)}
                >
                  {showCurrentPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <div className="space-y-2">
              <Label>كلمة المرور الجديدة</Label>
              <div className="relative">
                <Input
                  type={showNewPw ? "text" : "password"}
                  value={newPw}
                  onChange={e => setNewPw(e.target.value)}
                  placeholder="8 أحرف على الأقل، حرف كبير ورقم"
                  dir="ltr"
                  className="pl-10"
                />
                <button
                  type="button"
                  className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowNewPw(!showNewPw)}
                >
                  {showNewPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <PasswordStrengthIndicator password={newPw} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setChangePwOpen(false)}>إلغاء</Button>
            <Button
              onClick={() => changePwMut.mutate({ currentPassword: currentPw, newPassword: newPw })}
              disabled={changePwMut.isPending || !currentPw || !isPasswordValid(newPw)}
            >
              {changePwMut.isPending ? "جاري التغيير..." : "تغيير كلمة المرور"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Live Notification Popups ── */}
      <div className="fixed bottom-4 left-4 z-[9999] flex flex-col gap-2 max-w-sm" dir="rtl">
        {/* Sound toggle button */}
        {popupNotifs.length === 0 && (
          <button
            onClick={async () => {
              const next = !soundEnabled;
              setSoundEnabled(next);
              localStorage.setItem("notif-sound-enabled", String(next));
              // عند التفعيل: اطلب إذن إشعارات الهاتف أيضاً
              if (next) {
                if (!pushSupported) {
                  // تشخيص سبب عدم الدعم
                  const reason = !("serviceWorker" in navigator) ? "المتصفح لا يدعم Service Worker" :
                                 !("PushManager" in window) ? "المتصفح لا يدعم Push Manager" :
                                 "مفاتيح التشفير VAPID مفقودة من الإعدادات";
                  toast.error(`إشعارات الجوال غير مدعومة: ${reason}`);
                } else {
                  try {
                    const ok = await pushSubscribe();
                    if (ok) {
                      toast.success("تم تفعيل إشعارات الجوال بنجاح! ستصلك التنبيهات حتى عند إغلاق التطبيق.");
                    } else {
                      toast.error("لم يتم تفعيل إشعارات الجوال. يرجى التأكد من السماح بالإشعارات في إعدادات المتصفح.");
                    }
                  } catch (err: any) {
                    console.error("[Push] Error during bell toggle subscribe:", err);
                    toast.error(`فشل تفعيل إشعارات الجوال: ${err.message || "خطأ غير معروف"}`);
                  }
                }
              }
              // عند الإيقاف: ألغِ اشتراك إشعارات الهاتف أيضاً
              if (!next && pushSupported && pushSubscribed) {
                await pushUnsubscribe();
              }
            }}
            className="self-end text-[10px] text-muted-foreground hover:text-foreground bg-background/80 border border-border rounded-full px-2 py-0.5 backdrop-blur transition-colors"
            title={soundEnabled ? "إيقاف صوت التنبيه وإشعارات الجوال" : "تفعيل صوت التنبيه وإشعارات الجوال"}
          >
            {soundEnabled ? "🔔" : "🔕"}
          </button>
        )}
        {popupNotifs.map((notif) => {
          const style = getNotifStyle(notif.type);
          return (
            <div
              key={notif.id}
              className={`${style.bg} border ${style.border} rounded-xl shadow-2xl p-4 flex items-start gap-3 animate-in slide-in-from-bottom-4 duration-300`}
              style={{ minWidth: 280 }}
            >
              <div className={`flex-shrink-0 w-9 h-9 rounded-full ${style.iconBg} flex items-center justify-center`}>
                <Bell className={`w-4 h-4 ${style.iconColor}`} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm text-foreground leading-tight">{notif.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{notif.message}</p>
                <div className="flex gap-2 mt-2">
                  {notif.relatedTicketId && (
                    <button
                      onClick={() => { setLocation(`/tickets/${notif.relatedTicketId}`); dismissPopup(notif.id); }}
                      className={`text-xs font-medium hover:underline ${style.iconColor}`}
                    >
                      عرض البلاغ
                    </button>
                  )}
                </div>
              </div>
              <button
                onClick={() => dismissPopup(notif.id)}
                className="flex-shrink-0 text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          );
        })}
      </div>
    </>
  );
}
