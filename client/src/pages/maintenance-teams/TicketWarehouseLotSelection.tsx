import { trpc } from "@/lib/trpc";
import { WarehouseLotSelection } from "@/components/inventory/WarehouseLotSelection";
import type { WarehouseLotSelection as Selection } from "@shared/warehouse-lot-selection";
export function TicketWarehouseLotSelection({
  assignmentId,
  needId,
  required,
  unit,
  value,
  onChange,
  onReadyChange,
  disabled,
  language,
}: {
  assignmentId: number;
  needId: number;
  required: number;
  unit: string;
  value: Selection;
  onChange(value: Selection): void;
  onReadyChange(ready: boolean): void;
  disabled: boolean;
  language: string;
}) {
  // Only the explicitly opened need loads its options. No per-card background lot reads.
  const query = trpc.ticketTeamExecution.balances.useQuery(
    { assignmentId, issueNeedId: needId },
    { enabled: value.mode === "manual", retry: false }
  );
  return (
    <div className="space-y-2">
      {value.mode === "manual" && query.isFetching && (
        <p role="status">
          {language === "ar" ? "جاري تحميل اللوتات…" : "Loading lots…"}
        </p>
      )}
      {value.mode === "manual" && query.error && (
        <p role="alert">{query.error.message}</p>
      )}
      <WarehouseLotSelection
        lots={query.data?.find(row => row.needId === needId)?.lots || []}
        required={required}
        unit={unit}
        value={value}
        onChange={onChange}
        onReadyChange={ready =>
          onReadyChange(
            ready &&
              !(value.mode === "manual" && (query.isFetching || query.isError))
          )
        }
        disabled={disabled}
        language={language}
      />
    </div>
  );
}
