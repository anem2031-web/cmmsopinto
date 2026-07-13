import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { useLocation, useSearch } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, Package, CheckCircle2, Loader2, Link } from "lucide-react";
import { toast } from "sonner";
import BarcodeScanner from "@/components/common/BarcodeScanner";
import { useTranslation } from "@/contexts/LanguageContext";

interface ReceiveItem {
  purchaseOrderItemId: number;
  itemName: string;
  requestedQuantity: number;
  receivedQuantity: number;
  unit: string;
  supplierName: string;
  actualUnitCost: string;
  warehousePhotoUrl: string;
  manufacturerBarcode: string;
  inventoryId?: number;
  internalCode?: string;
}

export default function WarehouseReceive() {
  const [, navigate] = useLocation();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const poId = params.get("poId") ? parseInt(params.get("poId")!) : null;
  const { t } = useTranslation();

  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<ReceiveItem[]>([]);
  const [initialized, setInitialized] = useState(false);
  const [scanningItemIndex, setScanningItemIndex] = useState<number | null>(null);

  const { data: po } = trpc.purchaseOrders.getById.useQuery(
    { id: poId! },
    { enabled: !!poId }
  );

  useEffect(() => {
    if (!initialized && (po as any)?.items) {
      const purchasedItems = (po as any).items.filter((i: any) => i.status === "purchased");
      if (purchasedItems.length > 0) {
        setItems(purchasedItems.map((i: any) => ({
          purchaseOrderItemId: i.id,
          itemName: i.itemName,
          requestedQuantity: i.quantity,
          receivedQuantity: i.quantity,
          unit: i.unit || t.inventory.defaultUnit,
          supplierName: i.supplierName || "",
          actualUnitCost: i.actualUnitCost || "",
          warehousePhotoUrl: i.purchasedPhotoUrl || "",
          manufacturerBarcode: "",
          inventoryId: undefined,
          internalCode: "",
        })));
        setInitialized(true);
      }
    }
  }, [po, initialized]);

  const receiveMut = trpc.warehouseReceipts.receiveFromPurchase.useMutation({
    onSuccess: (data: any) => {
      toast.success(`تم الاستلام بنجاح — فاتورة ${data.receiptNumber}`);
      navigate("/inventory");
    },
    onError: (err: any) => toast.error(err.message),
  });

  const searchMut = trpc.warehouseReceipts.scanBarcode.useMutation({
    onSuccess: (data: any) => {
      if (scanningItemIndex !== null && data) {
        setItems(prev => prev.map((item, idx) =>
          idx === scanningItemIndex
            ? { ...item, inventoryId: data.id, internalCode: data.internalCode || "", manufacturerBarcode: data.manufacturerBarcode || "" }
            : item
        ));
        toast.success(`تم ربط الصنف "${data.itemName}" من المخزون`);
      }
      setScanningItemIndex(null);
    },
    onError: () => {
      toast.info(t.inventory.itemNewWillCreate);
      setScanningItemIndex(null);
    },
  });

  const updateItem = (index: number, field: keyof ReceiveItem, value: any) => {
    setItems(prev => prev.map((item, idx) => idx === index ? { ...item, [field]: value } : item));
  };

  const handleSubmit = () => {
    const invalid = items.find(i => !i.supplierName || !i.actualUnitCost || !i.warehousePhotoUrl || i.receivedQuantity < 1);
    if (invalid) {
      toast.error(`يرجى إكمال بيانات الصنف: ${invalid.itemName}`);
      return;
    }
    receiveMut.mutate({
      purchaseOrderId: poId!,
      notes,
      items: items.map(i => ({
        purchaseOrderItemId: i.purchaseOrderItemId,
        itemName: i.itemName,
        receivedQuantity: i.receivedQuantity,
        unit: i.unit,
        manufacturerBarcode: i.manufacturerBarcode || undefined,
        inventoryId: i.inventoryId || undefined,
        supplierName: i.supplierName,
        actualUnitCost: i.actualUnitCost,
        warehousePhotoUrl: i.warehousePhotoUrl,
      })),
    });
  };

  if (!poId) return (
    <div className="p-6 text-center text-muted-foreground">لم يتم تحديد طلب الشراء</div>
  );

  return (
    <div className="max-w-3xl mx-auto p-4 space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate("/inventory")}>
          <ArrowRight className="w-5 h-5" />
        </Button>
        <div>
          <h1 className="text-xl font-bold">استلام من المشتريات</h1>
          {po && <p className="text-sm text-muted-foreground">طلب الشراء: {(po as any).poNumber}</p>}
        </div>
      </div>

      {items.length === 0 && initialized && (
        <div className="text-center text-muted-foreground py-8">
          {t.inventory.noItemsPurchased}
        </div>
      )}

      {!initialized && po && (
        <div className="text-center py-8">
          <Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" />
        </div>
      )}

      {items.map((item, index) => (
        <Card key={item.purchaseOrderItemId}>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Package className="w-4 h-4 text-primary" />
                {item.itemName}
              </span>
              <Badge variant="outline">الكمية المطلوبة: {item.requestedQuantity}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>{t.inventory.receive} *</Label>
                <Input type="number" min={1} value={item.receivedQuantity}
                  onChange={e => updateItem(index, "receivedQuantity", parseInt(e.target.value) || 1)} />
              </div>
              <div className="space-y-1">
                <Label>{t.inventory.unit} *</Label>
                <Input value={item.unit} onChange={e => updateItem(index, "unit", e.target.value)} placeholder={t.inventory.unitPlaceholder} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>{t.inventory.supplierName} *</Label>
                <Input value={item.supplierName} onChange={e => updateItem(index, "supplierName", e.target.value)} placeholder={t.inventory.supplierPlaceholder} />
              </div>
              <div className="space-y-1">
                <Label>{t.inventory.actualCost} *</Label>
                <Input type="number" value={item.actualUnitCost} onChange={e => updateItem(index, "actualUnitCost", e.target.value)} placeholder="0.00" />
              </div>
            </div>
            <div className="space-y-1">
              <Label>{t.purchaseOrders.warehousePhoto} *</Label>
              <Input value={item.warehousePhotoUrl} onChange={e => updateItem(index, "warehousePhotoUrl", e.target.value)} placeholder="https://..." dir="ltr" />
            </div>
            <div className="space-y-1">
              <Label>{t.common.optionalNote}</Label>
              <Input value={item.manufacturerBarcode} onChange={e => updateItem(index, "manufacturerBarcode", e.target.value)}
                placeholder={t.inventory.barcodePlaceholder} dir="ltr" className="font-mono" />
            </div>
            <div className="space-y-2">
              <Label>{t.common.optionalNote}</Label>
              {item.inventoryId ? (
                <div className="flex items-center gap-2 p-2 bg-green-50 rounded-lg border border-green-200">
                  <CheckCircle2 className="w-4 h-4 text-green-600" />
                  <span className="text-sm text-green-700">{item.internalCode}</span>
                  <Button type="button" size="sm" variant="ghost" className="mr-auto text-red-500 h-6"
                    onClick={() => updateItem(index, "inventoryId", undefined)}>{t.common.cancel}</Button>
                </div>
              ) : (
                <div>
                  {scanningItemIndex === index ? (
                    <div className="space-y-2">
                      <BarcodeScanner onScan={(code) => searchMut.mutate({ code })} placeholder={t.inventory.barcodeSearch} />
                      <Button type="button" size="sm" variant="outline" onClick={() => setScanningItemIndex(null)}>{t.common.cancel}</Button>
                    </div>
                  ) : (
                    <Button type="button" size="sm" variant="outline" className="gap-1" onClick={() => setScanningItemIndex(index)}>
                      <Link className="w-3 h-3" /> {t.inventory.receive}
                    </Button>
                  )}
                  <p className="text-xs text-muted-foreground mt-1">إذا لم تربطه، سيُنشأ صنف جديد تلقائياً</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      ))}

      <div className="space-y-1">
        <Label>{t.common.optionalNote}</Label>
        <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder={t.inventory.receivingNotes} />
      </div>

      <Button className="w-full h-12 text-base gap-2" onClick={handleSubmit}
        disabled={receiveMut.isPending || items.length === 0}>
        {receiveMut.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle2 className="w-5 h-5" />}
        تأكيد الاستلام وإنشاء الفاتورة
      </Button>
    </div>
  );
}
