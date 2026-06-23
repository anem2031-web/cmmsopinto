// ProjectGantt.tsx
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { GanttChartSquare, AlertTriangle } from "lucide-react";

export default function ProjectGantt({ projectId }: { projectId: number }) {
  const { data: tasks, isLoading } = trpc.construction.tasks.gantt.useQuery({ projectId });

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  if (!tasks || tasks.length === 0) {
    return (
      <Card><CardContent className="py-12 text-center">
        <GanttChartSquare className="w-10 h-10 text-slate-300 mx-auto mb-2" />
        <p className="text-slate-400 text-sm">لا توجد مهام لعرضها في Gantt</p>
        <p className="text-xs text-slate-300 mt-1">أضف مهاماً مع تواريخ لعرضها هنا</p>
      </CardContent></Card>
    );
  }

  // Find date range
  const dates = tasks.flatMap(t => [t.startDatePlanned, t.endDatePlanned].filter(Boolean)) as string[];
  const minDate = dates.reduce((a, b) => a < b ? a : b);
  const maxDate = dates.reduce((a, b) => a > b ? a : b);
  const start = new Date(minDate);
  const end = new Date(maxDate);
  const totalDays = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 86400000)) + 7;

  const getPos = (date: string) => {
    const d = new Date(date);
    return Math.max(0, Math.ceil((d.getTime() - start.getTime()) / 86400000));
  };

  const today = new Date();
  const todayPos = Math.max(0, Math.ceil((today.getTime() - start.getTime()) / 86400000));
  const DAY_W = 28;

  return (
    <div className="space-y-3">
      <div className="text-xs text-slate-500 flex items-center gap-3 flex-wrap">
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 bg-teal-500 rounded-sm inline-block"/> مخطط</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 bg-green-500 rounded-sm inline-block"/> مكتمل</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 bg-red-500 rounded-sm inline-block"/> مسار حرج</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 bg-orange-400 rounded-sm inline-block"/> متأخر</span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <div style={{ minWidth: `${280 + totalDays * DAY_W}px` }}>
          {/* Header */}
          <div className="flex border-b border-slate-200 bg-slate-50 sticky top-0 z-10">
            <div className="w-64 flex-shrink-0 px-3 py-2 text-xs font-semibold text-slate-600 border-r border-slate-200">
              المهمة
            </div>
            <div className="flex-1 relative" style={{ height: "32px" }}>
              {/* Month labels */}
              {Array.from({ length: Math.ceil(totalDays / 7) }).map((_, i) => {
                const d = new Date(start);
                d.setDate(d.getDate() + i * 7);
                return (
                  <span key={i} className="absolute text-xs text-slate-400"
                    style={{ left: i * 7 * DAY_W + 2, top: 8 }}>
                    {d.toLocaleDateString("ar", { month: "short", day: "numeric" })}
                  </span>
                );
              })}
            </div>
          </div>

          {/* Tasks */}
          {tasks.map(task => {
            const isOverdue = task.endDatePlanned && new Date(task.endDatePlanned) < today && task.status !== "completed";
            const left = task.startDatePlanned ? getPos(task.startDatePlanned) * DAY_W : 0;
            const width = task.startDatePlanned && task.endDatePlanned
              ? Math.max(DAY_W, (getPos(task.endDatePlanned) - getPos(task.startDatePlanned) + 1) * DAY_W)
              : DAY_W * 3;

            const barColor = task.status === "completed" ? "#16A34A"
              : task.isCriticalPath ? "#DC2626"
              : isOverdue ? "#F97316"
              : "#0D9488";

            return (
              <div key={task.id} className="flex border-b border-slate-100 hover:bg-slate-50 items-center" style={{ height: "40px" }}>
                <div className="w-64 flex-shrink-0 px-3 flex items-center gap-2 border-r border-slate-200">
                  <span className="text-xs text-[#1A2B4A] truncate">{task.title}</span>
                  {isOverdue && <AlertTriangle className="w-3 h-3 text-orange-500 flex-shrink-0" />}
                  {task.isCriticalPath && <span className="text-red-500 text-xs flex-shrink-0">●</span>}
                </div>
                <div className="flex-1 relative" style={{ height: "40px" }}>
                  {/* Today line */}
                  <div className="absolute top-0 bottom-0 border-r-2 border-red-400 border-dashed z-10"
                    style={{ left: todayPos * DAY_W }} />
                  {/* Bar */}
                  {task.startDatePlanned && (
                    <div
                      className="absolute top-1/2 -translate-y-1/2 rounded h-5 flex items-center px-2"
                      style={{ left, width, backgroundColor: barColor, opacity: 0.85 }}
                      title={`${task.startDatePlanned} → ${task.endDatePlanned}`}
                    >
                      <span className="text-white text-xs truncate font-medium">
                        {Number(task.progressPercent ?? 0).toFixed(0)}%
                      </span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
