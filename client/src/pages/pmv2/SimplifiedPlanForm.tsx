import React, { useRef, useState } from "react";
import type { SupportedLanguage } from "@/contexts/LanguageContext";

export type SimplifiedPlanOption = { id: number; name: string };
export type SimplifiedSectionOption = SimplifiedPlanOption & { siteId: number };
export type SimplifiedRecurrence =
  | { kind: "daily"; startDate: string }
  | { kind: "weekly"; startDate: string; weekday: number }
  | { kind: "monthly"; startDate: string; monthDay: number }
  | { kind: "custom"; startDate: string; interval: number; unit: "day" | "week" | "month" };
export type SimplifiedSubtask = { titleAr: string; titleEn: string; titleUr: string; recurrence: SimplifiedRecurrence };
export type SimplifiedPlanDetails = { title: string; siteId: number; sectionId: number; teamId: number };
export type LoadedSimplifiedPlan = SimplifiedPlanDetails & { id: number; state: "draft" | "active" | "paused"; items: SimplifiedSubtask[] };
export type SimplifiedPlanFormProps = {
  sites: SimplifiedPlanOption[];
  sections: SimplifiedSectionOption[];
  teams: SimplifiedPlanOption[];
  dir: "rtl" | "ltr";
  language: SupportedLanguage;
  label: (arabic: string) => string;
  initialPlan?: LoadedSimplifiedPlan;
  savePlan: (input: SimplifiedPlanDetails) => Promise<{ id: number }>;
  translate: (arabic: string) => Promise<{ en: string; ur: string }>;
  addSubtask: (planId: number, input: SimplifiedSubtask) => Promise<void>;
  activate: (planId: number) => Promise<void>;
  pause: (planId: number) => Promise<void>;
  resume: (planId: number) => Promise<void>;
};

const inputClass = "mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm";
const fieldClass = "block space-y-1 text-sm font-medium";
const buttonClass = "rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50";

