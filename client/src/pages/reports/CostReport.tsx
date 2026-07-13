import { useState, useMemo } from "react";
import { useLanguage } from "@/contexts/LanguageContext";
import { trpc } from "@/lib/trpc";
import { useLocation } from "wouter";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
  AreaChart, Area,
} from "recharts";
import {
  ArrowRight, TrendingUp, Building2, Layers, DollarSign,
  Wrench, ShoppingCart, AlertCircle, Info,
} from "lucide-react";

type Period = "month" | "quarter" | "year" | "all" | "custom";
type GroupBy = "site" | "section";

const COLORS = [
  "#6366f1", "#f59e0b", "#10b981", "#ef4444", "#3b82f6",
  "#8b5cf6", "#ec4899", "#14b8a6", "#f97316", "#84cc16",
  "#06b6d4", "#a855f7",
];

// PERIOD_LABELS moved to component

function formatCurrency(val: number) {
  return `${val.toLocaleString("ar-SA", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ر.س`;
}

function formatFull(val: number) {
  return `${val.toLocaleString("ar-SA", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ر.س`;
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl p-3 text-sm min-w-[170px]">
      <p className="font-semibold text-gray-800 dark:text-gray-100 mb-2 text-right">{label}</p>
      {payload.map((p: any, i: number) => (
        <div key={i} className="flex items-center justify-between gap-4 mb-1">
          <span className="font-medium text-gray-700 dark:text-gray-300">{formatFull(p.value)}</span>
          <span className="flex items-center gap-1 text-gray-500 dark:text-gray-400">
            <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: p.color }} />
            {p.name}
          </span>
        </div>
      ))}
    </div>
  );
};

const PieTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  const d = payload[0];
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl p-3 text-sm">
      <p className="font-semibold text-gray-800 dark:text-gray-100 mb-1 text-right">{d.name}</p>
      <p className="text-gray-600 dark:text-gray-400 text-right">{formatFull(d.value)}</p>
      <p className="text-indigo-500 font-medium text-right">{d.payload.percentage}%</p>
    </div>
  );
};

