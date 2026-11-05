import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useTranslation } from "@/contexts/LanguageContext";
import { externalMaintenanceLabels } from "@/i18n/externalMaintenanceFollowup";

export type ExternalWorkshopForm = {
  workshopName: string; workshopPhone: string; expectedReturnDate: string;
  workshopLocationUrl: string; workshopNotes: string;
};
export function needsExternalWorkshop(item: any): boolean {
  return item?.externalWorkshopRequired === true || item?.isExternalMaintenance === true || item?.externalWorkshop != null;
}
export function externalWorkshopForm(item: any, draft?: ExternalWorkshopForm): ExternalWorkshopForm {
  if (draft) return draft;
  const saved = item?.externalWorkshop || {};
  return {
    workshopName: saved.workshopName || "", workshopPhone: saved.workshopPhone || "",
    expectedReturnDate: saved.expectedReturnDate ? String(saved.expectedReturnDate).slice(0, 10) : "",
    workshopLocationUrl: saved.workshopLocationUrl || "", workshopNotes: saved.workshopNotes || "",
  };
}
export function externalWorkshopIssue(item: any, draft?: ExternalWorkshopForm): "requiredWorkshop" | "invalidWorkshopUrl" | null {
  if (!needsExternalWorkshop(item)) return null;
  const value = externalWorkshopForm(item, draft);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.expectedReturnDate);
  const parsed = match ? new Date(`${value.expectedReturnDate}T00:00:00Z`) : null;
  if (!value.workshopName.trim() || value.workshopName.trim().length > 300 || !value.workshopPhone.trim() || value.workshopPhone.trim().length > 50
    || !parsed || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value.expectedReturnDate) return "requiredWorkshop";
  if (value.workshopLocationUrl.trim()) {
    if (value.workshopLocationUrl.trim().length > 2048) return "invalidWorkshopUrl";
    try { if (!["http:", "https:"].includes(new URL(value.workshopLocationUrl.trim()).protocol)) return "invalidWorkshopUrl"; }
    catch { return "invalidWorkshopUrl"; }
  }
  return null;
}
export function externalWorkshopPayload(item: any, draft?: ExternalWorkshopForm): { externalWorkshop?: ExternalWorkshopForm } {
  return needsExternalWorkshop(item) ? { externalWorkshop: externalWorkshopForm(item, draft) } : {};
}

export function ExternalWorkshopPricingFields({ item, value, onChange, disabled = false, idPrefix }: {
  item: any; value: ExternalWorkshopForm; onChange: (value: ExternalWorkshopForm) => void; disabled?: boolean; idPrefix: string;
}) {
  const { language } = useTranslation();
  if (!needsExternalWorkshop(item)) return null;
  const text = externalMaintenanceLabels(language);
  return <fieldset disabled={disabled} className="min-w-0 rounded-md border bg-white p-3 space-y-3" aria-label={text.workshop}>
    <legend className="px-1 text-sm font-medium">{text.workshop}</legend>
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1"><Label htmlFor={`${idPrefix}-name`}>{text.workshopName} *</Label><Input id={`${idPrefix}-name`} required aria-required maxLength={300} value={value.workshopName} onChange={event => onChange({ ...value, workshopName: event.target.value })} /></div>
      <div className="space-y-1"><Label htmlFor={`${idPrefix}-phone`}>{text.workshopPhone} *</Label><Input id={`${idPrefix}-phone`} type="tel" dir="ltr" required aria-required maxLength={50} value={value.workshopPhone} onChange={event => onChange({ ...value, workshopPhone: event.target.value })} /></div>
      <div className="space-y-1"><Label htmlFor={`${idPrefix}-return`}>{text.expectedReturnDate} *</Label><Input id={`${idPrefix}-return`} type="date" required aria-required value={value.expectedReturnDate} onChange={event => onChange({ ...value, expectedReturnDate: event.target.value })} /></div>
      <div className="space-y-1"><Label htmlFor={`${idPrefix}-location`}>{text.workshopLocationUrl}</Label><Input id={`${idPrefix}-location`} type="url" dir="ltr" maxLength={2048} value={value.workshopLocationUrl} onChange={event => onChange({ ...value, workshopLocationUrl: event.target.value })} /></div>
    </div>
    <div className="space-y-1"><Label htmlFor={`${idPrefix}-notes`}>{text.workshopNotes}</Label><Textarea id={`${idPrefix}-notes`} maxLength={4000} value={value.workshopNotes} onChange={event => onChange({ ...value, workshopNotes: event.target.value })} /></div>
  </fieldset>;
}
