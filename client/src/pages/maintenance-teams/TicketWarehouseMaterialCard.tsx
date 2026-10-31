import { useState, type ReactNode } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import ar from "@/i18n/ar";
import en from "@/i18n/en";
import ur from "@/i18n/ur";
import {
  Package,
  PackageCheck,
  ShoppingCart,
  ArrowLeftRight,
  RotateCcw,
} from "lucide-react";
import {
  issued,
  remainingReturn,
  type Snapshot,
  type MaterialNeed,
} from "@shared/maintenance-team-tickets/model";
import { materialSupplyRemaining, materialUnitMismatch } from "@shared/maintenance-team-tickets/material-routing";
import type { AssignedTeamTicket } from "@shared/maintenance-team-tickets/assignment";

/** Presentation only. All operations and authorization remain in ExecutionPanel. */
export function TicketWarehouseMaterialCard({
  state,
  need,
  balance,
  balanceError,
  ticket,
  language,
  warehouse,
  quantityFields,
  onReviewIdentity,
  children,
}: {
  state: Snapshot;
  need: MaterialNeed;
  balance?: { branch: number; main: number };
  balanceError?: string;
  ticket?: AssignedTeamTicket;
  language: string;
  warehouse: boolean;
  quantityFields: ReactNode;
  onReviewIdentity?: () => void;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(true);
  const l = (ar: string, en: string, ur: string) =>
    language === "ar" ? ar : language === "ur" ? ur : en;
  const pmv2 = (language === "ar" ? ar : language === "ur" ? ur : en).workflow
    .pmv2;
  const received = issued(state, need.id),
    returns = remainingReturn(state, need.id);
  const actualLinks = state.deliveries.filter(d => d.needId === need.id);
  const physicalReturns = actualLinks.some(d => d.replacementPlanId != null) && actualLinks.every(d => d.used !== null);
  const physicalReturnText = actualLinks.filter(d => d.used !== null && d.quantity > d.used! + d.returned)
    .map(d => `${d.quantity - d.used! - d.returned} ${d.physicalUnit ?? need.unit} — ${d.deliveryNumber}`).join(" · ");
  if (received === 0 && materialUnitMismatch(state, need)) return <div className="space-y-2 rounded-lg border border-amber-200 p-3 text-sm">
    <p className="font-semibold">{need.name}</p>
    <p>{l("المطلوب", "Requested", "درخواست")}: {need.requested} {need.unit}</p>
    <p>{l("وحدة الكتالوج", "Catalog unit", "کیٹلاگ اکائی")}: {state.catalog.find(item => item.id === need.catalogItemId)?.unit}</p>
    <p role="status" className="text-amber-800">{l(
      "تم ربط الصنف. راجع وحدة وكمية الاحتياج قبل الصرف أو التوفير؛ لم تُحوّل الكمية تلقائيًا.",
      "Item linked. Review the requested unit and quantity before issue or supply; no automatic conversion was made.",
      "صنف منسلک ہوگیا۔ اجرا یا فراہمی سے پہلے اکائی اور مقدار کا جائزہ لیں؛ خودکار تبدیلی نہیں ہوئی۔")}</p>
    {onReviewIdentity && <Button type="button" onClick={onReviewIdentity}>{l("مراجعة واعتماد الكمية بوحدة الكتالوج", "Review and approve quantity in catalog units", "کیٹلاگ کی اکائی میں مقدار کا جائزہ اور منظوری")}</Button>}
  </div>;
  if (!warehouse)
    return (
      <div className="space-y-3 rounded-lg border p-3">
        <p className="font-medium">
          {need.name} — {need.unit}
        </p>
        <p>
          {l("المطلوب", "Requested", "درخواست")}: {need.requested} /{" "}
          {l("المستلم", "Received", "وصول")}: {received} /{" "}
          {l("المستخدم", "Used", "استعمال")}: {need.used ?? "—"} /{" "}
          {l("المرتجع المعلق", "Pending return", "واپسی باقی")}: {physicalReturns ? physicalReturnText : returns}
        </p>
        {quantityFields}
        {balance && (
          <p className="text-muted-foreground">
            {l(
              "رصيد الفريق / الرئيسي",
              "Team / main stock",
              "ٹیم / مرکزی اسٹاک"
            )}
            : {balance.branch} / {balance.main}
          </p>
        )}
        {children}
      </div>
    );
  const a = state.assignments.find(a => a.id === need.assignmentId)!;
  const left = Math.max(0, need.requested - received);
  const pending = state.supplies
    .filter(s => s.needId === need.id && s.status === "pending")
    .reduce((sum, s) => sum + s.quantity, 0);
  const shortage = balance
    ? Math.max(
        0,
        left - balance.branch,
        materialSupplyRemaining(state, need) ?? 0
      )
    : null;
  const purchase =
    shortage == null ? null : Math.max(0, shortage - balance!.main - pending);
  const ready =
    need.catalogItemId != null &&
    !balanceError &&
    balance &&
    left > 0 &&
    balance.branch >= left &&
    (materialSupplyRemaining(state, need) ?? 0) === 0;
  const status =
    returns > 0
      ? l(
          "مرتجع بانتظار التأكيد",
          "Return pending confirmation",
          "واپسی کی تصدیق باقی"
        )
      : need.catalogItemId == null
        ? l("غير موجود في الدليل", "Not in catalog", "کیٹلاگ میں نہیں")
        : balanceError
          ? l(
              "تعذر التحقق من المخزون",
              "Stock verification failed",
              "اسٹاک کی تصدیق ناکام"
            )
          : !balance
            ? l(
                "جارٍ التحقق من المخزون",
                "Checking stock",
                "اسٹاک کی جانچ جاری"
              )
            : ready
              ? pmv2.readyForIssue
              : purchase! > 0
                ? l(
                    "يحتاج استكمال / شراء",
                    "Purchase required",
                    "خریداری درکار"
                  )
                : pending > 0
                  ? l(
                      "بانتظار استلام الشراء",
                      "Awaiting purchase receipt",
                      "خریداری کی وصولی کا انتظار"
                    )
                  : l(
                      "متوفر في المستودع الرئيسي",
                      "Available in main warehouse",
                      "مرکزی گودام میں دستیاب"
                    );
  const amount = (value: number | null | undefined) =>
    value == null ? "—" : `${value} ${need.unit}`;
  const box = (label: string, value: ReactNode) => (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-medium">{value}</p>
    </div>
  );
  return (
    <Card
      id={`ticket-material-${a.id}-${need.id}`}
      className={
        ready ? "overflow-hidden border-emerald-200" : "overflow-hidden"
      }
    >
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 border-b">
        <div className="space-y-1">
          <h3 className={ready ? "text-lg font-semibold" : "font-semibold"}>
            {need.name} — {need.unit}
          </h3>
          <p className="text-xs text-muted-foreground">
            <a
              className="text-primary hover:underline"
              href={`/tickets/${a.ticketId}`}
            >
              {a.ticketNumber}
            </a>{" "}
            · {l("احتياج", "Need", "ضرورت")} #{need.id} ·{" "}
            {ticket?.teamName ?? state.teams.find(t => t.id === a.teamId)?.name}
          </p>
        </div>
        <Badge
          variant="outline"
          className={
            ready ||
            (balance &&
              purchase === 0 &&
              pending === 0 &&
              need.catalogItemId != null &&
              !balanceError)
              ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200"
              : "border-amber-200 bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200"
          }
        >
          {status}
        </Badge>
      </CardHeader>
      <Button
        variant="ghost"
        className="w-full justify-end rounded-none bg-muted/30 text-primary"
        aria-expanded={expanded}
        onClick={() => setExpanded(x => !x)}
      >
        {expanded
          ? l("إخفاء التفاصيل", "Hide details", "تفصیلات چھپائیں")
          : l("عرض التفاصيل", "Show details", "تفصیلات دکھائیں")}
      </Button>
      {expanded && (
        <CardContent className={ready ? "space-y-4 pt-4" : "space-y-4 p-4"}>
          {balanceError && (
            <p role="alert" className="text-sm text-destructive">
              {balanceError}
            </p>
          )}
          {ready ? (
            <>
              <div className="rounded-lg border p-3">
                <p className="mb-3 text-sm font-semibold">
                  {pmv2.quantitiesLocation}
                </p>
                <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-5">
                  {box(pmv2.taskNeed, amount(need.requested))}
                  {box(pmv2.issuedForTaskWh, amount(received))}
                  {box(pmv2.willIssueNow, amount(left))}
                  {box(pmv2.availableTeamStoreWh, amount(balance?.branch))}
                  {box(
                    pmv2.locationAsset,
                    ticket
                      ? `${ticket.siteName} / ${ticket.sectionName}`
                      : `${a.location.siteId} / ${a.location.sectionId}`
                  )}
                </div>
              </div>
              <div className="rounded-md border bg-muted/30 p-3 text-sm">
                <p>
                  <span className="text-muted-foreground">
                    {pmv2.materialRequester}:
                  </span>{" "}
                  <strong>
                    {state.users.find(u => u.id === need.requestedById)?.name ??
                      "—"}
                  </strong>
                </p>
                <p className="mt-1">
                  <span className="text-muted-foreground">
                    {pmv2.teamLabel}:
                  </span>{" "}
                  {ticket?.teamName ??
                    state.teams.find(t => t.id === a.teamId)?.name ??
                    "—"}
                </p>
              </div>
            </>
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              <section className="space-y-3 rounded-lg border p-3">
                <h4 className="flex items-center gap-2 font-semibold">
                  <Package className="h-4 w-4" />
                  {l("الكميات", "Quantities", "مقداریں")}
                </h4>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  {box(
                    l("احتياج الفني", "Technician need", "ٹیکنیشن کی ضرورت"),
                    amount(need.requested)
                  )}
                  {box(
                    l(
                      "المصروف / المستلم",
                      "Issued / received",
                      "جاری / وصول شدہ"
                    ),
                    amount(received)
                  )}
                  {box(
                    l(
                      "المتبقي المطلوب استلامه",
                      "Remaining to receive",
                      "وصولی کی باقی مقدار"
                    ),
                    amount(left)
                  )}
                  {box(
                    l(
                      "النقص المطلوب تغطيته",
                      "Supply shortage",
                      "فراہمی کی کمی"
                    ),
                    amount(shortage)
                  )}
                  {returns > 0 && (
                    <>
                      {box(l("المستخدم", "Used", "استعمال"), amount(need.used))}
                      {box(
                        l("المرتجع المعلق", "Pending return", "واپسی باقی"),
                        physicalReturns ? physicalReturnText : amount(returns)
                      )}
                    </>
                  )}
                </div>
              </section>
              <section className="space-y-3 rounded-lg border p-3">
                <h4 className="flex items-center gap-2 font-semibold">
                  <ArrowLeftRight className="h-4 w-4" />
                  {l(
                    "المخزون والوجهة",
                    "Stock and destination",
                    "اسٹاک اور منزل"
                  )}
                </h4>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  {box(
                    l(
                      "المتاح في مخزن الفريق الآن",
                      "Available in team store now",
                      "ٹیم کے گودام میں دستیاب"
                    ),
                    amount(need.catalogItemId == null ? null : balance?.branch)
                  )}
                  {box(
                    l(
                      "المتاح في الرئيسي الآن",
                      "Available in main now",
                      "مرکزی گودام میں دستیاب"
                    ),
                    amount(need.catalogItemId == null ? null : balance?.main)
                  )}
                  {box(
                    l(
                      "مخزن الفريق المستهدف",
                      "Target team store",
                      "ٹیم کا مطلوبہ گودام"
                    ),
                    ticket?.warehouseName ??
                      state.warehouses.find(w => w.id === a.warehouseId)?.name
                  )}
                  {box(
                    l("الفريق", "Team", "ٹیم"),
                    ticket?.teamName ??
                      state.teams.find(t => t.id === a.teamId)?.name
                  )}
                </div>
              </section>
            </div>
          )}
          {quantityFields}
          <section className="space-y-3 rounded-lg border p-3">
            <h4 className="font-semibold">
              {l(
                "تفاصيل الطلب والحالة",
                "Request details and status",
                "درخواست کی تفصیل اور حالت"
              )}
            </h4>
            <div className="grid gap-3 text-sm sm:grid-cols-2">
              {box(
                l("التذكرة", "Ticket", "ٹکٹ"),
                ticket?.title ??
                  state.tickets.find(t => t.ticketId === a.ticketId)?.title
              )}
              {box(
                l("الموقع / القسم", "Site / section", "مقام / شعبہ"),
                ticket
                  ? `${ticket.siteName} / ${ticket.sectionName}`
                  : `${a.location.siteId} / ${a.location.sectionId}`
              )}
            </div>
            <p className="rounded-md bg-muted/40 p-3 text-sm">
              {status}
              {purchase != null && purchase > 0
                ? ` — ${l("عجز الشراء للتذكرة", "Ticket purchase shortage", "ٹکٹ کی خریداری کی کمی")}: ${amount(purchase)}`
                : shortage != null && shortage > 0 && pending === 0
                  ? ` — ${l("كمية التحويل إلى الفريق", "Transfer quantity to team", "ٹیم کو منتقلی کی مقدار")}: ${amount(shortage)}`
                  : ""}
            </p>
            {state.supplies
              .filter(s => s.needId === need.id)
              .map(s => (
                <p key={s.id} className="text-xs text-muted-foreground">
                  {s.kind === "purchase" ? (
                    <ShoppingCart className="me-1 inline h-3 w-3" />
                  ) : (
                    <ArrowLeftRight className="me-1 inline h-3 w-3" />
                  )}
                  {s.sourceNumber} · {s.quantity} {s.physicalUnit ?? need.unit}{s.replacementName ? ` — ${s.replacementName} (${amount(s.originalEquivalent)})` : ""} ·{" "}
                  {s.status === "received"
                    ? l("مستلم", "Received", "وصول شدہ")
                    : s.status === "cancelled"
                      ? l("ملغى", "Cancelled", "منسوخ")
                      : l(
                          "بانتظار الاستلام",
                          "Awaiting receipt",
                          "وصولی کا انتظار"
                        )}
                </p>
              ))}
          </section>
          <section className="space-y-3 rounded-lg border p-3">
            <h4 className="flex items-center gap-2 font-semibold">
              {returns > 0 ? (
                <RotateCcw className="h-4 w-4" />
              ) : (
                <PackageCheck className="h-4 w-4" />
              )}
              {l("الإجراء", "Action", "کارروائی")}
            </h4>
            {children}
          </section>
        </CardContent>
      )}
    </Card>
  );
}
