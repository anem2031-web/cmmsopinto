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
import { useTranslation } from "@/contexts/LanguageContext";

export default function WarehouseReturn() {
  const [, navigate] = useLocation();
  const { t } = useTranslation();
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
    onError: () => toast.error(t.inventory.itemNotInStock),
  });

  // Create return
  const returnMut = trpc.warehouseReturns.create.useMutation({
    onSuccess: (data: any) => {
      toast.success(`${t.common.savedSuccessfully} — ${data.returnNumber}`);
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
      toast.error(t.inventory.returnReasonRequired);
      return;
    }
    if (!receiptId || !purchaseOrderId || !purchaseOrderItemId) {
      toast.error(t.inventory.invoiceAndPoRequired);
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
              <CardTitle className="text-base">{t.common.search}</CardTitle>
            </CardHeader>
            <CardContent>
              <BarcodeScanner
                onScan={(code) => scanMut.mutate({ code })}
                placeholder={t.inventory.scanOrEnterBarcode}
              />
            </CardContent>
          </Card>

          {/* Text Search */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{t.common.search}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2">
                <Input
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder={t.inventory.searchItemPlaceholder}
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
                        {item.quantity} {item.unit}
                      </Badge>
                    </button>
                  ))}
                </div>
              )}

              {searchResults && searchResults.length === 0 && searchQuery.length >= 2 && (
                <p className="text-sm text-muted-foreground text-center py-2">{t.common.noData}</p>
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
                <Badge>{selectedItem.quantity} {selectedItem.unit}</Badge>
              </div>
            </CardContent>
          </Card>

          {/* Receipt Info */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">{t.purchaseOrders.invoicePhoto}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1">
                <Label>{t.inventory.invoiceIdPlaceholder} *</Label>
                <Input
                  type="number"
                  placeholder={t.inventory.invoiceIdPlaceholder}
                  onChange={e => setReceiptId(parseInt(e.target.value) || null)}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>{t.purchaseOrders.poNumber} *</Label>
                  <Input
                    type="number"
                    placeholder="ID"
                    onChange={e => setPurchaseOrderId(parseInt(e.target.value) || null)}
                  />
                </div>
                <div className="space-y-1">
                  <Label>{t.purchaseOrders.items} *</Label>
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
              <CardTitle className="text-sm">{t.common.details}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1">
                <Label>{t.purchaseOrders.quantity} *</Label>
                <Input
                  type="number"
                  min={1}
                  max={selectedItem.quantity}
                  value={returnedQuantity}
                  onChange={e => setReturnedQuantity(parseInt(e.target.value) || 1)}
                />
              </div>

              <div className="space-y-1">
                <Label>{t.inventory.returnReasonPlaceholder} *</Label>
                <Input
                  value={reason}
                  onChange={e => setReason(e.target.value)}
                  placeholder={t.inventory.returnReasonPlaceholder}
                />
              </div>
            </CardContent>
          </Card>

          {/* Actions */}
          <div className="flex gap-3">
            <Button variant="outline" onClick={() => setStep("search")} className="flex-1">
              {t.common.back}
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
