import { MaterialCostPanel } from "@/components/inventory/MaterialCostPanel";
import { ExternalRouteReviewPanel } from "../tickets/ExternalRouteReviewPanel";
import { useEffect, useRef, useState } from "react";
import { ExecutionElapsedTime } from "@/components/maintenance/TechnicianExecutionWindow";
import { TicketExecutionControls } from "./TicketExecutionControls";
import { TicketTechnicianMaterials } from "./TicketTechnicianMaterials";
import { ticketSessionActionText, ticketExecutionSession } from "@shared/maintenance-team-tickets/execution-session";
import { trpc } from "@/lib/trpc";
import { TicketWarehouseLotSelection } from "./TicketWarehouseLotSelection";
import type { WarehouseLotSelection } from "@shared/warehouse-lot-selection";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { TicketMaterialIdentityResolver } from "./TicketMaterialIdentityResolver";
import { canReviewTicketMaterialQuantity } from "./material-identity-review";
import { ArrowLeftRight, Link2, Loader2, Send, ShoppingCart } from "lucide-react";
import ar from "@/i18n/ar";
import en from "@/i18n/en";
import ur from "@/i18n/ur";
import { TicketWarehouseMaterialCard } from "./TicketWarehouseMaterialCard";
import type { AssignedTeamTicket } from "@shared/maintenance-team-tickets/assignment";
import { WarehousePurchaseQuantities } from "./WarehousePurchaseQuantities";
import {
  MAX_TICKET_PURCHASE_QUANTITY,
  validWarehouseExtra,
} from "@shared/maintenance-team-tickets/purchase-quantities";
import {
  materialSupplyRemaining,
  materialActionMessage,
} from "@shared/maintenance-team-tickets/material-routing";
import {
  TicketMaterialNeedPanel,
  TicketMaterialReceiptButton,
} from "./TicketMaterialNeedPanel";
import {
  materialSection,
  type WarehouseSection,
} from "@shared/maintenance-team-tickets/warehouse-materials";
import {
  canExecuteAllTicketTeams,
  canReviewTicketTeamExecution,
} from "@shared/maintenance-team-tickets/execution-permissions";
import {
  issued,
  remainingReturn,
  outcomeLabels,
  stageLabels,
  type Outcome,
} from "@shared/maintenance-team-tickets/model";

