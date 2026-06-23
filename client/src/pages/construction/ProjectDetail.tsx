import { useState, lazy, Suspense } from "react";
import { trpc } from "@/lib/trpc";
import { useParams, useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Building2, ArrowRight, Columns, GanttChartSquare,
  Users, Target, FileText, ClipboardList, ShieldAlert,
  Package, GitMerge, Pencil, CheckCircle2, AlertTriangle,
  Clock, TrendingUp, Layers
} from "lucide-react";
import ProjectKanban from "./ProjectKanban";
import ProjectGantt from "./ProjectGantt";
import ProjectMembers from "./ProjectMembers";
import DailyReportTab from "./DailyReportTab";
const ProjectWhiteboard = lazy(() => import("./ProjectWhiteboard"));
const ProjectMindMap = lazy(() => import("./ProjectMindMap"));
import ProjectAutomations from "./ProjectAutomations";
import PhaseManager from "../../components/construction/PhaseManager";

const statusColors: Record<string, string> = {
  planning:  "bg-slate-100 text-slate-700",
  active:    "bg-teal-100 text-teal-700",
  on_hold:   "bg-amber-100 text-amber-700",
  completed: "bg-green-100 text-green-700",
  cancelled: "bg-red-100 text-red-700",
};

const statusLabels: Record<string, string> = {
  planning: "تخطيط", active: "نشط", on_hold: "موقوف",
  completed: "مكتمل", cancelled: "ملغي",
};

