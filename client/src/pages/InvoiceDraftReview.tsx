// ============================================================
// client/src/pages/InvoiceDraftReview.tsx
// شاشة مراجعة مسودة الفاتورة واعتمادها
// ============================================================

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useLocation, useSearch } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  ArrowRight, CheckCircle2, Loader2, AlertTriangle,
  Package, FileText, Sparkles, Edit2, Check, X
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { mediaUrl } from "@/lib/mediaUrl";

export default function InvoiceDraftReview() {
  const [, navigate] = useLocation();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const receiptId = params.get("id") ? parseInt(params.get("id")!) : null;

  const [notes, setNotes] = useState("");
  const [editingItem, setEditingItem] = useState<number | null>(null);
  const [editValues, setEditValues] = useState<any>({});

  // ── Queries ──────────────────────────────────────────────
  const { data: draft, isLoading, refetch } = trpc.invoiceDraft.getDraft.useQuery(
    { receiptId: receiptId! },
    { enabled: !!receiptId }
  );

  // ── Mutations ────────────────────────────────────────────
  const approveMut = trpc.invoiceDraft.approveDraft.useMutation({
    onSuccess: (data) => {
      toast.success(`✅ تم اعتماد الفاتورة ${data.receiptNumber}`, {
        description: `تم إدخال ${data.itemsProcessed} صنف للمخزون`,
      });
      navigate("/inventory");
    },
    onError: (err: any) => toast.error(err.message),
  });

  const updateItemMut = trpc.invoiceDraft.updateDraftItem.useMutation({
    onSuccess: () => {
      setEditingItem(null);
      refetch();
      toast.success("تم تحديث البند");
    },
  });

  if (!receiptId) {
    return <div className="p-8 text-center text-muted-foreground">لم يتم تحديد المسودة</div>;
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!draft) {
    return <div className="p-8 text-center text-muted-foreground">المسودة غير موجودة</div>;
  }

  const d = draft as any;
  const items = d.items || [];
  const isApproved = !d.isDraft;

  const handleApprove = () => {
    approveMut.mutate({ receiptId: receiptId!, notes });
  };

  const startEdit = (item: any) => {
    setEditingItem(item.id);
    setEditValues({
      itemName:         item.itemName,
      receivedQuantity: parseFloat(item.receivedQuantity),
      unitCost:         item.unitCost,
    });
  };

  const saveEdit = (itemId: number) => {
    updateItemMut.mutate({ itemId, ...editValues });
  };

  return (
    <div className="max-w-2xl mx-auto p-4 pb-24 space-y-4" dir="rtl">

      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1 as any)}>
          <ArrowRight className="w-5 h-5" />
        </Button>
        <div className="flex-1">
          <h1 className="text-lg font-bold">مراجعة الفاتورة</h1>
          <p className="text-sm text-muted-foreground">{d.receiptNumber}</p>
        </div>
        {isApproved ? (
          <Badge className="bg-green-100 text-green-700 border-green-300 gap-1">
            <CheckCircle2 className="w-3 h-3" /> معتمدة
          </Badge>
        ) : (
          <Badge variant="outline" className="gap-1 text-amber-700 border-amber-300">
            <FileText className="w-3 h-3" /> مسودة
          </Badge>
        )}
      </div>

      {/* بيانات الفاتورة */}
      <Card>
        <CardContent className="pt-4 space-y-3">
          <div className="flex items-center gap-2 mb-1">
            <Sparkles className="w-4 h-4 text-primary" />
            <span className="font-medium text-sm">بيانات الفاتورة</span>
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm">
            <InfoRow label="المورد"        value={d.vendorName} />
            <InfoRow label="الرقم الضريبي" value={d.vendorTaxNumber} mono />
            <InfoRow label="رقم الفاتورة"  value={d.invoiceNumber} mono />
            <InfoRow label="التاريخ"       value={d.invoiceDate ? new Date(d.invoiceDate).toLocaleDateString("ar-SA") : undefined} />
          </div>

          {/* الإجماليات */}
          <div className="grid grid-cols-3 gap-2 pt-2 border-t">
            <AmountBox label="قبل الضريبة"  value={d.subtotal}   />
            <AmountBox label="الضريبة 15%"  value={d.taxAmount}  />
            <AmountBox label="الإجمالي"     value={d.grandTotal} primary />
          </div>

          {/* الصور */}
          {(d.invoicePhotoUrl || d.goodsPhotoUrl) && (
            <div className="flex gap-2 pt-2 border-t">
              {d.invoicePhotoUrl && (
                <a href={mediaUrl(d.invoicePhotoUrl)} target="_blank" rel="noopener noreferrer"
                   className="flex-1 p-2 text-xs text-center border rounded hover:bg-muted/50">
                  📄 صورة الفاتورة
                </a>
              )}
              {d.goodsPhotoUrl && (
                <a href={mediaUrl(d.goodsPhotoUrl)} target="_blank" rel="noopener noreferrer"
                   className="flex-1 p-2 text-xs text-center border rounded hover:bg-muted/50">
                  📦 صورة البضاعة
                </a>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* الأصناف */}
      <div className="space-y-2">
        <p className="text-sm font-medium text-muted-foreground">
          الأصناف ({items.length})
        </p>

        {items.map((item: any) => (
          <Card key={item.id} className={cn(
            "transition-colors",
            item.manuallyEdited && "border-blue-200"
          )}>
            <CardContent className="pt-3 pb-3">
              {editingItem === item.id ? (
                // وضع التعديل
                <div className="space-y-2">
                  <Input
                    value={editValues.itemName}
                    onChange={e => setEditValues((p: any) => ({ ...p, itemName: e.target.value }))}
                    placeholder="اسم الصنف"
                    className="text-sm"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">الكمية</p>
                      <Input
                        type="number" min={0} step={0.5}
                        value={editValues.receivedQuantity}
                        onChange={e => setEditValues((p: any) => ({ ...p, receivedQuantity: parseFloat(e.target.value) }))}
                        className="text-sm font-mono"
                      />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">سعر الوحدة</p>
                      <Input
                        type="number" min={0} step={0.01} dir="ltr"
                        value={editValues.unitCost}
                        onChange={e => setEditValues((p: any) => ({ ...p, unitCost: e.target.value }))}
                        className="text-sm font-mono"
                      />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" className="flex-1 gap-1" onClick={() => saveEdit(item.id)}
                            disabled={updateItemMut.isPending}>
                      <Check className="w-3 h-3" /> حفظ
                    </Button>
                    <Button size="sm" variant="outline" className="flex-1" onClick={() => setEditingItem(null)}>
                      <X className="w-3 h-3 ml-1" /> إلغاء
                    </Button>
                  </div>
                </div>
              ) : (
                // وضع العرض
                <div className="flex items-center gap-3">
                  <Package className="w-4 h-4 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{item.itemName}</p>
                    <p className="text-xs text-muted-foreground font-mono">
                      {parseFloat(item.receivedQuantity)} {item.purchaseUnit}
                      {" · "}
                      {parseFloat(item.unitCost).toFixed(2)} ر.س
                      {" = "}
                      <span className="font-bold text-foreground">
                        {parseFloat(item.lineTotal).toFixed(2)} ر.س
                      </span>
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    {item.ocrExtracted && (
                      <Badge className="text-xs bg-purple-50 text-purple-700 border-purple-200">OCR</Badge>
                    )}
                    {item.manuallyEdited && (
                      <Badge className="text-xs bg-blue-50 text-blue-700 border-blue-200">معدّل</Badge>
                    )}
                    {!isApproved && (
                      <Button size="icon" variant="ghost" className="w-7 h-7"
                              onClick={() => startEdit(item)}>
                        <Edit2 className="w-3 h-3" />
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* زر الاعتماد */}
      {!isApproved && (
        <div className="space-y-3 pt-2">
          <Textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="ملاحظات على الاستلام (اختياري)..."
            rows={2}
          />
          <Button
            className="w-full h-12 gap-2 text-base"
            onClick={handleApprove}
            disabled={approveMut.isPending}
          >
            {approveMut.isPending
              ? <><Loader2 className="w-4 h-4 animate-spin" /> جاري الاعتماد...</>
              : <><CheckCircle2 className="w-5 h-5" /> اعتماد الفاتورة وإدخال المخزون</>
            }
          </Button>
          <p className="text-xs text-center text-muted-foreground">
            بعد الاعتماد سيتم إدخال الأصناف للمخزون تلقائياً
          </p>
        </div>
      )}

      {/* حالة معتمدة */}
      {isApproved && (
        <div className="flex items-center gap-3 p-4 bg-green-50 border border-green-200 rounded-lg">
          <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0" />
          <div>
            <p className="font-medium text-green-800 text-sm">تم اعتماد الفاتورة</p>
            <p className="text-xs text-green-700">تم إدخال جميع الأصناف للمخزون</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────

function InfoRow({ label, value, mono }: { label: string; value?: string; mono?: boolean }) {
  if (!value) return null;
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("font-medium text-sm", mono && "font-mono")}>{value}</p>
    </div>
  );
}

function AmountBox({ label, value, primary }: { label: string; value?: any; primary?: boolean }) {
  return (
    <div className={cn(
      "text-center p-2 rounded",
      primary ? "bg-primary/10 border border-primary/20" : "bg-muted/30"
    )}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("font-mono font-bold text-sm", primary && "text-primary")}>
        {value ? parseFloat(value).toFixed(2) : "—"}
      </p>
    </div>
  );
}
