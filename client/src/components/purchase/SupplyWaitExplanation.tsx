import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { PackageSearch, Factory, Pencil, CalendarDays, Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { useTranslation } from "@/contexts/LanguageContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { chunkSupplyWaitItems, supplyWaitKey, supplyWaitReader, supplyWaitAdmin, type SupplyWaitEntry, type SupplyWaitKind, type SupplyWaitReference } from "@shared/purchase-supply-wait";
import { purchaseSupplyWaitText } from "@/i18n/purchaseSupplyWait";
import { independentReadOptions } from "@/lib/read-transport";
import { localizeApiError } from "@/i18n/apiError";
import { toast } from "sonner";

type Selection = { reference: SupplyWaitReference; initial: SupplyWaitEntry; kind: SupplyWaitKind };
type State = { entries: Map<string, SupplyWaitEntry>; now: number; admin: boolean; open: (reference: SupplyWaitReference, kind: SupplyWaitKind) => void };
const Context = createContext<State | null>(null);
const blue = "bg-blue-600 text-white hover:bg-blue-700 hover:shadow-md active:scale-95 transition-[transform,box-shadow,background-color] duration-150 focus-visible:ring-blue-400 motion-reduce:transform-none motion-reduce:transition-none";
const kindIcon = { waiting_availability: PackageSearch, preparing: Factory };

export function SupplyWaitProvider({ items, children }: { items: { id: number; purchaseOrderId: number }[]; children: ReactNode }) {
  const { user, authenticatedUser } = useAuth();
  const actor = authenticatedUser ?? user;
  const { language } = useTranslation();
  const text = purchaseSupplyWaitText[language];
  const utils = trpc.useUtils();
  const references = useMemo(() => chunkSupplyWaitItems(items.map(item => ({ itemId: Number(item.id), purchaseOrderId: Number(item.purchaseOrderId) }))), [items]);
  const queries = trpc.useQueries(t => supplyWaitReader(actor) ? references.map(chunk => t.purchaseSupplyWait.list({ viewerId: actor!.id, viewerRole: actor!.role, items: chunk }, {
    ...independentReadOptions, retry: false, refetchInterval: 30_000, refetchOnWindowFocus: true, staleTime: 0,
  })) : []);
  const [clock, setClock] = useState(Date.now());
  const [selection, setSelection] = useState<Selection | null>(null);
  const [kind, setKind] = useState<SupplyWaitKind>("waiting_availability");
  const [date, setDate] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  useEffect(() => { const timer = window.setInterval(() => setClock(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  useEffect(() => { setSelection(null); setError(""); }, [actor?.id, actor?.role]);
  const serverOffsets = queries.flatMap(query => {
    const data = query.data;
    return data && data.viewerId === actor?.id && data.viewerRole === actor?.role ? [Date.parse(data.serverNow) - query.dataUpdatedAt] : [];
  });
  const now = clock + (serverOffsets.length ? Math.max(...serverOffsets) : 0);
  const entries = new Map<string, SupplyWaitEntry>();
  for (const query of queries) if (query.data?.available && query.data.viewerId === actor?.id && query.data.viewerRole === actor?.role)
    for (const entry of query.data.items) entries.set(supplyWaitKey(entry), entry);
  const admin = !!actor && supplyWaitAdmin(actor);
  const refresh = () => utils.purchaseSupplyWait.invalidate();
  const save = trpc.purchaseSupplyWait.save.useMutation({
    onSuccess: async () => { toast.success(text.saved); setSelection(null); setError(""); await refresh(); },
    onError: failure => { setError(localizeApiError(failure.message, language)); void refresh(); },
  });
  const open = (reference: SupplyWaitReference, selectedKind: SupplyWaitKind) => {
    const initial = entries.get(supplyWaitKey(reference));
    if (!initial) return;
    setSelection({ reference, initial, kind: selectedKind }); setKind(selectedKind);
    setDate(initial.note?.expectedReceiptDate || ""); setReason(initial.note?.reason || ""); setError("");
  };
  const current = selection ? entries.get(supplyWaitKey(selection.reference)) : null;
  const note = selection?.initial.note;
  const expired = !!note && !admin && now >= Date.parse(note.editableUntil);
  const allowed = !!selection && (note ? !!current?.note?.canEdit && !expired : !!current?.canCreate);
  return <Context.Provider value={{ entries, now, admin, open }}>
    {queries.some(query => query.isError) && <div className="flex items-center gap-2 rounded border border-amber-200 p-2 text-sm" role="alert">{text.error}<Button variant="ghost" size="sm" onClick={() => void refresh()}>{text.retry}</Button></div>}
    {children}
    <Dialog open={!!selection} onOpenChange={value => { if (!value && !save.isPending) setSelection(null); }}>
      <DialogContent dir={language === "en" ? "ltr" : "rtl"} className="max-w-md">
        <DialogHeader><DialogTitle>{note ? text.edit : text.title}</DialogTitle><DialogDescription>{admin ? text.adminHint : text.hint}</DialogDescription></DialogHeader>
        <form className="space-y-4" onSubmit={event => {
          event.preventDefault();
          if (!selection || !allowed || save.isPending) return;
          if (!date || !reason.trim()) { setError(text.required); return; }
          save.mutate({ ...selection.reference, kind, expectedReceiptDate: date, reason, revision: note?.revision ?? null });
        }}>
          <div className="grid grid-cols-2 gap-2">{(["waiting_availability", "preparing"] as const).map(value => {
            const Icon = kindIcon[value]; return <Button key={value} type="button" aria-pressed={kind === value} disabled={save.isPending || !allowed}
              variant={kind === value ? "default" : "outline"} className={`h-auto flex-col gap-2 py-3 whitespace-normal ${kind === value ? blue : ""}`} onClick={() => setKind(value)}><Icon className="size-6" />{text[value]}</Button>;
          })}</div>
          <div className="space-y-2"><Label htmlFor="supply-wait-date">{text.expected} *</Label><Input id="supply-wait-date" type="date" required value={date} disabled={save.isPending || !allowed} onChange={event => setDate(event.target.value)} /></div>
          <div className="space-y-2"><Label htmlFor="supply-wait-reason">{text.reason} *</Label><Textarea id="supply-wait-reason" required maxLength={2000} rows={4} value={reason} disabled={save.isPending || !allowed} onChange={event => setReason(event.target.value)} /></div>
          {expired && <p role="status" className="text-sm text-amber-700">{text.locked}</p>}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter><Button type="submit" className={blue} disabled={save.isPending || !allowed || !date || !reason.trim()}>{save.isPending && <Loader2 className="size-4 animate-spin" />}{text.save}</Button><Button type="button" variant="outline" disabled={save.isPending} onClick={() => setSelection(null)}>{text.cancel}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  </Context.Provider>;
}

export function SupplyWaitExplanation({ itemId, purchaseOrderId }: SupplyWaitReference) {
  const state = useContext(Context);
  const { language } = useTranslation();
  const text = purchaseSupplyWaitText[language];
  const entry = state?.entries.get(supplyWaitKey({ itemId: Number(itemId), purchaseOrderId: Number(purchaseOrderId) }));
  const [expanded, setExpanded] = useState(false);
  if (!state || !entry || (!entry.canCreate && !entry.note)) return null;
  const note = entry.note;
  const canEdit = !!note?.canEdit && (state.admin || state.now < Date.parse(note.editableUntil));
  const reference = { itemId: Number(itemId), purchaseOrderId: Number(purchaseOrderId) };
  const timestamp = (value: string) => new Date(value).toLocaleString(language === "ar" ? "ar-SA" : language === "ur" ? "ur-PK" : "en-US", { timeZone: "Asia/Riyadh" });
  return <div className="mt-2 w-full min-w-0 basis-full space-y-2 text-start" onClick={event => event.stopPropagation()} data-supply-wait-item={itemId}>
    {note && <div className="rounded-lg border border-blue-200 bg-blue-50/70 p-3 text-sm text-blue-950 dark:bg-blue-950/30 dark:text-blue-100">
      <div className="flex flex-wrap items-center gap-2 font-semibold"><span>{text[note.kind]}</span><span className="flex items-center gap-1 text-xs font-normal"><CalendarDays className="size-3.5" />{text.expected}: {note.expectedReceiptDate}</span></div>
      <p className="mt-1 whitespace-pre-wrap break-words">{note.reason}</p>
      <p className="mt-2 text-xs opacity-80">{text.author}: {note.createdByName} — {timestamp(note.createdAt)}</p>
      {note.revision > 0 && <p className="text-xs opacity-80">{text.updated}: {note.updatedByName} — {timestamp(note.updatedAt)}</p>}
      {!state.admin && canEdit && <p className="mt-1 text-xs">{text.until}: {timestamp(note.editableUntil)}. {text.publication}</p>}
    </div>}
    {canEdit ? <Button type="button" size="sm" className={`${blue} h-auto max-w-full whitespace-normal py-2`} onClick={() => state.open(reference, note!.kind)}><Pencil className="size-4" />{text.edit}</Button>
      : entry.canCreate ? <Popover open={expanded} onOpenChange={setExpanded}><PopoverTrigger asChild><Button type="button" size="sm" className={`${blue} h-auto max-w-full whitespace-normal py-2`}><PackageSearch className="size-4" />{text.title}</Button></PopoverTrigger><PopoverContent className="w-72 p-2" dir={language === "en" ? "ltr" : "rtl"}>
        <div className="grid grid-cols-2 gap-2">{(["waiting_availability", "preparing"] as const).map(kind => { const Icon = kindIcon[kind]; return <Button type="button" key={kind} variant="outline" className="h-auto flex-col gap-2 whitespace-normal py-3 text-blue-700 hover:bg-blue-50" onClick={() => { setExpanded(false); state.open(reference, kind); }}><Icon className="size-6" />{text[kind]}</Button>; })}</div>
      </PopoverContent></Popover> : null}
  </div>;
}
