import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Zap, Plus, Trash2, Play, Pause, Info } from "lucide-react";
import { toast } from "sonner";

const TRIGGER_LABELS: Record<string, string> = {
  status_change:      "تغيير حالة المهمة",
  date_passed:        "تجاوز تاريخ الانتهاء",
  task_completed:     "اكتمال مهمة",
  phase_completed:    "اكتمال مرحلة",
  member_overloaded:  "إفراط في تحميل عضو",
  daily_schedule:     "جدول يومي (7 صباحاً)",
};

const ACTION_LABELS: Record<string, string> = {
  create_purchase_order: "إنشاء طلب شراء",
  send_notification:     "إرسال إشعار",
  create_report:         "إنشاء تقرير",
  update_status:         "تحديث الحالة",
  reassign_task:         "إعادة تعيين المهمة",
  check_inventory:       "فحص المخزون",
};

const PRESET_AUTOMATIONS = [
  {
    name: "إنشاء طلب شراء عند انتظار المواد",
    triggerType: "status_change" as const,
    triggerCondition: { status: "pending_materials" },
    actionType: "create_purchase_order" as const,
    actionConfig: { message: "مهمة تنتظر مواد — يرجى إنشاء طلب شراء" },
    description: "عند تغيير حالة مهمة إلى «بانتظار مواد» → إنشاء طلب شراء تلقائياً",
  },
  {
    name: "إشعار التأخير الفوري",
    triggerType: "date_passed" as const,
    triggerCondition: {},
    actionType: "send_notification" as const,
    actionConfig: { title: "تنبيه تأخير", message: "مهمة تجاوزت موعد انتهائها المخطط" },
    description: "عند تجاوز مهمة تاريخ انتهائها → إشعار فوري لمدير المشروع",
  },
  {
    name: "إغلاق المرحلة تلقائياً",
    triggerType: "phase_completed" as const,
    triggerCondition: {},
    actionType: "send_notification" as const,
    actionConfig: { title: "مرحلة مكتملة", message: "تم إنجاز جميع مهام المرحلة" },
    description: "عند اكتمال جميع مهام مرحلة → تغيير حالتها لمكتملة + إشعار المدير",
  },
  {
    name: "تنبيه الإفراط في التحميل",
    triggerType: "member_overloaded" as const,
    triggerCondition: { threshold: 5 },
    actionType: "send_notification" as const,
    actionConfig: { title: "تحذير أحمال", message: "عضو لديه أكثر من 5 مهام نشطة" },
    description: "عند وجود عضو بأكثر من 5 مهام نشطة → إشعار المشرف لإعادة التوزيع",
  },
  {
    name: "تذكير يومي للمشرفين",
    triggerType: "daily_schedule" as const,
    triggerCondition: { hour: 7 },
    actionType: "send_notification" as const,
    actionConfig: { title: "مهام اليوم", message: "قائمة مهامك المجدولة لهذا اليوم" },
    description: "كل يوم الساعة 7 صباحاً → إرسال قائمة المهام المجدولة لكل مشرف",
  },
  {
    name: "فحص المخزون قبل الشراء",
    triggerType: "status_change" as const,
    triggerCondition: { status: "pending_materials" },
    actionType: "check_inventory" as const,
    actionConfig: {},
    description: "عند طلب مواد → فحص المخزون أولاً قبل إنشاء طلب شراء",
  },
];

interface Props {
  projectId: number;
}

