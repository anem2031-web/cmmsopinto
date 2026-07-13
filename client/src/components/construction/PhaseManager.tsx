import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronDown, ChevronLeft, Plus, Trash2, GripVertical, Layers, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import ConstructionDetailModal, { type ModalEntityType } from "@/components/construction/ConstructionDetailModal";

interface Props { projectId: number; projectName?: string; }

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-slate-100 text-slate-600",
  active: "bg-teal-100 text-teal-700",
  on_hold: "bg-amber-100 text-amber-700",
  completed: "bg-green-100 text-green-700",
};
const STATUS_LABELS: Record<string, string> = {
  pending: "معلق", active: "نشط", on_hold: "موقوف", completed: "مكتمل",
};

export default function PhaseManager({ projectId, projectName = "المشروع" }: Props) {
  const utils = trpc.useUtils();
  const [expandedPhases, setExpandedPhases] = useState<Set<number>>(new Set());
  const [showPhaseForm, setShowPhaseForm] = useState(false);
  const [showActivityForm, setShowActivityForm] = useState<number | null>(null);
  const [phaseForm, setPhaseForm] = useState({ name: "", startDatePlanned: "", endDatePlanned: "" });
  const [activityForm, setActivityForm] = useState({ name: "", startDatePlanned: "", endDatePlanned: "" });

  // Detail Modal state
  const [detailModal, setDetailModal] = useState<{
    open: boolean; type: ModalEntityType; id: number; breadcrumb: { label: string; type: ModalEntityType }[];
  }>({ open: false, type: "phase", id: 0, breadcrumb: [] });

  const openDetail = (
    type: ModalEntityType, id: number,
    breadcrumb: { label: string; type: ModalEntityType }[]
  ) => setDetailModal({ open: true, type, id, breadcrumb });

  const closeDetail = () => setDetailModal(d => ({ ...d, open: false }));

  const { data: phases, isLoading } = trpc.construction.phases.list.useQuery({ projectId });
  const { data: allActivities } = trpc.construction.activities.listByProject.useQuery({ projectId });

  const createPhase = trpc.construction.phases.create.useMutation({
    onSuccess: () => {
      utils.construction.phases.list.invalidate({ projectId });
      setShowPhaseForm(false);
      setPhaseForm({ name: "", startDatePlanned: "", endDatePlanned: "" });
      toast.success("تم إنشاء المرحلة");
    },
    onError: err => toast.error(err.message),
  });

  const deletePhase = trpc.construction.phases.delete.useMutation({
    onSuccess: () => { utils.construction.phases.list.invalidate({ projectId }); toast.success("تم حذف المرحلة"); },
    onError: err => toast.error(err.message),
  });

  const createActivity = trpc.construction.activities.create.useMutation({
    onSuccess: () => {
      utils.construction.activities.listByProject.invalidate({ projectId });
      setShowActivityForm(null);
      setActivityForm({ name: "", startDatePlanned: "", endDatePlanned: "" });
      toast.success("تم إنشاء النشاط");
    },
    onError: err => toast.error(err.message),
  });

  const togglePhase = (id: number) => {
    setExpandedPhases(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  if (isLoading) return <div className="space-y-2">{[1, 2].map(i => <Skeleton key={i} className="h-20 w-full" />)}</div>;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-[#1A2B4A] flex items-center gap-2">
          <Layers className="w-4 h-4" />
          المراحل والأنشطة
        </h3>
        <Button size="sm" onClick={() => setShowPhaseForm(true)}
          className="bg-[#1A2B4A] hover:bg-[#243659] text-white gap-1.5">
          <Plus className="w-3.5 h-3.5" /> مرحلة جديدة
        </Button>
      </div>

      {(!phases || phases.length === 0) && (
        <Card className="border-dashed">
          <CardContent className="py-10 text-center">
            <Layers className="w-10 h-10 text-slate-300 mx-auto mb-2" />
            <p className="text-slate-400 text-sm">لا توجد مراحل بعد</p>
            <Button size="sm" onClick={() => setShowPhaseForm(true)}
              className="mt-3 bg-[#E07B39] hover:bg-[#c96b2e] text-white gap-1.5">
              <Plus className="w-3.5 h-3.5" /> أضف مرحلة
            </Button>
          </CardContent>
        </Card>
      )}

      {phases?.map(phase => {
        const phaseActivities = allActivities?.filter(a => a.phaseId === phase.id) ?? [];
        const isExpanded = expandedPhases.has(phase.id);

        return (
          <Card key={phase.id} className="overflow-hidden">
            {/* Phase Header */}
            <div className="flex items-center gap-3 p-4 cursor-pointer hover:bg-slate-50 transition-colors"
              onClick={() => togglePhase(phase.id)}>
              <GripVertical className="w-4 h-4 text-slate-300 flex-shrink-0" />
              {isExpanded
                ? <ChevronDown className="w-4 h-4 text-slate-400 flex-shrink-0" />
                : <ChevronLeft className="w-4 h-4 text-slate-400 flex-shrink-0" />
              }
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-semibold text-[#1A2B4A] text-sm">{phase.name}</p>
                  <Badge className={`text-xs rounded-full ${STATUS_COLORS[phase.status]}`}>
                    {STATUS_LABELS[phase.status]}
                  </Badge>
                  <span className="text-xs text-slate-400">
                    {phaseActivities.length} نشاط · {(phase as any).taskTotal ?? 0} مهمة
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-1.5">
                  <Progress value={Number(phase.progressPercent ?? 0)} className="h-1.5 flex-1 max-w-48" />
                  <span className="text-xs text-slate-500">
                    {Number(phase.progressPercent ?? 0).toFixed(0)}%
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                {/* Open Detail Modal */}
                <Button variant="ghost" size="icon"
                  onClick={e => {
                    e.stopPropagation();
                    openDetail("phase", phase.id, [
                      { label: projectName, type: "project" },
                      { label: phase.name, type: "phase" },
                    ]);
                  }}
                  className="w-8 h-8 text-slate-400 hover:text-[#0D9488]" title="عرض التفاصيل">
                  <ExternalLink className="w-3.5 h-3.5" />
                </Button>
                <Button variant="ghost" size="sm"
                  onClick={e => { e.stopPropagation(); setShowActivityForm(phase.id); }}
                  className="text-xs text-[#0D9488] hover:bg-teal-50 gap-1">
                  <Plus className="w-3 h-3" /> نشاط
                </Button>
                <Button variant="ghost" size="icon"
                  onClick={e => { e.stopPropagation(); deletePhase.mutate({ id: phase.id }); }}
                  className="w-8 h-8 text-slate-400 hover:text-red-500">
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>

            {/* Activities */}
            {isExpanded && (
              <div className="border-t border-slate-100 bg-slate-50/50">
                {phaseActivities.length === 0 ? (
                  <p className="text-center text-xs text-slate-400 py-4">لا توجد أنشطة — أضف نشاطاً</p>
                ) : (
                  phaseActivities.map(activity => (
                    <div key={activity.id}
                      className="flex items-center gap-3 px-6 py-3 border-b border-slate-100 last:border-0 hover:bg-white transition-colors group">
                      <div className="w-1.5 h-1.5 rounded-full bg-[#0D9488] flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-[#1A2B4A]">{activity.name}</p>
                        {(activity.startDatePlanned || activity.endDatePlanned) && (
                          <p className="text-xs text-slate-400 mt-0.5">
                            {activity.startDatePlanned} → {activity.endDatePlanned}
                          </p>
                        )}
                      </div>
                      <Badge className={`text-xs rounded-full ${STATUS_COLORS[activity.status]}`}>
                        {STATUS_LABELS[activity.status]}
                      </Badge>
                      {/* Open Activity Detail */}
                      <Button variant="ghost" size="icon"
                        onClick={() => openDetail("activity", activity.id, [
                          { label: projectName, type: "project" },
                          { label: phase.name, type: "phase" },
                          { label: activity.name, type: "activity" },
                        ])}
                        className="w-7 h-7 opacity-0 group-hover:opacity-100 text-slate-400 hover:text-[#0D9488] transition-opacity">
                        <ExternalLink className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  ))
                )}
              </div>
            )}
          </Card>
        );
      })}

      {/* Phase Form Dialog */}
      {showPhaseForm && (
        <Dialog open onOpenChange={() => setShowPhaseForm(false)}>
          <DialogContent className="max-w-md" dir="rtl">
            <DialogHeader>
              <DialogTitle className="text-[#1A2B4A] text-right">مرحلة جديدة</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label className="text-sm font-medium text-[#1A2B4A]">اسم المرحلة *</Label>
                <Input placeholder="مثال: أعمال الأساسات" value={phaseForm.name}
                  onChange={e => setPhaseForm(f => ({ ...f, name: e.target.value }))}
                  className="text-right" autoFocus />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs text-slate-600">تاريخ البداية</Label>
                  <Input type="date" value={phaseForm.startDatePlanned}
                    onChange={e => setPhaseForm(f => ({ ...f, startDatePlanned: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-slate-600">تاريخ الانتهاء</Label>
                  <Input type="date" value={phaseForm.endDatePlanned}
                    onChange={e => setPhaseForm(f => ({ ...f, endDatePlanned: e.target.value }))} />
                </div>
              </div>
            </div>
            <DialogFooter className="gap-2 flex-row-reverse">
              <Button
                onClick={() => createPhase.mutate({
                  projectId, name: phaseForm.name.trim(),
                  startDatePlanned: phaseForm.startDatePlanned || undefined,
                  endDatePlanned: phaseForm.endDatePlanned || undefined,
                })}
                disabled={!phaseForm.name.trim() || createPhase.isPending}
                className="bg-[#1A2B4A] text-white">
                إنشاء المرحلة
              </Button>
              <Button variant="outline" onClick={() => setShowPhaseForm(false)}>إلغاء</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Activity Form Dialog */}
      {showActivityForm !== null && (
        <Dialog open onOpenChange={() => setShowActivityForm(null)}>
          <DialogContent className="max-w-md" dir="rtl">
            <DialogHeader>
              <DialogTitle className="text-[#1A2B4A] text-right">
                نشاط جديد — {phases?.find(p => p.id === showActivityForm)?.name}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label className="text-sm font-medium text-[#1A2B4A]">اسم النشاط *</Label>
                <Input placeholder="مثال: أعمال الخرسانة" value={activityForm.name}
                  onChange={e => setActivityForm(f => ({ ...f, name: e.target.value }))}
                  className="text-right" autoFocus />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs text-slate-600">تاريخ البداية</Label>
                  <Input type="date" value={activityForm.startDatePlanned}
                    onChange={e => setActivityForm(f => ({ ...f, startDatePlanned: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-slate-600">تاريخ الانتهاء</Label>
                  <Input type="date" value={activityForm.endDatePlanned}
                    onChange={e => setActivityForm(f => ({ ...f, endDatePlanned: e.target.value }))} />
                </div>
              </div>
            </div>
            <DialogFooter className="gap-2 flex-row-reverse">
              <Button
                onClick={() => createActivity.mutate({
                  projectId, phaseId: showActivityForm,
                  name: activityForm.name.trim(),
                  startDatePlanned: activityForm.startDatePlanned || undefined,
                  endDatePlanned: activityForm.endDatePlanned || undefined,
                })}
                disabled={!activityForm.name.trim() || createActivity.isPending}
                className="bg-[#0D9488] text-white">
                إنشاء النشاط
              </Button>
              <Button variant="outline" onClick={() => setShowActivityForm(null)}>إلغاء</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Detail Modal */}
      <ConstructionDetailModal
        open={detailModal.open}
        onClose={closeDetail}
        type={detailModal.type}
        id={detailModal.id}
        projectId={projectId}
        breadcrumb={detailModal.breadcrumb}
        onUpdated={() => {
          utils.construction.phases.list.invalidate({ projectId });
          utils.construction.activities.listByProject.invalidate({ projectId });
        }}
      />
    </div>
  );
}
