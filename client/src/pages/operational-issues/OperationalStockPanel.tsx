import { useRef, useState } from "react";
import { useTranslation } from "@/contexts/LanguageContext";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  const [selected, setSelected] = useState(""); const [quantity, setQuantity] = useState(remaining);
  const busy = useRef(false); const key = useRef<{ value: string; key: string } | null>(null);
  const issue = trpc.operationalIssues.issue.useMutation();
  const purchase = trpc.operationalIssues.addToPurchaseDraft.useMutation();
  const lotKey = (lot: NonNullable<OperationalStock>["lots"][number]) => `${lot.warehouseId}:${lot.inventoryId}:${lot.lotId}`;
  const lot = stock?.lots.find(choice => lotKey(choice) === selected);
  const maximum = lot ? (stock?.fulfillment ? lot.quantity : Math.min(remaining, lot.quantity)) : 0;
  const disabled = loading || issue.isPending || purchase.isPending;
  const submit = async () => {
    if (busy.current || !approved || !canProcess || !lot || !Number.isInteger(quantity) || quantity < 1 || quantity > maximum) return;
    busy.current = true;
    const fingerprint = JSON.stringify([orderId, line.id, lot.warehouseId, lot.trackingToken, quantity]);
    if (!key.current || key.current.value !== fingerprint) key.current = { value: fingerprint, key: crypto.randomUUID() };
    try {
      await issue.mutateAsync({ orderId, itemId: Number(line.id), warehouseId: lot.warehouseId, lotTrackingToken: lot.trackingToken, quantity, operationKey: key.current.key });
      key.current = null; setSelected(""); toast.success(text.success);
    } catch (error) { toast.error(error instanceof Error ? error.message : text.error); }
    finally { try { await refresh(); } finally { busy.current = false; } }
  };
  const addToDraft = async () => {
    if (busy.current || disabled || !approved || !canProcess || !procurementReady || !stock || stock.totalQuantity !== 0 || stock.needsReview || stock.purchase || remaining <= 0) return;
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
        {stock.lots.length > 0 && <div className="space-y-2">
          <Label htmlFor={`operational-lot-${line.id}`}>{text.chooseLot}</Label>
          <select id={`operational-lot-${line.id}`} className="w-full h-10 rounded-md border bg-background px-2" value={selected}
            disabled={!canProcess || !approved || disabled || remaining <= 0} onChange={e => {
              setSelected(e.target.value); const choice = stock.lots.find(value => lotKey(value) === e.target.value);
              if (choice) setQuantity(stock.fulfillment ? Math.floor(choice.quantity) : Math.min(remaining, Math.floor(choice.quantity)));
            }}>
            <option value="">{text.chooseLot}</option>
            {stock.lots.map(choice => <option key={lotKey(choice)} value={lotKey(choice)}>
              {choice.replacementName ? `${choice.replacementName} · ` : ""}{choice.lotCode} — {language === "ar" ? choice.warehouseNameAr : choice.warehouseNameEn || choice.warehouseNameAr} — {choice.quantity} {choice.unit}
            </option>)}
          </select>
        </div>}
        {canProcess && approved && remaining > 0 && <>
          {lot && <div className="rounded-lg border bg-muted/30 p-3 space-y-3">
            <p className="text-sm">{lot.lotCode} · {text.available}: {lot.quantity} {lot.unit}</p>
            <div><Label htmlFor={`operational-quantity-${line.id}`}>{text.quantity} ({lot.unit})</Label><Input id={`operational-quantity-${line.id}`} type="number" min={1} max={maximum} step={1} value={quantity} disabled={disabled} onChange={e => setQuantity(Number(e.target.value))} /></div>
            <p className="text-sm">{text.totalCost}: {(lot.unitCost * quantity).toFixed(2)} {text.currency}</p>
            <Button disabled={disabled || !Number.isInteger(quantity) || quantity < 1 || quantity > maximum} onClick={() => void submit()}>{text.issue}</Button>
          </div>}
          {stock.totalQuantity === 0 && !stock.needsReview && !stock.purchase && <div className="rounded-lg border border-amber-200 bg-amber-50/40 p-3 space-y-2">
            <p className="text-sm">{text.zeroStock}</p>
            {procurementReady ? <Button variant="outline" disabled={disabled} onClick={() => void addToDraft()}>{text.addToDraft} — {remaining} {line.unit}</Button>
              : <p className="text-sm text-muted-foreground">{text.procurementUnavailable}</p>}
          </div>}
        </>}
      </>}
    </>}
  </section>;
}
