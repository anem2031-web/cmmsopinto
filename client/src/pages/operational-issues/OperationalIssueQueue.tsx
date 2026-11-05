import { useRef, useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { useTranslation } from "@/contexts/LanguageContext";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { canProcessOperationalIssue, type OperationalDelivery } from "@shared/operational-issues";
import { operationalIssueText } from "@/i18n/operationalIssues";
import { OperationalStockPanel } from "./OperationalStockPanel";
import { PreparedDispatchPanel } from "./PreparedDispatchPanel";
import { matchesReturnSearch } from "@/lib/returnSearch";
import { MaterialRequestMeta } from "@/components/inventory/MaterialRequestMeta";

export function OperationalIssueQueue({ process = false, returnsOnly = false, search = "" }: {
  process?: boolean; returnsOnly?: boolean; search?: string;
}) {
  const { user } = useAuth(); const { language, dir } = useTranslation();
  const text = operationalIssueText[language];
  const list = trpc.operationalIssues.list.useQuery(undefined, { retry: false });
  const [id, setId] = useState<number | null>(null);
  const detail = trpc.operationalIssues.detail.useQuery({ id: id || 0 }, { enabled: Boolean(id && list.data?.enabled), retry: false });
  const approve = trpc.operationalIssues.approve.useMutation();
  const canProcess = process && canProcessOperationalIssue(user?.role);
  const canSeeStock = !returnsOnly && (canProcess || user?.role === "observer");
  const stock = trpc.operationalIssues.availability.useQuery({ id: id || 0 }, { enabled: Boolean(id && list.data?.enabled && canSeeStock), retry: false });
  const refresh = async () => { await Promise.all([list.refetch(), ...(id ? [detail.refetch(), ...(canSeeStock ? [stock.refetch()] : [])] : [])]); };
  const run = async (work: () => Promise<unknown>) => {
    try { await work(); toast.success(text.success); await refresh(); }
    catch (error) { toast.error(error instanceof Error ? error.message : text.error); await refresh(); }
  };
  if (list.isLoading) return <p>{text.load}</p>;
  if (list.error) return <p role="alert" className="text-destructive">{list.error.message}</p>;
  if (!list.data?.enabled) return <p>{text.disabled}</p>;
  const orders = list.data.orders.filter(order => matchesReturnSearch(search, order.orderNumber, order.siteName, order.sectionName, order.collectorName));
  return <div className="space-y-4" dir={dir}>
    <Button variant="outline" onClick={() => void refresh()}>{text.refresh}</Button>
    {returnsOnly && <p className="text-sm text-muted-foreground">{language === "ar" ? "اختر طلب صرف لاستعراض سنداته وتسجيل مرتجع من الكميات المصروفة فعليًا." : language === "ur" ? "اصل اجرا کی رسیدیں اور واپسی دیکھنے کے لیے درخواست منتخب کریں۔" : "Choose an issue request to view its deliveries and record an actual return."}</p>}
    {!orders.length && <p className="text-muted-foreground">{text.empty}</p>}
    <div className="space-y-2">{orders.map(order => <Card key={order.id}>
      <CardContent className="py-3 flex flex-wrap justify-between items-center gap-3">
        <div><p className="font-semibold">{order.orderNumber}</p><p className="text-sm text-muted-foreground">{order.siteName} / {order.sectionName} · {text.collector}: {order.collectorName}</p>
          {process && <MaterialRequestMeta creatorName={order.creatorName} sentAt={order.createdAt} language={language} />}
        </div>
        <div className="flex gap-2 items-center"><Badge variant="outline">{text[order.status]}</Badge><Button variant="outline" onClick={() => setId(order.id)}>{text.details}</Button></div>
      </CardContent>
    </Card>)}</div>
    {id && detail.isLoading && <p>{text.load}</p>}
    {detail.error && <p role="alert" className="text-destructive">{detail.error.message}</p>}
    {detail.data && <Card><CardHeader><CardTitle>{detail.data.order.orderNumber}</CardTitle></CardHeader><CardContent className="space-y-4">
      <p>{text.creator}: {detail.data.order.creatorName} · {text.collector}: {detail.data.order.collectorName}</p>
      <p>{text.reason}: {detail.data.order.reason}</p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 rounded-lg border p-3 text-sm">
        <p>{text.totalCost}: {detail.data.cost.issued.toFixed(2)} {text.currency}</p><p>{text.returned}: {detail.data.cost.returned.toFixed(2)} {text.currency}</p><p className="font-semibold">{text.netCost}: {detail.data.cost.net.toFixed(2)} {text.currency}</p>
      </div>
      {!returnsOnly && canProcess && detail.data.order.status === "pending" && <Button disabled={approve.isPending} onClick={() => void run(() => approve.mutateAsync({ id: Number(id), revision: Number(detail.data!.order.revision) }))}>{text.approve}</Button>}
      {canSeeStock && stock.error && <p role="alert" className="text-destructive">{stock.error.message}</p>}
      {!returnsOnly && (detail.data.items.some(line => line.dispatchContext != null) ? <PreparedDispatchPanel key={id} order={detail.data.order} lines={detail.data.items} stocks={stock.data?.items}
        canProcess={canProcess} loading={stock.isFetching} procurementReady={Boolean(stock.data?.procurementReady)} dispatch={detail.data.dispatch || []} refresh={refresh} /> : detail.data.items.map(line => <OperationalStockPanel key={`${id}:${line.id}`} line={line} stock={stock.data?.items.find(item => item.itemId === Number(line.id))}
        showStock={canSeeStock} loading={stock.isFetching} procurementReady={Boolean(stock.data?.procurementReady)}
        approved={detail.data!.order.status === "approved"} canProcess={canProcess} orderId={Number(id)} refresh={refresh} />))}
      {returnsOnly && !detail.data.deliveries.length && <p className="text-sm text-muted-foreground">{language === "ar" ? "لا توجد سندات صرف لهذا الطلب لتسجيل مرتجع عليها." : language === "ur" ? "اس درخواست کی واپسی کے لیے کوئی اجرا رسید نہیں ہے۔" : "This request has no issue deliveries to return."}</p>}
      {detail.data.deliveries.map(delivery => <OperationalReturnPanel key={delivery.id} delivery={delivery} orderId={Number(id)} canProcess={canProcess} refresh={refresh} />)}
    </CardContent></Card>}
  </div>;
}

function OperationalReturnPanel({ delivery, orderId, canProcess, refresh }: { delivery: OperationalDelivery; orderId: number; canProcess: boolean; refresh(): Promise<void> }) {
  const { language } = useTranslation(); const text = operationalIssueText[language];
  const [quantity, setQuantity] = useState(1); const [reason, setReason] = useState("");
  const operation = useRef<{ value: string; key: string } | null>(null);
  const returned = trpc.operationalIssues.returnMaterial.useMutation();
  const remaining = Number(delivery.quantity) - Number(delivery.returnedQuantity);
  return <section className="rounded-lg border p-3 space-y-2 text-sm">
    <p className="font-medium">{text.delivery}: {delivery.deliveryNumber} · {delivery.lotCode}</p><p>{text.issued}: {delivery.quantity} · {text.returned}: {delivery.returnedQuantity}</p>
    {canProcess && remaining >= 1 && <div className="flex flex-wrap gap-2 items-end">
      <div><Label>{text.quantity}</Label><Input type="number" min={1} max={Math.floor(remaining)} step={1} value={quantity} onChange={e => setQuantity(Number(e.target.value))} /></div>
      <div className="flex-1"><Label>{text.returnReason}</Label><Input value={reason} onChange={e => setReason(e.target.value)} /></div>
      <Button variant="outline" disabled={returned.isPending || !reason.trim() || quantity < 1 || quantity > remaining || !Number.isInteger(quantity)} onClick={async () => {
        const body = { orderId, deliveryDocumentId: Number(delivery.deliveryDocumentId), quantity, reason };
        const value = JSON.stringify(body); if (!operation.current || operation.current.value !== value) operation.current = { value, key: crypto.randomUUID() };
        try { await returned.mutateAsync({ ...body, operationKey: operation.current.key }); toast.success(text.success); setReason(""); operation.current = null; await refresh(); }
        catch (error) { toast.error(error instanceof Error ? error.message : text.error); }
      }}>{text.returnAction}</Button>
    </div>}
  </section>;
}