export default function ProjectAutomations({ projectId }: Props) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<{
    name: string;
    triggerType: "status_change" | "date_passed" | "task_completed" | "phase_completed" | "member_overloaded" | "daily_schedule";
    actionType: "create_purchase_order" | "send_notification" | "create_report" | "update_status" | "reassign_task" | "check_inventory";
    notificationMessage: string;
  }>({
    name: "",
    triggerType: "status_change",
    actionType: "send_notification",
    notificationMessage: "",
  });

  const utils = trpc.useUtils();

  const { data: automations, isLoading } = trpc.construction.automations.list.useQuery({ projectId });

  const create = trpc.construction.automations.create.useMutation({
    onSuccess: () => {
      utils.construction.automations.list.invalidate({ projectId });
      setShowForm(false);
      toast.success("تم إنشاء قاعدة الأتمتة");
    },
    onError: err => toast.error(err.message),
  });

  const toggle = trpc.construction.automations.toggle.useMutation({
    onSuccess: () => utils.construction.automations.list.invalidate({ projectId }),
    onError: err => toast.error(err.message),
  });

  const remove = trpc.construction.automations.delete.useMutation({
    onSuccess: () => {
      utils.construction.automations.list.invalidate({ projectId });
      toast.success("تم حذف قاعدة الأتمتة");
    },
    onError: err => toast.error(err.message),
  });

  const addPreset = (preset: typeof PRESET_AUTOMATIONS[0]) => {
    create.mutate({
      projectId,
      name: preset.name,
      triggerType: preset.triggerType,
      triggerCondition: preset.triggerCondition,
      actionType: preset.actionType,
      actionConfig: preset.actionConfig,
      isActive: true,
    });
  };

  const handleSubmit = () => {
    if (!form.name.trim()) { toast.error("اسم القاعدة مطلوب"); return; }
    create.mutate({
      projectId,
      name: form.name.trim(),
      triggerType: form.triggerType,
      actionType: form.actionType,
      actionConfig: form.notificationMessage ? { message: form.notificationMessage } : {},
      isActive: true,
    });
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Zap className="w-5 h-5 text-[#E07B39]" />
          <h3 className="font-semibold text-[#1A2B4A]">قواعد الأتمتة</h3>
          <Badge className="text-xs bg-slate-100 text-slate-600 rounded-full">
            تعمل كل 5 دقائق
          </Badge>
        </div>
        <Button size="sm" onClick={() => setShowForm(true)}
          className="bg-[#E07B39] hover:bg-[#c96b2e] text-white gap-1.5">
          <Plus className="w-3.5 h-3.5" /> قاعدة جديدة
        </Button>
      </div>

      {/* Info */}
      <div className="flex items-start gap-2 p-3 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-700">
        <Info className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
        <span>
          القواعد تُقيَّم تلقائياً كل 5 دقائق. قواعد تغيير الحالة تُنفَّذ فورياً عند التغيير.
          فشل قاعدة واحدة لا يوقف باقي القواعد.
        </span>
      </div>

      {/* Active Automations */}
      {isLoading ? (
        <div className="space-y-2">{[1,2].map(i => <Skeleton key={i} className="h-20 w-full" />)}</div>
      ) : automations && automations.length > 0 ? (
        <div className="space-y-2">
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">القواعد النشطة</p>
          {automations.map(auto => (
            <Card key={auto.id} className={`border ${auto.isActive ? "border-teal-200" : "border-slate-200 opacity-60"}`}>
              <CardContent className="p-4 flex items-center justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm text-[#1A2B4A]">{auto.name}</p>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <span className="text-xs px-2 py-0.5 bg-[#1A2B4A]/10 text-[#1A2B4A] rounded">
                      {TRIGGER_LABELS[auto.triggerType]}
                    </span>
                    <span className="text-slate-300">→</span>
                    <span className="text-xs px-2 py-0.5 bg-[#0D9488]/10 text-[#0D9488] rounded">
                      {ACTION_LABELS[auto.actionType]}
                    </span>
                    {auto.runCount != null && auto.runCount > 0 && (
                      <span className="text-xs text-slate-400">نُفِّذت {auto.runCount} مرة</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <Switch
                    checked={auto.isActive}
                    onCheckedChange={v => toggle.mutate({ id: auto.id, isActive: v })}
                  />
                  <Button
                    variant="ghost" size="icon"
                    onClick={() => remove.mutate({ id: auto.id })}
                    className="w-8 h-8 text-slate-400 hover:text-red-500"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="border-dashed">
          <CardContent className="py-8 text-center">
            <Zap className="w-10 h-10 text-slate-300 mx-auto mb-2" />
            <p className="text-slate-400 text-sm">لا توجد قواعد أتمتة بعد</p>
            <p className="text-xs text-slate-300 mt-1">استخدم القوالب أدناه للبدء بسرعة</p>
          </CardContent>
        </Card>
      )}

      {/* Preset Templates */}
      <div>
        <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-3">
          قوالب جاهزة — اضغط لتفعيل
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {PRESET_AUTOMATIONS.map((preset, i) => {
            const alreadyAdded = automations?.some(a => a.name === preset.name);
            return (
              <Card key={i} className={`cursor-pointer transition-all ${alreadyAdded ? "opacity-50 cursor-not-allowed" : "hover:shadow-md hover:border-[#0D9488]"}`}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1">
                      <p className="font-medium text-sm text-[#1A2B4A] mb-1">{preset.name}</p>
                      <p className="text-xs text-slate-500">{preset.description}</p>
                      <div className="flex gap-1 mt-2 flex-wrap">
                        <span className="text-xs px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded">
                          {TRIGGER_LABELS[preset.triggerType]}
                        </span>
                        <span className="text-slate-300 text-xs">→</span>
                        <span className="text-xs px-1.5 py-0.5 bg-teal-50 text-teal-700 rounded">
                          {ACTION_LABELS[preset.actionType]}
                        </span>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => !alreadyAdded && addPreset(preset)}
                      disabled={alreadyAdded || create.isPending}
                      className={alreadyAdded
                        ? "bg-slate-100 text-slate-400 cursor-not-allowed"
                        : "bg-[#1A2B4A] hover:bg-[#243659] text-white"}
                    >
                      {alreadyAdded ? "مضاف" : "تفعيل"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      {/* Custom Rule Form */}
      {showForm && (
        <Dialog open onOpenChange={() => setShowForm(false)}>
          <DialogContent className="max-w-md" dir="rtl">
            <DialogHeader>
              <DialogTitle className="text-[#1A2B4A] text-right flex items-center gap-2">
                <Zap className="w-4 h-4 text-[#E07B39]" />
                قاعدة أتمتة مخصصة
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label className="text-sm font-medium text-[#1A2B4A]">اسم القاعدة *</Label>
                <Input
                  placeholder="مثال: إشعار تأخير المرحلة الثانية"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  className="text-right"
                />
              </div>

              {/* IF */}
              <div className="space-y-1.5">
                <Label className="text-sm font-medium text-[#1A2B4A]">إذا (Trigger)</Label>
                <Select value={form.triggerType} onValueChange={v => setForm(f => ({ ...f, triggerType: v as any }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(TRIGGER_LABELS).map(([v, l]) => (
                      <SelectItem key={v} value={v}>{l}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* THEN */}
              <div className="space-y-1.5">
                <Label className="text-sm font-medium text-[#1A2B4A]">فقم بـ (Action)</Label>
                <Select value={form.actionType} onValueChange={v => setForm(f => ({ ...f, actionType: v as any }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(ACTION_LABELS).map(([v, l]) => (
                      <SelectItem key={v} value={v}>{l}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {form.actionType === "send_notification" && (
                <div className="space-y-1.5">
                  <Label className="text-xs text-slate-600">نص الإشعار</Label>
                  <Input
                    placeholder="مثال: تم تجاوز موعد المهمة"
                    value={form.notificationMessage}
                    onChange={e => setForm(f => ({ ...f, notificationMessage: e.target.value }))}
                    className="text-right"
                  />
                </div>
              )}
            </div>

            <DialogFooter className="gap-2 flex-row-reverse">
              <Button
                onClick={handleSubmit}
                disabled={create.isPending || !form.name.trim()}
                className="bg-[#E07B39] hover:bg-[#c96b2e] text-white"
              >
                إنشاء القاعدة
              </Button>
              <Button variant="outline" onClick={() => setShowForm(false)}>إلغاء</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
