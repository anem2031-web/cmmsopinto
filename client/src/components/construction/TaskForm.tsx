import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

interface Props {
  projectId: number;
  onClose: () => void;
  onSuccess?: (taskId: number) => void;
}

export default function TaskForm({ projectId, onClose, onSuccess }: Props) {
  const utils = trpc.useUtils();

  const { data: phases } = trpc.construction.phases.list.useQuery({ projectId });
  const [selectedPhaseId, setSelectedPhaseId] = useState<string>("");
  const { data: activities } = trpc.construction.activities.listByProject.useQuery(
    { projectId },
    { enabled: !!projectId }
  );

  const filteredActivities = activities?.filter(
    a => !selectedPhaseId || a.phaseId === Number(selectedPhaseId)
  ) ?? [];

  const [form, setForm] = useState({
    title: "",
    description: "",
    priority: "medium",
    phaseId: "",
    activityId: "",
    startDatePlanned: "",
    endDatePlanned: "",
    estimatedHours: "",
    sprintPoints: "",
    locationDetail: "",
  });

  const set = (key: string, val: string) => setForm(f => ({ ...f, [key]: val }));

  const create = trpc.construction.tasks.create.useMutation({
    onSuccess: (data) => {
      utils.construction.tasks.kanban.invalidate({ projectId });
      utils.construction.projects.getById.invalidate({ id: projectId });
      toast.success(`تم إنشاء المهمة ${data.taskNumber}`);
      onSuccess?.(data.id);
      onClose();
    },
    onError: err => toast.error(err.message),
  });

  const handleSubmit = () => {
    if (!form.title.trim()) { toast.error("عنوان المهمة مطلوب"); return; }
    if (!form.phaseId) { toast.error("يجب اختيار المرحلة"); return; }
    if (!form.activityId) { toast.error("يجب اختيار النشاط"); return; }

    create.mutate({
      projectId,
      phaseId: Number(form.phaseId),
      activityId: Number(form.activityId),
      title: form.title.trim(),
      description: form.description || undefined,
      priority: form.priority as any,
      startDatePlanned: form.startDatePlanned || undefined,
      endDatePlanned: form.endDatePlanned || undefined,
      estimatedHours: form.estimatedHours || undefined,
      sprintPoints: form.sprintPoints ? Number(form.sprintPoints) : undefined,
      locationDetail: form.locationDetail || undefined,
    });
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle className="text-[#1A2B4A] text-right">إنشاء مهمة جديدة</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Title */}
          <div className="space-y-1.5">
            <Label className="text-sm font-medium text-[#1A2B4A]">
              عنوان المهمة <span className="text-red-500">*</span>
            </Label>
            <Input
              placeholder="مثال: صب خرسانة السقف الثالث"
              value={form.title}
              onChange={e => set("title", e.target.value)}
              className="text-right"
              autoFocus
            />
          </div>

          {/* Phase + Activity */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-sm font-medium text-[#1A2B4A]">
                المرحلة <span className="text-red-500">*</span>
              </Label>
              <Select value={form.phaseId} onValueChange={v => {
                set("phaseId", v);
                setSelectedPhaseId(v);
                set("activityId", "");
              }}>
                <SelectTrigger><SelectValue placeholder="اختر..." /></SelectTrigger>
                <SelectContent>
                  {phases?.map(p => (
                    <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-medium text-[#1A2B4A]">
                النشاط <span className="text-red-500">*</span>
              </Label>
              <Select value={form.activityId} onValueChange={v => set("activityId", v)}
                disabled={!form.phaseId}>
                <SelectTrigger><SelectValue placeholder="اختر..." /></SelectTrigger>
                <SelectContent>
                  {filteredActivities.map(a => (
                    <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Priority */}
          <div className="space-y-1.5">
            <Label className="text-sm font-medium text-[#1A2B4A]">الأولوية</Label>
            <Select value={form.priority} onValueChange={v => set("priority", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="low">🔵 منخفضة</SelectItem>
                <SelectItem value="medium">🟡 متوسطة</SelectItem>
                <SelectItem value="high">🟠 عالية</SelectItem>
                <SelectItem value="critical">🔴 حرجة</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <Label className="text-sm font-medium text-slate-600">الوصف</Label>
            <Textarea
              placeholder="تفاصيل المهمة..."
              value={form.description}
              onChange={e => set("description", e.target.value)}
              rows={3}
              className="text-right resize-none"
            />
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-slate-600">تاريخ البداية</Label>
              <Input type="date" value={form.startDatePlanned}
                onChange={e => set("startDatePlanned", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-slate-600">تاريخ الانتهاء</Label>
              <Input type="date" value={form.endDatePlanned}
                onChange={e => set("endDatePlanned", e.target.value)} />
            </div>
          </div>

          {/* Hours + Points */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-slate-600">ساعات العمل المقدرة</Label>
              <Input type="number" min={0} placeholder="0"
                value={form.estimatedHours}
                onChange={e => set("estimatedHours", e.target.value)}
                className="text-center" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-slate-600">Sprint Points</Label>
              <Input type="number" min={0} placeholder="0"
                value={form.sprintPoints}
                onChange={e => set("sprintPoints", e.target.value)}
                className="text-center" dir="ltr" />
            </div>
          </div>

          {/* Location */}
          <div className="space-y-1.5">
            <Label className="text-xs text-slate-600">موقع العمل (اختياري)</Label>
            <Input placeholder="مثال: الدور الثالث — الجانب الشمالي"
              value={form.locationDetail}
              onChange={e => set("locationDetail", e.target.value)}
              className="text-right" />
          </div>
        </div>

        <DialogFooter className="gap-2 flex-row-reverse">
          <Button
            onClick={handleSubmit}
            disabled={create.isPending || !form.title.trim()}
            className="bg-[#E07B39] hover:bg-[#c96b2e] text-white gap-2"
          >
            {create.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            إنشاء المهمة
          </Button>
          <Button variant="outline" onClick={onClose}>إلغاء</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
