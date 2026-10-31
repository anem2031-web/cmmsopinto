import { useState } from "react";
import { CheckCircle2, PlayCircle, Users, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "@/components/ui/alert-dialog";
import ar from "@/i18n/ar";
import en from "@/i18n/en";
import ur from "@/i18n/ur";
import { issued, type Snapshot, type Assignment, type Outcome, type CompletionInput } from "@shared/maintenance-team-tickets/model";
import { ticketExecutionSession } from "@shared/maintenance-team-tickets/execution-session";

/** PMV2 presentation and labels; all callbacks operate on the ticket assignment only. */
export function TicketExecutionControls({ state, assignment: a, actorId, language, busy, onStart, onEndVisit, onNeedsMaterial, onOutcome }: {
  state: Snapshot; assignment: Assignment; actorId: number; language: string; busy: boolean;
  onStart: (resume: boolean) => Promise<boolean>; onEndVisit: () => Promise<boolean>;
  onNeedsMaterial: () => Promise<boolean>;
  onOutcome: (outcome: Exclude<Outcome, "needs_material">, input: CompletionInput) => Promise<boolean>;
}) {
  const t = (language === "ar" ? ar : language === "ur" ? ur : en).workflow.pmv2;
  const l = (a: string, e: string, u: string) => language === "ar" ? a : language === "ur" ? u : e;
  const session = ticketExecutionSession(state, a);
  const [note, setNote] = useState("");
  const [otherMaterials, setOtherMaterials] = useState("");
  const [usages, setUsages] = useState<Record<number, string>>({});
  const [dependency, setDependency] = useState<"blocked" | "external" | null>(null);
  const [dependencyNote, setDependencyNote] = useState("");
  const [error, setError] = useState("");
  const [physicalUsages, setPhysicalUsages] = useState<Record<number, string>>({});
  const current = state.needs.filter(n => n.assignmentId === a.id && n.round === a.materialRound);
  const substituted = current.filter(n => state.deliveries.some(d => d.needId === n.id && d.replacementPlanId != null));
  const actualDeliveries = state.deliveries.filter(d => substituted.some(n => n.id === d.needId));
  const actionable = ["action_required", "ready_to_repair", "reinstall_required"].includes(a.stage);
  const materialCompletion = a.stage === "ready_to_repair";
  const leader = session.openVisit?.leaderId === actorId;
  const participating = session.working && !!session.openVisit?.memberIds.includes(actorId);
  async function submit(outcome: "ok" | "fixed") {
    setError("");
    if (outcome === "fixed" && !note.trim()) {
      setError(l("تفاصيل الإصلاح إلزامية", "Repair details are required", "مرمت کی تفصیل ضروری ہے")); return;
    }
    const input: CompletionInput = {
      note, otherMaterials: outcome === "fixed" ? otherMaterials : undefined,
      usages: outcome === "fixed" ? current.filter(n => !substituted.includes(n)).map(n => ({ catalogItemId: n.catalogItemId!, used: Number(usages[n.id] ?? issued(state, n.id)) })) : [],
      ...(outcome === "fixed" && actualDeliveries.length ? { physicalUsages: actualDeliveries.map(d => ({ deliveryId: d.deliveryId, used: Number(physicalUsages[d.deliveryId] ?? d.quantity - d.returned) })) } : {}),
    };
    if (await onOutcome(outcome, input)) { setNote(""); setOtherMaterials(""); setUsages({}); setPhysicalUsages({}); }
  }
  return <div className="space-y-4">
    {session.conflict && <p role="alert" className="text-sm text-destructive">{t.multipleOpenVisits}</p>}
    {session.openVisit && <div className="rounded-lg border bg-muted/20 p-3 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm"><Users className="h-4 w-4" />
          {session.openVisit.memberIds.map(id => <Badge key={id} variant="outline">{state.users.find(u => u.id === id)?.name ?? `#${id}`}{id === session.openVisit!.leaderId ? ` — ${l("قائد الزيارة", "Visit leader", "دورے کا قائد")}` : ""}</Badge>)}
        </div>
        {leader && <Button size="sm" variant="outline" disabled={busy || session.working || session.conflict} onClick={() => void onEndVisit()}>{busy ? t.endingVisit : t.endVisit}</Button>}
      </div>
      <p className="text-xs text-muted-foreground">{leader && session.working ? t.recordAllResultsFirst : !leader ? t.visitOnlyLeader : l("يمكن إنهاء الزيارة؛ حالة البلاغ تبقى ضمن مساره الحالي.", "The visit can end; the ticket continues through its current workflow.", "دورہ ختم کیا جا سکتا ہے؛ ٹکٹ کا موجودہ عمل جاری رہے گا۔")}</p>
    </div>}
    {actionable && !session.working && <div className={materialCompletion ? "space-y-2 rounded-lg border border-emerald-200 bg-emerald-50/40 p-3 sm:w-[420px]" : "space-y-2"}>
      {materialCompletion && <><div className="text-sm font-semibold">{t.materialsReadyResume}</div><p className="text-xs text-muted-foreground">{l("استكمل العمل على نفس تذكرة الصيانة بعد استلام المواد.", "Resume work on the same maintenance ticket after receipt.", "مواد ملنے کے بعد اسی مرمت کے ٹکٹ پر کام جاری رکھیں۔")}</p></>}
      <Button size="sm" className={materialCompletion ? "w-full" : undefined} disabled={busy || session.conflict} onClick={() => void onStart(a.stage !== "action_required")}><PlayCircle className="me-1 h-4 w-4" />{a.stage === "action_required" ? t.startExecution : t.resumeWork}</Button>
    </div>}
    {session.working && session.openVisit && !session.openVisit.memberIds.includes(actorId) && <Button size="sm" variant="outline" disabled={busy} onClick={() => void onStart(a.stage !== "action_required")}><Users className="me-1 h-4 w-4" />{l("الانضمام للتنفيذ", "Join execution", "کام میں شامل ہوں")}</Button>}
    {actionable && <div className={materialCompletion ? "space-y-3 rounded-lg border border-emerald-200 bg-emerald-50/40 p-3 sm:w-[420px]" : "w-full space-y-2 sm:w-[360px]"}>
      {materialCompletion && <p className="text-sm font-semibold">{t.completeRepairAfterMaterials}</p>}
      <Textarea rows={2} maxLength={4000} disabled={busy || !participating} value={note} onChange={e => setNote(e.target.value)} placeholder={l("ملاحظات الفحص / تفاصيل الإصلاح (إلزامية عند الإصلاح)", "Inspection notes / repair details (required for repair)", "معائنے کے نوٹس / مرمت کی تفصیل (مرمت کے لیے ضروری)")} />
      {current.length > 0 && current.map(n => <div key={n.id} className="rounded-md border bg-background p-2 text-xs">
        <p className="font-medium">{n.name} — {n.unit}</p><p>{t.issuedForTask}: {issued(state, n.id)}</p>
        {substituted.includes(n) ? state.deliveries.filter(d => d.needId === n.id).map(d => <div className="mt-2 rounded border p-2" key={d.deliveryId}>
          <p>{d.replacementName ?? n.name} — {d.quantity - d.returned} {d.physicalUnit ?? n.unit} · {d.deliveryNumber}</p>
          <label htmlFor={`physical-used-${d.deliveryId}`} className="mt-1 block font-medium">{l("المستخدم الفعلي من هذا السند", "Actual quantity used from this delivery", "اس رسید سے اصل استعمال شدہ مقدار")}</label>
          <Input id={`physical-used-${d.deliveryId}`} type="number" min={0} max={d.quantity - d.returned} step={1} disabled={busy || !participating}
            value={physicalUsages[d.deliveryId] ?? ""} onChange={e => setPhysicalUsages(v => ({ ...v, [d.deliveryId]: e.target.value }))} />
          <p className="mt-1 text-muted-foreground">{l("المرتجع الفعلي", "Actual return", "اصل واپسی")}: {Math.max(0, d.quantity - d.returned - Number(physicalUsages[d.deliveryId] ?? d.quantity - d.returned))} {d.physicalUnit ?? n.unit}</p>
        </div>) : <>
        <label htmlFor={`used-${n.id}`} className="mt-2 block font-medium">{t.usedQuantityLabel}</label>
        <Input id={`used-${n.id}`} type="number" min={0} max={issued(state, n.id) - state.deliveries.filter(d => d.needId === n.id).reduce((sum, d) => sum + d.returned, 0)} step={1} disabled={busy || !participating} value={usages[n.id] ?? ""} onChange={e => setUsages(v => ({ ...v, [n.id]: e.target.value }))} />
        <p className="mt-1 text-muted-foreground">{l("المرتجع", "Return", "واپسی")}: {Math.max(0, issued(state, n.id) - Number(usages[n.id] ?? issued(state, n.id)))}</p>
        </>}
      </div>)}
      {session.working && <Textarea maxLength={4000} rows={2} value={otherMaterials} onChange={e => setOtherMaterials(e.target.value)} disabled={busy} placeholder={l("مواد أخرى استُخدمت وتفاصيلها (إن وجدت)", "Other materials used and details (if any)", "دیگر استعمال شدہ مواد کی تفصیل")} />}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex flex-wrap gap-2">
        {!current.length && a.stage !== "reinstall_required" && <Button size="sm" disabled={busy || !participating} onClick={() => void submit("ok")}><CheckCircle2 className="me-1 h-4 w-4" />{t.ok}</Button>}
        <Button size="sm" variant={materialCompletion ? "default" : "outline"} disabled={busy || !participating} onClick={() => void submit("fixed")}><Wrench className="me-1 h-4 w-4" />{materialCompletion ? t.saveFixedUsage : t.fixed}</Button>
        {a.stage === "action_required" && !current.length && <Button size="sm" variant="outline" disabled={busy || !participating} onClick={() => void onNeedsMaterial()}>{t.needsMaterial}</Button>}
        {a.stage !== "reinstall_required" && (["blocked", "external"] as const).map(value => <Button key={value} size="sm" variant="outline" disabled={busy || !participating} onClick={() => { setDependency(value); setDependencyNote(""); }}>{value === "blocked" ? l("يوجد عائق", "Obstacle", "رکاوٹ") : l("صيانة خارجية", "External maintenance", "بیرونی مرمت")}</Button>)}
      </div>
    </div>}
    <AlertDialog open={dependency !== null} onOpenChange={open => { if (!open && !busy) setDependency(null); }}>
      <AlertDialogContent dir={language === "en" ? "ltr" : "rtl"}><AlertDialogHeader><AlertDialogTitle>{dependency === "blocked" ? l("سبب العائق (إلزامي)", "Obstacle reason (required)", "رکاوٹ کی وجہ (ضروری)") : l("المطلوب من الصيانة الخارجية (إلزامي)", "External work needed (required)", "بیرونی مرمت کی ضرورت (ضروری)")}</AlertDialogTitle></AlertDialogHeader>
        <Textarea rows={4} maxLength={4000} value={dependencyNote} disabled={busy} onChange={e => setDependencyNote(e.target.value)} />
        <AlertDialogFooter><AlertDialogCancel disabled={busy}>{t.cancel}</AlertDialogCancel><AlertDialogAction disabled={busy || !dependencyNote.trim()} onClick={e => { e.preventDefault(); if (dependency) void onOutcome(dependency, { note: dependencyNote, usages: [] }).then(saved => { if (saved) setDependency(null); }); }}>{l("حفظ وإرسال للمسؤول", "Save and send to manager", "محفوظ کریں اور ذمہ دار کو بھیجیں")}</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>;
}
