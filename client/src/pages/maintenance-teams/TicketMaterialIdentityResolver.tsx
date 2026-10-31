import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { MaterialIdentityDialog } from "@/components/catalog/MaterialIdentityDialog";
import type { Assignment, MaterialNeed } from "@shared/maintenance-team-tickets/model";

/** Ticket-only controller; PMV2 and tickets share presentation, not their request identities. */
export function TicketMaterialIdentityResolver({ assignment, need, language, busy, error, onClose, onConfirm }: {
  assignment: Assignment; need: MaterialNeed; language: string; busy: boolean; error?: string;
  onClose: () => void; onConfirm: (catalogItemId: number, note: string, requestedQuantity: number) => Promise<boolean>;
}) {
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(need.catalogItemId);
  const [requestedQuantity, setRequestedQuantity] = useState(String(need.requested));
  const candidates = trpc.ticketTeamExecution.searchMaterialIdentityCandidates.useQuery(
    { assignmentId: assignment.id, needId: need.id, search },
    { retry: false, refetchOnWindowFocus: false }
  );
  return <MaterialIdentityDialog
    quantityApproval={{ value: requestedQuantity, onChange: setRequestedQuantity }}
    lockCatalogSelection={need.catalogItemId != null}
    open onClose={() => { if (!busy) onClose(); }} language={language}
    originalName={need.originalName || need.name} requestedQuantity={need.requested} unit={need.unit}
    referenceLabel={language === "ar" ? "التذكرة" : language === "ur" ? "ٹکٹ" : "Ticket"}
    referenceNumber={assignment.ticketNumber} itemTitle={assignment.title}
    search={search} onSearch={value => { setSearch(value); setSelectedId(null); }}
    items={(candidates.data?.items ?? []).filter(item => need.catalogItemId == null || item.id === need.catalogItemId)} selectedId={selectedId} onSelect={id => { if (need.catalogItemId == null || id === need.catalogItemId) setSelectedId(id); }}
    loading={candidates.isFetching} error={candidates.error ?? (error ? { message: error } : undefined)} busy={busy}
    onConfirm={() => {
      const quantity = Number(requestedQuantity);
      if (!selectedId || busy || candidates.isFetching || candidates.error || !Number.isSafeInteger(quantity) || quantity <= 0 || !requestedQuantity.trim()) return;
      const item = candidates.data?.items.find(item => item.id === selectedId);
      if (!item?.unit || (need.catalogItemId != null && item.id !== need.catalogItemId)) return;
      const note = `مطابقة وصف الفني «${need.originalName || need.name}» بالصنف «${item.nameAr || item.nameEn || item.id}» من دليل المواد؛ الكمية قبل المراجعة ${need.requested} ${need.unit || "دون وحدة"}، والمعتمدة ${quantity} ${item.unit}`;
      void onConfirm(selectedId, note, quantity).then(saved => { if (saved) onClose(); });
    }}
  />;
}
