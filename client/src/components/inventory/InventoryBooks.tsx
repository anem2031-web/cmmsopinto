import { Fragment, useState } from "react";
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
  layout = "cards",
}: {
  layout?: "cards" | "table";
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
      {layout === "table" ? (
        <div className="overflow-x-auto rounded-lg border bg-background">
          <table
            className="w-full min-w-[860px] text-sm"
            aria-label="أصناف المستودع حسب دفتر الكتالوج"
            dir="rtl"
          >
            <thead>
              <tr className="bg-muted/50 text-xs text-muted-foreground">
                {[
                  "الصنف",
                  "الكود",
                  "الرصيد",
                  "الوحدة",
                  "الوارد",
                  "المنصرف",
                  "السجلات",
                  ...(onFifo ? ["الصرف"] : []),
                ].map(label => (
                  <th
                    key={label}
                    scope="col"
                    className="px-3 py-2 text-right font-medium whitespace-nowrap"
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(result.data?.books || []).map((book: any) => (
                <Fragment key={book.id}>
                  <tr className="border-t hover:bg-muted/30 transition-colors">
                    <td className="px-3 py-2 align-top">
                      <div className="flex items-center gap-1 min-h-8">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 shrink-0"
                          aria-label={`تفاصيل دفتر ${book.nameAr || book.nameEn}`}
                          aria-expanded={expanded === book.id}
                          aria-controls={`inventory-book-${book.id}-details`}
                          onClick={() =>
                            setExpanded(expanded === book.id ? null : book.id)
                          }
                        >
                          {expanded === book.id ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                        </Button>
                        <span
                          className="font-medium min-w-48 max-w-80"
                          title={book.nameAr || book.nameEn}
                        >
                          {book.nameAr || book.nameEn}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-2 align-top">
                      <span
                        className="inline-flex min-h-8 items-center font-mono text-xs whitespace-nowrap"
                        dir="ltr"
                      >
                        {book.code || "—"}
                      </span>
                    </td>
                    <td className="px-3 py-2 align-top">
                      {book.totals.map((total: any) => (
                        <div
                          key={`${total.unit}:${total.isFrozen}`}
                          className="flex min-h-8 items-center font-bold tabular-nums"
                          dir="ltr"
                        >
                          {Number(total.quantity).toLocaleString()}
                        </div>
                      ))}
                    </td>
                    <td className="px-3 py-2 align-top">
                      {book.totals.map((total: any) => (
                        <div
                          key={`${total.unit}:${total.isFrozen}`}
                          className="flex min-h-8 items-center gap-2 whitespace-nowrap"
                        >
                          {total.unit || "وحدة غير محددة"}
                          {!!Number(total.isFrozen) && (
                            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                              تاريخ مجمّد
                            </span>
                          )}
                        </div>
                      ))}
                    </td>
                    <td className="px-3 py-2 align-top">
                      {book.totals.map((total: any) => (
                        <div
                          key={`${total.unit}:${total.isFrozen}`}
                          className="flex min-h-8 items-center tabular-nums"
                          dir="ltr"
                        >
                          {Number(total.incoming).toLocaleString()}
                        </div>
                      ))}
                    </td>
                    <td className="px-3 py-2 align-top">
                      {book.totals.map((total: any) => (
                        <div
                          key={`${total.unit}:${total.isFrozen}`}
                          className="flex min-h-8 items-center tabular-nums"
                          dir="ltr"
                        >
                          {Number(total.outgoing).toLocaleString()}
                        </div>
                      ))}
                    </td>
                    <td className="px-3 py-2 align-top">
                      <span className="inline-flex min-h-8 items-center tabular-nums">
                        {book.pageCount}
                      </span>
                    </td>
                    {onFifo && (
                      <td className="px-3 py-2 align-top">
                        {book.totals.map((total: any) => (
                          <div
                            key={`${total.unit}:${total.isFrozen}`}
                            className="flex min-h-8 items-center"
                          >
                            {!Number(total.isFrozen) &&
                            Number(total.quantity) > 0 ? (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 whitespace-nowrap"
                                title="اختيار الصنف — الأقدم تلقائيًا"
                                aria-label={`صرف بالأقدم — ${total.unit || "وحدة غير محددة"}`}
                                disabled={!String(total.unit || "").trim()}
                                onClick={() =>
                                  onFifo(book, String(total.unit || ""))
                                }
                              >
                                صرف بالأقدم
                              </Button>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </div>
                        ))}
                      </td>
                    )}
                  </tr>
                  {expanded === book.id && (
                    <tr className="border-t bg-muted/10">
                      <td colSpan={onFifo ? 8 : 7} className="p-2">
                        <div id={`inventory-book-${book.id}-details`}>
                          <InventoryBookPages
                            key={`${book.id}:${warehouseId}`}
                            catalogItemId={book.id}
                            warehouseId={warehouseId}
                            onPick={onPick}
                            supplierReturn={supplierReturn}
                          />
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        (result.data?.books || []).map((book: any) => (
          <div key={book.id} className="border rounded-lg bg-background">
            <div className="p-3 flex flex-wrap items-center gap-3">
              <Button
                size="sm"
                variant="ghost"
                aria-label={`تفاصيل دفتر ${book.nameAr}`}
                aria-expanded={expanded === book.id}
                onClick={() =>
                  setExpanded(expanded === book.id ? null : book.id)
                }
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
        ))
      )}
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
