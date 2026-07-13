import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Users, Trophy, Clock, TrendingUp, BarChart3, Target,
  ArrowUp, ArrowDown, Minus, Loader2, AlertCircle, Zap,
  CheckCircle2, Timer, Activity
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip,
  ResponsiveContainer, RadarChart, PolarGrid, PolarAngleAxis,
  PolarRadiusAxis, Radar, Legend, LineChart, Line, PieChart, Pie, Cell
} from "recharts";
import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { CalendarDays, Filter, Search, MapPin, Building2, X } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { useStaticLabels } from "@/hooks/useContentTranslation";

const COLORS = ["#0ea5e9", "#8b5cf6", "#f59e0b", "#10b981", "#ef4444", "#ec4899", "#6366f1", "#14b8a6"];

// priorityLabels will use t.priority from translation

// categoryLabels will use t.category from translation

function getScoreColor(score: number) {
  if (score >= 80) return "text-emerald-600";
  if (score >= 60) return "text-amber-600";
  if (score >= 40) return "text-orange-600";
  return "text-red-600";
}

function getScoreBg(score: number) {
  if (score >= 80) return "bg-emerald-50 border-emerald-200";
  if (score >= 60) return "bg-amber-50 border-amber-200";
  if (score >= 40) return "bg-orange-50 border-orange-200";
  return "bg-red-50 border-red-200";
}

function getScoreLabel(score: number, t: any) {
  if (score >= 80) return t.techReport?.scoreExcellent || "ممتاز";
  if (score >= 60) return t.techReport?.scoreGood || "جيد";
  if (score >= 40) return t.techReport?.scoreAcceptable || "مقبول";
  return t.techReport?.scoreNeedsImprovement || "يحتاج تحسين";
}

function getScoreIcon(score: number) {
  if (score >= 80) return <ArrowUp className="h-4 w-4 text-emerald-600" />;
  if (score >= 60) return <Minus className="h-4 w-4 text-amber-600" />;
  return <ArrowDown className="h-4 w-4 text-red-600" />;
}

function formatHours(hours: number, t?: any) {
  if (hours === 0) return "—";
  const minLabel = t?.techReport?.minutes || "دقيقة";
  const hrLabel = t?.techReport?.hour || "ساعة";
  const dayLabel = t?.techReport?.day || "يوم";
  const andLabel = t?.techReport?.and || "و";
  if (hours < 1) return `${Math.round(hours * 60)} ${minLabel}`;
  if (hours < 24) return `${hours.toFixed(1)} ${hrLabel}`;
  const days = Math.floor(hours / 24);
  const remainingHours = Math.round(hours % 24);
  return `${days} ${dayLabel} ${remainingHours > 0 ? `${andLabel} ${remainingHours} ${hrLabel}` : ""}`;
}

function formatMonth(monthStr: string) {
  const [, month] = monthStr.split("-");
  // Use Intl for locale-aware month names
  const date = new Date(2024, parseInt(month) - 1, 1);
  return date.toLocaleDateString(undefined, { month: 'long' });
}

type PeriodType = "all" | "week" | "month" | "quarter" | "year" | "custom";

// periodLabels will be built from t.techReport in the component

function formatDateInput(date: Date): string {
  return date.toISOString().split("T")[0];
}

