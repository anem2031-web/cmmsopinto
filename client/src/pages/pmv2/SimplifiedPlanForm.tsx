import React, { useRef, useState } from "react";
import type { SupportedLanguage } from "@/contexts/LanguageContext";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export type SimplifiedPlanOption = { id: number; name: string };
export type SimplifiedSectionOption = SimplifiedPlanOption & { siteId: number };
export type SimplifiedRecurrence =
  | { kind: "daily"; startDate: string }
  | { kind: "weekly"; startDate: string; weekday: number }
  | { kind: "monthly"; startDate: string; monthDay: number }
  | { kind: "custom"; startDate: string; interval: number; unit: "day" | "week" | "month" };
type Titles = { titleAr: string; titleEn: string; titleUr: string };
export type SimplifiedSubtask = Titles & { recurrence: SimplifiedRecurrence };
type SavedSubtask = SimplifiedSubtask & { id: number; isActive: boolean };
export type SimplifiedPlanDetails = { title: string; titleEn: string; titleUr: string; siteId: number; sectionId: number; teamId: number };
export type LoadedSimplifiedPlan = SimplifiedPlanDetails & {
  id: number;
  state: "draft" | "active" | "paused";
  items: SavedSubtask[];
};
export type SimplifiedPlanFormProps = {
  sites: SimplifiedPlanOption[];
  sections: SimplifiedSectionOption[];
  teams: SimplifiedPlanOption[];
  dir: "rtl" | "ltr";
  language: SupportedLanguage;
  label: (arabic: string) => string;
  initialPlan?: LoadedSimplifiedPlan;
  savePlan: (input: SimplifiedPlanDetails) => Promise<{ id: number }>;
  updatePlan: (planId: number, input: SimplifiedPlanDetails) => Promise<void>;
  translate: (arabic: string) => Promise<{ en: string; ur: string }>;
  addSubtask: (planId: number, input: SimplifiedSubtask) => Promise<{ id: number }>;
  updateSubtask: (planId: number, itemId: number, input: SimplifiedSubtask) => Promise<void>;
  disableSubtask: (planId: number, itemId: number) => Promise<void>;
  activate: (planId: number) => Promise<void>;
  pause: (planId: number) => Promise<void>;
  resume: (planId: number) => Promise<void>;
  deletePlan?: (planId: number) => Promise<void>;
};

const inputClass = "mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm";
const fieldClass = "block space-y-1 text-sm font-medium";
const buttonClass = "rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50";
const outlineButton = "rounded-md border px-3 py-2 text-sm disabled:opacity-50";
const weekdays = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
const translationError = "تعذرت الترجمة. يرجى المحاولة مجددًا أو كتابة الترجمة يدويًا.";
const savePlanError = "تعذر حفظ المهمة الرئيسية. يرجى المحاولة مجددًا.";
const saveItemError = "تعذر حفظ المهمة الفرعية. يرجى المحاولة مجددًا.";

export function localizedPmv2Title(language: SupportedLanguage, titleAr: string, titleEn: string, titleUr: string) {
  if (language === "en") return titleEn.trim() || titleAr;
  if (language === "ur") return titleUr.trim() || titleAr;
  return titleAr;
}

function completeTitles({ titleAr, titleEn, titleUr }: Titles) {
  return Boolean(titleAr.trim() && titleEn.trim() && titleUr.trim());
}

function TitleFields({ titles, maxLength, arabicLabel, disabled, label, onChange, onTranslate }: {
  titles: Titles;
  maxLength: number;
  arabicLabel: string;
  disabled: boolean;
  label: SimplifiedPlanFormProps["label"];
  onChange: (titles: Titles) => void;
  onTranslate: () => void;
}) {
  return <>
    <label className={fieldClass}>
      {label(arabicLabel)}
      <input dir="rtl" required className={inputClass} value={titles.titleAr} maxLength={maxLength} disabled={disabled}
        onChange={e => onChange({ ...titles, titleAr: e.target.value })} />
    </label>
    <button type="button" className={buttonClass} disabled={disabled || !titles.titleAr.trim()} onClick={onTranslate}>
      {label("ترجمة")}
    </button>
    <div className="grid gap-3 md:grid-cols-2">
      <label className={fieldClass}>
        {label("المهمة بالإنجليزية")}
        <input dir="ltr" required className={inputClass} value={titles.titleEn} maxLength={maxLength} disabled={disabled}
          onChange={e => onChange({ ...titles, titleEn: e.target.value })} />
      </label>
      <label className={fieldClass}>
        {label("المهمة بالأوردو")}
        <input dir="rtl" required className={inputClass} value={titles.titleUr} maxLength={maxLength} disabled={disabled}
          onChange={e => onChange({ ...titles, titleUr: e.target.value })} />
      </label>
    </div>
  </>;
}

