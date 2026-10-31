import { useState } from "react";
import { TicketMaterialCatalogPicker, type TicketCatalogCandidate } from "./TicketMaterialCatalogPicker";
import { PackageSearch, Plus } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import ar from "@/i18n/ar";
import en from "@/i18n/en";
import ur from "@/i18n/ur";
import type {
  MaterialNeed,
  NeedInput,
} from "@shared/maintenance-team-tickets/model";

const labels = (language: string) =>
  (language === "ar" ? ar : language === "ur" ? ur : en).workflow.pmv2;
function ReceiptDialog({
  open,
  setOpen,
  name,
  quantity,
  unit,
  warehouseName,
  language,
  busy,
  onConfirm,
}: {
  open: boolean;
  setOpen: (open: boolean) => void;
  name: string;
  quantity: number;
  unit: string;
  warehouseName: string;
  language: string;
  busy: boolean;
  onConfirm: () => void;
}) {
  const t = labels(language);
  return (
    <AlertDialog
      open={open}
      onOpenChange={next => {
        if (!busy) setOpen(next);
      }}
    >
      <AlertDialogContent dir={language === "en" ? "ltr" : "rtl"}>
        <AlertDialogHeader>
          <AlertDialogTitle>{t.confirmReceiveMaterialsTitle}</AlertDialogTitle>
          <AlertDialogDescription>
            {t.confirmReceipt}: {quantity} {unit} «{name}» — {warehouseName}.{" "}
            {t.receiveInventoryExplanation}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{t.cancel}</AlertDialogCancel>
          <AlertDialogAction disabled={busy} onClick={onConfirm}>
            {t.confirmReceipt}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function TicketMaterialReceiptButton({
  name,
  quantity,
  unit,
  warehouseName,
  language,
  busy,
  disabled,
  onConfirm,
}: {
  name: string;
  quantity: number;
  unit: string;
  warehouseName: string;
  language: string;
  busy: boolean;
  disabled: boolean;
  onConfirm: () => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button disabled={busy || disabled} onClick={() => setOpen(true)}>
        {labels(language).receiveFromTeamStore}
      </Button>
      <ReceiptDialog
        {...{
          name,
          quantity,
          unit,
          warehouseName,
          language,
          busy,
          open,
          setOpen,
        }}
        onConfirm={() => {
          void onConfirm().then(saved => {
            if (saved) setOpen(false);
          });
        }}
      />
    </>
  );
}

/** PMV2's technician material experience, backed solely by ticket-team endpoints. */
export function TicketMaterialNeedPanel({
  assignmentId,
  currentNeeds,
  warehouseName,
  language,
  busy,
  onSubmit,
}: {
  assignmentId: number;
  currentNeeds: MaterialNeed[];
  warehouseName: string;
  language: string;
  busy: boolean;
  onSubmit: (need: NeedInput, confirmReceipt: boolean) => Promise<boolean>;
}) {
  const t = labels(language);
  const l = (a: string, e: string, u: string) =>
    language === "ar" ? a : language === "ur" ? u : e;
  const [formOpen, setFormOpen] = useState(currentNeeds.length === 0);
  const [mode, setMode] = useState<"catalog" | "unlisted">("catalog");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<TicketCatalogCandidate | null>(null);
  const [name, setName] = useState("");
  const [quantity, setQuantity] = useState("");
  const [confirmation, setConfirmation] = useState<NeedInput | null>(null);
  const catalog = trpc.ticketTeamExecution.catalog.useQuery(
    { assignmentId, search },
    { enabled: formOpen && mode === "catalog", retry: false }
  );
  const parsedQuantity = Number(quantity);
  const unit = mode === "catalog" ? selected?.unit ?? "" : "";
  const validQuantity =
    quantity.trim() !== "" &&
    Number.isSafeInteger(parsedQuantity) &&
    parsedQuantity > 0;
  const duplicate = currentNeeds.some(n =>
    mode === "catalog"
      ? n.catalogItemId === selected?.id
      : n.catalogItemId == null &&
        n.originalName.trim().toLocaleLowerCase() ===
          name.trim().toLocaleLowerCase()
  );
  const input: NeedInput = {
    ...(mode === "catalog" && selected ? { catalogItemId: selected.id } : {}),
    name: mode === "catalog" ? selected?.name : name.trim(),
    ...(mode === "catalog" ? { unit } : {}),
    quantity: validQuantity ? parsedQuantity : 1,
  };
  const canRegister =
    validQuantity &&
    !duplicate &&
    currentNeeds.length < 20 &&
    (mode === "catalog" ? !!selected && !!unit.trim() : !!name.trim());
  const preview = trpc.ticketTeamExecution.preview.useQuery(
    { assignmentId, needs: [input] },
    {
      enabled: formOpen && mode === "catalog" && canRegister,
      retry: false,
    }
  );
  const row = preview.data?.rows[0];
  const ready =
    mode === "catalog" &&
    canRegister &&
    !preview.isFetching &&
    !preview.error &&
    row?.shortage === 0;
  const reset = () => {
    setSelected(null);
    setName("");
    setQuantity("");
    setSearch("");
    setConfirmation(null);
  };
  const save = async (need: NeedInput, confirm: boolean) => {
    if (await onSubmit(need, confirm)) {
      reset();
      setFormOpen(false);
    }
  };
  if (!formOpen)
    return (
      <Button
        variant="outline"
        disabled={busy || currentNeeds.length >= 20}
        onClick={() => {
          reset();
          setMode("catalog");
          setFormOpen(true);
        }}
      >
        <Plus className="me-1 h-4 w-4" />
        {t.addAnotherMaterial}
      </Button>
    );
  return (
    <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50/40 p-3 sm:max-w-[420px]">
      <div className="text-sm font-semibold">{t.identifyMaterial}</div>
      <p className="text-xs text-muted-foreground">
        {t.teamStore}: {warehouseName}
      </p>
      {mode === "catalog" ? (
        <>
          <TicketMaterialCatalogPicker
            items={catalog.data ?? []} selected={selected} search={search}
            onSearch={setSearch} onSelect={setSelected}
            blockedIds={currentNeeds.flatMap(n => n.catalogItemId == null ? [] : [n.catalogItemId])}
            loading={catalog.isFetching} disabled={busy} language={language}
          />
          {catalog.error && (
            <p role="alert" className="text-xs text-destructive">
              {catalog.error.message}
            </p>
          )}
          {catalog.data?.length === 0 && (
            <p className="text-xs text-muted-foreground">
              {t.noMatchingMaterial}
            </p>
          )}
          <Button
            variant="link"
            size="sm"
            disabled={busy}
            onClick={() => {
              reset();
              setMode("unlisted");
            }}
          >
            {t.materialNotFoundPrompt} {t.registerUnlistedMaterial}
          </Button>
        </>
      ) : (
        <>
          <Label htmlFor={`unlisted-${assignmentId}`}>
            {t.unlistedMaterialTitle}
          </Label>
          <Input
            id={`unlisted-${assignmentId}`}
            value={name}
            maxLength={250}
            disabled={busy}
            placeholder={t.enterUnlistedMaterialName}
            onChange={e => setName(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            {l(
              "يُرسل الوصف والكمية للمستودع لتحديد الصنف واعتماد الكمية بوحدة الكتالوج.",
              "The warehouse identifies the item and approves the quantity in its catalog unit.",
              "گودام صنف کی شناخت کرکے کیٹلاگ کی اکائی میں مقدار منظور کرے گا۔"
            )}
          </p>
          <Button
            variant="link"
            size="sm"
            disabled={busy}
            onClick={() => {
              reset();
              setMode("catalog");
            }}
          >
            {t.backToCatalog}
          </Button>
        </>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Input
          aria-label={t.requiredQuantityPlaceholder}
          placeholder={t.requiredQuantityPlaceholder}
          type="number"
          min={1}
          step={1}
          value={quantity}
          disabled={busy}
          onChange={e => setQuantity(e.target.value)}
        />
        {mode === "catalog" && <Input
          aria-label={t.unitPlaceholder}
          placeholder={t.unitPlaceholder}
          value={unit}
          readOnly
          disabled={busy}
          maxLength={50}
        />}
      </div>
      {duplicate && (
        <p role="alert" className="text-xs text-destructive">
          {t.alreadyRequested}
        </p>
      )}
      {quantity.trim() && !validQuantity && (
        <p role="alert" className="text-xs text-destructive">
          {l(
            "أدخل كمية صحيحة أكبر من صفر",
            "Enter a positive whole quantity",
            "صفر سے بڑی صحیح مقدار درج کریں"
          )}
        </p>
      )}
      {mode === "catalog" && canRegister && (
        <>
          {preview.isFetching && (
            <p className="text-xs text-muted-foreground">
              {t.recheckingBalance}
            </p>
          )}
          {preview.error && (
            <p role="alert" className="text-xs text-destructive">
              {preview.error.message}
            </p>
          )}
          {row && (
            <div className="space-y-2 rounded-md border bg-background p-2.5 text-xs">
              <div className="grid grid-cols-3 gap-2">
                <div>
                  {t.requiredLabel}
                  <div className="font-medium">{row.quantity}</div>
                </div>
                <div>
                  {t.availableShort}
                  <div className="font-medium">{row.available ?? "—"}</div>
                </div>
                <div>
                  {t.shortageLabel}
                  <div className="font-medium">{row.shortage}</div>
                </div>
              </div>
              <p>
                {row.shortage === 0
                  ? l(
                      "الكمية كاملة في مخزن الفريق؛ يمكنك تأكيد استلامها الآن دون طلب للمستودع الرئيسي.",
                      "The full quantity is in the team warehouse; confirm receipt without a main-warehouse request.",
                      "پوری مقدار ٹیم کے گودام میں ہے؛ مرکزی گودام کی درخواست کے بغیر وصولی کی تصدیق کریں۔"
                    )
                  : t.partialAvailabilityRoute
                      .replace("{available}", String(row.available ?? 0))
                      .replace("{shortage}", String(row.shortage))
                      .replaceAll("{unit}", unit)}
              </p>
            </div>
          )}
        </>
      )}
      {mode === "unlisted" && (
        <p className="text-xs text-muted-foreground">
          {t.unknownCatalogRouteHelp.replace(
            "{status}",
            t.waitingMainWarehouse
          )}
        </p>
      )}
      <Button
        size="sm"
        disabled={
          busy ||
          !canRegister ||
          (mode === "catalog" &&
            (preview.isFetching || !row || !!preview.error))
        }
        onClick={() => {
          if (ready) setConfirmation({ ...input });
          else void save({ ...input }, false);
        }}
      >
        <PackageSearch className="me-1 h-4 w-4" />
        {busy
          ? t.savingNeed
          : mode === "unlisted"
            ? t.registerUnlistedAction
            : ready
              ? t.receiveFromTeamStore
              : row && row.shortage > 0
                ? t.recordNeedRequestShortage
                : t.recordNeed}
      </Button>
      <ReceiptDialog
        open={!!confirmation}
        setOpen={open => {
          if (!open) setConfirmation(null);
        }}
        name={confirmation?.name ?? ""}
        quantity={confirmation?.quantity ?? 0}
        unit={confirmation?.unit ?? ""}
        {...{ warehouseName, language, busy }}
        onConfirm={() => {
          if (confirmation) void save(confirmation, true);
        }}
      />
    </div>
  );
}
