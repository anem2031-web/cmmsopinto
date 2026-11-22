import { useId, useRef, useState, type FormEvent } from "react";
import { Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useTranslation } from "@/contexts/LanguageContext";
import { localizeApiError } from "@/i18n/apiError";
import { trpc } from "@/lib/trpc";

interface PscmReadyIssueItem {
  purchaseOrderItemId: number;
  purchaseOrderNumber: string;
  requisitionNumber: string;
  projectName: string;
  taskName: string;
  itemName: string;
  lots: { id: number; code: string; quantity: number; unit: string }[];
}

export function PscmReadyIssueCard({ item, recipients, readOnly, onIssued }: {
  item: PscmReadyIssueItem;
  recipients: { id: number; name: string | null }[];
  readOnly: boolean;
  onIssued: () => Promise<void>;
}) {
  const { t, language } = useTranslation();
  const labels = t.workflow.pmv2;
  const formId = useId();
  const operationKeys = useRef(new Map<string, string>());
  const submittingRef = useRef(false);
  const [lotId, setLotId] = useState("");
  const [recipientId, setRecipientId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const issue = trpc.pscmFulfillment.issue.useMutation();
  const lot = item.lots.find(candidate => String(candidate.id) === lotId);
  const recipient = recipients.find(candidate => String(candidate.id) === recipientId);
  const amount = Number(quantity);
  const validQuantity = Number.isSafeInteger(amount) && lot != null && amount > 0 && amount <= lot.quantity;
  const formatQuantity = (value: number, unit: string) =>
    `${value.toLocaleString(language, { maximumFractionDigits: 3 })} ${unit}`;
  const fieldClassName = "h-10 w-full rounded-md border border-input bg-background px-3 text-sm";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (readOnly || submittingRef.current || !lot || !recipient || !validQuantity) return;
    submittingRef.current = true;
    setSubmitting(true);
    const input = { purchaseOrderItemId: item.purchaseOrderItemId, lotId: lot.id, quantity: amount, deliveredToId: recipient.id };
    const fingerprint = JSON.stringify(input);
    try {
      const operationKey = operationKeys.current.get(fingerprint) ?? crypto.randomUUID();
      operationKeys.current.set(fingerprint, operationKey);
      const result = await issue.mutateAsync({ ...input, operationKey });
      operationKeys.current.delete(fingerprint);
      setQuantity("");
      toast.success(labels.pscmIssueSucceeded.replace("{number}", result.deliveryNumber));
      await onIssued();
    } catch (error) {
      toast.error(error instanceof Error ? localizeApiError(error.message, language) : labels.issueNeedFailed);
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <Card className="border-emerald-200">
      <CardHeader className="pb-3 rounded-t-xl border border-orange-500 dark:border-orange-400">
        <CardTitle className="text-lg font-bold text-emerald-700 dark:text-emerald-300" dir="auto">{item.itemName}</CardTitle>
        <CardDescription>{labels.pscmTaskReference.replace("{project}", item.projectName).replace("{task}", item.taskName)}</CardDescription>
        <p className="text-sm text-muted-foreground">
          PSCM · <bdi>{item.requisitionNumber}</bdi> · <bdi>{item.purchaseOrderNumber}</bdi>
        </p>
      </CardHeader>
      <details>
        <summary className="cursor-pointer px-6 py-3 text-sm font-medium text-primary">{readOnly ? t.common.details : labels.showDetailsIssue}</summary>
        <CardContent className="space-y-3 pt-2">
          {readOnly ? (
            <ul className="space-y-1 text-sm">
              {item.lots.map(value => (
                <li key={value.id}>
                  <bdi>{value.code}</bdi> · {formatQuantity(value.quantity, value.unit)}
                </li>
              ))}
            </ul>
          ) : (
            <form className="grid gap-3 sm:grid-cols-2" onSubmit={submit}>
              <div className="space-y-1">
                <Label htmlFor={`${formId}-lot`}>{labels.lotLabel}</Label>
                <select id={`${formId}-lot`} className={fieldClassName} value={lot ? lotId : ""} disabled={submitting}
                  onChange={event => { setLotId(event.target.value); setQuantity(""); }}>
                  <option value="">{labels.pscmSelectLot}</option>
                  {item.lots.map(value => <option key={value.id} value={value.id}>{value.code} · {formatQuantity(value.quantity, value.unit)}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor={`${formId}-quantity`}>{labels.pscmIssueQuantity}</Label>
                <Input id={`${formId}-quantity`} type="number" inputMode="numeric" min={1} step={1} max={lot?.quantity}
                  disabled={submitting || !lot} value={quantity} onChange={event => setQuantity(event.target.value)}
                  placeholder={lot ? formatQuantity(lot.quantity, lot.unit) : undefined}
                  aria-invalid={quantity !== "" && !validQuantity} />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`${formId}-recipient`}>{labels.actualRecipient}</Label>
                <select id={`${formId}-recipient`} className={fieldClassName} value={recipient ? recipientId : ""} disabled={submitting}
                  onChange={event => setRecipientId(event.target.value)}>
                  <option value="">{t.workflow.purchase.chooseActualRecipient}</option>
                  {recipients.map(value => <option key={value.id} value={value.id}>{value.name?.trim() || value.id}</option>)}
                </select>
              </div>
              <Button type="submit" className="gap-2 self-end" disabled={submitting || !recipient || !validQuantity}>
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                {labels.pscmIssueAction}
              </Button>
            </form>
          )}
        </CardContent>
      </details>
    </Card>
  );
}