type ItemEditor = Titles & {
  itemId: number | null;
  kind: SimplifiedRecurrence["kind"];
  startDate: string;
  weekday: string;
  monthDay: string;
  unit: "day" | "week" | "month";
  interval: string;
};

function itemEditor(item?: SavedSubtask): ItemEditor {
  const recurrence = item?.recurrence;
  return {
    itemId: item?.id ?? null,
    titleAr: item?.titleAr ?? "",
    titleEn: item?.titleEn ?? "",
    titleUr: item?.titleUr ?? "",
    kind: recurrence?.kind ?? "daily",
    startDate: recurrence?.startDate ?? "",
    weekday: recurrence?.kind === "weekly" ? String(recurrence.weekday) : "0",
    monthDay: recurrence?.kind === "monthly" ? String(recurrence.monthDay) : "1",
    unit: recurrence?.kind === "custom" ? recurrence.unit : "day",
    interval: recurrence?.kind === "custom" ? String(recurrence.interval) : "1",
  };
}

function recurrenceOf(editor: ItemEditor): SimplifiedRecurrence {
  const { kind, startDate } = editor;
  switch (kind) {
    case "daily": return { kind, startDate };
    case "weekly": return { kind, startDate, weekday: Number(editor.weekday) };
    case "monthly": return { kind, startDate, monthDay: Number(editor.monthDay) };
    case "custom": return { kind, startDate, interval: Number(editor.interval), unit: editor.unit };
  }
}

function validItem(editor: ItemEditor) {
  if (!completeTitles(editor) || !editor.startDate) return false;
  if (editor.kind === "monthly") {
    const day = Number(editor.monthDay);
    return Number.isInteger(day) && day >= 1 && day <= 31;
  }
  if (editor.kind === "custom") {
    const interval = Number(editor.interval);
    return Number.isSafeInteger(interval) && interval >= 1 && interval <= 3650;
  }
  return true;
}

