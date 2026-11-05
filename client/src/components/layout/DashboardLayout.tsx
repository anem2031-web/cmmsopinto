import { isDelegateRole } from "@shared/roles";
import { canAccessReturnsCenter, RETURNS_CENTER_PATH, RETURNS_CENTER_SUPPLIER_ROLES } from "@shared/returns-center";
import { useAuth } from "@/_core/hooks/useAuth";
import { businessHomePath, isBusinessGuardedRole } from "@shared/business-role-policy";
import { ticketTeamNotificationPath } from "@shared/maintenance-team-tickets/warehouse-navigation";
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
import {
  LayoutDashboard, LogOut, PanelLeft, ClipboardList, ShoppingCart,
  Package, BarChart3, Users, Bell, MapPin, Wrench, Shield,
  Brain, ShoppingBag, Truck, Languages, Database,
  HardDrive, CalendarClock, ScanSearch, DoorOpen, Nfc, Tag,
  ChevronDown, Search, X, Building2, UserCog, Download, Smartphone, DollarSign,
  RotateCcw, BookOpen, Lightbulb, FileText, Inbox, FileStack, Star
,
  HardHat, FolderKanban, Warehouse, ArrowLeftRight, ShieldCheck} from "lucide-react";
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
import { canRoleAccessPath } from "@shared/roles";
import { canReadApprovedPricingDocuments, approvedPricingDocumentPageAllowed } from "@shared/approved-pricing-documents";
import { isObserver } from "@shared/observer-policy";
import { ObserverReadOnlyBoundary } from "@/components/system/ObserverReadOnlyBoundary";

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
  // 1. الرئيسية والمهام
  {
    id: "home-tasks",
    labelKey: "nav.sections.homeTasks",
    icon: LayoutDashboard,
    items: [
      { icon: LayoutDashboard, labelKey: "nav.dashboard", path: "/", roles: ["owner", "admin"] },
      { icon: Bell, labelKey: "nav.notifications", path: "/notifications" },
      { icon: ClipboardList, labelKey: "nav.pmv2MyTasks", path: "/scheduled-maintenance/my-tasks",
        roles: ["technician","it_manager","it_member","owner","admin","maintenance_manager","general_maintenance_manager","construction_procurement_manager"] },
      { icon: ShoppingBag, labelKey: "nav.myItems", path: "/my-items", roles: ["delegate", "delegate_manager","owner","admin"] },
    ],
  },
  // 2. البلاغات والتشغيل
  {
    id: "tickets-operations",
    labelKey: "nav.sections.ticketsOperations",
    icon: ClipboardList,
    items: [
      { icon: Nfc,           labelKey: "nav.scanAsset",    path: "/scan-asset",
        roles: ["operator","technician","maintenance_manager","general_maintenance_manager","supervisor","gate_security","owner","admin"] },
      { icon: ClipboardList, labelKey: "nav.tickets",      path: "/tickets",
        roles: ["operator","technician","it_manager","it_member","maintenance_manager","general_maintenance_manager","construction_procurement_manager","supervisor","gate_security","delegate", "delegate_manager","senior_management","executive_director","owner","admin"] },
      { icon: ClipboardList, labelKey: "nav.operationalIssues", path: "/operational-issues",
        roles: ["maintenance_manager","general_maintenance_manager","construction_procurement_manager","it_manager","warehouse","owner","admin"] },
      { icon: ClipboardList, labelKey: "nav.maintenanceTeamTickets", path: "/maintenance-team-tickets",
        roles: ["technician","warehouse","maintenance_manager","general_maintenance_manager","construction_procurement_manager","owner","admin"] },
      // صندوق البلاغات — يبقى محجوبًا عن مدير الإنشاءات والمشتريات
      { icon: Inbox,         labelKey: "nav.ticketsInbox", path: "/tickets/inbox",
        roles: ["operator","technician","it_manager","it_member","maintenance_manager","general_maintenance_manager","supervisor","gate_security","senior_management","executive_director","owner","admin"] },
      { icon: Lightbulb,     labelKey: "nav.improvementIdeas", path: "/improvement-ideas" },
      { icon: ScanSearch,    labelKey: "nav.triage",       path: "/triage",
        roles: ["maintenance_manager","general_maintenance_manager","owner","admin"] },
      { icon: DoorOpen,      labelKey: "nav.gateSecurity", path: "/gate-security",
        roles: ["gate_security","owner","admin"] },
    ],
  },
  // 3. الصيانة
  {
    id: "maintenance",
    labelKey: "nav.sections.maintenance",
    icon: CalendarClock,
    roles: ["technician","it_manager","it_member","warehouse","maintenance_manager","general_maintenance_manager","construction_procurement_manager","owner","admin"],
    items: [
      { icon: CalendarClock, labelKey: "nav.scheduledMaintenance", path: "/scheduled-maintenance",
        roles: ["maintenance_manager","general_maintenance_manager","owner","admin"] },
      { icon: Warehouse, labelKey: "nav.pmv2WarehouseRequests", path: "/scheduled-maintenance/warehouse-requests",
        roles: ["warehouse","owner","admin"] },
      { icon: FileText, labelKey: "nav.pmv2MaintenanceReports", path: "/scheduled-maintenance/reports",
        roles: ["maintenance_manager","general_maintenance_manager","owner","admin"] },
      { icon: Wrench, labelKey: "nav.externalMaintenance", path: "/external-maintenance",
        roles: ["warehouse","owner","admin"] },
      { icon: CalendarClock, labelKey: "nav.preventive",      path: "/preventive",
        roles: ["owner","admin"] },
      { icon: Brain,         labelKey: "nav.predictiveMaint", path: "/predictive",
        roles: ["owner","admin"] },
    ],
  },
  // 4. المشتريات
  {
    id: "purchasing",
    labelKey: "nav.sections.purchasing",
    icon: ShoppingCart,
    roles: [...RETURNS_CENTER_SUPPLIER_ROLES],
    items: [
      { icon: ShoppingCart, labelKey: "nav.purchaseOrders", path: "/purchase-orders",
        roles: ["delegate", "delegate_manager","warehouse","accountant","senior_management","executive_director","maintenance_manager","general_maintenance_manager","construction_procurement_manager","it_manager","purchase_requester","food_warehouse_manager","food_warehouse_assistant","owner","admin"] },
      { icon: ShoppingBag, labelKey: "nav.delegatePricingBundles", path: "/delegate-pricing-bundles",
        roles: ["delegate", "delegate_manager","accountant","senior_management","owner","admin"] },
      { icon: RotateCcw, labelKey: "nav.returnsCenter", path: "/returns-center",
        roles: [...RETURNS_CENTER_SUPPLIER_ROLES] },
      { icon: Truck, labelKey: "nav.purchaseCycle", path: "/purchase-cycle", roles: ["delegate", "delegate_manager","warehouse","owner","admin"] },
      { icon: FileStack, labelKey: "nav.documentsCenter", path: "/documents",
        roles: ["delegate", "delegate_manager","warehouse","accountant","senior_management","executive_director","maintenance_manager","purchase_requester","food_warehouse_manager","food_warehouse_assistant","owner","admin"] },
    ],
  },
  // 5. المستودع والمخزون
  {
    id: "warehouse-inventory",
    labelKey: "nav.sections.warehouseInventory",
    icon: Warehouse,
    roles: ["warehouse","accountant","senior_management","executive_director","maintenance_manager","food_warehouse_manager","food_warehouse_assistant","owner","admin"],
    items: [
      { icon: Package,      labelKey: "nav.inventory",      path: "/inventory",
        roles: ["warehouse","senior_management","maintenance_manager","owner","admin"] },
      { icon: ClipboardList, labelKey: "nav.inventoryOperations", path: "/inventory-operations",
        roles: ["warehouse","senior_management","owner","admin"] },
      { icon: ClipboardList, labelKey: "nav.inventorySettlementReview", path: "/inventory-settlement-review",
        roles: ["warehouse","senior_management","owner","admin"] },
      { icon: ShieldCheck, labelKey: "nav.inventoryReconciliation", path: "/inventory/reconciliation",
        roles: ["warehouse","senior_management","maintenance_manager","owner","admin"] },
      { icon: BarChart3, labelKey: "nav.inventoryReportsCenter", path: "/inventory/reports",
        roles: ["warehouse","accountant","senior_management","executive_director","maintenance_manager","food_warehouse_manager","food_warehouse_assistant","owner","admin"] },
      { icon: Warehouse,      labelKey: "nav.warehouses",         path: "/warehouses",
        roles: ["warehouse","senior_management","owner","admin"] },
      { icon: ArrowLeftRight, labelKey: "nav.warehouseTransfer",  path: "/warehouse/transfer",
        roles: ["warehouse","senior_management","owner","admin"] },
      { icon: Truck,        labelKey: "nav.warehouseIssue", path: "/warehouse/issue",
        roles: ["warehouse","senior_management","owner","admin"] },
      { icon: Search,       labelKey: "nav.itemTracker",    path: "/item-tracker",
        roles: ["warehouse","senior_management","owner","admin","maintenance_manager"] },
    ],
  },
  // 6. الأصول والبيانات الأساسية
  {
    id: "master-data",
    labelKey: "nav.sections.masterData",
    icon: Building2,
    roles: ["supervisor","warehouse","maintenance_manager","general_maintenance_manager","construction_procurement_manager","senior_management","owner","admin"],
    items: [
      { icon: MapPin,    labelKey: "nav.sites",        path: "/sites",
        roles: ["owner","admin","maintenance_manager","general_maintenance_manager","construction_procurement_manager"] },
      { icon: Building2, labelKey: "nav.sectionsPage",  path: "/sections",
        roles: ["owner","admin","maintenance_manager","general_maintenance_manager","construction_procurement_manager"] },
      // Phase 5: Legacy external technicians page hidden from sidebar (infrastructure preserved, route still accessible via direct URL)
      // { icon: UserCog, labelKey: "nav.technicians", path: "/technicians", roles: ["owner","admin","maintenance_manager","supervisor"] },
      { icon: HardDrive, labelKey: "nav.assets",        path: "/assets",
        roles: ["owner","admin","maintenance_manager","general_maintenance_manager","construction_procurement_manager"] },
      { icon: UserCog, labelKey: "nav.maintenanceTeams", path: "/maintenance-teams",
        roles: ["owner","admin","maintenance_manager","general_maintenance_manager"] },
      { icon: Tag,       labelKey: "nav.purchaseCategories", path: "/center-categories",
        roles: ["owner","admin","maintenance_manager","general_maintenance_manager","construction_procurement_manager"] },
      { icon: Tag,       labelKey: "nav.assetCategories", path: "/asset-categories",
        roles: ["owner","admin","maintenance_manager","general_maintenance_manager","construction_procurement_manager"] },
      { icon: BookOpen, labelKey: "nav.catalog", path: "/catalog",
        roles: ["owner", "admin", "maintenance_manager", "general_maintenance_manager", "construction_procurement_manager", "warehouse", "it_manager", "senior_management"] },
    ],
  },
  // 7. التقارير والتحليل
  {
    id: "reports-analysis",
    labelKey: "nav.sections.reportsAnalysis",
    icon: BarChart3,
    roles: ["senior_management","executive_director","maintenance_manager","general_maintenance_manager","construction_procurement_manager","owner","admin"],
    items: [
      { icon: BarChart3,     labelKey: "nav.reports",                path: "/reports",
        roles: ["owner","admin","senior_management","executive_director","maintenance_manager","general_maintenance_manager","construction_procurement_manager"] },
      { icon: ShoppingCart,  labelKey: "nav.purchaseCycleReport",    path: "/reports/purchase-cycle",
        roles: ["owner","admin","senior_management","executive_director","maintenance_manager","general_maintenance_manager","construction_procurement_manager"] },
      { icon: Wrench,        labelKey: "nav.maintenanceCycleReport", path: "/reports/maintenance-cycle",
        roles: ["owner","admin","senior_management","executive_director","maintenance_manager","general_maintenance_manager","construction_procurement_manager"] },
      { icon: Building2,     labelKey: "nav.sectionReport",          path: "/reports/section-report",
        roles: ["owner","admin","senior_management","executive_director","maintenance_manager","general_maintenance_manager","construction_procurement_manager"] },
      { icon: CalendarClock, labelKey: "nav.preventiveReport",       path: "/reports/preventive",
        roles: ["owner","admin"] },
      { icon: UserCog,       labelKey: "nav.technicianReport",       path: "/reports/technicians",
        roles: ["owner","admin","senior_management","executive_director","maintenance_manager","general_maintenance_manager","construction_procurement_manager"] },
      { icon: DollarSign,    labelKey: "nav.costReport",              path: "/reports/cost",
        roles: ["owner","admin"] },
      { icon: BarChart3,     labelKey: "nav.inspectionDashboard",     path: "/inspection-dashboard",
        roles: ["owner","admin","senior_management","executive_director","maintenance_manager","general_maintenance_manager","construction_procurement_manager"] },
      { icon: Brain, labelKey: "nav.aiAssistant", path: "/ai-assistant",
        roles: ["owner","admin","senior_management","executive_director","maintenance_manager","general_maintenance_manager","construction_procurement_manager"] },
    ],
  },
  // 8. الإدارة والنظام
  {
    id: "admin-system",
    labelKey: "nav.sections.adminSystem",
    icon: Shield,
    roles: ["owner","admin","warehouse"],
    items: [
      { icon: Users,     labelKey: "nav.users",              path: "/users" },
      { icon: Shield,    labelKey: "nav.auditLog",           path: "/audit-log", roles: ["owner","admin"] },
      { icon: Database,  labelKey: "backup.title",           path: "/backup", roles: ["owner","admin"] },
      { icon: Languages, labelKey: "nav.translationMonitor", path: "/translation-monitor", roles: ["owner","admin"] },
      { icon: Building2,    labelKey: "nav.construction.dashboard", path: "/construction", roles: ["owner", "admin"] },
      { icon: FolderKanban, labelKey: "nav.construction.projects",  path: "/construction/projects", roles: ["owner", "admin"] },
      { icon: BarChart3,    labelKey: "nav.construction.reports",   path: "/construction/reports", roles: ["owner", "admin"] },
    ],
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getNestedValue(obj: any, path: string): string {
  return path.split(".").reduce((o, k) => o?.[k], obj) || path;
}

function canSeeItem(item: MenuItemDef, role: string): boolean {
  if (isObserver(role)) return canSeeItem(item, "admin");
  // حارس البوابة: القائمة الجانبية تعرض وظيفة الحراسة فقط.
  // هذا قيد عرض فقط ولا يغيّر Route Guard أو صلاحيات الـBackend.
  if (role === "gate_security") return item.path === "/gate-security";
  if (!item.roles) return true;
  return item.roles.includes(role);
}

function canSeeSection(section: NavSection, role: string): boolean {
  if (isObserver(role)) return canSeeSection(section, "admin");
  if (!section.roles) return true;
  return section.roles.includes(role);
}

// ─── Constants ────────────────────────────────────────────────────────────────
const SIDEBAR_WIDTH_KEY = "sidebar-width";
const COLLAPSED_SECTIONS_KEY = "sidebar-collapsed-sections";
const FAVORITES_STORAGE_PREFIX = "sidebar-favorites";
const MAX_FAVORITES = 5;
const DEFAULT_WIDTH = 268;
const MIN_WIDTH = 210;
const MAX_WIDTH = 400;

// ─── Root Component ───────────────────────────────────────────────────────────
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    return saved ? parseInt(saved, 10) : DEFAULT_WIDTH;
  });
  const { loading, user, error, authFailureKind, refresh } = useAuth();

  useEffect(() => {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, sidebarWidth.toString());
  }, [sidebarWidth]);

  if (loading) return <DashboardLayoutSkeleton />;
  if (error && !user) {
    const rateLimited = authFailureKind === "rate_limit";
    const networkUnavailable = authFailureKind === "network";
    return (
      <div className="min-h-screen flex items-center justify-center p-6" dir="rtl">
        <div className="w-full max-w-md rounded-lg border bg-background p-6 text-center shadow-sm">
          <h1 className="text-lg font-semibold">
            {rateLimited ? "طلبات كثيرة خلال وقت قصير" : networkUnavailable ? "تعذر الاتصال بالخادم" : "تعذر التحقق من الجلسة مؤقتًا"}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {rateLimited
              ? "جلستك محفوظة، وسيحاول النظام الاتصال تلقائيًا خلال 30 ثانية."
              : "لم يتم تسجيل خروجك. سيحاول النظام إعادة الاتصال تلقائيًا، أو يمكنك المحاولة الآن."}
          </p>
          <Button className="mt-4" onClick={() => void refresh()}>
            إعادة المحاولة
          </Button>
        </div>
      </div>
    );
  }
  if (!user) return <Login />;

  return (
    <SidebarProvider style={{ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties}>
      <DashboardLayoutContent setSidebarWidth={setSidebarWidth}>{children}</DashboardLayoutContent>
    </SidebarProvider>
  );
}

