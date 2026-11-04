import { useState } from "react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { independentReadOptions } from "@/lib/read-transport";
import { mediaUrl } from "@/lib/mediaUrl";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

export interface PurchaseSpecificationRow {
  id: number;
  revision: number;
  status: string;
  purchaseOrderId: number;
  poNumber: string;
  purchaseOrderItemId: number;
  itemName: string;
  quantity: number | string;
  unit: string;
  receiptNumber: string;
  warehouseName: string;
  lotCode: string;
  supplierName: string;
  invoiceNumber: string;
  receivedAt: Date | string | null;
  purchasedPhotoUrl?: string | null;
  invoicePhotoUrl?: string | null;
  warehousePhotoUrl?: string | null;
  notes?: string | null;
  remainingReturnableQuantity?: number | string;
}

type SpecificationPage = { rows: PurchaseSpecificationRow[]; total: number; page: number; pageSize: number };

function SpecificationFacts({ row }: { row: PurchaseSpecificationRow }) {
  return <>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="font-semibold" dir="auto">{row.itemName}</h3>
      <Link className="font-mono text-sm text-primary underline" href={`/purchase-orders/${row.purchaseOrderId}`}>{row.poNumber}</Link>
    </div>
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
      {[
        ["الكمية المستلمة", `${row.quantity} ${row.unit || ""}`],
        ["المورد", row.supplierName || "—"],
        ["رقم الفاتورة", row.invoiceNumber || "—"],
        ["سند الاستلام", row.receiptNumber || "—"],
        ["المستودع", row.warehouseName || "—"],
        ["اللوت", row.lotCode || "—"],
      ].map(([label, value]) => <div key={label} className="flex flex-wrap gap-2">
        <dt className="text-muted-foreground">{label}:</dt><dd dir="auto">{value}</dd>
      </div>)}
    </dl>
  </>;
}

function PageControls({ data, page, onPageChange, busy }: {
  data?: SpecificationPage; page: number; onPageChange: (page: number) => void; busy?: boolean;
}) {
  const pages = Math.max(1, Math.ceil((data?.total || 0) / (data?.pageSize || 10)));
  if (pages <= 1) return null;
  return <div className="flex items-center justify-between gap-2">
    <Button variant="outline" size="sm" disabled={busy || page <= 1} onClick={() => onPageChange(page - 1)}>السابق</Button>
    <span className="text-sm">{page} / {pages}</span>
    <Button variant="outline" size="sm" disabled={busy || page >= pages} onClick={() => onPageChange(page + 1)}>التالي</Button>
  </div>;
}

