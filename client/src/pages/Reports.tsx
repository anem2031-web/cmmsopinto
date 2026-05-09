import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import { useTranslation } from "@/contexts/LanguageContext";
import { useStaticLabels } from "@/hooks/useContentTranslation";
import { AlertCircle, CheckCircle2, Clock, Wrench, TrendingUp, BarChart3, ListFilter, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLocation } from "wouter";
import { formatDistanceToNow, differenceInHours } from "date-fns";
import { ar } from "date-fns/locale";

export default function Reports() {
  const { t } = useTranslation();
  const { getStatusLabel, getPriorityLabel } = useStaticLabels();
  const [, setLocation] = useLocation();
  
  // Data Queries
  const { data: byStatus, isLoading: l1 } = trpc.reports.ticketsByStatus.useQuery();
  const { data: byPriority, isLoading: l3 } = trpc.reports.ticketsByPriority.useQuery();
  const { data: monthly, isLoading: l5 } = trpc.reports.monthlySummary.useQuery();
  
  // Phase 2A: Fetch only critical tickets for attention panel
  const { data: criticalList, isLoading: lCritical } = trpc.tickets.list.useQuery({ 
    priority: 'critical' 
  });

  // Summary Calculations
  const openTickets = byStatus?.filter(d => d.status !== 'closed' && d.status !== 'cancelled')
    .reduce((sum, d) => sum + d.count, 0) || 0;
  
  const criticalCount = byPriority?.find(d => d.priority === 'critical')?.count || 0;
  
  const currentMonthData = monthly?.[monthly.length - 1];
  const completedThisMonth = currentMonthData?.closed || 0;
  const createdThisMonth = currentMonthData?.created || 0;

  // Formatted Data for Tables
  const statusData = byStatus?.map(d => ({ 
    key: d.status, 
    label: getStatusLabel(d.status), 
    value: d.count 
  })) || [];

  const priorityData = byPriority?.map(d => ({ 
    key: d.priority, 
    label: getPriorityLabel(d.priority), 
    value: d.count 
  })) || [];

  // Limit critical tickets to 5 max
  const topCriticalTickets = criticalList?.slice(0, 5) || [];

  // PHASE 2B: Operational Context Logic (Deterministic)
  const agingCriticalCount = criticalList?.filter(ticket => 
    differenceInHours(new Date(), new Date(ticket.createdAt)) > 48
  ).length || 0;

  const awaitingAssignmentCount = byStatus?.find(d => d.status === 'new')?.count || 0;

  return (
    <div className="space-y-8 max-w-7xl mx-auto pb-10">
      {/* Page Header */}
      <div className="flex items-start justify-between flex-wrap gap-3 px-1">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">{t.reports.title}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t.reports.overview}</p>
        </div>
      </div>

      {/* 1. EXECUTIVE SUMMARY STRIP */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <SummaryCard 
          title="البلاغات المفتوحة" 
          value={openTickets} 
          icon={<Wrench className="w-5 h-5 text-blue-500" />}
          loading={l1}
          onClick={() => setLocation('/tickets?status=open')}
          clickable
        />
        <SummaryCard 
          title="البلاغات الحرجة" 
          value={criticalCount} 
          icon={<AlertCircle className="w-5 h-5 text-red-500" />}
          loading={l3}
          highlight={criticalCount > 0}
          onClick={() => setLocation('/tickets?priority=critical')}
          clickable
        />
        <SummaryCard 
          title="أنجز هذا الشهر" 
          value={completedThisMonth} 
          icon={<CheckCircle2 className="w-5 h-5 text-emerald-500" />}
          loading={l5}
        />
        <SummaryCard 
          title="بلاغات جديدة (شهر)" 
          value={createdThisMonth} 
          icon={<Clock className="w-5 h-5 text-amber-500" />}
          loading={l5}
        />
      </div>

      {/* 2. CALM OPERATIONAL PANELS */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Status Distribution Table */}
        <Card className="lg:col-span-1 border-slate-200/60 shadow-sm">
          <CardHeader className="pb-3 border-b border-slate-50">
            <CardTitle className="text-sm font-medium flex items-center gap-2 text-slate-700">
              <BarChart3 className="w-4 h-4 text-slate-400" />
              {t.reports.ticketsByStatus}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            {l1 ? <SkeletonList /> : (
              <div className="space-y-1">
                {statusData.length > 0 ? statusData.map((item, i) => (
                  <OperationalRow 
                    key={i} 
                    label={item.label} 
                    value={item.value} 
                    clickable={item.key === 'new' || item.key === 'assigned' || item.key === 'in_progress'}
                    onClick={item.key === 'new' || item.key === 'assigned' || item.key === 'in_progress' ? () => setLocation('/tickets?status=open') : undefined}
                  />
                )) : <EmptyState />}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Priority Distribution Table */}
        <Card className="lg:col-span-1 border-slate-200/60 shadow-sm">
          <CardHeader className="pb-3 border-b border-slate-50">
            <CardTitle className="text-sm font-medium flex items-center gap-2 text-slate-700">
              <AlertCircle className="w-4 h-4 text-slate-400" />
              {t.reports.ticketsByPriority}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            {l3 ? <SkeletonList /> : (
              <div className="space-y-1">
                {priorityData.length > 0 ? priorityData.map((item, i) => (
                  <OperationalRow 
                    key={i} 
                    label={item.label} 
                    value={item.value} 
                    clickable={item.key === 'critical'}
                    onClick={item.key === 'critical' ? () => setLocation('/tickets?priority=critical') : undefined}
                  />
                )) : <EmptyState />}
              </div>
            )}
          </CardContent>
        </Card>

        {/* 3. SIMPLIFIED VISUAL HIERARCHY - Monthly Operational Trend */}
        <Card className="lg:col-span-1 border-slate-200/60 shadow-sm">
          <CardHeader className="pb-3 border-b border-slate-50">
            <CardTitle className="text-sm font-medium flex items-center gap-2 text-slate-700">
              <TrendingUp className="w-4 h-4 text-slate-400" />
              {t.reports.monthlyTrend}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-6">
            {l5 ? <Skeleton className="h-40 w-full" /> : monthly && monthly.length > 0 ? (
              <div className="h-40 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={monthly} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis 
                      dataKey="month" 
                      hide={false} 
                      axisLine={false} 
                      tickLine={false} 
                      tick={{ fontSize: 10, fill: '#94a3b8' }}
                      dy={10}
                    />
                    <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#94a3b8' }} />
                    <Tooltip 
                      contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.05)', fontSize: '12px' }}
                    />
                    <Line 
                      type="monotone" 
                      dataKey="created" 
                      stroke="#94a3b8" 
                      strokeWidth={1.5} 
                      dot={false} 
                      activeDot={{ r: 4, strokeWidth: 0 }} 
                    />
                    <Line 
                      type="monotone" 
                      dataKey="closed" 
                      stroke="#10b981" 
                      strokeWidth={2} 
                      dot={false} 
                      activeDot={{ r: 4, strokeWidth: 0 }} 
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : <EmptyState />}
          </CardContent>
        </Card>
      </div>

      {/* PHASE 2A: OPERATIONAL ATTENTION PANEL - Critical Tickets Only */}
      <Card className="border-slate-200/60 shadow-sm">
        <CardHeader className="pb-3 border-b border-slate-50 flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-sm font-semibold flex items-center gap-2 text-slate-800">
            <ListFilter className="w-4 h-4 text-red-500" />
            لوحة الانتباه التشغيلي: بلاغات حرجة
          </CardTitle>
          {criticalCount > 5 && (
            <button 
              onClick={() => setLocation('/tickets?priority=critical')}
              className="text-[10px] font-medium text-slate-400 hover:text-slate-600 uppercase tracking-tighter"
            >
              عرض الكل ({criticalCount})
            </button>
          )}
        </CardHeader>
        <CardContent className="pt-2 px-0">
          {lCritical ? (
            <div className="p-4 space-y-3">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : topCriticalTickets.length > 0 ? (
            <div className="divide-y divide-slate-50">
              {topCriticalTickets.map((ticket) => (
                <AttentionRow 
                  key={ticket.id}
                  id={ticket.id}
                  ticketNumber={ticket.ticketNumber}
                  title={ticket.title}
                  createdAt={ticket.createdAt}
                  status={getStatusLabel(ticket.status)}
                  onClick={() => setLocation(`/tickets/${ticket.id}`)}
                />
              ))}
            </div>
          ) : (
            <div className="py-10 text-center">
              <p className="text-xs text-muted-foreground italic opacity-60">لا توجد بلاغات حرجة حالياً</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* PHASE 2B: OPERATIONAL CONTEXT SUMMARIES */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 px-1">
        {agingCriticalCount > 0 && (
          <ContextSummary 
            text={`${agingCriticalCount} بلاغات حرجة تجاوزت 48 ساعة`}
            onClick={() => setLocation('/tickets?priority=critical')}
          />
        )}
        {awaitingAssignmentCount > 0 && (
          <ContextSummary 
            text={`${awaitingAssignmentCount} بلاغات جديدة بانتظار الإسناد`}
            onClick={() => setLocation('/tickets?status=open')}
          />
        )}
      </div>
    </div>
  );
}

// --- Sub-components for Cleanliness ---

function SummaryCard({ title, value, icon, loading, highlight, onClick, clickable }: any) {
  return (
    <Card 
      className={cn(
        "border-slate-200/60 shadow-sm overflow-hidden transition-all duration-200", 
        highlight && "border-red-100 bg-red-50/30",
        clickable && "cursor-pointer hover:bg-slate-50/80 dark:hover:bg-slate-800/50 active:scale-[0.98]"
      )}
      onClick={onClick}
    >
      <CardContent className="p-5">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">{title}</p>
            {loading ? <Skeleton className="h-8 w-16" /> : (
              <p className={cn("text-2xl font-bold text-slate-900 dark:text-slate-100", highlight && "text-red-600")}>
                {value}
              </p>
            )}
          </div>
          <div className="p-2.5 bg-slate-50 dark:bg-slate-800 rounded-xl">
            {icon}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function OperationalRow({ label, value, onClick, clickable }: { label: string, value: number, onClick?: () => void, clickable?: boolean }) {
  return (
    <div 
      className={cn(
        "flex items-center justify-between py-2 px-2 rounded-md transition-colors duration-150",
        clickable ? "cursor-pointer hover:bg-slate-50/80 dark:hover:bg-slate-800/50" : "border-b border-slate-50 last:border-0"
      )}
      onClick={onClick}
    >
      <span className={cn("text-sm", clickable ? "text-slate-900 dark:text-slate-100 font-medium" : "text-slate-600 dark:text-slate-400")}>
        {label}
      </span>
      <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">{value}</span>
    </div>
  );
}

function AttentionRow({ id, ticketNumber, title, createdAt, status, onClick }: any) {
  const timeAgo = formatDistanceToNow(new Date(createdAt), { addSuffix: true, locale: ar });
  
  return (
    <div 
      onClick={onClick}
      className="group flex items-center justify-between py-3 px-5 cursor-pointer hover:bg-slate-50/50 transition-colors duration-150"
    >
      <div className="flex flex-col min-w-0 flex-1">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-[10px] font-bold text-slate-400 tabular-nums">{ticketNumber}</span>
          <h4 className="text-sm font-medium text-slate-700 truncate group-hover:text-slate-900 transition-colors">
            {title}
          </h4>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[11px] text-slate-400 flex items-center gap-1">
            <Clock className="w-3 h-3 opacity-40" />
            {timeAgo}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-4 ml-4">
        <span className="text-[10px] font-semibold text-red-500/80 bg-red-50 px-2 py-0.5 rounded-full border border-red-100/50">
          {status}
        </span>
      </div>
    </div>
  );
}

function ContextSummary({ text, onClick }: { text: string, onClick?: () => void }) {
  return (
    <div 
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 py-2 px-3 rounded-lg border border-slate-100 bg-slate-50/30 transition-all duration-150",
        onClick && "cursor-pointer hover:bg-slate-50 hover:border-slate-200"
      )}
    >
      <Info className="w-3.5 h-3.5 text-slate-400 shrink-0" />
      <span className="text-xs text-slate-600 font-medium leading-tight">
        {text}
      </span>
    </div>
  );
}

function SkeletonList() {
  return (
    <div className="space-y-4">
      {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-5 w-full" />)}
    </div>
  );
}

function EmptyState() {
  return <p className="text-xs text-muted-foreground text-center py-8 italic opacity-60">لا توجد بيانات كافية</p>;
}
