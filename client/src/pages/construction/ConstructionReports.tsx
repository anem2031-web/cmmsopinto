import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { BarChart3, TrendingUp, Users, Package, AlertTriangle, DollarSign } from "lucide-react";

export default function ConstructionReports() {
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");

  const { data: projectsData } = trpc.construction.projects.list.useQuery({
    isArchived: false, pageSize: 100,
  });
  const projects = projectsData?.data ?? [];
  const projectId = selectedProjectId ? Number(selectedProjectId) : null;

  const { data: delays, isLoading: delaysLoading } = trpc.construction.reports.delayAnalysis.useQuery(
    { projectId: projectId! }, { enabled: !!projectId }
  );
  const { data: team, isLoading: teamLoading } = trpc.construction.reports.teamPerformance.useQuery(
    { projectId: projectId! }, { enabled: !!projectId }
  );
  const { data: budget } = trpc.construction.reports.budgetSummary.useQuery(
    { projectId: projectId! }, { enabled: !!projectId }
  );
  const { data: quantities } = trpc.construction.reports.quantitySummary.useQuery(
    { projectId: projectId! }, { enabled: !!projectId }
  );
  const { data: safety } = trpc.construction.reports.safetySummary.useQuery(
    { projectId: projectId! }, { enabled: !!projectId }
  );

  const delayReasons = [
    { key: "weather",          label: "🌧 طقس",               color: "#3B82F6" },
    { key: "pending_approval", label: "✋ انتظار اعتماد",      color: "#D97706" },
    { key: "subcontractor",    label: "🔨 مقاول فرعي",        color: "#7C3AED" },
    { key: "administrative",   label: "📋 إداري",              color: "#6B7280" },
    { key: "other",            label: "⏸ أخرى",               color: "#94A3B8" },
  ];

  const maxDelay = delays
    ? Math.max(1, ...delayReasons.map(r => Number((delays as any)[r.key] ?? 0)))
    : 1;

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-[#1A2B4A] flex items-center gap-2">
          <BarChart3 className="w-7 h-7 text-[#E07B39]" />
          تقارير وحدة الإنشاءات
        </h1>
      </div>

      {/* Project Selector */}
      <Card>
        <CardContent className="p-4">
          <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
            <SelectTrigger className="w-full max-w-sm">
              <SelectValue placeholder="اختر مشروعاً لعرض تقاريره..." />
            </SelectTrigger>
            <SelectContent>
              {projects.map(p => (
                <SelectItem key={p.id} value={String(p.id)}>
                  {p.projectNumber} — {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {!projectId ? (
        <Card><CardContent className="py-16 text-center">
          <BarChart3 className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500">اختر مشروعاً لعرض تقاريره</p>
        </CardContent></Card>
      ) : (
        <div className="space-y-5">
          {/* Budget */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-[#1A2B4A] flex items-center gap-2">
                <DollarSign className="w-4 h-4 text-[#E07B39]" /> ملخص الميزانية
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                  { label: "الميزانية المخططة", value: Number(budget?.project?.budgetPlanned ?? 0), color: "text-[#1A2B4A]" },
                  { label: "الميزانية الفعلية", value: Number(budget?.project?.budgetActual ?? 0), color: Number(budget?.project?.budgetActual ?? 0) > Number(budget?.project?.budgetPlanned ?? 0) ? "text-red-500" : "text-[#16A34A]" },
                  { label: "تكلفة المهام المقدرة", value: Number(budget?.taskBudget?.estimatedTotal ?? 0), color: "text-[#0D9488]" },
                  { label: "تكلفة المهام الفعلية", value: Number(budget?.taskBudget?.actualTotal ?? 0), color: "text-[#E07B39]" },
                ].map(item => (
                  <div key={item.label} className="text-center p-3 bg-slate-50 rounded-lg">
                    <p className={`text-xl font-bold ${item.color}`}>
                      {item.value.toLocaleString()} ﷼
                    </p>
                    <p className="text-xs text-slate-500 mt-1">{item.label}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Delay Analysis */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-[#1A2B4A] flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-[#E07B39]" /> تحليل أسباب التأخير
              </CardTitle>
            </CardHeader>
            <CardContent>
              {delaysLoading ? <Skeleton className="h-40 w-full" /> : (
                <div className="space-y-3">
                  <div className="grid grid-cols-1 gap-1">
                    {delayReasons.map(r => {
                      const val = Number((delays as any)?.[r.key] ?? 0);
                      const pct = Math.round((val / maxDelay) * 100);
                      return (
                        <div key={r.key} className="flex items-center gap-3">
                          <span className="text-sm w-36 text-right flex-shrink-0">{r.label}</span>
                          <div className="flex-1 bg-slate-100 rounded-full h-6 overflow-hidden">
                            <div className="h-full rounded-full flex items-center justify-end pr-2 transition-all"
                              style={{ width: `${Math.max(pct, 4)}%`, backgroundColor: r.color }}>
                              {val > 0 && <span className="text-white text-xs font-bold">{val}</span>}
                            </div>
                          </div>
                          <span className="text-xs text-slate-500 w-8 text-center">{val} حالة</span>
                        </div>
                      );
                    })}
                  </div>
                  {delays && (delays as any).overdue > 0 && (
                    <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg">
                      <p className="text-sm font-medium text-red-700">
                        ⚠ {(delays as any).overdue} مهمة متأخرة عن موعدها المخطط
                      </p>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Team Performance */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-[#1A2B4A] flex items-center gap-2">
                <Users className="w-4 h-4 text-[#E07B39]" /> أداء الفريق
              </CardTitle>
            </CardHeader>
            <CardContent>
              {teamLoading ? <Skeleton className="h-40 w-full" /> :
               !team || team.length === 0 ? (
                <p className="text-slate-400 text-sm text-center py-6">لا توجد بيانات أداء</p>
              ) : (
                <div className="space-y-2">
                  {team.filter(t => t.assignedToId).map((t, i) => {
                    const total = Number(t.total ?? 0);
                    const completed = Number(t.completed ?? 0);
                    const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
                    return (
                      <div key={i} className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
                        <div className="w-8 h-8 bg-[#1A2B4A] rounded-full flex items-center justify-center flex-shrink-0">
                          <span className="text-white text-xs font-bold">{i + 1}</span>
                        </div>
                        <div className="flex-1">
                          <div className="flex justify-between text-xs mb-1">
                            <span className="font-medium text-[#1A2B4A]">مستخدم #{t.assignedToId}</span>
                            <span className="text-slate-500">{completed}/{total} مهمة</span>
                          </div>
                          <div className="bg-slate-200 rounded-full h-2">
                            <div className="bg-[#0D9488] h-2 rounded-full" style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                        <span className="text-sm font-bold text-[#1A2B4A] w-10 text-center">{pct}%</span>
                        {Number(t.overdue ?? 0) > 0 && (
                          <span className="text-xs text-red-500">⚠{t.overdue}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Quantities */}
          {quantities && quantities.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-[#1A2B4A] flex items-center gap-2">
                  <Package className="w-4 h-4 text-[#E07B39]" /> تقرير الكميات والمواد
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-xs text-slate-500">
                        <th className="text-right pb-2">المادة</th>
                        <th className="text-center pb-2">الوحدة</th>
                        <th className="text-center pb-2">مخطط</th>
                        <th className="text-center pb-2">فعلي</th>
                        <th className="text-center pb-2">الفرق</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {quantities.map((q, i) => {
                        const planned = Number(q.totalPlanned ?? 0);
                        const actual = Number(q.totalActual ?? 0);
                        const diff = actual - planned;
                        return (
                          <tr key={i} className="hover:bg-slate-50">
                            <td className="py-2 font-medium text-[#1A2B4A]">{q.materialName}</td>
                            <td className="py-2 text-center text-slate-500">{q.unit}</td>
                            <td className="py-2 text-center">{planned.toFixed(2)}</td>
                            <td className="py-2 text-center">{actual.toFixed(2)}</td>
                            <td className={`py-2 text-center font-medium ${diff > 0 ? "text-red-500" : diff < 0 ? "text-green-600" : "text-slate-400"}`}>
                              {diff > 0 ? "+" : ""}{diff.toFixed(2)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Safety */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-[#1A2B4A] flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-[#E07B39]" /> ملخص السلامة
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { label: "إجمالي الحوادث", value: safety?.total ?? 0, color: "text-[#1A2B4A]" },
                  { label: "حوادث مفتوحة", value: safety?.open ?? 0, color: "text-[#DC2626]" },
                  { label: "حالات حرجة", value: safety?.critical ?? 0, color: "text-[#DC2626]" },
                  { label: "إصابات", value: safety?.injuries ?? 0, color: "text-[#D97706]" },
                ].map(s => (
                  <div key={s.label} className="text-center p-3 bg-slate-50 rounded-lg">
                    <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                    <p className="text-xs text-slate-500 mt-1">{s.label}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
