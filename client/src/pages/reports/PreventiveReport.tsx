import { useState } from "react";
import { mediaUrl } from "@/lib/mediaUrl";
import { trpc } from "@/lib/trpc";
import { useTranslation, useLanguage } from "@/contexts/LanguageContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  CalendarClock, CheckCircle2, Clock, AlertTriangle, XCircle,
  Download, BarChart3, ListChecks, TrendingUp, Activity
} from "lucide-react";

// freqLabels moved to component

// statusConfig moved to component

export default function PreventiveReport() {
  const { t } = useTranslation();
  const { t: tr, language } = useLanguage();
  const freqLabels: Record<string, string> = {
    daily: tr.preventive?.daily || "يومي",
    weekly: tr.preventive?.weekly || "أسبوعي",
    monthly: tr.preventive?.monthly || "شهري",
    quarterly: tr.preventive?.quarterly || "ربع سنوي",
    biannual: tr.preventive?.biannual || "نصف سنوي",
    annual: tr.preventive?.annual || "سنوي",
  };
  const statusConfig: Record<string, { label: string; color: string }> = {
    scheduled:   { label: tr.preventive?.statusScheduled || "مجدول",  color: "bg-blue-100 text-blue-700" },
    in_progress: { label: tr.preventive?.statusInProgress || "جاري",   color: "bg-yellow-100 text-yellow-700" },
    completed:   { label: tr.preventive?.statusCompleted || "مكتمل",  color: "bg-green-100 text-green-700" },
    overdue:     { label: tr.preventive?.statusOverdue || "متأخر",  color: "bg-red-100 text-red-700" },
    cancelled:   { label: tr.preventive?.statusCancelled || "ملغي",   color: "bg-gray-100 text-gray-600" },
  };
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [appliedFilters, setAppliedFilters] = useState<{ dateFrom?: string; dateTo?: string }>({});

  const { data, isLoading, refetch } = trpc.preventive.getReport.useQuery(
    Object.keys(appliedFilters).length > 0 ? appliedFilters : undefined
  );

  const handleApplyFilters = () => {
    setAppliedFilters({
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
    });
  };

  const handleResetFilters = () => {
    setDateFrom("");
    setDateTo("");
    setAppliedFilters({});
  };

  const exportPlans = () => window.open("/api/export/preventive-plans", "_blank");
  const exportWOs   = () => window.open("/api/export/pm-work-orders", "_blank");

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  const summary = data?.summary;
  const wos     = data?.workOrders;
  const checklist = data?.checklist;
  const byFreq  = data?.byFrequency ?? {};
  const recent  = data?.recentWorkOrders ?? [];

  return (
    <div className="p-6 space-y-6" dir="rtl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary/10 rounded-lg">
            <CalendarClock className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">{tr.nav?.preventiveReport || "تقرير الصيانة الوقائية"}</h1>
            <p className="text-sm text-muted-foreground">{tr.preventiveReport?.subtitle || "إحصائيات وأداء خطط الصيانة الوقائية"}</p>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={exportPlans}>
            <Download className="h-4 w-4 ml-1" />
            تصدير الخطط
          </Button>
          <Button variant="outline" size="sm" onClick={exportWOs}>
            <Download className="h-4 w-4 ml-1" />
            تصدير أوامر العمل
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{tr.common?.filterByDate || "فلترة بالتاريخ"}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4 items-end">
            <div className="space-y-1">
              <Label>{tr.common?.fromDate || "من تاريخ"}</Label>
              <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-40" />
            </div>
            <div className="space-y-1">
              <Label>{tr.common?.toDate || "إلى تاريخ"}</Label>
              <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="w-40" />
            </div>
            <Button onClick={handleApplyFilters} size="sm">{tr.common?.apply || "تطبيق"}</Button>
            {Object.keys(appliedFilters).length > 0 && (
              <Button variant="ghost" size="sm" onClick={handleResetFilters}>{tr.common?.reset || "إعادة تعيين"}</Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-100 rounded-lg"><BarChart3 className="h-5 w-5 text-blue-600" /></div>
              <div>
                <p className="text-xs text-muted-foreground">{tr.preventiveReport?.totalPlans || "إجمالي الخطط"}</p>
                <p className="text-2xl font-bold">{summary?.totalPlans ?? 0}</p>
              </div>
            </div>
            <div className="mt-2 flex gap-2 text-xs">
              <span className="text-green-600">{summary?.activePlans ?? 0} {tr.preventiveReport?.active || "نشطة"}</span>
              <span className="text-gray-400">|</span>
              <span className="text-gray-500">{summary?.inactivePlans ?? 0} {tr.preventiveReport?.inactive || "متوقفة"}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-red-100 rounded-lg"><AlertTriangle className="h-5 w-5 text-red-600" /></div>
              <div>
                <p className="text-xs text-muted-foreground">{tr.preventiveReport?.overduePlans || "خطط متأخرة"}</p>
                <p className="text-2xl font-bold text-red-600">{summary?.overduePlans ?? 0}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-purple-100 rounded-lg"><Activity className="h-5 w-5 text-purple-600" /></div>
              <div>
                <p className="text-xs text-muted-foreground">{tr.preventiveReport?.workOrders || "أوامر العمل"}</p>
                <p className="text-2xl font-bold">{wos?.total ?? 0}</p>
              </div>
            </div>
            <div className="mt-2 flex gap-2 text-xs">
              <span className="text-green-600">{wos?.completed ?? 0} {tr.preventiveReport?.completed || "مكتملة"}</span>
              <span className="text-gray-400">|</span>
              <span className="text-red-500">{wos?.overdue ?? 0} {tr.preventiveReport?.overdue || "متأخرة"}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-100 rounded-lg"><TrendingUp className="h-5 w-5 text-green-600" /></div>
              <div>
                <p className="text-xs text-muted-foreground">{tr.preventiveReport?.completionRate || "نسبة الإنجاز"}</p>
                <p className="text-2xl font-bold text-green-600">{wos?.completionRate ?? 0}%</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Work Orders Status + Checklist + Frequency */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Work Orders Breakdown */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="h-4 w-4" /> {tr.preventiveReport?.workOrderDist || "توزيع أوامر العمل"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {[
              { key: "scheduled",   label: tr.preventive?.statusScheduled || "مجدول",  count: wos?.scheduled ?? 0,   color: "bg-blue-500" },
              { key: "in_progress", label: tr.preventive?.statusInProgress || "جاري",  count: wos?.inProgress ?? 0,  color: "bg-yellow-500" },
              { key: "completed",   label: tr.preventive?.statusCompleted || "مكتمل",  count: wos?.completed ?? 0,   color: "bg-green-500" },
              { key: "overdue",     label: tr.preventive?.statusOverdue || "متأخر",  count: wos?.overdue ?? 0,     color: "bg-red-500" },
              { key: "cancelled",   label: tr.preventive?.statusCancelled || "ملغي",  count: wos?.cancelled ?? 0,   color: "bg-gray-400" },
            ].map(item => (
              <div key={item.key} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${item.color}`} />
                  <span className="text-sm">{item.label}</span>
                </div>
                <span className="font-semibold text-sm">{item.count}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Checklist Stats */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <ListChecks className="h-4 w-4" /> {tr.preventiveReport?.checklistStats || "إحصائيات قوائم التحقق"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">{tr.preventiveReport?.totalItems || "إجمالي البنود"}</span>
              <span className="font-semibold">{checklist?.total ?? 0}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">{tr.preventiveReport?.completedItems || "بنود منجزة"}</span>
              <span className="font-semibold text-green-600">{checklist?.done ?? 0}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">{tr.preventiveReport?.remainingItems || "بنود متبقية"}</span>
              <span className="font-semibold text-orange-500">{(checklist?.total ?? 0) - (checklist?.done ?? 0)}</span>
            </div>
            {/* Progress bar */}
            <div className="mt-2">
              <div className="flex justify-between text-xs mb-1">
                <span>{tr.preventiveReport?.completionRate || "نسبة الإنجاز"}</span>
                <span className="font-bold">{checklist?.completionRate ?? 0}%</span>
              </div>
              <div className="w-full bg-muted rounded-full h-2">
                <div
                  className="bg-green-500 h-2 rounded-full transition-all"
                  style={{ width: `${checklist?.completionRate ?? 0}%` }}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Frequency Distribution */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <CalendarClock className="h-4 w-4" /> {tr.preventiveReport?.frequencyDist || "توزيع التكرار"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {Object.keys(freqLabels).map(freq => {
              const count = byFreq[freq] ?? 0;
              const total = summary?.totalPlans ?? 1;
              const pct = total > 0 ? Math.round((count / total) * 100) : 0;
              return (
                <div key={freq} className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span>{freqLabels[freq]}</span>
                    <span className="font-semibold">{count}</span>
                  </div>
                  <div className="w-full bg-muted rounded-full h-1.5">
                    <div
                      className="bg-primary h-1.5 rounded-full"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
            {Object.values(byFreq).every(v => v === 0) && (
              <p className="text-sm text-muted-foreground text-center py-2">{tr.preventiveReport?.noPlans || "لا توجد خطط مسجلة"}</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent Work Orders */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="h-4 w-4" /> {tr.preventiveReport?.recentWorkOrders || "آخر أوامر العمل"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {recent.length === 0 ? (
            <p className="text-center text-muted-foreground py-6">{tr.preventiveReport?.noWorkOrders || "لا توجد أوامر عمل"}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="text-right pb-2 font-medium">{tr.preventiveReport?.woNumber || "رقم أمر العمل"}</th>
                    <th className="text-right pb-2 font-medium">{tr.common?.title || "العنوان"}</th>
                    <th className="text-right pb-2 font-medium">{tr.common?.status || "الحالة"}</th>
                    <th className="text-right pb-2 font-medium">{tr.preventiveReport?.scheduledDate || "تاريخ الجدولة"}</th>
                    <th className="text-right pb-2 font-medium">{tr.preventiveReport?.completedDate || "تاريخ الإنجاز"}</th>
                    <th className="text-right pb-2 font-medium">{tr.common?.photo || "صورة"}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {recent.map((wo: any) => {
                    const sc = statusConfig[wo.status] ?? { label: wo.status, color: "bg-gray-100 text-gray-600" };
                    return (
                      <tr key={wo.id} className="hover:bg-muted/30">
                        <td className="py-2 font-mono text-xs">{wo.workOrderNumber}</td>
                        <td className="py-2 max-w-[200px] truncate">{wo.title}</td>
                        <td className="py-2">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${sc.color}`}>{sc.label}</span>
                        </td>
                        <td className="py-2 text-xs text-muted-foreground">
                          {wo.scheduledDate ? new Date(wo.scheduledDate).toLocaleDateString("ar-SA") : "-"}
                        </td>
                        <td className="py-2 text-xs text-muted-foreground">
                          {wo.completedDate ? new Date(wo.completedDate).toLocaleDateString("ar-SA") : "-"}
                        </td>
                        <td className="py-2">
                          {wo.completionPhotoUrl ? (
                            <a href={mediaUrl(wo.completionPhotoUrl)} target="_blank" rel="noopener noreferrer">
                              <CheckCircle2 className="h-4 w-4 text-green-500" />
                            </a>
                          ) : (
                            <XCircle className="h-4 w-4 text-gray-300" />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
