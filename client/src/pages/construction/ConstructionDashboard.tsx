import { trpc } from "@/lib/trpc";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import {
  Building2, FolderKanban, Plus, TrendingUp, AlertTriangle,
  CheckCircle2, Clock, Users, BarChart3, ArrowLeft
} from "lucide-react";

const statusColors: Record<string, string> = {
  planning: "bg-slate-100 text-slate-700",
  active:   "bg-teal-100 text-teal-700",
  on_hold:  "bg-amber-100 text-amber-700",
  completed:"bg-green-100 text-green-700",
  cancelled:"bg-red-100 text-red-700",
};

const statusLabels: Record<string, string> = {
  planning:  "تخطيط",
  active:    "نشط",
  on_hold:   "موقوف",
  completed: "مكتمل",
  cancelled: "ملغي",
};

const priorityColors: Record<string, string> = {
  low:      "border-l-slate-400",
  medium:   "border-l-blue-400",
  high:     "border-l-orange-400",
  critical: "border-l-red-500",
};

export default function ConstructionDashboard() {
  const [, navigate] = useLocation();

  const { data: stats, isLoading: statsLoading } = trpc.construction.projects.portfolioStats.useQuery();
  const { data: projectsData, isLoading: projectsLoading } = trpc.construction.projects.list.useQuery({
    isArchived: false,
    pageSize: 6,
  });

  const projects = projectsData?.data ?? [];
  const isLoading = statsLoading || projectsLoading;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#1A2B4A] flex items-center gap-2">
            <Building2 className="w-7 h-7 text-[#E07B39]" />
            وحدة الإنشاءات
          </h1>
          <p className="text-sm text-slate-500 mt-1">نظرة شاملة على جميع المشاريع</p>
        </div>
        <Button
          onClick={() => navigate("/construction/projects/new")}
          className="bg-[#E07B39] hover:bg-[#c96b2e] text-white gap-2"
        >
          <Plus className="w-4 h-4" />
          مشروع جديد
        </Button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {statsLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}><CardContent className="p-5"><Skeleton className="h-16 w-full" /></CardContent></Card>
          ))
        ) : (
          <>
            <Card className="border-t-4 border-t-[#0D9488]">
              <CardContent className="p-5">
                <p className="text-xs text-slate-500 mb-1">المشاريع النشطة</p>
                <p className="text-3xl font-bold text-[#0D9488]">{stats?.active ?? 0}</p>
                <p className="text-xs text-slate-400 mt-1">من أصل {stats?.total ?? 0} مشروع</p>
              </CardContent>
            </Card>
            <Card className="border-t-4 border-t-[#E07B39]">
              <CardContent className="p-5">
                <p className="text-xs text-slate-500 mb-1">في التخطيط</p>
                <p className="text-3xl font-bold text-[#E07B39]">{stats?.planning ?? 0}</p>
                <p className="text-xs text-slate-400 mt-1">مشروع قيد التحضير</p>
              </CardContent>
            </Card>
            <Card className="border-t-4 border-t-[#16A34A]">
              <CardContent className="p-5">
                <p className="text-xs text-slate-500 mb-1">مكتملة</p>
                <p className="text-3xl font-bold text-[#16A34A]">{stats?.completed ?? 0}</p>
                <p className="text-xs text-slate-400 mt-1">مشروع منجز</p>
              </CardContent>
            </Card>
            <Card className="border-t-4 border-t-[#1A2B4A]">
              <CardContent className="p-5">
                <p className="text-xs text-slate-500 mb-1">متوسط الإنجاز</p>
                <p className="text-3xl font-bold text-[#1A2B4A]">{stats?.avgProgress ?? 0}%</p>
                <Progress value={stats?.avgProgress ?? 0} className="h-1.5 mt-2" />
              </CardContent>
            </Card>
          </>
        )}
      </div>

      {/* Projects Grid */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-[#1A2B4A]">المشاريع الحالية</h2>
          <Button variant="ghost" size="sm" onClick={() => navigate("/construction/projects")}
            className="text-[#0D9488] gap-1 text-sm">
            عرض الكل <ArrowLeft className="w-4 h-4" />
          </Button>
        </div>

        {projectsLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Card key={i}><CardContent className="p-5"><Skeleton className="h-40 w-full" /></CardContent></Card>
            ))}
          </div>
        ) : projects.length === 0 ? (
          <Card>
            <CardContent className="p-12 text-center">
              <Building2 className="w-12 h-12 text-slate-300 mx-auto mb-3" />
              <p className="text-slate-500 font-medium">لا توجد مشاريع بعد</p>
              <p className="text-sm text-slate-400 mt-1">ابدأ بإنشاء مشروعك الأول</p>
              <Button onClick={() => navigate("/construction/projects/new")}
                className="mt-4 bg-[#E07B39] hover:bg-[#c96b2e] text-white gap-2">
                <Plus className="w-4 h-4" /> إنشاء مشروع
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {projects.map(project => (
              <Card
                key={project.id}
                className={`border-l-4 ${priorityColors[project.priority]} cursor-pointer hover:shadow-md transition-shadow`}
                onClick={() => navigate(`/construction/projects/${project.id}`)}
              >
                <CardContent className="p-5">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-slate-400 font-mono mb-1">{project.projectNumber}</p>
                      <h3 className="font-semibold text-[#1A2B4A] text-sm leading-tight truncate">
                        {project.name}
                      </h3>
                    </div>
                    <Badge className={`text-xs px-2 py-0.5 rounded-full ml-2 flex-shrink-0 ${statusColors[project.status]}`}>
                      {statusLabels[project.status]}
                    </Badge>
                  </div>

                  {/* Progress */}
                  <div className="mb-3">
                    <div className="flex justify-between text-xs text-slate-500 mb-1">
                      <span>نسبة الإنجاز</span>
                      <span className="font-semibold">{Number(project.progressPercent ?? 0).toFixed(0)}%</span>
                    </div>
                    <Progress value={Number(project.progressPercent ?? 0)} className="h-2" />
                  </div>

                  {/* Dates */}
                  {(project.startDatePlanned || project.endDatePlanned) && (
                    <div className="flex items-center gap-1 text-xs text-slate-400 mb-3">
                      <Clock className="w-3 h-3" />
                      <span>
                        {project.startDatePlanned ?? "—"} ← {project.endDatePlanned ?? "—"}
                      </span>
                    </div>
                  )}

                  {/* Footer */}
                  <div className="flex justify-between items-center pt-2 border-t border-slate-100">
                    <div className="flex items-center gap-1 text-xs text-slate-400">
                      <FolderKanban className="w-3 h-3" />
                      <span>عرض المشروع</span>
                    </div>
                    <div className="flex items-center gap-1 text-xs text-slate-400">
                      {project.managerId && (
                        <><Users className="w-3 h-3" /><span>مدير معين</span></>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="cursor-pointer hover:shadow-md transition-shadow"
          onClick={() => navigate("/construction/projects")}>
          <CardContent className="p-5 flex items-center gap-4">
            <div className="w-12 h-12 bg-[#1A2B4A] rounded-xl flex items-center justify-center flex-shrink-0">
              <FolderKanban className="w-6 h-6 text-white" />
            </div>
            <div>
              <p className="font-semibold text-[#1A2B4A]">جميع المشاريع</p>
              <p className="text-xs text-slate-500">عرض وإدارة كل المشاريع</p>
            </div>
          </CardContent>
        </Card>
        <Card className="cursor-pointer hover:shadow-md transition-shadow"
          onClick={() => navigate("/construction/reports")}>
          <CardContent className="p-5 flex items-center gap-4">
            <div className="w-12 h-12 bg-[#0D9488] rounded-xl flex items-center justify-center flex-shrink-0">
              <BarChart3 className="w-6 h-6 text-white" />
            </div>
            <div>
              <p className="font-semibold text-[#1A2B4A]">التقارير</p>
              <p className="text-xs text-slate-500">تحليلات وتقارير المشاريع</p>
            </div>
          </CardContent>
        </Card>
        <Card className="cursor-pointer hover:shadow-md transition-shadow"
          onClick={() => navigate("/construction/projects/new")}>
          <CardContent className="p-5 flex items-center gap-4">
            <div className="w-12 h-12 bg-[#E07B39] rounded-xl flex items-center justify-center flex-shrink-0">
              <Plus className="w-6 h-6 text-white" />
            </div>
            <div>
              <p className="font-semibold text-[#1A2B4A]">مشروع جديد</p>
              <p className="text-xs text-slate-500">إنشاء مشروع إنشائي جديد</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