/** Controlled only by authorized server callbacks supplied by its container. */
export function SimplifiedPlanForm(props: SimplifiedPlanFormProps) {
  const p = props.label;
  const [title, setTitle] = useState(props.initialPlan?.title ?? "");
  const [siteId, setSiteId] = useState(props.initialPlan ? String(props.initialPlan.siteId) : "");
  const [sectionId, setSectionId] = useState(props.initialPlan ? String(props.initialPlan.sectionId) : "");
  const [teamId, setTeamId] = useState(props.initialPlan ? String(props.initialPlan.teamId) : "");
  const [planId, setPlanId] = useState<number | null>(props.initialPlan?.id ?? null);
  const [itemOpen, setItemOpen] = useState(false);
  const [titleAr, setTitleAr] = useState("");
  const [titleEn, setTitleEn] = useState("");
  const [titleUr, setTitleUr] = useState("");
  const [kind, setKind] = useState<SimplifiedRecurrence["kind"]>("daily");
  const [startDate, setStartDate] = useState("");
  const [weekday, setWeekday] = useState("0");
  const [monthDay, setMonthDay] = useState("1");
  const [unit, setUnit] = useState<"day" | "week" | "month">("day");
  const [interval, setInterval] = useState("1");
  const [saved, setSaved] = useState<SimplifiedSubtask[]>(props.initialPlan?.items ?? []);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [planState, setPlanState] = useState<"draft" | "active" | "paused">(props.initialPlan?.state ?? "draft");
  const [error, setError] = useState("");
  const weekdays = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
  async function run(work: () => Promise<void>, message: string) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true); setError("");
    try { await work(); } catch { setError(p(message)); } finally { busyRef.current = false; setBusy(false); }
  }
  const validBase = !!title.trim() && !!props.sites.find(x => x.id === Number(siteId)) && !!props.sections.find(x => x.id === Number(sectionId) && x.siteId === Number(siteId)) && !!props.teams.find(x => x.id === Number(teamId));
  const validCount = Number.isSafeInteger(Number(interval)) && Number(interval) >= 1 && Number(interval) <= 3650;
  const completeTitles = Boolean(titleAr.trim() && titleEn.trim() && titleUr.trim());
  const validMonthDay = Number.isInteger(Number(monthDay)) && Number(monthDay) >= 1 && Number(monthDay) <= 31;
  const validItem = completeTitles && !!startDate &&
    (kind !== "custom" || validCount) && (kind !== "monthly" || validMonthDay);
  function savedTitle(item: SimplifiedSubtask) {
    if (props.language === "en") return item.titleEn || item.titleAr;
    if (props.language === "ur") return item.titleUr || item.titleAr;
    return item.titleAr;
  }
  function recurrence(): SimplifiedRecurrence {
    if (kind === "daily") return { kind, startDate };
    if (kind === "weekly") return { kind, startDate, weekday: Number(weekday) };
    if (kind === "monthly") return { kind, startDate, monthDay: Number(monthDay) };
    return { kind, startDate, interval: Number(interval), unit };
  }
  return <div dir={props.dir} className="space-y-5">
    {error && <div role="alert" className="rounded-md border border-destructive p-3 text-sm text-destructive">{error}</div>}
    <section className="space-y-3 rounded-lg border bg-background p-4">
      <h2 className="font-semibold">{p("المهمة الرئيسية")}</h2>
      <label className={fieldClass}>{p("عنوان المهمة الرئيسية")}<input className={inputClass} value={title} maxLength={200} disabled={busy || planId !== null} onChange={e => setTitle(e.target.value)} /></label>
      <div className="grid gap-3 md:grid-cols-3">
        <label className={fieldClass}>{p("الموقع")}<select className={inputClass} value={siteId} disabled={busy || planId !== null} onChange={e => { setSiteId(e.target.value); setSectionId(""); }}><option value="">{p("اختر الموقع")}</option>{props.sites.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
        <label className={fieldClass}>{p("القسم")}<select className={inputClass} value={sectionId} disabled={busy || planId !== null || !siteId} onChange={e => setSectionId(e.target.value)}><option value="">{p("اختر القسم")}</option>{props.sections.filter(x => x.siteId === Number(siteId)).map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
        <label className={fieldClass}>{p("فريق الصيانة")}<select className={inputClass} value={teamId} disabled={busy || planId !== null} onChange={e => setTeamId(e.target.value)}><option value="">{p("اختر الفريق")}</option>{props.teams.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
      </div>
      {planId === null ? <button type="button" className={buttonClass} disabled={busy || !validBase} onClick={() => void run(async () => { const result = await props.savePlan({ title: title.trim(), siteId: Number(siteId), sectionId: Number(sectionId), teamId: Number(teamId) }); if (!Number.isSafeInteger(result.id) || result.id < 1) throw new Error(); setPlanId(result.id); }, "تعذر حفظ المهمة الرئيسية. يرجى المحاولة مجددًا.")}>{p("حفظ المهمة الرئيسية")}</button> : <p className="text-sm text-emerald-700">{p("تم حفظ بيانات المهمة الرئيسية")}</p>}
    </section>
    {planId !== null && <section className="space-y-4 rounded-lg border bg-background p-4">
      <h2 className="font-semibold">{p("المهام الفرعية")}</h2>
      {saved.length > 0 && <ol className="list-inside list-decimal space-y-1">
        {saved.map((item, index) => (
          <li key={index} className="text-sm"><bdi>{savedTitle(item)}</bdi></li>
        ))}
      </ol>}
      {planState === "draft" && !itemOpen && <button type="button" className={buttonClass} disabled={busy} onClick={() => setItemOpen(true)}>{p("إنشاء مهمة فرعية")}</button>}
      {planState === "draft" && itemOpen && <div className="space-y-3 rounded-md border p-3">
        <label className={fieldClass}>{p("المهمة بالعربية")}<input dir="rtl" className={inputClass} value={titleAr} maxLength={300} required disabled={busy} onChange={e => setTitleAr(e.target.value)} /></label>
        <button type="button" className={buttonClass} disabled={busy || !titleAr.trim()} onClick={() => void run(async () => { const result = await props.translate(titleAr.trim()); setTitleEn(result.en); setTitleUr(result.ur); }, "تعذرت الترجمة. يرجى المحاولة مجددًا أو كتابة الترجمة يدويًا.")}>{p("ترجمة")}</button>
        <div className="grid gap-3 md:grid-cols-2">
          <label className={fieldClass}>{p("المهمة بالإنجليزية")}<input dir="ltr" className={inputClass} value={titleEn} maxLength={300} required disabled={busy} onChange={e => setTitleEn(e.target.value)} /></label>
          <label className={fieldClass}>{p("المهمة بالأوردو")}<input dir="rtl" className={inputClass} value={titleUr} maxLength={300} required disabled={busy} onChange={e => setTitleUr(e.target.value)} /></label>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <label className={fieldClass}>{p("تاريخ البداية")}<input type="date" className={inputClass} value={startDate} disabled={busy} onChange={e => setStartDate(e.target.value)} /></label>
          <label className={fieldClass}>{p("تكرار المهمة")}<select className={inputClass} value={kind} disabled={busy} onChange={e => setKind(e.target.value as SimplifiedRecurrence["kind"])}><option value="daily">{p("يومي")}</option><option value="weekly">{p("أسبوعي")}</option><option value="monthly">{p("شهري")}</option><option value="custom">{p("مخصص")}</option></select></label>
        </div>
        {kind === "weekly" && <label className={fieldClass}>{p("يوم الأسبوع")}<select className={inputClass} value={weekday} disabled={busy} onChange={e => setWeekday(e.target.value)}>{weekdays.map((day, index) => <option key={day} value={index}>{p(day)}</option>)}</select></label>}
        {kind === "monthly" && <label className={fieldClass}>{p("يوم الشهر")}<input className={inputClass} type="number" min={1} max={31} value={monthDay} disabled={busy} onChange={e => setMonthDay(e.target.value)} /></label>}
        {kind === "custom" && <div className="grid gap-3 md:grid-cols-2"><label className={fieldClass}>{p("يتكرر كل")}<input className={inputClass} type="number" min={1} max={3650} value={interval} disabled={busy} onChange={e => setInterval(e.target.value)} /></label><label className={fieldClass}>{p("وحدة التكرار")}<select className={inputClass} value={unit} disabled={busy} onChange={e => setUnit(e.target.value as typeof unit)}><option value="day">{p("يوم")}</option><option value="week">{p("أسبوع")}</option><option value="month">{p("شهر")}</option></select></label></div>}
        {!completeTitles && <p className="text-sm text-muted-foreground">{p("أكمل عنوان المهمة باللغات الثلاث للحفظ.")}</p>}
        <div className="flex flex-wrap gap-2"><button type="button" className={buttonClass} disabled={busy || !validItem} onClick={() => void run(async () => { const item = { titleAr: titleAr.trim(), titleEn: titleEn.trim(), titleUr: titleUr.trim(), recurrence: recurrence() }; await props.addSubtask(planId, item); setSaved(previous => [...previous, item]); setTitleAr(""); setTitleEn(""); setTitleUr(""); setItemOpen(false); }, "تعذر حفظ المهمة الفرعية. يرجى المحاولة مجددًا.")}>{p("حفظ المهمة الفرعية")}</button><button type="button" className="rounded-md border px-4 py-2 text-sm" disabled={busy} onClick={() => setItemOpen(false)}>{p("إلغاء")}</button></div>
      </div>}
      {planState === "draft" && <button type="button" className={buttonClass} disabled={busy || itemOpen || saved.length === 0} onClick={() => void run(async () => { await props.activate(planId); setPlanState("active"); }, "تعذر تفعيل المهمة الرئيسية. يرجى المحاولة مجددًا.")}>{p("حفظ نهائي وتفعيل")}</button>}
      {planState === "active" && <div className="flex flex-wrap items-center gap-3"><p className="text-sm text-emerald-700">{p("المهمة الرئيسية فعالة")}</p><button type="button" className="rounded-md border px-4 py-2 text-sm" disabled={busy} onClick={() => void run(async () => { await props.pause(planId); setPlanState("paused"); }, "تعذر إيقاف المهمة. يرجى المحاولة مجددًا.")}>{p("إيقاف مؤقت")}</button></div>}
      {planState === "paused" && <div className="flex flex-wrap items-center gap-3"><p className="text-sm text-amber-700">{p("المهمة الرئيسية متوقفة مؤقتًا")}</p><button type="button" className={buttonClass} disabled={busy} onClick={() => void run(async () => { await props.resume(planId); setPlanState("active"); }, "تعذر إعادة تفعيل المهمة. يرجى المحاولة مجددًا.")}>{p("إعادة التفعيل")}</button></div>}
    </section>}
  </div>;
}
