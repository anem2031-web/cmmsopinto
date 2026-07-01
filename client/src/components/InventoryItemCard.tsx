import { trpc } from "@/lib/trpc";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Package, CalendarDays, Truck, Tag, Info, ListOrdered, ScrollText } from "lucide-react";

// ── خريطة عرض نوع الحركة (enum ثابت يستوعب التحويل والاستبعاد مستقبلاً) ──
const TX_TYPE_LABEL: Record<string, { label: string; color: string }> = {
  purchase:   { label: "توريد",    color: "bg-emerald-100 text-emerald-800 border-emerald-200" },
  delivery:   { label: "صرف",      color: "bg-blue-100 text-blue-800 border-blue-200" },
  return:     { label: "مرتجع",    color: "bg-amber-100 text-amber-800 border-amber-200" },
  adjustment: { label: "تسوية",    color: "bg-gray-100 text-gray-800 border-gray-200" },
  disposal:   { label: "استبعاد",  color: "bg-red-100 text-red-800 border-red-200" },
  // محجوزة للمراحل القادمة دون الحاجة لتعديل بنيوي لاحقاً
  transfer:   { label: "تحويل",    color: "bg-purple-100 text-purple-800 border-purple-200" },
  writeoff:   { label: "شطب",      color: "bg-red-100 text-red-800 border-red-200" },
};

function fmtDate(d: any) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("ar-SA");
}
function fmtMoney(v: any) {
  if (v === null || v === undefined || v === "") return "—";
  return `${parseFloat(v).toLocaleString()} ر.س`;
}