export default function CostReport() {
  const { t, language } = useLanguage();
  const [, setLocation] = useLocation();
  const PERIOD_LABELS: Record<Period, string> = {
    month: t.costReport.lastMonth,
    quarter: t.costReport.last3Months,
    year: t.costReport.lastYear,
    all: t.costReport.allTime,
    custom: t.costReport.custom,
  };
  const [groupBy, setGroupBy] = useState<GroupBy>("site");
  const [period, setPeriod] = useState<Period>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [chartType, setChartType] = useState<"bar" | "pie">("bar");

  const { data, isLoading } = trpc.reports.costReport.useQuery({
    groupBy,
    period,
    dateFrom: period === "custom" ? dateFrom : undefined,
    dateTo: period === "custom" ? dateTo : undefined,
  });

  const groups = data?.groups ?? [];
  const grandTotal = data?.grandTotal ?? 0;
  const monthlyTrend = data?.monthlyTrend ?? [];
  const totalTicketsNoCost = data?.totalTicketsNoCost ?? 0;

  // أعلى 5 للرسم الدائري (مع تجميع الباقي في "أخرى")
  const top5 = useMemo(() => {
    const classified = groups.filter(g => !g.isUnclassified);
    if (classified.length <= 5) return classified;
    const top = classified.slice(0, 5);
    const otherCost = classified.slice(5).reduce((s, g) => s + g.totalCost, 0);
    const otherPct = classified.slice(5).reduce((s, g) => s + g.percentage, 0);
    return [...top, { id: -2, name: t.costReport.other, totalCost: otherCost, percentage: Math.round(otherPct * 10) / 10, ticketCost: 0, purchaseCost: 0, ticketCount: 0, ticketsNoCost: 0, isUnclassified: false }];
  }, [groups]);

  const totalTicketCost = groups.reduce((s, g) => s + g.ticketCost, 0);
  const totalPurchaseCost = groups.reduce((s, g) => s + g.purchaseCost, 0);
  const classifiedGroups = groups.filter(g => !g.isUnclassified);
  const unclassifiedGroup = groups.find(g => g.isUnclassified);

  const hasData = groups.length > 0 && grandTotal > 0;
  const hasAnyTickets = groups.reduce((s, g) => s + g.ticketCount, 0) > 0;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 p-4 md:p-6" dir="rtl">
      {/* Header */}
      <div className="mb-6">
        <button
          onClick={() => setLocation("/")}
          className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 mb-4 transition-colors"
        >
          <ArrowRight className="w-4 h-4" />
          {t.nav?.dashboard || "لوحة التحكم"}
        </button>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
              <DollarSign className="w-7 h-7 text-violet-500" />
              {t.costReport.title}
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              "تحليل بصري لتكاليف الصيانة والمشتريات المستلمة"
            </p>
          </div>
          <div className="bg-gradient-to-br from-violet-500 to-indigo-600 text-white rounded-2xl px-6 py-3 shadow-lg shadow-violet-200 dark:shadow-violet-900/30">
            <p className="text-xs opacity-80 mb-0.5">{t.costReport.grandTotal}</p>
            <p className="text-2xl font-bold">{formatFull(grandTotal)}</p>
          </div>
        </div>
      </div>

      {/* فلاتر */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 p-4 mb-6 shadow-sm">
        <div className="flex flex-wrap gap-3 items-center">
          {/* تجميع حسب */}
          <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-800 rounded-xl p-1">
            <button
              onClick={() => setGroupBy("site")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${groupBy === "site" ? "bg-white dark:bg-gray-700 text-indigo-600 dark:text-indigo-400 shadow-sm" : "text-gray-500 dark:text-gray-400 hover:text-gray-700"}`}
            >
              <Building2 className="w-3.5 h-3.5" />
              حسب الموقع
            </button>
            <button
              onClick={() => setGroupBy("section")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${groupBy === "section" ? "bg-white dark:bg-gray-700 text-indigo-600 dark:text-indigo-400 shadow-sm" : "text-gray-500 dark:text-gray-400 hover:text-gray-700"}`}
            >
              <Layers className="w-3.5 h-3.5" />
              حسب القسم
            </button>
          </div>

          {/* الفترة الزمنية */}
          <div className="flex flex-wrap gap-1.5">
            {(["month", "quarter", "year", "all", "custom"] as Period[]).map(p => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${period === p ? "bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 border-indigo-200 dark:border-indigo-700" : "bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-700 hover:border-gray-300"}`}
              >
                {PERIOD_LABELS[p]}
              </button>
            ))}
          </div>

          {/* تواريخ مخصصة */}
          {period === "custom" && (
            <div className="flex items-center gap-2">
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                className="border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1.5 text-xs bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300" />
              <span className="text-gray-400 text-xs">{t.costReport.to}</span>
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                className="border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1.5 text-xs bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300" />
            </div>
          )}

          {/* نوع الرسم */}
          <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-800 rounded-xl p-1 mr-auto">
            <button onClick={() => setChartType("bar")}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${chartType === "bar" ? "bg-white dark:bg-gray-700 text-indigo-600 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}>
              أعمدة
            </button>
            <button onClick={() => setChartType("pie")}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${chartType === "pie" ? "bg-white dark:bg-gray-700 text-indigo-600 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}>
              دائري
            </button>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <>
          {/* تنبيه: بلاغات بدون تكلفة */}
          {totalTicketsNoCost > 0 && (
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl p-3 mb-4 flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
              <p className="text-sm text-amber-700 dark:text-amber-300">
                {t.costReport.ticketsNoCostWarning?.replace("{count}", String(totalTicketsNoCost)) || `يوجد ${totalTicketsNoCost} بلاغ لم تُدخل لها تكلفة`}
              </p>
            </div>
          )}

          {/* تنبيه: لا توجد بيانات */}
          {!hasData && !isLoading && (
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-xl p-4 mb-4 flex items-start gap-2.5">
              <Info className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm font-medium text-blue-700 dark:text-blue-300">{t.costReport.noCosts}</p>
                <p className="text-xs text-blue-600 dark:text-blue-400 mt-0.5">
                  {hasAnyTickets
                    ? t.costReport.hasCostsNoData
                    : t.costReport.noData}
                </p>
              </div>
            </div>
          )}

          {/* بطاقات الملخص */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 p-4 shadow-sm">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-violet-50 dark:bg-violet-900/30 flex items-center justify-center">
                  <DollarSign className="w-5 h-5 text-violet-500" />
                </div>
                <div>
                  <p className="text-xs text-gray-500 dark:text-gray-400">{t.costReport.totalCosts}</p>
                  <p className="text-lg font-bold text-gray-900 dark:text-white">{formatCurrency(grandTotal)}</p>
                </div>
              </div>
            </div>
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 p-4 shadow-sm">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center">
                  <Wrench className="w-5 h-5 text-blue-500" />
                </div>
                <div>
                  <p className="text-xs text-gray-500 dark:text-gray-400">{t.costReport.maintenanceCosts}</p>
                  <p className="text-lg font-bold text-gray-900 dark:text-white">{formatCurrency(totalTicketCost)}</p>
                </div>
              </div>
            </div>
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 p-4 shadow-sm">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-50 dark:bg-amber-900/30 flex items-center justify-center">
                  <ShoppingCart className="w-5 h-5 text-amber-500" />
                </div>
                <div>
                  <p className="text-xs text-gray-500 dark:text-gray-400">{t.costReport.purchaseCosts}</p>
                  <p className="text-lg font-bold text-gray-900 dark:text-white">{formatCurrency(totalPurchaseCost)}</p>
                </div>
              </div>
            </div>
          </div>

          {/* الرسم البياني الرئيسي + الأعلى تكلفةً */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
            <div className="lg:col-span-2 bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 p-5 shadow-sm">
              <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100 mb-4">
                توزيع التكاليف {groupBy === "site" ? t.costReport.bySite || "حسب الموقع" : t.costReport.bySection || "حسب القسم"}
              </h2>
              {!hasData ? (
                <div className="flex flex-col items-center justify-center h-48 text-gray-400">
                  <DollarSign className="w-10 h-10 mb-2 opacity-30" />
                  <p className="text-sm">{t.costReport.noDataToShow || "لا توجد تكاليف للعرض"}</p>
                </div>
              ) : chartType === "bar" ? (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={classifiedGroups} margin={{ top: 5, right: 5, left: 5, bottom: 60 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#6b7280" }} angle={-35} textAnchor="end" interval={0} />
                    <YAxis tickFormatter={formatCurrency} tick={{ fontSize: 10, fill: "#6b7280" }} width={72} />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar dataKey="ticketCost" name={t.costReport.maintenanceLabel || "صيانة"} stackId="a" fill="#6366f1" />
                    <Bar dataKey="purchaseCost" name={t.costReport.purchasesLabel || "مشتريات"} stackId="a" fill="#f59e0b" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <Pie data={top5} dataKey="totalCost" nameKey="name" cx="50%" cy="50%" outerRadius={100} innerRadius={50} paddingAngle={3}>
                      {top5.map((_, i) => (
                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip content={<PieTooltip />} />
                    <Legend formatter={(v) => <span className="text-xs text-gray-600 dark:text-gray-400">{v}</span>} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* الأعلى تكلفةً */}
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 p-5 shadow-sm">
              <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100 mb-4">{t.costReport.highestCost || "الأعلى تكلفةً"}</h2>
              {!hasData ? (
                <div className="flex items-center justify-center h-48 text-gray-400 text-sm">{t.common.noData || "لا توجد بيانات"}</div>
              ) : (
                <div className="space-y-3">
                  {classifiedGroups.slice(0, 6).map((g, i) => (
                    <div key={g.id}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium text-gray-500 dark:text-gray-400">{g.percentage}%</span>
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate max-w-[120px]">{g.name}</span>
                          <span className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
                            style={{ background: COLORS[i % COLORS.length] }}>
                            {i + 1}
                          </span>
                        </div>
                      </div>
                      <div className="w-full bg-gray-100 dark:bg-gray-800 rounded-full h-1.5">
                        <div className="h-1.5 rounded-full transition-all duration-500"
                          style={{ width: `${g.percentage}%`, background: COLORS[i % COLORS.length] }} />
                      </div>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 text-left">{formatCurrency(g.totalCost)}</p>
                    </div>
                  ))}
                  {/* غير محدد */}
                  {unclassifiedGroup && unclassifiedGroup.totalCost > 0 && (
                    <div className="pt-2 border-t border-dashed border-gray-200 dark:border-gray-700">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-gray-400">{t.common.unspecified || "غير محدد"}</span>
                        <span className="text-xs font-medium text-gray-500">{formatCurrency(unclassifiedGroup.totalCost)}</span>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* الاتجاه الشهري */}
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 p-5 shadow-sm mb-6">
            <div className="flex items-center gap-2 mb-4">
              <TrendingUp className="w-4 h-4 text-indigo-500" />
              <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100">{t.costReport.monthlyTrend || "الاتجاه الشهري (آخر 12 شهر)"}</h2>
            </div>
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={monthlyTrend} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
                <defs>
                  <linearGradient id="gradTicket" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gradPurchase" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#9ca3af" }} />
                <YAxis tickFormatter={formatCurrency} tick={{ fontSize: 10, fill: "#9ca3af" }} width={68} />
                <Tooltip content={<CustomTooltip />} />
                <Area type="monotone" dataKey="ticketCost" name={t.costReport.maintenanceLabel || "صيانة"} stroke="#6366f1" fill="url(#gradTicket)" strokeWidth={2} dot={false} />
                <Area type="monotone" dataKey="purchaseCost" name={t.costReport.purchasesLabel || "مشتريات"} stroke="#f59e0b" fill="url(#gradPurchase)" strokeWidth={2} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* جدول تفصيلي */}
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm overflow-hidden">
            <div className="p-5 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100">
                التفاصيل {groupBy === "site" ? t.costReport.bySite || "حسب الموقع" : t.costReport.bySection || "حسب القسم"}
              </h2>
              <div className="flex items-center gap-3 text-xs text-gray-400">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-indigo-400 inline-block" />{t.costReport.maintenanceLabel || "صيانة"}</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />{t.costReport.purchasesLabel || "مشتريات مستلمة"}</span>
              </div>
            </div>
            {groups.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-gray-400">
                <DollarSign className="w-10 h-10 mb-2 opacity-30" />
                <p className="text-sm">{t.costReport.noDataForPeriod || "لا توجد بيانات للفترة المحددة"}</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 dark:bg-gray-800/50">
                      <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400">#</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400">
                        {groupBy === "site" ? (t.common.site || "الموقع") : (t.common.section || "القسم")}
                      </th>
                      {groupBy === "section" && (
                        <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400">{t.common.site || "الموقع"}</th>
                      )}
                      <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400">{t.costReport.maintenanceCosts}</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400">{t.costReport.purchaseCosts}</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400">{t.common.total || "الإجمالي"}</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400">{t.costReport.percentage || "النسبة"}</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400">{t.costReport.tickets || "البلاغات"}</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400">
                        <span title={t.costReport.noCostTitle || "بلاغات لم تُدخل لها تكلفة"}>{t.costReport.noCostLabel || "بدون تكلفة"}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                    {groups.map((g, i) => {
                      const isUnclassified = g.isUnclassified;
                      const color = isUnclassified ? "#9ca3af" : COLORS[i % COLORS.length];
                      return (
                        <tr key={g.id}
                          className={`hover:bg-gray-50 dark:hover:bg-gray-800/30 transition-colors ${isUnclassified ? "bg-gray-50/50 dark:bg-gray-800/20" : ""}`}>
                          <td className="px-4 py-3.5">
                            {isUnclassified ? (
                              <span className="text-xs text-gray-400">—</span>
                            ) : (
                              <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white"
                                style={{ background: color }}>
                                {i + 1}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3.5">
                            <span className={`font-medium ${isUnclassified ? "text-gray-400 dark:text-gray-500 italic" : "text-gray-800 dark:text-gray-200"}`}>
                              {g.name}
                            </span>
                          </td>
                          {groupBy === "section" && (
                            <td className="px-4 py-3.5 text-gray-500 dark:text-gray-400 text-xs">{(g as any).siteName || "—"}</td>
                          )}
                          <td className="px-4 py-3.5 text-blue-600 dark:text-blue-400 font-medium">{formatFull(g.ticketCost)}</td>
                          <td className="px-4 py-3.5 text-amber-600 dark:text-amber-400 font-medium">{formatFull(g.purchaseCost)}</td>
                          <td className="px-4 py-3.5 font-bold text-gray-900 dark:text-white">{formatFull(g.totalCost)}</td>
                          <td className="px-4 py-3.5">
                            <div className="flex items-center gap-2">
                              <div className="w-14 bg-gray-100 dark:bg-gray-800 rounded-full h-1.5">
                                <div className="h-1.5 rounded-full" style={{ width: `${g.percentage}%`, background: color }} />
                              </div>
                              <span className="text-xs text-gray-500 dark:text-gray-400">{g.percentage}%</span>
                            </div>
                          </td>
                          <td className="px-4 py-3.5 text-center">
                            <span className="bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 text-xs font-medium px-2 py-0.5 rounded-full">
                              {g.ticketCount}
                            </span>
                          </td>
                          <td className="px-4 py-3.5 text-center">
                            {g.ticketsNoCost > 0 ? (
                              <span className="bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 text-xs font-medium px-2 py-0.5 rounded-full">
                                {g.ticketsNoCost}
                              </span>
                            ) : (
                              <span className="text-gray-300 dark:text-gray-600 text-xs">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="bg-gray-50 dark:bg-gray-800/50 border-t-2 border-gray-200 dark:border-gray-700">
                      <td colSpan={groupBy === "section" ? 3 : 2} className="px-4 py-3.5 font-bold text-gray-700 dark:text-gray-300 text-sm">{t.common.total || "الإجمالي"}</td>
                      <td className="px-4 py-3.5 font-bold text-blue-600 dark:text-blue-400">{formatFull(totalTicketCost)}</td>
                      <td className="px-4 py-3.5 font-bold text-amber-600 dark:text-amber-400">{formatFull(totalPurchaseCost)}</td>
                      <td className="px-4 py-3.5 font-bold text-gray-900 dark:text-white text-base">{formatFull(grandTotal)}</td>
                      <td className="px-4 py-3.5 font-bold text-gray-500">100%</td>
                      <td className="px-4 py-3.5 text-center font-bold">
                        <span className="bg-gray-200 dark:bg-gray-700 text-xs font-medium px-2 py-0.5 rounded-full text-gray-600 dark:text-gray-400">
                          {groups.reduce((s, g) => s + g.ticketCount, 0)}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 text-center">
                        {totalTicketsNoCost > 0 ? (
                          <span className="bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 text-xs font-medium px-2 py-0.5 rounded-full">
                            {totalTicketsNoCost}
                          </span>
                        ) : (
                          <span className="text-gray-300 text-xs">—</span>
                        )}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>

          {/* ملاحظة مصدر البيانات */}
          <div className="mt-4 flex items-start gap-2 text-xs text-gray-400 dark:text-gray-500">
            <Info className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
            <p>
              {t.costReport.sourceNote1 || "تكاليف الصيانة: من حقل التكلفة الفعلية أو التقديرية في البلاغات."}
              {t.costReport.sourceNote2 || "تكاليف المشتريات: من أصناف الشراء المستلمة فعلياً."}
            </p>
          </div>
        </>
      )}
    </div>
  );
}
