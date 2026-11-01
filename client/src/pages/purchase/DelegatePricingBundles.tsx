import type { PricingBundleRow } from "@shared/delegate-pricing-bundles";
import { useState } from "react";
import { Link, useSearch } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { useTranslation } from "@/contexts/LanguageContext";
import { pricingBundleText } from "@/i18n/pricingBundles";
import { canReadPricingBundles } from "@shared/delegate-pricing-bundles";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { downloadPricingBundlePdf } from "@/lib/downloadPricingBundlePdf";
import { Loader2 } from "lucide-react";
import { PricingBundleRows } from "@/components/purchase/PricingBundleRows";
import { toast } from "sonner";
import { canOpenApprovalPdf, approvalPdfNotice } from "@/lib/approvalPdfAccess";
import { UnifiedBundleApproval } from "@/components/purchase/UnifiedBundleApproval";
export default function DelegatePricingBundles() {
  const { user } = useAuth(); const { language, dir } = useTranslation(); const text = pricingBundleText[language];
  const reviewRequested = new URLSearchParams(useSearch()).has("approval") &&
    !!user && ["owner", "admin", "accountant", "senior_management"].includes(user.role);
  const allowed = !!user && canReadPricingBundles(user);
  const status = trpc.delegatePricingBundles.status.useQuery(undefined, { enabled: allowed, retry: false });
  return <div dir={dir} className="p-6 space-y-5"><h1 className="text-2xl font-bold">{reviewRequested ? "مراجعة حزمة التسعير" : text.title}</h1>{!allowed ? <p role="alert">{text.forbidden}</p> : status.error ? <p role="alert">{status.error.message}</p> : status.isLoading ? <p>{text.load}</p> : status.data?.enabled ? reviewRequested ? (
    ('approvalEnabled' in status.data) && status.data.approvalEnabled ? <UnifiedBundleApproval selectedOnly /> : <p role="alert">اعتماد الحزمة الموحد غير مفعّل</p>
  ) : <>{('approvalEnabled' in status.data)&&status.data.approvalEnabled&&<UnifiedBundleApproval/>}<PricingBundlesContent /></> : <p>{text.disabled}</p>}</div>;
}
export function PricingBundlesContent() {
  const { user } = useAuth(); const { language } = useTranslation(); const text = pricingBundleText[language]; const utils = trpc.useUtils();
  const [selected, setSelected] = useState<number | null>(null); const [categorySort, setCategorySort] = useState(false);
  const [listMode, setListMode] = useState<"open" | "archive" | null>(null);
  const list = trpc.delegatePricingBundles.list.useQuery();
  const mode = listMode ?? (list.data?.some(entry => entry.status === "open") ? "open" : "archive");
  const visibleEntries = (list.data || []).filter(entry => mode === "open" ? entry.status === "open" : entry.status !== "open");
  const selectedId = visibleEntries.some(entry => entry.id === selected) ? selected! : visibleEntries[0]?.id;
  const detail = trpc.delegatePricingBundles.detail.useQuery({ id: Number(selectedId || 0) }, { enabled: !!selectedId });
  const refresh = () => Promise.all([utils.delegatePricingBundles.invalidate(), utils.purchaseOrders.invalidate()]);
  const remove = trpc.delegatePricingBundles.remove.useMutation({ onSuccess: async () => { toast.success(text.returned); await refresh(); }, onError: error => toast.error(error.message) });
  const send = trpc.delegatePricingBundles.send.useMutation({ onSuccess: (result, input) => {
    setSelected(input.id);
    setListMode("archive");
    utils.delegatePricingBundles.detail.setData({ id: input.id }, (old: typeof detail.data) => old ? { ...old, status: old.status === "open" ? "archived" : old.status, revision: old.status === "open" ? Number(old.revision) + 1 : old.revision, effectsDone: result.effectsDone ? 1 : 0 } : old);
    utils.delegatePricingBundles.list.setData(undefined, old => old?.map(entry => entry.id === input.id ? { ...entry, status: entry.status === "open" ? "archived" : entry.status, effectsDone: result.effectsDone ? 1 : 0 } : entry));
    result.effectsDone ? toast.success(text.done) : toast.warning(text.pendingSync);
    // Refetch source queues without keeping the send button pending after the committed response.
    void refresh().catch(() => toast.warning(text.refreshFailed));
  }, onError: error => toast.error(error.message) });
  const retry = trpc.delegatePricingBundles.retrySync.useMutation({ onSuccess: async done => { if (!done) toast.warning(text.pendingSync); await refresh(); }, onError: error => toast.error(error.message) });
  const pdf = trpc.delegatePricingBundles.pdf.useMutation({ onSuccess: result => {
    try { downloadPricingBundlePdf(result); } catch { toast.error(text.downloadFailed); }
  }, onError: error => toast.error(error.message) });
  const bundle = detail.data; const editable = user?.role === "delegate" && bundle?.status === "open";
  const items: PricingBundleRow[] = categorySort ? [...(bundle?.items || [])].sort((a,b) => a.categoryName.localeCompare(b.categoryName)) : bundle?.items || [];
  const busy = remove.isPending || send.isPending || pdf.isPending || retry.isPending;
  const fmt = (value: number | string) => Number(value).toLocaleString(language === "ar" ? "ar-SA" : language === "ur" ? "ur-PK" : "en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (list.isLoading) return <p>{text.load}</p>;
  if (list.error) return <p role="alert">{list.error.message}</p>;
  return <div className="space-y-4"><div className="flex gap-2">{(["open", "archive"] as const).map(value => <Button key={value} disabled={busy} variant={mode === value ? "default" : "outline"} onClick={() => { setListMode(value); setSelected(list.data?.find(entry => value === "open" ? entry.status === "open" : entry.status !== "open")?.id ?? null); }}>{value === "open" ? text.openBundles : text.archiveList}</Button>)}</div><PricingBundleRows entries={visibleEntries} selectedId={selectedId} disabled={busy} onSelect={setSelected} />
    {!selectedId ? <p>{text.empty}</p> : detail.error ? <p role="alert">{detail.error.message}</p> : !bundle ? <p>{text.load}</p> : <Card><CardHeader><CardTitle>{bundle.bundleNumber} — {text[bundle.status as "open" | "sent" | "archived"]}</CardTitle><p>{text.delegate}: {bundle.delegateName} · {text.created}: {new Date(bundle.createdAt).toLocaleString(language, { timeZone: "Asia/Riyadh" })}</p><p>{text.count}: {items.length}/20 · {text.total}: {fmt(bundle.total)} SAR</p></CardHeader><CardContent className="space-y-4">
      <Button size="sm" variant="outline" onClick={() => setCategorySort(value => !value)}>{text.sort}{categorySort ? " ✓" : ""}</Button>
      {items.length === 0 ? <p>{text.emptyItems}</p> : <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr>{[text.item, text.category, text.po, text.section, text.quantity, text.unit, text.price, text.supplier, text.total, ""].map((label,index) => <th className="p-2 border-b text-start" key={index}>{label}</th>)}</tr></thead><tbody>{items.map(item => <tr key={item.id}><td className="p-2 border-b">{item.itemName}</td><td className="p-2 border-b">{item.categoryName}</td><td className="p-2 border-b"><Link className="text-primary underline" href={`/purchase-orders/${item.purchaseOrderId}?itemId=${item.id}`}>{item.poNumber}</Link></td><td className="p-2 border-b">{item.sectionName}</td><td className="p-2 border-b">{item.quantity}</td><td className="p-2 border-b">{item.unit}</td><td className="p-2 border-b">{fmt(item.estimatedUnitCost)}</td><td className="p-2 border-b">{item.supplierName}</td><td className="p-2 border-b">{fmt(item.estimatedTotalCost)}</td><td className="p-2 border-b">{editable && <Button size="sm" variant="outline" disabled={busy} onClick={() => remove.mutate({ id: bundle.id, itemId: item.id })}>{text.back}</Button>}</td></tr>)}</tbody></table></div>}
      <div className="flex flex-wrap gap-3">{canOpenApprovalPdf(user?.role, bundle) && bundle.status !== "open" && items.length > 0 && <Button variant="outline" disabled={busy} onClick={() => pdf.mutate({ id: bundle.id })}>{pdf.isPending && <Loader2 className="h-4 w-4 animate-spin" />}{pdf.isPending ? text.preparingPdf : text.pdf}</Button>}{(user?.role === "accountant" || user?.role === "senior_management") && !canOpenApprovalPdf(user.role, bundle) && <p className="text-sm text-muted-foreground">{approvalPdfNotice(language)}</p>}{editable && <Button disabled={busy || items.length === 0} onClick={() => send.mutate({ id: bundle.id, revision: bundle.revision })}>{send.isPending && <Loader2 className="h-4 w-4 animate-spin" />}{send.isPending ? text.sending : text.send}</Button>}{user?.role === "delegate" && bundle.status !== "open" && !bundle.effectsDone && <Button disabled={busy} variant="outline" onClick={() => retry.mutate({ id: bundle.id })}>{text.retry}</Button>}</div>
    </CardContent></Card>}
  </div>;
}
