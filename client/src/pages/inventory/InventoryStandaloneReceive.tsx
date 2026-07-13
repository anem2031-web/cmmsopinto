import { useState, useEffect, useRef } from "react";
import QRCode from "qrcode";
import { trpc } from "@/lib/trpc";
import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  ArrowRight, Package, CheckCircle2, Loader2, AlertTriangle,
  Camera, Upload, ScanLine, Link2, X, ChevronDown, ChevronUp,
  Sparkles, FileText, RefreshCw, Eye, Copy
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { mediaUrl } from "@/lib/mediaUrl";
import DropZone, { UploadedFile } from "@/components/common/DropZone";

// ── Types ────────────────────────────────────────────────────
type ItemType = "spare_part" | "consumable" | "tool" | "food";

interface ReceiveItem {
  purchaseOrderItemId:  number;
  itemName:             string;
  itemName_ar?:         string;
  itemName_en?:         string;
  itemType:             ItemType;
  requestedQuantity:    number;
  receivedQuantity:     number;
  purchaseUnit:         string;
  issueUnit?:           string;
  conversionFactor:     number;
  unitCost:             string;
  expectedUnitCost?:    string;
  taxRate:              number;
  taxAmount:            string;
  lineTotal:            string;
  manufacturerBarcode?: string;
  expiryDate?:          string;
  inventoryId?:         number;
  internalCode?:        string;
  ocrExtracted:         boolean;
  manuallyEdited:       boolean;
  // UI state
  expanded:             boolean;
  hasDiff:              boolean;
  similarItems?:        any[];
  showSimilar:          boolean;
}

interface InvoiceData {
  vendorName?:      string;
  vendorNameEn?:    string;
  vendorTaxNumber?: string;
  invoiceNumber?:   string;
  invoiceDate?:     string;
  subtotal?:        number;
  taxAmount?:       number;
  grandTotal?:      number;
}

type Step = "upload" | "review" | "items" | "confirm";

const ITEM_TYPE_LABELS: Record<ItemType, string> = {
  spare_part:  "قطعة غيار",
  consumable:  "مادة استهلاكية",
  tool:        "أداة / عدة",
  food:        "مادة غذائية",
};

const ITEM_TYPE_COLORS: Record<ItemType, string> = {
  spare_part:  "bg-blue-50 text-blue-700 border-blue-200",
  consumable:  "bg-gray-50 text-gray-700 border-gray-200",
  tool:        "bg-amber-50 text-amber-700 border-amber-200",
  food:        "bg-green-50 text-green-700 border-green-200",
};

