import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Building2, AlertTriangle, CheckCircle2, Clock, Wrench, Package, TrendingUp, ShieldCheck, Zap, Target } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";

export default function SectionReport() {
  const { t } = useLanguage();
  const [siteFilter, setSiteFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const { data: sites = [] } = trpc.sites.list.useQuery();
  const { data: report, isLoading } = trpc.reports.sectionReport.useQuery({
    siteId: siteFilter !== "all" ? Number(siteFilter) : undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
  });

  const sections = report?.sections || [];
  const maxTickets = sections.length > 0 ? Math.max(...sections.map((s: any) => s.totalTickets)) : 1;
  const maxPM = sections.length > 0 ? Math.max(...sections.map((s: any) => s.preventiveCount ?? 0)) : 1;
  const maxAll = Math.max(maxTickets, maxPM, 1);

  const getBarWidth = (count: number) => {
    if (maxAll === 0) return "0%";
    return `${Math.max(4, (count / maxAll) * 100)}%`;
  };

  const formatHours = (hours: number | null) => {
    if (hours === null) return "-";
    if (hours < 24) return `${hours} ${t.sectionReport.hours}`;
    return `${Math.round(hours / 24 * 10) / 10} ${t.sectionReport.days}`;
  };

  // إجماليات للمقارنة
  const totalPreventive = sections.reduce((sum: number, s: any) => sum + (s.preventiveCount ?? 0), 0);
  const totalEmergency = sections.reduce((sum: number, s: any) => sum + (s.emergencyCount ?? 0), 0);

  // تقرير معدل اكتشاف الأعطال
  const { data: detectionReport, isLoading: detectionLoading } = trpc.preventive.getDetectionRateReport.useQuery({
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
  });

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Building2 className="w-6 h-6 text-primary" />
          {t.sectionReport.title}
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          {t.sectionReport.subtitle}
        </p>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex flex-wrap gap-4 items-end">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">{t.common.site}</Label>
              <Select value={siteFilter} onValueChange={setSiteFilter}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder={t.sectionReport.allSites} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t.sectionReport.allSites}</SelectItem>
                  {sites.map((s: any) => (
                    <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">{t.common.from}</Label>
              <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-[160px]" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">{t.common.to}</Label>
              <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="w-[160px]" />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary Cards */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[1,2,3,4].map(i => <Card key={i}><CardContent className="p-4"><Skeleton className="h-16 w-full" /></CardContent></Card>)}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-4 pb-4 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/30">
                <Building2 className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{t.sectionReport.sectionCount}</p>
                <p className="text-2xl font-bold">{sections.length}</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-4 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-orange-100 dark:bg-orange-900/30">
                <Wrench className="w-5 h-5 text-orange-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{t.sectionReport.totalTickets}</p>
                <p className="text-2xl font-bold">{report?.totalTickets || 0}</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-4 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-100 dark:bg-green-900/30">
                <ShieldCheck className="w-5 h-5 text-green-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{t.sectionReport.preventive}</p>
                <p className="text-2xl font-bold text-green-600">{totalPreventive}</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-4 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-red-100 dark:bg-red-900/30">
                <Zap className="w-5 h-5 text-red-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{t.sectionReport.emergency}</p>
                <p className="text-2xl font-bold text-red-600">{totalEmergency}</p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Comparison Chart */}
      {!isLoading && sections.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="w-4 h-4" />
              {t.sectionReport.comparisonTitle}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {/* Legend */}
              <div className="flex items-center gap-6 text-sm">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-green-500" />
                  <span>{t.sectionReport.preventive}</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-red-500" />
                  <span>{t.sectionReport.emergency}</span>
                </div>
              </div>
              {/* Bars */}
              <div className="space-y-3">
                {sections.map((section: any) => (
                  <div key={section.sectionId} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium">{section.sectionName}</span>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span className="text-green-600 font-medium">{t.sectionReport.preventiveShort}: {section.preventiveCount ?? 0}</span>
                <span className="text-red-600 font-medium">{t.sectionReport.emergencyShort}: {section.emergencyCount ?? 0}</span>
                      </div>
                    </div>
                    <div className="space-y-1">
                      {/* Preventive bar */}
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground w-16 text-left shrink-0">{t.sectionReport.preventiveShort}</span>
                        <div className="flex-1 bg-muted rounded-full h-4 overflow-hidden">
                          <div
                            className="h-full bg-green-500 rounded-full transition-all duration-500 flex items-center justify-end pr-2"
                            style={{ width: getBarWidth(section.preventiveCount ?? 0) }}
                          >
                            {(section.preventiveCount ?? 0) > 0 && (
                              <span className="text-xs text-white font-medium">{section.preventiveCount}</span>
                            )}
                          </div>
                        </div>
                      </div>
                      {/* Emergency bar */}
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground w-16 text-left shrink-0">{t.sectionReport.emergencyShort}</span>
                        <div className="flex-1 bg-muted rounded-full h-4 overflow-hidden">
                          <div
                            className="h-full bg-red-500 rounded-full transition-all duration-500 flex items-center justify-end pr-2"
                            style={{ width: getBarWidth(section.emergencyCount ?? 0) }}
                          >
                            {(section.emergencyCount ?? 0) > 0 && (
                              <span className="text-xs text-white font-medium">{section.emergencyCount}</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Sections Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <TrendingUp className="w-4 h-4" />
            {t.sectionReport.sectionDetails}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {[1,2,3,4].map(i => <Skeleton key={i} className="h-16 w-full" />)}
            </div>
          ) : sections.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Building2 className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>لا توجد أقسام مسجّلة</p>
              <p className="text-xs mt-1">أضف أقساماً من صفحة "الأقسام" أولاً</p>
            </div>
          ) : (
            <div className="space-y-4">
              {sections.map((section: any) => (
                <div key={section.sectionId} className="border rounded-lg p-4 space-y-3">
                  {/* Section Header */}
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-2">
                      <Building2 className="w-4 h-4 text-primary" />
                      <span className="font-semibold">{section.sectionName}</span>
                      {section.urgentTickets > 0 && (
                        <Badge variant="destructive" className="text-xs">
                          {section.urgentTickets} عاجل
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-4 text-sm text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Package className="w-3.5 h-3.5" />
                        {section.totalAssets} أصل
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5" />
                        متوسط الإغلاق: {formatHours(section.avgCloseTimeHours)}
                      </span>
                    </div>
                  </div>

                  {/* Stats Row */}
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                    <div className="bg-muted/40 rounded-lg p-2 text-center">
                      <p className="text-xs text-muted-foreground">مفتوحة</p>
                      <p className="text-lg font-bold text-orange-500">{section.openTickets}</p>
                    </div>
                    <div className="bg-muted/40 rounded-lg p-2 text-center">
                      <p className="text-xs text-muted-foreground">مغلقة</p>
                      <p className="text-lg font-bold text-emerald-500">{section.closedTickets}</p>
                    </div>
                    <div className="bg-muted/40 rounded-lg p-2 text-center">
                      <p className="text-xs text-muted-foreground">عاجلة/حرجة</p>
                      <p className="text-lg font-bold text-red-500">{section.urgentTickets}</p>
                    </div>
                    <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-2 text-center border border-green-200 dark:border-green-800">
                      <p className="text-xs text-green-700 dark:text-green-400">وقائية</p>
                      <p className="text-lg font-bold text-green-600">{section.preventiveCount ?? 0}</p>
                      {(section.preventiveCount ?? 0) > 0 && (
                        <p className="text-xs text-muted-foreground">
                          {section.preventiveCompleted ?? 0} مكتملة
                        </p>
                      )}
                    </div>
                    <div className="bg-muted/40 rounded-lg p-2 text-center">
                      <p className="text-xs text-muted-foreground">تكلفة الصيانة</p>
                      <p className="text-lg font-bold">
                        {section.maintenanceCost > 0 ? `${section.maintenanceCost.toLocaleString()} ر.س` : "-"}
                      </p>
                    </div>
                  </div>

                  {/* Preventive vs Emergency ratio */}
                  {((section.preventiveCount ?? 0) + (section.emergencyCount ?? 0)) > 0 && (
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">نسبة الصيانة الوقائية مقابل الطارئة</p>
                      <div className="flex h-3 rounded-full overflow-hidden">
                        {(section.preventiveCount ?? 0) > 0 && (
                          <div
                            className="bg-green-500 transition-all duration-500"
                            style={{
                              width: `${((section.preventiveCount ?? 0) / ((section.preventiveCount ?? 0) + (section.emergencyCount ?? 0))) * 100}%`
                            }}
                            title={`وقائية: ${section.preventiveCount}`}
                          />
                        )}
                        {(section.emergencyCount ?? 0) > 0 && (
                          <div
                            className="bg-red-500 transition-all duration-500"
                            style={{
                              width: `${((section.emergencyCount ?? 0) / ((section.preventiveCount ?? 0) + (section.emergencyCount ?? 0))) * 100}%`
                            }}
                            title={`طارئة: ${section.emergencyCount}`}
                          />
                        )}
                      </div>
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span className="text-green-600">
                          {Math.round(((section.preventiveCount ?? 0) / ((section.preventiveCount ?? 0) + (section.emergencyCount ?? 0))) * 100)}% وقائية
                        </span>
                        <span className="text-red-600">
                          {Math.round(((section.emergencyCount ?? 0) / ((section.preventiveCount ?? 0) + (section.emergencyCount ?? 0))) * 100)}% طارئة
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── تقرير معدل اكتشاف الأعطال ── */}
      <Card className="border-primary/20">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Target className="w-5 h-5 text-primary" />
            معدل اكتشاف الأعطال بالصيانة الدورية
          </CardTitle>
          <p className="text-xs text-muted-foreground">كم عطلاً تم اكتشافه عن طريق الفحص الدوري قبل أن يبلغ عنه الزوار</p>
        </CardHeader>
        <CardContent>
          {detectionLoading ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[1,2,3,4].map(i => <Skeleton key={i} className="h-20" />)}
            </div>
          ) : detectionReport ? (
            <div className="space-y-4">
              {/* بطاقات الإحصاء */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-blue-50 dark:bg-blue-950/30 rounded-lg p-3 text-center">
                  <p className="text-xs text-muted-foreground">عمليات فحص مكتملة</p>
                  <p className="text-2xl font-bold text-blue-600">{detectionReport.completedInspections}</p>
                </div>
                <div className="bg-green-50 dark:bg-green-950/30 rounded-lg p-3 text-center">
                  <p className="text-xs text-muted-foreground">بنود سليمة ✅</p>
                  <p className="text-2xl font-bold text-green-600">{detectionReport.okItems}</p>
                </div>
                <div className="bg-orange-50 dark:bg-orange-950/30 rounded-lg p-3 text-center">
                  <p className="text-xs text-muted-foreground">إصلاح فوري 🛠️</p>
                  <p className="text-2xl font-bold text-orange-600">{detectionReport.fixedItems}</p>
                </div>
                <div className="bg-red-50 dark:bg-red-950/30 rounded-lg p-3 text-center">
                  <p className="text-xs text-muted-foreground">أعطال مكتشفة ⚠️</p>
                  <p className="text-2xl font-bold text-red-600">{detectionReport.issueItems}</p>
                </div>
              </div>

              {/* معدل الاكتشاف الرئيسي */}
              <div className="bg-gradient-to-l from-primary/5 to-primary/10 rounded-xl p-4 flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium">معدل اكتشاف الأعطال</p>
                  <p className="text-xs text-muted-foreground mt-1">{detectionReport.summary}</p>
                </div>
                <div className="text-center shrink-0">
                  <p className="text-4xl font-bold text-primary">{detectionReport.detectionRate}%</p>
                  <p className="text-xs text-muted-foreground">من إجمالي البلاغات</p>
                </div>
              </div>

              {/* شريط التصنيف */}
              {detectionReport.totalTicketsInPeriod > 0 && (
                <div className="space-y-2">
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>مكتشف بالصيانة الدورية: {detectionReport.pmDetectedTickets}</span>
                    <span>إجمالي البلاغات: {detectionReport.totalTicketsInPeriod}</span>
                  </div>
                  <div className="h-4 bg-muted rounded-full overflow-hidden flex">
                    <div
                      className="bg-primary transition-all duration-700 rounded-full"
                      style={{ width: `${detectionReport.detectionRate}%` }}
                    />
                  </div>
                  <div className="flex items-center gap-4 text-xs">
                    <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-primary inline-block" /> مكتشف بالصيانة الدورية</span>
                    <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-muted inline-block" /> بلاغات عادية</span>
                  </div>
                </div>
              )}

              {detectionReport.completedInspections === 0 && (
                <div className="text-center py-4 text-muted-foreground text-sm">
                  <Target className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  لا توجد عمليات فحص مكتملة في هذه الفترة
                </div>
              )}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
