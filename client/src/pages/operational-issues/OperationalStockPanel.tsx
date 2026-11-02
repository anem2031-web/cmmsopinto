import { useRef, useState } from "react";
import { WarehouseLotSelection } from "@/components/inventory/WarehouseLotSelection";
import { selectFullIssueLots, type WarehouseLotSelection as LotSelection } from "@shared/warehouse-lot-selection";
import { useTranslation } from "@/contexts/LanguageContext";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { operationalIssueText } from "@/i18n/operationalIssues";
import { operationalDispatchText } from "@/i18n/operationalDispatch";
import type { OperationalLine, OperationalStock } from "@shared/operational-issues";

export function OperationalStockPanel({ line, stock, orderId, approved, canProcess, showStock, loading, procurementReady, refresh }: {
  line: OperationalLine; stock?: OperationalStock; orderId: number; approved: boolean; canProcess: boolean;
  showStock: boolean; loading: boolean; procurementReady: boolean; refresh(): Promise<void>;
}) {
  const { language } = useTranslation(); const text = operationalIssueText[language];
  const remaining = Math.max(0, Number(line.quantity) - Number(line.issuedQuantity));
  const [warehouse,setWarehouse]=useState(""); const [selection,setSelection]=useState<LotSelection>({mode:"fifo"});
  const quantity=remaining;
  const busy = useRef(false); const key = useRef<{ value: string; key: string } | null>(null);
  const issue = trpc.operationalIssues.issue.useMutation();
  const purchase = trpc.operationalIssues.addToPurchaseDraft.useMutation();
  const warehouseId=Number(warehouse||stock?.lots[0]?.warehouseId||0);
  const lots=stock?.lots.filter(lot=>lot.warehouseId===warehouseId)||[];
  let plan: typeof lots = [];
  try{if(stock&&!stock.needsReview)plan=selection.mode==="fifo"&&stock.fulfillment?.ready&&stock.fulfillment.allocations.every(lot=>lot.warehouseId===warehouseId)
    ? stock.fulfillment.allocations : selectFullIssueLots(lots,remaining,line.unit,selection);}catch{}
  const ready=plan.length>0;
  const disabled = loading || issue.isPending || purchase.isPending;
  const submit = async () => {
    if (busy.current || !approved || !canProcess || !ready || !Number.isInteger(quantity) || quantity < 1) return;
    busy.current = true;
    const fingerprint = JSON.stringify([orderId, line.id, warehouseId, selection, quantity]);
    if (!key.current || key.current.value !== fingerprint) key.current = { value: fingerprint, key: crypto.randomUUID() };
    try {
      await issue.mutateAsync({ orderId, itemId: Number(line.id), warehouseId, selection, quantity, operationKey: key.current.key });
      key.current = null; setSelection({mode:"fifo"}); toast.success(text.success);
    } catch (error) { toast.error(error instanceof Error ? error.message : text.error); }
    finally { try { await refresh(); } finally { busy.current = false; } }
  };
  const addToDraft = async () => {
    if (busy.current || disabled || !approved || !canProcess || !procurementReady || !stock || stock.totalQuantity >= remaining || stock.needsReview || stock.purchase || remaining <= 0) return;
    busy.current = true;
    try { await purchase.mutateAsync({ orderId, itemId: Number(line.id) }); toast.success(text.draftAdded); }
    catch (error) { toast.error(error instanceof Error ? error.message : text.error); }
    finally { try { await refresh(); } finally { busy.current = false; } }
  };
  return <section className="rounded-lg border p-4 space-y-3">
    <p className="font-semibold">{line.itemName}</p>
    <p className="text-sm text-muted-foreground">{text.requested}: {line.quantity} {line.unit} · {text.issued}: {line.issuedQuantity} {line.unit} · {text.remaining}: {remaining} {line.unit}</p>
    {showStock && <>
      {loading && !stock && <p>{text.load}</p>}
      {stock && <>
        {stock.fulfillment?.replacements.map(replacement => <p key={replacement.planId} className="text-sm text-primary">{operationalDispatchText[language].replacement}: <a className="underline" href={`/purchase-orders/${replacement.purchaseOrderId}`}>{replacement.itemName}</a> — {replacement.quantity} {replacement.unit}</p>)}
        <p className={`text-sm font-medium ${stock.totalQuantity > 0 ? "text-emerald-700" : "text-amber-700"}`}>{text.totalAvailable}: {stock.totalQuantity} {stock.unit}</p>
        {stock.needsReview && <p role="alert" className="text-sm text-destructive">{text.stockReview}</p>}
        {stock.purchase && <div className="rounded-md border bg-muted/30 p-3 text-sm space-y-1">
          <p>{text.linkedPurchase}: <a className="text-primary underline" href={`/purchase-orders/${stock.purchase.purchaseOrderId}`}>{stock.purchase.poNumber}</a> · {stock.purchase.quantity} {stock.purchase.unit}</p>
          <p className="text-muted-foreground">{text.reviewDraft}</p>
          {stock.purchase.changed && <p role="alert" className="text-destructive">{text.purchaseChanged}</p>}
        </div>}
        {!canProcess&&stock.lots.map(lot=><p key={`${lot.warehouseId}:${lot.lotId}`}>{lot.lotCode} — {lot.warehouseNameAr} — {lot.quantity} {lot.unit}</p>)}
        {canProcess && approved && remaining > 0 && <>
          <div className="rounded-lg border bg-muted/30 p-3 space-y-3">
            <Label>{text.warehouse}</Label><select className="h-10 w-full rounded-md border bg-background px-2" value={String(warehouseId||"")} disabled={disabled} onChange={event=>{setWarehouse(event.target.value);setSelection({mode:"fifo"});}}>
              {!warehouseId&&<option value="">{text.warehouse}</option>}
              {stock.lots.filter((lot,index,all)=>all.findIndex(row=>row.warehouseId===lot.warehouseId)===index).map(lot=><option key={lot.warehouseId} value={String(lot.warehouseId)}>{language==="ar"?lot.warehouseNameAr:lot.warehouseNameEn||lot.warehouseNameAr}</option>)}
            </select>
            <WarehouseLotSelection lots={lots} required={remaining} unit={line.unit} value={selection} onChange={setSelection} disabled={disabled} language={language}/>
            <p className="text-sm">{text.totalCost}: {plan.reduce((sum,lot)=>sum+lot.unitCost*lot.quantity,0).toFixed(2)} {text.currency}</p>
            <Button disabled={disabled || !ready} onClick={() => void submit()}>{text.issue}</Button>
          </div>
          {stock.totalQuantity < remaining && !stock.needsReview && !stock.purchase && <div className="rounded-lg border border-amber-200 bg-amber-50/40 p-3 space-y-2">
            <p className="text-sm">{stock.totalQuantity === 0 ? text.zeroStock : language === "ar" ? "الرصيد لا يغطي كامل الاحتياج؛ ينتظر تغطية العجز." : language === "ur" ? "اسٹاک پوری ضرورت کے لیے ناکافی ہے؛ کمی پوری ہونے کا انتظار ہے۔" : "Stock does not cover the full requirement; waiting for shortage coverage."}</p>
            {procurementReady ? <Button variant="outline" disabled={disabled} onClick={() => void addToDraft()}>{text.addToDraft} — {Math.max(0,remaining-Math.floor(stock.totalQuantity))} {line.unit}</Button>
              : <p className="text-sm text-muted-foreground">{text.procurementUnavailable}</p>}
          </div>}
        </>}
      </>}
    </>}
  </section>;
}
