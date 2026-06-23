import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { useParams, useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowRight, Building2, Save, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface FormState {
  name: string;
  nameEn: string;
  description: string;
  status: "planning" | "active" | "on_hold" | "completed" | "cancelled";
  priority: "low" | "medium" | "high" | "critical";
  startDatePlanned: string;
  endDatePlanned: string;
  budgetPlanned: string;
  managerId: string;
}

const defaultForm: FormState = {
  name: "", nameEn: "", description: "",
  status: "planning", priority: "medium",
  startDatePlanned: "", endDatePlanned: "",
  budgetPlanned: "", managerId: "",
};

export default function ProjectForm() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const isEdit = !!id && id !== "new";
  const projectId = isEdit ? Number(id) : null;

  const [form, setForm] = useState<FormState>(defaultForm);

  const { data: existing, isLoading: loadingExisting } = trpc.construction.projects.getById.useQuery(
    { id: projectId! },
    { enabled: !!projectId }
  );

  useEffect(() => {
    if (existing) {
      setForm({
        name: existing.name ?? "",
        nameEn: existing.nameEn ?? "",
        description: existing.description ?? "",
        status: existing.status,
        priority: existing.priority,
        startDatePlanned: existing.startDatePlanned ?? "",
        endDatePlanned: existing.endDatePlanned ?? "",
        budgetPlanned: existing.budgetPlanned ?? "",
        managerId: existing.managerId ? String(existing.managerId) : "",
      });
    }
  }, [existing]);

  const utils = trpc.useUtils();

  const create = trpc.construction.projects.create.useMutation({
    onSuccess: (data) => {
      toast.success("تم إنشاء المشروع بنجاح");
      navigate(`/construction/projects/${data.id}`);
    },
    onError: err => toast.error(err.message),
  });

  const update = trpc.construction.projects.update.useMutation({
    onSuccess: () => {
      toast.success("تم تحديث المشروع");
      utils.construction.projects.getById.invalidate({ id: projectId! });
      navigate(`/construction/projects/${projectId}`);
    },
    onError: err => toast.error(err.message),
  });

  const isPending = create.isPending || update.isPending;

  const set = (key: keyof FormState, val: string) =>
    setForm(f => ({ ...f, [key]: val }));

  const handleSubmit = () => {
    if (!form.name.trim()) { toast.error("اسم المشروع مطلوب"); return; }
    const payload = {
      name: form.name.trim(),
      nameEn: form.nameEn || undefined,
      description: form.description || undefined,
      status: form.status,
      priority: form.priority,
      startDatePlanned: form.startDatePlanned || undefined,
      endDatePlanned: form.endDatePlanned || undefined,
      budgetPlanned: form.budgetPlanned || undefined,
      managerId: form.managerId ? Number(form.managerId) : undefined,
    };
    if (isEdit && projectId) {
      update.mutate({ id: projectId, ...payload });
    } else {
      create.mutate(payload);
    }
  };

  if (isEdit && loadingExisting) {
    return (
      <div className="p-6 space-y-4 max-w-2xl mx-auto">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto space-y-5">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <button onClick={() => navigate("/construction/projects")} className="hover:text-[#0D9488]">
          المشاريع
        </button>
        <ArrowRight className="w-3 h-3" />
        <span className="text-[#1A2B4A] font-medium">
          {isEdit ? "تعديل المشروع" : "مشروع جديد"}
        </span>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg text-[#1A2B4A] flex items-center gap-2">
            <Building2 className="w-5 h-5 text-[#E07B39]" />
            {isEdit ? "تعديل بيانات المشروع" : "إنشاء مشروع جديد"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">

          {/* Name */}
          <div className="space-y-1.5">
            <Label className="text-sm font-medium text-[#1A2B4A]">
              اسم المشروع <span className="text-red-500">*</span>
            </Label>
            <Input
              placeholder="مثال: مشروع برج الرياض السكني"
              value={form.name}
              onChange={e => set("name", e.target.value)}
              className="text-right"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm font-medium text-slate-600">
              الاسم بالإنجليزية (اختياري)
            </Label>
            <Input
              placeholder="Project Name in English"
              value={form.nameEn}
              onChange={e => set("nameEn", e.target.value)}
              className="text-left"
              dir="ltr"
            />
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <Label className="text-sm font-medium text-slate-600">الوصف</Label>
            <Textarea
              placeholder="وصف تفصيلي للمشروع..."
              value={form.description}
              onChange={e => set("description", e.target.value)}
              rows={4}
              className="text-right resize-none"
            />
          </div>

          {/* Status + Priority */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-sm font-medium text-[#1A2B4A]">الحالة</Label>
              <Select value={form.status} onValueChange={v => set("status", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="planning">📋 تخطيط</SelectItem>
                  <SelectItem value="active">🟢 نشط</SelectItem>
                  <SelectItem value="on_hold">⏸ موقوف</SelectItem>
                  <SelectItem value="completed">✅ مكتمل</SelectItem>
                  <SelectItem value="cancelled">❌ ملغي</SelectItem>
                </SelectContent>
              </Select>
            </div>
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
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-sm font-medium text-slate-600">تاريخ البداية المخطط</Label>
              <Input
                type="date"
                value={form.startDatePlanned}
                onChange={e => set("startDatePlanned", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-medium text-slate-600">تاريخ الانتهاء المخطط</Label>
              <Input
                type="date"
                value={form.endDatePlanned}
                onChange={e => set("endDatePlanned", e.target.value)}
              />
            </div>
          </div>

          {/* Budget */}
          <div className="space-y-1.5">
            <Label className="text-sm font-medium text-slate-600">الميزانية المخططة (ريال)</Label>
            <Input
              type="number"
              placeholder="0.00"
              value={form.budgetPlanned}
              onChange={e => set("budgetPlanned", e.target.value)}
              dir="ltr"
              className="text-left"
            />
          </div>

          {/* Submit */}
          <div className="flex gap-3 pt-2">
            <Button
              onClick={handleSubmit}
              disabled={isPending || !form.name.trim()}
              className="flex-1 bg-[#E07B39] hover:bg-[#c96b2e] text-white h-11 text-base font-semibold gap-2"
            >
              {isPending ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> جاري الحفظ...</>
              ) : (
                <><Save className="w-4 h-4" /> {isEdit ? "حفظ التعديلات" : "إنشاء المشروع"}</>
              )}
            </Button>
            <Button
              variant="outline"
              onClick={() => navigate(isEdit ? `/construction/projects/${projectId}` : "/construction/projects")}
              disabled={isPending}
            >
              إلغاء
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