export function SpecificationReviewList({ data, isLoading, error, page, onPageChange, onDecisionSaved }: {
  data?: SpecificationPage;
  isLoading: boolean;
  error?: { message: string } | null;
  page: number;
  onPageChange: (page: number) => void;
  onDecisionSaved: () => void;
}) {
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [preview, setPreview] = useState<{ url: string; label: string } | null>(null);
  const decide = trpc.purchaseSpecifications.decide.useMutation({
    onSuccess: (_result, input) => {
      toast.success(input.decision === "approved" ? "تمت مطابقة المواصفات؛ يمكن للمستودع استكمال الإجراءات" : "تم رفض المطابقة وإظهار الصنف للمستودع لبدء الإرجاع");
      onDecisionSaved();
    },
    onError: error => toast.error(error.message),
  });
  return <section className="space-y-4" aria-label="مطابقة المواصفات">
    <p className="text-sm text-muted-foreground">الأصناف المستلمة والموجّهة للإنشاءات. تنتظر الكمية قرار المطابقة قبل التحويل أو الصرف.</p>
    {error && <p role="alert" className="text-sm text-destructive">{error.message}</p>}
    {isLoading ? <Loader2 className="h-5 w-5 animate-spin" aria-label="جارٍ تحميل المطابقة" /> : !error && !data?.rows.length ? <Card><CardContent className="p-6 text-center text-muted-foreground">لا توجد أصناف بانتظار مطابقة المواصفات</CardContent></Card> : null}
    {(data?.rows || []).map(row => {
      const photos = [
        { label: "صورة الصنف عند الاستلام", url: row.warehousePhotoUrl },
        { label: "صورة الصنف المشترى", url: row.purchasedPhotoUrl },
        { label: "صورة الفاتورة", url: row.invoicePhotoUrl },
      ].filter(photo => !!photo.url);
      return <Card key={row.id}><CardContent className="space-y-4 p-4">
        <SpecificationFacts row={row} />
        {!!photos.length && <div className="flex flex-wrap gap-3">
          {photos.map(photo => <button key={photo.label} type="button" className="space-y-1 text-xs" onClick={() => setPreview({ url: mediaUrl(photo.url), label: photo.label })}>
            <img className="h-20 w-24 rounded border object-contain" src={mediaUrl(photo.url)} alt={photo.label} />
            <span>{photo.label}</span>
          </button>)}
        </div>}
        <Textarea aria-label={`ملاحظات مطابقة ${row.poNumber} — ${row.itemName}`} placeholder="ملاحظات المطابقة (اختياري)" maxLength={2000} value={notes[row.id] || ""} disabled={decide.isPending} onChange={event => setNotes(old => ({ ...old, [row.id]: event.target.value }))} />
        <div className="flex flex-wrap gap-2">
          <Button disabled={decide.isPending} onClick={() => decide.mutate({ id: row.id, revision: row.revision, decision: "approved", notes: notes[row.id]?.trim() || undefined })}>مطابق — موافقة</Button>
          <Button variant="destructive" disabled={decide.isPending} onClick={() => decide.mutate({ id: row.id, revision: row.revision, decision: "rejected", notes: notes[row.id]?.trim() || undefined })}>غير مطابق — رفض</Button>
        </div>
      </CardContent></Card>;
    })}
    <PageControls data={data} page={page} onPageChange={onPageChange} busy={decide.isPending} />
    <Dialog open={!!preview} onOpenChange={open => { if (!open) setPreview(null); }}>
      <DialogContent className="max-w-3xl"><DialogHeader><DialogTitle>{preview?.label || "صورة الصنف"}</DialogTitle></DialogHeader>
        {preview && <img src={preview.url} alt={preview.label} className="max-h-[75vh] w-full object-contain" />}
        <Button variant="outline" onClick={() => setPreview(null)}>إغلاق</Button>
      </DialogContent>
    </Dialog>
  </section>;
}

export function RejectedSpecificationReturns() {
  const [page, setPage] = useState(1);
  const query = trpc.purchaseSpecifications.rejectedReturns.useQuery({ page, pageSize: 10 }, independentReadOptions);
  return <section className="space-y-3" aria-label="مرفوضة في مطابقة المواصفات">
    <h2 className="font-semibold">مرفوضة في مطابقة المواصفات {query.data ? `(${query.data.total})` : ""}</h2>
    <p className="text-sm text-muted-foreground">هذه الكميات لم يُنفّذ إرجاعها بعد. افتح الصنف لاستكمال مرتجع المورد بالإجراء المعتاد.</p>
    {query.error && <p role="alert" className="text-sm text-destructive">{query.error.message}</p>}
    {query.isLoading && <Loader2 className="h-5 w-5 animate-spin" aria-label="جارٍ تحميل الأصناف المرفوضة" />}
    {!query.isLoading && !query.error && !query.data?.rows.length && <p className="text-sm text-muted-foreground">لا توجد كميات مرفوضة تنتظر الإرجاع</p>}
    {(query.data?.rows || []).map((row: PurchaseSpecificationRow) => <Card key={row.id}><CardContent className="space-y-3 p-4">
      <SpecificationFacts row={row} />
      <p className="text-sm">المتبقي القابل للإرجاع: {row.remainingReturnableQuantity} {row.unit}</p>
      {row.notes && <p className="whitespace-pre-wrap text-sm text-muted-foreground">ملاحظات المطابقة: {row.notes}</p>}
      <Link href={`/warehouse/return?specificationId=${row.id}`}><Button size="sm" variant="outline">بدء الإرجاع للمورد</Button></Link>
    </CardContent></Card>)}
    <PageControls data={query.data} page={page} onPageChange={setPage} />
  </section>;
}
