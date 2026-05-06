import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ShoppingBag, Package, Clock, CheckCircle2, Camera,
  Loader2, AlertCircle, DollarSign, FileText, Truck, FileDown
} from "lucide-react";
import { useState, useMemo } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";
import { useTranslation, useLanguage } from "@/contexts/LanguageContext";

type ItemStatus = "pending" | "estimated" | "approved" | "purchased" | "received";

function numberToArabicWords(num: number): string {
  if (num === 0) return "صفر ريال";
  const ones = ["", "واحد", "اثنان", "ثلاثة", "أربعة", "خمسة", "ستة", "سبعة", "ثمانية", "تسعة"];
  const teens = ["عشرة", "أحد عشر", "اثنا عشر", "ثلاثة عشر", "أربعة عشر", "خمسة عشر", "ستة عشر", "سبعة عشر", "ثمانية عشر", "تسعة عشر"];
  const tens = ["", "", "عشرون", "ثلاثون", "أربعون", "خمسون", "ستون", "سبعون", "ثمانون", "تسعون"];
  const hundreds = ["", "مائة", "مائتان", "ثلاثمائة", "أربعمائة", "خمسمائة", "ستمائة", "سبعمائة", "ثمانمائة", "تسعمائة"];
  const n = Math.floor(num);
  const parts: string[] = [];
  if (n >= 1000) { const t = Math.floor(n / 1000); parts.push(t === 1 ? "ألف" : t === 2 ? "ألفان" : ones[t] + " آلاف"); }
  const rem = n % 1000;
  if (rem >= 100) parts.push(hundreds[Math.floor(rem / 100)]);
  const r = rem % 100;
  if (r >= 10 && r < 20) parts.push(teens[r - 10]);
  else { if (r % 10 > 0) parts.push(ones[r % 10]); if (r >= 20) parts.push(tens[Math.floor(r / 10)]); }
  return parts.join(" و") + " ريال";
}

