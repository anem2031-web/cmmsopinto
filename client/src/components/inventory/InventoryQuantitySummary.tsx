import { useState } from "react";
import { ArrowDownUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function InventoryQuantitySummary({
  totals,
}: {
  totals: { unit: string; quantity: number }[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Card className="border-emerald-200 bg-emerald-50/50 py-0">
        <CardContent className="p-3 text-center">
          <ArrowDownUp className="w-5 h-5 mx-auto text-emerald-600 mb-1" />
          <p className="text-2xl font-bold text-emerald-800">
            {totals.length === 1
              ? `${totals[0].quantity.toLocaleString()} ${totals[0].unit}`
              : totals.length
                ? totals.length === 2
                  ? "وحدتا قياس"
                  : `${totals.length} ${totals.length > 10 ? "وحدة قياس" : "وحدات قياس"}`
                : "0"}
          </p>
          <p className="text-[10px] text-emerald-600">
            إجمالي الكميات بالمخزن المختار
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-2 h-7 text-xs"
            disabled={!totals.length}
            onClick={() => setOpen(true)}
          >
            تفاصيل الكميات
          </Button>
        </CardContent>
      </Card>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle>إجمالي الكميات حسب الوحدة</DialogTitle>
            <DialogDescription>
              تُعرض كل وحدة على حدة دون جمع الوحدات المختلفة.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted">
                <tr>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    الوحدة
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    الكمية
                  </th>
                </tr>
              </thead>
              <tbody>
                {totals.map(total => (
                  <tr key={total.unit} className="border-t">
                    <td className="px-3 py-2">{total.unit}</td>
                    <td className="px-3 py-2 tabular-nums">
                      <span dir="ltr">{total.quantity.toLocaleString()}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              إغلاق
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
