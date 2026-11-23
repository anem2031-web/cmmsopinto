import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  BarChart3,
  BellRing,
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  Eye,
  ListChecks,
  RefreshCcw,
  Settings2,
  Users,
  Wrench,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { usePmv2Text, pmv2Text, localizePmv2ServerText } from "@/i18n/pmv2Ui";
import type { SupportedLanguage } from "@/contexts/LanguageContext";
import { EntityTranslatedText } from "@/components/i18n/EntityTranslatedText";
import { Pmv2LocalizedTimelineText } from "@/components/i18n/Pmv2LocalizedTimelineText";
import { useBatchTranslation } from "@/hooks/useContentTranslation";
import { formatPmv2ChecklistRecurrenceLabel, formatPmv2ManagerIntervalLabel, formatPmv2RecurrenceLabel, formatPmv2ScheduleConfigJsonLabel } from "./recurrence-label";
import { localizeApiError } from "@/i18n/apiError";
import { SimplifiedSetupTab } from "./SimplifiedSetupTab";

function localeFor(language: SupportedLanguage) {
  return language === "ar" ? "ar-SA" : language === "ur" ? "ur-PK" : "en-US";
}

function weekdayOptionsFor(language: SupportedLanguage) {
  return [0,1,2,3,4,5,6].map(value => ({ value: String(value), label: pmv2Text(language, ["الأحد","الاثنين","الثلاثاء","الأربعاء","الخميس","الجمعة","السبت"][value]) }));
}

function taskStatusLabel(status: string, language: SupportedLanguage) {
  const source: Record<string,string> = { pending:"معلّقة", in_progress:"قيد التنفيذ", waiting_material:"بانتظار مواد", waiting_ticket:"بانتظار بلاغ", ready_to_complete:"جاهزة للإكمال", completed:"مكتملة", cancelled:"ملغاة" };
  return pmv2Text(language, source[status] || status);
}

function workloadStatusLabel(status: string, language: SupportedLanguage) {
  const source: Record<string,string> = { available:"متاح", medium:"متوسط", high:"مرتفع", conflict:"تعارض" };
  return pmv2Text(language, source[status] || status);
}

const workloadStatusClasses: Record<string, string> = {
  available: "border-emerald-200 bg-emerald-50 text-emerald-800",
  medium: "border-amber-200 bg-amber-50 text-amber-800",
  high: "border-orange-200 bg-orange-50 text-orange-800",
  conflict: "border-red-200 bg-red-50 text-red-800",
};

function formatCompactDuration(minutesValue: unknown, language: SupportedLanguage) {
  const minutes = Math.max(0, Math.trunc(Number(minutesValue) || 0));
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  const nf = new Intl.NumberFormat(localeFor(language));
  if (!hours) return `${nf.format(remainder)} ${pmv2Text(language, "د")}`;
  if (!remainder) return `${nf.format(hours)} ${pmv2Text(language, "س")}`;
  return `${nf.format(hours)} ${pmv2Text(language, "س")} ${nf.format(remainder)} ${pmv2Text(language, "د")}`;
}

