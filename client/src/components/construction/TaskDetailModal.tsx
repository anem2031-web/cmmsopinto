import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Clock, MessageSquare, Paperclip, Play, Square, Send, User, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

const STATUS_OPTIONS = [
  { value: "new",               label: "جديدة",            color: "bg-slate-500" },
  { value: "in_progress",       label: "جاري التنفيذ",    color: "bg-teal-500" },
  { value: "pending_approval",  label: "بانتظار اعتماد",  color: "bg-amber-500" },
  { value: "pending_materials", label: "بانتظار مواد",     color: "bg-orange-500" },
  { value: "on_hold",           label: "موقوفة",           color: "bg-red-500" },
  { value: "completed",         label: "مكتملة",           color: "bg-green-500" },
];

const PRIORITY_COLORS: Record<string, string> = {
  low: "bg-slate-100 text-slate-700",
  medium: "bg-blue-100 text-blue-700",
  high: "bg-orange-100 text-orange-700",
  critical: "bg-red-100 text-red-700",
};

interface Props {
  taskId: number | null;
  projectId: number;
  onClose: () => void;
  onStatusChange?: (taskId: number, status: string) => void;
}

export default function TaskDetailModal({ taskId, projectId, onClose, onStatusChange }: Props) {
  const [comment, setComment] = useState("");
  const [timerRunning, setTimerRunning] = useState(false);
  const [timerStart, setTimerStart] = useState<Date | null>(null);
  const utils = trpc.useUtils();

  const { data: task, isLoading } = trpc.construction.tasks.getById.useQuery(
    { id: taskId! },
    { enabled: !!taskId }
  );

  const addComment = trpc.construction.taskComments.create.useMutation({
    onSuccess: () => {
      utils.construction.tasks.getById.invalidate({ id: taskId! });
      setComment("");
      toast.success("تم إضافة التعليق");
    },
  });

  const logTime = trpc.construction.timeLogs.create.useMutation({
    onSuccess: () => {
      utils.construction.tasks.getById.invalidate({ id: taskId! });
      toast.success("تم تسجيل الوقت");
    },
  });

  const handleTimerToggle = () => {
    if (!timerRunning) {
      setTimerStart(new Date());
      setTimerRunning(true);
    } else {
      const end = new Date();
      const mins = Math.round((end.getTime() - timerStart!.getTime()) / 60000);
      if (mins > 0) {
        logTime.mutate({
          taskId: taskId!,
          projectId,
          durationMinutes: mins,
          logType: "auto",
          startTime: timerStart!.toISOString(),
          endTime: end.toISOString(),
        });
      }
      setTimerRunning(false);
      setTimerStart(null);
    }
  };

  const handleSendComment = () => {
    if (!comment.trim() || !taskId) return;
    addComment.mutate({ taskId, projectId, comment: comment.trim() });
  };

  if (!taskId) return null;

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" dir="rtl">
        {isLoading ? (
          <div className="space-y-3 p-2">
            <Skeleton className="h-6 w-3/4" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : !task ? (
          <div className="text-center py-8 text-slate-500">المهمة غير موجودة</div>
        ) : (
          <>
            <DialogHeader>
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-slate-400 font-mono mb-1">{task.taskNumber}</p>
                  <DialogTitle className="text-[#1A2B4A] leading-snug text-right">
                    {task.title}
                  </DialogTitle>
                </div>
                {/* Status selector */}
                <Select
                  value={task.status}
                  onValueChange={(val) => onStatusChange?.(task.id, val)}
                >
                  <SelectTrigger className="w-40 flex-shrink-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map(s => (
                      <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </DialogHeader>

            {/* Meta row */}
            <div className="flex flex-wrap gap-2 items-center">
              <Badge className={`text-xs rounded-full ${PRIORITY_COLORS[task.priority]}`}>
                {task.priority === "critical" ? "حرج" : task.priority === "high" ? "عالي" :
                 task.priority === "medium" ? "متوسط" : "منخفض"}
              </Badge>
              {task.endDatePlanned && (
                <span className={`text-xs flex items-center gap-1 ${
                  new Date(task.endDatePlanned) < new Date() && task.status !== "completed"
                    ? "text-red-500 font-medium" : "text-slate-500"
                }`}>
                  <Clock className="w-3 h-3" />
                  {task.endDatePlanned}
                  {new Date(task.endDatePlanned) < new Date() && task.status !== "completed" && (
                    <AlertTriangle className="w-3 h-3" />
                  )}
                </span>
              )}
              {task.isCriticalPath && (
                <Badge className="text-xs bg-red-100 text-red-700 rounded-full">مسار حرج</Badge>
              )}
            </div>

            {/* Hold reason */}
            {task.status === "on_hold" && task.holdReason && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                <p className="text-xs font-medium text-red-700 mb-1">سبب التوقف</p>
                <p className="text-sm text-red-800">
                  {task.holdReason === "weather" ? "طقس" :
                   task.holdReason === "pending_approval" ? "انتظار اعتماد" :
                   task.holdReason === "subcontractor" ? "مقاول فرعي" :
                   task.holdReason === "administrative" ? "إداري" : "أخرى"}
                  {task.holdNote ? ` — ${task.holdNote}` : ""}
                </p>
              </div>
            )}

            {/* Progress */}
            <div>
              <div className="flex justify-between text-xs text-slate-500 mb-1">
                <span>نسبة الإنجاز</span>
                <span className="font-semibold">{Number(task.progressPercent ?? 0).toFixed(0)}%</span>
              </div>
              <Progress value={Number(task.progressPercent ?? 0)} className="h-2" />
            </div>

            {/* Description */}
            {task.description && (
              <div className="bg-slate-50 rounded-lg p-3">
                <p className="text-sm text-slate-700 leading-relaxed">{task.description}</p>
              </div>
            )}

            {/* Timer */}
            <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
              <div>
                <p className="text-xs text-slate-500 mb-0.5">تتبع الوقت</p>
                <p className="text-sm font-medium text-[#1A2B4A]">
                  {Math.round((task.totalLoggedMinutes ?? 0) / 60)} ساعة{" "}
                  {(task.totalLoggedMinutes ?? 0) % 60} دقيقة
                </p>
              </div>
              <Button
                size="sm"
                onClick={handleTimerToggle}
                className={timerRunning
                  ? "bg-red-500 hover:bg-red-600 text-white gap-1.5"
                  : "bg-[#0D9488] hover:bg-teal-700 text-white gap-1.5"}
              >
                {timerRunning ? <><Square className="w-3.5 h-3.5" /> إيقاف</> : <><Play className="w-3.5 h-3.5" /> بدء</>}
              </Button>
            </div>

            {/* Tabs */}
            <Tabs defaultValue="comments">
              <TabsList className="w-full">
                <TabsTrigger value="comments" className="flex-1 text-xs gap-1">
                  <MessageSquare className="w-3.5 h-3.5" />
                  التعليقات ({task.comments?.length ?? 0})
                </TabsTrigger>
                <TabsTrigger value="time" className="flex-1 text-xs gap-1">
                  <Clock className="w-3.5 h-3.5" />
                  الوقت ({task.timeLogs?.length ?? 0})
                </TabsTrigger>
              </TabsList>

              <TabsContent value="comments" className="space-y-3 mt-3">
                {task.comments?.map(c => (
                  <div key={c.id} className="flex gap-2">
                    <div className="w-7 h-7 bg-[#1A2B4A] rounded-full flex items-center justify-center flex-shrink-0">
                      <User className="w-3.5 h-3.5 text-white" />
                    </div>
                    <div className="flex-1 bg-white border border-slate-200 rounded-lg p-3">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium text-[#1A2B4A]">{c.userName}</span>
                        <span className="text-xs text-slate-400">
                          {new Date(c.createdAt).toLocaleDateString("ar")}
                        </span>
                      </div>
                      <p className="text-sm text-slate-700">{c.comment}</p>
                    </div>
                  </div>
                ))}
                {(!task.comments || task.comments.length === 0) && (
                  <p className="text-center text-xs text-slate-400 py-4">لا توجد تعليقات بعد</p>
                )}
                {/* Add comment */}
                <div className="flex gap-2 pt-1">
                  <Textarea
                    placeholder="أضف تعليقاً..."
                    value={comment}
                    onChange={e => setComment(e.target.value)}
                    rows={2}
                    className="flex-1 resize-none text-right text-sm"
                    onKeyDown={e => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        handleSendComment();
                      }
                    }}
                  />
                  <Button size="sm" onClick={handleSendComment}
                    disabled={!comment.trim() || addComment.isPending}
                    className="bg-[#1A2B4A] text-white self-end">
                    <Send className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </TabsContent>

              <TabsContent value="time" className="space-y-2 mt-3">
                {task.timeLogs?.map(log => (
                  <div key={log.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                    <div>
                      <p className="text-sm font-medium text-[#1A2B4A]">
                        {Math.floor((log.durationMinutes ?? 0) / 60)}h {(log.durationMinutes ?? 0) % 60}m
                      </p>
                      {log.description && <p className="text-xs text-slate-500">{log.description}</p>}
                    </div>
                    <span className="text-xs text-slate-400">
                      {new Date(log.createdAt).toLocaleDateString("ar")}
                    </span>
                  </div>
                ))}
                {(!task.timeLogs || task.timeLogs.length === 0) && (
                  <p className="text-center text-xs text-slate-400 py-4">لا توجد سجلات وقت</p>
                )}
              </TabsContent>
            </Tabs>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
