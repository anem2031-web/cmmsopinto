import { useEffect, useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { WarehouseLotSelection } from "./WarehouseLotSelection";
import { isLotSelectionValidationError, warehouseLotValidationMessage } from "@/lib/warehouse-lot-validation-message";
import type { WarehouseLotSelection as Selection } from "@shared/warehouse-lot-selection";
import {
  buildMaterialTransferLotCart,
  materialTransferLotOptions,
  type MaterialTransferGroup,
} from "@/lib/material-transfer-lots";

export function MaterialTransferLotPicker({
  groups,
  context,
  inventory,
  disabled,
  onInvalidate,
  onPrepared,
}: {
  groups: MaterialTransferGroup[];
  context: {
    source: "tickets" | "pmv2";
    requestItemId: number;
    fromWarehouseId: number;
    toWarehouseId: number;
    quantity: number;
    materialName: string;
    unit: string;
  };
  inventory: any[];
  disabled?: boolean;
  onInvalidate(): void;
  onPrepared(rows: ReturnType<typeof buildMaterialTransferLotCart>): void;
}) {
  const utils = trpc.useUtils();
  const [lots, setLots] = useState<Record<number, any[]>>({});
  const [selections, setSelections] = useState<Record<string, Selection>>({});
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notes, setNotes] = useState("");
  const inventoryIds = useMemo(
    () => Array.from(new Set(groups.map(group => group.sourceInventoryId))),
    [groups]
  );
  const load = async () =>
    Object.fromEntries(
      await Promise.all(
        inventoryIds.map(async inventoryId => [
          inventoryId,
          await utils.client.inventory.listLots.query({ inventoryId, movementKind: "transfer" }),
        ])
      )
    ) as Record<number, any[]>;
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    load()
      .then(rows => {
        if (active) setLots(rows);
      })
      .catch(e => {
        if (active) setError(e.message || "تعذر تحميل اللوتات");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [inventoryIds]);
  let planError = "";
  let inlineSelectionError = false;
  if (!loading && !error)
    try {
      buildMaterialTransferLotCart(
        groups,
        lots,
        selections,
        context,
        inventory,
        notes
      );
    } catch (e) {
      planError = warehouseLotValidationMessage(e);
      inlineSelectionError = isLotSelectionValidationError(e);
    }
  const prepare = async () => {
    if (loading || disabled) return;
    onInvalidate();
    setLoading(true);
    setError("");
    try {
      const fresh = await load();
      setLots(fresh);
      onPrepared(
        buildMaterialTransferLotCart(
          groups,
          fresh,
          selections,
          context,
          inventory,
          notes
        )
      );
    } catch (e) {
      onInvalidate();
      setError(warehouseLotValidationMessage(e));
    } finally {
      setLoading(false);
    }
  };
  return (
    <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
      <p className="text-sm font-semibold">
        توزيع كامل كمية التحويل: {context.quantity} {context.unit}
      </p>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={disabled || loading}
        onClick={() => {
          onInvalidate();
          setLoading(true);
          setError("");
          load()
            .then(setLots)
            .catch(e => setError(e.message || "تعذر تحميل اللوتات"))
            .finally(() => setLoading(false));
        }}
      >
        تحديث اللوتات
      </Button>
      {loading && (
        <p role="status" className="text-sm">
          جارٍ تحميل اللوتات…
        </p>
      )}
      {groups.map(group => {
        let options: ReturnType<typeof materialTransferLotOptions> = [];
        try {
          options = materialTransferLotOptions(
            group,
            lots[group.sourceInventoryId] || []
          );
        } catch {
          /* The full-plan error below disables preparation. */
        }
        return (
          <div key={group.key} className="space-y-2">
            <p className="text-sm">
              {group.materialName} — {group.quantity} {group.unit}
            </p>
            <WarehouseLotSelection
              operation="transfer"
              lots={options}
              required={group.quantity}
              unit={group.unit}
              value={selections[group.key] || { mode: "fifo" }}
              onChange={selection => {
                setSelections(previous => ({
                  ...previous,
                  [group.key]: selection,
                }));
                setError("");
                onInvalidate();
              }}
              disabled={disabled || loading}
            />
          </div>
        );
      })}
      <label className="block space-y-1 text-xs">
        ملاحظة على الصنف (اختياري)
        <Input
          value={notes}
          disabled={disabled || loading}
          onChange={e => {
            setNotes(e.target.value);
            onInvalidate();
          }}
        />
      </label>
      {(error || (!inlineSelectionError && planError)) && (
        <p role="alert" className="text-sm text-destructive">
          {error || planError}
        </p>
      )}
      <Button
        type="button"
        variant="outline"
        className="w-full"
        disabled={disabled || loading || !!error || !!planError}
        onClick={prepare}
      >
        إضافة اللوتات المحددة للعملية
      </Button>
    </div>
  );
}
