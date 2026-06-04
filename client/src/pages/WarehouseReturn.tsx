import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, Search, Package, RotateCcw, Loader2, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import BarcodeScanner from "@/components/BarcodeScanner";

export default function WarehouseReturn() {
  const [, navigate] = useLocation();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedItem, setSelectedItem] = useState<any>(null);
  const [returnedQuantity, setReturnedQuantity] = useState(1);
  const [reason, setReason] = useState("");
  const [receiptId, setReceiptId] = useState<number | null>(null);
  const [purchaseOrderId, setPurchaseOrderId] = useState<number | null>(null);
  const [purchaseOrderItemId, setPurchaseOrderItemId] = useState<number | null>(null);
  const [step, setStep] = useState<"search" | "confirm">("search");

  // Search inventory
  const searchQuery_debounced = searchQuery.trim();
  const { data: searchResults, isLoading: searching } = trpc.warehouseReturns.search.useQuery(
    { query: searchQuery_debounced },
    { enabled: searchQuery_debounced.length >= 2 }
  );

  // Barcode scan
  const scanMut = trpc.warehouseReceipts.scanBarcode.useMutation({
    onSuccess: (data: any) => {
      setSelectedItem(data);
      setStep("confirm");
    },
    onError: () => toast.error("الصنف غير موجود في المخزون"),
  });

  // Create return
  const returnMut = trpc.warehouseReturns.create.useMutation({
    onSuccess: (data: any) => {
      toast.success(`تم إنشاء المرتجع ${data.returnNumber} بنجاح`);
      navigate("/inventory");
    },
    onError: (err: any) => toast.error(err.message),
  });

  const handleSelectItem = (item: any) => {
    setSelectedItem(item);
    setReturnedQuantity(1);
    setStep("confirm");
  };

  const handleSubmit = () => {
    if (!selectedItem || !reason.trim()) {
      toast.error("يرجى إدخال سبب الإرجاع");
      return;
    }
    if (!receiptId || !purchaseOrderId || !purchaseOrderItemId) {
      toast.error("يرجى تحديد فاتورة الاستلام وطلب الشراء");
      return;
    }
    returnMut.mutate({
      receiptId,
      purchaseOrderId,
      purchaseOrderItemId,
      inventoryId: selectedItem.id,
      returnedQuantity,
      reason,
    });
  };

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowRight className="w-5 h-5" />
        </Button>
        <div>
          <h1 className="text-xl font-bold">مرتجع للمندوب</h1>
          <p className="text-sm text-muted-foreground">إرجاع صنف من المخزون</p>
        </div>
      </div>

      {step === "search" && (
        <div className="space-y-4">
          {/* Barcode Scanner */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">مسح الباركود</CardTitle>
            </CardHeader>
            <CardContent>
              <BarcodeScanner
                onScan={(code) => scanMut.mutate({ code })}
                placeholder="امسح باركود الصنف أو أدخله يدوياً"
              />
            </CardContent>
          </Card>

          {/* Text Search */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">البحث بالاسم</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2">
                <Input
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="اسم الصنف أو الرمز الداخلي..."
                />
                {searching && <Loader2 className="w-5 h-5 animate-spin self-center text-muted-foreground" />}
              </div>

              {searchResults && searchResults.length > 0 && (
                <div className="border border-border rounded-lg divide-y">
                  {searchResults.map((item: any) => (
                    <button
                      key={item.id}
                      onClick={() => handleSelectItem(item)}
                      className="w-full text-right p-3 hover:bg-accent flex items-center justify-between"
                    >
                      <div>
                        <p className="font-medium">{item.itemName}</p>
                        <p className="text-xs text-muted-foreground font-mono">{item.internalCode}</p>
                      </div>
                      <Badge variant={item.quantity > 0 ? "default" : "destructive"}>
                        الرصيد: {item.quantity} {item.unit}
                      </Badge>
                    </button>
                  ))}
                </div>
              )}

              {searchResults && searchResults.length === 0 && searchQuery.length >= 2 && (
                <p className="text-sm text-muted-foreground text-center py-2">لا توجد نتائج</p>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {step === "confirm" && selectedItem && (
        <div className="space-y-4">
          {/* Selected Item */}
          <Card className="border-primary/30 bg-primary/5">
            <CardContent className="pt-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Package className="w-5 h-5 text-primary" />
                  <div>
                    <p className="font-semibold">{selectedItem.itemName}</p>
                    <p className="text-xs text-muted-foreground font-mono">{selectedItem.internalCode}</p>
                  </div>
                </div>
                <Badge>الرصيد: {selectedItem.quantity} {selectedItem.unit}</Badge>
              </div>
            </CardContent>
          </Card>

          {/* Receipt Info */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">بيانات الفاتورة وطلب الشراء</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1">
                <Label>رقم فاتورة الاستلام *</Label>
                <Input
                  type="number"
                  placeholder="رقم ID الفاتورة"
                  onChange={e => setReceiptId(parseInt(e.target.value) || null)}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>رقم ID طلب الشراء *</Label>
                  <Input
                    type="number"
                    placeholder="ID"
                    onChange={e => setPurchaseOrderId(parseInt(e.target.value) || null)}
                  />
                </div>
                <div className="space-y-1">
                  <Label>رقم ID الصنف في الطلب *</Label>
                  <Input
                    type="number"
                    placeholder="ID"
                    onChange={e => setPurchaseOrderItemId(parseInt(e.target.value) || null)}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Return Details */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">تفاصيل الإرجاع</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1">
                <Label>الكمية المُرجَعة *</Label>
                <Input
                  type="number"
                  min={1}
                  max={selectedItem.quantity}
                  value={returnedQuantity}
                  onChange={e => setReturnedQuantity(parseInt(e.target.value) || 1)}
                />
                <p className="text-xs text-muted-foreground">
                  المتبقي بعد الإرجاع: {selectedItem.quantity - returnedQuantity} {selectedItem.unit}
                </p>
              </div>

              <div className="space-y-1">
                <Label>سبب الإرجاع *</Label>
                <Input
                  value={reason}
                  onChange={e => setReason(e.target.value)}
                  placeholder="صنف معطوب / خطأ في الكمية / ..."
                />
              </div>
            </CardContent>
          </Card>

          {/* Actions */}
          <div className="flex gap-3">
            <Button variant="outline" onClick={() => setStep("search")} className="flex-1">
              رجوع
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={returnMut.isPending || !reason.trim() || returnedQuantity < 1}
              className="flex-1 gap-2"
            >
              {returnMut.isPending
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <RotateCcw className="w-4 h-4" />
              }
              تأكيد الإرجاع
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
