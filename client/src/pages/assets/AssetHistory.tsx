import { trpc } from "@/lib/trpc";
import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, Wrench, CheckCircle2, AlertCircle, Clock, FileText, ClipboardCheck, CheckSquare, AlertTriangle, Timer, TrendingUp } from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import { useTranslation, useLanguage } from "@/contexts/LanguageContext";
import { useStaticLabels } from "@/hooks/useContentTranslation";
import { useTranslatedField } from "@/hooks/useTranslatedField";
import { STATUS_COLORS, PRIORITY_COLORS } from "@shared/types";

export default function AssetHistory() {
  const [, setLocation] = useLocation();
  const { t, language } = useTranslation();
  const { t: tr } = useLanguage();
  const { getStatusLabel, getPriorityLabel } = useStaticLabels();
  const { getField } = useTranslatedField();
  const [alertsEnabled, setAlertsEnabled] = useState(true);

  // Get assetId from URL params
  const params = new URLSearchParams(window.location.search);
  const assetId = parseInt(params.get("id") || "0");

  if (!assetId) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" size="icon" onClick={() => setLocation("/assets")}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <Card>
          <CardContent className="p-12 text-center">
            <AlertCircle className="w-12 h-12 mx-auto text-destructive mb-4" />
            <h3 className="font-semibold text-lg mb-1">{tr.common?.error || "خطأ"}</h3>
            <p className="text-sm text-muted-foreground">{tr.assetHistory?.invalidId || "معرّف الأصل غير صحيح"}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { data: asset, isLoading: assetLoading } = trpc.assets.getById.useQuery({ id: assetId });
  const { data: history, isLoading: historyLoading } = trpc.assets.getMaintenanceHistory.useQuery({ id: assetId });
  const { data: stats, isLoading: statsLoading } = trpc.assets.getMaintenanceStats.useQuery({ id: assetId });
  const { data: inspectionHistory, isLoading: inspectionLoading } = trpc.preventive.getAssetInspectionHistory.useQuery({ assetId, limit: 10 });
  const { data: inspectionResultsList } = trpc.inspectionResults.listByAsset.useQuery({ assetId }, { enabled: !!assetId });

  const locale = language === "ar" ? "ar-SA" : language === "ur" ? "ur-PK" : "en-US";

  if (assetLoading || historyLoading || statsLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-12 w-32" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!asset) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" size="icon" onClick={() => setLocation("/assets")}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <Card>
          <CardContent className="p-12 text-center">
            <AlertCircle className="w-12 h-12 mx-auto text-destructive mb-4" />
            <h3 className="font-semibold text-lg mb-1">{tr.common?.notFound || "غير موجود"}</h3>
            <p className="text-sm text-muted-foreground">{tr.assetHistory?.assetNotFound || "الأصل غير موجود"}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => setLocation("/assets")}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold">{asset.name}</h1>
          <p className="text-sm text-muted-foreground">{asset.assetNumber}</p>
        </div>
      </div>

      {/* Asset Info Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5" />
            معلومات الأصل
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p className="text-xs text-muted-foreground">{tr.common?.category || "الفئة"}</p>
              <p className="font-semibold">{asset.category || "-"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{tr.common?.status || "الحالة"}</p>
              <Badge className={STATUS_COLORS[asset.status] || ""}>{asset.status}</Badge>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{tr.common?.location || "الموقع"}</p>
              <p className="font-semibold text-sm">{asset.locationDetail || "-"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{tr.assetHistory?.serialNumber || "الرقم التسلسلي"}</p>
              <p className="font-semibold text-sm">{asset.serialNumber || "-"}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Statistics */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Card>
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold text-primary">{stats.totalTickets}</div>
              <p className="text-xs text-muted-foreground mt-1">{tr.assetHistory?.totalTickets || "إجمالي البلاغات"}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold text-orange-500">{stats.openTickets}</div>
              <p className="text-xs text-muted-foreground mt-1">{tr.assetHistory?.openTickets || "بلاغات مفتوحة"}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold text-blue-500">{stats.totalPMPlans}</div>
              <p className="text-xs text-muted-foreground mt-1">{tr.assetHistory?.maintenancePlans || "خطط الصيانة"}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold text-purple-500">{stats.totalWorkOrders}</div>
              <p className="text-xs text-muted-foreground mt-1">{tr.assetHistory?.workOrders || "أوامر العمل"}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold text-green-500">{stats.completedWorkOrders}</div>
              <p className="text-xs text-muted-foreground mt-1">{tr.common?.completed || "مكتملة"}</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Tabs */}
      <Tabs defaultValue="tickets" className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="tickets">البلاغات ({history?.tickets.length || 0})</TabsTrigger>
          <TabsTrigger value="plans">خطط الصيانة ({history?.pmPlans.length || 0})</TabsTrigger>
          <TabsTrigger value="workorders">أوامر العمل ({history?.workOrders.length || 0})</TabsTrigger>
          <TabsTrigger value="inspections" className="flex items-center gap-1">
            <ClipboardCheck className="w-3.5 h-3.5" />
            سجل الفحوصات ({inspectionHistory?.length || 0})
          </TabsTrigger>
        </TabsList>

        {/* Tickets Tab */}
        <TabsContent value="tickets" className="space-y-3">
          {!history?.tickets || history.tickets.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center">
                <AlertCircle className="w-10 h-10 mx-auto text-muted-foreground/40 mb-3" />
                <p className="text-sm text-muted-foreground">{tr.assetHistory?.noTickets || "لا توجد بلاغات لهذا الأصل"}</p>
              </CardContent>
            </Card>
          ) : (
            history.tickets.map((ticket: any) => (
              <Card
                key={ticket.id}
                className="hover:shadow-md transition-shadow cursor-pointer"
                onClick={() => setLocation(`/tickets/${ticket.id}`)}
              >
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-mono text-muted-foreground">{ticket.ticketNumber}</span>
                        <Badge variant="outline" className={`text-[11px] ${PRIORITY_COLORS[ticket.priority] || ""}`}>
                          {getPriorityLabel(ticket.priority)}
                        </Badge>
                      </div>
                      <h4 className="font-medium truncate">{getField(ticket, "title")}</h4>
                      <p className="text-xs text-muted-foreground mt-1">
                        {new Date(ticket.createdAt).toLocaleDateString(locale)}
                      </p>
                    </div>
                    <Badge className={STATUS_COLORS[ticket.status] || ""}>
                      {getStatusLabel(ticket.status)}
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        {/* PM Plans Tab */}
        <TabsContent value="plans" className="space-y-3">
          {!history?.pmPlans || history.pmPlans.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center">
                <Wrench className="w-10 h-10 mx-auto text-muted-foreground/40 mb-3" />
                <p className="text-sm text-muted-foreground">{tr.assetHistory?.noPlans || "لا توجد خطط صيانة لهذا الأصل"}</p>
              </CardContent>
            </Card>
          ) : (
            history.pmPlans.map((plan: any) => (
              <Card key={plan.id} className="hover:shadow-md transition-shadow">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-mono text-muted-foreground">{plan.planNumber}</span>
                        {plan.isActive && <Badge className="bg-green-500">{tr.common?.active || "نشطة"}</Badge>}
                      </div>
                      <h4 className="font-medium truncate">{getField(plan, "title")}</h4>
                      <p className="text-xs text-muted-foreground mt-1">
                        التكرار: {plan.frequency} كل {plan.frequencyValue} {plan.frequencyValue > 1 ? "مرات" : "مرة"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        آخر تنفيذ: {plan.lastExecutedDate ? new Date(plan.lastExecutedDate).toLocaleDateString(locale) : "لم يتم التنفيذ"}
                      </p>
                    </div>
                    <Clock className="w-5 h-5 text-blue-500 flex-shrink-0" />
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        {/* Work Orders Tab */}
        <TabsContent value="workorders" className="space-y-3">
          {!history?.workOrders || history.workOrders.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center">
                <CheckCircle2 className="w-10 h-10 mx-auto text-muted-foreground/40 mb-3" />
                <p className="text-sm text-muted-foreground">{tr.assetHistory?.noWorkOrders || "لا توجد أوامر عمل لهذا الأصل"}</p>
              </CardContent>
            </Card>
          ) : (
            history.workOrders.map((wo: any) => (
              <Card key={wo.id} className="hover:shadow-md transition-shadow">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-mono text-muted-foreground">{wo.workOrderNumber}</span>
                        <Badge
                          className={
                            wo.status === "completed"
                              ? "bg-green-500"
                              : wo.status === "in_progress"
                                ? "bg-blue-500"
                                : "bg-gray-500"
                          }
                        >
                          {wo.status === "completed" ? "مكتملة" : wo.status === "in_progress" ? "قيد التنفيذ" : "مجدولة"}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        التاريخ المجدول: {new Date(wo.scheduledDate).toLocaleDateString(locale)}
                      </p>
                      {wo.completedDate && (
                        <p className="text-xs text-muted-foreground">
                          تاريخ الإنجاز: {new Date(wo.completedDate).toLocaleDateString(locale)}
                        </p>
                      )}
                    </div>
                    <Wrench className="w-5 h-5 text-purple-500 flex-shrink-0" />
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>
        {/* Inspection History Tab */}
        <TabsContent value="inspections" className="space-y-4">
          {/* Trend Chart */}
          {inspectionHistory && inspectionHistory.length > 1 && (() => {
            const chartData = [...inspectionHistory].reverse().map((s: any, i: number) => ({
              name: `#${i + 1}`,
              date: s.completedAt ? new Date(s.completedAt).toLocaleDateString("ar-SA", { month: "short", day: "numeric" }) : `فحص ${i + 1}`,
              سليم: s.okCount,
              إصلاح: s.fixedCount,
              خلل: s.issueCount,
            }));
            return (
              <Card className="border-blue-100">
                <CardHeader className="pb-2 pt-4 px-4">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-blue-500" />
                    تطور نتائج الفحوصات عبر الزمن
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-2 pb-4">
                  <ResponsiveContainer width="100%" height={200}>
                    <AreaChart data={chartData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                      <defs>
                        <linearGradient id="colorOk" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="colorFixed" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="colorIssue" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
                      <Tooltip
                        contentStyle={{ fontSize: 12, direction: "rtl" }}
                        formatter={(value: any, name: string) => [value, name]}
                      />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Area type="monotone" dataKey="سليم" stroke="#22c55e" fill="url(#colorOk)" strokeWidth={2} />
                      <Area type="monotone" dataKey="إصلاح" stroke="#3b82f6" fill="url(#colorFixed)" strokeWidth={2} />
                      <Area type="monotone" dataKey="خلل" stroke="#ef4444" fill="url(#colorIssue)" strokeWidth={2} />
                    </AreaChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            );
          })()}
          {/* Sessions List */}
          <div className="space-y-3">
          {inspectionLoading ? (
            <Card><CardContent className="p-8 text-center"><Clock className="w-10 h-10 mx-auto text-muted-foreground/40 mb-3 animate-spin" /></CardContent></Card>
          ) : !inspectionHistory || inspectionHistory.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center">
                <ClipboardCheck className="w-10 h-10 mx-auto text-muted-foreground/40 mb-3" />
                <p className="text-sm text-muted-foreground">{tr.assetHistory?.noInspections || "لا توجد فحوصات مكتملة لهذا الأصل"}</p>
              </CardContent>
            </Card>
          ) : (
            inspectionHistory.map((session: any) => {
              const hasIssues = session.issueCount > 0;
              const hasFixed = session.fixedCount > 0;
              const borderColor = hasIssues ? "border-red-200" : hasFixed ? "border-blue-200" : "border-green-200";
              const bgColor = hasIssues ? "bg-red-50" : hasFixed ? "bg-blue-50" : "bg-green-50";
              const icon = hasIssues ? (
                <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0" />
              ) : hasFixed ? (
                <Wrench className="w-5 h-5 text-blue-500 flex-shrink-0" />
              ) : (
                <CheckSquare className="w-5 h-5 text-green-500 flex-shrink-0" />
              );
              const durationMin = session.durationSeconds ? Math.round(session.durationSeconds / 60) : null;
              return (
                <Card key={session.id} className={`border ${borderColor} hover:shadow-md transition-shadow`}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3 flex-1 min-w-0">
                        {icon}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs font-mono text-muted-foreground">{session.workOrderNumber}</span>
                            {hasIssues && <Badge className="bg-red-500 text-white text-[10px] px-1.5">{session.issueCount} {"خلل"}</Badge>}
                            {hasFixed && <Badge className="bg-blue-500 text-white text-[10px] px-1.5">{session.fixedCount} {"إصلاح"}</Badge>}
                            {!hasIssues && !hasFixed && <Badge className="bg-green-500 text-white text-[10px] px-1.5">جميعها سليمة</Badge>}
                          </div>
                          <h4 className="font-medium text-sm truncate">{session.workOrderTitle}</h4>
                          <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {session.completedAt ? new Date(session.completedAt).toLocaleDateString(locale) : "—"}
                            </span>
                            {durationMin !== null && (
                              <span className="flex items-center gap-1">
                                <Timer className="w-3 h-3" />
                                {durationMin} دقيقة
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className={`text-center px-3 py-1.5 rounded-lg ${bgColor}`}>
                        <div className="text-lg font-bold">{session.totalItems}</div>
                        <div className="text-[10px] text-muted-foreground">بند</div>
                      </div>
                    </div>
                    {/* Mini stats row */}
                    <div className="flex gap-4 mt-3 pt-3 border-t text-xs">
                      <span className="flex items-center gap-1 text-green-600">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        سليم: {session.okCount}
                      </span>
                      <span className="flex items-center gap-1 text-blue-600">
                        <Wrench className="w-3.5 h-3.5" />
                        إصلاح: {session.fixedCount}
                      </span>
                      <span className="flex items-center gap-1 text-red-600">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        خلل: {session.issueCount}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}
          </div>
        </TabsContent>
      </Tabs>

      {/* تنبيهات ذكية */}
      {inspectionResultsList && inspectionResultsList.length > 0 && (() => {
        const severityOrder2 = ["low", "medium", "high", "critical"];
        const total2 = inspectionResultsList.length;
        const rc2: Record<string, number> = {};
        for (const r of inspectionResultsList) {
          if (r.rootCause) rc2[r.rootCause] = (rc2[r.rootCause] || 0) + 1;
        }
        const hs2 = inspectionResultsList.reduce((max, r) => {
          return severityOrder2.indexOf(r.severity) > severityOrder2.indexOf(max) ? r.severity : max;
        }, "low" as string);
        const alerts: string[] = [];
        for (const [cause, cnt] of Object.entries(rc2)) {
          if (cnt >= 3) alerts.push(`⚠️ عطل متكرر: ${cause}`);
        }
        if (hs2 === "high" || hs2 === "critical") alerts.push("⚠️ مستوى الخطورة مرتفع");
        if (total2 >= 5) alerts.push("💡 يوصى بالصيانة الوقائية");
        return (
          <div className="space-y-3 mt-6">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-base">🧠 تنبيهات ذكية</h3>
              <button
                onClick={() => setAlertsEnabled(v => !v)}
                className={`px-3 py-1 rounded text-sm font-semibold border transition-colors ${
                  alertsEnabled
                    ? "bg-blue-600 text-white border-blue-600"
                    : "bg-white dark:bg-gray-800 text-gray-600 border-gray-300"
                }`}
              >
                {alertsEnabled ? "✔ تشغيل التنبؤات" : "○ تشغيل التنبؤات"}
              </button>
            </div>
            {alertsEnabled && (
              alerts.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-2">لا توجد تنبيهات</p>
              ) : (
                <div className="space-y-2">
                  {alerts.map((alert, i) => (
                    <div key={i} className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-300 dark:border-yellow-700 rounded-lg px-4 py-3 text-sm font-bold text-yellow-800 dark:text-yellow-200">
                      {alert}
                    </div>
                  ))}
                </div>
              )
            )}
          </div>
        );
      })()}

      {/* تحليل الفحوصات */}
      {inspectionResultsList && inspectionResultsList.length > 0 && (() => {
        const severityOrder = ["low", "medium", "high", "critical"];
        const totalInspections = inspectionResultsList.length;
        const rootCauseCounts: Record<string, number> = {};
        for (const r of inspectionResultsList) {
          if (r.rootCause) rootCauseCounts[r.rootCause] = (rootCauseCounts[r.rootCause] || 0) + 1;
        }
        const mostFrequentRootCause = Object.entries(rootCauseCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "-";
        const highestSeverity = inspectionResultsList.reduce((max, r) => {
          return severityOrder.indexOf(r.severity) > severityOrder.indexOf(max) ? r.severity : max;
        }, "low" as string);
        const severityColorClass: Record<string, string> = {
          low: "text-green-600",
          medium: "text-yellow-600",
          high: "text-orange-600",
          critical: "text-red-600",
        };
        const rootCauseEntries = Object.entries(rootCauseCounts).sort((a, b) => b[1] - a[1]);
        const maxCount = rootCauseEntries[0]?.[1] || 1;
        return (
          <div className="space-y-3 mt-6">
            <h3 className="font-semibold text-base">تحليل الفحوصات</h3>
            <Card>
              <CardContent className="p-4 space-y-2 text-sm">
                <div><span className="font-bold">عدد الفحوصات:</span> {totalInspections}</div>
                <div><span className="font-bold">العطل الأكثر تكراراً:</span> {mostFrequentRootCause}</div>
                <div><span className="font-bold">أعلى خطورة:</span> <span className={`font-bold ${severityColorClass[highestSeverity] || ""}`}>{highestSeverity}</span></div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 space-y-3 text-sm">
                <div className="font-bold mb-2">توزيع الأسباب الجذرية</div>
                {rootCauseEntries.map(([cause, cnt]) => (
                  <div key={cause} className="space-y-1">
                    <div className="flex justify-between">
                      <span>{cause}</span>
                      <span className="font-bold">{cnt}</span>
                    </div>
                    <div className="w-full bg-gray-200 dark:bg-gray-700 rounded h-2">
                      <div
                        className="bg-blue-500 h-2 rounded"
                        style={{ width: `${Math.round((cnt / maxCount) * 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        );
      })()}

      {/* سجل الفحوصات */}
      <div className="space-y-3 mt-6">
        <h3 className="font-semibold text-base">سجل الفحوصات</h3>
        {!inspectionResultsList || inspectionResultsList.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">لا توجد فحوصات مسجلة لهذا الأصل</p>
        ) : (
          <div className="space-y-3">
            {inspectionResultsList.map((r) => (
              <Card key={r.id}>
                <CardContent className="p-4 text-sm space-y-1">
                  <div><span className="font-semibold">الخطورة:</span> {r.severity}</div>
                  <div><span className="font-semibold">السبب الجذري:</span> {r.rootCause}</div>
                  <div><span className="font-semibold">النتائج:</span> {r.findings}</div>
                  <div className="text-xs text-muted-foreground">{r.createdAt ? new Date(r.createdAt).toLocaleString(locale) : ""}</div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