export function InventoryItemCard({ itemId, open, onOpenChange }: {
  itemId: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const enabled = open && !!itemId;

  const { data: summary, isLoading: loadingSummary } = trpc.inventory.getItemSummary.useQuery(
    { id: itemId! }, { enabled }
  );
  const { data: purchaseHistory, isLoading: loadingPurchases } = trpc.inventory.getPurchaseHistory.useQuery(
    { id: itemId! }, { enabled }
  );
  const { data: ledger, isLoading: loadingLedger } = trpc.inventory.getLedger.useQuery(
    { id: itemId! }, { enabled }
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="w-full sm:max-w-2xl overflow-y-auto p-0">
        <SheetHeader className="border-b px-5 py-4">
          <SheetTitle className="flex items-center gap-2 text-lg">
            <Package className="w-5 h-5 text-primary" />
            {loadingSummary ? <Skeleton className="h-5 w-40" /> : (summary?.itemName || "بطاقة الصنف")}
          </SheetTitle>
          {summary?.internalCode && (
            <p className="text-xs font-mono text-muted-foreground">{summary.internalCode}</p>
          )}
        </SheetHeader>

        <div className="p-5 space-y-5">
          {/* ── ملخص سريع (Summary Cards) ── */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
            <Card className="border-blue-200 bg-blue-50/50">
              <CardContent className="p-3 text-center">
                <p className="text-[10px] text-blue-600 mb-1">الرصيد الحالي</p>
                <p className="text-xl font-bold text-blue-800">
                  {loadingSummary ? <Skeleton className="h-6 w-10 mx-auto" /> : (summary?.quantity ?? "—")}
                </p>
                <p className="text-[10px] text-blue-600">{summary?.unit || ""}</p>
              </CardContent>
            </Card>
            <Card className="border-emerald-200 bg-emerald-50/50">
              <CardContent className="p-3 text-center">
                <p className="text-[10px] text-emerald-600 mb-1">آخر توريد</p>
                <p className="text-sm font-bold text-emerald-800">
                  {loadingSummary ? <Skeleton className="h-5 w-16 mx-auto" /> : fmtDate(summary?.invoiceDate)}
                </p>
              </CardContent>
            </Card>
            <Card className="border-amber-200 bg-amber-50/50">
              <CardContent className="p-3 text-center">
                <p className="text-[10px] text-amber-600 mb-1">آخر صرف</p>
                <p className="text-sm font-bold text-amber-800">
                  {loadingSummary ? <Skeleton className="h-5 w-16 mx-auto" /> : fmtDate(summary?.lastIssuedAt)}
                </p>
              </CardContent>
            </Card>
            <Card className="border-purple-200 bg-purple-50/50">
              <CardContent className="p-3 text-center">
                <p className="text-[10px] text-purple-600 mb-1">آخر سعر شراء</p>
                <p className="text-sm font-bold text-purple-800">
                  {loadingSummary ? <Skeleton className="h-5 w-16 mx-auto" /> : fmtMoney(summary?.lastPurchasePrice)}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* ── التبويبات ── */}
          <Tabs defaultValue="info">
            <TabsList className="grid grid-cols-3 w-full">
              <TabsTrigger value="info" className="text-xs gap-1"><Info className="w-3.5 h-3.5" /> معلومات عامة</TabsTrigger>
              <TabsTrigger value="purchases" className="text-xs gap-1"><Truck className="w-3.5 h-3.5" /> سجل التوريد</TabsTrigger>
              <TabsTrigger value="ledger" className="text-xs gap-1"><ScrollText className="w-3.5 h-3.5" /> سجل الحركة</TabsTrigger>
            </TabsList>

            {/* ── Phase 2A: معلومات عامة ── */}
            <TabsContent value="info" className="mt-4 space-y-3">
              {loadingSummary ? (
                <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}</div>
              ) : !summary ? (
                <p className="text-sm text-muted-foreground text-center py-6">تعذر تحميل بيانات الصنف</p>
              ) : (
                <div className="rounded-lg border divide-y">
                  <InfoRow label="اسم الصنف" value={summary.itemName} />
                  <InfoRow label="الوصف" value={summary.description || "—"} />
                  <InfoRow label="الكود الداخلي" value={summary.internalCode || "—"} mono />
                  <InfoRow label="رقم الصنف (باركود المصنع)" value={summary.manufacturerBarcode || "—"} mono />
                  <InfoRow label="الوحدة" value={summary.unit || summary.issueUnit || "—"} />
                  <InfoRow label="الموقع" value={summary.location || "—"} />
                  <InfoRow label="الرصيد الحالي" value={String(summary.quantity ?? 0)} bold />
                  <InfoRow label="الحد الأدنى" value={String(summary.minQuantity ?? 0)} />
                  <InfoRow label="آخر تحديث" value={fmtDate(summary.updatedAt)} />
                </div>
              )}
            </TabsContent>

            {/* ── Phase 2B: سجل التوريد ── */}
            <TabsContent value="purchases" className="mt-4">
              {loadingPurchases ? (
                <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
              ) : !purchaseHistory?.length ? (
                <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">
                  لا توجد عمليات توريد مسجّلة لهذا الصنف
                </CardContent></Card>
              ) : (
                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-muted/50 text-muted-foreground">
                        <th className="text-right font-medium px-2.5 py-2">التاريخ</th>
                        <th className="text-right font-medium px-2.5 py-2">سند الاستلام</th>
                        <th className="text-right font-medium px-2.5 py-2">أمر الشراء</th>
                        <th className="text-right font-medium px-2.5 py-2">المورد</th>
                        <th className="text-right font-medium px-2.5 py-2">الكمية</th>
                        <th className="text-right font-medium px-2.5 py-2">السعر</th>
                      </tr>
                    </thead>
                    <tbody>
                      {purchaseHistory.map((p: any) => (
                        <tr key={p.transactionId} className="border-t">
                          <td className="px-2.5 py-2 text-muted-foreground">{fmtDate(p.invoiceDate || p.createdAt)}</td>
                          <td className="px-2.5 py-2 font-mono">{p.receiptNumber || "—"}</td>
                          <td className="px-2.5 py-2 font-mono">{p.poNumber || "—"}</td>
                          <td className="px-2.5 py-2">{p.vendorName || "—"}</td>
                          <td className="px-2.5 py-2 font-bold">{p.quantity}</td>
                          <td className="px-2.5 py-2">{fmtMoney(p.unitCost)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </TabsContent>

            {/* ── Phase 2C: سجل الحركة — كشف حساب ── */}
            <TabsContent value="ledger" className="mt-4">
              {loadingLedger ? (
                <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
              ) : !ledger?.length ? (
                <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">
                  لا توجد حركات مسجّلة لهذا الصنف
                </CardContent></Card>
              ) : (
                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-muted/50 text-muted-foreground">
                        <th className="text-right font-medium px-2.5 py-2">التاريخ</th>
                        <th className="text-right font-medium px-2.5 py-2">الحركة</th>
                        <th className="text-right font-medium px-2.5 py-2">الوارد</th>
                        <th className="text-right font-medium px-2.5 py-2">الصادر</th>
                        <th className="text-right font-medium px-2.5 py-2">الرصيد بعد الحركة</th>
                        <th className="text-right font-medium px-2.5 py-2">المرجع</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ledger.map((row: any) => {
                        const meta = TX_TYPE_LABEL[row.transactionType] || { label: row.transactionType, color: "bg-gray-100 text-gray-800 border-gray-200" };
                        return (
                          <tr key={row.transactionId} className="border-t">
                            <td className="px-2.5 py-2 text-muted-foreground">{fmtDate(row.createdAt)}</td>
                            <td className="px-2.5 py-2">
                              <Badge className={`text-[10px] ${meta.color}`}>{meta.label}</Badge>
                            </td>
                            <td className="px-2.5 py-2 text-emerald-700 font-medium">{row.inQty > 0 ? `+${row.inQty}` : "—"}</td>
                            <td className="px-2.5 py-2 text-red-700 font-medium">{row.outQty > 0 ? `-${row.outQty}` : "—"}</td>
                            <td className="px-2.5 py-2 font-bold">{row.balanceAfter}</td>
                            <td className="px-2.5 py-2 font-mono">
                              {row.reference ? row.reference : <span className="text-muted-foreground italic">غير متاح بعد</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function InfoRow({ label, value, mono, bold }: { label: string; value: string; mono?: boolean; bold?: boolean }) {
  return (
    <div className="flex items-center justify-between px-3 py-2.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={`${mono ? "font-mono" : ""} ${bold ? "font-bold" : ""}`}>{value}</span>
    </div>
  );
}