/** Controlled only by authorized server callbacks supplied by its container. */
export function SimplifiedPlanForm(props: SimplifiedPlanFormProps) {
  const p = props.label;
  const [main, setMain] = useState<SimplifiedPlanDetails>(() => props.initialPlan ?? {
    title: "", titleEn: "", titleUr: "", siteId: 0, sectionId: 0, teamId: 0,
  });
  const [savedMain, setSavedMain] = useState(main);
  const [planId, setPlanId] = useState<number | null>(props.initialPlan?.id ?? null);
  const [editingMain, setEditingMain] = useState(!props.initialPlan);
  const [editor, setEditor] = useState<ItemEditor | null>(null);
  const [saved, setSaved] = useState<SavedSubtask[]>(props.initialPlan?.items ?? []);
  const [disableCandidate, setDisableCandidate] = useState<SavedSubtask | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [planState, setPlanState] = useState<"draft" | "active" | "paused">(props.initialPlan?.state ?? "draft");
  const [error, setError] = useState("");

  async function run(work: () => Promise<void>, message: string) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      await work();
    } catch {
      setError(message);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  const mainTitles = { titleAr: main.title, titleEn: main.titleEn, titleUr: main.titleUr };
  const mainTitleTooLong = Object.values(mainTitles).some(title => title.trim().length > 200);
  const validMain = completeTitles(mainTitles) && !mainTitleTooLong &&
    props.sites.some(site => site.id === main.siteId) &&
    props.sections.some(section => section.id === main.sectionId && section.siteId === main.siteId) &&
    props.teams.some(team => team.id === main.teamId);
  const hasActiveItem = saved.some(item => item.isActive);
  const shownMain = localizedPmv2Title(props.language, savedMain.title, savedMain.titleEn, savedMain.titleUr);
  const mainLocked = busy || !editingMain;
  const pendingEditor = editingMain || !!editor;
  const showEffectiveNote = planState !== "draft" && pendingEditor;

  function saveMain() {
    if (!validMain) return;
    return run(async () => {
      const input = {
        title: main.title.trim(),
        titleEn: main.titleEn.trim(),
        titleUr: main.titleUr.trim(),
        siteId: main.siteId,
        sectionId: main.sectionId,
        teamId: main.teamId,
      };
      if (planId === null) {
        const result = await props.savePlan(input);
        setPlanId(result.id);
      } else {
        await props.updatePlan(planId, input);
      }
      setSavedMain(input);
      setMain(input);
      setEditingMain(false);
    }, savePlanError);
  }

  function saveSubtask() {
    if (planId === null || !editor || !validItem(editor)) return;
    const input = {
      titleAr: editor.titleAr.trim(),
      titleEn: editor.titleEn.trim(),
      titleUr: editor.titleUr.trim(),
      recurrence: recurrenceOf(editor),
    };
    return run(async () => {
      if (editor.itemId === null) {
        const { id } = await props.addSubtask(planId, input);
        setSaved(previous => [...previous, { ...input, id, isActive: true }]);
      } else {
        const itemId = editor.itemId;
        await props.updateSubtask(planId, itemId, input);
        setSaved(previous => previous.map(item => item.id === itemId ? { ...item, ...input } : item));
      }
      setEditor(null);
    }, saveItemError);
  }

  function disableSubtask() {
    if (planId === null || !disableCandidate) return;
    const itemId = disableCandidate.id;
    return run(async () => {
      await props.disableSubtask(planId, itemId);
      setSaved(previous => previous.map(item => item.id === itemId ? { ...item, isActive: false } : item));
      setDisableCandidate(null);
    }, "تعذر تعطيل المهمة الفرعية. يرجى المحاولة مجددًا.");
  }

  function deleteMain() {
    const remove = props.deletePlan;
    if (planId === null || !deleteOpen || !remove) return;

    return run(async () => {
      await remove(planId);
      setDeleteOpen(false);
    }, "تعذر حذف المهمة الرئيسية. يرجى المحاولة مجددًا.");
  }

  return <div dir={props.dir} className="space-y-5">
    {error && !disableCandidate && !deleteOpen && <div role="alert" className="rounded-md border border-destructive p-3 text-sm text-destructive">{p(error)}</div>}
    {showEffectiveNote && <p className="text-sm text-muted-foreground">{p("تسري التغييرات على المهام التي تُنشأ بعد الحفظ.")}</p>}
    <section className="space-y-3 rounded-lg border bg-background p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">{p("المهمة الرئيسية")}</h2>
        {!editingMain && <div className="flex flex-wrap gap-2">
          <button type="button" className={outlineButton} disabled={busy || !!editor}
            onClick={() => { setError(""); setEditingMain(true); }}>
            {p("تعديل المهمة الرئيسية")}
          </button>
          {planId !== null && props.deletePlan && (
            <button type="button" className={`${outlineButton} text-destructive`} disabled={busy || !!editor}
              onClick={() => { setError(""); setDeleteOpen(true); }}>
              {p("حذف المهمة الرئيسية")}
            </button>
          )}
        </div>}
      </div>
      {editingMain ? <TitleFields titles={mainTitles} maxLength={200} arabicLabel="عنوان المهمة الرئيسية" disabled={busy} label={p}
        onChange={titles => setMain(previous => ({ ...previous, title: titles.titleAr, titleEn: titles.titleEn, titleUr: titles.titleUr }))}
        onTranslate={() => void run(async () => {
          const result = await props.translate(main.title.trim());
          setMain(previous => ({ ...previous, titleEn: result.en, titleUr: result.ur }));
        }, translationError)} />
        : <p className="font-medium [overflow-wrap:anywhere]"><bdi>{shownMain}</bdi></p>}
      <div className="grid gap-3 md:grid-cols-3">
        <label className={fieldClass}>
          {p("الموقع")}
          <select className={inputClass} value={main.siteId || ""} disabled={mainLocked}
            onChange={e => setMain(previous => ({ ...previous, siteId: Number(e.target.value), sectionId: 0 }))}>
            <option value="">{p("اختر الموقع")}</option>
            {props.sites.map(site => <option key={site.id} value={site.id}>{site.name}</option>)}
          </select>
        </label>
        <label className={fieldClass}>
          {p("القسم")}
          <select className={inputClass} value={main.sectionId || ""} disabled={mainLocked || !main.siteId}
            onChange={e => setMain(previous => ({ ...previous, sectionId: Number(e.target.value) }))}>
            <option value="">{p("اختر القسم")}</option>
            {props.sections.filter(section => section.siteId === main.siteId)
              .map(section => <option key={section.id} value={section.id}>{section.name}</option>)}
          </select>
        </label>
        <label className={fieldClass}>
          {p("فريق الصيانة")}
          <select className={inputClass} value={main.teamId || ""} disabled={mainLocked}
            onChange={e => setMain(previous => ({ ...previous, teamId: Number(e.target.value) }))}>
            <option value="">{p("اختر الفريق")}</option>
            {props.teams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}
          </select>
        </label>
      </div>
      {editingMain && <>
        {!completeTitles(mainTitles) && <p className="text-sm text-muted-foreground">{p("أكمل عنوان المهمة باللغات الثلاث للحفظ.")}</p>}
        {mainTitleTooLong && <p className="text-sm text-destructive">{p("الحد الأقصى لعنوان المهمة الرئيسية 200 حرف لكل لغة.")}</p>}
        <div className="flex flex-wrap gap-2">
          <button type="button" className={buttonClass} disabled={busy || !validMain} onClick={() => void saveMain()}>
            {p("حفظ المهمة الرئيسية")}
          </button>
          {planId !== null && <button type="button" className={outlineButton} disabled={busy}
            onClick={() => { setMain(savedMain); setEditingMain(false); setError(""); }}>
            {p("إلغاء")}
          </button>}
        </div>
      </>}
    </section>
    {planId !== null && <section className="space-y-4 rounded-lg border bg-background p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">{p("المهام الفرعية")}</h2>
        {!editor && <button type="button" className={buttonClass} disabled={busy || editingMain}
          onClick={() => { setError(""); setEditor(itemEditor()); }}>
          {p("إنشاء مهمة فرعية")}
        </button>}
      </div>
      {saved.length > 0 && <ol className="divide-y rounded-md border">
        {saved.map(item => (
          <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
            <div className="flex min-w-0 flex-wrap items-center gap-2 [overflow-wrap:anywhere]">
              <bdi>{localizedPmv2Title(props.language, item.titleAr, item.titleEn, item.titleUr)}</bdi>
              {!item.isActive && <span className="rounded border px-2 py-0.5 text-xs text-muted-foreground">{p("معطّلة")}</span>}
            </div>
            {item.isActive && <div className="flex flex-wrap gap-2">
              <button type="button" className={outlineButton} disabled={busy || pendingEditor}
                onClick={() => { setError(""); setEditor(itemEditor(item)); }}>
                {p("تعديل المهمة الفرعية")}
              </button>
              <button type="button" className={outlineButton} disabled={busy || pendingEditor}
                onClick={() => { setError(""); setDisableCandidate(item); }}>
                {p("تعطيل المهمة الفرعية")}
              </button>
            </div>}
          </li>
        ))}
      </ol>}
      {editor && <div className="space-y-3 rounded-md border p-3">
        <TitleFields titles={editor} maxLength={300} arabicLabel="المهمة بالعربية" disabled={busy} label={p}
          onChange={titles => setEditor({ ...editor, titleAr: titles.titleAr, titleEn: titles.titleEn, titleUr: titles.titleUr })}
          onTranslate={() => void run(async () => {
            const result = await props.translate(editor.titleAr.trim());
            setEditor(previous => previous ? { ...previous, titleEn: result.en, titleUr: result.ur } : null);
          }, translationError)} />
        <div className="grid gap-3 md:grid-cols-2">
          <label className={fieldClass}>
            {p("تاريخ البداية")}
            <input type="date" className={inputClass} value={editor.startDate} disabled={busy}
              onChange={e => setEditor({ ...editor, startDate: e.target.value })} />
          </label>
          <label className={fieldClass}>
            {p("تكرار المهمة")}
            <select className={inputClass} value={editor.kind} disabled={busy}
              onChange={e => setEditor({ ...editor, kind: e.target.value as ItemEditor["kind"] })}>
              <option value="daily">{p("يومي")}</option>
              <option value="weekly">{p("أسبوعي")}</option>
              <option value="monthly">{p("شهري")}</option>
              <option value="custom">{p("مخصص")}</option>
            </select>
          </label>
        </div>
        {editor.kind === "weekly" && <label className={fieldClass}>
          {p("يوم الأسبوع")}
          <select className={inputClass} value={editor.weekday} disabled={busy}
            onChange={e => setEditor({ ...editor, weekday: e.target.value })}>
            {weekdays.map((day, index) => <option key={day} value={index}>{p(day)}</option>)}
          </select>
        </label>}
        {editor.kind === "monthly" && <label className={fieldClass}>
          {p("يوم الشهر")}
          <input className={inputClass} type="number" min={1} max={31} value={editor.monthDay} disabled={busy}
            onChange={e => setEditor({ ...editor, monthDay: e.target.value })} />
        </label>}
        {editor.kind === "custom" && <div className="grid gap-3 md:grid-cols-2">
          <label className={fieldClass}>
            {p("يتكرر كل")}
            <input className={inputClass} type="number" min={1} max={3650} value={editor.interval} disabled={busy}
              onChange={e => setEditor({ ...editor, interval: e.target.value })} />
          </label>
          <label className={fieldClass}>
            {p("وحدة التكرار")}
            <select className={inputClass} value={editor.unit} disabled={busy}
              onChange={e => setEditor({ ...editor, unit: e.target.value as ItemEditor["unit"] })}>
              <option value="day">{p("يوم")}</option>
              <option value="week">{p("أسبوع")}</option>
              <option value="month">{p("شهر")}</option>
            </select>
          </label>
        </div>}
        {!completeTitles(editor) && <p className="text-sm text-muted-foreground">{p("أكمل عنوان المهمة باللغات الثلاث للحفظ.")}</p>}
        <div className="flex flex-wrap gap-2">
          <button type="button" className={buttonClass} disabled={busy || !validItem(editor)}
            onClick={() => void saveSubtask()}>{p("حفظ المهمة الفرعية")}</button>
          <button type="button" className={outlineButton} disabled={busy}
            onClick={() => { setEditor(null); setError(""); }}>{p("إلغاء")}</button>
        </div>
      </div>}
      {planState === "draft" && <button type="button" className={buttonClass} disabled={busy || pendingEditor || !hasActiveItem}
        onClick={() => void run(async () => { await props.activate(planId); setPlanState("active"); }, "تعذر تفعيل المهمة الرئيسية. يرجى المحاولة مجددًا.")}>
        {p("حفظ نهائي وتفعيل")}
      </button>}
      {planState === "active" && <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-emerald-700">{p("المهمة الرئيسية فعالة")}</p>
        <button type="button" className={outlineButton} disabled={busy || pendingEditor}
          onClick={() => void run(async () => { await props.pause(planId); setPlanState("paused"); }, "تعذر إيقاف المهمة. يرجى المحاولة مجددًا.")}>
          {p("إيقاف مؤقت")}
        </button>
      </div>}
      {planState === "paused" && <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-amber-700">{p("المهمة الرئيسية متوقفة مؤقتًا")}</p>
        <button type="button" className={buttonClass} disabled={busy || pendingEditor}
          onClick={() => void run(async () => { await props.resume(planId); setPlanState("active"); }, "تعذر إعادة تفعيل المهمة. يرجى المحاولة مجددًا.")}>
          {p("إعادة التفعيل")}
        </button>
      </div>}
    </section>}
    <AlertDialog open={disableCandidate !== null} onOpenChange={open => { if (!open && !busy) { setDisableCandidate(null); setError(""); } }}>
      <AlertDialogContent dir={props.dir}>
        <AlertDialogHeader className="sm:text-start">
          <AlertDialogTitle>{p("تعطيل المهمة الفرعية")}</AlertDialogTitle>
          <AlertDialogDescription>{p("يتوقف إنشاء مهام جديدة لهذا البند، وتبقى المهام المسندة سابقًا قابلة للإكمال.")}</AlertDialogDescription>
        </AlertDialogHeader>
        {disableCandidate && <p className="text-sm font-medium">
          <bdi>{localizedPmv2Title(props.language, disableCandidate.titleAr, disableCandidate.titleEn, disableCandidate.titleUr)}</bdi>
        </p>}
        {error && <p role="alert" className="text-sm text-destructive">{p(error)}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{p("إلغاء")}</AlertDialogCancel>
          <AlertDialogAction disabled={busy} onClick={event => { event.preventDefault(); void disableSubtask(); }}>
            {p("تعطيل المهمة الفرعية")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    {props.deletePlan && <AlertDialog open={deleteOpen} onOpenChange={open => {
      if (!open && !busy) {
        setDeleteOpen(false);
        setError("");
      }
    }}>
      <AlertDialogContent dir={props.dir}>
        <AlertDialogHeader className="sm:text-start">
          <AlertDialogTitle>{p("حذف المهمة الرئيسية")}</AlertDialogTitle>
          <AlertDialogDescription>
            {p("إذا لم يبدأ العمل على الخطة، تُحذف نهائيًا مع مهامها. إذا بدأ العمل، تتوقف الجدولة ويُلغى العمل المستقبلي الذي لم يبدأ، ويمكن إكمال المهام السابقة المفتوحة.")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <p className="text-sm font-medium [overflow-wrap:anywhere]"><bdi>{shownMain}</bdi></p>
        {error && <p role="alert" className="text-sm text-destructive">{p(error)}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{p("إلغاء")}</AlertDialogCancel>
          <AlertDialogAction className="bg-destructive text-white hover:bg-destructive/90" disabled={busy}
            onClick={event => { event.preventDefault(); void deleteMain(); }}>
            {p("تأكيد الحذف")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>}
  </div>;
}