export default function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const [activeTab, setActiveTab] = useState("overview");
  const projectId = Number(id);

  const { data: project, isLoading } = trpc.construction.projects.getById.useQuery(
    { id: projectId },
    { enabled: !!projectId }
  );

  const { data: phasesData } = trpc.construction.phases.list.useQuery(
    { projectId },
    { enabled: !!projectId }
  );

  const phases = phasesData ?? [];

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="p-6 text-center">
        <Building2 className="w-12 h-12 text-slate-300 mx-auto mb-3" />
        <p className="text-slate-500">المشروع غير موجود</p>
        <Button onClick={() => navigate("/construction/projects")} variant="outline" className="mt-3">
          العودة للمشاريع
        </Button>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-full">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <button onClick={() => navigate("/construction")} className="hover:text-[#0D9488]">
          الإنشاءات
        </button>
        <ArrowRight className="w-3 h-3" />
        <button onClick={() => navigate("/construction/projects")} className="hover:text-[#0D9488]">
          المشاريع
        </button>
        <ArrowRight className="w-3 h-3" />
        <span className="text-[#1A2B4A] font-medium truncate">{project.name}</span>
      </div>

      {/* Project Header */}
      <Card>
        <CardContent className="p-5">
          <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-2">
                <span className="text-xs font-mono text-slate-400">{project.projectNumber}</span>
                <Badge className={`text-xs rounded-full ${statusColors[project.status]}`}>
                  {statusLabels[project.status]}
                </Badge>
              </div>
              <h1 className="text-xl font-bold text-[#1A2B4A]">{project.name}</h1>
              {project.description && (
                <p className="text-sm text-slate-500 mt-1 line-clamp-2">{project.description}</p>
              )}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate(`/construction/projects/${projectId}/edit`)}
              className="gap-2 flex-shrink-0"
            >
              <Pencil className="w-3.5 h-3.5" />
              تعديل
            </Button>
          </div>

          {/* Stats Row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-5 pt-4 border-t border-slate-100">
            <div className="text-center">
              <p className="text-2xl font-bold text-[#0D9488]">{project.stats.taskTotal}</p>
              <p className="text-xs text-slate-500 mt-0.5">إجمالي المهام</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-[#16A34A]">{project.stats.taskCompleted}</p>
              <p className="text-xs text-slate-500 mt-0.5">مكتملة</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-[#DC2626]">{project.stats.taskOverdue}</p>
              <p className="text-xs text-slate-500 mt-0.5">متأخرة</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-[#1A2B4A]">{project.stats.memberCount}</p>
              <p className="text-xs text-slate-500 mt-0.5">أعضاء الفريق</p>
            </div>
          </div>

          {/* Progress */}
          <div className="mt-4">
            <div className="flex justify-between text-sm mb-1.5">
              <span className="text-slate-600 font-medium">الإنجاز الإجمالي</span>
              <span className="font-bold text-[#1A2B4A]">
                {Number(project.progressPercent ?? 0).toFixed(0)}%
              </span>
            </div>
            <Progress value={Number(project.progressPercent ?? 0)} className="h-2.5" />
          </div>
        </CardContent>
      </Card>

      {/* Phases Overview */}
      {phases.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {phases.map(phase => (
            <Card key={phase.id} className="border border-slate-200">
              <CardContent className="p-4">
                <div className="flex items-start justify-between mb-2">
                  <p className="text-sm font-medium text-[#1A2B4A] line-clamp-1">{phase.name}</p>
                  <Badge className={`text-xs rounded-full flex-shrink-0 ml-1 ${
                    phase.status === "completed" ? "bg-green-100 text-green-700" :
                    phase.status === "active" ? "bg-teal-100 text-teal-700" :
                    "bg-slate-100 text-slate-600"
                  }`}>
                    {phase.status === "completed" ? "مكتمل" :
                     phase.status === "active" ? "نشط" : "معلق"}
                  </Badge>
                </div>
                <div className="flex justify-between text-xs text-slate-500 mb-1">
                  <span>{(phase as any).taskCompleted ?? 0}/{(phase as any).taskTotal ?? 0} مهمة</span>
                  <span>{Number(phase.progressPercent ?? 0).toFixed(0)}%</span>
                </div>
                <Progress value={Number(phase.progressPercent ?? 0)} className="h-1.5" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="w-full justify-start overflow-x-auto flex-nowrap h-auto p-1 gap-1 bg-slate-100 rounded-lg">
          {[
            { value: "kanban",      label: "Kanban",       icon: Columns },
            { value: "gantt",       label: "Gantt",         icon: GanttChartSquare },
            { value: "structure",   label: "الهيكل",        icon: Layers },
            { value: "whiteboard",  label: "Whiteboard",    icon: Building2 },
            { value: "mindmap",     label: "Mind Map",      icon: TrendingUp },
            { value: "members",     label: "الفريق",        icon: Users },
            { value: "daily",       label: "محضر يومي",     icon: ClipboardList },
            { value: "automations", label: "الأتمتة",       icon: CheckCircle2 },
            { value: "safety",      label: "السلامة",       icon: ShieldAlert },
            { value: "changes",     label: "أوامر تغيير",   icon: GitMerge },
            { value: "quantities",  label: "الكميات",       icon: Package },
            { value: "goals",       label: "الأهداف",       icon: Target },
            { value: "reports",     label: "التقارير",      icon: FileText },
          ].map(tab => (
            <TabsTrigger
              key={tab.value}
              value={tab.value}
              className="text-xs gap-1.5 px-3 py-1.5 data-[state=active]:bg-white data-[state=active]:text-[#1A2B4A] data-[state=active]:shadow-sm whitespace-nowrap"
            >
              <tab.icon className="w-3.5 h-3.5" />
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="kanban" className="mt-4">
          <ProjectKanban projectId={projectId} />
        </TabsContent>

        <TabsContent value="gantt" className="mt-4">
          <ProjectGantt projectId={projectId} />
        </TabsContent>

        <TabsContent value="structure" className="mt-4">
          <PhaseManager projectId={projectId} />
        </TabsContent>

        <TabsContent value="whiteboard" className="mt-4">
          <ProjectWhiteboard projectId={projectId} />
        </TabsContent>

        <TabsContent value="mindmap" className="mt-4">
          <ProjectMindMap projectId={projectId} projectName={project.name} />
        </TabsContent>

        <TabsContent value="members" className="mt-4">
          <ProjectMembers projectId={projectId} />
        </TabsContent>

        <TabsContent value="daily" className="mt-4">
          <DailyReportTab projectId={projectId} />
        </TabsContent>

        <TabsContent value="automations" className="mt-4">
          <ProjectAutomations projectId={projectId} />
        </TabsContent>

        <TabsContent value="safety" className="mt-4">
          <SafetyTab projectId={projectId} />
        </TabsContent>

        <TabsContent value="changes" className="mt-4">
          <ChangeOrdersTab projectId={projectId} />
        </TabsContent>

        <TabsContent value="quantities" className="mt-4">
          <QuantitiesTab projectId={projectId} />
        </TabsContent>

        <TabsContent value="goals" className="mt-4">
          <GoalsTab projectId={projectId} />
        </TabsContent>

        <TabsContent value="reports" className="mt-4">
          <ReportsTab projectId={projectId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ── Inline Tab Components ────────────────────────────────────

function SafetyTab({ projectId }: { projectId: number }) {
  const { data } = trpc.construction.safetyLogs.list.useQuery({ projectId, page: 1, pageSize: 20 });
  const { data: summary } = trpc.construction.reports.safetySummary.useQuery({ projectId });

  const severityColors: Record<string, string> = {
    low: "bg-green-100 text-green-700",
    medium: "bg-amber-100 text-amber-700",
    high: "bg-orange-100 text-orange-700",
    critical: "bg-red-100 text-red-700",
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "إجمالي الحوادث", value: summary?.total ?? 0, color: "text-[#1A2B4A]" },
          { label: "مفتوحة", value: summary?.open ?? 0, color: "text-[#DC2626]" },
          { label: "حرجة", value: summary?.critical ?? 0, color: "text-[#DC2626]" },
          { label: "إصابات", value: summary?.injuries ?? 0, color: "text-[#D97706]" },
        ].map(s => (
          <Card key={s.label}><CardContent className="p-4 text-center">
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-xs text-slate-500 mt-1">{s.label}</p>
          </CardContent></Card>
        ))}
      </div>
      <div className="space-y-2">
        {data?.data.map(log => (
          <Card key={log.id}><CardContent className="p-4 flex items-start justify-between gap-3">
            <div>
              <p className="font-medium text-sm text-[#1A2B4A]">{log.title}</p>
              <p className="text-xs text-slate-500 mt-0.5">{log.logDate} · {log.location}</p>
              {log.description && <p className="text-xs text-slate-400 mt-1 line-clamp-2">{log.description}</p>}
            </div>
            <div className="flex flex-col items-end gap-1 flex-shrink-0">
              <Badge className={`text-xs rounded-full ${severityColors[log.severity]}`}>
                {log.severity === "low" ? "منخفض" : log.severity === "medium" ? "متوسط" :
                 log.severity === "high" ? "عال" : "حرج"}
              </Badge>
              {log.isClosed && <Badge className="text-xs bg-green-100 text-green-700 rounded-full">مغلق</Badge>}
            </div>
          </CardContent></Card>
        ))}
        {(!data?.data || data.data.length === 0) && (
          <Card><CardContent className="py-10 text-center">
            <ShieldAlert className="w-10 h-10 text-slate-300 mx-auto mb-2" />
            <p className="text-slate-400 text-sm">لا توجد سجلات سلامة</p>
          </CardContent></Card>
        )}
      </div>
    </div>
  );
}

function ChangeOrdersTab({ projectId }: { projectId: number }) {
  const { data } = trpc.construction.changeOrders.list.useQuery({ projectId });

  const statusColors: Record<string, string> = {
    pending: "bg-amber-100 text-amber-700",
    approved: "bg-green-100 text-green-700",
    rejected: "bg-red-100 text-red-700",
  };

  return (
    <div className="space-y-3">
      {data?.map(co => (
        <Card key={co.id}><CardContent className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-mono text-slate-400">{co.changeNumber}</span>
                <Badge className={`text-xs rounded-full ${statusColors[co.status]}`}>
                  {co.status === "pending" ? "بانتظار الاعتماد" :
                   co.status === "approved" ? "معتمد" : "مرفوض"}
                </Badge>
              </div>
              <p className="font-medium text-sm text-[#1A2B4A]">{co.title}</p>
              <p className="text-xs text-slate-500 mt-1">{co.description}</p>
            </div>
            <div className="text-right flex-shrink-0">
              {co.impactDays !== 0 && (
                <p className="text-sm font-medium text-[#DC2626]">+{co.impactDays} يوم</p>
              )}
              {co.impactCost && Number(co.impactCost) !== 0 && (
                <p className="text-xs text-slate-500">{Number(co.impactCost).toLocaleString()} ﷼</p>
              )}
            </div>
          </div>
        </CardContent></Card>
      ))}
      {(!data || data.length === 0) && (
        <Card><CardContent className="py-10 text-center">
          <GitMerge className="w-10 h-10 text-slate-300 mx-auto mb-2" />
          <p className="text-slate-400 text-sm">لا توجد أوامر تغيير</p>
        </CardContent></Card>
      )}
    </div>
  );
}

function QuantitiesTab({ projectId }: { projectId: number }) {
  const { data } = trpc.construction.reports.quantitySummary.useQuery({ projectId });

  return (
    <div className="space-y-3">
      {data?.map((item, i) => (
        <Card key={i}><CardContent className="p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="font-medium text-sm text-[#1A2B4A]">{item.materialName}</p>
            <span className="text-xs text-slate-400">{item.unit}</span>
          </div>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-xs text-slate-500 mb-0.5">مخطط</p>
              <p className="font-semibold text-[#1A2B4A]">{Number(item.totalPlanned ?? 0).toFixed(2)}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500 mb-0.5">فعلي</p>
              <p className={`font-semibold ${Number(item.totalActual ?? 0) > Number(item.totalPlanned ?? 0) ? "text-red-500" : "text-[#16A34A]"}`}>
                {Number(item.totalActual ?? 0).toFixed(2)}
              </p>
            </div>
          </div>
          <Progress
            value={Math.min(100, (Number(item.totalActual ?? 0) / Math.max(1, Number(item.totalPlanned ?? 1))) * 100)}
            className="h-1.5 mt-2"
          />
        </CardContent></Card>
      ))}
      {(!data || data.length === 0) && (
        <Card><CardContent className="py-10 text-center">
          <Package className="w-10 h-10 text-slate-300 mx-auto mb-2" />
          <p className="text-slate-400 text-sm">لا توجد بيانات كميات</p>
        </CardContent></Card>
      )}
    </div>
  );
}

function GoalsTab({ projectId }: { projectId: number }) {
  const { data } = trpc.construction.goals.list.useQuery({ projectId });

  const statusColors: Record<string, string> = {
    on_track: "bg-green-100 text-green-700",
    at_risk: "bg-amber-100 text-amber-700",
    behind: "bg-red-100 text-red-700",
    completed: "bg-teal-100 text-teal-700",
  };

  return (
    <div className="space-y-3">
      {data?.map(goal => (
        <Card key={goal.id}><CardContent className="p-4">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div>
              <p className="font-medium text-sm text-[#1A2B4A]">{goal.title}</p>
              {goal.description && <p className="text-xs text-slate-400 mt-0.5">{goal.description}</p>}
            </div>
            <Badge className={`text-xs rounded-full flex-shrink-0 ${statusColors[goal.status]}`}>
              {goal.status === "on_track" ? "على المسار" :
               goal.status === "at_risk" ? "في خطر" :
               goal.status === "behind" ? "متأخر" : "مكتمل"}
            </Badge>
          </div>
          {goal.targetValue && (
            <div>
              <div className="flex justify-between text-xs text-slate-500 mb-1">
                <span>التقدم</span>
                <span>{Number(goal.currentValue ?? 0)} / {Number(goal.targetValue)} {goal.unit}</span>
              </div>
              <Progress
                value={Math.min(100, (Number(goal.currentValue ?? 0) / Number(goal.targetValue)) * 100)}
                className="h-2"
              />
            </div>
          )}
          {goal.dueDate && (
            <p className="text-xs text-slate-400 mt-2 flex items-center gap-1">
              <Clock className="w-3 h-3" /> الموعد: {goal.dueDate}
            </p>
          )}
        </CardContent></Card>
      ))}
      {(!data || data.length === 0) && (
        <Card><CardContent className="py-10 text-center">
          <Target className="w-10 h-10 text-slate-300 mx-auto mb-2" />
          <p className="text-slate-400 text-sm">لا توجد أهداف محددة</p>
        </CardContent></Card>
      )}
    </div>
  );
}

function ReportsTab({ projectId }: { projectId: number }) {
  const { data: delays } = trpc.construction.reports.delayAnalysis.useQuery({ projectId });
  const { data: budget } = trpc.construction.reports.budgetSummary.useQuery({ projectId });

  return (
    <div className="space-y-4">
      {/* Delay Analysis */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-[#1A2B4A]">تحليل أسباب التأخير</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {delays && Object.entries({
            weather: "طقس",
            pending_approval: "انتظار اعتماد",
            subcontractor: "مقاول فرعي",
            administrative: "إداري",
            other: "أخرى",
          }).map(([key, label]) => {
            const val = (delays as any)[key] ?? 0;
            return (
              <div key={key} className="flex items-center gap-3">
                <span className="text-xs text-slate-600 w-28 text-right flex-shrink-0">{label}</span>
                <div className="flex-1 bg-slate-100 rounded-full h-2">
                  <div className="bg-[#E07B39] h-2 rounded-full" style={{ width: `${Math.min(100, val * 10)}%` }} />
                </div>
                <span className="text-xs font-semibold text-[#1A2B4A] w-8 text-center">{val}</span>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Budget */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-[#1A2B4A]">ملخص الميزانية</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-slate-500">مخطط</p>
            <p className="text-lg font-bold text-[#1A2B4A]">
              {Number(budget?.project?.budgetPlanned ?? 0).toLocaleString()} ﷼
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500">فعلي</p>
            <p className={`text-lg font-bold ${
              Number(budget?.project?.budgetActual ?? 0) > Number(budget?.project?.budgetPlanned ?? 0)
                ? "text-red-500" : "text-[#16A34A]"
            }`}>
              {Number(budget?.project?.budgetActual ?? 0).toLocaleString()} ﷼
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
