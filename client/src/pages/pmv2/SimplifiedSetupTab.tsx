import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { usePmv2Text } from "@/i18n/pmv2Ui";
import { Button } from "@/components/ui/button";
import { localizedPmv2Title, SimplifiedPlanForm } from "./SimplifiedPlanForm";

export function SimplifiedSetupTab({ canDelete }: { canDelete: boolean }) {
  const { p, dir, language } = usePmv2Text();
  const utils = trpc.useUtils();
  const [selected, setSelected] = useState<number | null>(null);
  const [beforeId, setBeforeId] = useState<number | undefined>();
  const [formVersion, setFormVersion] = useState(0);
  const [deleteResult, setDeleteResult] = useState<"deleted" | "retired" | null>(null);
  const sites = trpc.pmv2.targets.sites.useQuery();
  const sections = trpc.pmv2.targets.sections.useQuery(undefined);
  const teams = trpc.pmv2.simplified.teams.useQuery();
  const plans = trpc.pmv2.simplified.list.useQuery({ beforeId });
  const plan = trpc.pmv2.simplified.get.useQuery({ id: selected ?? 0 }, { enabled: selected !== null });
  const create = trpc.pmv2.simplified.create.useMutation();
  const add = trpc.pmv2.simplified.addItem.useMutation();
  const updatePlan = trpc.pmv2.simplified.updatePlan.useMutation();
  const updateItem = trpc.pmv2.simplified.updateItem.useMutation();
  const disableItem = trpc.pmv2.simplified.disableItem.useMutation();
  const deletePlan = trpc.pmv2.simplified.deletePlan.useMutation();
  const activate = trpc.pmv2.simplified.activate.useMutation();
  const pause = trpc.pmv2.simplified.pause.useMutation();
  const resume = trpc.pmv2.simplified.resume.useMutation();
  const translate = trpc.pmv2.checklists.items.translateTitle.useMutation();
  async function changed(id?: number) {
    await utils.pmv2.simplified.list.invalidate();
    if (id) await utils.pmv2.simplified.get.invalidate({ id });
    await utils.pmv2.tasks.invalidate();
  }
  async function removePlan(planId: number) {
    const { kind } = await deletePlan.mutateAsync({ planId });
    utils.pmv2.simplified.list.setData({ beforeId }, data =>
      data ? { ...data, items: data.items.filter(item => item.id !== planId) } : data,
    );
    setSelected(null);
    setFormVersion(version => version + 1);
    setBeforeId(undefined);
    setDeleteResult(kind);
    void Promise.all([
      utils.pmv2.simplified.list.invalidate(),
      utils.pmv2.tasks.invalidate(),
    ]);
  }
  const loading = sites.isLoading || sections.isLoading || teams.isLoading || plans.isLoading || (selected !== null && plan.isLoading);
  const error = sites.error || sections.error || teams.error || plans.error || plan.error;
  return <div className="grid gap-5 xl:grid-cols-[360px_1fr]" dir={dir}>
    <div className="space-y-3 rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between gap-2"><h2 className="font-semibold">{p("المهام الرئيسية")}</h2><Button size="sm" onClick={() => { setSelected(null); setFormVersion(v => v + 1); setDeleteResult(null); }}>{p("مهمة جديدة")}</Button></div>
      {plans.data?.items.length === 0 && <p className="text-sm text-muted-foreground">{p("لا توجد مهام رئيسية")}</p>}
      {plans.data?.items.map(item => <button type="button" key={item.id} className={`w-full rounded-md border p-3 text-start ${selected === item.id ? "border-primary bg-primary/5" : ""}`} onClick={() => { setSelected(item.id); setDeleteResult(null); }}>
        <div className="font-medium"><bdi>{localizedPmv2Title(language, item.title, item.titleEn, item.titleUr)}</bdi></div><div className="mt-1 text-xs text-muted-foreground">{item.siteName} · {item.sectionName} · {item.teamName}</div>
        <div className="mt-1 text-xs">{p(item.state === "draft" ? "مسودة" : item.state === "paused" ? "متوقفة مؤقتًا" : "فعالة")}</div>
      </button>)}
      <div className="flex gap-2"><Button size="sm" variant="outline" disabled={!beforeId} onClick={() => setBeforeId(undefined)}>{p("الأحدث")}</Button><Button size="sm" variant="outline" disabled={!plans.data?.nextId} onClick={() => setBeforeId(plans.data?.nextId ?? undefined)}>{p("التالي")}</Button></div>
    </div>
    <div className="space-y-3">
      {deleteResult && <p role="status" className="text-sm text-emerald-700">
        {p(deleteResult === "deleted"
          ? "تم حذف المهمة الرئيسية ومهامها الفرعية."
          : "توقفت جدولة المهمة الرئيسية. بقيت المهام السابقة محفوظة.")}
      </p>}
      {loading && <p className="text-sm">{p("جارٍ التحميل...")}</p>}
      {error && <p role="alert" className="text-sm text-destructive">{p("تعذر تحميل بيانات الصيانة المجدولة. حاول مجددًا.")}</p>}
      {!loading && !error && (selected === null || plan.data) && <SimplifiedPlanForm key={selected ?? `new-${formVersion}`}
        sites={(sites.data ?? []).map(x => ({ id: x.id, name: x.name }))}
        sections={(sections.data ?? []).map(x => ({ id: x.id, siteId: x.siteId, name: x.name }))}
        teams={teams.data ?? []} dir={dir} language={language} label={text => p(text)}
        initialPlan={selected !== null ? plan.data : undefined}
        deletePlan={canDelete ? removePlan : undefined}
        savePlan={async input => { const result=await create.mutateAsync(input); await changed(); return result; }}
        translate={async title => translate.mutateAsync({title})}
        updatePlan={async (planId, input) => { await updatePlan.mutateAsync({ planId, ...input }); await changed(planId); }}
        addSubtask={async (planId, input) => {
          const result = await add.mutateAsync({ planId, ...input });
          await changed(planId);
          return result;
        }}
        updateSubtask={async (planId, itemId, input) => {
          await updateItem.mutateAsync({ planId, itemId, ...input });
          await changed(planId);
        }}
        disableSubtask={async (planId, itemId) => { await disableItem.mutateAsync({ planId, itemId }); await changed(planId); }}
        activate={async planId => { await activate.mutateAsync({planId}); await changed(planId); }}
        pause={async planId => { await pause.mutateAsync({planId}); await changed(planId); }}
        resume={async planId => { await resume.mutateAsync({planId}); await changed(planId); }}
      />}
    </div>
  </div>;
}
