import { Check, Link2, Loader2, Search } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { localizeApiError } from "@/i18n/apiError";
import ar from "@/i18n/ar";
import en from "@/i18n/en";
import ur from "@/i18n/ur";
import type { MaterialIdentityCandidate } from "@shared/catalog-material-identity";

/** Extracted PMV2 identity dialog, shared without task/ticket API coupling. */
export function MaterialIdentityDialog({ open, onClose, language, originalName, requestedQuantity, unit, referenceNumber, itemTitle, referenceLabel, search, onSearch, items, selectedId, onSelect, onConfirm, loading, error, busy, allowDifferentUnits = false, quantityApproval, lockCatalogSelection = false, onOpenCatalog = () => window.open("/catalog", "_blank", "noopener,noreferrer") }: {
  open: boolean; onClose: () => void; language: string;
  originalName: string; requestedQuantity: number | null | undefined; unit: string | null | undefined;
  referenceNumber: string; itemTitle: string; referenceLabel?: string;
  search: string; onSearch: (value: string) => void; items: MaterialIdentityCandidate[];
  selectedId: number | null; onSelect: (id: number) => void; onConfirm: () => void;
  loading: boolean; error?: { message: string } | null; busy: boolean; onOpenCatalog?: () => void;
  allowDifferentUnits?: boolean;
  quantityApproval?: { value: string; onChange: (value: string) => void; step?: number; validate?: (quantity: number) => string | null };
  lockCatalogSelection?: boolean;
}) {
  const t = language === "ar" ? ar : language === "ur" ? ur : en;
  const dir = language === "en" ? "ltr" : "rtl";
  const locale = language === "ar" ? "ar-SA" : language === "ur" ? "ur-PK" : "en-US";
  const qty = (value: number | null | undefined, unit: string | null | undefined) => value == null || !Number.isFinite(Number(value)) ? "—" : `${Number(value).toLocaleString(locale, { maximumFractionDigits: 3 })}${unit ? ` ${unit}` : ""}`;
  const fmt = (template: string, values: Record<string, string | number>) => Object.entries(values).reduce((out, [key, value]) => out.replaceAll(`{${key}}`, String(value)), template);
  const localizedName = (value: MaterialIdentityCandidate) => language === "ar" ? value.nameAr || value.nameEn || "—" : value.nameEn || value.nameAr || "—";
  const selectedItem = items.find(item => item.id === selectedId) ?? null;
  const l = (ar: string, en: string, ur: string) => language === "ar" ? ar : language === "ur" ? ur : en;
  const approvedQuantity = quantityApproval ? Number(quantityApproval.value) : null;
  const quantityError = quantityApproval
    ? quantityApproval.validate
      ? quantityApproval.validate(Number(approvedQuantity))
      : !Number.isSafeInteger(approvedQuantity) || Number(approvedQuantity) <= 0
        ? l("أدخل كمية صحيحة أكبر من صفر", "Enter a positive whole quantity", "صفر سے بڑی صحیح مقدار درج کریں") : null
    : null;
  const validApproval = !quantityApproval || (!!selectedItem?.unit?.trim() && quantityApproval.value.trim() !== "" && Number.isFinite(approvedQuantity) && Number(approvedQuantity) > 0 && !quantityError && !loading && !error);
  return (
<Dialog open={open} onOpenChange={next => { if (!next && !busy) onClose(); }}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto" dir={dir}>
          <DialogHeader className="text-start sm:text-start">
            <DialogTitle>{t.workflow.pmv2.identifyFromCatalog}</DialogTitle>
            <DialogDescription>
              {quantityApproval ? l("اختر الصنف وراجع الكمية بوحدته المعتمدة في الكتالوج قبل التأكيد.", "Select the item and review the quantity in its catalog unit before confirming.", "تصدیق سے پہلے صنف منتخب کرکے کیٹلاگ کی اکائی میں مقدار کا جائزہ لیں۔") : t.workflow.pmv2.identityDialogHelp}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="rounded-md border border-amber-200 bg-amber-50/60 p-3 text-sm">
              <p><span className="text-muted-foreground">{t.workflow.pmv2.technicianWrote}:</span> <strong>{originalName || "—"}</strong></p>
              <p className="mt-1"><span className="text-muted-foreground">{t.workflow.pmv2.quantityLabelWh}:</span> {qty(requestedQuantity, unit)}</p>
              <p className="mt-1"><span className="text-muted-foreground">{referenceLabel ?? t.workflow.pmv2.taskLabelWh}:</span> {referenceNumber || "—"} · {itemTitle || "—"}</p>
            </div>

            {!lockCatalogSelection && <div className="space-y-2">
              <div className="flex flex-col gap-2 sm:flex-row">
                <div className="relative flex-1">
                  <Search className={`absolute top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground ${dir === "rtl" ? "right-3" : "left-3"}`} />
                  <Input
                    value={search}
                    onChange={event => onSearch(event.target.value)}
                    className={dir === "rtl" ? "pr-9" : "pl-9"}
                    placeholder={t.workflow.pmv2.identitySearchPlaceholder}
                    autoFocus
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onSearch(originalName)}
                  disabled={!originalName}
                >
                  {t.workflow.pmv2.useTechnicianDescription}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">{t.workflow.pmv2.identitySearchIndependent}</p>
            </div>}

            {loading ? (
              <div className="flex items-center justify-center gap-2 rounded-md border py-8 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t.workflow.pmv2.searchingCatalogBalances}
              </div>
            ) : error ? (
              <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {localizeApiError(error.message)}
              </div>
            ) : items.length === 0 ? (
              <div className="rounded-md border p-4 text-center text-sm text-muted-foreground">
                {t.workflow.pmv2.identityNoMatch}
              </div>
            ) : (
              <div className="max-h-[42vh] space-y-2 overflow-y-auto rounded-md border p-2">
                {items.map(candidate => {
                  const selected = Number(selectedId) === Number(candidate.id);
                  const teamAvailability = candidate.teamAvailability;
                  const mainAvailability = candidate.mainWarehouseAvailability;
                  return (
                    <button
                      key={candidate.id}
                      type="button"
                      className={`w-full rounded-md border p-3 text-start transition ${selected ? "border-primary bg-primary/5" : "hover:bg-muted/50"}`}
                      onClick={() => onSelect(Number(candidate.id))}
                      disabled={busy || (lockCatalogSelection && !selected)}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold">{localizedName(candidate)}</span>
                            {selected && <Check className="h-4 w-4 text-primary" />}
                          </div>
                          {candidate.nameEn && candidate.nameEn !== candidate.nameAr && (
                            <p className="mt-0.5 text-xs text-muted-foreground">{candidate.nameEn}</p>
                          )}
                          {candidate.measurementStatus === "compatible" && <p className="mt-1 text-xs text-emerald-700">
                            {l("المقاس متوافق مع البحث", "Measurement matches the search", "پیمائش تلاش سے مطابقت رکھتی ہے")}
                          </p>}
                          {candidate.measurementStatus === "conflict" && <p className="mt-1 text-xs font-semibold text-amber-800">
                            {l("تنبيه: المقاس يختلف عن البحث؛ راجع الصنف قبل الربط", "Different measurement: review the item before linking", "پیمائش مختلف ہے؛ ربط سے پہلے تصدیق کریں")}
                          </p>}
                          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                            <span><span className="text-muted-foreground">{t.workflow.pmv2.codeLabel}:</span> {candidate.code || "—"}</span>
                            <span><span className="text-muted-foreground">{t.workflow.pmv2.unitLabelWh}:</span> {candidate.unit || teamAvailability?.unit || mainAvailability?.unit || "—"}</span>
                            <span><span className="text-muted-foreground">{t.workflow.pmv2.teamStoreWh}:</span> {teamAvailability?.ambiguous ? t.workflow.pmv2.needsReview : qty(teamAvailability?.availableQuantity ?? 0, teamAvailability?.unit || candidate.unit)}</span>
                            <span><span className="text-muted-foreground">{t.workflow.pmv2.mainWarehouseShort}:</span> {mainAvailability?.ambiguous ? t.workflow.pmv2.needsReview : qty(mainAvailability?.availableQuantity ?? 0, mainAvailability?.unit || candidate.unit)}</span>
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {selectedItem && (
              <div className="rounded-md border border-blue-200 bg-blue-50/60 p-3 text-sm text-blue-900">
                {fmt(t.workflow.pmv2.selectedIdentityPreview, {
                  original: originalName || "—",
                  item: `${localizedName(selectedItem)}${selectedItem.code ? ` — ${selectedItem.code}` : ""}`,
                })}
                {quantityApproval && <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className="space-y-1">
                    <span>{l("وحدة الكتالوج المعتمدة", "Catalog unit", "کیٹلاگ کی منظور شدہ اکائی")}</span>
                    <Input aria-label={l("وحدة الكتالوج المعتمدة", "Catalog unit", "کیٹلاگ کی منظور شدہ اکائی")} value={selectedItem.unit || ""} readOnly />
                  </label>
                  <label className="space-y-1">
                    <span>{l("الكمية المعتمدة بوحدة الكتالوج", "Approved quantity in catalog units", "کیٹلاگ کی اکائی میں منظور شدہ مقدار")}</span>
                    <Input aria-label={l("الكمية المعتمدة بوحدة الكتالوج", "Approved quantity in catalog units", "کیٹلاگ کی اکائی میں منظور شدہ مقدار")} type="number" min={quantityApproval.step ?? 1} step={quantityApproval.step ?? 1} value={quantityApproval.value} disabled={busy} onChange={event => quantityApproval.onChange(event.target.value)} aria-invalid={!validApproval} />
                  </label>
                  <p className="text-xs sm:col-span-2">{l("يعتمد المستودع الكمية بهذه الوحدة؛ لا يُطبّق تحويل تلقائي على كمية الفني.", "The warehouse approves this quantity in the displayed unit; the technician quantity is not converted automatically.", "گودام دکھائی گئی اکائی میں مقدار منظور کرتا ہے؛ فنی کی مقدار خودکار طور پر تبدیل نہیں ہوتی۔")}</p>
                  {!selectedItem.unit?.trim() && <p role="alert" className="text-destructive sm:col-span-2">{l("وحدة الصنف غير محددة في الكتالوج؛ أكمل تعريف الوحدة من دليل المواد ثم أعد المحاولة.", "The catalog item has no unit. Define its unit in the materials catalog, then try again.", "کیٹلاگ میں صنف کی اکائی متعین نہیں۔ مواد کے کیٹلاگ میں اکائی درج کرکے دوبارہ کوشش کریں۔")}</p>}
                  {quantityApproval.value.trim() !== "" && quantityError && <p role="alert" className="text-destructive sm:col-span-2">{quantityError}</p>}
                </div>}
                {!quantityApproval && allowDifferentUnits && unit && selectedItem.unit && unit !== selectedItem.unit && <p className="mt-2">
                  {l(`وحدة الاحتياج: ${unit}؛ وحدة الكتالوج: ${selectedItem.unit}. يمكن تأكيد الربط، وتبقى الكمية ووحدة الاحتياج كما أدخلها الفني دون تحويل تلقائي.`,
                    `Requested unit: ${unit}; catalog unit: ${selectedItem.unit}. Linking keeps the requested quantity and unit unchanged; no automatic conversion.`,
                    `درخواست کی اکائی: ${unit}؛ کیٹلاگ کی اکائی: ${selectedItem.unit}۔ ربط کے بعد مقدار اور اکائی تبدیل نہیں ہوگی۔`)}
                </p>}
              </div>
            )}
          </div>

          <DialogFooter className="sm:justify-between">
            <Button type="button" variant="outline" onClick={onOpenCatalog} disabled={busy}>
              {t.workflow.pmv2.openCatalog}
            </Button>
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
                disabled={busy}
              >
                {t.workflow.pmv2.cancel}
              </Button>
              <Button
                type="button"
                disabled={!selectedId || busy || !validApproval}
                onClick={onConfirm}
              >
                {busy ? <Loader2 className={dir === "rtl" ? "ml-2 h-4 w-4 animate-spin" : "mr-2 h-4 w-4 animate-spin"} /> : <Link2 className={dir === "rtl" ? "ml-2 h-4 w-4" : "mr-2 h-4 w-4"} />}
                {quantityApproval ? l("تأكيد الربط واعتماد الكمية", "Confirm link and approve quantity", "ربط کی تصدیق اور مقدار منظور کریں") : t.workflow.pmv2.confirmIdentity}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
  );
}