export default function TechnicianReport() {
  const { t, language } = useLanguage();
  const { getPriorityLabel, getCategoryLabel } = useStaticLabels();

  const periodLabels: Record<PeriodType, string> = {
    all: t.techReport?.all || "الكل",
    week: t.techReport?.lastWeek || "آخر أسبوع",
    month: t.techReport?.lastMonth || "آخر شهر",
    quarter: t.techReport?.lastQuarter || "آخر 3 أشهر",
    year: t.techReport?.lastYear || "آخر سنة",
    custom: t.techReport?.customPeriod || "فترة مخصصة",
  };
  const [selectedPeriod, setSelectedPeriod] = useState<PeriodType>("all");
  const [customDateFrom, setCustomDateFrom] = useState<string>("");
  const [customDateTo, setCustomDateTo] = useState<string>("");
  const [showCustomPicker, setShowCustomPicker] = useState(false);
  const [selectedTech, setSelectedTech] = useState<number | null>(null);
  // New filters
  const [filterSiteId, setFilterSiteId] = useState<number | undefined>(undefined);
  const [filterSectionId, setFilterSectionId] = useState<number | undefined>(undefined);
  const [filterTechName, setFilterTechName] = useState<string>("");

  // Fetch sites and sections for filter dropdowns
  const { data: sitesData } = trpc.sites.list.useQuery();
  const { data: sectionsData } = trpc.sections.list.useQuery(
    filterSiteId ? { siteId: filterSiteId } : undefined
  );

  const queryInput = useMemo(() => {
    const base: Record<string, any> = { period: selectedPeriod as PeriodType };
    if (selectedPeriod === "custom" && customDateFrom && customDateTo) {
      base.dateFrom = customDateFrom;
      base.dateTo = customDateTo;
    }
    if (filterSiteId) base.siteId = filterSiteId;
    if (filterSectionId) base.sectionId = filterSectionId;
    if (filterTechName.trim()) base.technicianName = filterTechName.trim();
    return base;
  }, [selectedPeriod, customDateFrom, customDateTo, filterSiteId, filterSectionId, filterTechName]);

  const hasActiveFilters = !!filterSiteId || !!filterSectionId || !!filterTechName.trim();

  const clearFilters = () => {
    setFilterSiteId(undefined);
    setFilterSectionId(undefined);
    setFilterTechName("");
  };

  const { data: techData, isLoading, error } = trpc.reports.technicianPerformance.useQuery(queryInput);
  const { data: extTechData, isLoading: extLoading } = trpc.reports.externalTechnicianPerformance.useQuery(queryInput);

  const handlePeriodChange = (period: PeriodType) => {
    if (period === "custom") {
      setShowCustomPicker(true);
      // Set default custom range to last month
      if (!customDateFrom || !customDateTo) {
        const now = new Date();
        const monthAgo = new Date();
        monthAgo.setMonth(monthAgo.getMonth() - 1);
        setCustomDateFrom(formatDateInput(monthAgo));
        setCustomDateTo(formatDateInput(now));
      }
      setSelectedPeriod("custom");
    } else {
      setShowCustomPicker(false);
      setSelectedPeriod(period);
    }
  };

  const getPeriodDescription = (): string => {
    if (selectedPeriod === "all") return t.techReport?.allPeriods || "جميع الفترات";
    if (selectedPeriod === "custom" && customDateFrom && customDateTo) {
      return `${t.common.from} ${customDateFrom} ${t.common.to} ${customDateTo}`;
    }
    return periodLabels[selectedPeriod];
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center space-y-4">
          <Loader2 className="h-10 w-10 animate-spin text-primary mx-auto" />
          <p className="text-muted-foreground">{t.techReport?.loading || "جاري تحميل تقرير أداء الفنيين..."}</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Card className="max-w-md w-full">
          <CardContent className="pt-6 text-center space-y-4">
            <AlertCircle className="h-12 w-12 text-destructive mx-auto" />
            <p className="text-lg font-semibold">{t.techReport?.loadError || "حدث خطأ في تحميل التقرير"}</p>
            <p className="text-muted-foreground text-sm">{error.message}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const techs = techData || [];

  if (techs.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Card className="max-w-md w-full">
          <CardContent className="pt-6 text-center space-y-4">
            <Users className="h-12 w-12 text-muted-foreground mx-auto" />
            <p className="text-lg font-semibold">{t.techReport.noTechs}</p>
            <p className="text-muted-foreground text-sm">{t.techReport.addTechsHint}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Summary stats
  const totalTickets = techs.reduce((s, t) => s + t.totalAssigned, 0);
  const totalCompleted = techs.reduce((s, t) => s + t.completed, 0);
  const avgScore = techs.length > 0 ? Math.round(techs.reduce((s, t) => s + t.performanceScore, 0) / techs.length) : 0;
  const avgResolution = techs.filter(t => t.avgResolutionHours > 0);
  const overallAvgHours = avgResolution.length > 0 ? avgResolution.reduce((s, t) => s + t.avgResolutionHours, 0) / avgResolution.length : 0;

  // Comparison chart data
  const assignedLabel = t.reports.totalAssigned;
  const completedLabel = t.reports.completed;
  const inProgressLabel = t.reports.inProgress;
  const comparisonData = techs.map(tech => ({
    name: tech.technician.name || `Tech #${tech.technician.id}`,
    [assignedLabel]: tech.totalAssigned,
    [completedLabel]: tech.completed,
    [inProgressLabel]: tech.inProgress,
  }));

  // Radar chart data for selected technician
  const selectedTechData = selectedTech !== null ? techs.find(t => t.technician.id === selectedTech) : techs[0];
  const radarData = selectedTechData ? [
    { metric: t.reports.completionRate, value: selectedTechData.completionRate, fullMark: 100 },
    { metric: t.techReport?.speedLabel || "سرعة الحل", value: selectedTechData.avgResolutionHours > 0 ? Math.max(0, Math.round(100 - (selectedTechData.avgResolutionHours / 720) * 100)) : 0, fullMark: 100 },
    { metric: t.techReport?.workloadLabel || "حجم العمل", value: Math.min(100, selectedTechData.totalAssigned * 5), fullMark: 100 },
    { metric: t.techReport?.criticalLabel || "البلاغات الحرجة", value: Math.min(100, (selectedTechData.priorityBreakdown?.critical || 0) * 20), fullMark: 100 },
    { metric: t.techReport?.diversityLabel || "التنوع", value: Math.min(100, Object.keys(selectedTechData.categoryBreakdown || {}).length * 20), fullMark: 100 },
  ] : [];

  // Score distribution for pie chart
  const scoreDistribution = [
    { name: `${t.techReport.scoreExcellent} (80+)`, value: techs.filter(t => t.performanceScore >= 80).length, color: "#10b981" },
    { name: `${t.techReport.scoreGood} (60-79)`, value: techs.filter(t => t.performanceScore >= 60 && t.performanceScore < 80).length, color: "#f59e0b" },
    { name: `${t.techReport.scoreAcceptable} (40-59)`, value: techs.filter(t => t.performanceScore >= 40 && t.performanceScore < 60).length, color: "#f97316" },
    { name: `${t.techReport.scoreNeedsImprovement} (<40)`, value: techs.filter(t => t.performanceScore < 40).length, color: "#ef4444" },
  ].filter(d => d.value > 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-3">
              <div className="p-2 bg-primary/10 rounded-lg">
                <Activity className="h-6 w-6 text-primary" />
              </div>
              {t.reports.techPerformance}
            </h1>
            <p className="text-muted-foreground mt-1">{t.reports.overview} — <span className="font-medium text-foreground">{getPeriodDescription()}</span></p>
          </div>
          <Badge variant="outline" className="text-sm px-3 py-1">
            {techs.length} {t.nav.technicians || "فني"}
          </Badge>
        </div>

        {/* Time Filter Bar */}
        <Card className="border-dashed">
          <CardContent className="py-3 px-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Filter className="h-4 w-4" />
                <span className="font-medium">{t.techReport.lastWeek?.replace("آخر ", "") || "الفترة"}{t.common.colon || ":"}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {(["all", "week", "month", "quarter", "year"] as PeriodType[]).map((period) => (
                  <Button
                    key={period}
                    variant={selectedPeriod === period ? "default" : "outline"}
                    size="sm"
                    onClick={() => handlePeriodChange(period)}
                    className="text-xs h-8"
                  >
                    {periodLabels[period]}
                  </Button>
                ))}
                <Popover open={showCustomPicker} onOpenChange={setShowCustomPicker}>
                  <PopoverTrigger asChild>
                    <Button
                      variant={selectedPeriod === "custom" ? "default" : "outline"}
                      size="sm"
                      onClick={() => handlePeriodChange("custom")}
                      className="text-xs h-8 gap-1"
                    >
                      <CalendarDays className="h-3.5 w-3.5" />
                      {selectedPeriod === "custom" && customDateFrom && customDateTo
                        ? `${customDateFrom} → ${customDateTo}`
                        : t.techReport.customPeriod}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-4" align="start">
                    <div className="space-y-3">
                      <p className="text-sm font-medium">{t.techReport.customPeriod}</p>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <label className="text-xs text-muted-foreground">{t.common.from}</label>
                          <input
                            type="date"
                            value={customDateFrom}
                            onChange={(e) => setCustomDateFrom(e.target.value)}
                            className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm shadow-sm"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs text-muted-foreground">{t.common.to}</label>
                          <input
                            type="date"
                            value={customDateTo}
                            onChange={(e) => setCustomDateTo(e.target.value)}
                            className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm shadow-sm"
                          />
                        </div>
                      </div>
                      <Button
                        size="sm"
                        className="w-full"
                        onClick={() => {
                          if (customDateFrom && customDateTo) {
                            setSelectedPeriod("custom");
                            setShowCustomPicker(false);
                          }
                        }}
                        disabled={!customDateFrom || !customDateTo}
                      >
                        {t.common.apply || "تطبيق"}
                      </Button>
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Advanced Filters: Technician Name, Site, Section */}
        <Card className="border-dashed">
          <CardContent className="py-3 px-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2 text-sm text-muted-foreground shrink-0">
                <Search className="h-4 w-4" />
                <span className="font-medium">{t.common.filter || "تصفية"} {t.nav.technicians || "الفنيين"}:</span>
              </div>
              {/* Technician Name Search */}
              <div className="relative min-w-[180px]">
                <Search className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder={`${t.nav.technicians || "اسم الفني"}...`}
                  value={filterTechName}
                  onChange={(e) => setFilterTechName(e.target.value)}
                  className="h-8 text-xs pr-8 w-full"
                />
              </div>
              {/* Site Filter */}
              <div className="flex items-center gap-1.5 min-w-[160px]">
                <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <Select
                  value={filterSiteId ? String(filterSiteId) : "all"}
                  onValueChange={(v) => {
                    const id = v === "all" ? undefined : Number(v);
                    setFilterSiteId(id);
                    setFilterSectionId(undefined); // reset section when site changes
                  }}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder={t.common.allSites || "كل المواقع"} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t.common.allSites || "كل المواقع"}</SelectItem>
                    {(sitesData || []).map((s: any) => (
                      <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {/* Section Filter */}
              <div className="flex items-center gap-1.5 min-w-[160px]">
                <Building2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <Select
                  value={filterSectionId ? String(filterSectionId) : "all"}
                  onValueChange={(v) => setFilterSectionId(v === "all" ? undefined : Number(v))}
                  disabled={!filterSiteId}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder={filterSiteId ? (t.common.allSections || "كل الأقسام") : (t.common.selectSiteFirst || "اختر موقعاً أولاً")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t.common.allSections || "كل الأقسام"}</SelectItem>
                    {(sectionsData || []).map((s: any) => (
                      <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {/* Clear Filters */}
              {hasActiveFilters && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearFilters}
                  className="h-8 text-xs text-destructive hover:text-destructive gap-1"
                >
                  <X className="h-3.5 w-3.5" />
                  {t.common.clearFilters || "مسح الفلاتر"}
                </Button>
              )}
              {/* Active filter badges */}
              {hasActiveFilters && (
                <div className="flex flex-wrap gap-1.5 mr-auto">
                  {filterSiteId && sitesData && (
                    <Badge variant="secondary" className="text-xs gap-1">
                      <MapPin className="h-3 w-3" />
                      {sitesData.find((s: any) => s.id === filterSiteId)?.name}
                    </Badge>
                  )}
                  {filterSectionId && sectionsData && (
                    <Badge variant="secondary" className="text-xs gap-1">
                      <Building2 className="h-3 w-3" />
                      {sectionsData.find((s: any) => s.id === filterSectionId)?.name}
                    </Badge>
                  )}
                  {filterTechName.trim() && (
                    <Badge variant="secondary" className="text-xs gap-1">
                      <Search className="h-3 w-3" />
                      {filterTechName.trim()}
                    </Badge>
                  )}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="hover:shadow-lg hover:border-primary/20 transition-all duration-200">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{t.reports.totalAssigned}</p>
                <p className="text-3xl font-bold mt-1">{totalTickets}</p>
              </div>
              <div className="p-3 bg-blue-50 rounded-xl">
                <BarChart3 className="h-6 w-6 text-blue-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="hover:shadow-lg hover:border-primary/20 transition-all duration-200">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{t.reports.completed}</p>
                <p className="text-3xl font-bold mt-1 text-emerald-600">{totalCompleted}</p>
              </div>
              <div className="p-3 bg-emerald-50 rounded-xl">
                <CheckCircle2 className="h-6 w-6 text-emerald-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="hover:shadow-lg hover:border-primary/20 transition-all duration-200">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{t.techReport.speedLabel}</p>
                <p className="text-2xl font-bold mt-1">{formatHours(Math.round(overallAvgHours * 10) / 10, t)}</p>
              </div>
              <div className="p-3 bg-amber-50 rounded-xl">
                <Timer className="h-6 w-6 text-amber-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="hover:shadow-lg hover:border-primary/20 transition-all duration-200">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{t.reports.performanceScore}</p>
                <p className={`text-3xl font-bold mt-1 ${getScoreColor(avgScore)}`}>{avgScore}%</p>
              </div>
              <div className="p-3 bg-purple-50 rounded-xl">
                <Trophy className="h-6 w-6 text-purple-600" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList className="grid w-full grid-cols-6 lg:w-auto lg:inline-grid">
          <TabsTrigger value="overview">{t.reports.overview}</TabsTrigger>
          <TabsTrigger value="comparison">{t.reports.comparison}</TabsTrigger>
          <TabsTrigger value="details">{t.common.details}</TabsTrigger>
          <TabsTrigger value="trends">{t.reports.monthlyTrend}</TabsTrigger>
          <TabsTrigger value="external">{t.techReport?.externalTechs || "الفنيون الخارجيون"}</TabsTrigger>
          <TabsTrigger value="monthly-pm">🔍 {t.techReport?.pmPerformance || "أداء الفحوص"}</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Ranking Table */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Trophy className="h-5 w-5 text-amber-500" />
                  {t.techReport?.rankByPerformance || "ترتيب الفنيين حسب الأداء"}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {techs.map((tech, index) => (
                    <div
                      key={tech.technician.id}
                      className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all duration-200 ${
                        (selectedTech || techs[0]?.technician.id) === tech.technician.id
                          ? "border-primary bg-primary/5 shadow-sm"
                          : "hover:border-primary/30 hover:bg-muted/50"
                      }`}
                      onClick={() => setSelectedTech(tech.technician.id)}
                    >
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                        index === 0 ? "bg-amber-100 text-amber-700" :
                        index === 1 ? "bg-gray-100 text-gray-700" :
                        index === 2 ? "bg-orange-100 text-orange-700" :
                        "bg-muted text-muted-foreground"
                      }`}>
                        {index + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{tech.technician.name || `Tech #${tech.technician.id}`}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-xs text-muted-foreground">{tech.completed}/{tech.totalAssigned} {t.nav.tickets || "بلاغ"}</span>
                          <span className="text-xs text-muted-foreground">|</span>
                          <span className="text-xs text-muted-foreground">{formatHours(tech.avgResolutionHours, t)}</span>
                        </div>
                      </div>
                      <div className="text-left">
                        <div className={`text-lg font-bold ${getScoreColor(tech.performanceScore)}`}>
                          {tech.performanceScore}%
                        </div>
                        <div className="flex items-center gap-1 justify-end">
                          {getScoreIcon(tech.performanceScore)}
                          <span className={`text-xs ${getScoreColor(tech.performanceScore)}`}>
                            {getScoreLabel(tech.performanceScore, t)}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Radar Chart */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Target className="h-5 w-5 text-primary" />
                  {t.techReport?.performanceAnalysis || "تحليل الأداء"} — {selectedTechData?.technician.name || ""}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={320}>
                  <RadarChart data={radarData}>
                    <PolarGrid stroke="#e5e7eb" />
                    <PolarAngleAxis dataKey="metric" tick={{ fontSize: 12 }} />
                    <PolarRadiusAxis angle={90} domain={[0, 100]} tick={{ fontSize: 10 }} />
                    <Radar name={t.techReport?.performance || "الأداء"} dataKey="value" stroke="#0ea5e9" fill="#0ea5e9" fillOpacity={0.3} strokeWidth={2} />
                  </RadarChart>
                </ResponsiveContainer>
                {selectedTechData && (
                  <div className="grid grid-cols-3 gap-3 mt-4">
                    <div className="text-center p-2 bg-muted/50 rounded-lg">
                      <p className="text-xs text-muted-foreground">{t.reports.completionRate}</p>
                      <p className="font-bold text-sm">{selectedTechData.completionRate}%</p>
                    </div>
                    <div className="text-center p-2 bg-muted/50 rounded-lg">
                      <p className="text-xs text-muted-foreground">{t.techReport.speedLabel}</p>
                      <p className="font-bold text-sm">{formatHours(selectedTechData.avgResolutionHours, t)}</p>
                    </div>
                    <div className="text-center p-2 bg-muted/50 rounded-lg">
                      <p className="text-xs text-muted-foreground">{t.reports.performanceScore}</p>
                      <p className={`font-bold text-sm ${getScoreColor(selectedTechData.performanceScore)}`}>
                        {selectedTechData.performanceScore}%
                      </p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Score Distribution */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Zap className="h-5 w-5 text-amber-500" />
                  {t.techReport?.scoreDistribution || "توزيع مستويات الأداء"}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={250}>
                  <PieChart>
                    <Pie
                      data={scoreDistribution}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={90}
                      paddingAngle={4}
                      dataKey="value"
                      label={({ name, value }) => `${name}: ${value}`}
                    >
                      {scoreDistribution.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <RechartsTooltip />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Quick Stats per Tech */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <TrendingUp className="h-5 w-5 text-emerald-500" />
                  {t.techReport?.quickSummary || "ملخص سريع"}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {techs.slice(0, 5).map(tech => (
                  <div key={tech.technician.id} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">{tech.technician.name || `Tech #${tech.technician.id}`}</span>
                      <span className="text-sm text-muted-foreground">{tech.completionRate}%</span>
                    </div>
                    <Progress value={tech.completionRate} className="h-2" />
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Comparison Tab */}
        <TabsContent value="comparison" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <BarChart3 className="h-5 w-5 text-primary" />
                {t.techReport?.comparisonTitle || "مقارنة أداء الفنيين"}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={400}>
                <BarChart data={comparisonData} layout="vertical" margin={{ right: 30, left: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis type="number" tick={{ fontSize: 12 }} />
                  <YAxis dataKey="name" type="category" width={120} tick={{ fontSize: 12 }} />
                  <RechartsTooltip />
                  <Legend />
                  <Bar dataKey={assignedLabel} fill="#94a3b8" radius={[0, 4, 4, 0]} />
                  <Bar dataKey={completedLabel} fill="#10b981" radius={[0, 4, 4, 0]} />
                  <Bar dataKey={inProgressLabel} fill="#f59e0b" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Resolution Time Comparison */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Clock className="h-5 w-5 text-amber-500" />
                {t.techReport?.resolutionTimeComparison || "مقارنة أوقات الحل"}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart
                  data={(() => {
                    const avgLbl = t.techReport?.avgLabel || "متوسط";
                    const minLbl = t.techReport?.minLabel || "أقل";
                    const maxLbl = t.techReport?.maxLabel || "أعلى";
                    return techs.map(tech => ({
                      name: tech.technician.name || `Tech #${tech.technician.id}`,
                      [avgLbl]: tech.avgResolutionHours,
                      [minLbl]: tech.minResolutionHours,
                      [maxLbl]: tech.maxResolutionHours,
                    }));
                  })()}
                  margin={{ right: 30, left: 20 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <RechartsTooltip formatter={(value: number) => `${value} ${t.techReport.hour}`} />
                  <Legend />
                  <Bar dataKey={t.techReport?.minLabel || "أقل"} fill="#10b981" radius={[4, 4, 0, 0]} />
                  <Bar dataKey={t.techReport?.avgLabel || "متوسط"} fill="#0ea5e9" radius={[4, 4, 0, 0]} />
                  <Bar dataKey={t.techReport?.maxLabel || "أعلى"} fill="#ef4444" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Details Tab */}
        <TabsContent value="details" className="space-y-4">
          {techs.map((tech, index) => (
            <Card key={tech.technician.id} className="overflow-hidden">
              <div className={`h-1 ${index === 0 ? "bg-amber-400" : index === 1 ? "bg-gray-400" : index === 2 ? "bg-orange-400" : "bg-primary/30"}`} />
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`w-12 h-12 rounded-full flex items-center justify-center text-lg font-bold ${
                      index === 0 ? "bg-amber-100 text-amber-700" :
                      index === 1 ? "bg-gray-100 text-gray-700" :
                      index === 2 ? "bg-orange-100 text-orange-700" :
                      "bg-primary/10 text-primary"
                    }`}>
                      {index + 1}
                    </div>
                    <div>
                      <CardTitle className="text-lg">{tech.technician.name || `Tech #${tech.technician.id}`}</CardTitle>
                      <p className="text-sm text-muted-foreground">
                        {tech.technician.email || ""}
                        {tech.technician.department ? ` — ${tech.technician.department}` : ""}
                      </p>
                    </div>
                  </div>
                  <div className={`px-4 py-2 rounded-xl border ${getScoreBg(tech.performanceScore)}`}>
                    <p className={`text-2xl font-bold ${getScoreColor(tech.performanceScore)}`}>{tech.performanceScore}%</p>
                    <p className={`text-xs text-center ${getScoreColor(tech.performanceScore)}`}>{getScoreLabel(tech.performanceScore, t)}</p>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Stats Grid */}
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
                  <div className="p-3 bg-muted/50 rounded-lg text-center">
                    <p className="text-xs text-muted-foreground">مُسندة</p>
                    <p className="text-xl font-bold">{tech.totalAssigned}</p>
                  </div>
                  <div className="p-3 bg-emerald-50 rounded-lg text-center">
                    <p className="text-xs text-muted-foreground">مُنجزة</p>
                    <p className="text-xl font-bold text-emerald-600">{tech.completed}</p>
                  </div>
                  <div className="p-3 bg-amber-50 rounded-lg text-center">
                    <p className="text-xs text-muted-foreground">قيد التنفيذ</p>
                    <p className="text-xl font-bold text-amber-600">{tech.inProgress}</p>
                  </div>
                  <div className="p-3 bg-red-50 rounded-lg text-center">
                    <p className="text-xs text-muted-foreground">معلّقة</p>
                    <p className="text-xl font-bold text-red-600">{tech.pending}</p>
                  </div>
                  <div className="p-3 bg-blue-50 rounded-lg text-center">
                    <p className="text-xs text-muted-foreground">{t.reports.completionRate}</p>
                    <p className="text-xl font-bold text-blue-600">{tech.completionRate}%</p>
                  </div>
                  <div className="p-3 bg-purple-50 rounded-lg text-center">
                    <p className="text-xs text-muted-foreground">{t.techReport.speedLabel}</p>
                    <p className="text-lg font-bold text-purple-600">{formatHours(tech.avgResolutionHours, t)}</p>
                  </div>
                </div>

                <Separator />

                {/* Priority & Category Breakdown */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm font-medium mb-2">توزيع حسب الأولوية</p>
                    <div className="space-y-2">
                      {Object.entries(tech.priorityBreakdown || {}).map(([priority, count]) => (
                        <div key={priority} className="flex items-center justify-between">
                          <Badge variant="outline" className="text-xs">
                            {getPriorityLabel(priority)}
                          </Badge>
                          <div className="flex items-center gap-2 flex-1 mx-3">
                            <div className="flex-1 bg-muted rounded-full h-2 overflow-hidden">
                              <div
                                className={`h-full rounded-full ${
                                  priority === "critical" ? "bg-red-500" :
                                  priority === "high" ? "bg-orange-500" :
                                  priority === "medium" ? "bg-amber-500" : "bg-green-500"
                                }`}
                                style={{ width: `${tech.totalAssigned > 0 ? (count / tech.totalAssigned) * 100 : 0}%` }}
                              />
                            </div>
                            <span className="text-sm font-medium w-8 text-left">{count}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-sm font-medium mb-2">توزيع حسب الفئة</p>
                    <div className="space-y-2">
                      {Object.entries(tech.categoryBreakdown || {}).map(([category, count]) => (
                        <div key={category} className="flex items-center justify-between">
                          <Badge variant="outline" className="text-xs">
                            {getCategoryLabel(category)}
                          </Badge>
                          <div className="flex items-center gap-2 flex-1 mx-3">
                            <div className="flex-1 bg-muted rounded-full h-2 overflow-hidden">
                              <div
                                className="h-full rounded-full bg-primary"
                                style={{ width: `${tech.totalAssigned > 0 ? (count / tech.totalAssigned) * 100 : 0}%` }}
                              />
                            </div>
                            <span className="text-sm font-medium w-8 text-left">{count}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        {/* Trends Tab */}
        <TabsContent value="trends" className="space-y-4">
          {techs.map(tech => (
            <Card key={tech.technician.id}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <TrendingUp className="h-5 w-5 text-primary" />
                  الاتجاه الشهري — {tech.technician.name || `Tech #${tech.technician.id}`}
                  <Badge variant="outline" className="mr-auto">{getScoreLabel(tech.performanceScore, t)}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={250}>
                  <LineChart
                    data={(tech.monthlyTrend || []).map(m => ({
                      ...m,
                      month: formatMonth(m.month),
                    }))}
                    margin={{ right: 20, left: 10 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} />
                    <RechartsTooltip />
                    <Legend />
                    <Line type="monotone" dataKey="assigned" name="مُسندة" stroke="#94a3b8" strokeWidth={2} dot={{ r: 4 }} />
                    <Line type="monotone" dataKey="completed" name="مُنجزة" stroke="#10b981" strokeWidth={2} dot={{ r: 4 }} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          ))}
        </TabsContent>
        {/* External Technicians Tab */}
        <TabsContent value="external" className="space-y-4">
          {extLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
          ) : !extTechData || extTechData.length === 0 ? (
            <Card><CardContent className="flex flex-col items-center justify-center py-12 text-center">
              <Users className="h-12 w-12 text-muted-foreground mb-4" />
              <p className="text-lg font-semibold">لا يوجد فنيون خارجيون مسجلون</p>
              <p className="text-sm text-muted-foreground mt-1">أضف فنيين من صفحة إدارة الفنيين</p>
            </CardContent></Card>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card><CardContent className="pt-6">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/30">
                      <Users className="h-5 w-5 text-blue-600" />
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">إجمالي الفنيين</p>
                      <p className="text-2xl font-bold">{extTechData.length}</p>
                    </div>
                  </div>
                </CardContent></Card>
                <Card><CardContent className="pt-6">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-green-100 dark:bg-green-900/30">
                      <CheckCircle2 className="h-5 w-5 text-green-600" />
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">{t.reports.totalAssigned}</p>
                      <p className="text-2xl font-bold">{extTechData.reduce((s, t) => s + t.totalAssigned, 0)}</p>
                    </div>
                  </div>
                </CardContent></Card>
                <Card><CardContent className="pt-6">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-purple-100 dark:bg-purple-900/30">
                      <Clock className="h-5 w-5 text-purple-600" />
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">متوسط وقت الإنجاز</p>
                      <p className="text-2xl font-bold">
                        {extTechData.filter(t => t.avgResolutionHours > 0).length > 0
                          ? Math.round(extTechData.filter(t => t.avgResolutionHours > 0).reduce((s, t) => s + t.avgResolutionHours, 0) / extTechData.filter(t => t.avgResolutionHours > 0).length)
                          : 0} ساعة
                      </p>
                    </div>
                  </div>
                </CardContent></Card>
              </div>
              <Card>
                <CardHeader><CardTitle>أداء الفنيين الخارجيين</CardTitle></CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {extTechData.map((tech, idx) => (
                      <div key={tech.technician.id} className="border rounded-lg p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-sm font-bold">
                              {idx + 1}
                            </div>
                            <div>
                              <p className="font-semibold">{tech.technician.name}</p>
                              {tech.technician.specialty && (
                                <p className="text-sm text-muted-foreground">{tech.technician.specialty}</p>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant={tech.technician.status === 'active' ? 'default' : 'secondary'}>
                              {tech.technician.status === 'active' ? 'نشط' : 'غير نشط'}
                            </Badge>
                            <div className={`px-3 py-1 rounded-lg border text-sm font-bold ${getScoreBg(tech.performanceScore)} ${getScoreColor(tech.performanceScore)}`}>
                              {tech.performanceScore} نقطة
                            </div>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                          <div className="text-center p-2 bg-muted rounded">
                            <p className="text-muted-foreground">مُسند</p>
                            <p className="font-bold text-lg">{tech.totalAssigned}</p>
                          </div>
                          <div className="text-center p-2 bg-green-50 dark:bg-green-900/20 rounded">
                            <p className="text-muted-foreground">مُنجز</p>
                            <p className="font-bold text-lg text-green-600">{tech.completed}</p>
                          </div>
                          <div className="text-center p-2 bg-blue-50 dark:bg-blue-900/20 rounded">
                            <p className="text-muted-foreground">جارٍ</p>
                            <p className="font-bold text-lg text-blue-600">{tech.inProgress}</p>
                          </div>
                          <div className="text-center p-2 bg-muted rounded">
                            <p className="text-muted-foreground">متوسط الوقت</p>
                            <p className="font-bold text-lg">{tech.avgResolutionHours > 0 ? formatHours(tech.avgResolutionHours, t) : '—'}</p>
                          </div>
                        </div>
                        <div className="space-y-1">
                          <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">نسبة الإنجاز</span>
                            <span className="font-medium">{tech.completionRate}%</span>
                          </div>
                          <Progress value={tech.completionRate} className="h-2" />
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>

        {/* Monthly PM Performance Tab */}
        <TabsContent value="monthly-pm" className="space-y-4">
          <TechnicianMonthlyPM />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ── Component: تقرير أداء الفني الشهري (فحوصات + معدل اكتشاف الأعطال) ──
function TechnicianMonthlyPM() {
  const { data, isLoading } = trpc.reports.technicianMonthlyReport.useQuery();

  if (isLoading) return (
    <div className="flex items-center justify-center h-48">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
    </div>
  );

  if (!data || data.technicians.length === 0) return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center h-48 text-muted-foreground">
        <span className="text-4xl mb-2">🔍</span>
        <p>لا توجد بيانات فحوصات بعد</p>
        <p className="text-sm mt-1">ستظهر البيانات بعد أن يبدأ الفنيون فحوصات الصيانة الدورية</p>
      </CardContent>
    </Card>
  );

  const monthLabels = (data.months || []).map((m: string) => {
    const [y, mo] = m.split("-");
    return new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString("ar-SA", { month: "short", year: "2-digit" });
  });

  return (
    <div className="space-y-6">
      {/* بطاقات ملخص إجمالي */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="bg-gradient-to-br from-blue-500 to-blue-600 text-white">
          <CardContent className="pt-4 pb-4">
            <p className="text-blue-100 text-sm">إجمالي الفنيين</p>
            <p className="text-3xl font-bold">{data.technicians.length}</p>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-green-500 to-green-600 text-white">
          <CardContent className="pt-4 pb-4">
            <p className="text-green-100 text-sm">إجمالي الفحوصات</p>
            <p className="text-3xl font-bold">{data.technicians.reduce((s: number, t: any) => s + t.totalInspections, 0)}</p>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-red-500 to-red-600 text-white">
          <CardContent className="pt-4 pb-4">
            <p className="text-red-100 text-sm">أعطال مكتشفة</p>
            <p className="text-3xl font-bold">{data.technicians.reduce((s: number, t: any) => s + t.totalDefects, 0)}</p>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-purple-500 to-purple-600 text-white">
          <CardContent className="pt-4 pb-4">
            <p className="text-purple-100 text-sm">متوسط معدل الاكتشاف</p>
            <p className="text-3xl font-bold">
              {data.technicians.length > 0
                ? Math.round(data.technicians.reduce((s: number, t: any) => s + t.overallDetectionRate, 0) / data.technicians.length)
                : 0}%
            </p>
          </CardContent>
        </Card>
      </div>

      {/* جدول أداء كل فني */}
      {data.technicians.map((tech: any) => (
        <Card key={tech.technicianId} className="overflow-hidden">
          <CardHeader className="pb-2 bg-muted/30">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-lg font-bold text-primary">
                  {tech.technicianName?.charAt(0) || "?"}
                </div>
                <div>
                  <CardTitle className="text-base">{tech.technicianName}</CardTitle>
                  <p className="text-xs text-muted-foreground">فني صيانة</p>
                </div>
              </div>
              <div className="flex gap-4 text-center">
                <div>
                  <p className="text-2xl font-bold text-green-600">{tech.totalInspections}</p>
                  <p className="text-xs text-muted-foreground">فحص</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-red-500">{tech.totalDefects}</p>
                  <p className="text-xs text-muted-foreground">عطل</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-purple-600">{tech.overallDetectionRate}%</p>
                  <p className="text-xs text-muted-foreground">معدل الاكتشاف</p>
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-4">
            {/* جدول شهري */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-right pb-2 font-medium text-muted-foreground">الشهر</th>
                    {monthLabels.map((label: string, i: number) => (
                      <th key={i} className="text-center pb-2 font-medium text-muted-foreground px-2">{label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b">
                    <td className="py-2 text-muted-foreground">فحوصات</td>
                    {tech.monthlyData.map((m: any, i: number) => (
                      <td key={i} className="text-center py-2 px-2">
                        <span className={`font-bold ${m.inspections > 0 ? "text-green-600" : "text-muted-foreground"}`}>
                          {m.inspections}
                        </span>
                      </td>
                    ))}
                  </tr>
                  <tr className="border-b">
                    <td className="py-2 text-muted-foreground">أعطال مكتشفة</td>
                    {tech.monthlyData.map((m: any, i: number) => (
                      <td key={i} className="text-center py-2 px-2">
                        <span className={`font-bold ${m.defectsFound > 0 ? "text-red-500" : "text-muted-foreground"}`}>
                          {m.defectsFound}
                        </span>
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td className="py-2 text-muted-foreground">معدل الاكتشاف</td>
                    {tech.monthlyData.map((m: any, i: number) => (
                      <td key={i} className="text-center py-2 px-2">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-bold ${
                          m.detectionRate >= 20 ? "bg-red-100 text-red-700" :
                          m.detectionRate >= 10 ? "bg-orange-100 text-orange-700" :
                          m.inspections > 0 ? "bg-green-100 text-green-700" :
                          "text-muted-foreground"
                        }`}>
                          {m.inspections > 0 ? `${m.detectionRate}%` : "—"}
                        </span>
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>

            {/* شريط تقدم معدل الاكتشاف */}
            <div className="mt-3 space-y-1">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>معدل اكتشاف الأعطال الإجمالي</span>
                <span className="font-bold text-purple-600">{tech.overallDetectionRate}%</span>
              </div>
              <Progress value={tech.overallDetectionRate} className="h-2" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
