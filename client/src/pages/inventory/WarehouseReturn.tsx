import { InventoryBooks } from "@/components/inventory/InventoryBooks";
import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { useLocation, useSearch } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowRight, Search, Package, RotateCcw, Loader2, CheckCircle2, Info, QrCode } from "lucide-react";
import { toast } from "sonner";
import BarcodeScanner from "@/components/common/BarcodeScanner";
import { useTranslation } from "@/contexts/LanguageContext";
import { SupplierReturnValuePreview } from "@/components/purchase/SupplierReturnValuePreview";
import { warehouseReturnBackLink } from "@shared/returns-center";

function fmtDate(d: any) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("ar-SA");
}

export default function WarehouseReturn() {
  const [, navigate] = useLocation();
  const search = useSearch();
  const backLink = warehouseReturnBackLink(search);
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedItem, setSelectedItem] = useState<any>(null);
  const [returnedQuantity, setReturnedQuantity] = useState(1);
  const [reason, setReason] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [delegateId, setDelegateId] = useState("");
  const [creationKeys] = useState(() => new Map<string, string>());
  const followupStatus = trpc.supplierReturns.status.useQuery();
  const delegateChoices = trpc.supplierReturns.delegates.useQuery(undefined, { enabled: followupStatus.data?.enabled === true });
  const followupMut = trpc.supplierReturns.create.useMutation({
    onSuccess: () => { toast.success("تم إنشاء المرتجع وإرساله للمندوب"); navigate(backLink); },
    onError: error => toast.error(error.message),
  });
  // مصدر الإرجاع (سند الاستلام) المُختار — null يعني "بلا مصدر معروف"
  const [selectedSource, setSelectedSource] = useState<any>(null);
  // المورد المُختار (المرحلة الأولى من الاختيار عند تعدد الموردين)
  const [selectedVendorKey, setSelectedVendorKey] = useState<string | null>(null);
  const [step, setStep] = useState<"search" | "confirm">("search");
  const [returnLotInfo, setReturnLotInfo] = useState<any>(null);
  const [returnWarehouseId, setReturnWarehouseId] = useState("");
  const [returnMode, setReturnMode] = useState<"supplier" | "recipient">("supplier");
  const [recipientDeliveryNumber, setRecipientDeliveryNumber] = useState("");
  const [recipientSourceInfo, setRecipientSourceInfo] = useState<any>(null);
  const { data: warehousesList } = trpc.warehouse.list.useQuery();
  const { data: lotTrackingStatus } = trpc.inventoryCount.lotTrackingStatus.useQuery();
  const lotsEnabled = !!lotTrackingStatus?.enabled;
  const specificationParam = new URLSearchParams(search).get("specificationId");
  const specificationId = Number(specificationParam || 0);
  const specificationRequested = specificationParam !== null;
  const validSpecificationId = Number.isSafeInteger(specificationId) && specificationId > 0;
  const specificationSource = trpc.purchaseSpecifications.rejectedReturnSource.useQuery(
    { id: specificationId }, { enabled: specificationRequested && validSpecificationId && lotsEnabled, retry: false }
  );
  const [specificationReady, setSpecificationReady] = useState(false);
  const [specificationError, setSpecificationError] = useState("");
  const specificationLot = trpc.warehouseReturns.resolveReturnLot.useMutation();

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
    { inventoryId: selectedItem?.id }, { enabled: !!selectedItem?.id && !lotsEnabled && returnMode === "supplier" }
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
    if (returnMode === "supplier" && !lotsEnabled && returnSources && returnSources.length === 1 && !selectedSource) {
      setSelectedSource(returnSources[0]);
    }
  }, [returnSources]);

  // مورد واحد فقط بالفواتير المتبقية بعد اختيار المورد → يُختار تلقائياً
  useEffect(() => {
    if (returnMode === "supplier" && !lotsEnabled && hasMultipleVendors && selectedVendorKey && invoicesForSelectedVendor.length === 1 && !selectedSource) {
      setSelectedSource(invoicesForSelectedVendor[0]);
    }
  }, [selectedVendorKey, returnSources]);

  const resolveReturnLotMut = trpc.warehouseReturns.resolveReturnLot.useMutation({
    onSuccess: (data: any) => {
      setReturnLotInfo(data);
      setSelectedItem(data.item);
      setReturnedQuantity(1);
      setSelectedSource(null);
      setSelectedVendorKey(null);
      setStep("confirm");
      toast.success(`تم التعرف على الدفعة ${data.lotCode}`);
    },
    onError: (err: any) => {
      setReturnLotInfo(null);
      setSelectedItem(null);
      toast.error(err.message);
    },
  });

  useEffect(() => {
    const source = specificationSource.data;
    if (!source || !lotsEnabled || !specificationRequested) return;
    let cancelled = false;
    setSpecificationReady(false);
    setSpecificationError("");
    setReturnMode("supplier");
    setReturnWarehouseId(String(source.warehouseId));
    setReturnLotInfo(null);
    setSelectedItem(null);
    void specificationLot.mutateAsync({ warehouseId: Number(source.warehouseId), trackingToken: source.trackingToken }).then(resolved => {
      if (cancelled) return;
      const quantity = Math.min(Number(source.remainingReturnableQuantity), Number(resolved.availableQuantity));
      if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("لا توجد كمية متبقية قابلة للإرجاع لهذا الصنف");
      setReturnLotInfo(resolved);
      setSelectedItem(resolved.item);
      setSelectedSource(null);
      setSelectedVendorKey(null);
      setReturnedQuantity(quantity);
      setReason(source.notes?.trim() || "رفض مطابقة المواصفات");
      setStep("confirm");
      setSpecificationReady(true);
    }).catch(error => {
      if (!cancelled) setSpecificationError(error instanceof Error ? error.message : "تعذر تجهيز المرتجع من قرار المطابقة");
    });
    return () => { cancelled = true; };
  }, [specificationSource.data?.id, specificationSource.data?.revision, specificationId, specificationRequested, lotsEnabled]);

  const specificationBlocked = specificationRequested && (!validSpecificationId || !specificationReady
    || Number(specificationSource.data?.id) !== specificationId
    || returnLotInfo?.trackingToken !== specificationSource.data?.trackingToken
    || Number(returnWarehouseId) !== Number(specificationSource.data?.warehouseId)
    || !!specificationSource.error || !!specificationError);
  const specificationLimit = specificationRequested && specificationSource.data
    ? Math.min(Number(specificationSource.data.remainingReturnableQuantity), Number(returnLotInfo?.availableQuantity || 0))
    : undefined;

  const resolveRecipientReturnSourceMut = trpc.warehouseReturns.resolveRecipientReturnSource.useMutation({
    onSuccess: (data: any) => {
      setRecipientSourceInfo(data);
      setSelectedItem({
        id: data.inventoryId,
        itemName: data.itemName,
        internalCode: data.internalCode,
        quantity: data.currentInventoryQuantity,
        unit: data.unit,
      });
      setReturnedQuantity(1);
      setReason("");
      setStep("confirm");
      toast.success(`تم التحقق من سند الصرف ${data.deliveryNumber}`);
    },
    onError: (err: any) => {
      setRecipientSourceInfo(null);
      setSelectedItem(null);
      toast.error(err.message);
    },
  });

  const recipientReturnMut = trpc.warehouseReturns.createRecipientReturn.useMutation({
    onSuccess: (data: any) => {
      toast.success(data?.returnNumber ? `${t.common.savedSuccessfully} — ${data.returnNumber}` : t.common.savedSuccessfully);
      navigate(backLink);
    },
    onError: (err: any) => toast.error(err.message),
  });

  // Create return
  const returnMut = trpc.warehouseReturns.create.useMutation({
    onSuccess: (data: any) => {
      toast.success(data?.returnNumber ? `${t.common.savedSuccessfully} — ${data.returnNumber}` : t.common.savedSuccessfully);
      navigate(backLink);
    },
    onError: (err: any) => toast.error(err.message),
  });

  const selectItem = (item: any) => {
    setSelectedItem(item);
    setReturnLotInfo(null);
    setReturnedQuantity(1);
    setSelectedSource(null);
    setSelectedVendorKey(null);
    setStep("confirm");
  };

  const handleSelectItem = (item: any) => selectItem(item);

  const handleSubmit = () => {
    if (specificationBlocked) {
      toast.error("يجب التحقق من الصنف المرفوض والدفعة الأصلية قبل تأكيد الإرجاع");
      return;
    }
    if (specificationLimit !== undefined && returnedQuantity > specificationLimit) {
      toast.error("الكمية أكبر من المتبقي المرفوض القابل للإرجاع");
      return;
    }
    if (!selectedItem || !reason.trim()) {
      toast.error(t.inventory.returnReasonRequired);
      return;
    }

    if (returnMode === "supplier" && lotsEnabled && followupStatus.data?.enabled && (!Number.isInteger(returnedQuantity) || returnedQuantity <= 0)) {
      toast.error("أدخل كمية صحيحة أكبر من صفر");
      return;
    }

    if (returnMode === "recipient") {
      if (!recipientSourceInfo?.sourceDeliveryDocumentId) {
        toast.error("يجب التحقق من سند الصرف الأصلي أولًا");
        return;
      }
      if (returnedQuantity > Number(recipientSourceInfo.returnableQuantity || 0)) {
        toast.error(`الكمية (${returnedQuantity}) أكبر من المتبقي القابل للإرجاع (${recipientSourceInfo.returnableQuantity || 0})`);
        return;
      }
      recipientReturnMut.mutate({
        sourceDeliveryDocumentId: Number(recipientSourceInfo.sourceDeliveryDocumentId),
        returnedQuantity,
        reason,
      });
      return;
    }

    if (lotsEnabled) {
      if (!returnWarehouseId) {
        toast.error("يجب اختيار المستودع قبل تأكيد مرتجع المورد");
        return;
      }
      if (!returnLotInfo?.trackingToken) {
        toast.error("يجب مسح QR الدفعة أو إدخال رقم اللوت قبل تأكيد مرتجع المورد");
        return;
      }
      if (returnedQuantity > Number(returnLotInfo.availableQuantity || 0)) {
        toast.error(`الكمية (${returnedQuantity}) أكبر من رصيد الدفعة المتاح (${returnLotInfo.availableQuantity || 0})`);
        return;
      }
      if (followupStatus.isLoading || followupStatus.error) {
        toast.error("تعذر التحقق من مسار المرتجع؛ أعد المحاولة"); return;
      }
      if (followupStatus.data?.enabled) {
        if (!delegateId) { toast.error("اختر المندوب المستلم للمرتجع"); return; }
        const request = { trackingToken: returnLotInfo.trackingToken, warehouseId: Number(returnWarehouseId), delegateId: Number(delegateId), returnedQuantity, reason: reason.trim() };
        const fingerprint = JSON.stringify(request);
        if (!creationKeys.has(fingerprint)) creationKeys.set(fingerprint, crypto.randomUUID());
        followupMut.mutate({ ...request, operationKey: creationKeys.get(fingerprint)! });
        return;
      }
      returnMut.mutate({
        lotTrackingToken: returnLotInfo.trackingToken,
        warehouseId: Number(returnWarehouseId),
        returnedQuantity,
        reason,
        recipientName: recipientName.trim() || undefined,
      });
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
          <h1 className="text-xl font-bold">مرتجعات المخزون</h1>
          <p className="text-sm text-muted-foreground">{returnMode === "recipient" ? "إرجاع من الجهة المستلمة إلى نفس الـLot الأصلي" : (lotsEnabled ? "إرجاع للمورد من الدفعة الأصلية عبر QR" : "إرجاع صنف من المخزون إلى المورد")}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => navigate(backLink)}>
          سجل المرتجعات
        </Button>
      </div>

      {specificationRequested && <Card className="border-amber-200 bg-amber-50/40"><CardContent className="space-y-2 pt-4 text-sm">
        <p className="font-semibold">مرتجع بسبب رفض مطابقة المواصفات</p>
        {!validSpecificationId ? <p role="alert" className="text-destructive">رقم قرار المطابقة غير صالح</p>
          : lotTrackingStatus && !lotsEnabled ? <p role="alert" className="text-destructive">يتطلب هذا المرتجع تفعيل تتبع اللوتات</p>
          : specificationSource.error || specificationError ? <p role="alert" className="text-destructive">{specificationSource.error?.message || specificationError}</p>
          : !specificationReady ? <p className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />جارٍ التحقق من قرار المطابقة والدفعة الأصلية...</p>
          : <p>{specificationSource.data?.poNumber} — {specificationSource.data?.itemName} — {specificationSource.data?.lotCode}</p>}
        <p className="text-muted-foreground">تُستكمل عملية الإرجاع بعد مراجعة الكمية والسبب واختيار المندوب. لم يُنفّذ الإرجاع بعد.</p>
      </CardContent></Card>}

      <Card>
        <CardContent className="pt-4">
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant={returnMode === "supplier" ? "default" : "outline"}
              disabled={specificationRequested}
              onClick={() => {
                setReturnMode("supplier");
                setStep("search");
                setSelectedItem(null);
                setRecipientSourceInfo(null);
                setRecipientDeliveryNumber("");
                setReturnLotInfo(null);
                setReason("");
                setRecipientName("");
              }}
            >
              مرتجع إلى المورد
            </Button>
            <Button
              variant={returnMode === "recipient" ? "default" : "outline"}
              disabled={specificationRequested}
              onClick={() => {
                setReturnMode("recipient");
                setStep("search");
                setSelectedItem(null);
                setReturnLotInfo(null);
                setSelectedSource(null);
                setSelectedVendorKey(null);
                setReason("");
                setRecipientName("");
              }}
            >
              مرتجع من الجهة إلى المخزن
            </Button>
          </div>
        </CardContent>
      </Card>

      {step === "search" && !specificationRequested && (
        returnMode === "recipient" ? (
          <Card className="border-blue-200">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <RotateCcw className="w-4 h-4 text-blue-600" />
                سند الصرف الأصلي
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                أدخل رقم سند الصرف الأصلي. سيعيد النظام الكمية إلى نفس الـLot والمخزن الأصليين، ويستخدم تكلفة حركة الصرف الأصلية.
              </p>
              <div className="flex gap-2">
                <Input
                  value={recipientDeliveryNumber}
                  onChange={(e) => {
                    setRecipientDeliveryNumber(e.target.value);
                    setRecipientSourceInfo(null);
                  }}
                  placeholder="مثال: DLV-2026-300204"
                  dir="ltr"
                  className="font-mono"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && recipientDeliveryNumber.trim() && !resolveRecipientReturnSourceMut.isPending) {
                      resolveRecipientReturnSourceMut.mutate({ deliveryNumber: recipientDeliveryNumber.trim() });
                    }
                  }}
                />
                <Button
                  onClick={() => resolveRecipientReturnSourceMut.mutate({ deliveryNumber: recipientDeliveryNumber.trim() })}
                  disabled={!recipientDeliveryNumber.trim() || resolveRecipientReturnSourceMut.isPending}
                >
                  {resolveRecipientReturnSourceMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "تحقق"}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                السندات القديمة التي لا تحمل ربطًا صريحًا بالـInventory/Lot/Movement لن تُصلح أو تُربط تاريخيًا تلقائيًا.
              </p>
            </CardContent>
          </Card>
        ) : lotsEnabled ? (
          <Card className="border-blue-200">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <QrCode className="w-4 h-4 text-blue-600" />
                مسح QR الدفعة أو إدخال رقم اللوت المراد إرجاعه
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                اختر المستودع أولًا، ثم امسح QR. سيحدد النظام الصنف والمورد والفاتورة وسند الاستلام من الدفعة داخل هذا المستودع فقط.
              </p>
              <div className="space-y-1.5">
                <Label>المستودع *</Label>
                <Select
                  value={returnWarehouseId}
                  onValueChange={(value) => {
                    setReturnWarehouseId(value);
                    setReturnLotInfo(null);
                    setSelectedItem(null);
                  }}
                >
                  <SelectTrigger><SelectValue placeholder="اختر المستودع قبل المسح..." /></SelectTrigger>
                  <SelectContent>
                    {((warehousesList as any[]) || []).filter((w: any) => !!w.isActive).map((w: any) => (
                      <SelectItem key={w.id} value={String(w.id)}>{w.nameAr || w.nameEn || `#${w.id}`}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {returnWarehouseId && <InventoryBooks warehouseId={Number(returnWarehouseId)} supplierReturn
                onPick={async({lot,master})=>{setReturnLotInfo(null);setSelectedItem(null);
                  try {const resolved=await resolveReturnLotMut.mutateAsync({warehouseId:Number(returnWarehouseId),trackingToken:lot.trackingToken});
                    setSelectedItem({...resolved.item,itemName:master.nameAr || master.nameEn || resolved.item.itemName});
                  } catch { /* The existing mutation error handler displays the server rejection. */ }
                }} />}
              {returnWarehouseId ? (
                <BarcodeScanner
                  onScan={(code) => {
                    setReturnLotInfo(null);
                    setSelectedItem(null);
                    resolveReturnLotMut.mutate({ warehouseId: Number(returnWarehouseId), trackingToken: code });
                  }}
                  placeholder="امسح QR الخاص بالدفعة..."
                />
              ) : (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                  يجب اختيار المستودع قبل مسح QR.
                </p>
              )}
              {resolveReturnLotMut.isPending && (
                <p className="text-sm text-muted-foreground flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" /> جاري التحقق من الدفعة ومصدرها...
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                الرصيد الافتتاحي لا يمكن إرجاعه من مسار مرتجع المورد لأنه لا يملك موردًا أو فاتورة مثبتة.
              </p>
            </CardContent>
          </Card>
        ) : (
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
        )
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

          {returnMode === "recipient" && recipientSourceInfo ? (
            <Card className="border-emerald-200 bg-emerald-50/40">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  المصدر: سند الصرف الأصلي
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">سند الصرف</span>
                  <strong className="font-mono">{recipientSourceInfo.deliveryNumber}</strong>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">المستلم الأصلي</span>
                  <strong>{recipientSourceInfo.deliveredToName || "—"}</strong>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">المخزن الأصلي</span>
                  <strong>{recipientSourceInfo.warehouseName || "—"}</strong>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">الـLot الأصلي</span>
                  <strong className="font-mono">{recipientSourceInfo.lotCode || `#${recipientSourceInfo.lotId}`}</strong>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">الكمية المصروفة أصلًا</span>
                  <strong>{recipientSourceInfo.deliveryQuantity} {selectedItem.unit || "وحدة"}</strong>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">أُعيد سابقًا</span>
                  <strong>{recipientSourceInfo.previouslyReturnedQuantity} {selectedItem.unit || "وحدة"}</strong>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">تكلفة الصرف الأصلية</span>
                  <strong>{Number(recipientSourceInfo.originalIssueUnitCost || 0).toFixed(4)} ر.س</strong>
                </div>
                <div className="border-t pt-2 mt-2 flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">المتبقي القابل للإرجاع</span>
                  <strong className="text-emerald-700">{recipientSourceInfo.returnableQuantity} {selectedItem.unit || "وحدة"}</strong>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">قيمة المرتجع الحالية</span>
                  <strong>{(Number(returnedQuantity || 0) * Number(recipientSourceInfo.originalIssueUnitCost || 0)).toFixed(2)} ر.س</strong>
                </div>
              </CardContent>
            </Card>
          ) : lotsEnabled && returnLotInfo ? (
            <Card className="border-emerald-200 bg-emerald-50/40">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  مصدر المرتجع محدد من QR
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">الدفعة</span>
                  <strong className="font-mono">{returnLotInfo.lotCode}</strong>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">المستودع</span>
                  <strong>{returnLotInfo.warehouseName || "—"}</strong>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">المورد</span>
                  <strong>{returnLotInfo.source?.vendorName || "—"}</strong>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">الفاتورة</span>
                  <strong>{returnLotInfo.source?.invoiceNumber || "—"}</strong>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">سند الاستلام</span>
                  <strong>{returnLotInfo.source?.receiptNumber || `#${returnLotInfo.source?.receiptId}`}</strong>
                </div>
                {returnLotInfo.source?.poNumber && (
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">أمر الشراء</span>
                    <strong>{returnLotInfo.source.poNumber}</strong>
                  </div>
                )}
                <div className="border-t pt-2 mt-2 flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">المتاح من هذه الدفعة</span>
                  <strong className="text-emerald-700">{returnLotInfo.availableQuantity} {selectedItem.unit || "وحدة"}</strong>
                </div>
              </CardContent>
            </Card>
          ) : !lotsEnabled && returnMode === "supplier" ? (
            <>
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
            </>
          ) : null}

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
                  step={1}
                  max={specificationLimit ?? (returnMode === "recipient" ? recipientSourceInfo?.returnableQuantity : (lotsEnabled ? returnLotInfo?.availableQuantity : selectedItem.quantity))}
                  value={Number.isFinite(returnedQuantity) ? returnedQuantity : ""}
                  onChange={e => setReturnedQuantity(returnMode === "supplier" && lotsEnabled && followupStatus.data?.enabled ? e.target.valueAsNumber : (parseInt(e.target.value) || 1))}
                />
                {returnMode === "supplier" && lotsEnabled && returnLotInfo && followupStatus.data?.enabled && <>
                  <p className="text-xs text-muted-foreground">حدد الكمية المرتجعة؛ يمكن إرجاع جزء من رصيد اللوت أو كامل المتاح. تُثبّت الكمية بعد التأكيد.</p>
                  {Number.isInteger(Number(specificationLimit ?? returnLotInfo.availableQuantity)) && Number(specificationLimit ?? returnLotInfo.availableQuantity) > 0 &&
                    <Button type="button" size="sm" variant="outline" disabled={followupMut.isPending || returnMut.isPending}
                      onClick={() => setReturnedQuantity(Number(specificationLimit ?? returnLotInfo.availableQuantity))}>إرجاع كامل المتاح ({specificationLimit ?? returnLotInfo.availableQuantity})</Button>}
                  {followupStatus.data?.enabled && <SupplierReturnValuePreview warehouseId={Number(returnWarehouseId)} trackingToken={returnLotInfo.trackingToken} quantity={returnedQuantity} />}
                </>}
              </div>

              <div className="space-y-1">
                <Label>{t.inventory.returnReasonPlaceholder} *</Label>
                <Input
                  value={reason}
                  onChange={e => setReason(e.target.value)}
                  placeholder={t.inventory.returnReasonPlaceholder}
                />
              </div>

              {returnMode === "supplier" && lotsEnabled && followupStatus.data?.enabled && <div className="space-y-1">
                <Label>المندوب المستلم للمرتجع *</Label>
                <Select value={delegateId} onValueChange={setDelegateId}><SelectTrigger><SelectValue placeholder="اختر المندوب" /></SelectTrigger><SelectContent>
                  {delegateChoices.data?.map(person => <SelectItem key={person.id} value={String(person.id)}>{person.name || person.username}</SelectItem>)}
                </SelectContent></Select>
                {delegateChoices.error && <p role="alert">{delegateChoices.error.message}</p>}
              </div>}
              {returnMode === "supplier" && !(lotsEnabled && followupStatus.data?.enabled) && (
                <div className="space-y-1">
                  <Label>اسم المستلم (من استلم الصنف المرتجَع)</Label>
                  <Input
                    value={recipientName}
                    onChange={e => setRecipientName(e.target.value)}
                    placeholder="مثال: اسم المندوب أو مسؤول المورد"
                  />
                  <p className="text-xs text-muted-foreground">يظهر كتوقيع ثانٍ بوثيقة المرتجع — اختياري</p>
                </div>
              )}
              {returnMode === "recipient" && recipientSourceInfo && (
                <p className="text-xs text-muted-foreground bg-blue-50 border border-blue-200 rounded-md px-3 py-2">
                  سيُربط المرتجع بسند الصرف {recipientSourceInfo.deliveryNumber}، ويعود إلى نفس الـLot الأصلي بتكلفة الصرف الأصلية.
                </p>
              )}
            </CardContent>
          </Card>

          {/* Actions */}
          <div className="flex gap-3">
            <Button variant="outline" onClick={() => { if (specificationRequested) { navigate(backLink); return; } setStep("search"); setSelectedItem(null); setReturnLotInfo(null); setRecipientSourceInfo(null); setSelectedSource(null); setSelectedVendorKey(null); }} className="flex-1">
              {t.common.back}
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={specificationBlocked || (specificationLimit !== undefined && returnedQuantity > specificationLimit) || followupMut.isPending || returnMut.isPending || recipientReturnMut.isPending || resolveReturnLotMut.isPending || resolveRecipientReturnSourceMut.isPending || !reason.trim() || !Number.isInteger(returnedQuantity) || returnedQuantity < 1 || (returnMode === "recipient" ? !recipientSourceInfo : (lotsEnabled && (!returnWarehouseId || !returnLotInfo)))}
              className="flex-1 gap-2"
            >
              {(followupMut.isPending || returnMut.isPending || recipientReturnMut.isPending)
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <RotateCcw className="w-4 h-4" />
              }
              {returnMode === "recipient" ? "تأكيد الإرجاع إلى المخزن" : "تأكيد الإرجاع"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
