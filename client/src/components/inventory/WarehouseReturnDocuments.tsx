import { trpc } from "@/lib/trpc";
import { printReturnDocument, fmtDate } from "@/lib/printReturnDocument";
import { matchesReturnSearch } from "@/lib/returnSearch";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RotateCcw, FileText, Loader2 } from "lucide-react";

/** The existing authorized return-document list and its original print action. */
export function WarehouseReturnDocuments({ search = "", category = "all" }: {
  search?: string;
  category?: "all" | "supplier" | "recipient";
}) {
  const { data: docs, isLoading, error } = trpc.returnDocuments.list.useQuery();
  const incrementPrintMut = trpc.returnDocuments.incrementPrint.useMutation();
  const visible = (docs || []).filter((doc: any) =>
    (category === "all" || (category === "recipient" ? Boolean(doc.sourceDeliveryNumber) : !doc.sourceDeliveryNumber)) &&
    matchesReturnSearch(search, doc.itemName, doc.returnNumber, doc.returnedByName, doc.sourceDeliveryNumber, doc.receiptNumber, doc.poNumber, doc.reason));
  return <div className="space-y-3">
    {isLoading && <Card><CardContent className="p-8 text-center text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></CardContent></Card>}
    {error && <p role="alert" className="text-sm text-destructive">{error.message}</p>}
    {!isLoading && !error && visible.length === 0 && <Card><CardContent className="p-8 text-center text-muted-foreground">
      <RotateCcw className="w-10 h-10 mx-auto mb-3 opacity-30" />
      <p className="font-medium">{search.trim() ? "لا توجد مستندات تطابق البحث" : "لا توجد مرتجعات بعد"}</p>
    </CardContent></Card>}
    {!isLoading && visible.map((doc: any) => <Card key={doc.id} className="border-r-4 border-r-red-700/60"><CardContent className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0 space-y-1">
          <p className="font-semibold text-base truncate">↩️ {doc.itemName}</p>
          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
            <span className="bg-red-50 text-red-700 font-bold px-2 py-0.5 rounded">{doc.returnNumber}</span>
            <span>{fmtDate(doc.createdAt)}</span><span>نفّذ الإرجاع: {doc.returnedByName}</span>
            <span>الكمية: {doc.returnedQuantity} {doc.unit || ""}</span>
          </div>
          <p className="text-xs text-muted-foreground">{doc.sourceDeliveryNumber
            ? `مرتجع من الجهة إلى المخزن · عكس سند الصرف ${doc.sourceDeliveryNumber}`
            : (doc.receiptNumber ? `مرتجع إلى المورد · مرتبط بسند ${doc.receiptNumber}` : "مرتجع إلى المورد · بلا سند استلام معروف")}
            {doc.poNumber ? ` · طلب ${doc.poNumber}` : ""}</p>
          <p className="text-xs text-muted-foreground">السبب: {doc.reason}</p>
        </div>
        <Button size="sm" variant="outline" className="gap-1.5 shrink-0" onClick={() => printReturnDocument(doc, () => incrementPrintMut.mutate({ id: doc.id }))}>
          <FileText className="w-4 h-4" /> طباعة الوثيقة
        </Button>
      </div>
    </CardContent></Card>)}
  </div>;
}
