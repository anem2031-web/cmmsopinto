import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ClipboardList, Plus, CheckCircle2, Clock } from "lucide-react";
import { toast } from "sonner";

const WEATHER_OPTIONS = [
  { value: "sunny", label: "☀️ مشمس" },
  { value: "cloudy", label: "⛅ غائم" },
  { value: "rainy", label: "🌧 ممطر" },
  { value: "stormy", label: "⛈ عاصف" },
  { value: "windy", label: "💨 مضطرب الرياح" },
];

export default function DailyReportTab({ projectId }: { projectId: number }) {
  const today = new Date().toISOString().split("T")[0];
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    reportDate: today,
    weather: "sunny" as const,
    workerCount: 0,
    workCompleted: "",
    obstacles: "",
    materialsUsed: "",
    safetyNotes: "",
    tomorrowPlan: "",
  });

  const utils = trpc.useUtils();

  const { data, isLoading } = trpc.construction.dailyReports.list.useQuery({
    projectId, page: 1, pageSize: 10,
  });

  const { data: todayReport } = trpc.construction.dailyReports.getByDate.useQuery({
    projectId, date: today,
  });

  const create = trpc.construction.dailyReports.create.useMutation({
    onSuccess: () => {
      utils.construction.dailyReports.list.invalidate({ projectId });
      utils.construction.dailyReports.getByDate.invalidate({ projectId, date: today });
      setShowForm(false);
      toast.success("تم حفظ التقرير اليومي");
    },
    onError: err => toast.error(err.message),
  });

  const handleSubmit = () => {
    create.mutate({ ...form, projectId });
  };

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="space-y-4">
      {/* Today's report status */}
      <div className={`flex items-center justify-between p-4 rounded-lg border ${
        todayReport ? "bg-green-50 border-green-200" : "bg-amber-50 border-amber-200"
      }`}>
        <div className="flex items-center gap-2">
          {todayReport
            ? <CheckCircle2 className="w-5 h-5 text-green-600" />
            : <Clock className="w-5 h-5 text-amber-600" />}
          <div>
            <p className={`text-sm font-medium ${todayReport ? "text-green-700" : "text-amber-700"}`}>
              {todayReport ? "تم تقديم تقرير اليوم" : "لم يُقدَّم تقرير اليوم بعد"}
            </p>
            <p className="text-xs text-slate-500">{today}</p>
          </div>
        </div>
        {!todayReport && (
          <Button
            size="sm"
            onClick={() => setShowForm(true)}
            className="bg-[#E07B39] hover:bg-[#c96b2e] text-white gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" /> تقديم التقرير
          </Button>
        )}
      </div>

      {/* Form */}
      {showForm && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm text-[#1A2B4A]">التقرير اليومي — {today}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">الطقس</Label>
                <Select value={form.weather} onValueChange={(v: any) => setForm(f => ({ ...f, weather: v }))}>
                  <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {WEATHER_OPTIONS.map(w => (
                      <SelectItem key={w.value} value={w.value}>{w.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">عدد العمال</Label>
                <Input
                  type="number" min={0}
                  value={form.workerCount}
                  onChange={e => setForm(f => ({ ...f, workerCount: Number(e.target.value) }))}
                  className="text-center text-lg font-bold"
                />
              </div>
            </div>

            {[
              { key: "workCompleted", label: "الأعمال المنجزة اليوم *" },
              { key: "obstacles", label: "العوائق والمشكلات" },
              { key: "materialsUsed", label: "المواد المستخدمة" },
              { key: "safetyNotes", label: "ملاحظات السلامة" },
              { key: "tomorrowPlan", label: "خطة الغد" },
            ].map(field => (
              <div key={field.key} className="space-y-1.5">
                <Label className="text-xs">{field.label}</Label>
                <Textarea
                  placeholder={`أدخل ${field.label}...`}
                  value={(form as any)[field.key]}
                  onChange={e => setForm(f => ({ ...f, [field.key]: e.target.value }))}
                  rows={3}
                  className="text-right resize-none text-sm"
                />
              </div>
            ))}

            <div className="flex gap-2 pt-2">
              <Button
                onClick={handleSubmit}
                disabled={!form.workCompleted.trim() || create.isPending}
                className="flex-1 bg-[#16A34A] hover:bg-green-700 text-white h-12 text-base font-semibold"
              >
                {create.isPending ? "جاري الحفظ..." : "تقديم التقرير اليومي"}
              </Button>
              <Button variant="outline" onClick={() => setShowForm(false)}>إلغاء</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Previous reports */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-[#1A2B4A]">التقارير السابقة</h3>
        {data?.data.map(report => (
          <Card key={report.id}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <p className="font-medium text-sm text-[#1A2B4A]">{report.reportDate}</p>
                  <span className="text-sm">
                    {WEATHER_OPTIONS.find(w => w.value === report.weather)?.label}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge className="text-xs bg-slate-100 text-slate-600 rounded-full">
                    👷 {report.workerCount} عامل
                  </Badge>
                  {report.approvedById && (
                    <Badge className="text-xs bg-green-100 text-green-700 rounded-full">معتمد</Badge>
                  )}
                </div>
              </div>
              {report.workCompleted && (
                <p className="text-sm text-slate-700 line-clamp-2">{report.workCompleted}</p>
              )}
              {report.obstacles && (
                <p className="text-xs text-red-600 mt-1">⚠ {report.obstacles}</p>
              )}
            </CardContent>
          </Card>
        ))}
        {(!data?.data || data.data.length === 0) && !showForm && (
          <Card><CardContent className="py-10 text-center">
            <ClipboardList className="w-10 h-10 text-slate-300 mx-auto mb-2" />
            <p className="text-slate-400 text-sm">لا توجد تقارير سابقة</p>
          </CardContent></Card>
        )}
      </div>
    </div>
  );
}
