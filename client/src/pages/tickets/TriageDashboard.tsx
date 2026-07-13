import { useState, useMemo } from "react";
import { useTranslatedField, getLocalizedName } from "@/hooks/useTranslatedField";
import { trpc } from "@/lib/trpc";
import { useLanguage } from "@/contexts/LanguageContext";
import { useAuth } from "@/_core/hooks/useAuth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { SLATimer } from "@/components/tickets/SLATimer";
import { TechnicianCombobox } from "@/components/tickets/TechnicianCombobox";
import {
  ClipboardList, AlertTriangle, Eye, CheckCircle2,
  Zap, Search, ArrowRight, Clock, Microscope, Filter,
  X, MapPin, Tag, ChevronDown
} from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

// ─── Constants ───────────────────────────────────────────────────────────────

const PRIORITY_COLORS: Record<string, string> = {
  low: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  medium: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  high: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  critical: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
};

const PRIORITY_LABELS: Record<string, string> = {
  low: "منخفض", medium: "متوسط", high: "عالي", critical: "حرج",
};

const CATEGORY_LABELS: Record<string, string> = {
  electrical: "⚡ كهرباء",
  plumbing: "🔧 سباكة",
  hvac: "❄️ تكييف",
  structural: "🏗️ إنشائي",
  mechanical: "⚙️ ميكانيكي",
  general: "📋 عام",
  safety: "🦺 سلامة",
  cleaning: "🧹 نظافة",
};

const CATEGORY_BADGE_COLORS: Record<string, string> = {
  electrical: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  plumbing: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  hvac: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-300",
  structural: "bg-stone-100 text-stone-800 dark:bg-stone-900/30 dark:text-stone-300",
  mechanical: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  general: "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300",
  safety: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  cleaning: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
};

// ─── Types ────────────────────────────────────────────────────────────────────

type ActiveView = "all_pending" | "all_inspection" | "critical_pending";

// ─── Component ────────────────────────────────────────────────────────────────

