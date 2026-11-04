import { trpc } from "@/lib/trpc";
import { printReturnDocument, fmtDate } from "@/lib/printReturnDocument";
import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowRight, RotateCcw, FileText, Loader2, Plus } from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";
import { SupplierReturns } from "@/components/purchase/SupplierReturns";
import { RejectedSpecificationReturns } from "@/components/purchase/PurchaseSpecifications";


export default function WarehouseReturnsList() {
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const canCreateReturn = user?.role === "warehouse" || user?.role === "admin" || user?.role === "owner";
  const { data: docs, isLoading } = trpc.returnDocuments.list.useQuery();
  const incrementPrintMut = trpc.returnDocuments.incrementPrint.useMutation();

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate("/inventory")}>
          <ArrowRight className="w-5 h-5" />
        </Button>
        <div className="flex-1">
          <h1 className="text-xl font-bold">المرتجعات</h1>
          <p className="text-sm text-muted-foreground">كل عمليات الإرجاع المحفوظة</p>
        </div>
        {canCreateReturn && <Button size="sm" className="gap-1.5" onClick={() => navigate("/warehouse/return")}>
          <Plus className="w-4 h-4" /> مرتجع جديد
        </Button>}
      </div>

      {isLoading && (
        <Card><CardContent className="p-8 text-center text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin mx-auto" />
        </CardContent></Card>
      )}

      {canCreateReturn && <RejectedSpecificationReturns />}
      {canCreateReturn && <SupplierReturns />}

      {!isLoading && (!docs || docs.length === 0) && (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            <RotateCcw className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="font-medium">لا توجد مرتجعات بعد</p>
          </CardContent>
        </Card>
      )}

      {!isLoading && docs && docs.length > 0 && (
        <div className="space-y-3">
          {docs.map((doc: any) => (
            <Card key={doc.id} className="border-r-4 border-r-red-700/60">
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0 space-y-1">
                    <p className="font-semibold text-base truncate">↩️ {doc.itemName}</p>
                    <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                      <span className="bg-red-50 text-red-700 font-bold px-2 py-0.5 rounded">
                        {doc.returnNumber}
                      </span>
                      <span>{fmtDate(doc.createdAt)}</span>
                      <span>نفّذ الإرجاع: {doc.returnedByName}</span>
                      <span>الكمية: {doc.returnedQuantity} {doc.unit || ""}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {doc.sourceDeliveryNumber
                        ? `مرتجع من الجهة إلى المخزن · عكس سند الصرف ${doc.sourceDeliveryNumber}`
                        : (doc.receiptNumber ? `مرتجع إلى المورد · مرتبط بسند ${doc.receiptNumber}` : "مرتجع إلى المورد · بلا سند استلام معروف")}
                      {doc.poNumber ? ` · طلب ${doc.poNumber}` : ""}
                    </p>
                    <p className="text-xs text-muted-foreground">السبب: {doc.reason}</p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5 shrink-0"
                    onClick={() => printReturnDocument(doc, () => incrementPrintMut.mutate({ id: doc.id }))}
                  >
                    <FileText className="w-4 h-4" /> طباعة الوثيقة
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
