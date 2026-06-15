import { useState, useRef } from "react";
import { mediaUrl } from "@/lib/mediaUrl";
import { trpc } from "@/lib/trpc";
import { useTranslation } from "@/contexts/LanguageContext";
import { useAuth } from "@/_core/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ShoppingCart, Package, Truck, CheckCircle2, Camera, Loader2,
  Clock, ArrowLeft, ArrowRight, Image as ImageIcon, FileText,
  AlertCircle, User, Hash, Calendar
} from "lucide-react";
import { toast } from "sonner";

export default function PurchaseCycle() {
  const { t, language } = useTranslation();
  const { user } = useAuth();
  const isRTL = language === "ar" || language === "ur";
  const role = user?.role || "";
  const isAdminOrOwner = role === "admin" || role === "owner";
  const isDelegate = role === "delegate" || isAdminOrOwner;
  const isWarehouse = role === "warehouse" || isAdminOrOwner;

  // Determine active tab based on role
  const defaultTab = isAdminOrOwner ? "purchase" : isDelegate ? "purchase" : isWarehouse ? "warehouse" : "purchase";
  const [activeTab, setActiveTab] = useState(defaultTab);

  // Data queries - admin/owner always enabled
  const { data: pendingEstimate = [], refetch: refetchEstimate } = trpc.purchaseOrders.pendingEstimateItems.useQuery(undefined, { enabled: isDelegate || isAdminOrOwner });
  const { data: pendingPurchase = [], refetch: refetchPurchase } = trpc.purchaseOrders.pendingPurchaseItems.useQuery(undefined, { enabled: isDelegate || isAdminOrOwner });
  const { data: pendingWarehouse = [], refetch: refetchWarehouse } = trpc.purchaseOrders.pendingWarehouseItems.useQuery(undefined, { enabled: isWarehouse || isAdminOrOwner });
  const { data: pendingDelivery = [], refetch: refetchDelivery } = trpc.purchaseOrders.pendingDeliveryItems.useQuery(undefined, { enabled: isWarehouse || isAdminOrOwner });
  const { data: allUsers = [] } = trpc.users.list.useQuery();

  const refetchAll = () => { refetchEstimate(); refetchPurchase(); refetchWarehouse(); refetchDelivery(); };

  // Mutations
  const estimateCostMut = trpc.purchaseOrders.estimateCost.useMutation({ onSuccess: () => { toast.success("تم حفظ التسعير"); refetchAll(); }, onError: (e: any) => toast.error(e.message) });
  const confirmPurchaseMut = trpc.purchaseOrders.confirmItemPurchase.useMutation({ onSuccess: () => { toast.success(t.purchaseOrders.purchased); refetchAll(); }, onError: (e: any) => toast.error(e.message) });
  const confirmWarehouseMut = trpc.purchaseOrders.confirmDeliveryToWarehouse.useMutation({ onSuccess: () => { toast.success(t.purchaseOrders.deliveredToWarehouse); refetchAll(); }, onError: (e: any) => toast.error(e.message) });
  const confirmDeliveryMut = trpc.purchaseOrders.confirmDeliveryToRequester.useMutation({ onSuccess: () => { toast.success(t.purchaseOrders.deliveredToRequester); refetchAll(); }, onError: (e: any) => toast.error(e.message) });

  // Estimate state
  const [estimateValues, setEstimateValues] = useState<Record<number, string>>({});

  // Dialog states
  const [purchaseDialog, setPurchaseDialog] = useState<any>(null);
  const [warehouseDialog, setWarehouseDialog] = useState<any>(null);
  const [deliveryDialog, setDeliveryDialog] = useState<any>(null);

  // Upload states
  const [uploading, setUploading] = useState<string | null>(null);
  const [purchasePhotos, setPurchasePhotos] = useState<{ purchased?: string; invoice?: string }>({});
  const [warehouseForm, setWarehouseForm] = useState({ supplierName: "", supplierItemName: "", actualUnitCost: "", warehousePhotoUrl: "" });
  const [deliveryUserId, setDeliveryUserId] = useState<string>("");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const currentUploadTarget = useRef<string>("");

  // Upload handler
  const handleUpload = async (file: File, target: string) => {
    setUploading(target);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");

      if (target === "purchased") setPurchasePhotos(p => ({ ...p, purchased: data.url }));
      else if (target === "invoice") setPurchasePhotos(p => ({ ...p, invoice: data.url }));
      else if (target === "warehouse") setWarehouseForm(p => ({ ...p, warehousePhotoUrl: data.url }));
      toast.success(t.common.upload);
    } catch (err: any) {
      toast.error(err.message || "Upload error");
    } finally {
      setUploading(null);
    }
  };

  const triggerUpload = (target: string) => {
    currentUploadTarget.current = target;
    fileInputRef.current?.click();
  };

  const onFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleUpload(file, currentUploadTarget.current);
    e.target.value = "";
  };

  // Sort items by date (oldest first)
  const sortByDate = (items: any[]) => [...items].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  // Step indicator component
  const StepIndicator = ({ currentStep }: { currentStep: number }) => {
    const steps = [
      { num: 1, label: t.purchaseOrders.step1Purchase, icon: ShoppingCart },
      { num: 2, label: t.purchaseOrders.step2Warehouse, icon: Package },
      { num: 3, label: t.purchaseOrders.step3Delivery, icon: Truck },
    ];
    return (
      <div className="flex items-center justify-center gap-0 mb-6">
        {steps.map((step, idx) => {
          const Icon = step.icon;
          const isActive = step.num === currentStep;
          const isDone = step.num < currentStep;
          return (
            <div key={step.num} className="flex items-center">
              <div className={`flex flex-col items-center ${isActive ? "scale-110" : ""}`}>
                <div className={`w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all ${
                  isDone ? "bg-green-500 border-green-500 text-white" :
                  isActive ? "bg-primary border-primary text-primary-foreground shadow-lg" :
                  "bg-muted border-muted-foreground/30 text-muted-foreground"
                }`}>
                  {isDone ? <CheckCircle2 className="w-5 h-5" /> : <Icon className="w-5 h-5" />}
                </div>
                <span className={`text-[10px] mt-1 font-medium text-center max-w-[70px] leading-tight ${
                  isActive ? "text-primary" : isDone ? "text-green-600" : "text-muted-foreground"
                }`}>{step.label}</span>
              </div>
              {idx < steps.length - 1 && (
                <div className={`w-12 h-0.5 mx-1 mt-[-16px] ${isDone ? "bg-green-500" : "bg-muted-foreground/20"}`} />
              )}
            </div>
          );
        })}
      </div>
    );
  };

  // Item card component
  const ItemCard = ({ item, step, onAction }: { item: any; step: number; onAction: () => void }) => {
    const statusColors: Record<string, string> = {
      approved: "bg-blue-100 text-blue-800",
      funded: "bg-indigo-100 text-indigo-800",
      purchased: "bg-amber-100 text-amber-800",
      delivered_to_warehouse: "bg-emerald-100 text-emerald-800",
      delivered_to_requester: "bg-green-100 text-green-800",
    };
    const statusLabels: Record<string, string> = {
      approved: t.purchaseOrders.pendingPurchase,
      funded: t.purchaseOrders.pendingPurchase,
      purchased: t.purchaseOrders.pendingWarehouse,
      delivered_to_warehouse: t.purchaseOrders.pendingDelivery,
      delivered_to_requester: t.purchaseOrders.deliveredToRequester,
    };

    return (
      <Card className="hover:shadow-md transition-shadow border-l-4 border-l-primary/60">
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-semibold text-sm truncate">{item.itemName}</h3>
                <Badge variant="outline" className={`text-[10px] ${statusColors[item.status] || ""}`}>
                  {statusLabels[item.status] || item.status}
                </Badge>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span className="flex items-center gap-1"><Hash className="w-3 h-3" /> {t.purchaseOrders.quantity}: <strong className="text-foreground">{item.quantity} {item.unit}</strong></span>
                <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> {new Date(item.createdAt).toLocaleDateString(language === "ar" ? "ar-SA" : "en-US")}</span>
                {item.description && <span className="col-span-2 sm:col-span-1 truncate">{item.description}</span>}
              </div>

              {item.estimatedUnitCost && (
                <div className="text-xs text-muted-foreground">
                  {t.purchaseOrders.estimatedUnitCost}: <strong className="text-foreground">{parseFloat(item.estimatedUnitCost).toLocaleString()} ر.س</strong>
                </div>
              )}

              {/* Show photos if available */}
              <div className="flex gap-2 flex-wrap">
                {item.purchasedPhotoUrl && (
                  <img src={mediaUrl(item.purchasedPhotoUrl)} alt="purchased" className="w-12 h-12 object-cover rounded border cursor-pointer hover:opacity-80" onClick={() => window.open(mediaUrl(item.purchasedPhotoUrl), "_blank")} />
                )}
                {item.invoicePhotoUrl && (
                  <img src={mediaUrl(item.invoicePhotoUrl)} alt="invoice" className="w-12 h-12 object-cover rounded border cursor-pointer hover:opacity-80" onClick={() => window.open(mediaUrl(item.invoicePhotoUrl), "_blank")} />
                )}
                {item.warehousePhotoUrl && (
                  <img src={mediaUrl(item.warehousePhotoUrl)} alt="warehouse" className="w-12 h-12 object-cover rounded border cursor-pointer hover:opacity-80" onClick={() => window.open(mediaUrl(item.warehousePhotoUrl), "_blank")} />
                )}
              </div>
            </div>

            <Button size="sm" className="shrink-0 gap-1.5" onClick={onAction}>
              {step === 1 && <><ShoppingCart className="w-4 h-4" /> {t.purchaseOrders.confirmPurchase}</>}
              {step === 2 && <><Package className="w-4 h-4" /> {t.purchaseOrders.confirmDeliveryToWarehouse}</>}
              {step === 3 && <><Truck className="w-4 h-4" /> تسليم للفني</>}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="space-y-6" dir={isRTL ? "rtl" : "ltr"}>
      {/* Hidden file input */}
      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={onFileSelect} />

      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <ShoppingCart className="w-6 h-6 text-primary" />
          {t.purchaseOrders.purchaseCycle}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {t.purchaseOrders.step1Purchase} → {t.purchaseOrders.step2Warehouse} → {t.purchaseOrders.step3Delivery}
        </p>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="estimate" className="gap-1.5">
            <Clock className="w-4 h-4" />
            <span className="hidden sm:inline">التسعير</span>
            {pendingEstimate.length > 0 && <Badge variant="destructive" className="text-[10px] px-1.5 py-0">{pendingEstimate.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="purchase" className="gap-1.5">
            <ShoppingCart className="w-4 h-4" />
            <span className="hidden sm:inline">{t.purchaseOrders.step1Purchase}</span>
            {pendingPurchase.length > 0 && <Badge variant="destructive" className="text-[10px] px-1.5 py-0">{pendingPurchase.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="warehouse" className="gap-1.5">
            <Package className="w-4 h-4" />
            <span className="hidden sm:inline">{t.purchaseOrders.step2Warehouse}</span>
            {pendingWarehouse.length > 0 && <Badge variant="destructive" className="text-[10px] px-1.5 py-0">{pendingWarehouse.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="delivery" className="gap-1.5">
            <Truck className="w-4 h-4" />
            <span className="hidden sm:inline">{t.purchaseOrders.step3Delivery}</span>
            {pendingDelivery.length > 0 && <Badge variant="destructive" className="text-[10px] px-1.5 py-0">{pendingDelivery.length}</Badge>}
          </TabsTrigger>
        </TabsList>

        {/* ==================== TAB 0: Estimate (Delegate - Revision Items) ==================== */}
        <TabsContent value="estimate" className="mt-4 space-y-4">
          {pendingEstimate.length === 0 ? (
            <Card><CardContent className="p-8 text-center text-muted-foreground">
              <CheckCircle2 className="w-10 h-10 mx-auto mb-3 text-green-500" />
              <p className="font-medium">لا توجد أصناف بانتظار التسعير</p>
            </CardContent></Card>
          ) : (
            <div className="space-y-3">
              {sortByDate(pendingEstimate).map((item: any) => (
                <Card key={item.id} className="border-amber-200 bg-amber-50">
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">{item.itemName}</p>
                        {item.description && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{item.description}</p>}
                        <div className="flex flex-wrap gap-2 mt-1.5">
                          <Badge variant="outline" className="text-[10px]">الكمية: {item.quantity} {item.unit || ""}</Badge>
                          {item.purchaseOrderNumber && <Badge variant="outline" className="text-[10px]">{item.purchaseOrderNumber}</Badge>}
                        </div>
                        {item.itemRevisionNote && (
                          <div className="mt-2 text-xs bg-red-50 border border-red-200 rounded p-2 text-red-700">
                            <strong>سبب المراجعة السابقة:</strong> {item.itemRevisionNote}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2 items-end">
                      <div className="flex-1">
                        <Label className="text-xs text-amber-700">السعر التقديري للوحدة (ر.س)</Label>
                        <Input
                          type="number"
                          placeholder="0.00"
                          value={estimateValues[item.id] || ""}
                          onChange={e => setEstimateValues(p => ({ ...p, [item.id]: e.target.value }))}
                          className="mt-1 bg-white"
                        />
                      </div>
                      {estimateValues[item.id] && parseFloat(estimateValues[item.id]) > 0 && (
                        <div className="text-xs text-amber-700 pb-2">
                          = {(parseFloat(estimateValues[item.id]) * item.quantity).toLocaleString()} ر.س
                        </div>
                      )}
                      <Button
                        size="sm"
                        disabled={!estimateValues[item.id] || parseFloat(estimateValues[item.id]) <= 0 || estimateCostMut.isPending}
                        onClick={() => {
                          if (!estimateValues[item.id] || parseFloat(estimateValues[item.id]) <= 0) {
                            toast.error("يرجى إدخال السعر");
                            return;
                          }
                          estimateCostMut.mutate({
                            purchaseOrderId: item.purchaseOrderId,
                            items: [{ id: item.id, estimatedUnitCost: estimateValues[item.id] }]
                          });
                        }}
                        className="shrink-0"
                      >
                        {estimateCostMut.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "حفظ التسعير"}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ==================== TAB 1: Purchase (Delegate) ==================== */}
        <TabsContent value="purchase" className="mt-4 space-y-4">
          <StepIndicator currentStep={1} />
          {pendingPurchase.length === 0 ? (
            <Card><CardContent className="p-8 text-center text-muted-foreground">
              <CheckCircle2 className="w-10 h-10 mx-auto mb-3 text-green-500" />
              <p className="font-medium">{t.purchaseOrders.noItemsPending}</p>
            </CardContent></Card>
          ) : (
            <div className="space-y-3">
              {sortByDate(pendingPurchase).map((item: any) => (
                <ItemCard key={item.id} item={item} step={1} onAction={() => {
                  setPurchasePhotos({});
                  setPurchaseDialog(item);
                }} />
              ))}
            </div>
          )}
        </TabsContent>

        {/* ==================== TAB 2: Warehouse Receiving ==================== */}
        <TabsContent value="warehouse" className="mt-4 space-y-4">
          <StepIndicator currentStep={2} />
          {pendingWarehouse.length === 0 ? (
            <Card><CardContent className="p-8 text-center text-muted-foreground">
              <CheckCircle2 className="w-10 h-10 mx-auto mb-3 text-green-500" />
              <p className="font-medium">{t.purchaseOrders.noItemsPending}</p>
            </CardContent></Card>
          ) : (
            <div className="space-y-3">
              {sortByDate(pendingWarehouse).map((item: any) => (
                <ItemCard key={item.id} item={item} step={2} onAction={() => {
                  setWarehouseForm({ supplierName: "", supplierItemName: "", actualUnitCost: "", warehousePhotoUrl: "" });
                  setWarehouseDialog(item);
                }} />
              ))}
            </div>
          )}
        </TabsContent>

        {/* ==================== TAB 3: Delivery to Assigned Technician ==================== */}
        <TabsContent value="delivery" className="mt-4 space-y-4">
          <StepIndicator currentStep={3} />
          {pendingDelivery.length === 0 ? (
            <Card><CardContent className="p-8 text-center text-muted-foreground">
              <CheckCircle2 className="w-10 h-10 mx-auto mb-3 text-green-500" />
              <p className="font-medium">{t.purchaseOrders.noItemsPending}</p>
            </CardContent></Card>
          ) : (
            <div className="space-y-3">
              {sortByDate(pendingDelivery).map((item: any) => (
                <ItemCard key={item.id} item={item} step={3} onAction={() => {
                  // Preselect the assigned technician from the linked ticket
                  const preselect = item.ticketAssignedToId ? String(item.ticketAssignedToId) : "";
                  setDeliveryUserId(preselect);
                  setDeliveryDialog(item);
                }} />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* ==================== DIALOG 1: Purchase Confirmation ==================== */}
      <Dialog open={!!purchaseDialog} onOpenChange={(open) => !open && setPurchaseDialog(null)}>
        <DialogContent className="max-w-md" dir={isRTL ? "rtl" : "ltr"}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShoppingCart className="w-5 h-5 text-primary" />
              {t.purchaseOrders.confirmPurchase}
            </DialogTitle>
          </DialogHeader>

          {purchaseDialog && (
            <div className="space-y-4">
              {/* Item info */}
              <div className="bg-muted/50 rounded-lg p-3 space-y-1">
                <p className="font-semibold text-sm">{purchaseDialog.itemName}</p>
                <p className="text-xs text-muted-foreground">{t.purchaseOrders.quantity}: {purchaseDialog.quantity} {purchaseDialog.unit}</p>
                {purchaseDialog.description && <p className="text-xs text-muted-foreground">{purchaseDialog.description}</p>}
              </div>

              {/* Photo uploads */}
              <div className="grid grid-cols-2 gap-4">
                {/* Purchased item photo */}
                <div className="space-y-2">
                  <Label className="text-xs font-medium flex items-center gap-1">
                    <Camera className="w-3.5 h-3.5" /> {t.purchaseOrders.purchasedItemPhoto} *
                  </Label>
                  {purchasePhotos.purchased ? (
                    <div className="relative">
                      <img src={purchasePhotos.purchased} alt="purchased" className="w-full h-28 object-cover rounded-lg border" />
                      <Button size="sm" variant="destructive" className="absolute top-1 end-1 h-6 w-6 p-0" onClick={() => setPurchasePhotos(p => ({ ...p, purchased: undefined }))}>×</Button>
                    </div>
                  ) : (
                    <Button variant="outline" className="w-full h-28 flex flex-col gap-2 border-dashed" onClick={() => triggerUpload("purchased")} disabled={uploading === "purchased"}>
                      {uploading === "purchased" ? <Loader2 className="w-6 h-6 animate-spin" /> : <><ImageIcon className="w-6 h-6 text-muted-foreground" /><span className="text-[10px] text-muted-foreground">{t.common.upload}</span></>}
                    </Button>
                  )}
                </div>

                {/* Invoice photo */}
                <div className="space-y-2">
                  <Label className="text-xs font-medium flex items-center gap-1">
                    <FileText className="w-3.5 h-3.5" /> {t.purchaseOrders.invoicePhoto} *
                  </Label>
                  {purchasePhotos.invoice ? (
                    <div className="relative">
                      <img src={purchasePhotos.invoice} alt="invoice" className="w-full h-28 object-cover rounded-lg border" />
                      <Button size="sm" variant="destructive" className="absolute top-1 end-1 h-6 w-6 p-0" onClick={() => setPurchasePhotos(p => ({ ...p, invoice: undefined }))}>×</Button>
                    </div>
                  ) : (
                    <Button variant="outline" className="w-full h-28 flex flex-col gap-2 border-dashed" onClick={() => triggerUpload("invoice")} disabled={uploading === "invoice"}>
                      {uploading === "invoice" ? <Loader2 className="w-6 h-6 animate-spin" /> : <><FileText className="w-6 h-6 text-muted-foreground" /><span className="text-[10px] text-muted-foreground">{t.common.upload}</span></>}
                    </Button>
                  )}
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setPurchaseDialog(null)}>{t.common.cancel}</Button>
            <Button
              className="gap-1.5"
              disabled={!purchasePhotos.purchased || !purchasePhotos.invoice || confirmPurchaseMut.isPending}
              onClick={() => {
                if (!purchasePhotos.purchased || !purchasePhotos.invoice) {
                  toast.error(t.purchaseOrders.uploadRequired);
                  return;
                }
                confirmPurchaseMut.mutate({
                  itemId: purchaseDialog.id,
                  purchasedPhotoUrl: purchasePhotos.purchased,
                  invoicePhotoUrl: purchasePhotos.invoice,
                });
                setPurchaseDialog(null);
              }}
            >
              {confirmPurchaseMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              {t.purchaseOrders.confirmPurchase}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ==================== DIALOG 2: Warehouse Receiving ==================== */}
      <Dialog open={!!warehouseDialog} onOpenChange={(open) => !open && setWarehouseDialog(null)}>
        <DialogContent className="max-w-md" dir={isRTL ? "rtl" : "ltr"}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Package className="w-5 h-5 text-emerald-600" />
              {t.purchaseOrders.confirmDeliveryToWarehouse}
            </DialogTitle>
          </DialogHeader>

          {warehouseDialog && (
            <div className="space-y-4">
              {/* Item info */}
              <div className="bg-muted/50 rounded-lg p-3 space-y-1">
                <p className="font-semibold text-sm">{warehouseDialog.itemName}</p>
                <p className="text-xs text-muted-foreground">{t.purchaseOrders.quantity}: {warehouseDialog.quantity} {warehouseDialog.unit}</p>
              </div>

              {/* Show purchase photos */}
              {(warehouseDialog.purchasedPhotoUrl || warehouseDialog.invoicePhotoUrl) && (
                <div className="flex gap-2">
                  {warehouseDialog.purchasedPhotoUrl && (
                    <div className="flex-1">
                      <p className="text-[10px] text-muted-foreground mb-1">{t.purchaseOrders.purchasedItemPhoto}</p>
                      <img src={mediaUrl(warehouseDialog.purchasedPhotoUrl)} alt="purchased" className="w-full h-20 object-cover rounded border cursor-pointer" onClick={() => window.open(mediaUrl(warehouseDialog.purchasedPhotoUrl), "_blank")} />
                    </div>
                  )}
                  {warehouseDialog.invoicePhotoUrl && (
                    <div className="flex-1">
                      <p className="text-[10px] text-muted-foreground mb-1">{t.purchaseOrders.invoicePhoto}</p>
                      <img src={mediaUrl(warehouseDialog.invoicePhotoUrl)} alt="invoice" className="w-full h-20 object-cover rounded border cursor-pointer" onClick={() => window.open(mediaUrl(warehouseDialog.invoicePhotoUrl), "_blank")} />
                    </div>
                  )}
                </div>
              )}

              {/* Form fields */}
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">{t.purchaseOrders.supplier} *</Label>
                  <Input value={warehouseForm.supplierName} onChange={e => setWarehouseForm(p => ({ ...p, supplierName: e.target.value }))} placeholder={t.purchaseOrders.supplier} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{t.purchaseOrders.supplierItemName} *</Label>
                  <Input value={warehouseForm.supplierItemName} onChange={e => setWarehouseForm(p => ({ ...p, supplierItemName: e.target.value }))} placeholder={t.purchaseOrders.supplierItemName} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{t.purchaseOrders.itemCost} (ر.س) *</Label>
                  <Input type="number" value={warehouseForm.actualUnitCost} onChange={e => setWarehouseForm(p => ({ ...p, actualUnitCost: e.target.value }))} placeholder="0.00" />
                  {warehouseForm.actualUnitCost && (
                    <p className="text-xs text-emerald-600 bg-emerald-50 rounded p-1.5">
                      {t.purchaseOrders.actualTotal}: <strong>{(parseFloat(warehouseForm.actualUnitCost) * warehouseDialog.quantity).toLocaleString()} ر.س</strong>
                    </p>
                  )}
                </div>

                {/* Warehouse photo */}
                <div className="space-y-1.5">
                  <Label className="text-xs flex items-center gap-1"><Camera className="w-3.5 h-3.5" /> {t.purchaseOrders.warehousePhoto} *</Label>
                  {warehouseForm.warehousePhotoUrl ? (
                    <div className="relative">
                      <img src={mediaUrl(warehouseForm.warehousePhotoUrl)} alt="warehouse" className="w-full h-32 object-cover rounded-lg border" />
                      <Button size="sm" variant="destructive" className="absolute top-1 end-1 h-6 w-6 p-0" onClick={() => setWarehouseForm(p => ({ ...p, warehousePhotoUrl: "" }))}>×</Button>
                    </div>
                  ) : (
                    <Button variant="outline" className="w-full h-24 flex flex-col gap-2 border-dashed" onClick={() => triggerUpload("warehouse")} disabled={uploading === "warehouse"}>
                      {uploading === "warehouse" ? <Loader2 className="w-6 h-6 animate-spin" /> : <><Camera className="w-6 h-6 text-muted-foreground" /><span className="text-[10px] text-muted-foreground">{t.common.upload}</span></>}
                    </Button>
                  )}
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setWarehouseDialog(null)}>{t.common.cancel}</Button>
            <Button
              className="gap-1.5"
              disabled={!warehouseForm.supplierName || !warehouseForm.actualUnitCost || !warehouseForm.warehousePhotoUrl || confirmWarehouseMut.isPending}
              onClick={() => {
                confirmWarehouseMut.mutate({
                  itemId: warehouseDialog.id,
                  supplierName: warehouseForm.supplierName,
                  supplierItemName: warehouseForm.supplierItemName,
                  actualUnitCost: warehouseForm.actualUnitCost,
                  warehousePhotoUrl: warehouseForm.warehousePhotoUrl,
                });
                setWarehouseDialog(null);
              }}
            >
              {confirmWarehouseMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Package className="w-4 h-4" />}
              {t.purchaseOrders.confirmDeliveryToWarehouse}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ==================== DIALOG 3: Delivery to Assigned Technician ==================== */}
      <Dialog open={!!deliveryDialog} onOpenChange={(open) => !open && setDeliveryDialog(null)}>
        <DialogContent className="max-w-md" dir={isRTL ? "rtl" : "ltr"}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Truck className="w-5 h-5 text-blue-600" />
              تسليم للفني المسند
            </DialogTitle>
          </DialogHeader>

          {deliveryDialog && (
            <div className="space-y-4">
              {/* Item info */}
              <div className="bg-muted/50 rounded-lg p-3 space-y-2">
                <p className="font-semibold text-sm">{deliveryDialog.itemName}</p>
                <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                  <span>{t.purchaseOrders.quantity}: <strong className="text-foreground">{deliveryDialog.quantity} {deliveryDialog.unit}</strong></span>
                  {deliveryDialog.supplierName && <span>{t.purchaseOrders.supplier}: <strong className="text-foreground">{deliveryDialog.supplierName}</strong></span>}
                  {deliveryDialog.actualUnitCost && <span>{t.purchaseOrders.itemCost}: <strong className="text-foreground">{parseFloat(deliveryDialog.actualUnitCost).toLocaleString()} ر.س</strong></span>}
                </div>
              </div>

              {/* Show all photos */}
              <div className="flex gap-2 flex-wrap">
                {deliveryDialog.purchasedPhotoUrl && (
                  <div>
                    <p className="text-[10px] text-muted-foreground mb-1">{t.purchaseOrders.purchasedItemPhoto}</p>
                    <img src={mediaUrl(deliveryDialog.purchasedPhotoUrl)} alt="purchased" className="w-16 h-16 object-cover rounded border cursor-pointer" onClick={() => window.open(mediaUrl(deliveryDialog.purchasedPhotoUrl), "_blank")} />
                  </div>
                )}
                {deliveryDialog.invoicePhotoUrl && (
                  <div>
                    <p className="text-[10px] text-muted-foreground mb-1">{t.purchaseOrders.invoicePhoto}</p>
                    <img src={mediaUrl(deliveryDialog.invoicePhotoUrl)} alt="invoice" className="w-16 h-16 object-cover rounded border cursor-pointer" onClick={() => window.open(mediaUrl(deliveryDialog.invoicePhotoUrl), "_blank")} />
                  </div>
                )}
                {deliveryDialog.warehousePhotoUrl && (
                  <div>
                    <p className="text-[10px] text-muted-foreground mb-1">{t.purchaseOrders.warehousePhoto}</p>
                    <img src={mediaUrl(deliveryDialog.warehousePhotoUrl)} alt="warehouse" className="w-16 h-16 object-cover rounded border cursor-pointer" onClick={() => window.open(mediaUrl(deliveryDialog.warehousePhotoUrl), "_blank")} />
                  </div>
                )}
              </div>

              {/* Select technician to deliver to - preselected from ticket assignment */}
              <div className="space-y-1.5">
                <Label className="text-xs flex items-center gap-1"><User className="w-3.5 h-3.5" /> الفني المسند</Label>
                {deliveryDialog.ticketAssignedToId && (
                  <p className="text-xs text-emerald-600 font-medium">
                    ✅ تم تحديد الفني تلقائيًا من بيانات البلاغ
                  </p>
                )}
                <Select value={deliveryUserId} onValueChange={setDeliveryUserId}>
                  <SelectTrigger><SelectValue placeholder="اختر الفني..." /></SelectTrigger>
                  <SelectContent>
                    {allUsers.filter((u: any) => u.role === "technician" || u.role === "supervisor" || u.role === "maintenance_manager").map((u: any) => (
                      <SelectItem key={u.id} value={String(u.id)}>{u.name} ({u.role})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setDeliveryDialog(null)}>{t.common.cancel}</Button>
            <Button
              className="gap-1.5"
              disabled={confirmDeliveryMut.isPending}
              onClick={() => {
                confirmDeliveryMut.mutate({
                  itemId: deliveryDialog.id,
                  deliveredToId: deliveryUserId ? parseInt(deliveryUserId) : undefined,
                });
                setDeliveryDialog(null);
              }}
            >
              {confirmDeliveryMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Truck className="w-4 h-4" />}
              تأكيد التسليم للفني
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
