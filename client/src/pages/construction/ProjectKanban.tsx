import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Clock, AlertTriangle, User, Paperclip, MessageSquare } from "lucide-react";
import { toast } from "sonner";
import ConstructionDetailModal from "@/components/construction/ConstructionDetailModal";
import HoldReasonModal from "@/components/construction/HoldReasonModal";
import TaskForm from "@/components/construction/TaskForm";

const COLUMNS = [
  { key: "new",               label: "جديدة",              color: "bg-slate-500",  light: "bg-slate-50  border-slate-200" },
  { key: "in_progress",       label: "جاري التنفيذ",       color: "bg-teal-500",   light: "bg-teal-50   border-teal-200" },
  { key: "pending_approval",  label: "بانتظار اعتماد",    color: "bg-amber-500",  light: "bg-amber-50  border-amber-200" },
  { key: "pending_materials", label: "بانتظار مواد",       color: "bg-orange-500", light: "bg-orange-50 border-orange-200" },
  { key: "on_hold",           label: "موقوفة",             color: "bg-red-500",    light: "bg-red-50    border-red-200" },
  { key: "completed",         label: "مكتملة",             color: "bg-green-500",  light: "bg-green-50  border-green-200" },
] as const;

const PRIORITY_BORDER: Record<string, string> = {
  low: "border-l-slate-400", medium: "border-l-blue-400",
  high: "border-l-orange-400", critical: "border-l-red-500",
};

const PRIORITY_LABEL: Record<string, string> = {
  low: "منخفض", medium: "متوسط", high: "عالي", critical: "حرج",
};

type Status = typeof COLUMNS[number]["key"];

