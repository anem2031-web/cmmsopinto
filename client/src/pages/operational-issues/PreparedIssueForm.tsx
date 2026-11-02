import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { useTranslation } from "@/contexts/LanguageContext";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { TechnicianCombobox } from "@/components/tickets/TechnicianCombobox";
import { CatalogPickerDialog } from "@/components/catalog/CatalogPickerDialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  allocateOperationalFifo,
  canUseOperationalCatalog,
} from "@shared/operational-dispatch";
import { operationalIssueText } from "@/i18n/operationalIssues";
import { operationalDispatchText } from "@/i18n/operationalDispatch";
import { getLocalizedCatalogName } from "@/i18n/catalogMasterData";
import { toast } from "sonner";

type DraftLine = {
  catalogItemId: number;
  name: string;
  quantity: number;
  siteId: string;
  sectionId: string;
  collectorId: string;
  source: "inventory" | "catalog";
};
export function PreparedIssueForm() {
  const { user } = useAuth();
  const { language } = useTranslation();
  const text = operationalIssueText[language],
    t = operationalDispatchText[language];
  const utils = trpc.useUtils();
  const options = trpc.operationalIssues.preparationOptions.useQuery(
    undefined,
    { retry: false }
  );
  const collectors = trpc.operationalIssues.choices.useQuery();
  const [warehouseId, setWarehouseId] = useState("");
  const [reason, setReason] = useState("");
  const [items, setItems] = useState<DraftLine[]>([]);
  const [adding, setAdding] = useState(false),
    [inventory, setInventory] = useState(false),
    [catalog, setCatalog] = useState(false);
  const operation = useRef<{ value: string; key: string } | null>(null),
    busy = useRef(false);
  const selected = trpc.operationalIssues.preparedSelection.useQuery(
    {
      warehouseId: Number(warehouseId),
      catalogItemIds: items.map(i => i.catalogItemId),
    },
    { enabled: !!warehouseId && items.length > 0, retry: false }
  );
  const create = trpc.operationalIssues.createPrepared.useMutation();
  const stockFor = (id: number) => selected.data?.find(s => s.itemId === id);
  const fifoFor = (item: DraftLine) => {
    const stock = stockFor(item.catalogItemId);
    if (!stock || (item.source === "catalog" && stock.totalQuantity === 0))
      return { label: "", error: "" };
    if(stock.totalQuantity<item.quantity)return {label:language==="ar"?`المتاح ${stock.totalQuantity} ${stock.unit} — ينتظر تغطية عجز ${item.quantity-stock.totalQuantity} قبل الصرف`:`Shortage: ${item.quantity-stock.totalQuantity} ${stock.unit}; full issue waits for coverage`,error:""};
    try {
      return {
        label: allocateOperationalFifo(stock, item.quantity)
          .map(l => `${l.lotCode} (${l.quantity} ${stock.unit})`)
          .join(" · "),
        error: "",
      };
    } catch (e) {
      return {
        label: "",
        error: e instanceof Error ? e.message : t.unavailable,
      };
    }
  };
  const add = (id: number, name: string, source: DraftLine["source"]) =>
    setItems(old =>
      old.length >= 20 || old.some(i => i.catalogItemId === id)
        ? old
        : [
            ...old,
            {
              catalogItemId: id,
              name,
              source,
              quantity: 1,
              siteId: "",
              sectionId: "",
              collectorId: "",
            },
          ]
    );
  const change = (index: number, patch: Partial<DraftLine>) =>
    setItems(old =>
      old.map((row, n) => (n === index ? { ...row, ...patch } : row))
    );
  const valid =
    options.data?.ready &&
    warehouseId &&
    reason.trim() &&
    !selected.error &&
    !selected.isFetching &&
    items.length > 0 &&
    items.every(i => {
      const stock = stockFor(i.catalogItemId);
      return (
        i.siteId &&
        i.sectionId &&
        i.collectorId &&
        Number.isInteger(i.quantity) &&
        i.quantity > 0 &&
        stock?.unit &&
        !stock.needsReview &&
        !fifoFor(i).error &&
        ((i.source === "catalog" && stock.totalQuantity === 0) || stock.totalQuantity > 0)
      );
    });
  if (options.isLoading) return <p>{text.load}</p>;
  if (options.error) return <p role="alert">{options.error.message}</p>;
  if (!options.data?.ready) return <p role="status">{t.setup}</p>;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{text.newOrder}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label htmlFor="dispatch-warehouse">{text.warehouse}</Label>
          <select
            id="dispatch-warehouse"
            className="w-full h-10 border rounded-md bg-background"
            value={warehouseId}
            disabled={items.length > 0 || create.isPending}
            onChange={e => setWarehouseId(e.target.value)}
          >
            <option value="">—</option>
            {options.data.warehouses.map(w => (
              <option key={w.id} value={w.id}>
                {language === "ar" ? w.nameAr : w.nameEn || w.nameAr}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="dispatch-reason">{text.reason} *</Label>
          <Textarea
            id="dispatch-reason"
            value={reason}
            maxLength={2000}
            disabled={create.isPending}
            onChange={e => setReason(e.target.value)}
          />
        </div>
        <div className="flex flex-wrap gap-3 items-center">
          <Button
            variant="outline"
            disabled={!warehouseId || items.length >= 20 || create.isPending}
            onClick={() => setAdding(!adding)}
          >
            {t.add}
          </Button>
          <span>
            {items.length}/20 · {t.limit}
          </span>
        </div>
        {adding && (
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setInventory(true);
                setAdding(false);
              }}
            >
              {t.inventory}
            </Button>
            {canUseOperationalCatalog(user!.role) && (
              <Button
                variant="outline"
                onClick={() => {
                  setCatalog(true);
                  setAdding(false);
                }}
              >
                {t.catalog}
              </Button>
            )}
          </div>
        )}
        <p className="text-sm text-muted-foreground">{t.fifo}</p>
        {items.map((item, index) => (
          <fieldset
            key={item.catalogItemId}
            disabled={create.isPending}
            className="border rounded-lg p-4 space-y-3"
          >
            <div className="flex justify-between items-center">
              <strong>
                {index + 1}. {item.name}
              </strong>
              <Button
                variant="ghost"
                onClick={() =>
                  setItems(old => old.filter((_, n) => n !== index))
                }
              >
                {text.remove}
              </Button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
              <div>
                <Label htmlFor={`qty-${item.catalogItemId}`}>
                  {text.quantity} ({stockFor(item.catalogItemId)?.unit || "—"})
                </Label>
                <Input
                  id={`qty-${item.catalogItemId}`}
                  type="number"
                  min={1}
                  max={2147483647}
                  step={1}
                  value={item.quantity}
                  onChange={e =>
                    change(index, { quantity: Number(e.target.value) })
                  }
                />
              </div>
              <div>
                <Label>{t.stock}</Label>
                <Input
                  readOnly
                  value={
                    selected.isFetching
                      ? "…"
                      : `${stockFor(item.catalogItemId)?.totalQuantity ?? "—"} ${stockFor(item.catalogItemId)?.unit || ""}`
                  }
                />
              </div>
              <div>
                <Label htmlFor={`site-${item.catalogItemId}`}>
                  {text.site}
                </Label>
                <select
                  id={`site-${item.catalogItemId}`}
                  className="w-full h-9 border rounded-md bg-background"
                  value={item.siteId}
                  onChange={e =>
                    change(index, { siteId: e.target.value, sectionId: "" })
                  }
                >
                  <option value="">—</option>
                  {options.data!.sites.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor={`section-${item.catalogItemId}`}>
                  {text.section}
                </Label>
                <select
                  id={`section-${item.catalogItemId}`}
                  className="w-full h-9 border rounded-md bg-background"
                  disabled={!item.siteId}
                  value={item.sectionId}
                  onChange={e => change(index, { sectionId: e.target.value })}
                >
                  <option value="">—</option>
                  {options
                    .data!.sections.filter(
                      s => Number(s.siteId) === Number(item.siteId)
                    )
                    .map(s => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                </select>
              </div>
              <div>
                <Label>{text.collector}</Label>
                <TechnicianCombobox
                  options={(collectors.data?.collectors || []).map(u => ({
                    value: String(u.id),
                    label: u.name,
                  }))}
                  value={item.collectorId}
                  onValueChange={collectorId => change(index, { collectorId })}
                />
              </div>
            </div>
            {stockFor(item.catalogItemId)?.needsReview && (
              <p role="alert" className="text-destructive">
                {text.stockReview}
              </p>
            )}
            {fifoFor(item).label && (
              <p className="text-sm text-muted-foreground">
                {t.current}: {fifoFor(item).label}
              </p>
            )}
            {fifoFor(item).error &&
              !stockFor(item.catalogItemId)?.needsReview && (
                <p role="alert" className="text-destructive">
                  {fifoFor(item).error}
                </p>
              )}
            {stockFor(item.catalogItemId)?.totalQuantity === 0 && (
              <p className="text-amber-700">{t.noStock}</p>
            )}
          </fieldset>
        ))}
        {selected.error && <p role="alert">{selected.error.message}</p>}
        <Button
          disabled={!valid || create.isPending}
          onClick={async () => {
            if (!valid || busy.current) return;
            busy.current = true;
            const body = {
              warehouseId: Number(warehouseId),
              reason: reason.trim(),
              items: items.map(i => ({
                catalogItemId: i.catalogItemId,
                quantity: i.quantity,
                unit: stockFor(i.catalogItemId)!.unit,
                source: i.source,
                siteId: Number(i.siteId),
                sectionId: Number(i.sectionId),
                collectorId: Number(i.collectorId),
              })),
            };
            const value = JSON.stringify(body);
            if (operation.current?.value !== value)
              operation.current = { value, key: crypto.randomUUID() };
            try {
              await create.mutateAsync({
                ...body,
                operationKey: operation.current!.key,
              });
              setItems([]);
              setReason("");
              operation.current = null;
              toast.success(text.saved);
              await utils.operationalIssues.list.invalidate();
            } catch (e) {
              toast.error(e instanceof Error ? e.message : text.error);
            } finally {
              busy.current = false;
            }
          }}
        >
          {t.save}
        </Button>
        <InventoryPicker
          open={inventory}
          warehouseId={Number(warehouseId)}
          close={() => setInventory(false)}
          onSelect={(id, name) => {
            add(id, name, "inventory");
            setInventory(false);
          }}
        />
        {canUseOperationalCatalog(user!.role) && (
          <CatalogPickerDialog
            open={catalog}
            onClose={() => setCatalog(false)}
            onSelect={item =>
              add(item.id, getLocalizedCatalogName(item, language), "catalog")
            }
          />
        )}
      </CardContent>
    </Card>
  );
}

function InventoryPicker({
  open,
  warehouseId,
  close,
  onSelect,
}: {
  open: boolean;
  warehouseId: number;
  close(): void;
  onSelect(id: number, name: string): void;
}) {
  const { language } = useTranslation();
  const text = operationalIssueText[language],
    t = operationalDispatchText[language];
  const [search, setSearch] = useState(""),
    [query, setQuery] = useState(""),
    [pages, setPages] = useState([0]);
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search);
      setPages([0]);
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);
  const data = trpc.operationalIssues.stockChoices.useQuery(
    { warehouseId, search: query, afterId: pages[pages.length - 1] },
    { enabled: open && warehouseId > 0, retry: false }
  );
  return (
    <Dialog
      open={open}
      onOpenChange={value => {
        if (!value) close();
      }}
    >
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t.inventory}</DialogTitle>
        </DialogHeader>
        <Input
          aria-label={t.search}
          placeholder={t.search}
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        {data.error && <p role="alert">{data.error.message}</p>}
        {data.isFetching && <p>{text.load}</p>}
        {data.data?.items.map(item => (
          <Button
            key={item.id}
            variant="outline"
            className="w-full h-auto justify-between p-3 text-start whitespace-normal"
            disabled={
              data.isFetching ||
              item.stock.needsReview ||
              item.stock.totalQuantity <= 0
            }
            onClick={() =>
              onSelect(
                item.id,
                language === "ar" ? item.nameAr : item.nameEn || item.nameAr
              )
            }
          >
            <span>
              {item.code} ·{" "}
              {language === "ar" ? item.nameAr : item.nameEn || item.nameAr}
            </span>
            <span>
              {item.stock.totalQuantity} {item.stock.unit}
              {item.stock.needsReview ? ` · ${text.stockReview}` : ""}
            </span>
          </Button>
        ))}
        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={pages.length < 2 || data.isFetching}
            onClick={() => setPages(old => old.slice(0, -1))}
          >
            {t.back}
          </Button>
          <Button
            variant="outline"
            disabled={!data.data?.next || data.isFetching}
            onClick={() => setPages(old => [...old, data.data!.next!])}
          >
            {t.more}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