function formatDateTime(value: unknown, language: SupportedLanguage) {
  if (!value) return "—";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat(localeFor(language), {
    timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).format(date);
}

function slaBadge(sla: any, language: SupportedLanguage) {
  if (!sla || sla.status === "not_configured") return <Badge variant="outline">{pmv2Text(language, "SLA غير محدد")}</Badge>;
  if (sla.status === "overdue") return <Badge className="border-red-200 bg-red-50 text-red-800 hover:bg-red-50">{pmv2Text(language, "تجاوز SLA")} {formatCompactDuration(sla.breachMinutes, language)}</Badge>;
  return <Badge className="border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-50">{pmv2Text(language, "ضمن SLA")}</Badge>;
}

function formatShortDate(isoDate: string, language: SupportedLanguage) {
  const date = new Date(`${isoDate}T00:00:00+03:00`);
  return new Intl.DateTimeFormat(localeFor(language), { day: "numeric", month: "numeric", timeZone: "Asia/Riyadh" }).format(date);
}

function taskTargetLabel(task: any, language: SupportedLanguage) {
  if (task.siteName) return `${pmv2Text(language, "موقع")}: ${task.siteName}`;
  if (task.sectionName) return `${pmv2Text(language, "قسم")}: ${task.sectionName}`;
  if (task.assetName) return `${pmv2Text(language, "أصل")}: ${task.assetName}`;
  return `${pmv2Text(language, "هدف")} #${task.programTargetId}`;
}

function riyadhToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function addDaysIso(isoDate: string, days: number) {
  const date = new Date(`${isoDate}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10);
}

function weekRange(isoDate: string, offsetWeeks = 0) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  const sundayOffset = date.getUTCDay();
  const start = addDaysIso(isoDate, -sundayOffset + offsetWeeks * 7);
  return { from: start, to: addDaysIso(start, 6) };
}

function SimplePager({ page, totalPages, onPage }: { page: number; totalPages: number; onPage: (page: number) => void }) {
  const { p } = usePmv2Text();
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between gap-3 border-t pt-3 text-sm">
      <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => onPage(page - 1)}>{p("السابق")}</Button>
      <span className="text-muted-foreground">{p("صفحة {page} من {total}", { page, total: totalPages })}</span>
      <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>{p("التالي")}</Button>
    </div>
  );
}

function activeBadge(value: unknown) {
  const { p } = usePmv2Text();
  return Number(value) === 1 ? <Badge variant="secondary">{p("فعال")}</Badge> : <Badge variant="outline">{p("معطّل")}</Badge>;
}

function EmptyState({ text }: { text: string }) { return <p className="py-8 text-center text-sm text-muted-foreground">{text}</p>; }

function ordinalCycleMonth(value: unknown, language: SupportedLanguage) {
  if (language === "en") return ({1:"first",2:"second",3:"third",4:"fourth",5:"fifth",6:"sixth"} as Record<number,string>)[Number(value)] ?? String(value);
  if (language === "ur") return ({1:"پہلا",2:"دوسرا",3:"تیسرا",4:"چوتھا",5:"پانچواں",6:"چھٹا"} as Record<number,string>)[Number(value)] ?? String(value);
  return ({1:"الأول",2:"الثاني",3:"الثالث",4:"الرابع",5:"الخامس",6:"السادس"} as Record<number,string>)[Number(value)] ?? String(value);
}

function customScheduleHint(unit: string, language: SupportedLanguage) {
  if (unit === "day") return pmv2Text(language, "لا تحتاج لاختيار موعد إضافي؛ سيُنفذ الفحص حسب التكرار أعلاه.");
  if (unit === "week") return pmv2Text(language, "اختر يومًا واحدًا أو عدة أيام من الأسبوع.");
  if (unit === "month") return pmv2Text(language, "اختر يومًا واحدًا أو عدة أيام من الشهر.");
  if (unit === "quarter") return pmv2Text(language, "اختر موعدًا واحدًا أو عدة مواعيد خلال فترة الثلاثة أشهر التي يحين دورها.");
  if (unit === "year") return pmv2Text(language, "اختر تاريخًا واحدًا أو عدة تواريخ خلال السنة.");
  return "";
}

function OrganizationTab() {
  const { p, language, dir } = usePmv2Text();
  const utils = trpc.useUtils();
  const specialtiesQuery = trpc.pmv2.organization.specialties.list.useQuery();
  const teamsQuery = trpc.pmv2.organization.teams.list.useQuery();
  const usersQuery = trpc.pmv2.organization.references.users.useQuery();
  const warehousesQuery = trpc.pmv2.organization.references.warehouses.useQuery();

  const [specialtyCode, setSpecialtyCode] = useState("");
  const [specialtyName, setSpecialtyName] = useState("");
  const [managerUserId, setManagerUserId] = useState("");
  const [teamCode, setTeamCode] = useState("");
  const [teamSpecialtyId, setTeamSpecialtyId] = useState("");
  const [teamWarehouseId, setTeamWarehouseId] = useState("");
  const [selectedTeamId, setSelectedTeamId] = useState("");
  const [memberUserId, setMemberUserId] = useState("");
  const [specialtySearch, setSpecialtySearch] = useState("");
  const [specialtyStatus, setSpecialtyStatus] = useState("active");
  const [specialtyPage, setSpecialtyPage] = useState(1);
  const [teamSearch, setTeamSearch] = useState("");
  const [teamStatus, setTeamStatus] = useState("active");
  const [teamPage, setTeamPage] = useState(1);

  const membersQuery = trpc.pmv2.organization.teams.members.list.useQuery(
    { teamId: Number(selectedTeamId || 0) },
    { enabled: !!selectedTeamId },
  );

  const createSpecialty = trpc.pmv2.organization.specialties.create.useMutation({
    onSuccess: async () => {
      toast.success(p("تم إنشاء التخصص"));
      setSpecialtyCode("");
      setSpecialtyName("");
      setManagerUserId("");
      await utils.pmv2.organization.specialties.list.invalidate();
    },
    onError: error => toast.error(localizeApiError(error.message)),
  });

  const updateSpecialty = trpc.pmv2.organization.specialties.update.useMutation({
    onSuccess: async () => {
      await utils.pmv2.organization.specialties.list.invalidate();
    },
    onError: error => toast.error(localizeApiError(error.message)),
  });

  const createTeam = trpc.pmv2.organization.teams.create.useMutation({
    onSuccess: async () => {
      toast.success(p("تم إنشاء الفريق"));
      setTeamCode("");
      await utils.pmv2.organization.teams.list.invalidate();
    },
    onError: error => toast.error(localizeApiError(error.message)),
  });

  const updateTeam = trpc.pmv2.organization.teams.update.useMutation({
    onSuccess: async () => {
      await utils.pmv2.organization.teams.list.invalidate();
    },
    onError: error => toast.error(localizeApiError(error.message)),
  });

  const addMember = trpc.pmv2.organization.teams.members.add.useMutation({
    onSuccess: async (data) => {
      toast.success(data.reactivated ? p("تمت إعادة تفعيل عضوية الفريق") : p("تمت إضافة عضو الفريق"));
      setMemberUserId("");
      await membersQuery.refetch();
    },
    onError: error => toast.error(localizeApiError(error.message)),
  });

  const deactivateMember = trpc.pmv2.organization.teams.members.deactivate.useMutation({
    onSuccess: async () => {
      await membersQuery.refetch();
    },
    onError: error => toast.error(localizeApiError(error.message)),
  });

  const specialties = specialtiesQuery.data ?? [];
  const teams = teamsQuery.data ?? [];
  const users = usersQuery.data ?? [];
  const warehouses = warehousesQuery.data ?? [];
  const warehouseName = (warehouse: any) => language === "ar"
    ? (warehouse?.nameAr || warehouse?.nameEn || "—")
    : (warehouse?.nameEn || warehouse?.nameAr || "—");
  const { translationsMap: specialtyTranslations } = useBatchTranslation(
    "PMV2_SPECIALTY",
    specialties.map((item: any) => Number(item.id)),
    ["name", "description"],
  );
  const getSpecialtyName = (item: any) => specialtyTranslations[Number(item.id)]?.name || item.name || "";
  const filteredSpecialties = specialties.filter((item: any) => {
    const q = specialtySearch.trim().toLowerCase();
    const matchesSearch = !q || `${getSpecialtyName(item)} ${item.name ?? ""} ${item.code ?? ""} ${item.managerName ?? ""}`.toLowerCase().includes(q);
    const matchesStatus = specialtyStatus === "all" || (specialtyStatus === "active" ? Number(item.isActive) === 1 : Number(item.isActive) !== 1);
    return matchesSearch && matchesStatus;
  });
  const specialtyPages = Math.max(1, Math.ceil(filteredSpecialties.length / 15));
  const visibleSpecialties = filteredSpecialties.slice((specialtyPage - 1) * 15, specialtyPage * 15);
  const filteredTeams = teams.filter((item: any) => {
    const q = teamSearch.trim().toLowerCase();
    const matchesSearch = !q || `${item.code ?? ""} ${item.specialtyName ?? ""} ${item.warehouseNameAr ?? ""} ${item.warehouseNameEn ?? ""}`.toLowerCase().includes(q);
    const matchesStatus = teamStatus === "all" || (teamStatus === "active" ? Number(item.isActive) === 1 : Number(item.isActive) !== 1);
    return matchesSearch && matchesStatus;
  });
  const teamPages = Math.max(1, Math.ceil(filteredTeams.length / 15));
  const visibleTeams = filteredTeams.slice((teamPage - 1) * 15, teamPage * 15);

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <div className="space-y-6">
        <Card>
          <CardHeader><CardTitle className="text-lg">{p("إضافة تخصص")}</CardTitle></CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <div><Label>{p("رمز التخصص")}</Label><Input value={specialtyCode} onChange={e => setSpecialtyCode(e.target.value)} placeholder="ELEC" dir="ltr" /></div>
            <div><Label>{p("اسم التخصص")}</Label><Input value={specialtyName} onChange={e => setSpecialtyName(e.target.value)} placeholder={p("كهرباء")} /></div>
            <div className="sm:col-span-2">
              <Label>{p("المسؤول (اختياري)")}</Label>
              <select className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm" value={managerUserId} onChange={e => setManagerUserId(e.target.value)}>
                <option value="">{p("بدون مسؤول محدد")}</option>
                {users.map((user: any) => <option key={user.id} value={user.id}>{user.name} — {user.role}</option>)}
              </select>
            </div>
            <Button className="sm:col-span-2" disabled={!specialtyCode.trim() || !specialtyName.trim() || createSpecialty.isPending} onClick={() => createSpecialty.mutate({ code: specialtyCode.trim(), name: specialtyName.trim(), managerUserId: managerUserId ? Number(managerUserId) : null })}>{p("حفظ التخصص")}</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-lg">{p("التخصصات الحالية")}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-[1fr_150px]">
              <Input value={specialtySearch} onChange={e => { setSpecialtySearch(e.target.value); setSpecialtyPage(1); }} placeholder={p("بحث في التخصصات")} />
              <select className="h-10 rounded-md border bg-background px-3 text-sm" value={specialtyStatus} onChange={e => { setSpecialtyStatus(e.target.value); setSpecialtyPage(1); }}><option value="active">{p("الفعال")}</option><option value="inactive">{p("المعطل")}</option><option value="all">{p("الكل")}</option></select>
            </div>
            {visibleSpecialties.length === 0 ? <EmptyState text={p("لا توجد تخصصات مطابقة")} /> : visibleSpecialties.map((item: any) => (
              <div key={item.id} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                <div><div className="font-medium" dir="auto">{getSpecialtyName(item)}</div><div className="text-xs text-muted-foreground">{item.code}{item.managerName ? ` — ${item.managerName}` : ""}</div></div>
                <div className="flex items-center gap-2">{activeBadge(item.isActive)}<Button size="sm" variant="outline" onClick={() => updateSpecialty.mutate({ id: item.id, isActive: Number(item.isActive) !== 1 })}>{Number(item.isActive) === 1 ? p("تعطيل") : p("إعادة تفعيل")}</Button></div>
              </div>
            ))}
            <SimplePager page={specialtyPage} totalPages={specialtyPages} onPage={setSpecialtyPage} />
          </CardContent>
        </Card>
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader><CardTitle className="text-lg">{p("إنشاء فريق")}</CardTitle></CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <div><Label>{p("رمز الفريق")}</Label><Input value={teamCode} onChange={e => setTeamCode(e.target.value)} placeholder="ELEC-01" dir="ltr" /></div>
            <div>
              <Label>{p("التخصص")}</Label>
              <select className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm" value={teamSpecialtyId} onChange={e => setTeamSpecialtyId(e.target.value)}>
                <option value="">{p("اختر التخصص")}</option>
                {specialties.filter((x: any) => Number(x.isActive) === 1).map((item: any) => <option key={item.id} value={item.id}>{getSpecialtyName(item)}</option>)}
              </select>
            </div>
            <div className="sm:col-span-2">
              <Label>{p("مستودع الفريق")}</Label>
              <select className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm" value={teamWarehouseId} onChange={e => setTeamWarehouseId(e.target.value)}>
                <option value="">{p("اختر مستودعًا من النظام الحالي")}</option>
                {warehouses.map((warehouse: any) => <option key={warehouse.id} value={warehouse.id}>{warehouseName(warehouse)} — {warehouse.code}</option>)}
              </select>
            </div>
            <Button className="sm:col-span-2" disabled={!teamCode.trim() || !teamSpecialtyId || !teamWarehouseId || createTeam.isPending} onClick={() => createTeam.mutate({ code: teamCode.trim(), specialtyId: Number(teamSpecialtyId), warehouseId: Number(teamWarehouseId), deviceUserId: null })}>{p("حفظ الفريق")}</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-lg">{p("الفرق وأعضاؤها")}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-[1fr_150px]">
              <Input value={teamSearch} onChange={e => { setTeamSearch(e.target.value); setTeamPage(1); }} placeholder={p("بحث في الفرق")} />
              <select className="h-10 rounded-md border bg-background px-3 text-sm" value={teamStatus} onChange={e => { setTeamStatus(e.target.value); setTeamPage(1); }}><option value="active">{p("الفعال")}</option><option value="inactive">{p("المعطل")}</option><option value="all">{p("الكل")}</option></select>
            </div>
            {visibleTeams.length === 0 ? <EmptyState text={p("لا توجد فرق مطابقة")} /> : visibleTeams.map((team: any) => (
              <div key={team.id} className="rounded-lg border p-3">
                <div className="flex items-center justify-between gap-3">
                  <button className="text-start" onClick={() => setSelectedTeamId(String(team.id))}>
                    <div className="font-medium">{team.code} — {team.specialtyName}</div>
                    <div className="text-xs text-muted-foreground">{p("المستودع")}: {language === "en" ? (team.warehouseNameEn || team.warehouseNameAr) : (team.warehouseNameAr || team.warehouseNameEn) || `#${team.warehouseId}`}</div>
                  </button>
                  <div className="flex items-center gap-2">{activeBadge(team.isActive)}<Button size="sm" variant="outline" onClick={() => updateTeam.mutate({ id: team.id, isActive: Number(team.isActive) !== 1 })}>{Number(team.isActive) === 1 ? p("تعطيل") : p("إعادة تفعيل")}</Button></div>
                </div>
              </div>
            ))}
            <SimplePager page={teamPage} totalPages={teamPages} onPage={setTeamPage} />

            {selectedTeamId && (
              <div className="mt-4 rounded-lg border border-primary/20 bg-primary/5 p-4">
                <div className="mb-3 font-medium">{p("إدارة أعضاء الفريق المحدد")}</div>
                <div className="flex gap-2">
                  <select className="h-10 flex-1 rounded-md border bg-background px-3 text-sm" value={memberUserId} onChange={e => setMemberUserId(e.target.value)}>
                    <option value="">{p("اختر مستخدمًا موجودًا")}</option>
                    {users.map((user: any) => <option key={user.id} value={user.id}>{user.name} — {user.role}</option>)}
                  </select>
                  <Button disabled={!memberUserId || addMember.isPending} onClick={() => addMember.mutate({ teamId: Number(selectedTeamId), userId: Number(memberUserId) })}>{p("إضافة")}</Button>
                </div>
                <div className="mt-3 space-y-2">
                  {(membersQuery.data ?? []).map((member: any) => (
                    <div key={member.id} className="flex items-center justify-between rounded-md bg-background p-2 text-sm">
                      <span>{member.userName || p("مستخدم #{id}", { id: member.userId })}</span>
                      <div className="flex items-center gap-2">
                        {activeBadge(member.isActive)}
                        {Number(member.isActive) === 1 ? (
                          <Button size="sm" variant="ghost" onClick={() => deactivateMember.mutate({ id: member.id })}>{p("تعطيل العضوية")}</Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={addMember.isPending}
                            onClick={() => addMember.mutate({ teamId: Number(selectedTeamId), userId: Number(member.userId) })}
                          >
                            {p("إعادة تفعيل العضوية")}
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function ChecklistsTab() {
  const { p, language, dir } = usePmv2Text();
  const weekdayOptions = weekdayOptionsFor(language);
  const utils = trpc.useUtils();
  const checklistsQuery = trpc.pmv2.checklists.list.useQuery({ includeInactive: true });
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedChecklistId, setSelectedChecklistId] = useState("");
  const [title, setTitle] = useState("");
  const [recurrencePreset, setRecurrencePreset] = useState("monthly");
  const [simpleWeekday, setSimpleWeekday] = useState("1");
  const [simpleDay, setSimpleDay] = useState("1");
  const [simpleLastDay, setSimpleLastDay] = useState(false);
  const [quarterMonth, setQuarterMonth] = useState("1");
  const [halfMonth, setHalfMonth] = useState("1");
  const [yearMonth, setYearMonth] = useState("1");

  const [customUnit, setCustomUnit] = useState("week");
  const [customInterval, setCustomInterval] = useState("1");
  const [customStartDate, setCustomStartDate] = useState(riyadhToday());
  const [customWeekdays, setCustomWeekdays] = useState<number[]>([1]);
  const [customMonthDayInput, setCustomMonthDayInput] = useState("1");
  const [customMonthDays, setCustomMonthDays] = useState<Array<number | "last">>([]);
  const [customQuarterMonth, setCustomQuarterMonth] = useState("1");
  const [customQuarterDay, setCustomQuarterDay] = useState("1");
  const [customQuarterLast, setCustomQuarterLast] = useState(false);
  const [customQuarterDates, setCustomQuarterDates] = useState<Array<{ monthInQuarter: number; day: number | "last" }>>([]);
  const [customYearMonth, setCustomYearMonth] = useState("1");
  const [customYearDay, setCustomYearDay] = useState("1");
  const [customYearLast, setCustomYearLast] = useState(false);
  const [customYearDates, setCustomYearDates] = useState<Array<{ month: number; day: number | "last" }>>([]);

  const [checklistSearch, setChecklistSearch] = useState("");
  const [checklistStatus, setChecklistStatus] = useState("active");
  const [checklistPage, setChecklistPage] = useState(1);

  const selectedQuery = trpc.pmv2.checklists.get.useQuery(
    { id: Number(selectedChecklistId || 0) },
    { enabled: !!selectedChecklistId },
  );

  function resetChecklistItemForm() {
    setTitle("");
    setRecurrencePreset("monthly");
    setSimpleWeekday("1");
    setSimpleDay("1");
    setSimpleLastDay(false);
    setQuarterMonth("1");
    setHalfMonth("1");
    setYearMonth("1");

    setCustomUnit("week");
    setCustomInterval("1");
    setCustomStartDate(riyadhToday());
    setCustomWeekdays([1]);
    setCustomMonthDayInput("1");
    setCustomMonthDays([]);
    setCustomQuarterMonth("1");
    setCustomQuarterDay("1");
    setCustomQuarterLast(false);
    setCustomQuarterDates([]);
    setCustomYearMonth("1");
    setCustomYearDay("1");
    setCustomYearLast(false);
    setCustomYearDates([]);
  }

  const createChecklist = trpc.pmv2.checklists.create.useMutation({
    onSuccess: async data => {
      toast.success(p("تم إنشاء قائمة الصيانة"));
      setName(""); setDescription(""); setSelectedChecklistId(String(data.id));
      await utils.pmv2.checklists.list.invalidate();
    },
    onError: error => toast.error(localizeApiError(error.message)),
  });

  const updateChecklist = trpc.pmv2.checklists.update.useMutation({
    onSuccess: async () => {
      await utils.pmv2.checklists.list.invalidate();
      if (selectedChecklistId) await selectedQuery.refetch();
    },
    onError: error => toast.error(localizeApiError(error.message)),
  });

  const createItem = trpc.pmv2.checklists.items.create.useMutation({
    onSuccess: async () => {
      toast.success(p("تمت إضافة بند الصيانة"));
      resetChecklistItemForm();
      await selectedQuery.refetch();
    },
    onError: error => toast.error(localizeApiError(error.message)),
  });

  const updateItem = trpc.pmv2.checklists.items.update.useMutation({
    onSuccess: async () => selectedQuery.refetch(),
    onError: error => toast.error(localizeApiError(error.message)),
  });

  const checklists = checklistsQuery.data ?? [];
  const { translationsMap: checklistTranslations } = useBatchTranslation(
    "PMV2_CHECKLIST",
    checklists.map((item: any) => Number(item.id)),
    ["name", "description"],
  );
  const checklistName = (item: any) => checklistTranslations[Number(item.id)]?.name || item.name || "";
  const checklistDescription = (item: any) => checklistTranslations[Number(item.id)]?.description || item.description || "";
  const filteredChecklists = checklists.filter((item: any) => {
    const q = checklistSearch.trim().toLowerCase();
    const matchesSearch = !q || `${checklistName(item)} ${checklistDescription(item)} ${item.name ?? ""} ${item.description ?? ""}`.toLowerCase().includes(q);
    const matchesStatus = checklistStatus === "all" || (checklistStatus === "active" ? Number(item.isActive) === 1 : Number(item.isActive) !== 1);
    return matchesSearch && matchesStatus;
  });
  const checklistPages = Math.max(1, Math.ceil(filteredChecklists.length / 20));
  const visibleChecklists = filteredChecklists.slice((checklistPage - 1) * 20, checklistPage * 20);
  const selected = selectedQuery.data;

  const monthOptions = [
    "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
    "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر",
  ].map(p);

  function validDay(value: string) {
    const day = Number(value);
    return Number.isInteger(day) && day >= 1 && day <= 31 ? day : null;
  }

  function nextWeekdayOnOrAfter(dateIso: string, weekday: number) {
    const date = new Date(`${dateIso}T00:00:00Z`);
    const delta = (weekday - date.getUTCDay() + 7) % 7;
    date.setUTCDate(date.getUTCDate() + delta);
    return date.toISOString().slice(0, 10);
  }

  function addUniqueDay(value: number | "last") {
    setCustomMonthDays(current => current.includes(value) ? current : [...current, value]);
  }

  function toggleCustomWeekday(day: number) {
    setCustomWeekdays(current => current.includes(day) ? current.filter(value => value !== day) : [...current, day].sort((a, b) => a - b));
  }

  function addQuarterDate() {
    const monthInQuarter = Number(customQuarterMonth);
    const day = customQuarterLast ? "last" as const : validDay(customQuarterDay);
    if (!day) return toast.error(p("اختر يومًا صحيحًا من 1 إلى 31"));
    if (customQuarterDates.some(item => item.monthInQuarter === monthInQuarter && item.day === day)) return;
    setCustomQuarterDates(current => [...current, { monthInQuarter, day }]);
  }

  function addYearDate() {
    const month = Number(customYearMonth);
    const day = customYearLast ? "last" as const : validDay(customYearDay);
    if (!day) return toast.error(p("اختر يومًا صحيحًا من 1 إلى 31"));
    if (customYearDates.some(item => item.month === month && item.day === day)) return;
    setCustomYearDates(current => [...current, { month, day }]);
  }

  function buildScheduleInput() {
    const today = riyadhToday();
    let config: any;
    let frequency: "daily" | "weekly" | "monthly" | "quarterly" | "biannual" | "annual" = "monthly";
    let frequencyValue: number | null = null;
    let weekday: number | null = null;
    let monthDay: number | null = null;
    let anchorDate: string | null = null;

    if (recurrencePreset === "daily") {
      frequency = "daily";
      config = { version: 1, unit: "day", interval: 1, startDate: today, weekdays: [], monthDays: [], quarterDates: [], halfYearDates: [], yearDates: [] };
    } else if (recurrencePreset === "weekly" || recurrencePreset === "biweekly") {
      const day = Number(simpleWeekday);
      const interval = recurrencePreset === "biweekly" ? 2 : 1;
      frequency = "weekly";
      frequencyValue = interval === 1 ? null : interval;
      weekday = day;
      anchorDate = interval > 1 ? nextWeekdayOnOrAfter(today, day) : null;
      config = { version: 1, unit: "week", interval, startDate: interval > 1 ? anchorDate : today, weekdays: [day], monthDays: [], quarterDates: [], halfYearDates: [], yearDates: [] };
    } else if (recurrencePreset === "monthly") {
      const day = simpleLastDay ? "last" : validDay(simpleDay);
      if (!day) throw new Error(p("اختر يومًا صحيحًا من الشهر"));
      frequency = "monthly";
      monthDay = day === "last" ? 31 : day;
      config = { version: 1, unit: "month", interval: 1, startDate: today, weekdays: [], monthDays: [day], quarterDates: [], halfYearDates: [], yearDates: [] };
    } else if (recurrencePreset === "quarterly") {
      const day = simpleLastDay ? "last" : validDay(simpleDay);
      if (!day) throw new Error(p("اختر يومًا صحيحًا"));
      frequency = "quarterly";
      config = { version: 1, unit: "quarter", interval: 1, startDate: today, weekdays: [], monthDays: [], quarterDates: [{ monthInQuarter: Number(quarterMonth), day }], halfYearDates: [], yearDates: [] };
    } else if (recurrencePreset === "biannual") {
      const day = simpleLastDay ? "last" : validDay(simpleDay);
      if (!day) throw new Error(p("اختر يومًا صحيحًا"));
      frequency = "biannual";
      config = { version: 1, unit: "halfyear", interval: 1, startDate: today, weekdays: [], monthDays: [], quarterDates: [], halfYearDates: [{ monthInHalf: Number(halfMonth), day }], yearDates: [] };
    } else if (recurrencePreset === "annual") {
      const day = simpleLastDay ? "last" : validDay(simpleDay);
      if (!day) throw new Error(p("اختر يومًا صحيحًا"));
      frequency = "annual";
      config = { version: 1, unit: "year", interval: 1, startDate: today, weekdays: [], monthDays: [], quarterDates: [], halfYearDates: [], yearDates: [{ month: Number(yearMonth), day }] };
    } else {
      const interval = Number(customInterval);
      if (!Number.isInteger(interval) || interval < 1) throw new Error(p("التكرار المخصص يجب أن يكون رقمًا صحيحًا 1 أو أكثر"));
      const startDate = interval > 1 ? customStartDate : today;
      if (interval > 1 && !startDate) throw new Error(p("اختر تاريخ بداية التكرار"));
      frequencyValue = interval === 1 ? null : interval;
      anchorDate = startDate;

      if (customUnit === "day") {
        frequency = "daily";
        config = { version: 1, unit: "day", interval, startDate, weekdays: [], monthDays: [], quarterDates: [], halfYearDates: [], yearDates: [] };
      } else if (customUnit === "week") {
        if (customWeekdays.length === 0) throw new Error(p("اختر يومًا واحدًا على الأقل من أيام الأسبوع"));
        frequency = "weekly";
        weekday = customWeekdays[0];
        config = { version: 1, unit: "week", interval, startDate, weekdays: customWeekdays, monthDays: [], quarterDates: [], halfYearDates: [], yearDates: [] };
      } else if (customUnit === "month") {
        if (customMonthDays.length === 0) throw new Error(p("أضف يومًا واحدًا على الأقل من أيام الشهر"));
        frequency = "monthly";
        monthDay = customMonthDays[0] === "last" ? 31 : Number(customMonthDays[0]);
        config = { version: 1, unit: "month", interval, startDate, weekdays: [], monthDays: customMonthDays, quarterDates: [], halfYearDates: [], yearDates: [] };
      } else if (customUnit === "quarter") {
        if (customQuarterDates.length === 0) throw new Error(p("أضف موعدًا واحدًا على الأقل داخل الربع"));
        frequency = "quarterly";
        config = { version: 1, unit: "quarter", interval, startDate, weekdays: [], monthDays: [], quarterDates: customQuarterDates, halfYearDates: [], yearDates: [] };
      } else {
        if (customYearDates.length === 0) throw new Error(p("أضف موعدًا واحدًا على الأقل خلال السنة"));
        frequency = "annual";
        config = { version: 1, unit: "year", interval, startDate, weekdays: [], monthDays: [], quarterDates: [], halfYearDates: [], yearDates: customYearDates };
      }
    }

    const scheduleConfigJson = JSON.stringify(config);
    return {
      frequency,
      frequencyValue,
      weekday,
      monthDay,
      anchorDate,
      scheduleConfigJson,
      preview: formatPmv2ScheduleConfigJsonLabel(scheduleConfigJson, language) ?? "",
    };
  }

  let schedulePreview = "";
  try {
    schedulePreview = buildScheduleInput().preview;
  } catch {
    schedulePreview = "";
  }

  function submitItem() {
    if (!selectedChecklistId || !title.trim()) return;
    try {
      const schedule = buildScheduleInput();
      createItem.mutate({
        checklistId: Number(selectedChecklistId),
        title: title.trim(),
        isRequired: true,
        isActive: true,
        frequency: schedule.frequency,
        frequencyValue: schedule.frequencyValue,
        weekday: schedule.weekday,
        monthDay: schedule.monthDay,
        anchorDate: schedule.anchorDate,
        scheduleConfigJson: schedule.scheduleConfigJson,
      });
    } catch (error) {
      toast.error(error instanceof Error ? localizeApiError(error.message) : p("إعداد التكرار غير صالح"));
    }
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[380px_1fr]">
      <Card>
        <CardHeader><CardTitle className="text-lg">{p("قوائم الصيانة")}</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2 rounded-lg border p-3">
            <Label>{p("اسم القائمة")}</Label><Input value={name} onChange={e => setName(e.target.value)} placeholder={p("فحص المكيفات")} />
            <Label>{p("الوصف")}</Label><Textarea value={description} onChange={e => setDescription(e.target.value)} placeholder={p("اختياري")} />
            <Button className="w-full" disabled={!name.trim() || createChecklist.isPending} onClick={() => createChecklist.mutate({ name: name.trim(), description: description.trim() || null })}>{p("إنشاء قائمة")}</Button>
          </div>
          <div className="space-y-2">
            <div className="grid gap-2">
              <Input value={checklistSearch} onChange={e => { setChecklistSearch(e.target.value); setChecklistPage(1); }} placeholder={p("بحث في قوائم الصيانة")} />
              <select className="h-10 rounded-md border bg-background px-3 text-sm" value={checklistStatus} onChange={e => { setChecklistStatus(e.target.value); setChecklistPage(1); }}><option value="active">{p("الفعال")}</option><option value="inactive">{p("المعطل")}</option><option value="all">{p("الكل")}</option></select>
            </div>
            {visibleChecklists.length === 0 ? <EmptyState text={p("لا توجد قوائم مطابقة")} /> : visibleChecklists.map((item: any) => (
              <button key={item.id} className={`w-full rounded-lg border p-3 text-start ${String(item.id) === selectedChecklistId ? "border-primary bg-primary/5" : ""}`} onClick={() => setSelectedChecklistId(String(item.id))}>
                <div className="flex items-center justify-between gap-2"><span className="font-medium">{item.name}</span>{activeBadge(item.isActive)}</div>
                <div className="mt-1 text-xs text-muted-foreground">#{item.id}</div>
              </button>
            ))}
            <SimplePager page={checklistPage} totalPages={checklistPages} onPage={setChecklistPage} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-lg">{p("بنود القائمة والتكرار")}</CardTitle></CardHeader>
        <CardContent>
          {!selectedChecklistId ? <EmptyState text={p("اختر قائمة صيانة من اليمين")} /> : (
            <div className="space-y-5">
              {selected?.checklist && (
                <div className="flex items-center justify-between rounded-lg bg-muted/40 p-3">
                  <div><div className="font-medium">{checklistName(selected.checklist)}</div><div className="text-xs text-muted-foreground">{checklistDescription(selected.checklist) || p("بدون وصف")}</div></div>
                  <Button size="sm" variant="outline" onClick={() => updateChecklist.mutate({ id: selected.checklist.id, isActive: Number(selected.checklist.isActive) !== 1 })}>{Number(selected.checklist.isActive) === 1 ? p("تعطيل القائمة") : p("إعادة تفعيلها")}</Button>
                </div>
              )}

              <div className="space-y-4 rounded-lg border p-4">
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="md:col-span-2"><Label>{p("عنوان البند")}</Label><Input value={title} onChange={e => setTitle(e.target.value)} placeholder={p("فحص الفلتر")} /><p className="mt-1 text-xs text-muted-foreground">{p("يتم ترتيب البنود تلقائيًا حسب إضافتها.")}</p></div>
                  <div className="md:col-span-2">
                    <Label>{p("متى يتكرر الفحص؟")}</Label>
                    <select className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm" value={recurrencePreset} onChange={e => setRecurrencePreset(e.target.value)}>
                      <option value="daily">{p("يوميًا")}</option>
                      <option value="weekly">{p("كل أسبوع")}</option>
                      <option value="biweekly">{p("كل أسبوعين")}</option>
                      <option value="monthly">{p("كل شهر")}</option>
                      <option value="quarterly">{p("كل 3 أشهر — ربع سنوي")}</option>
                      <option value="biannual">{p("كل 6 أشهر — نصف سنوي")}</option>
                      <option value="annual">{p("كل سنة")}</option>
                      <option value="custom">{p("مخصص")}</option>
                    </select>
                  </div>
                </div>

                {(recurrencePreset === "weekly" || recurrencePreset === "biweekly") && (
                  <div className="max-w-sm">
                    <Label>{p("يوم التنفيذ")}</Label>
                    <select className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm" value={simpleWeekday} onChange={e => setSimpleWeekday(e.target.value)}>
                      {weekdayOptions.map(day => <option key={day.value} value={day.value}>{day.label}</option>)}
                    </select>
                  </div>
                )}

                {recurrencePreset === "monthly" && (
                  <div className="grid gap-3 md:grid-cols-2">
                    <div><Label>{p("يوم التنفيذ من الشهر")}</Label><Input type="number" min="1" max="31" value={simpleDay} disabled={simpleLastDay} onChange={e => setSimpleDay(e.target.value)} /></div>
                    <label className="flex items-center gap-2 self-end rounded-md border p-3 text-sm"><input type="checkbox" checked={simpleLastDay} onChange={e => setSimpleLastDay(e.target.checked)} />{p("آخر يوم من الشهر")}</label>
                  </div>
                )}

                {recurrencePreset === "quarterly" && (
                  <div className="grid gap-3 md:grid-cols-3">
                    <div><Label>{p("الشهر داخل الربع")}</Label><select className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm" value={quarterMonth} onChange={e => setQuarterMonth(e.target.value)}><option value="1">{p("الشهر الأول")}</option><option value="2">{p("الشهر الثاني")}</option><option value="3">{p("الشهر الثالث")}</option></select></div>
                    <div><Label>{p("يوم التنفيذ")}</Label><Input type="number" min="1" max="31" value={simpleDay} disabled={simpleLastDay} onChange={e => setSimpleDay(e.target.value)} /></div>
                    <label className="flex items-center gap-2 self-end rounded-md border p-3 text-sm"><input type="checkbox" checked={simpleLastDay} onChange={e => setSimpleLastDay(e.target.checked)} />{p("آخر يوم من الشهر")}</label>
                  </div>
                )}

                {recurrencePreset === "biannual" && (
                  <div className="grid gap-3 md:grid-cols-3">
                    <div><Label>{p("الشهر داخل النصف السنوي")}</Label><select className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm" value={halfMonth} onChange={e => setHalfMonth(e.target.value)}>{[1,2,3,4,5,6].map(value => <option key={value} value={value}>{p("الشهر {value}", { value })}</option>)}</select></div>
                    <div><Label>{p("يوم التنفيذ")}</Label><Input type="number" min="1" max="31" value={simpleDay} disabled={simpleLastDay} onChange={e => setSimpleDay(e.target.value)} /></div>
                    <label className="flex items-center gap-2 self-end rounded-md border p-3 text-sm"><input type="checkbox" checked={simpleLastDay} onChange={e => setSimpleLastDay(e.target.checked)} />{p("آخر يوم من الشهر")}</label>
                  </div>
                )}

                {recurrencePreset === "annual" && (
                  <div className="grid gap-3 md:grid-cols-3">
                    <div><Label>{p("الشهر")}</Label><select className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm" value={yearMonth} onChange={e => setYearMonth(e.target.value)}>{monthOptions.map((label, index) => <option key={label} value={index + 1}>{label}</option>)}</select></div>
                    <div><Label>{p("يوم التنفيذ")}</Label><Input type="number" min="1" max="31" value={simpleDay} disabled={simpleLastDay} onChange={e => setSimpleDay(e.target.value)} /></div>
                    <label className="flex items-center gap-2 self-end rounded-md border p-3 text-sm"><input type="checkbox" checked={simpleLastDay} onChange={e => setSimpleLastDay(e.target.checked)} />{p("آخر يوم من الشهر")}</label>
                  </div>
                )}

                {recurrencePreset === "custom" && (
                  <div className="space-y-4 rounded-lg bg-muted/30 p-4">
                    <div>
                      <div className="text-sm font-medium">{p("تخصيص التكرار")}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{p("حدد كل متى يتكرر الفحص، ثم اختر مواعيد التنفيذ عند الحاجة.")}</div>
                    </div>

                    <div className="rounded-lg border bg-background p-3">
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="font-medium">{p("يتكرر الفحص كل")}</span>
                        <Input
                          aria-label={p("عدد التكرار")}
                          className="w-24"
                          type="number"
                          min="1"
                          step="1"
                          value={customInterval}
                          onChange={e => setCustomInterval(e.target.value)}
                        />
                        <select
                          aria-label={p("وحدة التكرار")}
                          className="h-10 min-w-36 rounded-md border bg-background px-3 text-sm"
                          value={customUnit}
                          onChange={e => setCustomUnit(e.target.value)}
                        >
                          <option value="day">{p("يوم")}</option>
                          <option value="week">{p("أسبوع")}</option>
                          <option value="month">{p("شهر")}</option>
                          <option value="quarter">{p("فترة 3 أشهر")}</option>
                          <option value="year">{p("سنة")}</option>
                        </select>
                      </div>
                      <div className="mt-2 text-sm"><span className="font-medium">{p("النتيجة:")}</span>{formatPmv2ManagerIntervalLabel(customUnit, Number(customInterval), language)}</div>
                      {Number(customInterval) > 1 && (
                        <div className="mt-3 max-w-xs">
                          <Label>{p("يبدأ هذا النمط من")}</Label>
                          <Input type="date" value={customStartDate} onChange={e => setCustomStartDate(e.target.value)} />
                        </div>
                      )}
                    </div>

                    <div className="border-t pt-4">
                      <div className="text-sm font-medium">{p("متى يتم التنفيذ؟")}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{customScheduleHint(customUnit, language)}</div>
                    </div>

                    {customUnit === "day" && (
                      <div className="rounded-lg border border-dashed bg-background/60 p-3 text-sm text-muted-foreground">{p("لا توجد مواعيد إضافية لهذا النوع.")}</div>
                    )}

                    {customUnit === "week" && (
                      <div>
                        <Label>{p("اختر أيام التنفيذ")}</Label>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {weekdayOptions.map(day => {
                            const value = Number(day.value);
                            const selectedDay = customWeekdays.includes(value);
                            return <Button key={day.value} type="button" size="sm" variant={selectedDay ? "default" : "outline"} onClick={() => toggleCustomWeekday(value)}>{day.label}</Button>;
                          })}
                        </div>
                      </div>
                    )}

                    {customUnit === "month" && (
                      <div className="space-y-3">
                        <Label>{p("اختر أيام التنفيذ من الشهر")}</Label>
                        <div className="flex flex-wrap items-end gap-2">
                          <div className="w-36"><Input type="number" min="1" max="31" value={customMonthDayInput} onChange={e => setCustomMonthDayInput(e.target.value)} /></div>
                          <Button type="button" variant="outline" onClick={() => { const day = validDay(customMonthDayInput); if (!day) return toast.error(p("اختر يومًا من 1 إلى 31")); addUniqueDay(day); }}>{p("إضافة يوم")}</Button>
                          <Button type="button" variant="outline" onClick={() => addUniqueDay("last")}>{p("إضافة آخر يوم")}</Button>
                        </div>
                        <div className="flex flex-wrap gap-2">{customMonthDays.map(day => <button key={String(day)} type="button" className="rounded-full border px-3 py-1 text-xs" onClick={() => setCustomMonthDays(current => current.filter(value => value !== day))}>{day === "last" ? p("آخر يوم") : p("يوم {day}", { day })} ×</button>)}</div>
                      </div>
                    )}

                    {customUnit === "quarter" && (
                      <div className="space-y-3">
                        <Label>{p("اختر مواعيد التنفيذ خلال فترة 3 أشهر")}</Label>
                        <div className="grid gap-2 md:grid-cols-[180px_140px_180px_auto]">
                          <select className="h-10 rounded-md border bg-background px-3 text-sm" value={customQuarterMonth} onChange={e => setCustomQuarterMonth(e.target.value)}><option value="1">{p("الشهر الأول")}</option><option value="2">{p("الشهر الثاني")}</option><option value="3">{p("الشهر الثالث")}</option></select>
                          <Input type="number" min="1" max="31" value={customQuarterDay} disabled={customQuarterLast} onChange={e => setCustomQuarterDay(e.target.value)} />
                          <label className="flex items-center gap-2 rounded-md border px-3 text-sm"><input type="checkbox" checked={customQuarterLast} onChange={e => setCustomQuarterLast(e.target.checked)} />{p("آخر يوم من الشهر")}</label>
                          <Button type="button" variant="outline" onClick={addQuarterDate}>{p("إضافة الموعد")}</Button>
                        </div>
                        <div className="flex flex-wrap gap-2">{customQuarterDates.map((item, index) => <button key={`${item.monthInQuarter}-${item.day}-${index}`} type="button" className="rounded-full border px-3 py-1 text-xs" onClick={() => setCustomQuarterDates(current => current.filter((_, i) => i !== index))}>{p("الشهر {month}", { month: ordinalCycleMonth(item.monthInQuarter, language) })} — {item.day === "last" ? p("آخر يوم") : p("يوم {day}", { day: item.day })} ×</button>)}</div>
                      </div>
                    )}

                    {customUnit === "year" && (
                      <div className="space-y-3">
                        <Label>{p("اختر تواريخ التنفيذ خلال السنة")}</Label>
                        <div className="grid gap-2 md:grid-cols-[180px_140px_180px_auto]">
                          <select className="h-10 rounded-md border bg-background px-3 text-sm" value={customYearMonth} onChange={e => setCustomYearMonth(e.target.value)}>{monthOptions.map((label, index) => <option key={label} value={index + 1}>{label}</option>)}</select>
                          <Input type="number" min="1" max="31" value={customYearDay} disabled={customYearLast} onChange={e => setCustomYearDay(e.target.value)} />
                          <label className="flex items-center gap-2 rounded-md border px-3 text-sm"><input type="checkbox" checked={customYearLast} onChange={e => setCustomYearLast(e.target.checked)} />{p("آخر يوم من الشهر")}</label>
                          <Button type="button" variant="outline" onClick={addYearDate}>{p("إضافة التاريخ")}</Button>
                        </div>
                        <div className="flex flex-wrap gap-2">{customYearDates.map((item, index) => <button key={`${item.month}-${item.day}-${index}`} type="button" className="rounded-full border px-3 py-1 text-xs" onClick={() => setCustomYearDates(current => current.filter((_, i) => i !== index))}>{item.day === "last" ? p("آخر يوم") : item.day} {monthOptions[item.month - 1]} ×</button>)}</div>
                      </div>
                    )}
                  </div>
                )}

                {schedulePreview && <div className="rounded-lg border bg-primary/5 p-3 text-sm"><span className="font-medium">{p("سيتم تنفيذ هذا الفحص:")}</span>{schedulePreview}</div>}
                <Button className="w-full" disabled={!title.trim() || createItem.isPending} onClick={submitItem}>{p("إضافة البند")}</Button>
              </div>

              <div className="space-y-2">
                {(selected?.items ?? []).length === 0 ? <EmptyState text={p("لا توجد بنود في هذه القائمة")} /> : (selected?.items ?? []).map((item: any, itemIndex: number) => (
                  <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
                    <div><div className="font-medium">{itemIndex + 1}. <EntityTranslatedText entityType="PMV2_CHECKLIST_ITEM" entityId={Number(item.id)} field="title" original={item.title} /></div><div className="text-xs text-muted-foreground">{formatPmv2ChecklistRecurrenceLabel(item, language)}</div></div>
                    <div className="flex items-center gap-2">{activeBadge(item.isActive)}<Button size="sm" variant="outline" onClick={() => updateItem.mutate({ id: item.id, isActive: Number(item.isActive) !== 1 })}>{Number(item.isActive) === 1 ? p("تعطيل") : p("إعادة تفعيل")}</Button></div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function formatEstimatedDuration(minutes: unknown, language: SupportedLanguage) {
  const value = Number(minutes);
  if (!Number.isFinite(value) || value <= 0) return pmv2Text(language, "غير محددة");
  const hours = Math.floor(value / 60);
  const rest = value % 60;
  if (hours === 0) return pmv2Text(language, "{count} دقيقة", { count: value });
  if (rest === 0) return hours === 1 ? pmv2Text(language, "ساعة واحدة") : hours === 2 ? pmv2Text(language, "ساعتان") : pmv2Text(language, "{count} ساعات", { count: hours });
  return `${new Intl.NumberFormat(localeFor(language)).format(hours)} ${pmv2Text(language, "س")} ${new Intl.NumberFormat(localeFor(language)).format(rest)} ${pmv2Text(language, "د")}`;
}

function ProgramsTab() {
  const { p, language, dir } = usePmv2Text();
  const utils = trpc.useUtils();
  const programsQuery = trpc.pmv2.programs.list.useQuery({ includeInactive: true });
  const teamsQuery = trpc.pmv2.organization.teams.list.useQuery();
  const checklistsQuery = trpc.pmv2.checklists.list.useQuery();
  const sitesQuery = trpc.pmv2.targets.sites.useQuery();
  const sectionsQuery = trpc.pmv2.targets.sections.useQuery(undefined);
  const assetsQuery = trpc.pmv2.targets.assets.useQuery(undefined);
  const programRows = programsQuery.data ?? [];
  const checklistRows = checklistsQuery.data ?? [];
  const { translationsMap: programTranslations } = useBatchTranslation(
    "PMV2_PROGRAM",
    programRows.map((item: any) => Number(item.id)),
    ["title"],
  );
  const { translationsMap: programChecklistTranslations } = useBatchTranslation(
    "PMV2_CHECKLIST",
    checklistRows.map((item: any) => Number(item.id)),
    ["name"],
  );
  const localizedProgramTitle = (item: any) => programTranslations[Number(item.id)]?.title || item.title || "";
  const programChecklistName = (item: any) => programChecklistTranslations[Number(item.id)]?.name || item.name || "";
  const targetOptionLabel = (item: any) => item.name || item.nameEn || item.nameAr || item.assetName || item.title || `#${item.id}`;

  const [programTitle, setProgramTitle] = useState("");
  const [teamId, setTeamId] = useState("");
  const [checklistId, setChecklistId] = useState("");
  const [estimatedDurationMinutes, setEstimatedDurationMinutes] = useState("");
  const [selectedProgramId, setSelectedProgramId] = useState("");
  const [targetType, setTargetType] = useState("site");
  const [targetId, setTargetId] = useState("");
  const [programSearch, setProgramSearch] = useState("");
  const [programStatus, setProgramStatus] = useState("active");
  const [programTeamFilter, setProgramTeamFilter] = useState("");
  const [programPage, setProgramPage] = useState(1);
  const [editingProgram, setEditingProgram] = useState(false);
  const [editProgramTitle, setEditProgramTitle] = useState("");
  const [editTeamId, setEditTeamId] = useState("");
  const [editChecklistId, setEditChecklistId] = useState("");
  const [editEstimatedDurationMinutes, setEditEstimatedDurationMinutes] = useState("");

  const programQuery = trpc.pmv2.programs.get.useQuery(
    { id: Number(selectedProgramId || 0) },
    { enabled: !!selectedProgramId },
  );

  useEffect(() => {
    const program = programQuery.data?.program as any;
    if (!program) return;
    setEditProgramTitle(program.title ?? "");
    setEditTeamId(String(program.teamId ?? ""));
    setEditChecklistId(String(program.checklistId ?? ""));
    setEditEstimatedDurationMinutes(program.estimatedDurationMinutes == null ? "" : String(program.estimatedDurationMinutes));
  }, [programQuery.data?.program]);

  const createProgram = trpc.pmv2.programs.create.useMutation({
    onSuccess: async data => {
      toast.success(p("تم إنشاء برنامج الصيانة"));
      setSelectedProgramId(String(data.id));
      setProgramTitle("");
      setEstimatedDurationMinutes("");
      await utils.pmv2.programs.list.invalidate();
    },
    onError: error => toast.error(localizeApiError(error.message)),
  });

  const updateProgram = trpc.pmv2.programs.update.useMutation({
    onSuccess: async () => {
      toast.success(p("تم حفظ تعديلات البرنامج"));
      setEditingProgram(false);
      await utils.pmv2.programs.list.invalidate();
      if (selectedProgramId) await programQuery.refetch();
    },
    onError: error => toast.error(localizeApiError(error.message)),
  });

  const addTarget = trpc.pmv2.programs.targets.add.useMutation({
    onSuccess: async () => {
      toast.success(p("تم ربط هدف الصيانة بالبرنامج"));
      setTargetId("");
      await programQuery.refetch();
    },
    onError: error => toast.error(localizeApiError(error.message)),
  });

  const targetOptions = useMemo(() => {
    const availableTargets =
      targetType === "site"
        ? sitesQuery.data ?? []
        : targetType === "section"
          ? sectionsQuery.data ?? []
          : assetsQuery.data ?? [];

    const linkedTargetIds = new Set(
      (programQuery.data?.targets ?? [])
        .map((target: any) =>
          targetType === "site"
            ? target.siteId
            : targetType === "section"
              ? target.sectionId
              : target.assetId,
        )
        .filter((id: unknown) => id !== null && id !== undefined)
        .map((id: unknown) => Number(id)),
    );

    return availableTargets.filter((item: any) => !linkedTargetIds.has(Number(item.id)));
  }, [
    targetType,
    sitesQuery.data,
    sectionsQuery.data,
    assetsQuery.data,
    programQuery.data?.targets,
  ]);

  const filteredPrograms = programRows.filter((program: any) => {
    const q = programSearch.trim().toLowerCase();
    const matchesSearch = !q || `${localizedProgramTitle(program)} ${program.title ?? ""} ${p("برنامج محدد")} ${program.id} ${program.teamCode ?? ""} ${program.checklistName ?? ""}`.toLowerCase().includes(q);
    const matchesStatus = programStatus === "all" || (programStatus === "active" ? Number(program.isActive) === 1 : Number(program.isActive) !== 1);
    const matchesTeam = !programTeamFilter || Number(program.teamId) === Number(programTeamFilter);
    return matchesSearch && matchesStatus && matchesTeam;
  });
  const programPages = Math.max(1, Math.ceil(filteredPrograms.length / 20));
  const visiblePrograms = filteredPrograms.slice((programPage - 1) * 20, programPage * 20);

  function saveProgramEdits() {
    if (!selectedProgramId || !editTeamId || !editChecklistId) return;
    const durationText = editEstimatedDurationMinutes.trim();
    if (durationText && (!/^\d+$/.test(durationText) || Number(durationText) < 1)) {
      toast.error(p("المدة التقديرية يجب أن تكون عدد دقائق صحيحًا 1 أو أكثر"));
      return;
    }
    updateProgram.mutate({
      id: Number(selectedProgramId),
      title: editProgramTitle.trim() || null,
      teamId: Number(editTeamId),
      checklistId: Number(editChecklistId),
      estimatedDurationMinutes: durationText ? Number(durationText) : null,
    });
  }

  function submitTarget() {
    if (!selectedProgramId || !targetId) return;
    const programId = Number(selectedProgramId);
    if (targetType === "site") addTarget.mutate({ programId, type: "site", siteId: Number(targetId) });
    else if (targetType === "section") addTarget.mutate({ programId, type: "section", sectionId: Number(targetId) });
    else addTarget.mutate({ programId, type: "asset", assetId: Number(targetId) });
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[420px_1fr]">
      <Card>
        <CardHeader><CardTitle className="text-lg">{p("برامج الصيانة")}</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3 rounded-lg border p-3">
            <div>
              <Label>{p("عنوان البرنامج — اختياري")}</Label>
              <Input className="mt-1" value={programTitle} onChange={e => setProgramTitle(e.target.value)} maxLength={200} placeholder={p("مثال: صيانة التكييف الدورية للمناطق العامة")} />
              <div className="mt-1 text-xs text-muted-foreground">{p("إذا تركته فارغًا سيظهر البرنامج برقم البرنامج فقط.")}</div>
            </div>
            <div><Label>{p("الفريق")}</Label><select className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm" value={teamId} onChange={e => setTeamId(e.target.value)}><option value="">{p("اختر فريقًا")}</option>{(teamsQuery.data ?? []).filter((x: any) => Number(x.isActive) === 1).map((team: any) => <option key={team.id} value={team.id}>{team.code} — {team.specialtyName}</option>)}</select></div>
            <div><Label>{p("قائمة الصيانة")}</Label><select className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm" value={checklistId} onChange={e => setChecklistId(e.target.value)}><option value="">{p("اختر قائمة")}</option>{(checklistsQuery.data ?? []).map((item: any) => <option key={item.id} value={item.id}>{programChecklistName(item)}</option>)}</select></div>
            <div>
              <Label>{p("المدة التقديرية للمهمة (دقيقة) — اختياري")}</Label>
              <Input className="mt-1" type="number" min={1} step={1} value={estimatedDurationMinutes} onChange={e => setEstimatedDurationMinutes(e.target.value)} placeholder={p("مثال: 120")} />
              {estimatedDurationMinutes && Number(estimatedDurationMinutes) > 0 && <div className="mt-1 text-xs text-muted-foreground">≈ {formatEstimatedDuration(estimatedDurationMinutes, language)}</div>}
            </div>
            <Button className="w-full" disabled={!teamId || !checklistId || createProgram.isPending} onClick={() => {
              const durationText = estimatedDurationMinutes.trim();
              if (durationText && (!/^\d+$/.test(durationText) || Number(durationText) < 1)) { toast.error(p("المدة التقديرية يجب أن تكون عدد دقائق صحيحًا 1 أو أكثر")); return; }
              createProgram.mutate({ title: programTitle.trim() || null, teamId: Number(teamId), checklistId: Number(checklistId), estimatedDurationMinutes: durationText ? Number(durationText) : null });
            }}>{p("إنشاء برنامج")}</Button>
          </div>
          <div className="space-y-2">
            <Input value={programSearch} onChange={e => { setProgramSearch(e.target.value); setProgramPage(1); }} placeholder={p("بحث في البرامج")} />
            <div className="grid gap-2 sm:grid-cols-2">
              <select className="h-10 rounded-md border bg-background px-3 text-sm" value={programTeamFilter} onChange={e => { setProgramTeamFilter(e.target.value); setProgramPage(1); }}><option value="">{p("كل الفرق")}</option>{(teamsQuery.data ?? []).filter((x: any) => Number(x.isActive) === 1).map((team: any) => <option key={team.id} value={team.id}>{team.code}</option>)}</select>
              <select className="h-10 rounded-md border bg-background px-3 text-sm" value={programStatus} onChange={e => { setProgramStatus(e.target.value); setProgramPage(1); }}><option value="active">{p("الفعال")}</option><option value="inactive">{p("المعطل")}</option><option value="all">{p("الكل")}</option></select>
            </div>
            {visiblePrograms.length === 0 ? <EmptyState text={p("لا توجد برامج مطابقة")} /> : visiblePrograms.map((program: any) => (
              <button key={program.id} className={`w-full rounded-lg border p-3 text-start ${String(program.id) === selectedProgramId ? "border-primary bg-primary/5" : ""}`} onClick={() => { setSelectedProgramId(String(program.id)); setTargetId(""); }}>
                <div className="flex items-center justify-between gap-2"><span className="font-medium">{localizedProgramTitle(program)?.trim() || `${p("برنامج محدد")} #${program.id}`}</span>{activeBadge(program.isActive)}</div>
                {localizedProgramTitle(program)?.trim() && <div className="mt-1 text-xs text-muted-foreground">{p("برنامج محدد")} #{program.id}</div>}
                <div className="mt-1 text-xs text-muted-foreground">{program.teamCode} — {programChecklistTranslations[Number(program.checklistId)]?.name || program.checklistName}</div>
                <div className="mt-1 text-xs text-muted-foreground">{p("المدة")}: {formatEstimatedDuration(program.estimatedDurationMinutes, language)}</div>
              </button>
            ))}
            <SimplePager page={programPage} totalPages={programPages} onPage={setProgramPage} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-lg">{p("أهداف البرنامج")}</CardTitle></CardHeader>
        <CardContent>
          {!selectedProgramId ? <EmptyState text={p("اختر برنامجًا أولًا")} /> : (
            <div className="space-y-5">
              {programQuery.data?.program && (
                <div className="space-y-3 rounded-lg bg-muted/40 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="font-medium">{programTranslations[Number(programQuery.data.program.id)]?.title || (programQuery.data.program as any).title?.trim() || `${p("برنامج محدد")} #${programQuery.data.program.id}`}</div>
                      {(programTranslations[Number(programQuery.data.program.id)]?.title || (programQuery.data.program as any).title?.trim()) && <div className="mt-1 text-xs text-muted-foreground">{p("برنامج محدد")} #{programQuery.data.program.id}</div>}
                      <div className="mt-1 text-xs text-muted-foreground">{p("المدة التقديرية:")} {formatEstimatedDuration((programQuery.data.program as any).estimatedDurationMinutes, language)}</div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={() => setEditingProgram(value => !value)}>{editingProgram ? p("إلغاء التعديل") : p("تعديل البرنامج")}</Button>
                      <Button size="sm" variant="outline" onClick={() => updateProgram.mutate({ id: programQuery.data!.program.id, isActive: Number(programQuery.data!.program.isActive) !== 1 })}>{Number(programQuery.data.program.isActive) === 1 ? p("تعطيل البرنامج") : p("إعادة تفعيله")}</Button>
                    </div>
                  </div>
                  {editingProgram && (
                    <div className="grid gap-3 rounded-lg border bg-background p-4 md:grid-cols-2">
                      <div className="md:col-span-2">
                        <Label>{p("عنوان البرنامج — اختياري")}</Label>
                        <Input className="mt-1" value={editProgramTitle} onChange={e => setEditProgramTitle(e.target.value)} maxLength={200} placeholder={`${p("برنامج محدد")} #${programQuery.data.program.id}`} />
                        <div className="mt-1 text-xs text-muted-foreground">{p("يمكن تعديله حتى بعد توليد المهام لأنه لا يغيّر التاريخ التشغيلي.")}</div>
                      </div>
                      <div>
                        <Label>{p("الفريق")}</Label>
                        <select className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm" value={editTeamId} onChange={e => setEditTeamId(e.target.value)}>
                          <option value="">{p("اختر فريقًا")}</option>
                          {(teamsQuery.data ?? []).filter((x: any) => Number(x.isActive) === 1 || Number(x.id) === Number(editTeamId)).map((team: any) => <option key={team.id} value={team.id}>{team.code} — {team.specialtyName}</option>)}
                        </select>
                      </div>
                      <div>
                        <Label>{p("قائمة الصيانة")}</Label>
                        <select className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm" value={editChecklistId} onChange={e => setEditChecklistId(e.target.value)}>
                          <option value="">{p("اختر قائمة")}</option>
                          {(checklistsQuery.data ?? []).map((item: any) => <option key={item.id} value={item.id}>{programChecklistName(item)}</option>)}
                        </select>
                      </div>
                      <div className="md:col-span-2">
                        <Label>{p("المدة التقديرية للمهمة (دقيقة)")}</Label>
                        <Input className="mt-1" type="number" min={1} step={1} value={editEstimatedDurationMinutes} onChange={e => setEditEstimatedDurationMinutes(e.target.value)} placeholder={p("مثال: 120")} />
                        <div className="mt-1 text-xs text-muted-foreground">{editEstimatedDurationMinutes && Number(editEstimatedDurationMinutes) > 0 ? `${p("تعادل تقريبًا")} ${formatEstimatedDuration(editEstimatedDurationMinutes, language)}` : p("اتركها فارغة إذا لم ترغب بتحديد مدة الآن")}</div>
                      </div>
                      <div className="md:col-span-2 flex flex-wrap items-center justify-between gap-2">
                        <span className="text-xs text-muted-foreground">{p("تغيير الفريق أو القائمة قد لا يكون مسموحًا بعد بدء توليد مهام البرنامج؛ تعديل المدة يبقى متاحًا.")}</span>
                        <Button disabled={updateProgram.isPending || !editTeamId || !editChecklistId} onClick={saveProgramEdits}>{p("حفظ التعديلات")}</Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
              <div className="grid gap-3 rounded-lg border p-4 md:grid-cols-3">
                <div><Label>{p("نوع الهدف")}</Label><select className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm" value={targetType} onChange={e => { setTargetType(e.target.value); setTargetId(""); }}><option value="site">{p("موقع")}</option><option value="section">{p("قسم")}</option><option value="asset">{p("أصل")}</option></select></div>
                <div className="md:col-span-2"><Label>{p("الهدف")}</Label><select className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm" value={targetId} onChange={e => setTargetId(e.target.value)} disabled={targetOptions.length === 0}><option value="">{targetOptions.length === 0 ? p("لا توجد أهداف غير مرتبطة من هذا النوع") : p("اختر الهدف من البيانات الحالية")}</option>{targetOptions.map((item: any) => <option key={item.id} value={item.id}>{targetOptionLabel(item)}</option>)}</select></div>
                <Button className="md:col-span-3" disabled={!targetId || addTarget.isPending} onClick={submitTarget}>{p("ربط الهدف")}</Button>
              </div>
              <div className="space-y-2">
                {(programQuery.data?.targets ?? []).length === 0 ? <EmptyState text={p("لا توجد أهداف مرتبطة بهذا البرنامج")} /> : (programQuery.data?.targets ?? []).map((target: any) => (
                  <div key={target.id} className="rounded-lg border p-3">
                    <div className="font-medium">{target.siteName ? `${p("موقع")}: ${target.siteName}` : target.sectionName ? `${p("قسم")}: ${target.sectionName}` : `${p("أصل")}: ${target.assetName || `#${target.assetId}`}`}</div>
                    <div className="text-xs text-muted-foreground">{p("هدف")} #{target.programId}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}


function WorkloadTab({ onOpenOverdue }: { onOpenOverdue: (teamId: string) => void }) {
  const { p, language, dir } = usePmv2Text();
  const weekdayOptions = weekdayOptionsFor(language);
  const today = riyadhToday();
  const currentWeek = weekRange(today);
  const teamsQuery = trpc.pmv2.organization.teams.list.useQuery();
  const [weekStart, setWeekStart] = useState(currentWeek.from);
  const [teamFilter, setTeamFilter] = useState("");
  const [currentWeekMode, setCurrentWeekMode] = useState<"remaining" | "full">("remaining");
  const [selectedCell, setSelectedCell] = useState<{ teamId: number; teamCode: string; date: string } | null>(null);

  const weekEnd = addDaysIso(weekStart, 6);
  const isCurrentWeek = weekStart === currentWeek.from;
  const allWeekDays = useMemo(() => Array.from({ length: 7 }, (_, index) => addDaysIso(weekStart, index)), [weekStart]);
  const displayedDays = useMemo(
    () => isCurrentWeek && currentWeekMode === "remaining" ? allWeekDays.filter(date => date >= today) : allWeekDays,
    [allWeekDays, currentWeekMode, isCurrentWeek, today],
  );
  const selectedTeamId = teamFilter ? Number(teamFilter) : undefined;

  const workloadQuery = trpc.pmv2.tasks.dailyWorkload.useQuery({
    dateFrom: weekStart,
    dateTo: weekEnd,
    teamId: selectedTeamId,
  });
  const overdueCountQuery = trpc.pmv2.tasks.list.useQuery({
    page: 1,
    pageSize: 1,
    teamId: selectedTeamId,
    overdueBefore: today,
    excludeFinished: true,
  }, { enabled: isCurrentWeek });

  const selectedTasksQuery = trpc.pmv2.tasks.list.useQuery(
    selectedCell
      ? {
          page: 1,
          pageSize: 50,
          teamId: selectedCell.teamId,
          dateFrom: selectedCell.date,
          dateTo: selectedCell.date,
          excludeCancelled: true,
        }
      : undefined,
    { enabled: !!selectedCell },
  );

  const activeTeams = (teamsQuery.data ?? []).filter((team: any) => Number(team.isActive) === 1);
  const visibleTeams = teamFilter
    ? activeTeams.filter((team: any) => Number(team.id) === Number(teamFilter))
    : activeTeams;
  const workloadByKey = useMemo(() => {
    const map = new Map<string, any>();
    for (const item of workloadQuery.data?.items ?? []) {
      map.set(`${item.teamId}:${item.dueDate}`, item);
    }
    return map;
  }, [workloadQuery.data?.items]);

  const selectedTeam = selectedCell
    ? activeTeams.find((team: any) => Number(team.id) === selectedCell.teamId)
    : null;

  function moveWeek(daysOffset: number) {
    const nextWeekStart = addDaysIso(weekStart, daysOffset);
    setWeekStart(nextWeekStart);
    if (nextWeekStart === currentWeek.from) setCurrentWeekMode("remaining");
    setSelectedCell(null);
  }

  function goToCurrentWeek() {
    setWeekStart(currentWeek.from);
    setCurrentWeekMode("remaining");
    setSelectedCell(null);
  }

  function changeTeamFilter(value: string) {
    setTeamFilter(value);
    setSelectedCell(null);
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <CardTitle className="text-lg">{p("حمل الفرق")}</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">{p("نظرة أسبوعية سريعة: الماضي للمراجعة، اليوم واضح، والأيام القادمة للتخطيط.")}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => moveWeek(-7)}>{p("الأسبوع السابق")}</Button>
              <Button variant="outline" size="sm" onClick={goToCurrentWeek}>{p("هذا الأسبوع")}</Button>
              <Button variant="outline" size="sm" onClick={() => moveWeek(7)}>{p("الأسبوع التالي")}</Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 rounded-lg border bg-muted/20 p-3 lg:grid-cols-[minmax(0,1fr)_240px_auto] lg:items-end">
            <div>
              <div className="text-sm font-medium">{p("من تاريخ")} {formatShortDate(weekStart, language)} — {p("إلى تاريخ")} {formatShortDate(weekEnd, language)}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {isCurrentWeek && currentWeekMode === "remaining"
                  ? `${p("من اليوم وما بعده")}: ${formatShortDate(today, language)}`
                  : p("عرض الأسبوع كاملًا للمراجعة والتخطيط.")}
              </div>
            </div>

            <div>
              <Label htmlFor="workload-team-filter" className="text-xs">{p("الفريق")}</Label>
              <select
                id="workload-team-filter"
                className="mt-1 h-9 w-full rounded-md border bg-background px-3 text-sm"
                value={teamFilter}
                onChange={event => changeTeamFilter(event.target.value)}
              >
                <option value="">{p("كل الفرق")}</option>
                {activeTeams.map((team: any) => (
                  <option key={team.id} value={team.id}>{team.code}{team.specialtyName ? ` — ${team.specialtyName}` : ""}</option>
                ))}
              </select>
            </div>

            {isCurrentWeek ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant={currentWeekMode === "remaining" ? "default" : "outline"}
                  onClick={() => { setCurrentWeekMode("remaining"); setSelectedCell(null); }}
                >
                  {p("من اليوم وما بعده")}
                </Button>
                <Button
                  size="sm"
                  variant={currentWeekMode === "full" ? "default" : "outline"}
                  onClick={() => setCurrentWeekMode("full")}
                >
                  {p("الأسبوع كامل")}
                </Button>
              </div>
            ) : (
              <div className="text-xs text-muted-foreground">{p("الأسابيع السابقة والقادمة تُعرض كاملة.")}</div>
            )}
          </div>

          {isCurrentWeek && (overdueCountQuery.data?.total ?? 0) > 0 && (
            <button
              type="button"
              className="w-full rounded-lg border border-amber-200 bg-amber-50/70 p-3 text-start text-sm text-amber-950 transition hover:bg-amber-100/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50"
              onClick={() => onOpenOverdue(teamFilter)}
            >
              <div className="font-medium">
                {overdueCountQuery.data?.total} {(overdueCountQuery.data?.total ?? 0) === 1 ? p("مهمة متأخرة") : p("مهام متأخرة")}{teamFilter ? ` ${p("للفريق المحدد")}` : ""}.
              </div>
              <div className="mt-1 text-xs text-amber-900/80">
                {p("تبقى بتاريخها الأصلي ولا تُضاف تلقائيًا إلى حمل اليوم. اضغط لعرضها مباشرة في «المهام المجدولة ← المتأخرة».")}
              </div>
            </button>
          )}

          <div className="flex flex-wrap items-center gap-2 text-xs">
            {["available", "medium", "high", "conflict"].map(status => { const label = workloadStatusLabel(status, language); return (
              <span key={status} className={`rounded-full border px-2 py-1 ${workloadStatusClasses[status]}`}>{label}</span>
            ); })}
            <span className="rounded-full border bg-muted px-2 py-1 text-muted-foreground">{p("مدة ناقصة = يوجد مهام بلا مدة تقديرية")}</span>
          </div>

          {workloadQuery.isError ? (
            <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              {p("تعذر تحميل حمل الفرق")}: {localizeApiError(workloadQuery.error.message)}
            </div>
          ) : visibleTeams.length === 0 ? (
            <EmptyState text={p("لا توجد فرق فعالة لعرض حملها")} />
          ) : (
            <div className="overflow-x-auto rounded-xl border">
              <table className="w-full min-w-[760px] border-collapse text-sm">
                <thead>
                  <tr className="bg-muted/40">
                    <th className={`sticky z-10 min-w-[180px] border-b bg-muted/40 p-3 text-start font-medium ${dir === "rtl" ? "right-0 border-l" : "left-0 border-r"}`}>{p("الفريق")}</th>
                    {displayedDays.map(date => {
                      const dayIndex = new Date(`${date}T00:00:00Z`).getUTCDay();
                      const dayName = weekdayOptions.find(day => Number(day.value) === dayIndex)?.label ?? "";
                      const isPast = isCurrentWeek && date < today;
                      const isToday = date === today;
                      return (
                        <th
                          key={date}
                          className={`min-w-[115px] border-b p-3 text-center font-medium ${dir === "rtl" ? "border-l" : "border-r"} ${isToday ? "bg-primary/10 ring-1 ring-inset ring-primary/20" : isPast ? "bg-muted/20 text-muted-foreground opacity-60" : ""}`}
                        >
                          <div>{dayName}{isToday ? ` • ${p("اليوم")}` : ""}</div>
                          <div className="mt-1 text-xs font-normal text-muted-foreground">{formatShortDate(date, language)}</div>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {visibleTeams.map((team: any) => (
                    <tr key={team.id} className="border-b last:border-b-0">
                      <td className={`sticky z-10 bg-card p-3 align-top ${dir === "rtl" ? "right-0 border-l" : "left-0 border-r"}`}>
                        <div className="font-medium">{team.code}</div>
                        <div className="mt-1 text-xs text-muted-foreground">{team.specialtyId ? <EntityTranslatedText entityType="PMV2_SPECIALTY" entityId={Number(team.specialtyId)} field="name" original={team.specialtyName || p("بدون تخصص")} /> : (team.specialtyName || p("بدون تخصص"))}</div>
                      </td>
                      {displayedDays.map(date => {
                        const item = workloadByKey.get(`${team.id}:${date}`);
                        const isPast = isCurrentWeek && date < today;
                        const isToday = date === today;
                        const dayCellClass = isToday ? "bg-primary/[0.03]" : isPast ? "bg-muted/10 opacity-60" : "";
                        if (!item) {
                          return (
                            <td key={date} className={`${dir === "rtl" ? "border-l" : "border-r"} p-2 text-center align-middle ${dayCellClass}`}>
                              <div className="rounded-lg border border-dashed px-2 py-4 text-xs text-muted-foreground">{p("لا مهام")}</div>
                            </td>
                          );
                        }

                        const incomplete = !item.estimateComplete;
                        const statusClass = incomplete
                          ? "border-slate-200 bg-slate-50 text-slate-700"
                          : workloadStatusClasses[item.status] ?? "border-muted bg-muted/20";
                        const statusLabel = incomplete ? p("مدة ناقصة") : workloadStatusLabel(item.status, language);

                        return (
                          <td key={date} className={`${dir === "rtl" ? "border-l" : "border-r"} p-2 align-middle ${dayCellClass}`}>
                            <button
                              className={`w-full rounded-lg border p-2 text-start transition hover:brightness-[0.98] ${statusClass} ${selectedCell?.teamId === Number(team.id) && selectedCell.date === date ? "ring-2 ring-primary/30" : ""}`}
                              onClick={() => setSelectedCell({ teamId: Number(team.id), teamCode: team.code, date })}
                            >
                              <div className="font-semibold">{item.taskCount} {item.taskCount === 1 ? p("مهمة") : p("مهام")}</div>
                              <div className="mt-1 text-xs">{formatCompactDuration(item.totalEstimatedMinutes, language)}</div>
                              <div className="mt-2 text-[11px] font-medium">{statusLabel}</div>
                              {item.unknownDurationTaskCount > 0 && (
                                <div className="mt-1 text-[10px] opacity-80">{item.unknownDurationTaskCount} {p("بدون مدة")}</div>
                              )}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base">{p("مهام اليوم المختار")}</CardTitle>
            {selectedCell && (
              <span className="text-sm text-muted-foreground">
                {selectedCell.teamCode} — {formatShortDate(selectedCell.date, language)}
              </span>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {!selectedCell ? (
            <EmptyState text={p("اضغط على يوم يحتوي مهامًا لعرض تفاصيله هنا")} />
          ) : selectedTasksQuery.isError ? (
            <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              {p("تعذر تحميل مهام اليوم")}: {localizeApiError(selectedTasksQuery.error.message)}
            </div>
          ) : (selectedTasksQuery.data?.items ?? []).length === 0 ? (
            <EmptyState text={p("لا توجد مهام غير ملغاة لهذا الفريق في اليوم المختار")} />
          ) : (
            <div className="space-y-2">
              {(selectedTasksQuery.data?.items ?? []).map((task: any) => (
                <div key={task.id} className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="font-medium">{task.taskNumber}</div>
                    <div className="mt-1 text-sm">{taskTargetLabel(task, language)}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{task.checklistName}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {p("المدة التقديرية:")} {task.estimatedDurationMinutes == null ? p("غير محددة") : formatCompactDuration(task.estimatedDurationMinutes, language)}
                    </div>
                  </div>
                  <Badge variant="outline">{taskStatusLabel(task.status, language)}</Badge>
                </div>
              ))}
              {(selectedTasksQuery.data?.total ?? 0) > 50 && (
                <p className="text-xs text-muted-foreground">{p("يتم عرض أول 50 مهمة من {total}.", { total: selectedTasksQuery.data?.total ?? 0 })}</p>
              )}
            </div>
          )}
          {selectedTeam && (
            <p className="mt-3 text-xs text-muted-foreground">
              {p("الفريق:")} {selectedTeam.code}{selectedTeam.specialtyName ? ` — ${selectedTeam.specialtyName}` : ""}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}


function SlaRuleEditor({ rule, onSaved }: { rule: any; onSaved: () => void }) {
  const { p, language, dir } = usePmv2Text();
  const [slaHours, setSlaHours] = useState("");
  const [reminderHours, setReminderHours] = useState("");
  const [active, setActive] = useState(true);

  useEffect(() => {
    setSlaHours(rule?.slaMinutes == null ? "" : String(Number(rule.slaMinutes) / 60));
    setReminderHours(rule?.reminderMinutes == null ? "" : String(Number(rule.reminderMinutes) / 60));
    setActive(rule?.isActive !== false);
  }, [rule?.roleKey, rule?.slaMinutes, rule?.reminderMinutes, rule?.isActive]);

  const updateRule = trpc.pmv2.monitoring.updateSlaRule.useMutation({
    onSuccess: () => {
      toast.success(p("تم حفظ SLA — {label}", { label: pmv2Text(language, rule.label) }));
      onSaved();
    },
    onError: error => toast.error(localizeApiError(error.message)),
  });

  const toMinutes = (value: string) => {
    if (!value.trim()) return null;
    const hours = Number(value);
    if (!Number.isFinite(hours) || hours <= 0) return null;
    return Math.max(1, Math.round(hours * 60));
  };

  return (
    <div className="grid gap-2 rounded-lg border p-3 md:grid-cols-[minmax(180px,1fr)_140px_140px_100px_90px] md:items-end">
      <div>
        <div className="font-medium">{rule.label}</div>
        <div className="mt-1 text-xs text-muted-foreground">{rule.roleKey}</div>
      </div>
      <div>
        <Label className="text-xs">{p("SLA بالساعات")}</Label>
        <Input type="number" min="0.25" step="0.25" value={slaHours} onChange={e => setSlaHours(e.target.value)} placeholder={p("غير محدد")} />
      </div>
      <div>
        <Label className="text-xs">{p("تذكير بعد ساعات")}</Label>
        <Input type="number" min="0.25" step="0.25" value={reminderHours} onChange={e => setReminderHours(e.target.value)} placeholder={p("بدون تذكير")} />
      </div>
      <label className="flex h-10 items-center gap-2 rounded-md border px-3 text-sm">
        <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} /> {p("فعال")}
      </label>
      <Button size="sm" disabled={updateRule.isPending} onClick={() => updateRule.mutate({ roleKey: rule.roleKey, slaMinutes: toMinutes(slaHours), reminderMinutes: toMinutes(reminderHours), isActive: active })}>{p("حفظ")}</Button>
    </div>
  );
}

function MonitoringTaskCard({
  item,
  selectedTaskId,
  onSelect,
  urgent = false,
}: {
  item: any;
  selectedTaskId: number | null;
  onSelect: (taskId: number) => void;
  urgent?: boolean;
}) {
  const { p, language, dir } = usePmv2Text();
  const current = item.currentResponsibility;
  return (
    <div className={`rounded-xl border p-4 ${urgent ? "border-red-200 bg-red-50/40" : "bg-background"}`}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-base font-semibold">{item.taskNumber}</span>
            {slaBadge(item.sla, language)}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            <EntityTranslatedText entityType="PMV2_CHECKLIST" entityId={Number(item.checklistId)} field="name" original={item.checklistName} /> · {item.teamCode}{item.assetName ? ` · ${item.assetName}` : ""}
          </div>
        </div>
        <Button size="sm" variant={selectedTaskId === item.id ? "default" : "outline"} onClick={() => onSelect(item.id)}>
          <Eye className="ms-1 h-4 w-4" />{p("عرض المسار")}
        </Button>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div>
          <div className="text-xs text-muted-foreground">{p("سبب التعليق / الحالة")}</div>
          <div className="mt-1 text-sm font-medium">{current?.reason ? localizePmv2ServerText(language, current.reason) : taskStatusLabel(item.status, language)}</div>
          <div className="mt-1 text-xs text-muted-foreground">{taskStatusLabel(item.status, language)}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">{p("المرحلة الحالية")}</div>
          <div className="mt-1 text-sm font-medium">{current?.stageLabel ? localizePmv2ServerText(language, current.stageLabel) : p("بانتظار بدء الفريق")}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">{p("المسؤول الحالي")}</div>
          <div className="mt-1 text-sm font-medium">{current?.roleLabel ? localizePmv2ServerText(language, current.roleLabel) : p("فريق الصيانة")}</div>
          <div className="mt-1 text-xs">{current?.responsibleUserName || p("لا يوجد شخص معيّن")}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">{p("المدة")}</div>
          <div className="mt-1 text-sm"><span className="font-medium">{p("عنده منذ:")}</span> {item.currentMinutes == null ? "—" : formatCompactDuration(item.currentMinutes, language)}</div>
          <div className="mt-1 text-xs text-muted-foreground">{p("عمر المهمة:")} {formatCompactDuration(item.summary?.totalAgeMinutes || 0, language)}</div>
        </div>
      </div>
    </div>
  );
}

function MonitoringTab({ userRole }: { userRole?: string | null }) {
  const { p, language, dir } = usePmv2Text();
  const overviewQuery = trpc.pmv2.monitoring.overview.useQuery(undefined, { refetchInterval: 60_000 });
  const rulesQuery = trpc.pmv2.monitoring.slaRules.useQuery();
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);
  const detailQuery = trpc.pmv2.monitoring.taskDetail.useQuery(
    { taskId: selectedTaskId || 0 },
    { enabled: !!selectedTaskId, refetchInterval: selectedTaskId ? 60_000 : false },
  );
  const alertSweep = trpc.pmv2.monitoring.runAlertSweep.useMutation({
    onSuccess: data => toast.success(p("تم فحص {checked} مهمة — أُنشئ {delivered} تنبيه جديد", { checked: data.checkedTasks, delivered: data.delivered })),
    onError: error => toast.error(localizeApiError(error.message)),
  });

  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [personFilter, setPersonFilter] = useState("all");
  const [teamFilter, setTeamFilter] = useState("all");
  const [slaFilter, setSlaFilter] = useState("all");

  const overview = overviewQuery.data;
  const owner = overview?.owner;
  const items = overview?.items ?? [];
  const isOwnerView = userRole === "owner" || userRole === "admin";

  const roles = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of items) {
      const current = item.currentResponsibility;
      if (current?.roleKey) map.set(current.roleKey, current.roleLabel || current.roleKey);
    }
    return [...map.entries()].map(([key, label]) => ({ key, label })).sort((a, b) => a.label.localeCompare(b.label, "ar"));
  }, [items]);

  const people = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of items) {
      const current = item.currentResponsibility;
      if (current?.responsibleUserId && current?.responsibleUserName) map.set(String(current.responsibleUserId), current.responsibleUserName);
    }
    return [...map.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "ar"));
  }, [items]);

  const teams = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of items) map.set(String(item.teamId), String(item.teamCode));
    return [...map.entries()].map(([id, code]) => ({ id, code })).sort((a, b) => a.code.localeCompare(b.code));
  }, [items]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((item: any) => {
      const current = item.currentResponsibility;
      const haystack = [item.taskNumber, item.checklistName, item.teamCode, item.specialtyName, item.siteName, item.sectionName, item.assetName, current?.reason, current?.stageLabel, current?.roleLabel, current?.responsibleUserName].filter(Boolean).join(" ").toLowerCase();
      if (q && !haystack.includes(q)) return false;
      if (roleFilter !== "all" && current?.roleKey !== roleFilter) return false;
      if (personFilter !== "all" && String(current?.responsibleUserId || "") !== personFilter) return false;
      if (teamFilter !== "all" && String(item.teamId) !== teamFilter) return false;
      if (slaFilter !== "all" && item.sla?.status !== slaFilter) return false;
      return true;
    });
  }, [items, search, roleFilter, personFilter, teamFilter, slaFilter]);

  const needsManagerIntervention = (item: any) => item.sla?.status === "overdue" || item.currentResponsibility?.roleKey === "maintenance_manager";
  const interventionItems = useMemo(() => filtered
    .filter(needsManagerIntervention)
    .sort((a: any, b: any) => Number(b.sla?.breachMinutes || 0) - Number(a.sla?.breachMinutes || 0) || Number(b.currentMinutes || 0) - Number(a.currentMinutes || 0)), [filtered]);
  const underActionItems = useMemo(() => filtered
    .filter((item: any) => !needsManagerIntervention(item))
    .sort((a: any, b: any) => Number(b.currentMinutes || 0) - Number(a.currentMinutes || 0)), [filtered]);
  const totalInterventionCount = useMemo(() => items.filter(needsManagerIntervention).length, [items]);
  const oldestBlockedMinutes = useMemo(() => {
    const blockedStatuses = new Set(["waiting_material", "waiting_ticket", "ready_to_complete"]);
    return items
      .filter((item: any) => blockedStatuses.has(String(item.status)))
      .reduce((max: number, item: any) => Math.max(max, Number(item.currentMinutes ?? item.summary?.totalAgeMinutes ?? 0)), 0);
  }, [items]);
  const hasAdvancedFilters = roleFilter !== "all" || personFilter !== "all" || teamFilter !== "all" || slaFilter !== "all";

  const selected = detailQuery.data;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 rounded-xl border bg-muted/20 p-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex items-center gap-2 font-semibold"><Clock3 className="h-5 w-5 text-primary" />{p("متابعة المهام المعلقة")}</div>
          <p className="mt-1 text-sm text-muted-foreground">{p("ابدأ بما يحتاج تدخلك الآن، ثم راقب بقية المهام واعرف من بيده الإجراء الآن. التفاصيل الكاملة تبقى في مسار المهمة.")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => overviewQuery.refetch()} disabled={overviewQuery.isFetching}><RefreshCcw className="ms-1 h-4 w-4" />{p("تحديث")}</Button>
          <Button size="sm" variant="outline" onClick={() => alertSweep.mutate()} disabled={alertSweep.isPending}><BellRing className="ms-1 h-4 w-4" />{p("فحص التنبيهات الآن")}</Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">{p("المهام المعلقة")}</div><div className="mt-1 text-2xl font-bold">{owner?.blockedTasks ?? 0}</div><div className="mt-1 text-xs text-muted-foreground">{p("من أصل {open} مهمة مفتوحة", { open: owner?.openTasks ?? 0 })}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">{p("تحتاج تدخلك الآن")}</div><div className="mt-1 text-2xl font-bold">{totalInterventionCount}</div><div className="mt-1 text-xs text-muted-foreground">{p("تجاوز SLA أو الإجراء لدى مدير الصيانة")}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">{p("تجاوز SLA")}</div><div className="mt-1 text-2xl font-bold text-red-700">{owner?.slaBreaches ?? 0}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">{p("أقدم تعليق")}</div><div className="mt-1 text-2xl font-bold">{oldestBlockedMinutes ? formatCompactDuration(oldestBlockedMinutes, language) : "—"}</div></CardContent></Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">{p("البحث والمتابعة")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder={p("بحث بالمهمة أو الأصل أو المسؤول")} />
          <details className="rounded-lg border p-3" open={hasAdvancedFilters || undefined}>
            <summary className="cursor-pointer text-sm font-medium">{p("بحث وفلاتر متقدمة")}{hasAdvancedFilters ? ` — ${p("مفعّلة")}` : ""}</summary>
            <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
              <select className="h-10 rounded-md border bg-background px-3 text-sm" value={roleFilter} onChange={e => setRoleFilter(e.target.value)}><option value="all">{p("كل الجهات")}</option>{roles.map(row => <option key={row.key} value={row.key}>{row.label}</option>)}</select>
              <select className="h-10 rounded-md border bg-background px-3 text-sm" value={personFilter} onChange={e => setPersonFilter(e.target.value)}><option value="all">{p("كل المسؤولين")}</option>{people.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select>
              <select className="h-10 rounded-md border bg-background px-3 text-sm" value={teamFilter} onChange={e => setTeamFilter(e.target.value)}><option value="all">{p("كل الفرق")}</option>{teams.map(row => <option key={row.id} value={row.id}>{row.code}</option>)}</select>
              <select className="h-10 rounded-md border bg-background px-3 text-sm" value={slaFilter} onChange={e => setSlaFilter(e.target.value)}><option value="all">{p("كل حالات SLA")}</option><option value="overdue">{p("متجاوز SLA")}</option><option value="within">{p("ضمن SLA")}</option><option value="not_configured">{p("SLA غير محدد")}</option></select>
            </div>
          </details>
        </CardContent>
      </Card>

      {overviewQuery.isLoading ? <EmptyState text={p("جارٍ تحميل متابعة المهام...")} /> : filtered.length === 0 ? <EmptyState text={p("لا توجد مهام مطابقة")} /> : (
        <>
          <Card className="border-red-200">
            <CardHeader className="pb-3">
              <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-lg">
                <span>{p("تحتاج تدخلك الآن")}</span>
                <Badge className="border-red-200 bg-red-50 text-red-800 hover:bg-red-50">{interventionItems.length}</Badge>
              </CardTitle>
              <p className="text-sm text-muted-foreground">{p("تظهر هنا المهام التي تجاوزت SLA أو أصبح الإجراء الحالي لدى مدير الصيانة مباشرة.")}</p>
            </CardHeader>
            <CardContent>
              {interventionItems.length === 0 ? <EmptyState text={p("لا توجد مهام تحتاج تدخلًا مباشرًا وفق القواعد الحالية")} /> : (
                <div className="space-y-3">{interventionItems.map((item: any) => <MonitoringTaskCard key={item.id} item={item} selectedTaskId={selectedTaskId} onSelect={setSelectedTaskId} urgent />)}</div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-lg">
                <span>{p("معلقة وتحت الإجراء")}</span>
                <Badge variant="secondary">{underActionItems.length}</Badge>
              </CardTitle>
              <p className="text-sm text-muted-foreground">{p("بقية المهام المفتوحة؛ اعرف عند من الإجراء ومدة بقائها لديه دون قراءة جدول مزدحم.")}</p>
            </CardHeader>
            <CardContent>
              {underActionItems.length === 0 ? <EmptyState text={p("لا توجد مهام أخرى تحت الإجراء ضمن الفلاتر الحالية")} /> : (
                <div className="space-y-3">{underActionItems.map((item: any) => <MonitoringTaskCard key={item.id} item={item} selectedTaskId={selectedTaskId} onSelect={setSelectedTaskId} />)}</div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {selectedTaskId && (
        <Card>
          <CardHeader><CardTitle className="flex items-center justify-between gap-3 text-lg"><span>{p("مسار المهمة {task}", { task: selected?.timeline?.task?.taskNumber || `#${selectedTaskId}` })}</span><Button size="sm" variant="ghost" onClick={() => setSelectedTaskId(null)}>{p("إغلاق")}</Button></CardTitle></CardHeader>
          <CardContent className="space-y-5">
            {detailQuery.isLoading ? <EmptyState text={p("جارٍ تحميل المسار...")} /> : !selected ? <EmptyState text={p("تعذر تحميل المهمة")} /> : (
              <>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                  <div className="rounded-lg border p-3"><div className="text-xs text-muted-foreground">{p("عمر المهمة")}</div><div className="mt-1 font-semibold">{formatCompactDuration(selected.timeline.summary.totalAgeMinutes, language)}</div></div>
                  <div className="rounded-lg border p-3"><div className="text-xs text-muted-foreground">{p("تنفيذ فعلي")}</div><div className="mt-1 font-semibold">{formatCompactDuration(selected.timeline.summary.actualWorkMinutes, language)}</div></div>
                  <div className="rounded-lg border p-3"><div className="text-xs text-muted-foreground">{p("انتظار مواد")}</div><div className="mt-1 font-semibold">{formatCompactDuration(selected.timeline.summary.waitingMaterialMinutes, language)}</div></div>
                  <div className="rounded-lg border p-3"><div className="text-xs text-muted-foreground">{p("انتظار بلاغ")}</div><div className="mt-1 font-semibold">{formatCompactDuration(selected.timeline.summary.waitingTicketMinutes, language)}</div></div>
                  <div className="rounded-lg border p-3"><div className="text-xs text-muted-foreground">{p("انتظار استكمال الفني")}</div><div className="mt-1 font-semibold">{formatCompactDuration(selected.timeline.summary.waitingResumeMinutes, language)}</div></div>
                </div>

                <div>
                  <div className="mb-2 font-semibold">{p("تفصيل مراحل المهمة والمسؤولية")}</div>
                  <div className="overflow-x-auto rounded-lg border">
                    <table className="w-full min-w-[900px] text-sm"><thead className="bg-muted/60 text-xs"><tr><th className="p-3 text-start">{p("البند")}</th><th className="p-3 text-start">{p("المرحلة")}</th><th className="p-3 text-start">{p("الجهة / المسؤول")}</th><th className="p-3 text-start">{p("بدأت")}</th><th className="p-3 text-start">{p("انتهت")}</th><th className="p-3 text-start">{p("المدة")}</th></tr></thead><tbody>
                      {selected.timeline.stageSegments.map((segment: any) => <tr key={segment.id} className="border-t"><td className="p-3"><EntityTranslatedText entityType="PMV2_TASK_ITEM" entityId={Number(segment.taskItemId)} field="titleSnapshot" original={segment.taskItemTitle} /></td><td className="p-3">{localizePmv2ServerText(language, segment.stageLabel)}{segment.isOpen ? <Badge className="me-2" variant="secondary">{p("الحالية")}</Badge> : null}</td><td className="p-3">{localizePmv2ServerText(language, segment.roleLabel)}{segment.responsibleUserName ? ` — ${segment.responsibleUserName}` : ""}</td><td className="p-3">{formatDateTime(segment.startedAt, language)}</td><td className="p-3">{segment.endedAt ? formatDateTime(segment.endedAt, language) : p("الآن")}</td><td className="p-3 font-medium">{formatCompactDuration(segment.durationMinutes, language)}</td></tr>)}
                    </tbody></table>
                  </div>
                </div>

                <div>
                  <div className="mb-2 font-semibold">{p("الوقت حسب الجهة / الشخص")}</div>
                  <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">{selected.timeline.responsibilityDurations.map((row: any, index: number) => <div key={`${row.roleKey}-${row.responsibleUserId || index}`} className="flex justify-between gap-3 rounded-lg border p-3 text-sm"><span>{localizePmv2ServerText(language, row.roleLabel)}{row.responsibleUserName ? ` — ${row.responsibleUserName}` : ""}</span><span className="font-semibold">{formatCompactDuration(row.durationMinutes, language)}</span></div>)}</div>
                </div>

                <details className="rounded-lg border p-3">
                  <summary className="cursor-pointer font-semibold">{p("الأحداث التفصيلية للمهمة")}</summary>
                  <div className="mt-3 space-y-2">{selected.timeline.events.map((event: any) => <div key={event.id} className="rounded-md bg-muted/40 p-3 text-sm"><Pmv2LocalizedTimelineText className="font-medium" value={event.label} taskItemId={event.taskItemId} taskItemTitle={event.taskItemTitle} /><div className="mt-1 text-xs text-muted-foreground">{formatDateTime(event.at, language)}{event.actorUserName ?  ` · ${p("بواسطة {name}", { name: event.actorUserName })}` : ""}{event.roleLabel ?  ` · ${localizePmv2ServerText(language, event.roleLabel)}` : ""}</div>{event.detail ? <div className="mt-1 text-xs">{String(event.id || "").startsWith("action-") ? <EntityTranslatedText entityType="PMV2_ITEM_ACTION" entityId={Number(String(event.id).replace("action-", ""))} field="note" original={event.detail} /> : <Pmv2LocalizedTimelineText value={event.detail} taskItemId={event.taskItemId} taskItemTitle={event.taskItemTitle} />}</div> : null}</div>)}</div>
                </details>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {isOwnerView && owner && (
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2 text-lg"><BarChart3 className="h-5 w-5" />{p("مؤشرات المالك التنفيذية")}</CardTitle></CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-3 md:grid-cols-5">
              <div className="rounded-lg border p-3"><div className="text-xs text-muted-foreground">{p("بانتظار مواد")}</div><div className="mt-1 text-xl font-bold">{owner.waitingMaterial}</div></div>
              <div className="rounded-lg border p-3"><div className="text-xs text-muted-foreground">{p("بانتظار بلاغ")}</div><div className="mt-1 text-xl font-bold">{owner.waitingTicket}</div></div>
              <div className="rounded-lg border p-3"><div className="text-xs text-muted-foreground">{p("جاهزة للاستكمال")}</div><div className="mt-1 text-xl font-bold">{owner.readyToComplete}</div></div>
              <div className="rounded-lg border p-3"><div className="text-xs text-muted-foreground">{p("تنفيذ فعلي / انتظار")}</div><div className="mt-1 text-sm font-semibold">{formatCompactDuration(owner.totalWorkMinutes, language)} / {formatCompactDuration(owner.totalWaitingMinutes, language)}</div></div>
              <div className="rounded-lg border p-3"><div className="text-xs text-muted-foreground">{p("متوسط عمر المهمة")}</div><div className="mt-1 text-sm font-semibold">{formatCompactDuration(owner.averageAgeMinutes, language)}</div></div>
            </div>
            <div className="grid gap-4 xl:grid-cols-2">
              <div className="rounded-lg border p-4">
                <div className="mb-3 font-semibold">{p("أين العمل عالق الآن؟")}</div>
                <div className="space-y-2">
                  {owner.byRole.length === 0 ? <EmptyState text={p("لا توجد مهام معلقة")} /> : owner.byRole.map((row: any) => (
                    <div key={row.roleKey} className="flex items-center justify-between gap-3 rounded-md bg-muted/40 px-3 py-2 text-sm">
                      <span>{localizePmv2ServerText(language, row.roleLabel)}</span><span className="font-medium">{p("{count} مهمة · متوسط {avg} · الأقدم {oldest}", { count: row.count, avg: formatCompactDuration(row.averageMinutes, language), oldest: formatCompactDuration(row.oldestMinutes, language) })}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-lg border p-4">
                <div className="mb-3 font-semibold">{p("المسؤولون الحاليون")}</div>
                <div className="space-y-2">
                  {owner.byPerson.length === 0 ? <EmptyState text={p("لا توجد تعيينات شخصية حالية")} /> : owner.byPerson.slice(0, 10).map((row: any) => (
                    <div key={row.userId} className="flex items-center justify-between gap-3 rounded-md bg-muted/40 px-3 py-2 text-sm">
                      <span>{row.name} <span className="text-xs text-muted-foreground">— {localizePmv2ServerText(language, row.roleLabel)}</span></span><span className="font-medium">{row.count} · {formatCompactDuration(row.oldestMinutes, language)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="grid gap-4 xl:grid-cols-2">
              <div className="rounded-lg border p-4">
                <div className="mb-3 font-semibold">{p("الفرق الأكثر لديها مهام مفتوحة")}</div>
                <div className="space-y-2">{owner.byTeam.slice(0, 10).map((row: any) => <div key={row.teamId} className="flex justify-between rounded-md bg-muted/40 px-3 py-2 text-sm"><span>{row.teamCode}</span><span className="font-medium">{row.count}</span></div>)}</div>
              </div>
              <div className="rounded-lg border p-4">
                <div className="mb-3 font-semibold">{p("الأصول الأكثر لديها مهام مفتوحة")}</div>
                {owner.byAsset.length === 0 ? <EmptyState text={p("لا توجد مهام مرتبطة بأصول في القائمة الحالية")} /> : <div className="space-y-2">{owner.byAsset.map((row: any) => <div key={row.assetId} className="flex justify-between rounded-md bg-muted/40 px-3 py-2 text-sm"><span>{row.assetName}</span><span className="font-medium">{row.count}</span></div>)}</div>}
              </div>
            </div>
            <div className="grid gap-4 xl:grid-cols-2">
              <div className="rounded-lg border p-4">
                <div className="mb-3 font-semibold">{p("المهام المفتوحة حسب التخصص")}</div>
                {owner.bySpecialty.length === 0 ? <EmptyState text={p("لا توجد بيانات تخصصات")} /> : <div className="space-y-2">{owner.bySpecialty.map((row: any) => <div key={row.specialtyName} className="flex justify-between gap-3 rounded-md bg-muted/40 px-3 py-2 text-sm"><span>{row.specialtyName}</span><span className="font-medium">{p("{count} مفتوحة", { count: row.count })}{row.slaBreaches ? ` · ${p("{count} تجاوز SLA", { count: row.slaBreaches })}` : ""}</span></div>)}</div>}
              </div>
              <div className="rounded-lg border p-4">
                <div className="mb-3 font-semibold">{p("توزيع الحالات المفتوحة")}</div>
                {owner.byStatus.length === 0 ? <EmptyState text={p("لا توجد مهام مفتوحة")} /> : <div className="space-y-2">{owner.byStatus.map((row: any) => <div key={row.status} className="flex justify-between rounded-md bg-muted/40 px-3 py-2 text-sm"><span>{taskStatusLabel(row.status, language)}</span><span className="font-medium">{row.count}</span></div>)}</div>}
              </div>
            </div>

            <div className="rounded-lg border p-4">
              <div className="mb-1 font-semibold">{p("إنجاز آخر 30 يومًا")}</div>
              <div className="mb-4 text-xs text-muted-foreground">{p("من تاريخ")} {owner.recent30Days.startDate} — {p("{count} مكتملة من {total} مهمة مجدولة غير ملغاة.", { count: owner.recent30Days.totalCompleted, total: owner.recent30Days.totalAssigned })}</div>
              <div className="grid gap-4 xl:grid-cols-2">
                <div>
                  <div className="mb-2 text-sm font-medium">{p("حسب التخصص")}</div>
                  <div className="space-y-2">{owner.recent30Days.bySpecialty.slice(0, 10).map((row: any) => <div key={row.specialtyId} className="flex justify-between gap-3 rounded-md bg-muted/40 px-3 py-2 text-sm"><span>{row.specialtyName}</span><span className="font-medium">{row.completed}/{row.assigned} · {row.completionRate}%</span></div>)}</div>
                </div>
                <div>
                  <div className="mb-2 text-sm font-medium">{p("حسب الفريق")}</div>
                  <div className="space-y-2">{owner.recent30Days.byTeam.slice(0, 10).map((row: any) => <div key={row.teamId} className="flex justify-between gap-3 rounded-md bg-muted/40 px-3 py-2 text-sm"><span>{row.teamCode}</span><span className="font-medium">{row.completed}/{row.assigned} · {row.completionRate}%</span></div>)}</div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <details className="rounded-xl border bg-background">
        <summary className="cursor-pointer list-none p-4 font-semibold">
          <span className="flex items-center gap-2"><Settings2 className="h-5 w-5" />{p("إعدادات SLA والتذكيرات")}</span>
        </summary>
        <div className="space-y-3 border-t p-4">
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            {p("ترك SLA فارغًا يعني أن PM V2 يعرض مدة بقاء المهمة لدى الجهة فقط ولا يصفها بأنها متأخرة. التذكير مستقل ويمكن تركه فارغًا أيضًا.")}
          </div>
          {rulesQuery.isLoading ? <EmptyState text={p("جارٍ تحميل قواعد SLA...")} /> : (rulesQuery.data ?? []).map((rule: any) => <SlaRuleEditor key={rule.roleKey} rule={rule} onSaved={() => { rulesQuery.refetch(); overviewQuery.refetch(); }} />)}
          <div className="flex items-start gap-2 rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground"><BellRing className="mt-0.5 h-4 w-4 shrink-0" /><span>{p("يفحص PM V2 المسؤوليات والتنبيهات دوريًا كل 5 دقائق داخل خادم PM V2. لا يغيّر Workflow المشتريات أو المستودع أو البلاغات؛ يستخدم نظام الإشعارات الحالي فقط.")}</span></div>
        </div>
      </details>
    </div>
  );
}


function TasksTab({
  navigation,
  onNavigationApplied,
}: {
  navigation: { scope: "overdue"; teamId: string } | null;
  onNavigationApplied: () => void;
}) {
  const { p, language, dir } = usePmv2Text();
  const today = riyadhToday();
  const tomorrow = addDaysIso(today, 1);
  const thisWeek = weekRange(today);
  const nextWeek = weekRange(today, 1);
  const teamsQuery = trpc.pmv2.organization.teams.list.useQuery();

  const [scope, setScope] = useState<"all" | "today" | "overdue" | "tomorrow" | "this_week" | "next_week">("today");
  const [search, setSearch] = useState("");
  const [teamFilter, setTeamFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [selectedTaskId, setSelectedTaskId] = useState("");

  useEffect(() => {
    if (!navigation) return;
    setScope(navigation.scope);
    setTeamFilter(navigation.teamId);
    setSearch("");
    setDateFrom("");
    setDateTo("");
    setPage(1);
    setSelectedTaskId("");
    onNavigationApplied();
  }, [navigation]);

  function scopeFilters(selectedScope = scope) {
    if (selectedScope === "all") return {};
    if (selectedScope === "overdue") return { overdueBefore: today, excludeFinished: true };
    if (selectedScope === "tomorrow") return { dateFrom: tomorrow, dateTo: tomorrow, excludeFinished: true };
    if (selectedScope === "this_week") return { dateFrom: thisWeek.from, dateTo: thisWeek.to, excludeFinished: true };
    if (selectedScope === "next_week") return { dateFrom: nextWeek.from, dateTo: nextWeek.to, excludeFinished: true };
    return { dateFrom: today, dateTo: today, excludeFinished: true };
  }

  const taskListInput = useMemo(() => ({
    page,
    pageSize: 20,
    search: search.trim() || undefined,
    teamId: teamFilter ? Number(teamFilter) : undefined,
    ...scopeFilters(),
    ...(scope === "all" ? {
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
    } : {}),
  }), [page, search, teamFilter, scope, dateFrom, dateTo, today, tomorrow, thisWeek.from, thisWeek.to, nextWeek.from, nextWeek.to]);

  const tasksQuery = trpc.pmv2.tasks.list.useQuery(taskListInput);

  useEffect(() => {
    if (scope === "all" && (dateFrom || dateTo)) {
      void tasksQuery.refetch();
    }
  }, [scope, dateFrom, dateTo]);
  const allCount = trpc.pmv2.tasks.list.useQuery({ page: 1, pageSize: 1 });
  const todayCount = trpc.pmv2.tasks.list.useQuery({ page: 1, pageSize: 1, dateFrom: today, dateTo: today, excludeFinished: true });
  const overdueCount = trpc.pmv2.tasks.list.useQuery({ page: 1, pageSize: 1, overdueBefore: today, excludeFinished: true });
  const tomorrowCount = trpc.pmv2.tasks.list.useQuery({ page: 1, pageSize: 1, dateFrom: tomorrow, dateTo: tomorrow, excludeFinished: true });
  const thisWeekCount = trpc.pmv2.tasks.list.useQuery({ page: 1, pageSize: 1, dateFrom: thisWeek.from, dateTo: thisWeek.to, excludeFinished: true });
  const nextWeekCount = trpc.pmv2.tasks.list.useQuery({ page: 1, pageSize: 1, dateFrom: nextWeek.from, dateTo: nextWeek.to, excludeFinished: true });

  const itemsQuery = trpc.pmv2.tasks.items.useQuery(
    { taskId: Number(selectedTaskId || 0) },
    { enabled: !!selectedTaskId },
  );
  const activeTeams = (teamsQuery.data ?? []).filter((team: any) => Number(team.isActive) === 1);
  const cards = [
    { key: "all" as const, label: p("كل المهام"), count: allCount.data?.total ?? 0 },
    { key: "today" as const, label: p("مهام اليوم"), count: todayCount.data?.total ?? 0 },
    { key: "overdue" as const, label: p("المتأخرة"), count: overdueCount.data?.total ?? 0 },
    { key: "tomorrow" as const, label: p("غدًا"), count: tomorrowCount.data?.total ?? 0 },
    { key: "this_week" as const, label: p("هذا الأسبوع"), count: thisWeekCount.data?.total ?? 0 },
    { key: "next_week" as const, label: p("الأسبوع القادم"), count: nextWeekCount.data?.total ?? 0 },
  ];

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
        {cards.map(card => (
          <button
            key={card.key}
            className={`rounded-xl border p-4 text-start transition ${scope === card.key ? "border-primary bg-primary/5 ring-1 ring-primary/20" : "bg-card hover:bg-muted/40"}`}
            onClick={() => { setScope(card.key); setPage(1); setSelectedTaskId(""); }}
          >
            <div className="text-sm text-muted-foreground">{card.label}</div>
            <div className="mt-2 text-3xl font-bold">{card.count}</div>
          </button>
        ))}
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className={`grid gap-3 ${scope === "all" ? "md:grid-cols-2 xl:grid-cols-[minmax(260px,1fr)_190px_190px_260px_auto]" : "md:grid-cols-[1fr_300px]"}`}>
            <div><Label>{p("بحث")}</Label><Input value={search} onChange={e => { setSearch(e.target.value); setPage(1); setSelectedTaskId(""); }} placeholder={p("رقم المهمة، الهدف أو قائمة الصيانة")} /></div>
            {scope === "all" && (
              <>
                <div><Label>{p("من تاريخ")}</Label><Input type="date" value={dateFrom} max={dateTo || undefined} onChange={e => { setDateFrom(e.target.value); setPage(1); setSelectedTaskId(""); }} /></div>
                <div><Label>{p("إلى تاريخ")}</Label><Input type="date" value={dateTo} min={dateFrom || undefined} onChange={e => { setDateTo(e.target.value); setPage(1); setSelectedTaskId(""); }} /></div>
              </>
            )}
            <div>
              <Label>{p("الفريق")}</Label>
              <select className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm" value={teamFilter} onChange={e => { setTeamFilter(e.target.value); setPage(1); setSelectedTaskId(""); }}>
                <option value="">{p("كل الفرق")}</option>
                {activeTeams.map((team: any) => <option key={team.id} value={team.id}>{team.code} — {team.specialtyName}</option>)}
              </select>
            </div>
            {scope === "all" && (
              <div className="flex items-end">
                <Button
                  className="w-full xl:w-auto"
                  variant="outline"
                  disabled={!search && !teamFilter && !dateFrom && !dateTo}
                  onClick={() => { setSearch(""); setTeamFilter(""); setDateFrom(""); setDateTo(""); setPage(1); setSelectedTaskId(""); }}
                >
                  {p("مسح الفلاتر")}
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[1fr_440px]">
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-3">
                <CardTitle className="text-lg">{p("المهام المجدولة")}</CardTitle>
                <span className="text-sm text-muted-foreground">{p("{count} مهمة", { count: tasksQuery.data?.total ?? 0 })}</span>
              </div>
              <Button variant="outline" onClick={() => tasksQuery.refetch()}>
                <RefreshCcw className="ms-2 h-4 w-4" />
                {p("تحديث المهام")}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {tasksQuery.isError ? (
              <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
                {p("تعذر تحميل المهام")}: {localizeApiError(tasksQuery.error.message)}
              </div>
            ) : (tasksQuery.data?.items ?? []).length === 0 ? <EmptyState text={p("لا توجد مهام في هذا النطاق")} /> : (tasksQuery.data?.items ?? []).map((task: any) => (
              <button key={task.id} className={`w-full rounded-lg border p-3 text-start ${String(task.id) === selectedTaskId ? "border-primary bg-primary/5" : ""}`} onClick={() => setSelectedTaskId(String(task.id))}>
                <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{task.taskNumber}</span><Badge variant="outline">{taskStatusLabel(task.status, language)}</Badge></div>
                <div className="mt-1 text-sm">{taskTargetLabel(task, language)}</div>
                <div className="mt-1 text-xs text-muted-foreground">{p("الفريق:")} {task.teamCode} — {p("الاستحقاق:")} {task.dueDate} — {task.checklistName}</div>
              </button>
            ))}
            <SimplePager page={page} totalPages={tasksQuery.data?.totalPages ?? 1} onPage={setPage} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-lg">{p("بنود المهمة التاريخية")}</CardTitle></CardHeader>
          <CardContent>
            {!selectedTaskId ? <EmptyState text={p("اختر مهمة لعرض البنود المنسوخة إليها")} /> : (itemsQuery.data ?? []).length === 0 ? <EmptyState text={p("لا توجد بنود لهذه المهمة")} /> : (
              <div className="space-y-2">{(itemsQuery.data ?? []).map((item: any) => (
                <div key={item.id} className="rounded-lg border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="font-medium">{item.sortOrderSnapshot}. {item.titleSnapshot}</div>
                    <Badge variant="outline">{formatPmv2RecurrenceLabel(item, language)}</Badge>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">{p("تاريخ التنفيذ:")} {item.scheduledDate} — {taskStatusLabel(item.status, language)}</div>
                </div>
              ))}</div>
            )}
          </CardContent>
        </Card>
      </div>

    </div>
  );
}

export default function ScheduledMaintenance() {
  const { p, language, dir } = usePmv2Text();
  const { user } = useAuth();
  const simplifiedStatus = trpc.pmv2.simplified.status.useQuery();
  const simplifiedEnabled = simplifiedStatus.data?.enabled === true;
  const [activeTab, setActiveTab] = useState("tasks");
  const [taskNavigation, setTaskNavigation] = useState<{ scope: "overdue"; teamId: string } | null>(null);

  function openOverdueTasks(teamId: string) {
    setTaskNavigation({ scope: "overdue", teamId });
    setActiveTab("tasks");
  }

  function changeMainTab(value: string) {
    setActiveTab(value);
  }

  return (
    <div dir={dir} className="mx-auto w-full max-w-[1600px] space-y-6 p-4 md:p-6">
      <div className="rounded-2xl border bg-card p-5 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex items-center gap-2"><CalendarClock className="h-7 w-7 text-primary" /><h1 className="text-2xl font-bold">{p("الصيانة المجدولة")}</h1></div>
            <p className="mt-2 text-sm text-muted-foreground">{p("إدارة واختبار PM V2 للمرحلتين الأولى والثانية، منفصلة عن الصيانة الوقائية القديمة.")}</p>
          </div>
          <div className="rounded-lg border bg-muted/40 px-4 py-2 text-xs text-muted-foreground">{p("متاح لمديري الصيانة والمسؤولين المخولين فقط")}</div>
        </div>
      </div>

      {simplifiedStatus.error && <p role="alert" className="text-sm text-destructive">{p("تعذر التحقق من إعداد المهام المبسط")}</p>}
      <Tabs value={activeTab} onValueChange={changeMainTab} className="space-y-5">
        <TabsList className="grid h-auto w-full grid-cols-2 gap-1 sm:grid-cols-3 xl:grid-cols-6">
          <TabsTrigger value="monitoring" className="gap-2"><Clock3 className="h-4 w-4" />{p("متابعة المعلق")}</TabsTrigger>
          <TabsTrigger value="tasks" className="gap-2"><ClipboardCheck className="h-4 w-4" />{p("المهام المجدولة")}</TabsTrigger>
          <TabsTrigger value="workload" className="gap-2"><CalendarClock className="h-4 w-4" />{p("حمل الفرق")}</TabsTrigger>
          {simplifiedEnabled ? <TabsTrigger value="simplified" className="gap-2"><Wrench className="h-4 w-4" />{p("إعداد المهام المجدولة")}</TabsTrigger> : <>
            <TabsTrigger value="programs" className="gap-2"><Wrench className="h-4 w-4" />{p("البرامج والأهداف")}</TabsTrigger>
            <TabsTrigger value="checklists" className="gap-2"><ListChecks className="h-4 w-4" />{p("قوائم الصيانة")}</TabsTrigger>
            <TabsTrigger value="organization" className="gap-2"><Users className="h-4 w-4" />{p("التخصصات والفرق")}</TabsTrigger>
          </>}
        </TabsList>
        <TabsContent value="monitoring"><MonitoringTab userRole={user?.role} /></TabsContent>
        <TabsContent value="tasks">
          <TasksTab
            navigation={taskNavigation}
            onNavigationApplied={() => setTaskNavigation(null)}
          />
        </TabsContent>
        <TabsContent value="workload"><WorkloadTab onOpenOverdue={openOverdueTasks} /></TabsContent>
        {simplifiedEnabled ? <TabsContent value="simplified" className="space-y-5">
          <SimplifiedSetupTab canDelete={simplifiedStatus.data?.canDelete === true} />
          {simplifiedStatus.data?.legacyExists && <details className="rounded-lg border bg-card p-4"><summary className="cursor-pointer font-medium">{p("إعدادات الصيانة المجدولة السابقة")}</summary>
            <Tabs defaultValue="programs" className="mt-4 space-y-3"><TabsList><TabsTrigger value="programs">{p("البرامج والأهداف")}</TabsTrigger><TabsTrigger value="checklists">{p("قوائم الصيانة")}</TabsTrigger><TabsTrigger value="organization">{p("التخصصات والفرق")}</TabsTrigger></TabsList>
              <TabsContent value="programs"><ProgramsTab /></TabsContent><TabsContent value="checklists"><ChecklistsTab /></TabsContent><TabsContent value="organization"><OrganizationTab /></TabsContent>
            </Tabs>
          </details>}
        </TabsContent> : <>
          <TabsContent value="programs"><ProgramsTab /></TabsContent>
          <TabsContent value="checklists"><ChecklistsTab /></TabsContent>
          <TabsContent value="organization"><OrganizationTab /></TabsContent>
        </>}
      </Tabs>

      <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
        <span>{p("هذه الواجهة تستخدم جداول وخدمات PM V2 فقط، وتعيد استخدام المستخدمين والمواقع والأقسام والأصول والمستودعات الحالية كمراجع دون نسخها.")}</span>
      </div>
    </div>
  );
}
