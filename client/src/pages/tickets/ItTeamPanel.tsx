import { useRef, useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { APP_ROLE, isItTeamRole, MAINTENANCE_RESPONSIBLE_DEPARTMENT as DEPT } from "@shared/roles";
import { getDefaultRequiredDate } from "@/lib/purchaseItemTiming";
import { useTranslation } from "@/contexts/LanguageContext";
import { localizeApiError } from "@/i18n/apiError";
import { canExecuteItSubTicket, canStartItSubTicket, itExecutionOutcomeRequiresNote, type ItExecutionOutcome } from "@shared/it-execution-workflow";
import { ExecutionPanel } from "../maintenance-teams/ExecutionPanel";
import { TicketMaterialCatalogPicker, type TicketCatalogCandidate } from "../maintenance-teams/TicketMaterialCatalogPicker";
import { PURCHASE_REVIEW_ROLES, purchaseReviewRoleSchema, type PurchaseReviewRole } from "@shared/purchase-item-review";

const selectClass = "border rounded-md bg-background px-3 py-2 text-sm";
const format = (template: string, values: Record<string, string | number>) =>
  Object.entries(values).reduce((text, [key, value]) => text.replace(`{${key}}`, String(value)), template);

type ItMaterialDraft = { catalogItemId?: number; itemName: string; quantity: number; unit: string };
function ItMaterialRequestForm({ ticketId, onSaved, onCancel }: { ticketId: number; onSaved: () => void; onCancel: () => void }) {
  const { language } = useTranslation();
  const l = (ar: string, en: string, ur: string) => language === "ar" ? ar : language === "ur" ? ur : en;
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<TicketCatalogCandidate | null>(null);
  const [items, setItems] = useState<ItMaterialDraft[]>([]);
  const [reason, setReason] = useState("");
  const catalog = trpc.catalog.items.list.useQuery({ search, isActive: true, limit: 30, offset: 0 }, { retry: false });
  const request = trpc.tickets.requestItMaterials.useMutation({
    onSuccess: () => { toast.success(l("أُرسل احتياج المواد إلى المستودع", "Material needs sent to the warehouse", "مواد کی ضرورت گودام کو بھیج دی گئی")); onSaved(); },
    onError: error => toast.error(localizeApiError(error.message, language)),
  });
  const candidates: TicketCatalogCandidate[] = (catalog.data ?? []).map((item: any) => ({ id: item.id, code: item.code, name: item.nameAr, nameEn: item.nameEn, unit: item.unit }));
  const valid = items.length > 0 && items.length <= 20 && items.every(item => item.itemName.trim() && item.unit.trim() && Number.isSafeInteger(item.quantity) && item.quantity > 0);
  return <div className="space-y-3 rounded-md border border-amber-200 bg-background p-3">
    <p className="font-medium">{l("حدد المواد المطلوبة ثم احفظها لإرسالها إلى المستودع", "Choose the required materials, then save them for the warehouse", "مطلوبہ مواد منتخب کریں پھر گودام کے لیے محفوظ کریں")}</p>
    <TicketMaterialCatalogPicker
      items={candidates} selected={selected} search={search} onSearch={setSearch}
      blockedIds={items.flatMap(item => item.catalogItemId ? [item.catalogItemId] : [])}
      loading={catalog.isFetching} disabled={request.isPending || items.length >= 20} language={language}
      onSelect={item => {
        setSelected(item);
        setItems(current => current.some(row => row.catalogItemId === item.id) ? current : [...current, { catalogItemId: item.id, itemName: item.name, quantity: 1, unit: item.unit }]);
      }}
    />
    <Button type="button" variant="outline" disabled={request.isPending || items.length >= 20} onClick={() => setItems(current => [...current, { itemName: "", quantity: 1, unit: "" }])}>
      {l("إضافة مادة غير موجودة في الكتالوج", "Add an unlisted material", "کیٹلاگ سے باہر مواد شامل کریں")}
    </Button>
    {items.map((item, index) => <div key={`${item.catalogItemId ?? "manual"}-${index}`} className="grid grid-cols-1 gap-2 rounded border p-2 sm:grid-cols-[1fr_110px_130px_auto]">
      <Input value={item.itemName} disabled={request.isPending || item.catalogItemId != null} placeholder={l("اسم المادة", "Material name", "مواد کا نام")} onChange={event => setItems(rows => rows.map((row, i) => i === index ? { ...row, itemName: event.target.value } : row))} />
      <Input type="number" min={1} step={1} value={item.quantity} disabled={request.isPending} aria-label={l("الكمية", "Quantity", "مقدار")} onChange={event => setItems(rows => rows.map((row, i) => i === index ? { ...row, quantity: Number(event.target.value) } : row))} />
      <Input value={item.unit} disabled={request.isPending || item.catalogItemId != null} placeholder={l("الوحدة", "Unit", "اکائی")} onChange={event => setItems(rows => rows.map((row, i) => i === index ? { ...row, unit: event.target.value } : row))} />
      <Button type="button" variant="ghost" disabled={request.isPending} onClick={() => setItems(rows => rows.filter((_, i) => i !== index))}>{l("حذف", "Remove", "حذف")}</Button>
    </div>)}
    <Textarea value={reason} maxLength={2000} disabled={request.isPending} placeholder={l("ملاحظات للمستودع (اختيارية)", "Warehouse notes (optional)", "گودام کے لیے نوٹس (اختیاری)")} onChange={event => setReason(event.target.value)} />
    <div className="flex flex-wrap gap-2">
      <Button disabled={request.isPending || !valid} onClick={() => request.mutate({ ticketId, items, reason })}>{l("حفظ وإرسال للمستودع", "Save and send to warehouse", "محفوظ کرکے گودام کو بھیجیں")}</Button>
      <Button variant="ghost" disabled={request.isPending} onClick={onCancel}>{l("إلغاء", "Cancel", "منسوخ")}</Button>
    </div>
  </div>;
}

export function ItTaskActions({ ticketId, taskId, assigneeIds, canAssign, onChanged }: { ticketId: number; taskId: number; assigneeIds: number[]; canAssign: boolean; onChanged: () => void }) {
  const [selected, setSelected] = useState("");
  const { user } = useAuth();
  const { t, language } = useTranslation();
  const [, navigate] = useLocation();
  const fail = (error: { message: string }) => toast.error(localizeApiError(error.message, language));
  const { data: users } = trpc.users.list.useQuery();
  const members = users?.filter((u: any) => isItTeamRole(u.role) && u.isActive !== 0) || [];
  const assign = trpc.tickets.assignDepartmentTask.useMutation({ onSuccess: onChanged, onError: fail });
  const promote = trpc.tickets.promoteDepartmentTask.useMutation({ onSuccess: (result) => { onChanged(); navigate(`/tickets/${result.ticketId}`); }, onError: fail });
  const assignee = members.find((u: any) => assigneeIds.includes(u.id));
  return <div className="space-y-2 rounded border p-3">
    <p className="text-sm">{t.workflow.ticket.itAssigneeLabel}: {assignee?.name || assignee?.email || t.workflow.ticket.notAssigned}</p>
    {canAssign && <div className="flex flex-wrap gap-2">
      <select aria-label={t.workflow.ticket.itTaskAssigneeAria} className={selectClass} value={selected} onChange={e => setSelected(e.target.value)}>
        <option value="">{t.workflow.ticket.chooseTaskAssignee}</option>{members.map((u: any) => <option key={u.id} value={u.id}>{u.name || u.email}</option>)}
      </select>
      <Button variant="outline" disabled={!selected || assign.isPending} onClick={() => assign.mutate({ ticketId, taskId, technicianIds: [Number(selected)] })}>{t.workflow.ticket.saveAssignment}</Button>
    </div>}
    {assigneeIds.includes(user?.id || 0) && <Button disabled={!assigneeIds.length || promote.isPending} onClick={() => promote.mutate({ ticketId, taskId })}>{language === "ar" ? "بدء التنفيذ" : language === "ur" ? "کام شروع کریں" : "Start execution"}</Button>}
  </div>;
}

function ItExecutionPanel({ ticket, onChanged }: { ticket: any; onChanged: () => void }) {
  const { user } = useAuth();
  const { language } = useTranslation();
  const l = (ar: string, en: string, ur: string) => language === "ar" ? ar : language === "ur" ? ur : en;
  const fail = (error: { message: string }) => toast.error(localizeApiError(error.message, language));
  const [note, setNote] = useState("");
  const [materialsUsed, setMaterialsUsed] = useState("");
  const [pendingOutcome, setPendingOutcome] = useState<ItExecutionOutcome | null>(null);
  const [materialsOpen, setMaterialsOpen] = useState(false);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const assigned = canExecuteItSubTicket(user, ticket);
  const utils = trpc.useUtils();
  const materialAssignment = trpc.tickets.itMaterialAssignment.useQuery({ ticketId: ticket.id }, { enabled: assigned, retry: false });
  const start = trpc.tickets.startItExecution.useMutation({
    onSuccess: () => { toast.success(l("بدأ التنفيذ", "Execution started", "کام شروع ہو گیا")); onChanged(); },
    onError: fail,
  });
  const resume = trpc.tickets.startRepair.useMutation({
    onSuccess: () => { toast.success(l("تم استئناف التنفيذ", "Execution resumed", "کام دوبارہ شروع ہو گیا")); onChanged(); },
    onError: fail,
  });
  const outcome = trpc.tickets.recordItExecutionOutcome.useMutation({
    onSuccess: (result) => {
      toast.success(result.status === "closed" ? l("تم إنهاء البلاغ وإغلاقه", "Ticket completed and closed", "ٹکٹ مکمل اور بند ہو گیا") : l("تم حفظ نتيجة التنفيذ", "Execution result saved", "کام کا نتیجہ محفوظ ہو گیا"));
      setNote(""); setMaterialsUsed(""); setPendingOutcome(null); onChanged();
    },
    onError: fail,
  });
  if (!assigned || ["closed", "requester_confirmed"].includes(ticket.status)) return null;
  if (materialAssignment.data) return <section className="rounded-lg border border-blue-200 bg-blue-50/40 p-4 dark:border-blue-800 dark:bg-blue-950/20">
    <ExecutionPanel assignmentId={materialAssignment.data.assignmentId} actorId={user!.id} role={user!.role} language={language} mode="execution" onChanged={onChanged} />
  </section>;
  const canStart = canStartItSubTicket(user, ticket);
  const canResume = ticket.status === "received_warehouse" && ["B", "C"].includes(ticket.maintenancePath);
  const active = ticket.status === "in_progress";
  const outcomeLabel = (value: ItExecutionOutcome) => value === "ok"
    ? l("سليم ولا يحتاج إصلاح", "No repair needed", "مرمت کی ضرورت نہیں")
    : value === "fixed"
      ? l("تم الإصلاح", "Repaired", "مرمت مکمل")
      : value === "needs_material"
        ? l("يحتاج مواد", "Materials needed", "مواد درکار")
        : value === "blocked"
          ? l("يوجد عائق", "Obstacle", "رکاوٹ")
          : l("صيانة خارجية", "External maintenance", "بیرونی مرمت");
  const saveOutcome = (value: ItExecutionOutcome) => outcome.mutate({ ticketId: ticket.id, outcome: value, note, materialsUsed: materialsUsed || undefined });
  const chooseOutcome = (value: ItExecutionOutcome) => {
    if (value === "needs_material") {
      setMaterialsOpen(true);
      setPendingOutcome(null);
      return;
    }
    if (!itExecutionOutcomeRequiresNote(value)) {
      saveOutcome(value);
      return;
    }
    setPendingOutcome(value);
    requestAnimationFrame(() => noteRef.current?.focus());
  };
  return <section className="rounded-lg border border-blue-200 bg-blue-50/40 p-4 space-y-3 dark:border-blue-800 dark:bg-blue-950/20">
    <h3 className="font-semibold">{l("تنفيذ بلاغ تقنية المعلومات", "IT ticket execution", "آئی ٹی ٹکٹ پر کام")}</h3>
    {canStart && <Button className="w-full sm:w-auto" disabled={start.isPending} onClick={() => start.mutate({ ticketId: ticket.id })}>{l("بدء التنفيذ", "Start execution", "کام شروع کریں")}</Button>}
    {canResume && <Button className="w-full sm:w-auto" disabled={resume.isPending} onClick={() => resume.mutate({ id: ticket.id })}>{l("استئناف التنفيذ", "Resume execution", "کام دوبارہ شروع کریں")}</Button>}
    {active && <>
      <Textarea rows={2} maxLength={4000} value={materialsUsed} onChange={event => setMaterialsUsed(event.target.value)} placeholder={l("مواد أخرى استُخدمت (إن وجدت)", "Other materials used (if any)", "استعمال شدہ دیگر مواد")}/>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <Button disabled={outcome.isPending} onClick={() => chooseOutcome("ok")}>{outcomeLabel("ok")}</Button>
        <Button variant={pendingOutcome === "fixed" ? "default" : "outline"} disabled={outcome.isPending} onClick={() => chooseOutcome("fixed")}>{outcomeLabel("fixed")}</Button>
        {!ticket.maintenancePath && <Button variant="outline" disabled={outcome.isPending} onClick={() => chooseOutcome("needs_material")}>{outcomeLabel("needs_material")}</Button>}
        <Button variant={pendingOutcome === "blocked" ? "default" : "outline"} disabled={outcome.isPending} onClick={() => chooseOutcome("blocked")}>{outcomeLabel("blocked")}</Button>
        {!ticket.maintenancePath && <Button variant={pendingOutcome === "external" ? "default" : "outline"} disabled={outcome.isPending} onClick={() => chooseOutcome("external")}>{outcomeLabel("external")}</Button>}
      </div>
      {pendingOutcome && <div className="rounded-md border border-primary/30 bg-background p-3 space-y-2">
        <p className="text-sm font-medium">{l(`اكتب تفاصيل «${outcomeLabel(pendingOutcome)}» ثم أكد الحفظ`, `Enter details for “${outcomeLabel(pendingOutcome)}”, then confirm`, `تفصیل لکھیں پھر تصدیق کریں`)}</p>
        <Textarea ref={noteRef} rows={3} maxLength={4000} value={note} onChange={event => setNote(event.target.value)} placeholder={l("الملاحظة مطلوبة لهذا الخيار", "A note is required for this option", "اس اختیار کے لیے نوٹ ضروری ہے")}/>
        <div className="flex flex-wrap gap-2">
          <Button disabled={outcome.isPending || !note.trim()} onClick={() => saveOutcome(pendingOutcome)}>{l("تأكيد النتيجة", "Confirm outcome", "نتیجہ کی تصدیق")}</Button>
          <Button variant="ghost" disabled={outcome.isPending} onClick={() => { setPendingOutcome(null); setNote(""); }}>{l("إلغاء", "Cancel", "منسوخ")}</Button>
        </div>
      </div>}
      {materialsOpen && <ItMaterialRequestForm ticketId={ticket.id} onCancel={() => setMaterialsOpen(false)} onSaved={() => { setMaterialsOpen(false); void Promise.all([materialAssignment.refetch(), utils.tickets.getById.invalidate()]); onChanged(); }} />}
    </>}
  </section>;
}

export function ItTeamPanel({ ticket, departments, onChanged }: { ticket: any; departments: any[]; onChanged: () => void }) {
  const { user } = useAuth();
  const { t, language } = useTranslation();
  const fail = (error: { message: string }) => toast.error(localizeApiError(error.message, language));
  const [reason, setReason] = useState("");
  const [target, setTarget] = useState("");
  const team = isItTeamRole(user?.role);
  const { data: users } = trpc.users.list.useQuery(undefined, { enabled: team });
  const members = users?.filter((u: any) => isItTeamRole(u.role) && u.isActive !== 0) || [];
  const claim = trpc.tickets.claimItTicket.useMutation({ onSuccess: onChanged, onError: fail });
  const transfer = trpc.tickets.routeGeneralTicketToIt.useMutation({ onSuccess: onChanged, onError: fail });
  const handover = trpc.tickets.handoverItTicket.useMutation({ onSuccess: () => { setReason(""); onChanged(); }, onError: fail });
  const closed = ["closed", "requester_confirmed"].includes(ticket.status);
  const routeableDepartment = !ticket.maintenanceResponsibleDepartment ||
    [DEPT.GENERAL, DEPT.CONSTRUCTION].includes(ticket.maintenanceResponsibleDepartment);
  const roleCanRouteDepartment = user?.role === APP_ROLE.CONSTRUCTION_PROCUREMENT_MANAGER
    ? ticket.maintenanceResponsibleDepartment === DEPT.CONSTRUCTION && ticket.maintenanceResponsibleManagerId === user.id
    : user?.role === APP_ROLE.GENERAL_MAINTENANCE_MANAGER
      ? (!ticket.maintenanceResponsibleDepartment || ticket.maintenanceResponsibleDepartment === DEPT.GENERAL)
      : [APP_ROLE.MAINTENANCE_MANAGER, APP_ROLE.ADMIN, APP_ROLE.OWNER].includes(user?.role as any);
  const canRoute = routeableDepartment && roleCanRouteDepartment &&
    ["pending_triage", "department_planning", "under_inspection"].includes(ticket.status) && !ticket.maintenancePath && !ticket.sourceTaskId;
  return <div className="space-y-3">
    {canRoute && <section className="rounded-lg border p-4 space-y-2">
      <p className="font-semibold">{t.workflow.ticket.routeToItTitle}</p>
      <Textarea aria-label={t.workflow.ticket.routeToItReasonAria} placeholder={t.workflow.ticket.routeToItReasonPlaceholder} value={reason} onChange={e => setReason(e.target.value)} />
      <Button disabled={reason.trim().length < 3 || transfer.isPending} onClick={() => transfer.mutate({ ticketId: ticket.id, reason })}>{t.workflow.ticket.routeToItAction}</Button>
      <p className="text-xs text-muted-foreground">{t.workflow.ticket.routeToItHint}</p>
    </section>}
    {team && departments.filter(d => d.department === DEPT.IT).map(d => {
      const claimedBy = users?.find((u: any) => u.id === d.claimedById);
      return <section key={d.id} className="rounded-lg border p-4 space-y-3">
        <p className="font-semibold">{t.workflow.ticket.itTeamLabel} — {d.claimedById ? format(t.workflow.ticket.claimedBy, { name: claimedBy?.name || claimedBy?.email || d.claimedById }) : t.workflow.ticket.waitingForClaim}</p>
        {!closed && !d.claimedById && <Button disabled={claim.isPending} onClick={() => claim.mutate({ ticketId: ticket.id, departmentId: d.id })}>{t.workflow.ticket.claimTicket}</Button>}
        {!closed && !!d.claimedById && (d.claimedById === user?.id || user?.role === APP_ROLE.IT_MANAGER) && <div className="space-y-2">
          <select aria-label={t.workflow.ticket.handoverAria} className={selectClass} value={target} onChange={e => setTarget(e.target.value)}>
            <option value="">{t.workflow.ticket.returnToTeamQueue}</option>{members.filter((u: any) => u.id !== d.claimedById).map((u: any) => <option key={u.id} value={u.id}>{u.name || u.email}</option>)}
          </select>
          <Input placeholder={t.workflow.ticket.handoverReasonPlaceholder} value={reason} onChange={e => setReason(e.target.value)} />
          <Button variant="outline" disabled={reason.trim().length < 3 || handover.isPending} onClick={() => handover.mutate({ ticketId: ticket.id, departmentId: d.id, userId: target ? Number(target) : null, reason })}>{t.workflow.ticket.handoverAction}</Button>
          <p className="text-xs text-muted-foreground">{t.workflow.ticket.handoverHint}</p>
        </div>}
      </section>;
    })}
    {team && ticket.maintenanceResponsibleDepartment === DEPT.IT && <ItExecutionPanel ticket={ticket} onChanged={onChanged} />}
    {team && ticket.maintenanceResponsibleDepartment === DEPT.IT && <ItPurchaseNeedsPanel ticket={ticket} />}
  </div>;
}

type NeedItem = { itemName: string; quantity: number; unit?: string; requiredDate?: string; reviewRole?: PurchaseReviewRole | "" };
function NeedReview({ need, onChanged }: { need: any; onChanged: () => void }) {
  const { user } = useAuth();
  const { t, language } = useTranslation();
  const fail = (error: { message: string }) => toast.error(localizeApiError(error.message, language));
  const [, navigate] = useLocation();
  const [items, setItems] = useState<NeedItem[]>(() =>
    (need.items || []).map((item: NeedItem) => ({ ...item, requiredDate: item.requiredDate || getDefaultRequiredDate() }))
  );
  const [note, setNote] = useState("");
  const create = trpc.purchaseOrders.create.useMutation({ onSuccess: onChanged, onError: fail });
  const returnNeed = trpc.tickets.returnItPurchaseNeed.useMutation({ onSuccess: onChanged, onError: fail });
  const manager = user?.role === APP_ROLE.IT_MANAGER;
  const statusText = need.status === "pending"
    ? t.workflow.ticket.needWaitingManager
    : need.status === "returned"
      ? format(t.workflow.ticket.needReturnedClarification, { note: need.reviewNote || "" })
      : format(t.workflow.ticket.needPoCreated, { po: need.purchaseOrderId || "" });
  return <div className="rounded border p-3 space-y-2">
    <Button variant="link" onClick={() => navigate(`/tickets/${need.ticketId}`)}>{format(t.workflow.ticket.ticketNeedLink, { ticket: need.ticketId, need: need.id })}</Button>
    <p className="text-sm whitespace-pre-wrap">{need.reason}</p>
    <p className="text-sm">{statusText}</p>
    {items.map((item, index) => <div key={index} className="grid grid-cols-1 sm:grid-cols-4 gap-2">
      <label className="sm:col-span-4 text-xs space-y-1">{t.purchaseOrders.reviewRoleLabel} *
        <select className={`${selectClass} block w-full ${manager && need.status === "pending" && !item.reviewRole ? "border-destructive" : ""}`} aria-label={`${t.purchaseOrders.reviewRoleLabel} ${index + 1}`} required
          value={item.reviewRole || ""} disabled={!manager || need.status !== "pending"}
          onChange={event => setItems(values => values.map((value, i) => i === index ? { ...value, reviewRole: event.target.value as PurchaseReviewRole } : value))}>
          <option value="">{t.purchaseOrders.reviewRolePlaceholder}</option>
          {PURCHASE_REVIEW_ROLES.map(role => <option key={role} value={role}>{role === "general_maintenance_manager" ? t.purchaseOrders.reviewRoleGeneral : role === "construction_procurement_manager" ? t.purchaseOrders.reviewRoleConstruction : t.purchaseOrders.reviewRoleOther}</option>)}
        </select>
      </label>
      <Input aria-label={t.workflow.ticket.needItemAria} value={item.itemName} disabled={!manager || need.status !== "pending"} onChange={e => setItems(v => v.map((x,i) => i === index ? {...x,itemName:e.target.value} : x))} />
      <Input aria-label={t.workflow.ticket.needQuantityAria} type="number" min={1} value={item.quantity} disabled={!manager || need.status !== "pending"} onChange={e => setItems(v => v.map((x,i) => i === index ? {...x,quantity:Number(e.target.value)} : x))} />
      <Input aria-label={t.workflow.ticket.needUnitAria} value={item.unit || ""} disabled={!manager || need.status !== "pending"} onChange={e => setItems(v => v.map((x,i) => i === index ? {...x,unit:e.target.value} : x))} />
      <Input aria-label={t.workflow.ticket.needRequiredDateAria} type="date" required value={item.requiredDate || ""} disabled={!manager || need.status !== "pending"} onChange={e => setItems(v => v.map((x,i) => i === index ? {...x,requiredDate:e.target.value} : x))} />
    </div>)}
    {manager && need.status === "pending" && <>
      <Textarea placeholder={t.workflow.ticket.managerNoteReturnReason} value={note} onChange={e => setNote(e.target.value)} />
      <div className="flex flex-wrap gap-2">
        <Button disabled={create.isPending || items.some(i => !i.itemName.trim() || i.quantity < 1 || !i.requiredDate || !purchaseReviewRoleSchema.safeParse(i.reviewRole).success)} onClick={() => create.mutate({ ticketId: need.ticketId, ticketItemId: need.ticketItemId, itPurchaseNeedId: need.id, items: items.map(i => ({ ...i, reviewRole: purchaseReviewRoleSchema.parse(i.reviewRole), requiredDate: i.requiredDate! })), notes: [need.reason,note].filter(Boolean).join("\n") })}>{t.workflow.ticket.createOfficialPo}</Button>
        <Button variant="outline" disabled={note.trim().length < 3 || returnNeed.isPending} onClick={() => returnNeed.mutate({ id: need.id, reason: note })}>{t.workflow.ticket.returnForClarification}</Button>
      </div>
    </>}
  </div>;
}

export function ItPurchaseNeedsPanel({ ticket }: { ticket?: any }) {
  const { user } = useAuth();
  const { t, language } = useTranslation();
  const fail = (error: { message: string }) => toast.error(localizeApiError(error.message, language));
  const team = isItTeamRole(user?.role);
  const utils = trpc.useUtils();
  const needs = trpc.tickets.itPurchaseNeeds.useQuery(ticket ? { ticketId: ticket.id } : undefined, { enabled: team });
  const materialAssignment = trpc.tickets.itMaterialAssignment.useQuery(
    { ticketId: ticket?.id ?? 0 },
    { enabled: team && !!ticket?.id, retry: false }
  );
  const [reason, setReason] = useState("");
  const [items, setItems] = useState<NeedItem[]>([{ itemName: "", quantity: 1, unit: "" }]);
  const changed = () => { needs.refetch(); utils.tickets.getById.invalidate(); utils.purchaseOrders.list.invalidate(); };
  const submit = trpc.tickets.submitItPurchaseNeed.useMutation({ onSuccess: () => { setReason(""); changed(); }, onError: fail });
  const canSubmit = user?.role === APP_ROLE.IT_MEMBER && ticket?.assignedToId === user?.id && ticket?.maintenancePath === "B" && ticket?.status === "work_approved" && !materialAssignment.data && !needs.data?.some(n => n.status === "pending");
  if (!team || (!canSubmit && !needs.data?.length)) return null;
  return <section className="rounded-lg border p-4 space-y-3">
    <h3 className="font-semibold">{t.workflow.ticket.itPurchaseNeedsTitle}</h3>
    {canSubmit && <div className="space-y-2">
      {items.map((item,i) => <div key={i} className="flex flex-wrap gap-2">
        <Input className="flex-1" aria-label={t.workflow.ticket.requiredItemNameAria} placeholder={t.workflow.ticket.needItemPlaceholder} value={item.itemName} onChange={e => setItems(v => v.map((x,j) => i === j ? {...x,itemName:e.target.value} : x))} />
        <Input className="w-24" aria-label={t.workflow.ticket.requiredQuantityAria} type="number" min={1} value={item.quantity} onChange={e => setItems(v => v.map((x,j) => i === j ? {...x,quantity:Number(e.target.value)} : x))} />
        <Input className="w-28" aria-label={t.workflow.ticket.needUnitInputAria} placeholder={t.workflow.ticket.needUnitPlaceholder} value={item.unit} onChange={e => setItems(v => v.map((x,j) => i === j ? {...x,unit:e.target.value} : x))} />
        {items.length > 1 && <Button variant="ghost" onClick={() => setItems(v => v.filter((_,j) => i !== j))}>{t.workflow.ticket.deleteNeedItem}</Button>}
      </div>)}
      <Button variant="outline" disabled={items.length >= 20} onClick={() => setItems(v => [...v,{itemName:"",quantity:1,unit:""}])}>{t.workflow.ticket.addNeedItem}</Button>
      <Textarea placeholder={t.workflow.ticket.needJustificationPlaceholder} value={reason} onChange={e => setReason(e.target.value)} />
      <Button disabled={submit.isPending || reason.trim().length < 3 || items.some(i => !i.itemName.trim() || i.quantity < 1)} onClick={() => submit.mutate({ ticketId: ticket.id, items, reason })}>{t.workflow.ticket.submitNeedToItManager}</Button>
    </div>}
    {needs.data?.map(need => <NeedReview key={need.id} need={need} onChanged={changed} />)}
  </section>;
}
