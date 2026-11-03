import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  selectFullIssueLots,
  type WarehouseLotOption,
  type WarehouseLotSelection as Selection,
} from "@shared/warehouse-lot-selection";

export function WarehouseLotSelection({
  lots,
  required,
  unit,
  value,
  onChange,
  onReadyChange,
  disabled,
  language = "ar",
  operation = "issue",
}: {
  lots: WarehouseLotOption[];
  required: number;
  unit: string;
  value: Selection;
  onChange(value: Selection): void;
  onReadyChange?(ready: boolean): void;
  disabled?: boolean;
  language?: string;
  operation?: "issue" | "transfer";
}) {
  const [expanded, setExpanded] = useState(false);
  const l = (ar: string, en: string, ur: string) =>
    language === "ar" ? ar : language === "ur" ? ur : en;
  const selected = value.mode === "manual" ? value.lots : [];
  const total = selected.reduce(
    (sum, choice) =>
      sum +
      choice.quantity *
        (lots.find(lot => lot.lotId === choice.lotId)?.originalPerUnit ?? 1),
    0
  );
  let error = "";
  if (value.mode === "manual")
    try {
      selectFullIssueLots(lots, required, unit, value);
    } catch (e) {
      error = (e as Error).message;
    }
  const ready = !error;
  useEffect(() => {
    onReadyChange?.(ready);
  }, [ready, onReadyChange]);
  const update = (lotId: number, quantity: number | null) =>
    onChange({
      mode: "manual",
      lots: [
        ...selected.filter(lot => lot.lotId !== lotId),
        ...(quantity !== null ? [{ lotId, quantity }] : []),
      ],
    });
  return (
    <fieldset
      disabled={disabled}
      className="rounded-md border p-3 space-y-3 min-w-0"
    >
      <p className="text-sm font-medium">
        {l(
          "الكمية المطلوبة كاملة",
          "Full required quantity",
          "مکمل مطلوبہ مقدار"
        )}
        : {required} {unit}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant={value.mode === "fifo" ? "default" : "outline"}
          onClick={() => {
            onChange({ mode: "fifo" });
            setExpanded(false);
          }}
        >
          {l(operation === "transfer" ? "تحويل بالأقدم" : "صرف بالأقدم", "Oldest lots first", "پہلے پرانی لاٹس")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant={value.mode === "manual" ? "default" : "outline"}
          aria-expanded={expanded}
          onClick={() => {
            if (value.mode !== "manual") onChange({ mode: "manual", lots: [] });
            setExpanded(!expanded);
          }}
        >
          {expanded ? "▾" : "▸"}{" "}
          {l("اختيار اللوتات", "Choose lots", "لاٹس منتخب کریں")}
        </Button>
      </div>
      {value.mode === "fifo" && (
        <p className="text-xs text-muted-foreground">
          {l(
            operation === "transfer" ? "توزيع كامل الكمية على أقدم اللوتات المتوافقة داخل المخزن تلقائيًا، دون تحويل جزئي." : "اختيار أقدم اللوتات المتوافقة داخل المخزن تلقائيًا عند التأكيد، دون صرف جزئي.",
            "Select oldest compatible warehouse lots at confirmation; full issue only.",
            "تصدیق پر گودام کی پرانی موزوں لاٹس منتخب ہوں گی؛ صرف مکمل اجرا۔"
          )}
        </p>
      )}
      {value.mode === "manual" && (
        <>
          <p className="text-sm tabular-nums">
            {l("المحدد / المطلوب", "Selected / required", "منتخب / مطلوب")}:{" "}
            {Number(total.toFixed(3))} / {required} {unit}
          </p>
          {expanded && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] text-sm border-collapse">
                <thead>
                  <tr className="bg-muted">
                    <th className="border p-2">{l("اللوت", "Lot", "لاٹ")}</th>
                    <th className="border p-2">
                      {l("المتاح", "Available", "دستیاب")}
                    </th>
                    <th className="border p-2">
                      {l(
                        "الاختيار والكمية",
                        "Selection and quantity",
                        "انتخاب اور مقدار"
                      )}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {lots.map(lot => {
                    const choice = selected.find(
                      row => row.lotId === lot.lotId
                    );
                    return (
                      <tr key={lot.lotId}>
                        <td className="border p-2">
                          <span dir="ltr">
                            {lot.lotCode || `#${lot.lotId}`}
                          </span>
                        </td>
                        <td className="border p-2">
                          {lot.quantity} {lot.unit}
                        </td>
                        <td className="border p-2">
                          <div className="flex items-center justify-center gap-2">
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={!choice && lot.quantity < 1}
                              onClick={() =>
                                update(
                                  lot.lotId,
                                  choice
                                    ? null
                                    : Math.min(
                                        Math.floor(lot.quantity),
                                        Math.max(
                                          1,
                                          Math.floor(
                                            (required - total) /
                                              (lot.originalPerUnit ?? 1)
                                          )
                                        )
                                      )
                                )
                              }
                            >
                              {choice
                                ? l("إلغاء الاختيار", "Remove", "ہٹائیں")
                                : l(
                                    "اختيار اللوت",
                                    "Select lot",
                                    "لاٹ منتخب کریں"
                                  )}
                            </Button>
                            {choice && (
                              <Input
                                aria-label={`${l("كمية اللوت", "Lot quantity", "لاٹ کی مقدار")} ${lot.lotCode || lot.lotId}`}
                                className="w-24"
                                type="number"
                                min={1}
                                max={Math.floor(lot.quantity)}
                                step={1}
                                dir="ltr"
                                value={choice.quantity}
                                onChange={event =>
                                  update(lot.lotId, Number(event.target.value))
                                }
                              />
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {error && (
            <p role="status" className="text-xs text-amber-700">
              {l(
                error,
                "Select valid lots covering exactly the full requirement.",
                "مکمل ضرورت کے مطابق درست لاٹس منتخب کریں۔"
              )}
            </p>
          )}
        </>
      )}
    </fieldset>
  );
}