const english: Record<string, string> = {
  ok: "No repair needed",
  fixed: "Repaired",
  needs_material: "Materials needed",
  blocked: "Obstacle",
  external: "External maintenance",
  action_required: "Team action required",
  waiting_material: "Waiting for materials",
  ready_to_repair: "Materials received — complete repair",
  awaiting_review: "Awaiting manager review",
  external_requested: "External maintenance requested",
  external_in_progress: "External maintenance in progress",
  reinstall_required: "Reinstallation required",
  closed: "Team execution completed",
};
const urdu: Record<string, string> = {
  ok: "درست",
  fixed: "مرمت مکمل",
  needs_material: "مواد درکار",
  blocked: "رکاوٹ",
  external: "بیرونی مرمت",
  action_required: "ٹیم کی کارروائی درکار",
  waiting_material: "مواد کا انتظار",
  ready_to_repair: "مواد موصول — مرمت مکمل کریں",
  awaiting_review: "ذمہ دار کی منظوری کا انتظار",
  external_requested: "بیرونی مرمت کی درخواست",
  external_in_progress: "بیرونی مرمت جاری",
  reinstall_required: "دوبارہ تنصیب درکار",
  closed: "ٹیم کا کام مکمل",
};
export function ExecutionPanel({
  assignmentId,
  actorId,
  role,
  language,
  onChanged,
  mode = "execution",
  warehouseSection,
  warehouseNeedId,
  warehouseTicket,
  onBusyChange,
}: {
  assignmentId: number;
  actorId: number;
  role: string;
  language: string;
  onChanged: () => void;
  mode?: "execution" | "warehouse";
  warehouseSection?: WarehouseSection;
  warehouseNeedId?: number;
  warehouseTicket?: AssignedTeamTicket;
  onBusyChange?: (busy: boolean) => void;
}) {
  const l = (ar: string, en: string, ur: string) =>
    language === "ar" ? ar : language === "ur" ? ur : en;
  const pmv2 = (language === "ar" ? ar : language === "ur" ? ur : en).workflow
    .pmv2;
  const supplyLabel = (template: string, quantity: number, unit: string) =>
    template.replace(
      "{qty}",
      `${quantity.toLocaleString(language === "ar" ? "ar-SA" : language === "ur" ? "ur-PK" : "en-US", { maximumFractionDigits: 3 })} ${unit}`
    );
  const label = (value: string) =>
    language === "ar"
      ? (stageLabels[value as keyof typeof stageLabels] ??
        outcomeLabels[value as Outcome] ??
        value)
      : language === "ur"
        ? (urdu[value] ?? value)
        : (english[value] ?? value);
  const utils = trpc.useUtils(),
    details = trpc.ticketTeamExecution.details.useQuery(
      { assignmentId, language: language === "ar" ? "ar" : language === "ur" ? "ur" : "en" },
      { retry: false }
    );
  const [catalogNeedId, setCatalogNeedId] = useState<number | null>(null);
  const [issueSelections,setIssueSelections]=useState<Record<number,WarehouseLotSelection>>({});
  const [issueSelectionReady,setIssueSelectionReady]=useState<Record<number,boolean>>({});
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [reviewNote, setReviewNote] = useState(""),
    [recipient, setRecipient] = useState(""),
    [requiredDate, setDate] = useState("");
  const [warehouseExtras, setWarehouseExtras] = useState<Record<number, string>>(
      {}
    ),
    [issueRecipients, setIssueRecipients] = useState<Record<number, string>>(
      {}
    ),
    [allocations, setAllocations] = useState<Record<string, number>>({});
  const retry = useRef<{ fingerprint: string; key: string } | null>(null);
  useEffect(() => { onBusyChange?.(busy); }, [busy, onBusyChange]);
  const state = details.data,
    a = state?.assignments[0],
    technician =
      mode === "execution" &&
      (["technician", "it_manager", "it_member"].includes(role) ||
        canExecuteAllTicketTeams(role)),
    warehouse = ["warehouse", "owner", "admin"].includes(role),
    manager =
      mode === "execution" &&
      canReviewTicketTeamExecution(role, actorId, a?.responsibleManagerId);
  const catalogNeed = warehouse && a?.stage === "waiting_material" && !details.error
    ? state?.needs.find(n => n.id === catalogNeedId && (warehouseNeedId == null || n.id === warehouseNeedId) && n.assignmentId === a.id && n.round === a.materialRound && canReviewTicketMaterialQuantity(state, n))
    : undefined;
  const balances = trpc.ticketTeamExecution.balances.useQuery(
    { assignmentId },
    { enabled: !!a && a.stage === "waiting_material", retry: false }
  );
  async function openSupply(needId: number, kind: "transfer" | "purchase") {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const h = await utils.client.ticketTeamExecution.prepareSupply.mutate({
        assignmentId,
        needId,
        kind,
      });
      if (kind === "transfer" && h.replacementFulfillment) {
        const fingerprint = JSON.stringify({ kind: "replacement-transfer", needId });
        if (retry.current?.fingerprint !== fingerprint)
          retry.current = { fingerprint, key: `mtt:${crypto.randomUUID()}` };
        await utils.client.ticketTeamExecution.provide.mutate({
          assignmentId,
          needId,
          kind: "transfer",
          expectedRevision: h.revision,
          operationKey: retry.current.key,
        });
        retry.current = null;
        setMessage(l("تم تحويل مواد الاحتياج والبديل المعتمد", "Need materials and approved replacement transferred", "ضرورت کا مواد اور منظور شدہ متبادل منتقل کر دیا گیا"));
        await Promise.all([
          details.refetch(),
          utils.ticketTeamExecution.balances.invalidate(),
          utils.ticketTeamAssignments.warehouseRequests.invalidate(),
        ]);
        onChanged();
        return;
      }
      const params = new URLSearchParams({
        ticketTeamAssignmentId: String(h.assignmentId),
        ticketTeamNeedId: String(h.needId),
        ticketTeamRevision: String(h.revision),
        ticketId: String(h.ticketId),
        ticketItemId: String(h.ticketItemId),
        ticketNumber: h.ticketNumber,
      });
      if (kind === "transfer") {
        params.set("fromWarehouseId", String(h.mainWarehouseId));
        params.set("toWarehouseId", String(h.warehouseId));
        params.set("inventoryId", String(h.inventoryId));
        params.set("quantity", String(h.quantity));
        params.set("unit", h.unit);
        params.set("ticketMaterialName", h.name);
      } else {
        const extraText = warehouseExtras[needId] ?? "0";
        const extra = Number(extraText);
        if (
          !validWarehouseExtra(extra) ||
          h.quantity + extra > MAX_TICKET_PURCHASE_QUANTITY
        )
          throw new Error(
            l(
              "أدخل كمية إضافة صحيحة وغير سالبة للمستودع",
              "Enter a valid non-negative warehouse extra quantity",
              "گودام کی درست غیر منفی اضافی مقدار درج کریں"
            )
          );
        params.set("ticketWarehouseExtraQuantity", String(extra));
        params.set(
          "ticketTechnicianQuantity",
          String(state!.needs.find(n => n.id === needId)!.requested)
        );
        params.set("ticketCatalogItemId", String(h.catalogItemId));
        params.set("ticketItemName", h.name);
        params.set("ticketUnit", h.unit);
        params.set("ticketMinimumQuantity", String(h.quantity));
        params.set("siteId", String(h.location.siteId));
        params.set("sectionId", String(h.location.sectionId));
        if (h.location.assetId)
          params.set("assetId", String(h.location.assetId));
        params.set(
          "prefillNotes",
          `مواد فريق تذكرة الصيانة ${h.ticketNumber} — الاستلام بالمستودع الرئيسي ثم التحويل لمستودع الفريق`
        );
      }
      window.location.assign(
        `${kind === "transfer" ? "/warehouse/transfer" : "/purchase-orders/new"}?${params}`
      );
    } catch (e: any) {
      setError(e.message);
      await details.refetch();
    } finally {
      setBusy(false);
    }
  }
  async function run(
    kind: string,
    payload: unknown,
    work: (command: {
      assignmentId: number;
      expectedRevision: number;
      operationKey: string;
    }) => Promise<unknown>
  ): Promise<boolean> {
    if (!a || busy) return false;
    const fingerprint = JSON.stringify({ kind, payload });
    if (retry.current?.fingerprint !== fingerprint)
      retry.current = { fingerprint, key: `mtt:${crypto.randomUUID()}` };
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await work({
        assignmentId,
        expectedRevision: a.revision,
        operationKey: retry.current.key,
      });
      retry.current = null;
      setReviewNote("");
      setMessage(l("تم حفظ الإجراء", "Action saved", "کارروائی محفوظ ہو گئی"));
      await Promise.all([
        details.refetch(),
        utils.ticketTeamExecution.balances.invalidate(),
        utils.ticketTeamAssignments.queue.invalidate(),
        utils.ticketTeamAssignments.warehouseRequests.invalidate(),
        utils.materialCosts.invalidate(),
      ]);
      onChanged();
      return true;
    } catch (e: any) {
      setError(
        e.message || l("تعذر تنفيذ الإجراء", "Action failed", "کارروائی ناکام")
      );
      if (e.data?.code === "CONFLICT") await details.refetch();
      return false;
    } finally {
      setBusy(false);
    }
  }
  if (details.isLoading)
    return (
      <p>
        {l(
          "جاري تحميل الإجراءات…",
          "Loading actions…",
          "کارروائیاں لوڈ ہو رہی ہیں…"
        )}
      </p>
    );
  if (details.error)
    return (
      <p role="alert" className="text-destructive">
        {details.error.message}
      </p>
    );
  if (!state || !a) return null;
  const materialRecipients = state.users.filter(
    u =>
      u.active &&
      (canExecuteAllTicketTeams(u.role) ||
        (["technician", "it_manager", "it_member"].includes(u.role) &&
          state.memberships.some(
            m => m.teamId === a.teamId && m.userId === u.id && m.active
          )))
  );
  const current = state.needs.filter(n => n.round === a.materialRound);
  const selectClass =
    "h-10 rounded-md border border-input bg-background px-3 text-sm w-full";
  const review = (
    decision:
      | "return_to_team"
      | "approve_result"
      | "approve_external"
      | "external_handover"
  ) =>
    void run(
      "review",
      {
        decision,
        note: reviewNote,
        recipientId:
          decision === "external_handover" ? Number(recipient) : undefined,
      },
      c =>
        utils.client.ticketTeamExecution.review.mutate({
          ...c,
          decision,
          note: reviewNote,
          ...(decision === "external_handover"
            ? { recipientId: Number(recipient) }
            : {}),
        })
    );
  return (
    <div className="space-y-5" aria-busy={busy}>
      {mode === "execution" && <ExternalRouteReviewPanel ticketId={a.ticketId} ticketItemId={a.ticketItemId} onChanged={() => { void details.refetch(); onChanged(); }} />}
      {mode === "execution" && <MaterialCostPanel source="ticket" id={a.ticketId} />}
      {warehouseNeedId == null && (
        <p className="font-medium">{ticketExecutionSession(state, a).working ? l("قيد التنفيذ", "In progress", "کام جاری ہے") : label(a.stage)}</p>
      )}
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="text-primary">
          {message}
        </p>
      )}
      {technician && role === "technician" && <ExecutionElapsedTime language={language} startedAt={ticketExecutionSession(state, a).visits.at(-1)?.startedAt} endedAt={ticketExecutionSession(state, a).visits.at(-1)?.endedAt} />}
      {technician && <TicketExecutionControls
        key={a.id}
        state={state} assignment={a} actorId={actorId} language={language} busy={busy}
        onStart={resume => run(resume ? "resume_item" : "start_item", { resume }, c =>
          resume ? utils.client.ticketTeamExecution.resumeItem.mutate(c) : utils.client.ticketTeamExecution.startItem.mutate(c))}
        onEndVisit={() => run("end_visit", {}, c => utils.client.ticketTeamExecution.endVisit.mutate(c))}
        onNeedsMaterial={() => run("begin_material_need", {}, c => utils.client.ticketTeamExecution.beginMaterialNeed.mutate(c))}
        onOutcome={(outcome, input) => run("outcome", { outcome, ...input }, c => utils.client.ticketTeamExecution.outcome.mutate({ ...c, outcome, ...input }))}
      />}
      {technician && a.stage === "waiting_material" && (
        <TicketMaterialNeedPanel
          assignmentId={assignmentId}
          currentNeeds={current}
          warehouseName={
            state.warehouses.find(w => w.id === a.warehouseId)?.name ?? ""
          }
          language={language}
          busy={busy}
          onSubmit={(need, confirmReceipt) =>
            run("register_material_need", { need, confirmReceipt }, c =>
              utils.client.ticketTeamExecution.registerMaterialNeed.mutate({
                ...c,
                need,
                confirmReceipt,
              })
            )
          }
        />
      )}
      {technician && <TicketTechnicianMaterials state={state} assignment={a} balances={balances.data ?? []} language={language} busy={busy}
        onReceive={needId => run("receive", { needId }, c => utils.client.ticketTeamExecution.receive.mutate({ ...c, needId }))} />}
      {!!state.needs.length && !technician && (
        <div className="space-y-3">
          {warehouseNeedId == null && (
            <h3 className="font-semibold">
              {l(
                "المواد والاستلام والاستخدام والمرتجع",
                "Materials, receipt, usage and returns",
                "مواد، وصولی، استعمال اور واپسی"
              )}
            </h3>
          )}
          {state.needs.map(n => {
            if (
              mode === "warehouse" &&
              warehouseNeedId != null &&
              n.id !== warehouseNeedId
            )
              return null;
            const balance = balances.data?.find(b => b.needId === n.id),
              pending = state.supplies.filter(
                s => s.needId === n.id && s.status === "pending"
              ),
              left = n.requested - issued(state, n.id),
              supplyRemaining = materialSupplyRemaining(state, n) ?? 0,
              shortage = Math.max(
                0,
                left - (balance?.branch ?? 0),
                supplyRemaining
              ),
              purchaseQuantity = balance
                ? Math.max(
                    0,
                    shortage -
                      balance.main -
                      pending.reduce((sum, s) => sum + s.quantity, 0)
                  )
                : null,
              extraText = warehouseExtras[n.id] ?? "0",
              extraValid =
                validWarehouseExtra(Number(extraText)) &&
                n.requested + Number(extraText) <= MAX_TICKET_PURCHASE_QUANTITY,
              returns = remainingReturn(state, n.id),
              lots = Array.from(
                new Set(
                  state.deliveries
                    .filter(d => d.needId === n.id)
                    .map(d => d.lotId)
                )
              );
            const candidate = issueRecipients[n.id] ?? String(n.requestedById);
            const selectedRecipient = materialRecipients.some(
              u => u.id === Number(candidate)
            )
              ? candidate
              : "";
            if (
              warehouseSection &&
              materialSection(state, n, balance?.branch) !== warehouseSection
            )
              return null;
            return (
              <TicketWarehouseMaterialCard
                key={n.id}
                state={state}
                need={n}
                balance={balance}
                balanceError={balances.error?.message}
                ticket={warehouseTicket}
                language={language}
                warehouse={mode === "warehouse" && warehouseNeedId != null}
                onReviewIdentity={warehouse && a.stage === "waiting_material" && n.round === a.materialRound && canReviewTicketMaterialQuantity(state, n)
                  ? () => { setCatalogNeedId(n.id); setError(""); } : undefined}
                quantityFields={
                  <>
                    {warehouse &&
                      a.stage === "waiting_material" &&
                      n.round === a.materialRound &&
                      left > 0 && (
                        <WarehousePurchaseQuantities
                          id={`need-${assignmentId}-${n.id}`}
                          technicianQuantity={n.requested}
                          purchaseQuantity={
                            n.catalogItemId == null ? null : purchaseQuantity
                          }
                          extra={extraText}
                          unit={n.unit}
                          language={language}
                          disabled={busy || pending.length > 0}
                          onExtraChange={value =>
                            setWarehouseExtras(prev => ({
                              ...prev,
                              [n.id]: value,
                            }))
                          }
                        />
                      )}
                  </>
                }
              >
                {technician &&
                  a.stage === "waiting_material" &&
                  n.round === a.materialRound &&
                  left > 0 &&
                  n.catalogItemId != null && (
                    <TicketMaterialReceiptButton
                      name={n.name}
                      quantity={left}
                      unit={n.unit}
                      warehouseName={
                        state.warehouses.find(w => w.id === a.warehouseId)
                          ?.name ?? ""
                      }
                      language={language}
                      busy={busy}
                      disabled={
                        !balance || balance.branch < left || supplyRemaining > 0
                      }
                      onConfirm={() =>
                        run("receive", { needId: n.id }, c =>
                          utils.client.ticketTeamExecution.receive.mutate({
                            ...c,
                            needId: n.id,
                          })
                        )
                      }
                    />
                  )}
                {warehouse &&
                  a.stage === "waiting_material" &&
                  n.round === a.materialRound && (
                    <>
                      {n.catalogItemId == null ? (
                        <Button type="button" className="w-full" disabled={busy || !!details.error}
                          onClick={() => { setCatalogNeedId(n.id); setError(""); }}>
                          <Link2 className="me-1 h-4 w-4" />
                          {(language === "ar" ? ar : language === "ur" ? ur : en).workflow.pmv2.identifyFromCatalog}
                        </Button>
                      ) : (
                        <div className="space-y-3">
                          {balance &&
                          balance.branch >= left &&
                          left > 0 &&
                          supplyRemaining === 0 ? (
                            <div className="grid gap-3 rounded-lg border bg-muted/10 p-3 sm:grid-cols-[1fr_auto] sm:items-end">
                              <div className="sm:col-span-2"><TicketWarehouseLotSelection assignmentId={assignmentId} needId={n.id} required={left} unit={n.unit}
                                value={issueSelections[n.id]||{mode:"fifo"}} onChange={selection=>setIssueSelections(old=>({...old,[n.id]:selection}))}
                                onReadyChange={ready=>setIssueSelectionReady(old=>old[n.id]===ready?old:{...old,[n.id]:ready})} disabled={busy} language={language}/></div>
                              <div>
                                <label
                                  htmlFor={`ticket-recipient-${assignmentId}-${n.id}`}
                                  className="mb-1 block text-xs font-medium"
                                >
                                  {pmv2.actualRecipient}
                                </label>
                                <select
                                  id={`ticket-recipient-${assignmentId}-${n.id}`}
                                  className={selectClass}
                                  aria-label={pmv2.actualRecipient}
                                  value={selectedRecipient}
                                  disabled={busy}
                                  onChange={e =>
                                    setIssueRecipients({
                                      ...issueRecipients,
                                      [n.id]: e.target.value,
                                    })
                                  }
                                >
                                  <option value="">
                                    {l(
                                      "اختر المستلم",
                                      "Choose recipient",
                                      "وصول کنندہ منتخب کریں"
                                    )}
                                  </option>
                                  {state.users
                                    .filter(
                                      u =>
                                        u.active &&
                                        (canExecuteAllTicketTeams(u.role) ||
                                          (u.role === "technician" &&
                                            state.memberships.some(
                                              m =>
                                                m.teamId === a.teamId &&
                                                m.userId === u.id &&
                                                m.active
                                            )))
                                    )
                                    .map(u => (
                                      <option key={u.id} value={u.id}>
                                        {u.name}
                                        {u.id === n.requestedById
                                          ? ` — ${pmv2.materialRequesterSuffix}`
                                          : ""}
                                      </option>
                                    ))}
                                </select>
                              </div>
                              <Button
                                disabled={busy || !Number(selectedRecipient) || issueSelectionReady[n.id]===false}
                                className="gap-2"
                                onClick={() =>
                                  void run(
                                    "warehouse_issue",
                                    {
                                      needId: n.id,
                                      recipientId: Number(selectedRecipient),
                                      selection:issueSelections[n.id]||{mode:"fifo"},
                                    },
                                    c =>
                                      utils.client.ticketTeamExecution.issue.mutate(
                                        {
                                          ...c,
                                          needId: n.id,
                                          recipientId:
                                            Number(selectedRecipient),
                                          selection:issueSelections[n.id]||{mode:"fifo"},
                                        }
                                      )
                                  )
                                }
                              >
                                {busy ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <Send className="h-4 w-4" />
                                )}
                                {pmv2.issueFullNeed}
                              </Button>
                            </div>
                          ) : (
                            <>
                              {balance &&
                                shortage > 0 &&
                                pending.length === 0 &&
                                balance.main >= shortage && (
                                  <Button
                                    disabled={
                                      busy ||
                                      !balance ||
                                      shortage <= 0 ||
                                      pending.length > 0 ||
                                      balance.main < shortage
                                    }
                                    className="w-full gap-2"
                                    onClick={() =>
                                      void openSupply(n.id, "transfer")
                                    }
                                  >
                                    {busy ? (
                                      <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                      <ArrowLeftRight className="h-4 w-4" />
                                    )}
                                    {supplyLabel(
                                      pmv2.transferShortage,
                                      shortage,
                                      n.unit
                                    )}
                                  </Button>
                                )}
                              {balance &&
                                purchaseQuantity != null &&
                                purchaseQuantity > 0 && (
                                  <Button
                                    variant="outline"
                                    disabled={
                                      busy ||
                                      !balance ||
                                      !extraValid ||
                                      shortage -
                                        balance.main -
                                        pending.reduce(
                                          (sum, s) => sum + s.quantity,
                                          0
                                        ) <=
                                        0
                                    }
                                    className="w-full gap-2"
                                    onClick={() =>
                                      void openSupply(n.id, "purchase")
                                    }
                                  >
                                    {busy ? (
                                      <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                      <ShoppingCart className="h-4 w-4" />
                                    )}
                                    {supplyLabel(
                                      pmv2.createPurchaseShortage,
                                      purchaseQuantity,
                                      n.unit
                                    )}
                                  </Button>
                                )}
                            </>
                          )}
                        </div>
                      )}
                      {pending
                        .filter(s => s.kind === "purchase")
                        .map(s => (
                          <div key={s.id} className="flex flex-wrap gap-2">
                            <span dir="ltr">{s.sourceNumber}</span>
                            <Button
                              variant="outline"
                              disabled={busy}
                              onClick={() =>
                                void run(
                                  "purchaseReceipt",
                                  { supplyId: s.id },
                                  c =>
                                    utils.client.ticketTeamExecution.purchaseReceipt.mutate(
                                      { ...c, supplyId: s.id }
                                    )
                                )
                              }
                            >
                              {l(
                                "تحقق من الاستلام الفعلي بالمستودع الرئيسي",
                                "Verify actual main warehouse receipt",
                                "مرکزی گودام کی اصل وصولی کی تصدیق"
                              )}
                            </Button>
                          </div>
                        ))}
                    </>
                  )}
                {state.deliveries
                  .filter(d => d.needId === n.id)
                  .map(d => (
                    <p
                      key={d.id}
                      className="text-sm text-muted-foreground"
                      dir="auto"
                    >
                      {d.deliveryNumber} — {l("اللوت", "Lot", "لاٹ")} #{d.lotId}{" "}
                      — {d.quantity} {d.physicalUnit || n.unit} —{" "}
                      {d.replacementName && <span className="font-medium">{l("بديل معتمد", "Approved replacement", "منظور شدہ متبادل")}: {d.replacementName} ({d.originalEquivalent} {n.unit}) — </span>}
                      {l("المستلم", "Recipient", "وصول کنندہ")}:{" "}
                      {state.users.find(u => u.id === d.receivedById)?.name ??
                        `#${d.receivedById}`}
                    </p>
                  ))}
                {warehouse && returns > 0 && (
                  <div className="space-y-2">
                    {lots.length > 1 &&
                      lots.map(lotId => (
                        <label className="flex items-center gap-2" key={lotId}>
                          {l("مرتجع اللوت", "Return from lot", "لاٹ کی واپسی")}{" "}
                          #{lotId}
                          {" "}{state.deliveries.find(d => d.needId === n.id && d.lotId === lotId)?.physicalUnit || n.unit}
                          <Input
                            className="w-24"
                            type="number"
                            min={0}
                            step={1}
                            disabled={busy}
                            value={allocations[`${n.id}:${lotId}`] ?? 0}
                            onChange={e =>
                              setAllocations({
                                ...allocations,
                                [`${n.id}:${lotId}`]: Number(e.target.value),
                              })
                            }
                          />
                        </label>
                      ))}
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() => {
                        const distribution =
                          lots.length > 1
                            ? lots
                                .map(lotId => ({
                                  lotId,
                                  quantity:
                                    allocations[`${n.id}:${lotId}`] ?? 0,
                                }))
                                .filter(x => x.quantity > 0)
                            : undefined;
                        void run(
                          "return",
                          { needId: n.id, allocations: distribution },
                          c =>
                            utils.client.ticketTeamExecution.returnMaterial.mutate(
                              { ...c, needId: n.id, allocations: distribution }
                            )
                        );
                      }}
                    >
                      {l(
                        "تأكيد استلام المرتجع للمستودع",
                        "Confirm physical return to warehouse",
                        "گودام میں واپسی وصول کرنے کی تصدیق"
                      )}
                    </Button>
                  </div>
                )}
              </TicketWarehouseMaterialCard>
            );
          })}
          {balances.error && (
            <p role="alert" className="text-destructive">
              {balances.error.message}
            </p>
          )}
        </div>
      )}
      {warehouseNeedId == null &&
        state.actions.filter(x => x.assignmentId === a.id && ["external_route_returned", "external_route_decided"].includes(x.kind)).sort((x, y) => y.revision - x.revision)[0]?.kind !== "external_route_returned" &&
        ((manager &&
          ["awaiting_review", "blocked", "external_requested"].includes(
            a.stage
          )) ||
          (warehouse &&
            ["waiting_material", "external_in_progress"].includes(
              a.stage
            ))) && (
          <div className="space-y-3 rounded-lg border p-4">
            <Label htmlFor={`review-${assignmentId}`}>
              {l(
                "ملاحظات المسؤول / المستودع (إلزامي)",
                "Manager / warehouse notes (required)",
                "ذمہ دار / گودام کے نوٹس (ضروری)"
              )}
            </Label>
            <Textarea
              id={`review-${assignmentId}`}
              value={reviewNote}
              maxLength={4000}
              disabled={busy}
              onChange={e => setReviewNote(e.target.value)}
            />
            <div className="flex flex-wrap gap-2">
              {manager && a.stage === "awaiting_review" && (
                <Button
                  disabled={busy || !reviewNote.trim()}
                  onClick={() => review("approve_result")}
                >
                  {l(
                    "اعتماد نتيجة الفريق",
                    "Approve team result",
                    "ٹیم کے نتیجے کی منظوری"
                  )}
                </Button>
              )}
              {manager &&
                ["awaiting_review", "blocked", "external_requested"].includes(
                  a.stage
                ) && (
                  <Button
                    variant="outline"
                    disabled={busy || !reviewNote.trim()}
                    onClick={() => review("return_to_team")}
                  >
                    {l("إعادة للفريق", "Return to team", "ٹیم کو واپس کریں")}
                  </Button>
                )}
              {manager && a.stage === "external_requested" && (
                <Button
                  disabled={busy || !reviewNote.trim()}
                  onClick={() => review("approve_external")}
                >
                  {l(
                    "اعتماد الصيانة الخارجية — المسار C",
                    "Approve external maintenance — path C",
                    "بیرونی مرمت کی منظوری — راستہ C"
                  )}
                </Button>
              )}
            </div>
            {warehouse && a.stage === "external_in_progress" && (
              <>
                <a
                  className="text-primary underline"
                  href="/external-maintenance"
                >
                  {l(
                    "متابعة دورة الصيانة الخارجية",
                    "Open external maintenance workflow",
                    "بیرونی مرمت کا عمل کھولیں"
                  )}
                </a>
                <select
                  aria-label={l(
                    "الفني المستلم",
                    "Receiving technician",
                    "وصول کرنے والا ٹیکنیشن"
                  )}
                  className={selectClass}
                  value={recipient}
                  disabled={busy}
                  onChange={e => setRecipient(e.target.value)}
                >
                  <option value="">
                    {l(
                      "اختر الفني المستلم من الفريق",
                      "Select actual team recipient",
                      "ٹیم سے اصل وصول کنندہ منتخب کریں"
                    )}
                  </option>
                  {state.memberships
                    .filter(m => m.active)
                    .flatMap(m =>
                      state.users.filter(
                        u =>
                          u.id === m.userId &&
                          u.active &&
                          u.role === "technician"
                      )
                    )
                    .map(u => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                </select>
                <Button
                  disabled={busy || !recipient || !reviewNote.trim()}
                  onClick={() => review("external_handover")}
                >
                  {l(
                    "تسليم الأصل بعد عودته لإعادة التركيب",
                    "Hand over returned asset for reinstallation",
                    "واپس آئے اثاثے کو دوبارہ تنصیب کے لیے حوالے کریں"
                  )}
                </Button>
              </>
            )}
          </div>
        )}
      {manager && a.stage === "closed" && (
        <a className="text-primary underline" href={`/tickets/${a.ticketId}`}>
          {l(
            "متابعة اعتماد وإغلاق البلاغ",
            "Continue ticket verification and closure",
            "ٹکٹ کی تصدیق اور بندش جاری رکھیں"
          )}
        </a>
      )}
      {warehouseNeedId == null && (
        <details className="rounded-lg border p-3">
          <summary className="cursor-pointer font-medium">
            {l(
              "سجل إجراءات الفريق",
              "Team action history",
              "ٹیم کی کارروائیوں کا ریکارڈ"
            )}
          </summary>
          <div className="space-y-3 pt-3">
            {state.actions.map(x => (
              <div key={x.id} className="border-b pb-2">
                <p className="text-sm text-muted-foreground">
                  {state.users.find(u => u.id === x.actorId)?.name ??
                    `#${x.actorId}`}{" "}
                  — {x.at}
                </p>
                <p className="whitespace-pre-wrap">
                  {ticketSessionActionText(x, language) ?? x.translatedNote ?? materialActionMessage(x.note)}
                </p>
              </div>
            ))}
          </div>
        </details>
      )}
      {catalogNeed && <TicketMaterialIdentityResolver
        key={`${a.id}:${catalogNeed.id}:${catalogNeed.round}`}
        assignment={a} need={catalogNeed} language={language} busy={busy} error={error}
        onClose={() => setCatalogNeedId(null)}
        onConfirm={(catalogItemId, note, requestedQuantity) => run("resolve", { needId: catalogNeed.id, catalogItemId, note, requestedQuantity }, c =>
          utils.client.ticketTeamExecution.resolve.mutate({ ...c, needId: catalogNeed.id, catalogItemId, note, requestedQuantity }))}
      />}
    </div>
  );
}
