import { useTranslation } from "@/contexts/LanguageContext";
import { formatCatalogText, getCatalogError } from "@/i18n/catalogUi";
import { getCatalogItemsText } from "@/i18n/catalogItems";
import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Upload, Loader2, CheckCircle, XCircle, AlertTriangle } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

// ─── Types ────────────────────────────────────────────────────────────────────
interface ValidationIssue { type: string; message: string; }
interface PreviewResult {
  parsed:     { taxonomyNodes: any[]; items: any[] };
  validation: { valid: boolean; errors: ValidationIssue[]; warnings: ValidationIssue[] };
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function CatalogImportButton() {
  const { language } = useTranslation();
  const text = getCatalogItemsText(language);

  const fileInputRef              = useRef<HTMLInputElement>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [preview,    setPreview]    = useState<PreviewResult | null>(null);
  const [step,       setStep]       = useState<"idle" | "previewing" | "ready" | "committing">("idle");

  const previewMutation = trpc.catalog.importExport.importPreview.useMutation();
  const commitMutation  = trpc.catalog.importExport.importCommit.useMutation();

  // ── فتح نافذة اختيار الملف ────────────────────────────────────────────────
  const handleClickButton = () => {
    setPreview(null);
    setStep("idle");
    fileInputRef.current?.click();
  };

  // ── قراءة الملف وإرسال المعاينة ───────────────────────────────────────────
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // أعد تعيين الـ input حتى يشتغل onChange مجدداً لو نفس الملف
    e.target.value = "";

    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = (reader.result as string).split(",")[1];

      setStep("previewing");
      setDialogOpen(true);

      try {
        const result = await previewMutation.mutateAsync({ fileBase64: base64 });
        setPreview(result as PreviewResult);
        setStep("ready");
      } catch (err: any) {
        toast.error(getCatalogError(err, language, text.fileAnalysisFailed));
        setDialogOpen(false);
        setStep("idle");
      }
    };
    reader.readAsDataURL(file);
  };

  // ── تأكيد الاستيراد (الحفظ الفعلي) ──────────────────────────────────────
  const handleCommit = async () => {
    if (!preview) return;

    setStep("committing");
    try {
      const result = await commitMutation.mutateAsync({ parsed: preview.parsed });
      toast.success(
        formatCatalogText(text.importSuccess, { categories: result.taxonomyCount, items: result.itemsCount })
      );
      setDialogOpen(false);
      setStep("idle");
      setPreview(null);
    } catch (err: any) {
      toast.error(getCatalogError(err, language, text.importFailed));
      setStep("ready");
    }
  };

  const handleClose = () => {
    if (step === "committing") return;
    setDialogOpen(false);
    setStep("idle");
    setPreview(null);
  };

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <>
      {/* زر الاستيراد */}
      <Button variant="outline" onClick={handleClickButton}>
        <Upload className="w-4 h-4 ml-2" />
        {text.importExcel}
      </Button>

      {/* input مخفي */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* Dialog المعاينة والتأكيد */}
      <Dialog open={dialogOpen} onOpenChange={handleClose}>
        <DialogContent className="max-w-lg" dir={language === "en" ? "ltr" : "rtl"}>
          <DialogHeader>
            <DialogTitle>{text.importCatalog}</DialogTitle>
          </DialogHeader>

          {/* حالة التحميل */}
          {step === "previewing" && (
            <div className="flex flex-col items-center gap-3 py-8">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">{text.analyzingFile}</p>
            </div>
          )}

          {/* نتيجة المعاينة */}
          {step === "ready" && preview && (
            <div className="space-y-4">

              {/* ملخص الأرقام */}
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border p-3 text-center">
                  <p className="text-2xl font-bold text-primary">
                    {preview.parsed.taxonomyNodes.length}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">{text.importCategoryCount}</p>
                </div>
                <div className="rounded-lg border p-3 text-center">
                  <p className="text-2xl font-bold text-primary">
                    {preview.parsed.items.length}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">{text.item}</p>
                </div>
              </div>

              {/* الأخطاء */}
              {preview.validation.errors.length > 0 && (
                <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 space-y-1">
                  <div className="flex items-center gap-2 text-destructive text-sm font-medium mb-2">
                    <XCircle className="w-4 h-4" />
                    <span>{formatCatalogText(text.errorsCount, { count: preview.validation.errors.length })}</span>
                  </div>
                  {preview.validation.errors.slice(0, 5).map((e, i) => (
                    <p key={i} className="text-xs text-destructive">• {getCatalogError(e, language, text.validationError)}</p>
                  ))}
                  {preview.validation.errors.length > 5 && (
                    <p className="text-xs text-muted-foreground">
                      {formatCatalogText(text.additionalErrors, { count: preview.validation.errors.length - 5 })}
                    </p>
                  )}
                </div>
              )}

              {/* التحذيرات */}
              {preview.validation.warnings.length > 0 && (
                <div className="rounded-lg border border-yellow-300 bg-yellow-50 p-3 space-y-1">
                  <div className="flex items-center gap-2 text-yellow-700 text-sm font-medium mb-2">
                    <AlertTriangle className="w-4 h-4" />
                    <span>{formatCatalogText(text.warningsCount, { count: preview.validation.warnings.length })}</span>
                  </div>
                  {preview.validation.warnings.slice(0, 3).map((w, i) => (
                    <p key={i} className="text-xs text-yellow-700">• {getCatalogError(w, language, text.validationWarning)}</p>
                  ))}
                  {preview.validation.warnings.length > 3 && (
                    <p className="text-xs text-muted-foreground">
                      {formatCatalogText(text.additionalWarnings, { count: preview.validation.warnings.length - 3 })}
                    </p>
                  )}
                </div>
              )}

              {/* نجاح بدون أخطاء */}
              {preview.validation.valid && preview.validation.warnings.length === 0 && (
                <div className="flex items-center gap-2 text-green-600 text-sm">
                  <CheckCircle className="w-4 h-4" />
                  <span>{text.fileReady}</span>
                </div>
              )}

              {preview.validation.valid && preview.validation.warnings.length > 0 && (
                <div className="flex items-center gap-2 text-yellow-600 text-sm">
                  <AlertTriangle className="w-4 h-4" />
                  <span>{text.importWithWarnings}</span>
                </div>
              )}
            </div>
          )}

          {/* حالة الحفظ */}
          {step === "committing" && (
            <div className="flex flex-col items-center gap-3 py-8">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">{text.savingData}</p>
            </div>
          )}

          <DialogFooter className="gap-2 flex-row-reverse">
            <Button
              variant="ghost"
              onClick={handleClose}
              disabled={step === "committing"}
            >
              {text.cancel}
            </Button>

            {step === "ready" && preview?.validation.valid && (
              <Button onClick={handleCommit}>
                {text.confirmImport}
              </Button>
            )}

            {step === "ready" && !preview?.validation.valid && (
              <Button disabled variant="destructive">
                {text.importBlocked}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