// ─────────────────────────────────────────────────────────────
export default function InventoryStandaloneReceive() {
  const [, navigate] = useLocation();

  // ── State ──────────────────────────────────────────────────
  const [step, setStep] = useState<Step>("upload");
  const [invoiceFile, setInvoiceFile]   = useState<UploadedFile | null>(null);
  const [goodsFile, setGoodsFile]       = useState<UploadedFile | null>(null);
  const [ocrJobId, setOcrJobId]         = useState<number | null>(null);
  const [invoiceData, setInvoiceData]   = useState<InvoiceData>({});
  const [items, setItems]               = useState<ReceiveItem[]>([]);
  const [notes, setNotes]               = useState("");
  const [isDuplicate, setIsDuplicate]   = useState(false);
  const [ocrConfidence, setOcrConfidence] = useState<number | null>(null);

  // ── Mutations ──────────────────────────────────────────────
  const ocrMut = trpc.warehouseReceiptsV2.analyzeInvoice.useMutation({
    onSuccess: (data: any) => {
      setOcrJobId(data.ocrJobId);
      setIsDuplicate(data.isDuplicate);
      setOcrConfidence(data.confidence);

      // ملء بيانات الفاتورة
      const inv = data.invoiceData;
      setInvoiceData({
        vendorName:      inv.vendorName,
        vendorNameEn:    inv.vendorNameEn,
        vendorTaxNumber: inv.vendorTaxNumber,
        invoiceNumber:   inv.invoiceNumber,
        invoiceDate:     inv.invoiceDate,
        subtotal:        inv.subtotal,
        taxAmount:       inv.taxAmount,
        grandTotal:      inv.grandTotal,
      });

      // بناء قائمة الأصناف من الفاتورة الحقيقية نفسها — نفس العدد ونفس
      // المسميات كما استخرجها OCR. لا يوجد طلب شراء هنا أصلاً، فلا حاجة
      // لأي ربط ببند طلب — كل الأصناف تُستلم للمخزون مباشرة.
      (async () => {
        if (inv.items?.length > 0) {
          let barcodes: string[] = [];
          try {
            const res = await generateBarcodesMut.mutateAsync({ count: inv.items.length });
            barcodes = res.barcodes;
          } catch {
            const year = new Date().getFullYear();
            barcodes = inv.items.map((_: any, i: number) => `${year}${i + 1}`);
          }

          const newItems: ReceiveItem[] = inv.items.map((ocrItem: any, idx: number) => {
            const receivedQty = ocrItem.quantity || 1;
            const unitCost    = ocrItem.unitPrice?.toString() || "0";
            const taxAmt      = (ocrItem.taxAmount || 0).toFixed(2);
            const lineTotal   = ocrItem.lineTotal?.toFixed(2) || (receivedQty * parseFloat(unitCost) * 1.15).toFixed(2);

            return {
              // اسم الصنف كما في الفاتورة الفعلية — هذا هو المصدر الذي سيُدخَل للمخزون
              itemName:            ocrItem.itemName || "صنف غير محدد",
              itemName_en:         ocrItem.itemNameEn,
              itemType:            "consumable" as const,
              purchaseOrderItemId: 0, // لا يوجد طلب شراء أصلاً في هذا المسار
              requestedQuantity:   receivedQty,
              receivedQuantity:    receivedQty,
              purchaseUnit:        ocrItem.unit || "قطعة",
              conversionFactor:    1,
              unitCost,
              taxRate:             ocrItem.taxRate || 15,
              taxAmount:           taxAmt,
              lineTotal,
              manufacturerBarcode: barcodes[idx],
              ocrExtracted:        true,
              manuallyEdited:      false,
              expanded:            true,
              hasDiff:             false,
              similarItems:        ocrItem.matchedItems || [],
              showSimilar:         ocrItem.existsInSystem,
            } as ReceiveItem;
          });

          setItems(newItems);
        } else {
          toast.error("لم يتمكن التحليل من استخراج أي أصناف من الفاتورة", {
            description: "تحقق من وضوح الصورة أو أدخل الأصناف يدوياً",
          });
        }
        toast.success("تم تحليل الفاتورة بنجاح", {
          description: `دقة التحليل: ${Math.round((data.confidence || 0) * 100)}%`,
        });
        setStep("review");
      })();
    },
    onError: (err: any) => {
      toast.error("فشل في تحليل الفاتورة", { description: err.message });
    },
  });

  const [printItems, setPrintItems] = useState<any[]>([]);
  const [showPrint, setShowPrint] = useState(false);

  const receiveMut = trpc.warehouseReceiptsV2.receiveStandaloneV2.useMutation({
    onSuccess: (data: any) => {
      toast.success(`تم الاستلام — فاتورة ${data.receiptNumber}`, {
        description: data.hasDiscrepancy ? "⚠️ تم تسجيل الفروقات" : "تم تحديث المخزون",
      });
      // عرض شاشة طباعة الباركود
      if (data.inventoryItems && data.inventoryItems.length > 0) {
        setPrintItems(data.inventoryItems);
        setShowPrint(true);
      } else {
        navigate("/inventory");
      }
    },
    onError: (err: any) => toast.error(err.message),
  });

  // ── توليد باركود تلقائي ─────────────────────────────────────
  const generateBarcodesMut = trpc.warehouseReceiptsV2.generateItemBarcodes.useMutation();

  const generateBarcodeForItem = async (index: number) => {
    const result = await generateBarcodeMut.mutateAsync();
    updateItem(index, { manufacturerBarcode: result.barcode });
  };

  // ── Helpers ────────────────────────────────────────────────
  const updateItem = (index: number, patch: Partial<ReceiveItem>) => {
    setItems(prev => prev.map((item, idx) => {
      if (idx !== index) return item;
      const updated = { ...item, ...patch, manuallyEdited: true };
      // إعادة حساب الإجمالي
      const qty   = updated.receivedQuantity;
      const cost  = parseFloat(updated.unitCost) || 0;
      const tax   = cost * qty * (updated.taxRate / 100);
      updated.taxAmount = tax.toFixed(2);
      updated.lineTotal = (cost * qty + tax).toFixed(2);
      return updated;
    }));
  };

  const linkToInventory = (itemIndex: number, inventoryItem: any) => {
    setItems(prev => prev.map((item, idx) =>
      idx === itemIndex ? {
        ...item,
        inventoryId:  inventoryItem.id,
        internalCode: inventoryItem.internalCode,
        showSimilar:  false,
      } : item
    ));
    toast.success(`تم الربط بـ "${inventoryItem.itemName}"`);
  };

  const hasDiscrepancy = items.some(i => i.hasDiff);

  const handleOcr = () => {
    if (!invoiceFile?.url) return;
    ocrMut.mutate({
      imageUrl: invoiceFile.url,
      // بلا purchaseOrderId — استلام مستقل
    });
  };

  const handleSkipOcr = () => {
    // بدون OCR، وبدون طلب شراء، لا يوجد مصدر تلقائي للأصناف — يبدأ المستخدم
    // بصنف فارغ واحد يضيف عليه يدوياً (زر "إضافة صنف" بشاشة المراجعة)
    if (items.length === 0) {
      setItems([{
        purchaseOrderItemId: 0,
        itemName:            "صنف جديد",
        itemType:            "consumable" as const,
        requestedQuantity:   1,
        receivedQuantity:    1,
        purchaseUnit:        "قطعة",
        conversionFactor:    1,
        unitCost:            "0",
        taxRate:             15,
        taxAmount:           "0",
        lineTotal:           "0",
        ocrExtracted:        false,
        manuallyEdited:      true,
        expanded:            true,
        hasDiff:             false,
        showSimilar:         false,
      }]);
    }
    setStep("review");
  };

  const handleSubmit = () => {
    const invalid = items.find(i => !i.unitCost || i.receivedQuantity < 1);
    if (invalid) {
      toast.error(`أكمل بيانات: ${invalid.itemName}`);
      return;
    }

    // إلزامي: توثيق سبب الاستلام المستقل (بدون طلب شراء) قبل الإضافة للمخزون
    if (!notes.trim() || notes.trim().length < 10) {
      toast.error(
        "يرجى كتابة سبب الاستلام المستقل (10 أحرف على الأقل) — مثال: \"بضاعة وصلت مباشرة من المورد بدون طلب شراء مسبق\""
      );
      return;
    }

    receiveMut.mutate({
      vendorName:       invoiceData.vendorName,
      vendorNameEn:     invoiceData.vendorNameEn,
      vendorTaxNumber:  invoiceData.vendorTaxNumber,
      invoiceNumber:    invoiceData.invoiceNumber,
      invoiceDate:      invoiceData.invoiceDate,
      subtotal:         invoiceData.subtotal,
      taxAmount:        invoiceData.taxAmount,
      grandTotal:       invoiceData.grandTotal,
      invoicePhotoUrl:  invoiceFile?.url,
      goodsPhotoUrl:    goodsFile?.url,
      ocrJobId:         ocrJobId || undefined,
      hasDiscrepancy,
      discrepancyNotes: hasDiscrepancy ? items.filter(i => i.hasDiff).map(i => i.itemName).join("، ") : undefined,
      notes,
      items: items.map(i => ({
        inventoryId:         i.inventoryId,
        itemName:            i.itemName,
        itemName_ar:         i.itemName_ar,
        itemName_en:         i.itemName_en,
        itemType:            i.itemType,
        receivedQuantity:    i.receivedQuantity,
        purchaseUnit:        i.purchaseUnit,
        issueUnit:           i.issueUnit,
        conversionFactor:    i.conversionFactor,
        unitCost:            i.unitCost,
        taxRate:             i.taxRate,
        taxAmount:           i.taxAmount,
        lineTotal:           i.lineTotal,
        manufacturerBarcode: i.manufacturerBarcode,
        expiryDate:          i.expiryDate,
        warehouseId:         1,
        ocrExtracted:        i.ocrExtracted,
        manuallyEdited:      i.manuallyEdited,
      })),
    });
  };

  // ─────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────
  // ── شاشة طباعة الباركود ────────────────────────────────────
  if (showPrint) {
    return (
      <BarcodesPrintScreen
        items={printItems}
        onDone={() => navigate("/inventory")}
      />
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-4 pb-24 space-y-4" dir="rtl">

      {/* ── Header ── */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate("/inventory")}>
          <ArrowRight className="w-5 h-5" />
        </Button>
        <div className="flex-1">
          <h1 className="text-lg font-bold">استلام فاتورة مستقلة</h1>
          {items.length > 0 && (
            <p className="text-sm text-muted-foreground">
              بلا طلب شراء · {items.length} صنف
            </p>
          )}
        </div>
        {isDuplicate && (
          <Badge variant="destructive" className="gap-1">
            <AlertTriangle className="w-3 h-3" />
            فاتورة مكررة
          </Badge>
        )}
      </div>

      {/* ── Steps indicator ── */}
      <StepIndicator current={step} />

      {/* ══════════════════════════════════════════════════ */}
      {/* STEP 1: رفع الصور */}
      {/* ══════════════════════════════════════════════════ */}
      {step === "upload" && (
        <div className="space-y-4">

          {/* صورة الفاتورة */}
          <Card>
            <CardContent className="pt-4 space-y-3">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-primary" />
                <span className="font-medium text-sm">صورة الفاتورة</span>
                <Badge variant="outline" className="text-xs">مطلوب للتحليل الذكي</Badge>
              </div>
              {invoiceFile ? (
                <div className="relative">
                  <img
                    src={mediaUrl(invoiceFile.url)}
                    alt="الفاتورة"
                    className="w-full max-h-48 object-contain rounded-lg border"
                  />
                  <Button
                    size="icon" variant="destructive"
                    className="absolute top-2 left-2 w-6 h-6"
                    onClick={() => setInvoiceFile(null)}
                  >
                    <X className="w-3 h-3" />
                  </Button>
                  {ocrConfidence !== null && (
                    <div className="absolute bottom-2 right-2 bg-black/70 text-white text-xs px-2 py-1 rounded">
                      <Sparkles className="w-3 h-3 inline ml-1" />
                      دقة OCR: {Math.round(ocrConfidence * 100)}%
                    </div>
                  )}
                </div>
              ) : (
                <DropZone
                  accept="image/*,application/pdf"
                  maxFiles={1}
                  label="ارفع صورة الفاتورة أو PDF"
                  sublabel="اختر طريقة إضافة صورة الفاتورة"
                  enableCamera
                  onFilesUploaded={(files) => files[0]?.status === "done" && setInvoiceFile(files[0])}
                />
              )}
            </CardContent>
          </Card>

          {/* صورة البضاعة */}
          <Card>
            <CardContent className="pt-4 space-y-3">
              <div className="flex items-center gap-2">
                <Package className="w-4 h-4 text-primary" />
                <span className="font-medium text-sm">صورة البضاعة المستلمة</span>
                <Badge variant="outline" className="text-xs">مطلوب</Badge>
              </div>
              {goodsFile ? (
                <div className="relative">
                  <img
                    src={mediaUrl(goodsFile.url)}
                    alt="البضاعة"
                    className="w-full max-h-48 object-contain rounded-lg border"
                  />
                  <Button
                    size="icon" variant="destructive"
                    className="absolute top-2 left-2 w-6 h-6"
                    onClick={() => setGoodsFile(null)}
                  >
                    <X className="w-3 h-3" />
                  </Button>
                </div>
              ) : (
                <DropZone
                  accept="image/*"
                  maxFiles={1}
                  label="ارفع صورة البضاعة"
                  sublabel="اختر طريقة إضافة صورة البضاعة"
                  enableCamera
                  onFilesUploaded={(files) => files[0]?.status === "done" && setGoodsFile(files[0])}
                />
              )}
            </CardContent>
          </Card>

          {/* أزرار الانتقال */}
          <div className="space-y-2">
            {invoiceFile && (
              <Button
                className="w-full h-12 gap-2"
                onClick={handleOcr}
                disabled={ocrMut.isPending}
              >
                {ocrMut.isPending
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> جاري تحليل الفاتورة...</>
                  : <><Sparkles className="w-4 h-4" /> تحليل الفاتورة بالذكاء الاصطناعي</>
                }
              </Button>
            )}
            <Button
              variant="outline"
              className="w-full"
              onClick={handleSkipOcr}
            >
              إدخال يدوي بدون تحليل
            </Button>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════ */}
      {/* STEP 2: مراجعة بيانات الفاتورة */}
      {/* ══════════════════════════════════════════════════ */}
      {step === "review" && (
        <div className="space-y-4">

          {/* تحذير فاتورة مكررة */}
          {isDuplicate && (
            <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-lg">
              <AlertTriangle className="w-5 h-5 text-red-600 mt-0.5 shrink-0" />
              <div>
                <p className="font-medium text-red-800 text-sm">تحذير: فاتورة مكررة</p>
                <p className="text-sm text-red-700">رقم هذه الفاتورة موجود مسبقاً في النظام. تأكد قبل المتابعة.</p>
              </div>
            </div>
          )}

          {/* بيانات الفاتورة */}
          <Card>
            <CardContent className="pt-4 space-y-4">
              <div className="flex items-center justify-between">
                <span className="font-medium text-sm">بيانات الفاتورة</span>
                {ocrConfidence && (
                  <Badge className="gap-1 bg-primary/10 text-primary border-primary/20">
                    <Sparkles className="w-3 h-3" />
                    OCR {Math.round(ocrConfidence * 100)}%
                  </Badge>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field label="اسم المورد">
                  <Input value={invoiceData.vendorName || ""} onChange={e => setInvoiceData(p => ({ ...p, vendorName: e.target.value }))} placeholder="اسم المورد" />
                </Field>
                <Field label="الرقم الضريبي">
                  <Input value={invoiceData.vendorTaxNumber || ""} onChange={e => setInvoiceData(p => ({ ...p, vendorTaxNumber: e.target.value }))} placeholder="3xxxxxxxxxxxxxx" dir="ltr" className="font-mono" />
                </Field>
                <Field label="رقم الفاتورة">
                  <Input value={invoiceData.invoiceNumber || ""} onChange={e => setInvoiceData(p => ({ ...p, invoiceNumber: e.target.value }))} placeholder="INV-001" dir="ltr" />
                </Field>
                <Field label="تاريخ الفاتورة">
                  <Input type="date" value={invoiceData.invoiceDate || ""} onChange={e => setInvoiceData(p => ({ ...p, invoiceDate: e.target.value }))} />
                </Field>
              </div>

              {/* الإجماليات — قابلة للإدخال اليدوي */}
              <div className="grid grid-cols-3 gap-2 pt-2 border-t">
                <div>
                  <p className="text-xs text-muted-foreground text-center mb-1">قبل الضريبة</p>
                  <Input
                    type="number" min={0} step={0.01} dir="ltr"
                    value={invoiceData.subtotal || ""}
                    onChange={e => {
                      const sub = parseFloat(e.target.value) || 0;
                      const tax = Math.round(sub * 0.15 * 100) / 100;
                      setInvoiceData(p => ({ ...p, subtotal: sub, taxAmount: tax, grandTotal: Math.round((sub + tax) * 100) / 100 }));
                    }}
                    placeholder="0.00"
                    className="font-mono text-sm text-center"
                  />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground text-center mb-1">الضريبة 15%</p>
                  <Input
                    type="number" min={0} step={0.01} dir="ltr"
                    value={invoiceData.taxAmount || ""}
                    onChange={e => {
                      const tax = parseFloat(e.target.value) || 0;
                      const sub = invoiceData.subtotal || 0;
                      setInvoiceData(p => ({ ...p, taxAmount: tax, grandTotal: Math.round((sub + tax) * 100) / 100 }));
                    }}
                    placeholder="0.00"
                    className="font-mono text-sm text-center"
                  />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground text-center mb-1">الإجمالي</p>
                  <Input
                    type="number" min={0} step={0.01} dir="ltr"
                    value={invoiceData.grandTotal || ""}
                    onChange={e => setInvoiceData(p => ({ ...p, grandTotal: parseFloat(e.target.value) || 0 }))}
                    placeholder="0.00"
                    className="font-mono text-sm text-center font-bold text-primary"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setStep("upload")}>
              <ArrowRight className="w-4 h-4 ml-1" /> رجوع
            </Button>
            <Button className="flex-1" onClick={() => setStep("items")}>
              التالي: مراجعة الأصناف
            </Button>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════ */}
      {/* STEP 3: الأصناف */}
      {/* ══════════════════════════════════════════════════ */}
      {step === "items" && (
        <div className="space-y-3">
          {/* زر إضافة صنف يدوياً */}
          <div className="flex justify-end">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => setItems(prev => [...prev, {
                purchaseOrderItemId: 0, // غير مربوط بعد — يجب اختيار بند الطلب قبل الحفظ
                itemName:            "صنف جديد",
                itemType:            "consumable" as const,
                requestedQuantity:   1,
                receivedQuantity:    1,
                purchaseUnit:        "قطعة",
                conversionFactor:    1,
                unitCost:            "0",
                taxRate:             15,
                taxAmount:           "0",
                lineTotal:           "0",
                ocrExtracted:        false,
                manuallyEdited:      true,
                expanded:            true,
                hasDiff:             false,
                showSimilar:         false,
              }])}
            >
              <span className="text-lg leading-none">+</span> إضافة صنف
            </Button>
          </div>

          {hasDiscrepancy && (
            <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              يوجد فروقات في الكميات أو الأسعار — ستُسجَّل تلقائياً
            </div>
          )}

          {items.map((item, index) => (
            <ReceiveItemCard
              key={index}
              item={item}
              index={index}
              onUpdate={(patch) => updateItem(index, patch)}
              onLink={(inv) => linkToInventory(index, inv)}
              onDelete={() => setItems(prev => prev.filter((_, i) => i !== index))}
            />
          ))}

          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setStep("review")}>
              <ArrowRight className="w-4 h-4 ml-1" /> رجوع
            </Button>
            <Button className="flex-1" onClick={() => setStep("confirm")}>
              التالي: تأكيد الاستلام
            </Button>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════ */}
      {/* STEP 4: تأكيد */}
      {/* ══════════════════════════════════════════════════ */}
      {step === "confirm" && (
        <div className="space-y-4">
          <Card>
            <CardContent className="pt-4 space-y-3">
              <p className="font-medium text-sm">ملخص الاستلام</p>

              <div className="space-y-2">
                {invoiceData.vendorName && (
                  <SummaryRow label="المورد" value={invoiceData.vendorName} />
                )}
                {invoiceData.invoiceNumber && (
                  <SummaryRow label="رقم الفاتورة" value={invoiceData.invoiceNumber} mono />
                )}
                <SummaryRow label="عدد الأصناف" value={`${items.length} صنف`} />
                {invoiceData.grandTotal && (
                  <SummaryRow label="إجمالي الفاتورة" value={`${invoiceData.grandTotal.toFixed(2)} ر.س`} bold />
                )}
              </div>

              {hasDiscrepancy && (
                <div className="pt-2 border-t">
                  <p className="text-xs text-amber-700 font-medium mb-1">أصناف بها فروقات:</p>
                  {items.filter(i => i.hasDiff).map(i => (
                    <p key={i.purchaseOrderItemId} className="text-xs text-muted-foreground">• {i.itemName}</p>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <div className="space-y-2">
            <Label className="text-sm text-red-600">
              سبب الاستلام المستقل (إلزامي) <span className="text-red-600">*</span>
            </Label>
            <p className="text-xs text-muted-foreground">
              هذا استلام بدون طلب شراء مسبق — وضّح لماذا وصل هذا الصنف مباشرة
              (مثال: بضاعة مصاريف نثرية، مواد وصلت طارئة، تصحيح جرد... إلخ)
            </p>
            <Textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder='مثال: "بضاعة وصلت مباشرة من المورد بدون طلب شراء مسبق"'
              rows={2}
              className={notes.trim().length > 0 && notes.trim().length < 10 ? "border-red-400" : ""}
            />
            {notes.trim().length > 0 && notes.trim().length < 10 && (
              <p className="text-xs text-red-600">10 أحرف على الأقل ({notes.trim().length}/10)</p>
            )}
          </div>

          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setStep("items")}>
              <ArrowRight className="w-4 h-4 ml-1" /> رجوع
            </Button>
            <Button
              className="flex-1 h-12 gap-2"
              onClick={handleSubmit}
              disabled={receiveMut.isPending || notes.trim().length < 10}
            >
              {receiveMut.isPending
                ? <><Loader2 className="w-4 h-4 animate-spin" /> جاري الحفظ...</>
                : <><CheckCircle2 className="w-4 h-4" /> تأكيد الاستلام</>
              }
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────

function StepIndicator({ current }: { current: Step }) {
  const steps: { key: Step; label: string }[] = [
    { key: "upload",  label: "الصور" },
    { key: "review",  label: "الفاتورة" },
    { key: "items",   label: "الأصناف" },
    { key: "confirm", label: "تأكيد" },
  ];
  const idx = steps.findIndex(s => s.key === current);
  return (
    <div className="flex items-center gap-1">
      {steps.map((s, i) => (
        <div key={s.key} className="flex items-center gap-1 flex-1">
          <div className={cn(
            "flex-1 flex flex-col items-center gap-1",
          )}>
            <div className={cn(
              "w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors",
              i < idx  && "bg-primary text-primary-foreground",
              i === idx && "bg-primary text-primary-foreground ring-2 ring-primary/30",
              i > idx  && "bg-muted text-muted-foreground",
            )}>
              {i < idx ? <CheckCircle2 className="w-4 h-4" /> : i + 1}
            </div>
            <span className={cn("text-xs", i === idx ? "text-primary font-medium" : "text-muted-foreground")}>{s.label}</span>
          </div>
          {i < steps.length - 1 && (
            <div className={cn("h-0.5 flex-1 mb-4 transition-colors", i < idx ? "bg-primary" : "bg-border")} />
          )}
        </div>
      ))}
    </div>
  );
}

function ReceiveItemCard({ item, index, onUpdate, onLink, onDelete }: {
  item:     ReceiveItem;
  index:    number;
  onUpdate: (patch: Partial<ReceiveItem>) => void;
  onLink:   (inv: any) => void;
  onDelete?: () => void;
}) {
  const similarQuery = trpc.warehouseReceiptsV2.findSimilarItems.useQuery(
    { itemName: item.itemName },
    { enabled: item.showSimilar && !item.inventoryId }
  );

  return (
    <Card className={cn("transition-colors", item.hasDiff && "border-amber-300")}>
      <CardContent className="pt-4 space-y-3">

        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Package className="w-4 h-4 text-primary shrink-0" />
              <input
                className="font-medium text-sm flex-1 bg-transparent border-b border-transparent hover:border-border focus:border-primary focus:outline-none truncate"
                value={item.itemName}
                onChange={e => onUpdate({ itemName: e.target.value })}
                placeholder="اسم الصنف"
              />
              {item.ocrExtracted && (
                <Badge className="text-xs bg-purple-50 text-purple-700 border-purple-200 gap-1">
                  <Sparkles className="w-2.5 h-2.5" /> OCR
                </Badge>
              )}
              {item.hasDiff && (
                <Badge className="text-xs bg-amber-50 text-amber-700 border-amber-200 gap-1">
                  <AlertTriangle className="w-2.5 h-2.5" /> فرق
                </Badge>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1">
            {onDelete && (
              <Button
                variant="ghost" size="icon"
                className="w-7 h-7 shrink-0 text-destructive hover:text-destructive"
                onClick={onDelete}
              >
                <X className="w-3.5 h-3.5" />
              </Button>
            )}
            <Button
              variant="ghost" size="icon"
              className="w-7 h-7 shrink-0"
              onClick={() => onUpdate({ expanded: !item.expanded })}
            >
              {item.expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </Button>
          </div>
        </div>

        {/* نوع الصنف */}
        <div className="flex gap-1 flex-wrap">
          {(["spare_part", "consumable", "tool", "food"] as ItemType[]).map(t => (
            <button
              key={t}
              onClick={() => onUpdate({ itemType: t })}
              className={cn(
                "text-xs px-2 py-0.5 rounded border transition-colors",
                item.itemType === t ? ITEM_TYPE_COLORS[t] : "border-transparent text-muted-foreground hover:bg-muted"
              )}
            >
              {ITEM_TYPE_LABELS[t]}
            </button>
          ))}
        </div>

        {/* الحقول */}
        {item.expanded && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="الكمية المستلمة">
                <div className="relative">
                  <Input
                    type="number" min={0} step={0.5}
                    value={item.receivedQuantity}
                    onChange={e => onUpdate({ receivedQuantity: parseFloat(e.target.value) || 0 })}
                    className={cn(item.receivedQuantity !== item.requestedQuantity && "border-amber-400")}
                  />
                  {item.receivedQuantity !== item.requestedQuantity && (
                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-amber-600">
                      ≠{item.requestedQuantity}
                    </span>
                  )}
                </div>
              </Field>
              <Field label="وحدة الشراء">
                <Input value={item.purchaseUnit} onChange={e => onUpdate({ purchaseUnit: e.target.value })} placeholder="كرتون / قطعة" />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="سعر الوحدة">
                <div className="relative">
                  <Input
                    type="number" min={0} step={0.01} dir="ltr"
                    value={item.unitCost}
                    onChange={e => onUpdate({ unitCost: e.target.value })}
                    className={cn(
                      "font-mono",
                      item.expectedUnitCost && Math.abs(parseFloat(item.unitCost) - parseFloat(item.expectedUnitCost)) > 0.01 && "border-amber-400"
                    )}
                  />
                  {item.expectedUnitCost && (
                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                      /{parseFloat(item.expectedUnitCost).toFixed(2)}
                    </span>
                  )}
                </div>
              </Field>
              <Field label="الإجمالي شامل الضريبة">
                <Input value={parseFloat(item.lineTotal || "0").toFixed(2)} readOnly dir="ltr" className="font-mono bg-muted/30" />
              </Field>
            </div>

            {/* باركود المصنع */}
            <Field label="باركود المصنع (اختياري)">
              <Input
                value={item.manufacturerBarcode || ""}
                onChange={e => onUpdate({ manufacturerBarcode: e.target.value })}
                placeholder="يُولَّد تلقائياً أو أدخل يدوياً"
                placeholder="امسح أو أدخل الباركود"
                dir="ltr" className="font-mono"
              />
            </Field>

            {/* تاريخ الصلاحية للمواد الغذائية */}
            {item.itemType === "food" && (
              <Field label="تاريخ انتهاء الصلاحية">
                <Input type="date" value={item.expiryDate || ""} onChange={e => onUpdate({ expiryDate: e.target.value })} />
              </Field>
            )}

            {/* ربط بمخزون */}
            {item.inventoryId ? (
              <div className="flex items-center gap-2 p-2 bg-green-50 rounded-lg border border-green-200">
                <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
                <span className="text-sm text-green-700 flex-1">{item.internalCode}</span>
                <Button size="sm" variant="ghost" className="h-6 text-red-500"
                  onClick={() => onUpdate({ inventoryId: undefined, internalCode: undefined })}>
                  <X className="w-3 h-3" />
                </Button>
              </div>
            ) : (
              <div>
                <Button
                  size="sm" variant="outline"
                  className="gap-1 w-full"
                  onClick={() => onUpdate({ showSimilar: !item.showSimilar })}
                >
                  <Link2 className="w-3 h-3" />
                  {item.showSimilar ? "إخفاء الأصناف المشابهة" : "ربط بصنف موجود"}
                </Button>

                {item.showSimilar && (
                  <div className="mt-2 space-y-1">
                    {similarQuery.isLoading && (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground p-2">
                        <Loader2 className="w-3 h-3 animate-spin" /> جاري البحث...
                      </div>
                    )}
                    {similarQuery.data?.map((inv: any) => (
                      <button
                        key={inv.id}
                        onClick={() => onLink(inv)}
                        className="w-full text-right p-2 rounded border hover:bg-muted/50 transition-colors"
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm font-medium">{inv.itemName}</p>
                            <p className="text-xs text-muted-foreground font-mono">{inv.internalCode} · {inv.quantity} {inv.unit}</p>
                          </div>
                          <Link2 className="w-3 h-3 text-muted-foreground" />
                        </div>
                      </button>
                    ))}
                    {similarQuery.data?.length === 0 && (
                      <p className="text-xs text-muted-foreground p-2">لا توجد أصناف مشابهة — سيُنشأ صنف جديد</p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function SummaryRow({ label, value, mono, bold }: {
  label: string; value: string; mono?: boolean; bold?: boolean;
}) {
  return (
    <div className="flex justify-between items-center text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn(mono && "font-mono", bold && "font-bold text-primary")}>{value}</span>
    </div>
  );
}

// ============================================================
// مكوّن شاشة طباعة الباركود
// ============================================================
function QRCodeCanvas({ value, size = 120 }: { value: string; size?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !value) return;
    QRCode.toCanvas(canvas, value, {
      width: size,
      margin: 1,
      color: { dark: "#000000", light: "#ffffff" },
    }).catch(console.error);
  }, [value, size]);

  return <canvas ref={canvasRef} width={size} height={size} />;
}

function BarcodesPrintScreen({ items, onDone }: { items: any[]; onDone: () => void }) {
  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="min-h-screen bg-gray-100 p-4" dir="rtl">
      {/* شريط العنوان */}
      <div className="print-hidden max-w-2xl mx-auto mb-4 flex items-center justify-between">
        <h1 className="text-lg font-bold">طباعة باركودات الأصناف</h1>
        <div className="flex gap-2">
          <button
            onClick={handlePrint}
            className="bg-primary text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary/90"
          >
            🖨️ طباعة الباركودات
          </button>
          <button
            onClick={onDone}
            className="border px-4 py-2 rounded-lg text-sm text-muted-foreground hover:bg-muted"
          >
            تخطي الطباعة
          </button>
        </div>
      </div>

      {/* بطاقات الباركود */}
      <div className="barcode-print-area flex flex-wrap gap-4 justify-center">
        {items.map((item, idx) => (
          <div
            key={idx}
            style={{
              width: "56mm",
              height: "36mm",
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "flex-start",
              padding: "2px",
              gap: "4px",
              background: "#fff",
              border: "1px solid #ccc",
              borderRadius: "4px",
            }}
            className="barcode-card"
          >
            {/* QR Code على اليسار */}
            <div style={{ flexShrink: 0 }}>
              <QRCodeCanvas value={item.manufacturerBarcode || item.internalCode || String(idx)} size={110} />
            </div>
            {/* الرقم + اسم الصنف على اليمين */}
            <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "flex-end", justifyContent: "center", overflow: "hidden", paddingRight: "2px", gap: "3px" }}>
              <span style={{ fontFamily: "monospace", fontWeight: "bold", fontSize: "13px", color: "#000", textAlign: "right", direction: "ltr" }}>
                {item.manufacturerBarcode || item.internalCode}
              </span>
              <span style={{ fontSize: "10px", color: "#222", textAlign: "right", direction: "rtl", lineHeight: "1.3", wordBreak: "break-word", maxWidth: "100%" }}>
                {item.itemName}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* CSS للطباعة */}
      <style>{`
        @media print {
          @page {
            size: 58mm 38mm;
            margin: 0;
          }
          body * { visibility: hidden; }
          .barcode-print-area, .barcode-print-area * { visibility: visible; }
          .barcode-print-area {
            position: absolute;
            top: 0; left: 0;
          }
          .print-hidden { display: none !important; }
          .barcode-card {
            width: 56mm !important;
            height: 36mm !important;
            page-break-after: always;
            page-break-inside: avoid;
            display: flex !important;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 1mm;
          }
          .barcode-card:last-child {
            page-break-after: avoid;
          }
        }
      `}</style>
    </div>
  );
}
