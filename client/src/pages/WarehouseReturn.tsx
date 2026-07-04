import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, Search, Package, RotateCcw, Loader2, CheckCircle2, Info } from "lucide-react";
import { toast } from "sonner";
import BarcodeScanner from "@/components/BarcodeScanner";
import { useTranslation } from "@/contexts/LanguageContext";

function fmtDate(d: any) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("ar-SA");
}

export default function WarehouseReturn() {
  const [, navigate] = useLocation();
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedItem, setSelectedItem] = useState<any>(null);
  const [returnedQuantity, setReturnedQuantity] = useState(1);
  const [reason, setReason] = useState("");
  const [recipientName, setRecipientName] = useState("");
  // مصدر الإرجاع (سند الاستلام) المُختار — null يعني "بلا مصدر معروف"
  const [selectedSource, setSelectedSource] = useState<any>(null);
  // المورد المُختار (المرحلة الأولى من الاختيار عند تعدد الموردين)
  const [selectedVendorKey, setSelectedVendorKey] = useState<string | null>(null);
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
      selectItem(data);
    },
    onError: () => toast.error(t.inventory.itemNotInStock),
  });

  // مصادر الإرجاع المحتملة (سندات الاستلام السابقة) لهذا الصنف — تُجلب
  // تلقائياً بعد اختيار الصنف، بدون أي إدخال يدوي من المستخدم
  const { data: returnSources, isLoading: loadingSources } = trpc.warehouseReturns.getReturnSources.useQuery(
    { inventoryId: selectedItem?.id }, { enabled: !!selectedItem?.id }
  );

  // ── تجميع مصادر الإرجاع بمرحلتين: مورد ← فاتورة ──────────────────────
  // لا نغيّر بنية البيانات القادمة من الخادم؛ فقط نجمّعها محلياً هنا لعرضها
  // بشكل أسهل عند تعدد الموردين، مع تخطٍ تلقائي لأي مرحلة لها خيار واحد فقط.
  const vendorKey = (s: any) => s.vendorName || "__no_vendor__";
  const vendorLabel = (key: string) => key === "__no_vendor__" ? "بلا مورد محدد (استلام مستقل)" : key;

  const vendorGroups = (returnSources || []).reduce((acc: Record<string, any[]>, s: any) => {
    const k = vendorKey(s);
    (acc[k] = acc[k] || []).push(s);
    return acc;
  }, {} as Record<string, any[]>);
  const vendorKeys = Object.keys(vendorGroups);
  const hasMultipleVendors = vendorKeys.length > 1;

  // الفواتير المتاحة بعد اعتبار المورد المُختار (أو كل الفواتير لو مورد واحد فقط)
  const invoicesForSelectedVendor = hasMultipleVendors
    ? (selectedVendorKey ? vendorGroups[selectedVendorKey] || [] : [])
    : (returnSources || []);

  // مصدر واحد فقط بالمجمل → يُختار تلقائياً بلا أي تدخل من المستخدم
  useEffect(() => {
    if (returnSources && returnSources.length === 1 && !selectedSource) {
      setSelectedSource(returnSources[0]);
    }
  }, [returnSources]);

  // مورد واحد فقط بالفواتير المتبقية بعد اختيار المورد → يُختار تلقائياً
  useEffect(() => {
    if (hasMultipleVendors && selectedVendorKey && invoicesForSelectedVendor.length === 1 && !selectedSource) {
      setSelectedSource(invoicesForSelectedVendor[0]);
    }
  }, [selectedVendorKey, returnSources]);

  // Create return
  const returnMut = trpc.warehouseReturns.create.useMutation({
    onSuccess: (data: any) => {
      toast.success(`${t.common.savedSuccessfully} — ${data.returnNumber}`);
      navigate("/inventory");
    },
    onError: (err: any) => toast.error(err.message),
  });

  const selectItem = (item: any) => {
    setSelectedItem(item);
    setReturnedQuantity(1);
    setSelectedSource(null);
    setSelectedVendorKey(null);
    setStep("confirm");
  };

  const handleSelectItem = (item: any) => selectItem(item);

  const handleSubmit = () => {
    if (!selectedItem || !reason.trim()) {
      toast.error(t.inventory.returnReasonRequired);
      return;
    }
    returnMut.mutate({
      receiptId:            selectedSource?.receiptId,
      purchaseOrderId:      selectedSource?.purchaseOrderId ?? undefined,
      purchaseOrderItemId:  selectedSource?.purchaseOrderItemId ?? undefined,
      inventoryId: selectedItem.id,
      returnedQuantity,
      reason,
      recipientName: recipientName.trim() || undefined,
    });
  };

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowRight className="w-5 h-5" />
        </Button>
        <div className="flex-1">
          <h1 className="text-xl font-bold">مرتجع للمندوب</h1>
          <p className="text-sm text-muted-foreground">إرجاع صنف من المخزون</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => navigate("/warehouse/returns")}>
          سجل المرتجعات
        </Button>
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

          {/* مصدر الإرجاع — يُحدَّد تلقائياً من سجل استلام الصنف، بلا أي إدخال يدوي.
              عند تعدد الموردين: نعرض المورد أولاً، وبعد اختياره فواتيره فقط. */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">مصدر الإرجاع</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {loadingSources && (
                <p className="text-sm text-muted-foreground flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" /> جاري البحث عن سجل الاستلام...
                </p>
              )}

              {!loadingSources && (!returnSources || returnSources.length === 0) && (
                <p className="text-sm text-muted-foreground flex items-start gap-2">
                  <Info className="w-4 h-4 shrink-0 mt-0.5" />
                  لا يوجد سجل استلام مرتبط بهذا الصنف — سيُسجَّل كإرجاع عام بلا مصدر محدَّد.
                </p>
              )}

              {/* مصدر واحد بالمجمل — اختيار تلقائي كامل */}
              {!loadingSources && returnSources && returnSources.length === 1 && selectedSource && (
                <div className="flex items-start gap-2 text-sm bg-emerald-50 border border-emerald-200 rounded-lg p-3">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium text-emerald-800">تم تحديد المصدر تلقائياً</p>
                    <p className="text-emerald-700 text-xs mt-0.5">
                      استلام بتاريخ {fmtDate(selectedSource.receiptDate)}
                      {selectedSource.vendorName ? ` · ${selectedSource.vendorName}` : ""}
                      {selectedSource.invoiceNumber ? ` · فاتورة ${selectedSource.invoiceNumber}` : ""}
                      {" "}· استُلم {selectedSource.receivedQty}
                      {selectedSource.returnedQty > 0 ? ` (أُرجع سابقاً ${selectedSource.returnedQty})` : ""}
                      {selectedSource.poNumber ? ` · طلب ${selectedSource.poNumber}` : " · بلا طلب شراء (استلام مستقل)"}
                    </p>
                  </div>
                </div>
              )}

              {/* أكثر من مصدر: مرحلة 1 — اختيار المورد (فقط لو أكثر من مورد فعلاً) */}
              {!loadingSources && returnSources && returnSources.length > 1 && hasMultipleVendors && !selectedVendorKey && (
                <div className="space-y-2">
                  <Label>اختر المورد ({vendorKeys.length} موردين)</Label>
                  <div className="border border-border rounded-lg divide-y">
                    {vendorKeys.map((key) => (
                      <button
                        key={key}
                        onClick={() => { setSelectedVendorKey(key); setSelectedSource(null); }}
                        className="w-full text-right p-3 hover:bg-accent flex items-center justify-between gap-2"
                      >
                        <div>
                          <p className="text-sm font-medium">{vendorLabel(key)}</p>
                          <p className="text-xs text-muted-foreground">
                            {vendorGroups[key].length} {vendorGroups[key].length === 1 ? "فاتورة" : "فواتير"}
                          </p>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* أكثر من مصدر: مرحلة 2 — اختيار الفاتورة (بعد اختيار المورد، أو مباشرة لو مورد واحد فقط) */}
              {!loadingSources && returnSources && returnSources.length > 1 &&
                (!hasMultipleVendors || selectedVendorKey) &&
                invoicesForSelectedVendor.length > 1 && (
                <div className="space-y-2">
                  {hasMultipleVendors && (
                    <div className="flex items-center justify-between">
                      <Label>فواتير {vendorLabel(selectedVendorKey!)}</Label>
                      <button
                        className="text-xs text-muted-foreground underline"
                        onClick={() => { setSelectedVendorKey(null); setSelectedSource(null); }}
                      >
                        تغيير المورد
                      </button>
                    </div>
                  )}
                  {!hasMultipleVendors && <Label>اختر الفاتورة</Label>}
                  <div className="border border-border rounded-lg divide-y">
                    {invoicesForSelectedVendor.map((src: any) => (
                      <button
                        key={src.receiptId}
                        onClick={() => setSelectedSource(src)}
                        className={`w-full text-right p-3 hover:bg-accent flex items-center justify-between gap-2 ${
                          selectedSource?.receiptId === src.receiptId ? "bg-primary/10" : ""
                        }`}
                      >
                        <div>
                          <p className="text-sm font-medium">
                            {src.invoiceNumber ? `فاتورة ${src.invoiceNumber}` : (src.vendorName ? src.vendorName : "بلا رقم فاتورة")}
                            {" · "}{fmtDate(src.receiptDate)}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            استُلم {src.receivedQty}
                            {src.returnedQty > 0 ? ` · أُرجع سابقاً ${src.returnedQty}` : ""}
                            {src.poNumber ? ` · طلب ${src.poNumber}` : " · استلام مستقل"}
                          </p>
                        </div>
                        {selectedSource?.receiptId === src.receiptId && (
                          <CheckCircle2 className="w-4 h-4 text-primary shrink-0" />
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* فاتورة واحدة فقط ضمن المورد المُختار — اختيار تلقائي */}
              {!loadingSources && returnSources && returnSources.length > 1 &&
                hasMultipleVendors && selectedVendorKey &&
                invoicesForSelectedVendor.length === 1 && selectedSource && (
                <div className="flex items-start gap-2 text-sm bg-emerald-50 border border-emerald-200 rounded-lg p-3">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="font-medium text-emerald-800">تم تحديد الفاتورة تلقائياً (مورد واحد بفاتورة واحدة)</p>
                    <p className="text-emerald-700 text-xs mt-0.5">
                      {selectedSource.invoiceNumber ? `فاتورة ${selectedSource.invoiceNumber} · ` : ""}
                      {fmtDate(selectedSource.receiptDate)} · استُلم {selectedSource.receivedQty}
                    </p>
                  </div>
                  <button
                    className="text-xs text-muted-foreground underline shrink-0"
                    onClick={() => { setSelectedVendorKey(null); setSelectedSource(null); }}
                  >
                    تغيير المورد
                  </button>
                </div>
              )}
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

              <div className="space-y-1">
                <Label>اسم المستلم (من استلم الصنف المرتجَع)</Label>
                <Input
                  value={recipientName}
                  onChange={e => setRecipientName(e.target.value)}
                  placeholder="مثال: اسم المندوب أو مسؤول المورد"
                />
                <p className="text-xs text-muted-foreground">يظهر كتوقيع ثانٍ بوثيقة المرتجع — اختياري</p>
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
