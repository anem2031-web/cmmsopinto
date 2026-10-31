import { useRef, useState } from "react";
import { useTranslation } from "@/contexts/LanguageContext";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TechnicianCombobox } from "@/components/tickets/TechnicianCombobox";
import { operationalIssueText } from "@/i18n/operationalIssues";
import { operationalDispatchText } from "@/i18n/operationalDispatch";
import {
  allocateOperationalFifo,
  dispatchContext,
} from "@shared/operational-dispatch";
import type {
  OperationalLine,
  OperationalOrder,
  OperationalStock,
} from "@shared/operational-issues";
import { toast } from "sonner";

export function PreparedDispatchPanel({
  order,
  lines,
  stocks,
  canProcess,
  loading,
  procurementReady,
  dispatch,
  refresh,
}: {
  order: OperationalOrder;
  lines: OperationalLine[];
  stocks?: OperationalStock[];
  canProcess: boolean;
  loading: boolean;
  procurementReady: boolean;
  dispatch: Array<{
    itemId: number;
    actualCollectorName: string;
    notes: string;
  }>;
  refresh(): Promise<void>;
}) {
  const { language } = useTranslation();
  const text = operationalIssueText[language],
    t = operationalDispatchText[language];
  const [values, setValues] = useState<
    Record<number, { actualCollectorId: string; notes: string }>
  >({});
  const busy = useRef(false),
    operation = useRef<{ value: string; key: string } | null>(null);
  const recipients = trpc.operationalIssues.choices.useQuery(undefined, {
    enabled: canProcess && order.status === "approved",
  });
  const issue = trpc.operationalIssues.issuePrepared.useMutation(),
    purchase = trpc.operationalIssues.addToPurchaseDraft.useMutation();
  const disabled = loading || issue.isPending || purchase.isPending;
  const allocations = lines.map(line => {
    const stock = stocks?.find(s => s.itemId === Number(line.id));
    try {
      return stock
        ? allocateOperationalFifo(stock, Number(line.quantity))
        : null;
    } catch {
      return null;
    }
  });
  const ready =
    lines.length > 0 &&
    allocations.every(Boolean) &&
    lines.every(l => Number(l.issuedQuantity) === 0);
  const update = (
    id: number,
    patch: Partial<{ actualCollectorId: string; notes: string }>
  ) =>
    setValues(old => ({
      ...old,
      [id]: { ...(old[id] || { actualCollectorId: "", notes: "" }), ...patch },
    }));
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t.fifo}</p>
      {lines.map((line, index) => {
        const context = dispatchContext(line.dispatchContext);
        if (!context)
          return (
            <p key={line.id} role="alert">
              {text.error}
            </p>
          );
        const stock = stocks?.find(s => s.itemId === Number(line.id)),
          saved = dispatch.find(d => d.itemId === Number(line.id));
        return (
          <section key={line.id} className="border rounded-lg p-4 space-y-3">
            <strong>{line.itemName}</strong>
            <p className="text-sm">
              {text.requested}: {line.quantity} {line.unit} · {text.issued}:{" "}
              {line.issuedQuantity} {line.unit}
            </p>
            {stocks?.find(s => s.itemId === Number(line.id))?.fulfillment?.replacements.map(replacement =>
              <p key={replacement.planId} className="text-sm text-primary">{t.replacement}: <a className="underline" href={`/purchase-orders/${replacement.purchaseOrderId}`}>{replacement.itemName}</a> — {replacement.quantity} {replacement.unit}</p>)}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
              <p>
                {text.warehouse}: {context.warehouseName}
              </p>
              <p>
                {text.site}: {context.siteName}
              </p>
              <p>
                {text.section}: {context.sectionName}
              </p>
              <p>
                {text.collector}: {context.collectorName}
              </p>
            </div>
            {stock && (
              <p>
                {t.stock}: {stock.totalQuantity} {stock.unit}
              </p>
            )}
            {order.status !== "completed" && allocations[index] && (
              <p className="text-xs text-muted-foreground">
                {t.current}:{" "}
                {allocations[index]!.map(
                  l => `${l.replacementName ? `${l.replacementName} · ` : ""}${l.lotCode} (${l.quantity} ${l.unit})`
                ).join(" · ")}
              </p>
            )}
            {stock?.needsReview && (
              <p role="alert" className="text-destructive">
                {text.stockReview}
              </p>
            )}
            {saved ? (
              <div className="text-sm">
                <p>
                  {t.actual}: {saved.actualCollectorName}
                </p>
                {saved.notes && (
                  <p>
                    {t.notes}: {saved.notes}
                  </p>
                )}
              </div>
            ) : (
              canProcess &&
              order.status === "approved" && (
                <fieldset
                  disabled={disabled}
                  className="grid grid-cols-1 sm:grid-cols-2 gap-3"
                >
                  <div>
                    <Label>{t.actual}</Label>
                    <TechnicianCombobox
                      options={(recipients.data?.collectors || []).map(u => ({
                        value: String(u.id),
                        label: u.name,
                      }))}
                      value={values[line.id]?.actualCollectorId || ""}
                      onValueChange={actualCollectorId =>
                        update(line.id, { actualCollectorId })
                      }
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={disabled || !values[line.id]?.actualCollectorId}
                      onClick={() => update(line.id, { actualCollectorId: "" })}
                    >
                      {t.fallback}: {context.collectorName}
                    </Button>
                  </div>
                  <div>
                    <Label htmlFor={`dispatch-note-${line.id}`}>
                      {t.notes}
                    </Label>
                    <Input
                      id={`dispatch-note-${line.id}`}
                      value={values[line.id]?.notes || ""}
                      maxLength={2000}
                      onChange={e => update(line.id, { notes: e.target.value })}
                    />
                  </div>
                </fieldset>
              )
            )}
            {stock?.purchase && (
              <p className="text-sm">
                {text.linkedPurchase}:{" "}
                <a
                  className="text-primary underline"
                  href={`/purchase-orders/${stock.purchase.purchaseOrderId}`}
                >
                  {stock.purchase.poNumber}
                </a>
                {stock.purchase.changed && (
                  <span role="alert"> · {text.purchaseChanged}</span>
                )}
              </p>
            )}
            {canProcess &&
              order.status === "approved" &&
              stock?.totalQuantity === 0 &&
              !stock.needsReview &&
              !stock.purchase && (
                <div>
                  <p>{t.noStock}</p>
                  {procurementReady ? (
                    <Button
                      variant="outline"
                      disabled={disabled}
                      onClick={async () => {
                        if (busy.current) return;
                        busy.current = true;
                        try {
                          await purchase.mutateAsync({
                            orderId: Number(order.id),
                            itemId: Number(line.id),
                          });
                          toast.success(text.draftAdded);
                        } catch (e) {
                          toast.error(
                            e instanceof Error ? e.message : text.error
                          );
                        } finally {
                          try {
                            await refresh();
                          } finally {
                            busy.current = false;
                          }
                        }
                      }}
                    >
                      {text.addToDraft}
                    </Button>
                  ) : (
                    <p>{text.procurementUnavailable}</p>
                  )}
                </div>
              )}
          </section>
        );
      })}
      {canProcess && order.status === "approved" && (
        <>
          {!ready && !loading && (
            <p role="status" className="text-amber-700">
              {t.shortage}
            </p>
          )}
          <Button
            disabled={disabled || !ready || recipients.isError}
            onClick={async () => {
              if (busy.current || !ready) return;
              busy.current = true;
              const body = {
                orderId: Number(order.id),
                revision: Number(order.revision),
                items: lines.map(l => ({
                  itemId: Number(l.id),
                  actualCollectorId: values[l.id]?.actualCollectorId
                    ? Number(values[l.id].actualCollectorId)
                    : null,
                  notes: values[l.id]?.notes || "",
                })),
              };
              const value = JSON.stringify(body);
              if (operation.current?.value !== value)
                operation.current = { value, key: crypto.randomUUID() };
              try {
                await issue.mutateAsync({
                  ...body,
                  operationKey: operation.current!.key,
                });
                operation.current = null;
                toast.success(text.success);
              } catch (e) {
                toast.error(e instanceof Error ? e.message : text.error);
              } finally {
                try {
                  await refresh();
                } finally {
                  busy.current = false;
                }
              }
            }}
          >
            {t.confirm}
          </Button>
        </>
      )}
    </div>
  );
}