export default function ProjectKanban({ projectId }: { projectId: number }) {
  const [swimlane, setSwimlane] = useState<"none" | "phase">("none");
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);
  const [holdTarget, setHoldTarget] = useState<{ taskId: number } | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const [showTaskForm, setShowTaskForm] = useState(false);

  const utils = trpc.useUtils();

  const { data: kanbanData, isLoading } = trpc.construction.tasks.kanban.useQuery({ projectId });

  const changeStatus = trpc.construction.tasks.changeStatus.useMutation({
    onSuccess: () => {
      utils.construction.tasks.kanban.invalidate({ projectId });
      utils.construction.projects.getById.invalidate({ id: projectId });
      toast.success("تم تحديث حالة المهمة");
    },
    onError: (err) => toast.error(err.message),
  });

  const handleDrop = (e: React.DragEvent, targetStatus: Status) => {
    e.preventDefault();
    if (!dragging) return;
    if (targetStatus === "on_hold") {
      setHoldTarget({ taskId: dragging });
      setDragging(null);
      return;
    }
    changeStatus.mutate({ id: dragging, status: targetStatus });
    setDragging(null);
  };

  const handleStatusChange = (taskId: number, newStatus: Status) => {
    if (newStatus === "on_hold") {
      setHoldTarget({ taskId });
      return;
    }
    changeStatus.mutate({ id: taskId, status: newStatus });
  };

  const confirmHold = (reason: string, note: string) => {
    if (!holdTarget) return;
    changeStatus.mutate({
      id: holdTarget.taskId,
      status: "on_hold",
      holdReason: reason as any,
      holdNote: note,
    });
    setHoldTarget(null);
  };

  if (isLoading) {
    return (
      <div className="flex gap-3 overflow-x-auto pb-2">
        {COLUMNS.map(col => (
          <div key={col.key} className="min-w-56 flex-shrink-0">
            <Skeleton className="h-8 w-full mb-3" />
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-28 w-full mb-2" />)}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Controls */}
      <div className="flex items-center gap-3 flex-wrap">
        <Select value={swimlane} onValueChange={(v: any) => setSwimlane(v)}>
          <SelectTrigger className="w-44 text-sm">
            <SelectValue placeholder="تجميع حسب" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">بدون تجميع</SelectItem>
            <SelectItem value="phase">حسب المرحلة</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" className="gap-1.5 text-sm"
          onClick={() => setShowTaskForm(true)}>
          <Plus className="w-3.5 h-3.5" /> مهمة جديدة
        </Button>
      </div>

      {/* Kanban Board */}
      <div className="flex gap-3 overflow-x-auto pb-4 min-h-96">
        {COLUMNS.map(col => {
          const tasks = (kanbanData as any)?.[col.key] ?? [];
          return (
            <div
              key={col.key}
              className="min-w-[220px] flex-shrink-0 flex flex-col"
              onDragOver={e => e.preventDefault()}
              onDrop={e => handleDrop(e, col.key)}
            >
              {/* Column Header */}
              <div className={`flex items-center justify-between px-3 py-2 rounded-t-lg ${col.color} text-white mb-0`}>
                <span className="text-xs font-semibold">{col.label}</span>
                <span className="text-xs bg-white/20 rounded-full px-1.5">{tasks.length}</span>
              </div>

              {/* Column Body */}
              <div className={`flex-1 rounded-b-lg border-2 p-2 space-y-2 min-h-48 ${col.light}`}>
                {tasks.map((task: any) => {
                  const isOverdue = task.endDatePlanned && new Date(task.endDatePlanned) < new Date()
                    && task.status !== "completed";
                  return (
                    <div
                      key={task.id}
                      draggable
                      onDragStart={() => setDragging(task.id)}
                      onDragEnd={() => setDragging(null)}
                      onClick={() => setSelectedTaskId(task.id)}
                      className={`bg-white rounded-lg border-l-4 ${PRIORITY_BORDER[task.priority]} shadow-sm p-3 cursor-pointer hover:shadow-md transition-shadow ${dragging === task.id ? "opacity-50" : ""}`}
                    >
                      {/* Priority badge */}
                      <div className="flex items-center justify-between mb-1.5">
                        <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${
                          task.priority === "critical" ? "bg-red-100 text-red-700" :
                          task.priority === "high" ? "bg-orange-100 text-orange-700" :
                          task.priority === "medium" ? "bg-blue-100 text-blue-700" :
                          "bg-slate-100 text-slate-600"
                        }`}>
                          {PRIORITY_LABEL[task.priority]}
                        </span>
                        <span className="text-xs text-slate-400 font-mono">{task.taskNumber}</span>
                      </div>

                      {/* Title */}
                      <p className="text-sm font-medium text-[#1A2B4A] leading-snug line-clamp-2 mb-2">
                        {task.title}
                      </p>

                      {/* Progress */}
                      {Number(task.progressPercent) > 0 && (
                        <div className="mb-2">
                          <div className="bg-slate-100 rounded-full h-1.5">
                            <div className="bg-teal-500 h-1.5 rounded-full"
                              style={{ width: `${task.progressPercent}%` }} />
                          </div>
                        </div>
                      )}

                      {/* Footer */}
                      <div className="flex items-center justify-between text-xs text-slate-400">
                        <div className="flex items-center gap-2">
                          {task.assignedToId && <User className="w-3 h-3" />}
                          {task.holdReason && (
                            <span className="text-red-500 text-xs">
                              {task.holdReason === "weather" ? "🌧" :
                               task.holdReason === "pending_approval" ? "✋" :
                               task.holdReason === "subcontractor" ? "🔨" : "⏸"}
                            </span>
                          )}
                        </div>
                        {task.endDatePlanned && (
                          <span className={`flex items-center gap-0.5 ${isOverdue ? "text-red-500 font-medium" : ""}`}>
                            {isOverdue && <AlertTriangle className="w-3 h-3" />}
                            <Clock className="w-3 h-3" />
                            {task.endDatePlanned}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}

                {/* Add task button */}
                <button
                  onClick={() => setShowTaskForm(true)}
                  className="w-full text-xs text-slate-400 hover:text-slate-600 py-2 rounded border border-dashed border-slate-300 hover:border-slate-400 transition-colors"
                >
                  + إضافة مهمة
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Task Detail Modal */}
      {selectedTaskId !== null && selectedTaskId !== -1 && (
        <ConstructionDetailModal
          open={true}
          type="task"
          id={selectedTaskId}
          projectId={projectId}
          breadcrumb={[{ label: "المشروع", type: "project" }]}
          onClose={() => setSelectedTaskId(null)}
          onUpdated={() => {
            utils.construction.tasks.kanban.invalidate({ projectId });
          }}
        />
      )}

      {/* New Task Form */}
      {showTaskForm && (
        <TaskForm
          projectId={projectId}
          onClose={() => setShowTaskForm(false)}
        />
      )}

      {/* Hold Reason Modal */}
      {holdTarget && (
        <HoldReasonModal
          onConfirm={confirmHold}
          onCancel={() => setHoldTarget(null)}
        />
      )}
    </div>
  );
}