export default function MyItems() {
  const { t: tr } = useLanguage();
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const { t, language } = useTranslation();
  const locale = language === "ar" ? "ar-SA" : language === "ur" ? "ur-PK" : "en-US";
  const currency = language === "en" ? "SAR" : "ر.س";

  const { data: myItems, isLoading, refetch } = trpc.purchaseOrders.myItems.useQuery(undefined, {
    enabled: user?.role === "delegate" || user?.role === "admin" || user?.role === "owner",
  });

  const [exportingPdf, setExportingPdf] = useState(false);

  const handleExportPdf = async () => {
    setExportingPdf(true);
    try {
      const res = await fetch("/api/export/my-items-pdf", { credentials: "include" });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `my-items-${new Date().toISOString().slice(0, 10)}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(language === "ar" ? "تم تصدير PDF بنجاح" : "PDF exported successfully");
    } catch {
      toast.error(language === "ar" ? "فشل تصدير PDF" : "PDF export failed");
    } finally {
      setExportingPdf(false);
    }
  };

  const [activeTab, setActiveTab] = useState("pending_estimate");
  const [estimateDialog, setEstimateDialog] = useState<any>(null);
  const [estimateCost, setEstimateCost] = useState("");
  const [purchaseDialog, setPurchaseDialog] = useState<any>(null);
  const [uploadingField, setUploadingField] = useState<string | null>(null);
  const [invoiceUrl, setInvoiceUrl] = useState("");
  const [purchasedUrl, setPurchasedUrl] = useState("");

  const estimateMut = trpc.purchaseOrders.estimateCost.useMutation({
    onSuccess: () => {
      toast.success(t.common.save);
      setEstimateDialog(null);
      setEstimateCost("");
      refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  const confirmPurchaseMut = trpc.purchaseOrders.confirmItemPurchase.useMutation({
    onSuccess: () => {
      toast.success(t.common.confirm);
      setPurchaseDialog(null);
      setInvoiceUrl("");
      setPurchasedUrl("");
      refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  const handleUpload = async (field: "invoice" | "purchased", file: File) => {
    setUploadingField(field);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      const data = await res.json();
      if (data.url) {
        if (field === "invoice") setInvoiceUrl(data.url);
        else setPurchasedUrl(data.url);
        toast.success(t.common.save);
      }
    } catch { toast.error(t.common.close); }
    setUploadingField(null);
  };

  const grouped = useMemo(() => {
    if (!myItems) return { pending_estimate: [], approved: [], purchased: [], received: [] };
    const items = myItems as any[];
    return {
      pending_estimate: items.filter((i: any) => i.status === "pending" || i.status === "estimated"),
      approved: items.filter((i: any) => i.status === "approved"),
      purchased: items.filter((i: any) => i.status === "purchased"),
      received: items.filter((i: any) => i.status === "received"),
    };
  }, [myItems]);

  const tabCounts = {
    pending_estimate: grouped.pending_estimate.length,
    approved: grouped.approved.length,
    purchased: grouped.purchased.length,
    received: grouped.received.length,
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <div className="grid gap-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-32 w-full" />)}</div>
      </div>
    );
  }

  const renderItem = (item: any) => {
    return (
      <Card key={item.id} className="hover:shadow-md transition-all duration-200 border-r-4" style={{ borderRightColor: item.status === "approved" ? "#10b981" : item.status === "purchased" ? "#8b5cf6" : item.status === "received" ? "#22c55e" : "#f59e0b" }}>
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-sm truncate">{item.itemName}</h3>
              {item.description && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{item.description}</p>}
            </div>
            <Badge className="shrink-0 text-[10px] gap-1">
              {item.status}
            </Badge>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs mb-3">
            <div className="bg-muted/50 rounded-lg p-2">
              <span className="text-muted-foreground block">{t.purchaseOrders.quantity}</span>
              <span className="font-bold">{item.quantity} {item.unit || ""}</span>
            </div>
            <div className="bg-muted/50 rounded-lg p-2">
              <span className="text-muted-foreground block">{t.purchaseOrders.poNumber}</span>
              <Button variant="link" className="h-auto p-0 text-xs font-bold" onClick={() => setLocation(`/purchase-orders/${item.purchaseOrderId}`)}>
                #{item.purchaseOrderId}
              </Button>
            </div>
            {item.estimatedUnitCost && (
              <div className="bg-muted/50 rounded-lg p-2">
                <span className="text-muted-foreground block">{t.purchaseOrders.estimatedUnitCost}</span>
                <span className="font-bold">{parseFloat(item.estimatedUnitCost).toLocaleString(locale)} {currency}</span>
              </div>
            )}
            {item.estimatedTotalCost && (
              <div className="bg-muted/50 rounded-lg p-2">
                <span className="text-muted-foreground block">{t.purchaseOrders.estimatedTotal}</span>
                <span className="font-bold">{parseFloat(item.estimatedTotalCost).toLocaleString(locale)} {currency}</span>
              </div>
            )}
          </div>

          {item.photoUrl && (
            <div className="mb-3">
              <img src={item.photoUrl} alt={item.itemName} className="w-full h-24 object-cover rounded-lg border" />
            </div>
          )}

          {item.notes && (
            <p className="text-xs text-muted-foreground bg-muted/30 rounded-lg p-2 mb-3">
              <FileText className="w-3 h-3 inline ml-1" />{item.notes}
            </p>
          )}

          {item.status === "pending" && (
            <Button size="sm" className="w-full gap-1.5 bg-amber-600 hover:bg-amber-700" onClick={() => { setEstimateDialog(item); setEstimateCost(""); }}>
              <DollarSign className="w-3.5 h-3.5" /> {t.purchaseOrders.estimatedUnitCost}
            </Button>
          )}

          {item.status === "approved" && (
            <Button size="sm" className="w-full gap-1.5 bg-emerald-600 hover:bg-emerald-700" onClick={() => { setPurchaseDialog(item); setInvoiceUrl(""); setPurchasedUrl(""); }}>
              <ShoppingBag className="w-3.5 h-3.5" /> {t.purchaseOrders.confirmPurchase}
            </Button>
          )}

          {item.status === "purchased" && (
            <div className="flex items-center gap-2 text-xs text-purple-700 bg-purple-50 rounded-lg p-2">
              <Truck className="w-4 h-4" />
              <span>{t.purchaseOrders.confirmPurchase}</span>
            </div>
          )}

          {item.status === "received" && (
            <div className="flex items-center gap-2 text-xs text-green-700 bg-green-50 rounded-lg p-2">
              <CheckCircle2 className="w-4 h-4" />
              <span>{t.purchaseOrders.receiveItem}</span>
              {item.actualUnitCost && <span className="mr-auto font-bold">{parseFloat(item.actualUnitCost).toLocaleString(locale)} {currency}</span>}
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <ShoppingBag className="w-6 h-6 text-primary" /> {t.nav.myItems}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">{t.purchaseOrders.items}</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-2 shrink-0"
          onClick={handleExportPdf}
          disabled={exportingPdf || !myItems || (myItems as any[]).length === 0}
        >
          {exportingPdf ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />}
          {language === "ar" ? "تصدير PDF" : "Export PDF"}
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="border-amber-200 bg-amber-50/50 cursor-pointer hover:shadow-md transition-all" onClick={() => setActiveTab("pending_estimate")}>
          <CardContent className="p-3 text-center">
            <Clock className="w-5 h-5 mx-auto text-amber-600 mb-1" />
            <p className="text-2xl font-bold text-amber-800">{tabCounts.pending_estimate}</p>
            <p className="text-[10px] text-amber-600">{t.purchaseOrders.estimatedUnitCost}</p>
          </CardContent>
        </Card>
        <Card className="border-emerald-200 bg-emerald-50/50 cursor-pointer hover:shadow-md transition-all" onClick={() => setActiveTab("approved")}>
          <CardContent className="p-3 text-center">
            <CheckCircle2 className="w-5 h-5 mx-auto text-emerald-600 mb-1" />
            <p className="text-2xl font-bold text-emerald-800">{tabCounts.approved}</p>
            <p className="text-[10px] text-emerald-600">{t.purchaseOrders.confirmPurchase}</p>
          </CardContent>
        </Card>
        <Card className="border-purple-200 bg-purple-50/50 cursor-pointer hover:shadow-md transition-all" onClick={() => setActiveTab("purchased")}>
          <CardContent className="p-3 text-center">
            <ShoppingBag className="w-5 h-5 mx-auto text-purple-600 mb-1" />
            <p className="text-2xl font-bold text-purple-800">{tabCounts.purchased}</p>
            <p className="text-[10px] text-purple-600">{t.purchaseOrders.confirmPurchase}</p>
          </CardContent>
        </Card>
        <Card className="border-green-200 bg-green-50/50 cursor-pointer hover:shadow-md transition-all" onClick={() => setActiveTab("received")}>
          <CardContent className="p-3 text-center">
            <Package className="w-5 h-5 mx-auto text-green-600 mb-1" />
            <p className="text-2xl font-bold text-green-800">{tabCounts.received}</p>
            <p className="text-[10px] text-green-600">{t.purchaseOrders.receiveItem}</p>
          </CardContent>
        </Card>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid grid-cols-4 w-full">
          <TabsTrigger value="pending_estimate" className="text-xs gap-1">
            <Clock className="w-3 h-3" /> {t.purchaseOrders.estimatedUnitCost}
            {tabCounts.pending_estimate > 0 && <Badge variant="secondary" className="text-[9px] h-4 px-1">{tabCounts.pending_estimate}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="approved" className="text-xs gap-1">
            <CheckCircle2 className="w-3 h-3" /> {t.purchaseOrders.confirmPurchase}
            {tabCounts.approved > 0 && <Badge variant="secondary" className="text-[9px] h-4 px-1">{tabCounts.approved}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="purchased" className="text-xs gap-1">
            <ShoppingBag className="w-3 h-3" /> {t.purchaseOrders.confirmPurchase}
            {tabCounts.purchased > 0 && <Badge variant="secondary" className="text-[9px] h-4 px-1">{tabCounts.purchased}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="received" className="text-xs gap-1">
            <Package className="w-3 h-3" /> {t.purchaseOrders.receiveItem}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="pending_estimate" className="space-y-3 mt-4">
          {grouped.pending_estimate.length === 0 ? (
            <Card><CardContent className="p-8 text-center">
              <Clock className="w-10 h-10 mx-auto text-muted-foreground/30 mb-3" />
              <p className="text-sm text-muted-foreground">{t.common.noData}</p>
            </CardContent></Card>
          ) : (
            <>
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-center gap-2 text-xs text-amber-800">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{t.purchaseOrders.estimatedUnitCost}</span>
              </div>
              {grouped.pending_estimate.map(renderItem)}
            </>
          )}
        </TabsContent>

        <TabsContent value="approved" className="space-y-3 mt-4">
          {grouped.approved.length === 0 ? (
            <Card><CardContent className="p-8 text-center">
              <CheckCircle2 className="w-10 h-10 mx-auto text-muted-foreground/30 mb-3" />
              <p className="text-sm text-muted-foreground">{t.common.noData}</p>
            </CardContent></Card>
          ) : (
            <>
              <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 flex items-center gap-2 text-xs text-emerald-800">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{t.purchaseOrders.confirmPurchase}</span>
              </div>
              {grouped.approved.map(renderItem)}
            </>
          )}
        </TabsContent>

        <TabsContent value="purchased" className="space-y-3 mt-4">
          {grouped.purchased.length === 0 ? (
            <Card><CardContent className="p-8 text-center">
              <ShoppingBag className="w-10 h-10 mx-auto text-muted-foreground/30 mb-3" />
              <p className="text-sm text-muted-foreground">{t.common.noData}</p>
            </CardContent></Card>
          ) : grouped.purchased.map(renderItem)}
        </TabsContent>

        <TabsContent value="received" className="space-y-3 mt-4">
          {grouped.received.length === 0 ? (
            <Card><CardContent className="p-8 text-center">
              <Package className="w-10 h-10 mx-auto text-muted-foreground/30 mb-3" />
              <p className="text-sm text-muted-foreground">{t.common.noData}</p>
            </CardContent></Card>
          ) : grouped.received.map(renderItem)}
        </TabsContent>
      </Tabs>

      <Dialog open={!!estimateDialog} onOpenChange={(open) => { if (!open) setEstimateDialog(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">{t.purchaseOrders.estimatedUnitCost}</DialogTitle>
          </DialogHeader>
          {estimateDialog && (
            <div className="space-y-4">
              <div className="bg-muted/50 rounded-lg p-3">
                <p className="font-medium text-sm">{estimateDialog.itemName}</p>
                <p className="text-xs text-muted-foreground mt-1">{t.purchaseOrders.quantity}: {estimateDialog.quantity} {estimateDialog.unit || ""}</p>
              </div>
              <div className="space-y-2">
                <Label>{t.purchaseOrders.estimatedUnitCost} ({currency}) *</Label>
                <Input
                  type="number"
                  placeholder="0.00"
                  value={estimateCost}
                  onChange={e => setEstimateCost(e.target.value)}
                  className="text-lg font-bold"
                />
              </div>
              {estimateCost && parseFloat(estimateCost) > 0 && (
                <div className="bg-primary/5 rounded-lg p-3 space-y-1">
                  <div className="flex justify-between text-sm">
                    <span>{t.purchaseOrders.estimatedTotal}:</span>
                    <span className="font-bold text-lg">{(parseFloat(estimateCost) * estimateDialog.quantity).toLocaleString(locale)} {currency}</span>
                  </div>
                  <p className="text-xs text-muted-foreground text-left">
                    ({numberToArabicWords(parseFloat(estimateCost) * estimateDialog.quantity)})
                  </p>
                </div>
              )}
              <Button
                className="w-full gap-2"
                onClick={() => {
                  if (!estimateCost || parseFloat(estimateCost) <= 0) { toast.error(t.purchaseOrders.estimatedUnitCost); return; }
                  estimateMut.mutate({
                    purchaseOrderId: estimateDialog.purchaseOrderId,
                    items: [{ id: estimateDialog.id, estimatedUnitCost: estimateCost }],
                  });
                }}
                disabled={estimateMut.isPending}
              >
                {estimateMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <DollarSign className="w-4 h-4" />}
                {t.common.save}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!purchaseDialog} onOpenChange={(open) => { if (!open) setPurchaseDialog(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">{t.purchaseOrders.confirmPurchase}</DialogTitle>
          </DialogHeader>
          {purchaseDialog && (
            <div className="space-y-4">
              <div className="bg-muted/50 rounded-lg p-3">
                <p className="font-medium text-sm">{purchaseDialog.itemName}</p>
                <p className="text-xs text-muted-foreground mt-1">{t.purchaseOrders.quantity}: {purchaseDialog.quantity} {purchaseDialog.unit || ""}</p>
                {purchaseDialog.estimatedTotalCost && (
                  <p className="text-xs text-muted-foreground mt-1">{t.purchaseOrders.estimatedTotal}: {parseFloat(purchaseDialog.estimatedTotalCost).toLocaleString(locale)} {currency}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label>{t.purchaseOrders.accountingNotes} *</Label>
                {invoiceUrl ? (
                  <div className="relative">
                    <img src={invoiceUrl} alt="" className="w-full h-32 object-cover rounded-lg border" />
                    <Button variant="destructive" size="icon" className="absolute top-1 left-1 h-6 w-6" onClick={() => setInvoiceUrl("")}>
                      <span className="text-xs">×</span>
                    </Button>
                  </div>
                ) : (
                  <Button variant="outline" className="w-full h-24 border-dashed gap-2" onClick={() => {
                    const input = document.createElement("input");
                    input.type = "file"; input.accept = "image/*";
                    input.onchange = (e: any) => { if (e.target.files[0]) handleUpload("invoice", e.target.files[0]); };
                    input.click();
                  }} disabled={uploadingField === "invoice"}>
                    {uploadingField === "invoice" ? <Loader2 className="w-5 h-5 animate-spin" /> : <Camera className="w-5 h-5" />}
                    {uploadingField === "invoice" ? t.common.loading : t.common.upload}
                  </Button>
                )}
              </div>

              <div className="space-y-2">
                <Label>{t.tickets.photos} *</Label>
                {purchasedUrl ? (
                  <div className="relative">
                    <img src={purchasedUrl} alt="" className="w-full h-32 object-cover rounded-lg border" />
                    <Button variant="destructive" size="icon" className="absolute top-1 left-1 h-6 w-6" onClick={() => setPurchasedUrl("")}>
                      <span className="text-xs">×</span>
                    </Button>
                  </div>
                ) : (
                  <Button variant="outline" className="w-full h-24 border-dashed gap-2" onClick={() => {
                    const input = document.createElement("input");
                    input.type = "file"; input.accept = "image/*";
                    input.onchange = (e: any) => { if (e.target.files[0]) handleUpload("purchased", e.target.files[0]); };
                    input.click();
                  }} disabled={uploadingField === "purchased"}>
                    {uploadingField === "purchased" ? <Loader2 className="w-5 h-5 animate-spin" /> : <Camera className="w-5 h-5" />}
                    {uploadingField === "purchased" ? t.common.loading : t.common.upload}
                  </Button>
                )}
              </div>

              <Button
                className="w-full gap-2"
                onClick={() => {
                  if (!invoiceUrl) { toast.error(t.common.upload); return; }
                  if (!purchasedUrl) { toast.error(t.common.upload); return; }
                  confirmPurchaseMut.mutate({
                    itemId: purchaseDialog.id,
                    invoicePhotoUrl: invoiceUrl,
                    purchasedPhotoUrl: purchasedUrl,
                  });
                }}
                disabled={confirmPurchaseMut.isPending}
              >
                {confirmPurchaseMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                {t.purchaseOrders.confirmPurchase}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
