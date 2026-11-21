import { useState, type ReactNode } from "react";
import { useTranslation } from "@/contexts/LanguageContext";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  SHOW_DIRECT_NAMED_TASK_ASSIGNMENT,
  initialTaskAssignmentUiMode,
  showNamedAssignmentEditor,
} from "@shared/task-assignment-ui-policy";

export function supportsTeamTaskAssignmentDepartment(department?: string | null): boolean {
  return department === "maintenance_report_department_general"
    || department === "maintenance_report_department_construction";
}

export function TeamAssignmentSlot(props: { enabled: boolean; ticketId: number; taskId: number; hasNamedAssignment: boolean; onChanged: () => void; children: ReactNode }) {
  return props.enabled ? <TeamTaskAssignment {...props} /> : props.children;
}

/** Existing named assignments remain visible; new assignments follow the UI switch above. */
export function TeamTaskAssignment({ ticketId, taskId, hasNamedAssignment, onChanged, children }: {
  ticketId: number; taskId: number; hasNamedAssignment: boolean; onChanged: () => void; children: ReactNode;
}) {
  const { language } = useTranslation();
  const [mode, setMode] = useState<"name" | "team">(initialTaskAssignmentUiMode);
  const [teamId, setTeamId] = useState("");
  const [inspectionHours, setInspectionHours] = useState("");
  const inspectionMinutes = Number(inspectionHours) * 60;
  const validInspection = inspectionHours.trim() !== "" && Number.isSafeInteger(inspectionMinutes) && inspectionMinutes >= 1 && inspectionMinutes <= 525600;
  const copy = language === "ar" ? { name: "حسب الاسم", team: "حسب فريق الصيانة", select: "اختر فريق الصيانة", save: "إسناد الفريق وإنشاء البلاغ الفرعي", hint: "سيظهر البلاغ لأعضاء الفريق في نافذة تذاكر الصيانة.", empty: "لا توجد فرق متاحة؛ تحقق من المستودع والفنيين وحالة الفريق.", locked: "تم حفظ الإسناد بالاسم؛ تابع المسار الحالي لهذه المهمة.", done: "تم إسناد الفريق", loading: "جارٍ تحميل الفرق…" }
    : language === "ur" ? { name: "نام کے مطابق", team: "مرمت کی ٹیم کے مطابق", select: "مرمت کی ٹیم منتخب کریں", save: "ٹیم کو تفویض کریں اور ذیلی ٹکٹ بنائیں", hint: "ٹیم کے ارکان کو مرمت کے ٹکٹ کی ونڈو میں ٹکٹ دکھائی دے گا۔", empty: "کوئی دستیاب ٹیم نہیں ہے۔ گودام اور ارکان کی جانچ کریں۔", locked: "نام کے مطابق تفویض محفوظ ہے۔ موجودہ طریقہ جاری رکھیں۔", done: "ٹیم کو تفویض ہو گیا", loading: "ٹیمیں لوڈ ہو رہی ہیں…" }
    : { name: "By name", team: "By maintenance team", select: "Select maintenance team", save: "Assign team and create sub-ticket", hint: "Team members will see this in Maintenance Tickets.", empty: "No eligible teams. Check warehouse, active members and team status.", locked: "Name assignment is saved. Continue its existing workflow.", done: "Team assigned", loading: "Loading teams…" };
  const teams = trpc.ticketTeamAssignments.candidates.useQuery(undefined, {
    enabled: !showNamedAssignmentEditor(mode, hasNamedAssignment),
    retry: false,
  });
  const assign = trpc.ticketTeamAssignments.assign.useMutation({ onSuccess: data => { toast.success(`${copy.done}: ${data.ticketNumber}`); onChanged(); }, onError: error => toast.error(error.message) });
  return <div className="space-y-3">
    {SHOW_DIRECT_NAMED_TASK_ASSIGNMENT ? (
      <fieldset className="flex flex-wrap gap-4 text-sm" disabled={assign.isPending}>
        <label className="flex items-center gap-2"><input type="radio" name={`assignment-mode-${taskId}`} checked={mode === "name" || hasNamedAssignment} onChange={() => setMode("name")} />{copy.name}</label>
        <label className="flex items-center gap-2"><input type="radio" name={`assignment-mode-${taskId}`} checked={mode === "team" && !hasNamedAssignment} disabled={hasNamedAssignment} onChange={() => setMode("team")} />{copy.team}</label>
      </fieldset>
    ) : !hasNamedAssignment ? (
      <p className="text-sm font-medium">{copy.team}</p>
    ) : null}
    {hasNamedAssignment && <p className="text-xs text-muted-foreground">{copy.locked}</p>}
    {showNamedAssignmentEditor(mode, hasNamedAssignment) ? children : <div className="space-y-2">
      <label className="block space-y-1 text-sm"><span>{copy.select}</span><select className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={teamId} disabled={assign.isPending || teams.isLoading || !!teams.error} onChange={e => setTeamId(e.target.value)}>
        <option value="">{copy.select}</option>{teams.data?.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select></label>
      <label className="block space-y-1 text-sm"><span>{language === "ar" ? "المدة المحددة للفحص (بالساعات) *" : language === "ur" ? "معائنے کی مدت (گھنٹے) *" : "Inspection duration (hours) *"}</span><input type="number" min="0.0166666667" max="8760" step="any" value={inspectionHours} onChange={e => setInspectionHours(e.target.value)} disabled={assign.isPending} className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm" required /><span className="block text-xs text-muted-foreground">{language === "ar" ? "تبدأ من الإسناد حتى تسجيل نتيجة الفحص، وتُمنح ساعة إضافية قبل تنبيه التجاوز." : language === "ur" ? "تفویض سے نتیجے تک؛ انتباہ سے پہلے ایک اضافی گھنٹہ۔" : "From assignment until the result, with one extra hour before an overdue alert."}</span></label>
      {teams.isLoading && <p className="text-sm">{copy.loading}</p>}
      {teams.error && <p role="alert" className="text-sm text-destructive">{teams.error.message}</p>}
      {teams.data?.length === 0 && <p className="text-sm text-muted-foreground">{copy.empty}</p>}
      <p className="text-xs text-muted-foreground">{copy.hint}</p>
      <Button size="sm" disabled={assign.isPending || !validInspection || !!teams.error || !teams.data?.some(t => t.id === Number(teamId))} onClick={() => assign.mutate({ ticketId, taskId, teamId: Number(teamId), inspectionMinutes })}>{copy.save}</Button>
    </div>}
  </div>;
}
