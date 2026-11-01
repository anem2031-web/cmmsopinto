import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { InventoryItemCard } from "./InventoryItemCard";

export type BookLotSelection = { lot: any; page: any; master: any };
export function InventoryBookPages({
  catalogItemId,
  warehouseId,
  onPick,
  supplierReturn = false,
}: {
  catalogItemId: number;
  warehouseId?: number;
  onPick?: (selection: BookLotSelection) => void;
  supplierReturn?: boolean;
}) {
  const [afterId, setAfterId] = useState(0);
  const [historyId, setHistoryId] = useState<number | null>(null);
  const result = trpc.inventory.bookPages.useQuery({
    catalogItemId,
    warehouseId,
    afterId,
  });
  if (result.isLoading) return <Loader2 className="h-4 w-4 animate-spin" />;
  if (result.error) return <p role="alert">{result.error.message}</p>;
  return (
    <div className="space-y-3 p-3 border rounded-md bg-muted/20">
      {(result.data?.pages || []).map((page: any) => (
        <div
          key={page.id}
          className="rounded-md border bg-background p-3 space-y-2"
        >
          <div className="flex flex-wrap justify-between gap-2">
            <strong>
              {page.itemName} — #{page.id}
            </strong>
            <span>
              المستودع #{page.warehouseId} ·{" "}
              {Number(page.isFrozen) ? "سجل مجمّد — تاريخي" : "سجل تشغيلي"}
            </span>
          </div>
          <p className="text-sm">
            الرصيد: {Number(page.quantity)} {page.unit}
          </p>
          {(page.movementUnits?.length
            ? page.movementUnits
            : [{ ...page.movements, unit: page.unit }]
          ).map((total: any) => (
            <p key={total.unit} className="text-sm">
              الوارد: {Number(total.incoming)} · المنصرف:{" "}
              {Number(total.outgoing)} {total.unit}
            </p>
          ))}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setHistoryId(page.id)}
          >
            الحركات والمستندات التفصيلية
          </Button>
          {(page.lots || []).map((lot: any) => (
            <div
              key={`${page.id}:${lot.lotId}`}
              className="flex flex-wrap gap-3 items-center rounded border p-2 text-sm"
            >
              <div className="flex-1 min-w-40">
                <strong>{lot.lotCode}</strong> ·{" "}
                {lot.supplierItemName || page.itemName}
                <p>
                  المورد: {lot.supplierName || "غير مسجل"} · تاريخ الشراء:{" "}
                  {lot.invoiceDate
                    ? new Date(lot.invoiceDate).toLocaleDateString("ar-SA")
                    : "غير مسجل"}
                </p>
                <p>
                  الوارد الأصلي: {Number(lot.originalQuantity)} · المتبقي هنا:{" "}
                  {Number(lot.balanceQuantity)} {lot.issueUnit || page.unit} ·
                  الاستلام: {lot.receiptNumber || "—"}
                </p>
              </div>
              {onPick && (
                <Button
                  size="sm"
                  disabled={
                    !!Number(page.isFrozen) ||
                    !String(lot.issueUnit || page.unit || "").trim() ||
                    Number(lot.balanceQuantity) <= 0 ||
                    (supplierReturn &&
                      (lot.sourceType !== "receipt" || !lot.receiptItemId))
                  }
                  onClick={() =>
                    onPick({ lot, page, master: result.data?.master })
                  }
                >
                  اختيار اللوت
                </Button>
              )}
            </div>
          ))}
          {!page.lots.length && (
            <p className="text-muted-foreground text-sm">
              لا توجد لوتات مرتبطة بهذا السجل.
            </p>
          )}
        </div>
      ))}
      {!result.data?.pages.length && (
        <p>لا توجد سجلات مخزون مرتبطة ضمن النطاق المختار.</p>
      )}
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={!afterId}
          onClick={() => setAfterId(0)}
        >
          البداية
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!result.data?.nextId}
          onClick={() => setAfterId(result.data!.nextId!)}
        >
          السجلات التالية
        </Button>
      </div>
      {historyId != null && (
        <InventoryItemCard
          itemId={historyId}
          open
          onOpenChange={open => {
            if (!open) setHistoryId(null);
          }}
        />
      )}
    </div>
  );
}
export function InventoryBooks({
  warehouseId,
  search: externalSearch,
  includeZero = false,
  onPick,
  onFifo,
  supplierReturn = false,
  nodeIds,
  sort,
  dateFrom,
  dateTo,
}: {
  nodeIds?: number[];
  sort?: "name" | "recent" | "quantity";
  dateFrom?: string;
  dateTo?: string;
  warehouseId?: number;
  search?: string;
  includeZero?: boolean;
  supplierReturn?: boolean;
  onPick?: (selection: BookLotSelection) => void;
  onFifo?: (book: any, unit: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [cursor, setCursor] = useState({ key: "", id: 0 });
  const [expanded, setExpanded] = useState<number | null>(null);
  const query = externalSearch ?? search;
  const key = JSON.stringify([
    warehouseId,
    query,
    includeZero,
    nodeIds,
    sort,
    dateFrom,
    dateTo,
  ]);
  const afterId = cursor.key === key ? cursor.id : 0;
  const result = trpc.inventory.books.useQuery({
    warehouseId,
    search: query,
    afterId,
    includeZero,
    nodeIds,
    sort,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
  });
  return (
    <section className="space-y-3" aria-label="دفاتر أصناف الكتالوج">
      {externalSearch == null && (
        <Input
          placeholder="ابحث باسم الكتالوج أو بأي اسم مرتبط بالدفتر…"
          value={search}
          onChange={event => setSearch(event.target.value)}
        />
      )}
      {result.isLoading && <Loader2 className="h-5 w-5 animate-spin" />}
      {result.error && <p role="alert">{result.error.message}</p>}
      {(result.data?.books || []).map((book: any) => (
        <div key={book.id} className="border rounded-lg bg-background">
          <div className="p-3 flex flex-wrap items-center gap-3">
            <Button
              size="sm"
              variant="ghost"
              aria-label={`تفاصيل دفتر ${book.nameAr}`}
              aria-expanded={expanded === book.id}
              onClick={() => setExpanded(expanded === book.id ? null : book.id)}
            >
              {expanded === book.id ? <ChevronDown /> : <ChevronRight />}
            </Button>
            <div className="flex-1">
              <strong>{book.nameAr || book.nameEn}</strong>{" "}
              <span className="font-mono text-xs">{book.code}</span>
              <p className="text-xs text-muted-foreground">
                {book.pageCount} سجل مرتبط
              </p>
            </div>
            <div className="text-sm space-y-1">
              {book.totals.map((total: any) => (
                <div key={`${total.unit}:${total.isFrozen}`}>
                  {Number(total.isFrozen) ? "تاريخ مجمّد" : "الرصيد"}:{" "}
                  {Number(total.quantity)} {total.unit || "وحدة غير محددة"}
                  <span className="text-muted-foreground">
                    {" "}
                    · وارد {Number(total.incoming)} · منصرف{" "}
                    {Number(total.outgoing)}
                  </span>
                  {onFifo &&
                    !Number(total.isFrozen) &&
                    Number(total.quantity) > 0 && (
                      <Button
                        className="ms-2"
                        size="sm"
                        variant="outline"
                        disabled={!String(total.unit || "").trim()}
                        onClick={() => onFifo(book, String(total.unit || ""))}
                      >
                        اختيار الصنف — الأقدم تلقائيًا
                      </Button>
                    )}
                </div>
              ))}
            </div>
          </div>
          {expanded === book.id && (
            <InventoryBookPages
              key={`${book.id}:${warehouseId}`}
              catalogItemId={book.id}
              warehouseId={warehouseId}
              onPick={onPick}
              supplierReturn={supplierReturn}
            />
          )}
        </div>
      ))}
      {!result.isLoading && !result.error && !result.data?.books.length && (
        <p className="text-sm text-muted-foreground">
          لا توجد دفاتر مطابقة في المستودع المختار.
        </p>
      )}
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={!afterId}
          onClick={() => setCursor({ key, id: 0 })}
        >
          البداية
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!result.data?.nextId}
          onClick={() => setCursor({ key, id: result.data!.nextId! })}
        >
          الدفاتر التالية
        </Button>
      </div>
    </section>
  );
}

/** Load bounded pages for an explicit selection, never silently truncate FIFO. */
export async function loadBookLots(
  readPage: (input: any) => Promise<any>,
  catalogItemId: number,
  warehouseId: number
) {
  const lots: any[] = [];
  let afterId = 0;
  for (let pageNumber = 0; pageNumber < 20; pageNumber++) {
    const result = await readPage({
      catalogItemId,
      warehouseId,
      afterId,
      limit: 50,
    });
    for (const page of result.pages)
      for (const lot of page.lots)
        lots.push({
          ...lot,
          isFrozen: page.isFrozen,
          inventoryUnit: page.unit,
        });
    if (!result.nextId) return lots;
    afterId = result.nextId;
  }
  throw Error("الدفتر يحتوي سجلات كثيرة؛ اختر اللوت المطلوب من تفاصيل الدفتر");
}
