import { Badge } from "@/components/ui/badge";
import { TicketMaterialReceiptButton } from "./TicketMaterialNeedPanel";
import ar from "@/i18n/ar";
import en from "@/i18n/en";
import ur from "@/i18n/ur";
import { issued, remainingReturn, type Assignment, type Snapshot } from "@shared/maintenance-team-tickets/model";
import { materialSupplyRemaining, materialUnitMismatch } from "@shared/maintenance-team-tickets/material-routing";

export function TicketTechnicianMaterials({ state, assignment: a, balances, busy, language, onReceive }: {
  state: Snapshot; assignment: Assignment; balances: Array<{ needId: number; branch: number; main: number }>;
  busy: boolean; language: string; onReceive: (needId: number) => Promise<boolean>;
}) {
  const t = (language === "ar" ? ar : language === "ur" ? ur : en).workflow.pmv2;
  const l = (a: string, e: string, u: string) => language === "ar" ? a : language === "ur" ? u : e;
  const needs = state.needs.filter(n => n.assignmentId === a.id);
  if (!needs.length) return null;
  const warehouseName = state.warehouses.find(w => w.id === a.warehouseId)?.name ?? "";
  return <div className="space-y-3 sm:max-w-[420px]">
    <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">{l("المواد والاستلام والاستخدام والمرتجع", "Materials, receipt, usage and returns", "مواد، وصولی، استعمال اور واپسی")}<Badge variant="secondary">{needs.length}</Badge></div>
    {needs.map(n => {
      const left = Math.max(0, n.requested - issued(state, n.id));
      const differentUnit = materialUnitMismatch(state, n);
      const balance = differentUnit ? undefined : balances.find(b => b.needId === n.id);
      const supplyRemaining = materialSupplyRemaining(state, n);
      const canReceive = a.stage === "waiting_material" && n.round === a.materialRound && n.catalogItemId != null && left > 0 && !!balance && balance.branch >= left && (supplyRemaining ?? 0) === 0;
      const waitingIdentity = n.catalogItemId == null;
      const waitingSupply = state.supplies.some(s => s.needId === n.id && s.status === "pending");
      const returnLeft = Math.max(0, remainingReturn(state, n.id));
      return <div key={n.id} className={`space-y-1.5 rounded-md border p-2 text-xs ${canReceive ? "border-emerald-200 bg-emerald-50/70" : ""}`}>
        <div className="flex flex-wrap items-center justify-between gap-2"><span>{n.name} — {n.requested} {n.unit}</span><Badge variant="outline" className={canReceive ? "border-emerald-300 text-emerald-800" : ""}>{canReceive ? t.readyReceiveTeamStore : waitingIdentity ? t.waitingIdentity : left === 0 ? l("تم الاستلام", "Received", "موصول") : waitingSupply ? t.waitingSupply : t.waitingMainWarehouse}</Badge></div>
        {!!n.originalName && n.originalName !== n.name && <div className="rounded border border-blue-200 bg-blue-50/60 p-2 text-blue-900"><p className="font-medium">{t.warehouseIdentifiedMaterial}</p><p>{t.yourDescription}: «{n.originalName}»</p><p>{t.resolvedItem}: <strong>{n.name}</strong></p></div>}
        <p>{t.issuedForTask}: {issued(state, n.id)} {n.unit} · {t.remainingForTask}: {left} {n.unit}</p>
        {balance && <p className={canReceive ? "text-emerald-800" : "text-amber-800"}>{t.availableNow}: {balance.branch} {n.unit}. {t.requiredForFullReceipt}: {left} {n.unit}.</p>}
        {a.stage === "waiting_material" && left > 0 && !balance && !differentUnit && <p className="text-muted-foreground">{t.recheckingBalance}</p>}
        {differentUnit && <p className="text-amber-800">{l("تم ربط الصنف؛ وحدة الكتالوج مختلفة وتحتاج مراجعة قبل الاستلام.", "Item linked; catalog unit differs and needs review before receipt.", "صنف منسلک ہوگیا؛ وصولی سے پہلے مختلف اکائی کا جائزہ درکار ہے۔")}</p>}
        {waitingIdentity && <p className="text-amber-800">{l("بانتظار تحديد المستودع للصنف والوحدة.", "Awaiting catalog identification by the warehouse.", "گودام سے کیٹلاگ کی شناخت کا انتظار۔")}</p>}
        {state.supplies.filter(s => s.needId === n.id).map(s => <p key={s.id}><span className="font-medium">{s.sourceNumber}</span> · {s.quantity} {s.physicalUnit ?? n.unit}{s.replacementName && <> · {s.replacementName} ({s.originalEquivalent} {n.unit})</>}</p>)}
        {canReceive && <TicketMaterialReceiptButton name={n.name} quantity={left} unit={n.unit} warehouseName={warehouseName} language={language} busy={busy} disabled={!canReceive} onConfirm={() => onReceive(n.id)} />}
        {n.used !== null && <p>{t.usedQuantityLabel}: {n.used} {n.unit} · {l("المرتجع المعلق", "Pending return", "زیر التوا واپسی")}: {returnLeft} {n.unit}</p>}
        {state.deliveries.filter(d => d.needId === n.id && (d.replacementName || (n.used === null && d.used !== null))).map(d => <p key={`actual-${d.id}`}>
          {d.replacementName ?? n.name} — {d.quantity} {d.physicalUnit ?? n.unit}
          {d.used !== null && <> · {t.usedQuantityLabel}: {d.used} · {l("المرتجع المعلق", "Pending return", "زیر التوا واپسی")}: {Math.max(0, d.quantity - d.used - d.returned)} {d.physicalUnit ?? n.unit}</>}
        </p>)}
      </div>;
    })}
  </div>;
}