export default function TriageDashboard() {
  const { getField } = useTranslatedField();
  const { t, language } = useLanguage();
  const { user } = useAuth();
  const utils = trpc.useUtils();

  // ── Data queries ──────────────────────────────────────────────────────────
  const { data: pendingTickets = [], isLoading: loadingPending } =
    trpc.tickets.list.useQuery({ status: "pending_triage" });

  const { data: inspectionTickets = [], isLoading: loadingInspection } =
    trpc.tickets.list.useQuery({ status: "under_inspection" });

  const { data: users = [] } = trpc.users.list.useQuery();
  // Phase 2: use users.listTechnicians as primary source; legacy technicians.list kept for compatibility
  // Phase 5: techniciansList (legacy) kept as silent fallback only — not shown as separate UI group
  const { data: userTechniciansList = [] } = trpc.users.listTechnicians.useQuery();
  const { data: techniciansList = [] } = trpc.technicians.list.useQuery(undefined);
  const { data: sites = [] } = trpc.sites.list.useQuery();

  // ── Active view (card click) ──────────────────────────────────────────────
  const [activeView, setActiveView] = useState<ActiveView>("all_pending");

  // ── Filters ───────────────────────────────────────────────────────────────
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [filterSiteId, setFilterSiteId] = useState<string>("all");
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [filterPriority, setFilterPriority] = useState<string>("all");

  const hasActiveFilters = searchText || filterSiteId !== "all" || filterCategory !== "all" || filterPriority !== "all";

  const clearFilters = () => {
    setSearchText("");
    setFilterSiteId("all");
    setFilterCategory("all");
    setFilterPriority("all");
  };

  // ── Dialogs ───────────────────────────────────────────────────────────────
  const [triageDialog, setTriageDialog] = useState<any>(null);
  const [triageForm, setTriageForm] = useState({
    ticketType: "internal" as "internal" | "external" | "procurement",
    priority: "",
    triageNotes: "",
    assignedToId: "",
  });

  const [inspectDialog, setInspectDialog] = useState<any>(null);
  const [inspectionNotes, setInspectionNotes] = useState("");

  // ── Quick Triage Dialog ───────────────────────────────────────────────────
  const [quickTriageDialog, setQuickTriageDialog] = useState<any>(null);
  const [quickTriageAssignedTo, setQuickTriageAssignedTo] = useState<string>("");

  // ── Mutations ─────────────────────────────────────────────────────────────
  const quickTriageMut = trpc.tickets.triageTicket.useMutation({
    onSuccess: () => {
      toast.success(t.triage.movedToInspection);
      utils.tickets.list.invalidate();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const triageMut = trpc.tickets.triage.useMutation({
    onSuccess: () => {
      toast.success(t.triage.sortedSuccess);
      utils.tickets.list.invalidate();
      setTriageDialog(null);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const inspectMut = trpc.tickets.inspectTicket.useMutation({
    onSuccess: () => {
      toast.success(t.triage.inspectionComplete);
      utils.tickets.list.invalidate();
      setInspectDialog(null);
      setInspectionNotes("");
    },
    onError: (e: any) => toast.error(e.message),
  });

  // ── Derived data ──────────────────────────────────────────────────────────
  // Phase 2: primary source is users with technician roles (via listTechnicians)
  // Legacy technicians.list kept as fallback for backward compatibility
  const technicians = userTechniciansList.length > 0
    ? userTechniciansList.map((u: any) => ({ ...u, id: u.id, name: u.name || u.email, role: u.role, specialty: u.specialty }))
    : techniciansList.length > 0
      ? techniciansList.map((tech: any) => ({ ...tech, id: tech.id, name: tech.name, role: "technician" }))
      : users.filter((u: any) =>
          ["technician", "maintenance_manager", "supervisor"].includes(u.role)
        );

  const criticalPending = useMemo(
    () => pendingTickets.filter((t: any) => t.priority === "critical"),
    [pendingTickets]
  );

  // Determine base list from active view
  const baseTickets = useMemo(() => {
    if (activeView === "all_pending") return pendingTickets;
    if (activeView === "all_inspection") return inspectionTickets;
    if (activeView === "critical_pending") return criticalPending;
    return pendingTickets;
  }, [activeView, pendingTickets, inspectionTickets, criticalPending]);

  // Apply local filters
  const filteredTickets = useMemo(() => {
    return baseTickets.filter((ticket: any) => {
      if (searchText && !ticket.title?.toLowerCase().includes(searchText.toLowerCase()) &&
          !ticket.ticketNumber?.toLowerCase().includes(searchText.toLowerCase())) return false;
      if (filterSiteId !== "all" && ticket.siteId !== parseInt(filterSiteId)) return false;
      if (filterCategory !== "all" && ticket.category !== filterCategory) return false;
      if (filterPriority !== "all" && ticket.priority !== filterPriority) return false;
      return true;
    });
  }, [baseTickets, searchText, filterSiteId, filterCategory, filterPriority]);

  const isLoading = activeView === "all_inspection" ? loadingInspection : loadingPending;
  const isInspectionView = activeView === "all_inspection";

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleFullTriage = () => {
    if (!triageDialog) return;
    triageMut.mutate({
      id: triageDialog.id,
      ticketType: triageForm.ticketType,
      priority: triageForm.priority || undefined,
      triageNotes: triageForm.triageNotes || undefined,
      assignedToId: triageForm.assignedToId ? parseInt(triageForm.assignedToId) : undefined,
    });
  };

  const openTriageDialog = (ticket: any) => {
    setTriageForm({
      ticketType: "internal",
      priority: ticket.priority || "medium",
      triageNotes: "",
      assignedToId: ticket.assignedToId?.toString() || "",
    });
    setTriageDialog(ticket);
  };

  const handleInspect = () => {
    if (!inspectDialog || !inspectionNotes.trim()) {
      toast.error("يجب إدخال ملاحظات الفحص");
      return;
    }
    inspectMut.mutate({ id: inspectDialog.id, inspectionNotes });
  };

  // ── Stat cards config ─────────────────────────────────────────────────────
  const statCards = [
    {
      id: "all_pending" as ActiveView,
      label: t.triage.awaitingSort,
      count: pendingTickets.length,
      icon: AlertTriangle,
      color: "purple",
      border: "border-purple-200",
      bg: "bg-purple-50/50 dark:bg-purple-900/10",
      countColor: "text-purple-700 dark:text-purple-300",
      iconColor: "text-purple-400",
      activeBorder: "border-purple-500",
      activeBg: "bg-purple-50 dark:bg-purple-900/20",
    },
    {
      id: "all_inspection" as ActiveView,
      label: t.triage.awaitingInspection,
      count: inspectionTickets.length,
      icon: Microscope,
      color: "blue",
      border: "border-blue-200",
      bg: "bg-blue-50/50 dark:bg-blue-900/10",
      countColor: "text-blue-700 dark:text-blue-300",
      iconColor: "text-blue-400",
      activeBorder: "border-blue-500",
      activeBg: "bg-blue-50 dark:bg-blue-900/20",
    },
    {
      id: "critical_pending" as ActiveView,
      label: t.triage.awaitingApproval,
      count: criticalPending.length,
      icon: AlertTriangle,
      color: "orange",
      border: "border-orange-200",
      bg: "bg-orange-50/50 dark:bg-orange-900/10",
      countColor: "text-orange-700 dark:text-orange-300",
      iconColor: "text-orange-400",
      activeBorder: "border-orange-500",
      activeBg: "bg-orange-50 dark:bg-orange-900/20",
    },
  ];

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">

      {/* ── Header ── */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
          <ClipboardList className="w-5 h-5 text-purple-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t.triage.title}</h1>
          <p className="text-sm text-muted-foreground">{t.triage.subtitle}</p>
        </div>
      </div>

      {/* ── Stat Cards (clickable) ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {statCards.map((card) => {
          const Icon = card.icon;
          const isActive = activeView === card.id;
          return (
            <button
              key={card.id}
              onClick={() => setActiveView(card.id)}
              className={`text-right w-full rounded-xl border-2 p-4 transition-all duration-200 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-400 ${
                isActive
                  ? `${card.activeBorder} ${card.activeBg} shadow-md`
                  : `${card.border} ${card.bg} hover:${card.activeBg}`
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="text-right">
                  <p className="text-sm text-muted-foreground font-medium">{card.label}</p>
                  <p className={`text-3xl font-bold mt-1 ${card.countColor}`}>{card.count}</p>
                  {isActive && (
                    <p className="text-xs text-muted-foreground mt-1">
                      {filteredTickets.length !== baseTickets.length
                        ? `${filteredTickets.length} من ${card.count} بعد الفلترة`
                        : "انقر للعرض"}
                    </p>
                  )}
                </div>
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                  isActive ? `bg-white/60 dark:bg-black/20` : `bg-white/40 dark:bg-black/10`
                }`}>
                  <Icon className={`w-6 h-6 ${card.iconColor}`} />
                </div>
              </div>
              {isActive && (
                <div className={`mt-3 h-1 rounded-full bg-gradient-to-r ${
                  card.color === "purple" ? "from-purple-400 to-purple-600" :
                  card.color === "blue" ? "from-blue-400 to-blue-600" :
                  "from-orange-400 to-orange-600"
                }`} />
              )}
            </button>
          );
        })}
      </div>

      {/* ── Filter Bar ── */}
      <Collapsible open={filtersOpen} onOpenChange={setFiltersOpen}>
        <div className="flex items-center gap-3">
          {/* Search */}
          <div className="relative flex-1">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="بحث برقم البلاغ أو العنوان..."
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              className="pr-9"
            />
          </div>

          {/* Toggle filters */}
          <CollapsibleTrigger asChild>
            <Button variant="outline" className={`gap-2 shrink-0 ${hasActiveFilters ? "border-purple-400 text-purple-700 bg-purple-50 dark:bg-purple-900/20" : ""}`}>
              <Filter className="w-4 h-4" />
              فلترة متقدمة
              {hasActiveFilters && (
                <Badge className="bg-purple-600 text-white text-xs px-1.5 py-0 h-4">
                  {[filterSiteId !== "all", filterCategory !== "all", filterPriority !== "all"].filter(Boolean).length}
                </Badge>
              )}
              <ChevronDown className={`w-4 h-4 transition-transform ${filtersOpen ? "rotate-180" : ""}`} />
            </Button>
          </CollapsibleTrigger>

          {/* Clear filters */}
          {hasActiveFilters && (
            <Button variant="ghost" size="icon" onClick={clearFilters} title="مسح الفلاتر">
              <X className="w-4 h-4 text-muted-foreground" />
            </Button>
          )}
        </div>

        <CollapsibleContent>
          <div className="mt-3 p-4 rounded-xl border bg-muted/30 grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* Site filter */}
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                <MapPin className="w-3.5 h-3.5" />
                الموقع
              </Label>
              <Select value={filterSiteId} onValueChange={setFilterSiteId}>
                <SelectTrigger>
                  <SelectValue placeholder="جميع المواقع" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">🌐 جميع المواقع</SelectItem>
                  {(sites as any[]).map((site: any) => (
                    <SelectItem key={site.id} value={site.id.toString()}>
                      📍 {getLocalizedName(site, language)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Category filter */}
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                <Tag className="w-3.5 h-3.5" />
                التصنيف
              </Label>
              <Select value={filterCategory} onValueChange={setFilterCategory}>
                <SelectTrigger>
                  <SelectValue placeholder="جميع التصنيفات" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">📋 جميع التصنيفات</SelectItem>
                  {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
                    <SelectItem key={key} value={key}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Priority filter */}
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                <AlertTriangle className="w-3.5 h-3.5" />
                الأولوية
              </Label>
              <Select value={filterPriority} onValueChange={setFilterPriority}>
                <SelectTrigger>
                  <SelectValue placeholder="جميع الأولويات" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">🔘 جميع الأولويات</SelectItem>
                  <SelectItem value="critical">🔴 حرجة</SelectItem>
                  <SelectItem value="high">🟠 عالية</SelectItem>
                  <SelectItem value="medium">🟡 متوسطة</SelectItem>
                  <SelectItem value="low">🟢 منخفضة</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>

      {/* ── Section title ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold">
                      {activeView === "all_pending" && t.triage.awaitingSort}
                      {activeView === "all_inspection" && t.triage.awaitingInspection}
                      {activeView === "critical_pending" && t.triage.awaitingApproval}
          </h2>
          <Badge variant="secondary" className="font-mono">
            {filteredTickets.length}
            {filteredTickets.length !== baseTickets.length && ` / ${baseTickets.length}`}
          </Badge>
        </div>
        {hasActiveFilters && (
          <button
            onClick={clearFilters}
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
          >
            <X className="w-3 h-3" />
            مسح الفلاتر
          </button>
        )}
      </div>

      {/* ── Tickets List ── */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-24 rounded-xl bg-muted animate-pulse" />
          ))}
        </div>
      ) : filteredTickets.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <CheckCircle2 className="w-14 h-14 text-green-400 mx-auto mb-4" />
            <p className="text-base font-medium text-muted-foreground">
              {hasActiveFilters ? "لا توجد نتائج تطابق الفلاتر المحددة" :
               activeView === "all_pending" ? "لا توجد بلاغات بانتظار الفرز" :
               activeView === "all_inspection" ? "لا توجد بلاغات قيد الفحص" :
               "لا توجد بلاغات حرجة بانتظار الفرز"}
            </p>
            {hasActiveFilters && (
              <Button variant="outline" size="sm" className="mt-3" onClick={clearFilters}>
                مسح الفلاتر
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filteredTickets.map((ticket: any) => (
            <Card
              key={ticket.id}
              className={`hover:shadow-md transition-all duration-200 border-l-4 ${
                isInspectionView ? "border-l-blue-400" :
                ticket.priority === "critical" ? "border-l-red-500" :
                ticket.priority === "high" ? "border-l-orange-400" :
                "border-l-purple-400"
              }`}
            >
              <CardContent className="py-4">
                <div className="flex items-start justify-between gap-4 flex-wrap">

                  {/* ── Ticket Info ── */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                      <span className="text-xs font-mono text-muted-foreground bg-muted px-2 py-0.5 rounded">
                        {ticket.ticketNumber}
                      </span>
                      <Badge className={`text-xs ${PRIORITY_COLORS[ticket.priority] || "bg-gray-100 text-gray-700"}`}>
                        {PRIORITY_LABELS[ticket.priority] || ticket.priority}
                      </Badge>
                      {ticket.category && (
                        <Badge className={`text-xs ${CATEGORY_BADGE_COLORS[ticket.category] || "bg-gray-100 text-gray-700"}`}>
                          {CATEGORY_LABELS[ticket.category] || ticket.category}
                        </Badge>
                      )}
                    </div>

                    <h3 className="font-semibold text-base leading-snug">{getField(ticket, "title")}</h3>

                    {ticket.description && (
                      <p className="text-sm text-muted-foreground mt-1 line-clamp-1">{getField(ticket, "description")}</p>
                    )}

                    <div className="flex items-center gap-4 mt-2.5 text-xs text-muted-foreground flex-wrap">
                      <SLATimer
                        createdAt={ticket.createdAt}
                        statusChangedAt={ticket.updatedAt}
                        statusLabel={isInspectionView ? t.triage.awaitingInspection : t.triage.awaitingSort}
                        compact
                      />
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {new Date(ticket.createdAt).toLocaleString("ar-SA")}
                      </span>
                      {ticket.siteName && (
                        <span className="flex items-center gap-1">
                          <MapPin className="w-3 h-3" />
                          {ticket.siteName}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* ── Actions ── */}
                  <div className="flex gap-2 shrink-0 flex-wrap">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => window.location.href = `/tickets/${ticket.id}`}
                    >
                      <Eye className="w-4 h-4 ml-1" />
                      {t.triage.viewDetails}
                    </Button>

                    {/* PENDING_TRIAGE actions */}
                    {!isInspectionView && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-blue-300 text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-900/20"
                          onClick={() => { setQuickTriageDialog(ticket); setQuickTriageAssignedTo(""); }}
                          disabled={quickTriageMut.isPending}
                          title="نقل سريع لمرحلة الفحص مع تعيين فني"
                        >
                          <Zap className="w-4 h-4 ml-1" />
                          {t.triage.sortTicket}
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => openTriageDialog(ticket)}
                          className="bg-purple-600 hover:bg-purple-700 text-white"
                        >
                          <ClipboardList className="w-4 h-4 ml-1" />
                          {t.triage.sortTicket}
                        </Button>
                      </>
                    )}

                    {/* UNDER_INSPECTION action */}
                    {isInspectionView && (
                      <Button
                        size="sm"
                        onClick={() => {
                          setInspectDialog(ticket);
                          setInspectionNotes("");
                        }}
                        className="bg-blue-600 hover:bg-blue-700 text-white"
                      >
                        <Search className="w-4 h-4 ml-1" />
                        {t.triage.inspectTicket}
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* ── Quick Triage Dialog ── */}
      <Dialog open={!!quickTriageDialog} onOpenChange={() => setQuickTriageDialog(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Zap className="w-5 h-5 text-blue-600" />
              فرز سريع
            </DialogTitle>
          </DialogHeader>
          {quickTriageDialog && (
            <div className="space-y-4">
              <div className="p-3 bg-muted rounded-lg">
                <p className="font-medium text-sm">{quickTriageDialog.ticketNumber}</p>
                <p className="text-sm text-muted-foreground">{quickTriageDialog.title}</p>
              </div>
              <div className="space-y-2">
                <Label>تعيين فني <span className="text-muted-foreground text-xs">(اختياري)</span></Label>
                <TechnicianCombobox
                  value={quickTriageAssignedTo}
                  onValueChange={setQuickTriageAssignedTo}
                  placeholder="اختر فنيًا للفحص..."
                  options={[
                    { value: "none", label: "بدون تعيين", render: <span>— بدون تعيين</span> },
                    ...technicians.map((tech: any) => {
                      const roleLabel = tech.role === "technician" ? "فني" : tech.role === "supervisor" ? "مشرف" : "مدير صيانة";
                      return {
                        value: tech.id.toString(),
                        label: `${tech.name} (${roleLabel})`,
                        render: (
                          <span className="flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-green-400 inline-block" />
                            {tech.name}
                            <span className="text-xs text-muted-foreground">({roleLabel})</span>
                          </span>
                        ),
                      };
                    }),
                  ]}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                سيتم نقل البلاغ مباشرة إلى مرحلة الفحص الميداني.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setQuickTriageDialog(null)}>إلغاء</Button>
            <Button
              onClick={() => {
                if (!quickTriageDialog) return;
                const assignedToId = quickTriageAssignedTo && quickTriageAssignedTo !== "none"
                  ? parseInt(quickTriageAssignedTo)
                  : undefined;
                quickTriageMut.mutate({ id: quickTriageDialog.id, assignedToId });
                setQuickTriageDialog(null);
              }}
              disabled={quickTriageMut.isPending}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              <Zap className="w-4 h-4 ml-1" />
              {quickTriageMut.isPending ? "جاري..." : "تأكيد الفرز"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Full Triage Dialog ── */}
      <Dialog open={!!triageDialog} onOpenChange={() => setTriageDialog(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ClipboardList className="w-5 h-5 text-purple-600" />
              فرز وتصنيف البلاغ
            </DialogTitle>
          </DialogHeader>
          {triageDialog && (
            <div className="space-y-4">
              <div className="p-3 bg-muted rounded-lg">
                <p className="font-medium text-sm">{triageDialog.ticketNumber}</p>
                <p className="text-sm text-muted-foreground">{triageDialog.title}</p>
              </div>

              <div className="space-y-2">
                <Label>نوع البلاغ *</Label>
                <Select
                  value={triageForm.ticketType}
                  onValueChange={(v: any) => setTriageForm(f => ({ ...f, ticketType: v }))}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="internal">داخلي (صيانة داخلية)</SelectItem>
                    <SelectItem value="external">خارجي (صيانة خارجية)</SelectItem>
                    <SelectItem value="procurement">مشتريات (يحتاج قطع غيار)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>الأولوية</Label>
                <Select
                  value={triageForm.priority}
                  onValueChange={(v) => setTriageForm(f => ({ ...f, priority: v }))}
                >
                  <SelectTrigger><SelectValue placeholder="اختر الأولوية" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">🟢 منخفضة</SelectItem>
                    <SelectItem value="medium">🟡 متوسطة</SelectItem>
                    <SelectItem value="high">🟠 عالية</SelectItem>
                    <SelectItem value="critical">🔴 حرجة</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>تعيين فريق الفحص</Label>
                <TechnicianCombobox
                  value={triageForm.assignedToId}
                  onValueChange={(v) => setTriageForm(f => ({ ...f, assignedToId: v }))}
                  placeholder="اختر الفني أو المسؤول"
                  options={technicians.map((tech: any) => {
                    const roleLabel = tech.role === "technician" ? "فني" : tech.role === "supervisor" ? "مشرف" : "مدير صيانة";
                    return {
                      value: tech.id.toString(),
                      label: `${tech.name} (${roleLabel})`,
                    };
                  })}
                />
              </div>

              <div className="space-y-2">
                <Label>ملاحظات الفرز</Label>
                <Textarea
                  value={triageForm.triageNotes}
                  onChange={(e) => setTriageForm(f => ({ ...f, triageNotes: e.target.value }))}
                  placeholder="أي ملاحظات أو توجيهات للفحص..."
                  rows={3}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setTriageDialog(null)}>إلغاء</Button>
            <Button
              onClick={handleFullTriage}
              disabled={triageMut.isPending}
              className="bg-purple-600 hover:bg-purple-700 text-white"
            >
              <ArrowRight className="w-4 h-4 ml-1" />
              {triageMut.isPending ? "جاري الحفظ..." : "تأكيد الفرز"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Inspect Dialog ── */}
      <Dialog open={!!inspectDialog} onOpenChange={() => setInspectDialog(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Search className="w-5 h-5 text-blue-600" />
              إكمال الفحص الميداني
            </DialogTitle>
          </DialogHeader>
          {inspectDialog && (
            <div className="space-y-4">
              <div className="p-3 bg-muted rounded-lg">
                <p className="font-medium text-sm">{inspectDialog.ticketNumber}</p>
                <p className="text-sm text-muted-foreground">{inspectDialog.title}</p>
              </div>
              <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
                <p className="text-xs text-blue-700 dark:text-blue-300">
                  بعد إكمال الفحص، سيُرسل إشعار تلقائي لمدير الصيانة للموافقة على بدء العمل واختيار المسار (A/B/C).
                </p>
              </div>
              <div className="space-y-2">
                <Label>ملاحظات الفحص الميداني *</Label>
                <Textarea
                  value={inspectionNotes}
                  onChange={(e) => setInspectionNotes(e.target.value)}
                  placeholder="وصف الحالة الفنية، المشكلة المكتشفة، التوصيات..."
                  rows={4}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setInspectDialog(null)}>إلغاء</Button>
            <Button
              onClick={handleInspect}
              disabled={inspectMut.isPending || !inspectionNotes.trim()}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              <CheckCircle2 className="w-4 h-4 ml-1" />
              {inspectMut.isPending ? "جاري الحفظ..." : "إكمال الفحص"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