// ─── Inner Component ──────────────────────────────────────────────────────────
function DashboardLayoutContent({ children, setSidebarWidth }: { children: React.ReactNode; setSidebarWidth: (w: number) => void }) {
  const { user, authenticatedUser, isReadOnly, logout, loading: authLoading } = useAuth();
  const [location, setLocation] = useLocation();
  const { state, toggleSidebar, isMobile, setOpenMobile } = useSidebar();
  const isCollapsed = !isMobile && state === "collapsed";
  const navigateFromSidebar = (path: string) => {
    setLocation(path);
    if (isMobile) setOpenMobile(false);
  };
  useEffect(() => {
    if (isMobile) setOpenMobile(false);
  }, [location, isMobile, setOpenMobile]);
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
  const { t } = useTranslation();
  const favoritesStorageKey = `${FAVORITES_STORAGE_PREFIX}:${authenticatedUser?.id ?? user?.id ?? "anonymous"}`;
  const [favoritePaths, setFavoritePaths] = useState<string[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(favoritesStorageKey) || "[]");
      return Array.isArray(saved)
        ? [...new Set(saved.filter((path): path is string => typeof path === "string"))].slice(0, MAX_FAVORITES)
        : [];
    } catch { return []; }
  });

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(favoritesStorageKey) || "[]");
      setFavoritePaths(Array.isArray(saved)
        ? [...new Set(saved.filter((path): path is string => typeof path === "string"))].slice(0, MAX_FAVORITES)
        : []);
    } catch { setFavoritePaths([]); }
  }, [favoritesStorageKey]);

  const { data: notificationSummary } = trpc.notifications.summary.useQuery(undefined, {
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
  const unreadCount = notificationSummary?.unreadCount ?? 0;
  const latestNotifications = notificationSummary?.items;

  // ── Live notification popup ──
  const [popupNotifs, setPopupNotifs] = useState<Array<{ id: number; title: string; message: string; type: string; relatedTicketId?: number | null; eventKey?: string | null }>>([]);

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
  const { isSupported: pushSupported, isSubscribed: pushSubscribed, subscribe: pushSubscribe, unsubscribe: pushUnsubscribe } = usePushNotifications(!isReadOnly);

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
        ...newNotifs.map(n => ({ id: n.id, title: n.title, message: n.message, type: n.type || "info", relatedTicketId: n.relatedTicketId, eventKey: n.eventKey }))
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
  const returnsCenterAccess = canAccessReturnsCenter(authenticatedUser?.role ?? role);

  // Prevent direct-URL access to modules explicitly removed from the derived roles.
  const approvedDocumentsAccess = canReadApprovedPricingDocuments(user);
  const canAccessCurrentPath = !authLoading && (location.split(/[?#]/, 1)[0] === RETURNS_CENTER_PATH
    ? returnsCenterAccess
    : canRoleAccessPath(role, location) || approvedPricingDocumentPageAllowed(user, location));
  useEffect(() => {
    if (authLoading || canAccessCurrentPath) return;
    const fallback = role === "technician"
      ? "/scheduled-maintenance/my-tasks"
      : role === "gate_security" ? "/gate-security"
      : isDelegateRole(role) ? "/purchase-orders"
      : role === "warehouse" && location.startsWith("/scheduled-maintenance")
        ? "/scheduled-maintenance/warehouse-requests"
        : isBusinessGuardedRole(role) ? businessHomePath(role)
        : role === "construction_procurement_manager" ? "/tickets?tab=construction" : "/tickets";
    setLocation(fallback);
  }, [authLoading, canAccessCurrentPath, location, role, setLocation]);

  // ── Build visible sections with translated labels ──
  const permittedSections = useMemo(() => {
    return NAV_SECTIONS
      .filter(s => canSeeSection(s, role) || approvedDocumentsAccess && s.id === "purchasing")
      .map(s => ({
        ...s,
        label: getNestedValue(t, s.labelKey),
        items: s.items
          .filter(item => canSeeItem(item, role) && canRoleAccessPath(role, item.path) && (item.path !== RETURNS_CENTER_PATH || returnsCenterAccess)
            || approvedDocumentsAccess && item.path === "/documents")
          .map(item => ({ ...item, label: getNestedValue(t, item.labelKey) })),
      }))
      .filter(s => s.items.length > 0);
  }, [t, role, approvedDocumentsAccess, returnsCenterAccess]);

  const permittedItemsByPath = useMemo(() => new Map(
    permittedSections.flatMap(section => section.items).map(item => [item.path, item]),
  ), [permittedSections]);

  useEffect(() => {
    setFavoritePaths(previous => {
      const next = previous.filter(path => permittedItemsByPath.has(path)).slice(0, MAX_FAVORITES);
      if (next.length === previous.length && next.every((path, index) => path === previous[index])) return previous;
      localStorage.setItem(favoritesStorageKey, JSON.stringify(next));
      return next;
    });
  }, [favoritesStorageKey, permittedItemsByPath]);

  const visibleSections = useMemo(() => {
    const favorites = favoritePaths
      .map(path => permittedItemsByPath.get(path))
      .filter((item): item is NonNullable<typeof item> => Boolean(item));
    const favoriteSection = {
      id: "favorites",
      labelKey: "nav.sections.favorites",
      label: t.nav.sections.favorites,
      icon: Star,
      items: favorites,
    };
    return [favoriteSection, ...permittedSections];
  }, [favoritePaths, permittedItemsByPath, permittedSections, t.nav.sections.favorites]);

  const toggleFavorite = useCallback((path: string) => {
    if (!permittedItemsByPath.has(path)) return;
    setFavoritePaths(previous => {
      const isFavorite = previous.includes(path);
      if (!isFavorite && previous.length >= MAX_FAVORITES) {
        toast.error(t.nav.favoriteLimitReached);
        return previous;
      }
      const next = isFavorite ? previous.filter(savedPath => savedPath !== path) : [...previous, path];
      localStorage.setItem(favoritesStorageKey, JSON.stringify(next));
      return next;
    });
  }, [favoritesStorageKey, permittedItemsByPath, t.nav.favoriteLimitReached]);

  // Keep the current page's section open and reduce sidebar noise by closing
  // the other sections. The user's manual choice remains saved until navigation.
  useEffect(() => {
    if (searchQuery.trim()) return;
    const activeSection = visibleSections.find(section => section.id !== "favorites" &&
      section.items.some(item =>
        location === item.path || (item.path !== "/" && location.startsWith(item.path)),
      ),
    );
    if (!activeSection) return;

    setCollapsedSections(previous => {
      const next = new Set(
        visibleSections
          .filter(section => section.id !== activeSection.id && section.id !== "favorites")
          .map(section => section.id),
      );
      if (previous.has("favorites")) next.add("favorites");
      const unchanged = previous.size === next.size && [...next].every(id => previous.has(id));
      if (unchanged) return previous;
      localStorage.setItem(COLLAPSED_SECTIONS_KEY, JSON.stringify([...next]));
      return next;
    });
  }, [location, searchQuery, visibleSections]);

  // ── Search filter ──
  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return null;
    const q = searchQuery.toLowerCase();
    const results: { label: string; path: string; icon: any; section: string }[] = [];
    permittedSections.forEach(s => {
      s.items.forEach(item => {
        if (item.label.toLowerCase().includes(q)) {
          results.push({ label: item.label, path: item.path, icon: item.icon, section: s.label });
        }
      });
    });
    return results;
  }, [searchQuery, permittedSections]);

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
        <Sidebar data-observer-navigation="true" collapsible="icon" className="border-l-0 border-r border-sidebar-border/40" side="right" disableTransition={isResizing}>

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
                          onClick={() => { navigateFromSidebar(item.path); setSearchQuery(""); }}
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
                  <div
                    key={section.id}
                    className={section.id === "favorites"
                      ? "mx-2 mb-2 mt-1 rounded-xl border border-amber-400/70 bg-amber-400/10 shadow-sm"
                      : sIdx > 0 ? "mt-1" : ""}
                  >
                    {/* Section Header */}
                    {!isCollapsed && (
                      <button
                        onClick={() => toggleSection(section.id)}
                        className={`w-full flex items-center justify-between group ${section.id === "favorites" ? "px-2.5 py-2" : "px-3 py-1.5"}`}
                      >
                        <div className="flex items-center gap-1.5">
                          <section.icon className={`h-3.5 w-3.5 ${section.id === "favorites" ? "fill-current text-amber-500" : "text-sidebar-foreground/35"}`} />
                          <span className={section.id === "favorites"
                            ? "text-sm font-extrabold text-amber-600 dark:text-amber-400"
                            : "text-xs font-bold uppercase tracking-wider text-sidebar-foreground/70 group-hover:text-sidebar-foreground/90 transition-colors"}>
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
                        {section.id === "favorites" && section.items.length === 0 && !isCollapsed && (
                          <p className="px-2 pb-2 text-[11px] font-medium leading-5 text-amber-700/80 dark:text-amber-300/80">
                            {t.nav.favoritesEmpty}
                          </p>
                        )}
                        {section.items.map(item => {
                          const isActive = isItemActive(item.path);
                          const isComingSoon = item.path === "/predictive";
                          return (
                            <SidebarMenuItem key={item.path} className="relative group/favorite">
                              <SidebarMenuButton
                                isActive={isActive}
                                onClick={() => {
                                  if (isComingSoon) {
                                    import("sonner").then(m => m.toast.info("الصيانة التنبؤية قيد التطوير"));
                                  } else {
                                    navigateFromSidebar(item.path);
                                  }
                                }}
                                tooltip={item.label}
                                className={`h-9 transition-all font-normal text-[13px] group/item ${!isCollapsed ? "pl-8" : ""} ${isComingSoon ? "opacity-60" : ""}`}
                              >
                                <item.icon className={`h-3.5 w-3.5 shrink-0 transition-colors ${isActive ? "text-sidebar-primary" : "text-sidebar-foreground/55 group-hover/item:text-sidebar-foreground/80"}`} />
                                <span className={`truncate ${isActive ? "font-medium" : ""}`}>{item.label}</span>
                                {isComingSoon && !isCollapsed && (
                                  <span className="mr-auto text-[9px] bg-amber-500/15 text-amber-600 dark:text-amber-400 px-1.5 py-0.5 rounded-full font-medium shrink-0">قريباً</span>
                                )}
                              </SidebarMenuButton>
                              {!isCollapsed && (
                                <button
                                  type="button"
                                  aria-label={favoritePaths.includes(item.path) ? t.nav.removeFromFavorites : t.nav.addToFavorites}
                                  title={favoritePaths.includes(item.path) ? t.nav.removeFromFavorites : t.nav.addToFavorites}
                                  onClick={event => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    toggleFavorite(item.path);
                                  }}
                                  className={`absolute left-2 top-1/2 z-10 -translate-y-1/2 rounded p-1 transition-all hover:bg-sidebar-accent focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-primary ${favoritePaths.includes(item.path) ? "text-amber-500 opacity-100" : "text-sidebar-foreground/35 opacity-0 group-hover/favorite:opacity-100"}`}
                                >
                                  <Star className={`h-3.5 w-3.5 ${favoritePaths.includes(item.path) ? "fill-current" : ""}`} />
                                </button>
                              )}
                            </SidebarMenuItem>
                          );
                        })}
                      </SidebarMenu>
                    )}

                    {/* Section Divider */}
                    {!isCollapsed && section.id !== "favorites" && sIdx < visibleSections.length - 1 && (
                      <div className="mx-3 border-b border-sidebar-border/25" />
                    )}
                  </div>
                );
              })
            )}

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
                        {(t.roles as any)[authenticatedUser?.role || user?.role || "user"] || authenticatedUser?.role || user?.role}
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
                    disabled={isReadOnly}
                    onClick={() => { setChangePwOpen(true); setCurrentPw(""); setNewPw(""); }}
                    className="cursor-pointer gap-2"
                  >
                    <KeyRound className="ml-2 h-4 w-4" />
                    <span>تغيير كلمة المرور</span>
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem data-observer-action="logout" onClick={logout} className="cursor-pointer text-destructive focus:text-destructive">
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
        <main className="flex-1 p-4 md:p-6"><ObserverReadOnlyBoundary active={!!isReadOnly}>{canAccessCurrentPath ? children : null}</ObserverReadOnlyBoundary></main>
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
                      onClick={() => { setLocation(ticketTeamNotificationPath(notif.eventKey, notif.relatedTicketId) ?? `/tickets/${notif.relatedTicketId}`); dismissPopup(notif.id); }}
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
