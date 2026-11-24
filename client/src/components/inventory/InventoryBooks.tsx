import { Fragment, useState, type ReactNode } from "react";
import { trpc } from "@/lib/trpc";
import { getCatalogInventoryText } from "@/i18n/catalogInventory";
import { getCatalogError } from "@/i18n/catalogUi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { InventoryItemCard } from "./InventoryItemCard";
import type { InventoryIssueUnitItem } from "./InventoryIssueUnitDialog";

export type BookLotSelection = { lot: any; page: any; master: any };
export function InventoryBookPages({
  catalogItemId,
  warehouseId,
  onPick,
  onPrintLot,
  renderIssueUnitActions,
  supplierReturn = false,
  language = "ar",
}: {
  catalogItemId: number;
  warehouseId?: number;
  onPick?: (selection: BookLotSelection) => void;
  onPrintLot?: (selection: BookLotSelection) => void;
  renderIssueUnitActions?: (item: InventoryIssueUnitItem) => ReactNode;
  supplierReturn?: boolean;
  language?: string;
}) {
  const c = getCatalogInventoryText(language);
  const [afterId, setAfterId] = useState(0);
  const [historyId, setHistoryId] = useState<number | null>(null);
  const result = trpc.inventory.bookPages.useQuery({
    catalogItemId,
    warehouseId,
    afterId,
  });
  if (result.isLoading) return <Loader2 className="h-4 w-4 animate-spin" />;
  if (result.error) return <p role="alert">{getCatalogError(result.error, language, c.bookLoadFailed)}</p>;
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
              {c.warehouse} #{page.warehouseId} ·{" "}
              {Number(page.isFrozen) ? c.frozen : c.operational}
            </span>
          </div>
          <p className="text-sm">
            {c.balance}: {Number(page.quantity)} {page.unit}
          </p>
          {(page.movementUnits?.length
            ? page.movementUnits
            : [{ ...page.movements, unit: page.unit }]
          ).map((total: any) => (
            <p key={total.unit} className="text-sm">
              {c.incoming}: {Number(total.incoming)} · {c.outgoing}:{" "}
              {Number(total.outgoing)} {total.unit}
            </p>
          ))}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setHistoryId(page.id)}
            >{c.movements}</Button>
            {renderIssueUnitActions && renderIssueUnitActions({
              ...page,
              linkedItemId: result.data?.master.id,
              catalogUnit: result.data?.master.unit,
            })}
          </div>
          {(page.lots || []).map((lot: any) => (
            <div
              key={`${page.id}:${lot.lotId}`}
              className="flex flex-wrap gap-3 items-center rounded border p-2 text-sm"
            >
              <div className="flex-1 min-w-40">
                <strong>{lot.lotCode}</strong> ·{" "}
                {lot.supplierItemName || page.itemName}
                <p>
                  {c.supplier}: {lot.supplierName || c.notRecorded} · {c.purchaseDate}:{" "}
                  {lot.invoiceDate
                    ? new Date(lot.invoiceDate).toLocaleDateString(language === "en" ? "en-GB" : "ar-SA")
                    : c.notRecorded}
                </p>
                <p>
                  {c.originalQuantity}: {Number(lot.originalQuantity)} · {c.remaining}:{" "}
                  {Number(lot.balanceQuantity)} {lot.issueUnit || page.unit} ·
                  {c.receipt}: {lot.receiptNumber || "—"}
                </p>
              </div>
              {onPrintLot && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!lot.trackingToken}
                  onClick={() => onPrintLot({ lot, page, master: result.data?.master })}
                >{c.printQr}</Button>
              )}
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
                >{c.pickLot}</Button>
              )}
            </div>
          ))}
          {!page.lots.length && (
            <p className="text-muted-foreground text-sm">{c.noLots}</p>
          )}
        </div>
      ))}
      {!result.data?.pages.length && (
        <p>{c.noRecords}</p>
      )}
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={!afterId}
          onClick={() => setAfterId(0)}
        >{c.first}</Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!result.data?.nextId}
          onClick={() => setAfterId(result.data!.nextId!)}
        >{c.next}</Button>
      </div>
      {historyId != null && (
        <InventoryItemCard
          language={language}
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
  groupByWarehouse = false,
  search: externalSearch,
  includeZero = false,
  onPick,
  onPrintLot,
  onFifo,
  renderIssueUnitActions,
  supplierReturn = false,
  nodeIds,
  sort,
  dateFrom,
  dateTo,
  layout = "cards",
  showLinkedWork = false,
}: {
  layout?: "cards" | "table";
  showLinkedWork?: boolean;
  nodeIds?: number[];
  sort?: "name" | "recent" | "quantity";
  dateFrom?: string;
  dateTo?: string;
  warehouseId?: number;
  groupByWarehouse?: boolean;
  search?: string;
  includeZero?: boolean;
  supplierReturn?: boolean;
  onPick?: (selection: BookLotSelection) => void;
  onPrintLot?: (selection: BookLotSelection) => void;
  onFifo?: (book: any, unit: string) => void;
  renderIssueUnitActions?: (item: InventoryIssueUnitItem) => ReactNode;
}) {
  const [search, setSearch] = useState("");
  const [cursor, setCursor] = useState({ key: "", id: 0 });
  const [expanded, setExpanded] = useState<number | string | null>(null);
  const bookKey = (book: any) => groupByWarehouse ? `${book.id}:${book.warehouseId}` : book.id;
  const bookWarehouseId = (book: any) => groupByWarehouse ? Number(book.warehouseId) : warehouseId;
  const query = externalSearch ?? search;
  const key = JSON.stringify([
    warehouseId,
    groupByWarehouse,
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
    ...(groupByWarehouse ? { groupByWarehouse: true } : {}),
    ...(showLinkedWork ? { includeLinkedWork: true } : {}),
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
            className={`w-full ${showLinkedWork ? (groupByWarehouse ? "min-w-[1450px]" : "min-w-[1250px]") : (groupByWarehouse ? "min-w-[1200px]" : "min-w-[1000px]")} table-fixed border-collapse text-sm`}
            aria-label="أصناف المستودع حسب دفتر الكتالوج"
            dir="rtl"
          >
            <colgroup>
              <col style={{ width: "5%" }} />
              <col style={{ width: groupByWarehouse ? (onFifo ? (showLinkedWork ? "9%" : "13%") : (showLinkedWork ? "9%" : "23%")) : (onFifo ? (showLinkedWork ? "13%" : "27%") : (showLinkedWork ? "23%" : "37%")) }} />
              {groupByWarehouse && <col style={{ width: "14%" }} />}
              <col style={{ width: "12%" }} />
              <col style={{ width: "8%" }} />
              <col style={{ width: "14%" }} />
              <col style={{ width: "8%" }} />
              <col style={{ width: "8%" }} />
              <col style={{ width: "8%" }} />
              {showLinkedWork && <col style={{ width: "14%" }} />}
              {onFifo && <col style={{ width: "10%" }} />}
            </colgroup>
            <thead>
              <tr className="bg-muted/50 text-xs text-muted-foreground">
                {[
                  "م",
                  "الصنف",
                  ...(groupByWarehouse ? ["المستودع"] : []),
                  "الكود",
                  "الرصيد",
                  "الوحدة",
                  "الوارد",
                  "المنصرف",
                  "السجلات",
                  ...(showLinkedWork ? ["ارتباط الصيانة"] : []),
                  ...(onFifo ? ["الصرف"] : []),
                ].map((label, index, labels) => (
                  <th
                    key={label}
                    scope="col"
                    className={`h-10 px-3 py-2 font-medium whitespace-nowrap ${label === "الصنف" ? "text-right" : "text-center"} ${index < labels.length - 1 ? "border-e" : ""}`}
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(result.data?.books || []).map((book: any, index: number) => (
                <Fragment key={bookKey(book)}>
                  <tr className="border-t hover:bg-muted/30 transition-colors">
                    <td className="border-e px-2 py-2 align-middle text-center tabular-nums">
                      {afterId + index + 1}
                    </td>
                    <td className="border-e px-3 py-2 align-middle">
                      <div className="flex h-8 min-w-0 items-center gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 shrink-0"
                          aria-label={`تفاصيل دفتر ${book.nameAr || book.nameEn}`}
                          aria-expanded={expanded === bookKey(book)}
                          aria-controls={`inventory-book-${bookKey(book)}-details`}
                          onClick={() =>
                            setExpanded(expanded === bookKey(book) ? null : bookKey(book))
                          }
                        >
                          {expanded === bookKey(book) ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                        </Button>
                        <span
                          className="min-w-0 flex-1 truncate font-medium"
                          title={book.nameAr || book.nameEn}
                        >
                          {book.nameAr || book.nameEn}
                        </span>
                      </div>
                    </td>
                    {groupByWarehouse && (
                      <td className="border-e px-3 py-2 align-middle text-center break-words">
                        {book.warehouseName || `#${book.warehouseId}`}
                      </td>
                    )}
                    <td className="border-e px-3 py-2 align-middle text-center">
                      <span
                        className="block truncate font-mono text-xs leading-8"
                        dir="ltr"
                        title={book.code || ""}
                      >
                        {book.code || "—"}
                      </span>
                    </td>
                    <td className="border-e px-3 py-2 align-middle text-center">
                      {book.totals.map((total: any) => (
                        <div
                          key={`${total.unit}:${total.isFrozen}`}
                          className="flex h-8 items-center justify-center font-bold tabular-nums"
                          dir="ltr"
                        >
                          {Number(total.quantity).toLocaleString()}
                        </div>
                      ))}
                    </td>
                    <td className="border-e px-3 py-2 align-middle text-center">
                      {book.totals.map((total: any) => (
                        <div
                          key={`${total.unit}:${total.isFrozen}`}
                          className="flex h-8 items-center justify-center gap-2 whitespace-nowrap"
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
                    <td className="border-e px-3 py-2 align-middle text-center">
                      {book.totals.map((total: any) => (
                        <div
                          key={`${total.unit}:${total.isFrozen}`}
                          className="flex h-8 items-center justify-center tabular-nums"
                          dir="ltr"
                        >
                          {Number(total.incoming).toLocaleString()}
                        </div>
                      ))}
                    </td>
                    <td className="border-e px-3 py-2 align-middle text-center">
                      {book.totals.map((total: any) => (
                        <div
                          key={`${total.unit}:${total.isFrozen}`}
                          className="flex h-8 items-center justify-center tabular-nums"
                          dir="ltr"
                        >
                          {Number(total.outgoing).toLocaleString()}
                        </div>
                      ))}
                    </td>
                    <td
                      className={`px-3 py-2 align-middle text-center ${onFifo || showLinkedWork ? "border-e" : ""}`}
                    >
                      <span className="inline-flex h-8 items-center justify-center tabular-nums">
                        {book.pageCount}
                      </span>
                    </td>
                    {showLinkedWork && (
                      <td className={`px-2 py-2 align-middle text-center ${onFifo ? "border-e" : ""}`}>
                        {(book.linkedWork || []).length ? (book.linkedWork || []).map((link: any, i: number) => (
                          <div key={i} className="text-xs leading-5">{link.kind === "ticket" ? "بلاغ" : "PMV2"} <b dir="ltr">{link.reference}</b>{link.quantity == null ? " — الكمية تحتاج مراجعة" : ` — ${link.quantity} ${link.unit}`}</div>
                        )) : "—"}
                      </td>
                    )}
                    {onFifo && (
                      <td className="px-3 py-2 align-middle text-center">
                        {book.totals.map((total: any) => (
                          <div
                            key={`${total.unit}:${total.isFrozen}`}
                            className="flex h-8 items-center justify-center"
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
                  {expanded === bookKey(book) && (
                    <tr className="border-t bg-muted/10">
                      <td colSpan={(onFifo ? 9 : 8) + (groupByWarehouse ? 1 : 0) + (showLinkedWork ? 1 : 0)} className="p-2">
                        <div id={`inventory-book-${bookKey(book)}-details`}>
                          <InventoryBookPages
                            key={`${book.id}:${bookWarehouseId(book)}`}
                            catalogItemId={book.id}
                            warehouseId={bookWarehouseId(book)}
                            onPick={onPick}
                            onPrintLot={onPrintLot}
                            renderIssueUnitActions={renderIssueUnitActions}
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
          <div key={bookKey(book)} className="border rounded-lg bg-background">
            <div className="p-3 flex flex-wrap items-center gap-3">
              <Button
                size="sm"
                variant="ghost"
                aria-label={`تفاصيل دفتر ${book.nameAr}`}
                aria-expanded={expanded === bookKey(book)}
                onClick={() =>
                  setExpanded(expanded === bookKey(book) ? null : bookKey(book))
                }
              >
                {expanded === bookKey(book) ? <ChevronDown /> : <ChevronRight />}
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
            {expanded === bookKey(book) && (
              <InventoryBookPages
                key={`${book.id}:${bookWarehouseId(book)}`}
                catalogItemId={book.id}
                warehouseId={bookWarehouseId(book)}
                onPick={onPick}
                onPrintLot={onPrintLot}
                renderIssueUnitActions={renderIssueUnitActions}
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
