import { useEffect, useState, type ReactNode } from "react";
import { Clock, CheckCircle2, ArrowLeft } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  nextExecutionStep,
  type ExecutionStep,
} from "@shared/technician-workspace";
import { formatExecutionElapsedTime } from "@shared/executionElapsedTime";

export function ExecutionElapsedTime({
  startedAt,
  endedAt,
  language,
}: {
  startedAt?: string | Date | null;
  endedAt?: string | Date | null;
  language: string;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    setNow(Date.now());
    if (!startedAt || endedAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [startedAt, endedAt]);
  const value = formatExecutionElapsedTime(startedAt, endedAt, now);
  return (
    <span className="flex items-center gap-2 text-sm text-muted-foreground">
      <Clock className="h-4 w-4" />
      {language === "ar"
        ? "وقت الزيارة"
        : language === "ur"
          ? "دورے کا وقت"
          : "Visit time"}
      :{" "}
      <span className="font-mono" dir="ltr">
        {value}
      </span>
    </span>
  );
}

/** Presentation only: opening/closing the window never starts or ends a visit. */
export function TechnicianExecutionWindow({
  open,
  onClose,
  title,
  description,
  language,
  steps,
  currentId,
  onSelect,
  busy = false,
  footer,
  children,
  timer,
  sequential = true,
  presentation = "dialog",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description: string;
  language: string;
  steps: ExecutionStep[];
  currentId: number | null;
  onSelect: (id: number) => void;
  busy?: boolean;
  footer?: ReactNode;
  children: ReactNode;
  timer?: ReactNode;
  sequential?: boolean;
  presentation?: "dialog" | "page";
}) {
  const l = (a: string, e: string, u: string) =>
    language === "ar" ? a : language === "ur" ? u : e;
  const done = steps.filter(step => step.recorded).length;
  const next =
    currentId == null ? undefined : nextExecutionStep(steps, currentId);
  if (!sequential) return <>{children}</>;
  const contents = (
    <div className="space-y-3">
      {timer}
      <div className="flex justify-between text-sm">
        <span>
          {l(
            "إنجاز إجراءات الفني",
            "Technician action progress",
            "ٹیکنیشن کی کارروائی کی پیش رفت"
          )}
          : {done} / {steps.length}
        </span>
        <span>
          {steps.length ? Math.round((done / steps.length) * 100) : 0}%
        </span>
      </div>
      <Progress value={steps.length ? (done / steps.length) * 100 : 0} />
      {currentId != null && (
        <p className="text-sm text-muted-foreground">
          {l("البند", "Item", "آئٹم")}{" "}
          {steps.findIndex(step => step.id === currentId) + 1} / {steps.length}
        </p>
      )}
      {children}
      {next && (
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => onSelect(next.id)}
        >
          <ArrowLeft className="me-1 h-4 w-4" />
          {l(
            "متابعة البند التالي",
            "Continue to next item",
            "اگلے آئٹم پر جائیں"
          )}
        </Button>
      )}
      {!!steps.length && done === steps.length && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-5 text-center">
          <CheckCircle2 className="mx-auto mb-2 h-8 w-8 text-emerald-600" />
          {l(
            "اكتملت إجراءات الفني؛ تبقى المراجعة والإغلاق وفق المسار الحالي.",
            "Technician actions are recorded; review and closure follow the existing workflow.",
            "ٹیکنیشن کی کارروائی مکمل؛ جائزہ اور اختتام موجودہ طریقے کے مطابق۔"
          )}
        </div>
      )}
      {!!steps.length && (
        <details className="rounded-lg border p-3">
          <summary className="cursor-pointer text-sm font-medium">
            {l(
              "البنود المنجزة والمعلقة",
              "Recorded and pending items",
              "مکمل اور زیر التوا آئٹمز"
            )}
          </summary>
          <div className="mt-3 space-y-2">
            {steps.map(step => (
              <button
                type="button"
                key={step.id}
                disabled={busy || step.recorded}
                onClick={() => onSelect(step.id)}
                className="flex w-full items-center justify-between gap-2 rounded-lg border p-2 text-start text-sm disabled:opacity-70"
              >
                <span>{step.title}</span>
                <Badge variant={step.recorded ? "secondary" : "outline"}>
                  {step.status}
                </Badge>
              </button>
            ))}
          </div>
        </details>
      )}
      {footer}
      <Button variant="outline" disabled={busy} onClick={onClose}>
        {presentation === "page"
          ? l(
              "العودة إلى مهام الفريق",
              "Back to team tasks",
              "ٹیم کے کاموں پر واپس"
            )
          : l("إغلاق النافذة", "Close window", "ونڈو بند کریں")}
      </Button>
    </div>
  );
  if (presentation === "page")
    return (
      <section className="space-y-5" dir={language === "en" ? "ltr" : "rtl"}>
        <Button variant="outline" disabled={busy} onClick={onClose}>
          {l(
            "العودة إلى مهام الفريق",
            "Back to team tasks",
            "ٹیم کے کاموں پر واپس"
          )}
        </Button>
        <header>
          <h1 className="text-xl font-bold">{title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </header>
        {contents}
      </section>
    );
  return (
    <Dialog
      open={open}
      onOpenChange={value => {
        if (!value && !busy) onClose();
      }}
    >
      <DialogContent
        dir={language === "en" ? "ltr" : "rtl"}
        className="max-h-[90vh] overflow-y-auto sm:max-w-3xl"
        onEscapeKeyDown={event => {
          if (busy) event.preventDefault();
        }}
        onPointerDownOutside={event => {
          if (busy) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {contents}
      </DialogContent>
    </Dialog>
  );
}
