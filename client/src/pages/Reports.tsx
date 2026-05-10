import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import { useTranslation } from "@/contexts/LanguageContext";
import { useStaticLabels } from "@/hooks/useContentTranslation";
import { AlertCircle, CheckCircle2, Clock, Wrench, TrendingUp, BarChart3, ListFilter } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLocation } from "wouter";
import { formatDistanceToNow, differenceInHours } from "date-fns";
import { ar } from "date-fns/locale";
import { useState } from "react";

type FocusMode = 'general' | 'maintenance';

export default function Reports() {
  const { t } = useTranslation();
  const { getStatusLabel, getPriorityLabel } = useStaticLabels();
  const [, setLocation] = useLocation();
  const [focusMode, setFocusMode] = useState<FocusMode>('general');
  
  // Data Queries
  const { data: byStatus, isLoading: l1 } = trpc.reports.ticketsByStatus.useQuery();
  const { data: byPriority, isLoading: l3 } = trpc.reports.ticketsByPriority.useQuery();
  const { data: monthly, isLoading: l5 } = trpc.reports.monthlySummary.useQuery();
  const { data: byCategory } = trpc.reports.ticketsByCategory.useQuery();

  // Phase 5B: Ambient Operational Procurement Awareness - Material Pending Tickets
  const { data: needsPurchaseTickets } = trpc.tickets.list.useQuery({ status: 'needs_purchase' });

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

  // PHASE 3B: Micro Operational Interpretation Logic
  const criticalAwaitingAssignment = criticalList?.filter(t => t.status === 'new').length || 0;
  const topCategory = byCategory?.sort((a, b) => b.count - a.count)[0];

  // Components as variables for spatial reordering
  const ExecutiveSummary = (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      <SummaryCard 
        title="البلاغات المفتوحة" 
        value={openTickets} 
        icon={<Wrench className="w-5 h-5 text-blue-500/70" />}
        loading={l1}
        onClick={() => setLocation('/tickets?status=open')}
        clickable
      />
      <SummaryCard 
        title="البلاغات الحرجة" 
        value={criticalCount} 
        icon={<AlertCircle className="w-5 h-5 text-red-500/70" />}
        loading={l3}
        highlight={criticalCount > 0}
        onClick={() => setLocation('/tickets?priority=critical')}
        clickable
      />
      <SummaryCard 
        title="أنجز هذا الشهر" 
        value={completedThisMonth} 
        icon={<CheckCircle2 className="w-5 h-5 text-emerald-500/70" />}
        loading={l5}
      />
      <SummaryCard 
        title="بلاغات جديدة (شهر)" 
        value={createdThisMonth} 
        icon={<Clock className="w-5 h-5 text-amber-500/70" />}
        loading={l5}
      />
    </div>
  );

  const ContextSummaries = (
    <div className="space-y-4">
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
      
      {/* PHASE 3B, 4A & 4B: Micro Operational Interpretations with natural rhythm */}
      <div className="px-2 space-y-2">
        {criticalAwaitingAssignment > 0 && (
          <p 
            className="text-[11px] text-slate-400 leading-relaxed cursor-pointer hover:text-slate-500 transition-colors"
            onClick={() => setLocation('/tickets?priority=critical')}
          >
            {criticalAwaitingAssignment} بلاغات حرجة لم يتم إسنادها لأي فني حتى الآن.
          </p>
        )}
        {topCategory && (
          <p className="text-[11px] text-slate-400 leading-relaxed">
            أعلى عدد من البلاغات الجديدة حالياً في فئة {topCategory.category}.
          </p>
        )}
        {needsPurchaseTickets && needsPurchaseTickets.length > 0 && (
          <p 
            className="text-[11px] text-slate-400 leading-relaxed cursor-pointer hover:text-slate-500 transition-colors"
            onClick={() => setLocation('/tickets?status=needs_purchase')}
          >
            {needsPurchaseTickets.length} عمل ينتظر مواد.
          </p>
        )}
      </div>
    </div>
  );

  const OperationalAttentionPanel = (
    <Card className="border-slate-100/80 shadow-sm">
      <CardHeader className="pb-3 border-b border-slate-50 flex flex-row items-center justify-between space-y-0 px-5">
        <CardTitle className="text-sm font-semibold flex items-center gap-2 text-slate-700">
          <ListFilter className="w-4 h-4 text-red-400/80" />
          لوحة الانتباه التشغيلي: بلاغات حرجة
        </CardTitle>
        {criticalCount > 5 && (
          <button 
            onClick={() => setLocation('/tickets?priority=critical')}
            className="text-[10px] font-medium text-slate-400 hover:text-slate-500 uppercase tracking-tighter transition-colors"
          >
            عرض الكل ({criticalCount})
          </button>
        )}
      </CardHeader>
      <CardContent className="pt-1 px-0">
        {lCritical ? (
          <div className="p-4 space-y-3">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-10 w-full" />)}
          </div>
        ) : topCriticalTickets.length > 0 ? (
          <div className="divide-y divide-slate-50/50">
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
  );

  const OperationalPanels = (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Status Distribution Table */}
      <Card className="lg:col-span-1 border-slate-100/80 shadow-sm">
        <CardHeader className="pb-3 border-b border-slate-50 px-5">
          <CardTitle className="text-sm font-medium flex items-center gap-2 text-slate-600">
            <BarChart3 className="w-4 h-4 text-slate-300" />
            {t.reports.ticketsByStatus}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4 px-4 pb-5">
          {l1 ? <SkeletonList /> : (
            <div className="space-y-0.5">
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
      <Card className="lg:col-span-1 border-slate-100/80 shadow-sm">
        <CardHeader className="pb-3 border-b border-slate-50 px-5">
          <CardTitle className="text-sm font-medium flex items-center gap-2 text-slate-600">
            <AlertCircle className="w-4 h-4 text-slate-300" />
            {t.reports.ticketsByPriority}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4 px-4 pb-5">
          {l3 ? <SkeletonList /> : (
            <div className="space-y-0.5">
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
      <Card className="lg:col-span-1 border-slate-100/80 shadow-sm">
        <CardHeader className="pb-3 border-b border-slate-50 px-5">
          <CardTitle className="text-sm font-medium flex items-center gap-2 text-slate-600">
            <TrendingUp className="w-4 h-4 text-slate-300" />
            {t.reports.monthlyTrend}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-6 px-4 pb-5">
          {l5 ? <Skeleton className="h-40 w-full" /> : monthly && monthly.length > 0 ? (
            <div className="h-40 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={monthly}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis 
                    dataKey="month" 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{fontSize: 10, fill: '#94a3b8'}}
                    dy={10}
                  />
                  <YAxis 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{fontSize: 10, fill: '#94a3b8'}}
                  />
                  <Tooltip 
                    contentStyle={{borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.05)'}}
                    labelStyle={{fontWeight: 'bold', marginBottom: '4px'}}
                  />
                  <Line 
                    type="monotone" 
                    dataKey="closed" 
                    name={t.reports.completed}
                    stroke="#10b981" 
                    strokeWidth={2} 
                    dot={{r: 4, fill: '#10b981', strokeWidth: 2, stroke: '#fff'}}
                    activeDot={{r: 6}}
                  />
                  <Line 
                    type="monotone" 
                    dataKey="created" 
                    name="بلاغات جديدة"
                    stroke="#3b82f6" 
                    strokeWidth={2} 
                    dot={{r: 4, fill: '#3b82f6', strokeWidth: 2, stroke: '#fff'}}
                    activeDot={{r: 6}}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : <EmptyState />}
        </CardContent>
      </Card>
    </div>
  );

  return (
    <div className="space-y-8 pb-12 animate-in fade-in duration-700">
      {/* Header Section with calm focus toggle */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-slate-100 pb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">{t.reports.title}</h1>
          <p className="text-slate-500 text-sm mt-1"></p>
        </div>
        
        <div className="flex bg-slate-100/50 p-1 rounded-lg self-start md:self-auto">
          <button 
            onClick={() => setFocusMode('general')}
            className={cn(
              "px-4 py-1.5 text-xs font-medium rounded-md transition-all duration-200",
              focusMode === 'general' ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
            )}
          >
            نظرة عامة
          </button>
          <button 
            onClick={() => setFocusMode('maintenance')}
            className={cn(
              "px-4 py-1.5 text-xs font-medium rounded-md transition-all duration-200",
              focusMode === 'maintenance' ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
            )}
          >
            الأداء التشغيلي
          </button>
        </div>
      </div>

      {ExecutiveSummary}
      
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-8 items-start">
        <div className="xl:col-span-4 space-y-6">
          {ContextSummaries}
        </div>
        
        <div className="xl:col-span-8">
          {OperationalAttentionPanel}
        </div>
      </div>

      {OperationalPanels}
    </div>
  );
}

// Minimalistic Sub-components for visual consistency
function SummaryCard({ title, value, icon, loading, highlight, onClick, clickable }: any) {
  return (
    <Card 
      className={cn(
        "border-slate-200/60 shadow-sm transition-all duration-300",
        highlight && "border-red-100 bg-red-50/30",
        clickable && "cursor-pointer hover:border-slate-300 hover:shadow-md active:scale-[0.98]"
      )}
      onClick={onClick}
    >
      <CardContent className="p-5">
        <div className="flex items-center justify-between">
          <div className="bg-slate-50 p-2 rounded-lg">{icon}</div>
          {loading ? <Skeleton className="h-8 w-12" /> : (
            <span className={cn(
              "text-2xl font-bold tracking-tight",
              highlight ? "text-red-600" : "text-slate-900"
            )}>
              {value}
            </span>
          )}
        </div>
        <p className="text-xs font-medium text-slate-500 mt-3">{title}</p>
      </CardContent>
    </Card>
  );
}

function ContextSummary({ text, onClick }: { text: string, onClick: () => void }) {
  return (
    <div 
      onClick={onClick}
      className="flex items-center gap-3 p-3 rounded-xl bg-slate-50/50 border border-slate-100/50 cursor-pointer hover:bg-slate-100/80 transition-all duration-200 group"
    >
      <div className="w-1.5 h-1.5 rounded-full bg-slate-300 group-hover:bg-slate-400 transition-colors" />
      <span className="text-[11px] font-medium text-slate-600 group-hover:text-slate-900 transition-colors">{text}</span>
    </div>
  );
}

function AttentionRow({ id, ticketNumber, title, createdAt, status, onClick }: any) {
  return (
    <div 
      onClick={onClick}
      className="group flex items-center justify-between p-4 hover:bg-slate-50/50 cursor-pointer transition-colors"
    >
      <div className="flex flex-col gap-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold text-slate-400 tabular-nums">#{ticketNumber}</span>
          <h3 className="text-xs font-semibold text-slate-800 truncate group-hover:text-blue-600 transition-colors">{title}</h3>
        </div>
        <span className="text-[10px] text-slate-400">{formatDistanceToNow(new Date(createdAt), { addSuffix: true, locale: ar })}</span>
      </div>
      <div className="flex items-center gap-3">
        <span className="px-2 py-0.5 rounded-full bg-slate-100 text-[9px] font-bold text-slate-500 uppercase tracking-wider">{status}</span>
      </div>
    </div>
  );
}

function OperationalRow({ label, value, clickable, onClick }: any) {
  return (
    <div 
      onClick={onClick}
      className={cn(
        "flex items-center justify-between py-2.5 px-2 rounded-lg transition-colors",
        clickable ? "cursor-pointer hover:bg-slate-50 group" : ""
      )}
    >
      <span className={cn(
        "text-xs text-slate-600",
        clickable && "group-hover:text-slate-900 font-medium"
      )}>{label}</span>
      <span className="text-xs font-bold text-slate-900 tabular-nums">{value}</span>
    </div>
  );
}

function SkeletonList() {
  return (
    <div className="space-y-3">
      {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-8 w-full" />)}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="py-6 text-center">
      <p className="text-[10px] text-slate-400 italic">لا توجد بيانات متوفرة</p>
    </div>
  );
}
