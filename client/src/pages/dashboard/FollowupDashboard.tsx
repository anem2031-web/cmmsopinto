import React, { Fragment, useEffect, useState } from "react";
import { keepPreviousData } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { useTranslation } from "@/contexts/LanguageContext";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ClipboardList, CheckCircle2, AlertTriangle, Package, ShoppingCart, DollarSign, Truck, Clock, RefreshCw, Maximize2, Minimize2, ArrowUpRight } from "lucide-react";
import { dashboardCopy, dashboardStageLabel } from "./copy";
import { dashboardPeriod, type DashboardFilters, type DashboardMetric, type DashboardRow, type DashboardManagerBucket } from "@shared/dashboard-overview";
import { ItemDetails as PurchaseItemJourney } from "../achievement/Achievement";

const DEFAULT_FILTERS: DashboardFilters = { period: "month", department: "all" };
const ROLE_REDIRECTS: Record<string, string> = {
  maintenance_manager: "/tickets", general_maintenance_manager: "/tickets", construction_procurement_manager: "/tickets?tab=construction",
  supervisor: "/tickets", technician: "/tickets", it_manager: "/tickets", it_member: "/tickets", operator: "/tickets",
  accountant: "/purchase-orders", warehouse: "/inventory", delegate: "/purchase-orders", procurement_officer: "/purchase-orders",
  senior_management: "/reports", executive_director: "/reports", gate_security: "/gate-security",
  food_warehouse_manager: "/purchase-orders", food_warehouse_assistant: "/purchase-orders",
};
const PRIMARY: { metric: DashboardMetric; icon: typeof Clock; color: string }[] = [
  { metric: "work_overdue", icon: AlertTriangle, color: "text-red-600 bg-red-500/10" },
  { metric: "work_triage", icon: ClipboardList, color: "text-blue-600 bg-blue-500/10" },
  { metric: "work_assignment", icon: Clock, color: "text-indigo-600 bg-indigo-500/10" },
  { metric: "work_start", icon: Clock, color: "text-amber-600 bg-amber-500/10" },
  { metric: "work_active", icon: ClipboardList, color: "text-teal-600 bg-teal-500/10" },
  { metric: "work_purchases", icon: ShoppingCart, color: "text-sky-600 bg-sky-500/10" },
  { metric: "completed_execution", icon: CheckCircle2, color: "text-emerald-600 bg-emerald-500/10" },
];
const descriptions: Record<string, Record<string, string>> = {
  ar: { work_overdue: "أعمال تجاوزت المدة أو الموعد المحدد لها.", work_triage: "بلاغات أُنشئت ولم ينتهِ فرزها وتصنيفها.", work_assignment: "جهات أو مهام تنتظر إعداد المهام أو إسناد فريق بعد الفرز.", work_start: "تذاكر أُسندت لفريق ولم يبدأ الفني تنفيذها.", work_active: "تذاكر بدأ الفني تنفيذها ولم يسجل نتيجتها بعد.", work_purchases: "أصناف مرتبطة ببلاغات وما زالت تحتاج متابعة.", completed_execution: "تذاكر تنفيذ أُغلقت خلال الفترة المختارة." },
  en: { work_overdue: "Work past its recorded deadline.", work_triage: "Reports not yet triaged.", work_assignment: "Tasks awaiting team assignment after triage.", work_start: "Assigned tickets not yet started.", work_active: "Started tickets awaiting a result.", work_purchases: "Active purchase items linked to reports.", completed_execution: "Execution tickets closed in the selected period." },
  ur: { work_overdue: "مقررہ مدت سے تاخیر شدہ کام۔", work_triage: "درجہ بندی کے منتظر بلاغات۔", work_assignment: "ٹیم تفویض کے منتظر کام۔", work_start: "تفویض شدہ ٹکٹ جو شروع نہیں ہوئے۔", work_active: "شروع شدہ کام جن کا نتیجہ درج نہیں۔", work_purchases: "بلاغات سے منسلک زیر نگرانی اشیاء۔", completed_execution: "منتخب مدت میں بند ٹکٹس۔" },
};

export default function FollowupDashboard() {
  const { user, authenticatedUser, loading } = useAuth();
  const { t, language } = useTranslation();
  const [, navigate] = useLocation();
  const copy = dashboardCopy(language);
  const locale = language === "en" ? "en-US" : language === "ur" ? "ur-PK" : "ar-SA";
  const allowed = user?.role === "admin" || user?.role === "owner";
  const [filters, setFilters] = useState<DashboardFilters>(DEFAULT_FILTERS);
  const [searchText, setSearchText] = useState("");
  const [monitor, setMonitor] = useState(false);
  const [selection, setSelection] = useState<{ metric: DashboardMetric; managerKey?: string; managerBucket?: DashboardManagerBucket } | null>(null);
  const [page, setPage] = useState(1);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  let validFilters = true;
  try { dashboardPeriod(filters, Date.now()); } catch { validFilters = false; }
  const overview = trpc.dashboard.overview.useQuery(filters, {
    enabled: !!allowed && validFilters,
    refetchInterval: 60_000,
    placeholderData: keepPreviousData,
    retry: 1,
  });
  const details = trpc.dashboard.details.useQuery({
    ...filters, metric: selection?.metric ?? "open_execution", page,
    managerKey: selection?.managerKey, managerBucket: selection?.managerBucket ?? "all",
    snapshotId: overview.data?.snapshotId,
  }, {
    enabled: !!allowed && validFilters && !!selection && !overview.isPlaceholderData && !overview.error,
    placeholderData: keepPreviousData, staleTime: 60_000, refetchOnWindowFocus: false, retry: 1,
  });

  useEffect(() => {
    if (!loading && user && !allowed) navigate(ROLE_REDIRECTS[user.role] ?? "/tickets");
  }, [loading, user, allowed, navigate]);
  useEffect(() => { setSelection(null); setPage(1); }, [filters]);

  if (!allowed) return null;
  const data = overview.data;
  const busy = overview.isLoading || overview.isPlaceholderData;
  const available = validFilters && !overview.error && !!data && !busy;
  const number = (value: number) => value.toLocaleString(locale, { maximumFractionDigits: 1 });
  const money = (value: number) => value.toLocaleString(locale, { style: "currency", currency: "SAR", minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const date = (value: number | null) => value == null ? copy.notRecorded : new Intl.DateTimeFormat(locale, { timeZone: "Asia/Riyadh", calendar: "gregory", dateStyle: "short", timeStyle: "short" }).format(new Date(value));
  const title = (row: DashboardRow) => language === "en" ? row.titleEn || row.title : language === "ur" ? row.titleUr || row.title : row.titleAr || row.title;
  const owner = (row: DashboardRow) => row.waitOwner === "purchase" ? copy.purchaseOwner : copy[row.waitOwner];
  const status = (row: DashboardRow) => row.workLabel || dashboardStageLabel(language, row.actionStage) || (row.kind === "purchase" ? (t.poItemStatus as Record<string, string> | undefined)?.[row.status] ?? row.status : (t.ticketStatus as Record<string, string> | undefined)?.[row.status] ?? row.status);
  const open = (metric: DashboardMetric, managerKey?: string, managerBucket?: DashboardManagerBucket) => { setPage(1); setExpandedKey(null); setSelection({ metric, managerKey, managerBucket }); };
  const refresh = () => { void overview.refetch(); if (selection) void details.refetch(); };
  const change = (next: Partial<DashboardFilters>) => setFilters(current => ({ ...current, ...next }));
  const link = (row: DashboardRow) => row.kind === "purchase" ? `/purchase-orders/${row.orderId}?itemId=${row.id}` : `/tickets/${row.id}`;
  const detailButton = (value: number, metric: DashboardMetric, managerKey: string, bucket: DashboardManagerBucket = "all") => value ? (
    <button type="button" data-observer-navigation="true" className="underline underline-offset-4 hover:text-primary font-medium" onClick={() => open(metric, managerKey, bucket)} aria-label={`${copy.details} ${copy[metric]} ${number(value)}`}>{number(value)}</button>
  ) : <span className="text-muted-foreground">0</span>;

  return <div className={monitor ? "fixed inset-0 z-40 bg-background overflow-auto p-4 md:p-8" : "space-y-6"} dir={language === "en" ? "ltr" : "rtl"}>
    <div className={monitor ? "max-w-7xl mx-auto space-y-6" : "space-y-6"}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t.dashboard.title}</h1>
          <p className="text-sm text-muted-foreground mt-1">{user?.name} — {(t.roles as Record<string, string>)[authenticatedUser?.role ?? user?.role ?? ""]} — {copy.followup}</p>
        </div>
        <div className="flex gap-2">
          <Button data-observer-navigation="true" variant="outline" size="sm" onClick={refresh} disabled={!validFilters || overview.isFetching}><RefreshCw className={`h-4 w-4 ${overview.isFetching ? "animate-spin" : ""}`} />{overview.isFetching ? copy.refreshing : copy.refresh}</Button>
          <Button data-observer-navigation="true" variant="outline" size="sm" onClick={() => setMonitor(!monitor)}>{monitor ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}{monitor ? copy.exitMonitor : copy.monitor}</Button>
        </div>
      </div>

      <Card className="py-0"><CardContent className="p-4 space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="space-y-1 text-xs"><span className="block text-muted-foreground">{copy.period}</span><select aria-label={copy.period} className="h-9 rounded-md border bg-background px-3 text-sm" value={filters.period} onChange={event => change({ period: event.target.value as DashboardFilters["period"] })}>
            <option value="month">{copy.month}</option><option value="year">{copy.year}</option><option value="all">{copy.allTime}</option><option value="custom">{copy.custom}</option>
          </select></label>
          {filters.period === "custom" && <><label className="space-y-1 text-xs"><span className="block text-muted-foreground">{copy.from}</span><Input aria-label={copy.from} type="date" value={filters.dateFrom ?? ""} onChange={event => change({ dateFrom: event.target.value })} /></label><label className="space-y-1 text-xs"><span className="block text-muted-foreground">{copy.to}</span><Input aria-label={copy.to} type="date" value={filters.dateTo ?? ""} onChange={event => change({ dateTo: event.target.value })} /></label></>}
          <label className="space-y-1 text-xs"><span className="block text-muted-foreground">{copy.site}</span><select aria-label={copy.site} className="h-9 max-w-64 rounded-md border bg-background px-3 text-sm" value={filters.siteId ?? "all"} onChange={event => change({ siteId: event.target.value === "all" ? undefined : Number(event.target.value) })}>
            <option value="all">{copy.all}</option>{data?.sites.map(site => <option key={site.id} value={site.id}>{site.name}</option>)}
          </select></label>
          <label className="space-y-1 text-xs"><span className="block text-muted-foreground">{copy.department}</span><select aria-label={copy.department} className="h-9 rounded-md border bg-background px-3 text-sm" value={filters.department} onChange={event => change({ department: event.target.value as DashboardFilters["department"] })}>
            {(["all", "general", "construction", "it", "unclassified"] as const).map(key => <option key={key} value={key}>{copy[key]}</option>)}
          </select></label>
          <label className="space-y-1 text-xs"><span className="block text-muted-foreground">{language === "ar" ? "المسؤول المسجل" : "Recorded responsible"}</span><select className="h-9 max-w-52 rounded-md border bg-background px-3 text-sm" value={filters.responsibleId ?? "all"} onChange={event => change({ responsibleId: event.target.value === "all" ? undefined : Number(event.target.value) })}><option value="all">{copy.all}</option>{data?.responsibles.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
          <label className="space-y-1 text-xs"><span className="block text-muted-foreground">{copy.status}</span><select className="h-9 rounded-md border bg-background px-3 text-sm" value={filters.workStatus ?? "all"} onChange={event => change({ workStatus: event.target.value as DashboardFilters["workStatus"] })}><option value="all">{copy.all}</option><option value="overdue">{language === "ar" ? "متأخر" : "Overdue"}</option><option value="open">{language === "ar" ? "مفتوح" : "Open"}</option><option value="completed">{language === "ar" ? "مغلق" : "Closed"}</option></select></label>
          <label className="space-y-1 text-xs"><span className="block text-muted-foreground">{language === "ar" ? "نوع العمل" : "Work type"}</span><select className="h-9 rounded-md border bg-background px-3 text-sm" value={filters.workType ?? "all"} onChange={event => change({ workType: event.target.value as DashboardFilters["workType"] })}><option value="all">{copy.all}</option><option value="reports">{language === "ar" ? "بلاغات ومهام" : "Reports and tasks"}</option><option value="purchases">{language === "ar" ? "مشتريات مرتبطة ببلاغات" : "Purchases linked to reports"}</option></select></label>
          <label className="space-y-1 text-xs"><span className="block text-muted-foreground">{language === "ar" ? "البحث" : "Search"}</span><Input maxLength={150} value={searchText} onChange={event => setSearchText(event.target.value)} onKeyDown={event => { if (event.key === "Enter") change({ search: searchText.trim() || undefined }); }} placeholder={language === "ar" ? "البلاغ أو الطلب أو الصنف" : "Report, order, or item"} /></label>
          <Button data-observer-navigation="true" variant="outline" size="sm" onClick={() => change({ search: searchText.trim() || undefined })}>{language === "ar" ? "بحث" : "Search"}</Button>
          <Button data-observer-navigation="true" variant="ghost" size="sm" onClick={() => { setSearchText(""); setFilters({ ...DEFAULT_FILTERS }); }}>{copy.reset}</Button>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">{language === "ar" ? "تذاكر الصيانة المغلقة حسب الفترة. الأعمال المفتوحة تشمل ما بدأ قبلها. الإغلاق يُحسب قبل تأكيد مقدم البلاغ." : copy.periodHint}</p>
        {available && <p className="text-xs text-muted-foreground">{copy.lastUpdated}: {date(data!.generatedAt)}</p>}
      </CardContent></Card>

      {!validFilters && <div role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">{copy.dateError}</div>}
      {overview.error && <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-destructive text-sm">{copy.loadError}</div>}
      {validFilters && !overview.error && <>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {PRIMARY.map(({ metric, icon: Icon, color }) => <button key={metric} type="button" data-observer-navigation="true" className="text-start rounded-xl focus-visible:outline-2 focus-visible:outline-primary" disabled={!available} onClick={() => open(metric)} aria-label={`${copy.details} ${copy[metric]}`}>
            <Card className="py-0 h-full hover:shadow-md transition-shadow"><CardContent className="p-5">
              <div className="flex justify-between items-start gap-2 mb-3"><span className="text-xs font-medium text-muted-foreground">{copy[metric]}</span><span className={`rounded-xl p-2 ${color}`}><Icon className="h-4 w-4" /></span></div>
              {!available ? <Skeleton className="h-9 w-24" /> : <p className="text-2xl font-bold tabular-nums">{number(data!.counts[metric])}</p>}
              <p className="text-xs text-muted-foreground mt-2">{(descriptions[language] ?? descriptions.ar)[metric]}</p>
            </CardContent></Card>
          </button>)}
        </div>
        <div className="space-y-2"><p className="text-sm font-medium">{language === "ar" ? "المراحل التالية للبلاغات" : language === "ur" ? "بلاغات کے اگلے مراحل" : "Next report stages"}</p><div className="flex flex-wrap gap-2">{(["waiting_material", "work_blocked", "work_external", "work_review"] as DashboardMetric[]).map(metric => <Button key={metric} data-observer-navigation="true" size="sm" variant="outline" disabled={!available} onClick={() => open(metric)}>{copy[metric]} <Badge variant="secondary">{available ? number(data!.counts[metric]) : "…"}</Badge></Button>)}</div></div>
        {available && data!.missingClosedDates > 0 && <p className="text-xs text-amber-700">{number(data!.missingClosedDates)} {copy.missingClosedDates}</p>}
        <p className="text-xs text-muted-foreground">{language === "ar" ? "البلاغات والمهام والأصناف وحدات مختلفة؛ قد يظهر العمل في بطاقة مرحلته وبطاقة التأخير. الأوقات غير المسجلة لا تُخمّن." : language === "ur" ? "بلاغات، کام اور اشیاء الگ اکائیاں ہیں؛ نامعلوم اوقات فرض نہیں کیے جاتے۔" : "Reports, tasks and items are different units; a work item may also appear as overdue. Missing times are not inferred."}</p>
      </>}
    </div>

    <Dialog open={!!selection} onOpenChange={value => { if (!value) setSelection(null); }}><DialogContent showCloseButton={false} className="w-[calc(100vw-2rem)] max-w-none sm:max-w-[calc(100vw-2rem)] xl:max-w-7xl max-h-[90vh] overflow-hidden p-0 gap-0 flex flex-col" dir={language === "en" ? "ltr" : "rtl"}>
      <div className="flex items-center justify-between gap-4 border-b px-4 py-3 md:px-6 shrink-0">
        <DialogHeader className="text-start sm:text-start"><DialogTitle>{selection ? copy[selection.metric] : copy.details}</DialogTitle></DialogHeader>
        <div className="flex items-center gap-2 shrink-0">
          <Button data-observer-navigation="true" variant="outline" size="sm" disabled={!validFilters || overview.isFetching} onClick={refresh}><RefreshCw className={`h-4 w-4 ${overview.isFetching ? "animate-spin" : ""}`} />{copy.refresh}</Button>
          <Button data-observer-navigation="true" variant="outline" size="sm" onClick={() => setSelection(null)}>{copy.close}</Button>
        </div>
      </div>
      <div className="min-h-0 min-w-0 flex-1 overflow-auto p-4 md:p-6 space-y-4">
      {details.error ? <div role="alert" className="space-y-3"><p className="text-destructive text-sm">{copy.loadError}</p><Button data-observer-navigation="true" variant="outline" size="sm" onClick={() => void details.refetch()}>{copy.refresh}</Button></div> : details.isLoading || details.isPlaceholderData || !details.data ? <div role="status" aria-live="polite" className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><RefreshCw className="h-4 w-4 animate-spin" />{copy.loading}</div> : <>
        <div className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground"><span>{number(details.data.total)} {selection?.metric === "work_overdue" ? (language === "ar" ? "سجل" : "records") : selection?.metric === "work_purchases" || selection?.metric.startsWith("purchase_") || selection?.metric === "received_value" ? copy.item : copy.ticket}</span><span>{copy.lastUpdated}: {date(details.data.generatedAt)}</span></div>
        {selection?.metric === "received_value" && <div className="rounded-md bg-muted p-3 text-sm"><strong>{money(details.data.receivedValue)}</strong><p className="text-xs text-muted-foreground mt-1">{copy.costHint}</p>{details.data.missingCosts > 0 && <p className="text-xs text-amber-700 mt-1">{number(details.data.missingCosts)} {copy.missingCosts}</p>}</div>}
        <p className="text-xs text-muted-foreground lg:hidden">{copy.scrollColumns}</p>
        <div className="overflow-x-auto"><table className="w-full min-w-[56rem] text-sm">
          <thead><tr className="border-b text-muted-foreground">{[copy.number, copy.title, copy.site, copy.status, selection?.metric === "received_value" ? copy.amount : copy.owner, copy.date, copy.details].map((text, index) => <th key={index} className="text-start p-2 font-medium whitespace-nowrap">{text}</th>)}</tr></thead>
          <tbody>{details.data.rows.map(row => <Fragment key={row.key}><tr className="border-b last:border-0">
            <td className="p-2 align-top whitespace-nowrap font-mono"><a href={link(row)} data-observer-navigation="true" className="text-primary underline underline-offset-4 hover:no-underline" onClick={event => { if (event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) { event.preventDefault(); setSelection(null); navigate(link(row)); } }}>{row.number}</a>{row.kind === "purchase" && <span className="block text-muted-foreground">#{row.id}</span>}</td>
            <td className="p-2 align-top min-w-40 max-w-72 whitespace-normal break-words"><p>{title(row) || copy.notRecorded}</p>{row.linkedTicketNumber && <p className="text-muted-foreground mt-1">{language === "ar" ? "البلاغ" : copy.ticket}: {row.linkedTicketNumber}</p>}{row.kind === "ticket" && <p className="text-muted-foreground mt-1">{language === "ar" ? "عمر البلاغ" : "Report age"}: {row.reportAgeHours == null ? copy.notRecorded : `${number(row.reportAgeHours)} ${language === "ar" ? "ساعة" : "hours"}`}</p>}{row.quantity != null && <p className="text-muted-foreground mt-1">{copy.quantity}: {number(row.quantity)} {row.unit}</p>}{row.childTotal != null && <p className="text-muted-foreground mt-1">{copy.childProgress}: {row.childCompleted}/{row.childTotal}</p>}</td>
            <td className="p-2 align-top min-w-28 max-w-48 whitespace-normal break-words">{row.siteName || copy.notRecorded}</td><td className="p-2 align-top min-w-32"><p>{status(row)}</p>{row.note && <p className="text-muted-foreground mt-1 whitespace-pre-wrap">{row.note}</p>}{row.overdue && <p className="text-destructive font-semibold mt-1">{language === "ar" ? "تجاوز الموعد" : "Overdue"}{row.deadlineAt != null ? ` · ${number((data!.generatedAt - row.deadlineAt) / 3600000)} ${language === "ar" ? "ساعة" : "hours"}` : ""}</p>}{row.requiredDate ? <p className="text-muted-foreground mt-1">{language === "ar" ? "تاريخ الاحتياج" : "Required date"}: {row.requiredDate}</p> : row.deadlineAt != null ? <p className="text-muted-foreground mt-1">{language === "ar" ? "الموعد" : "Deadline"}: {date(row.deadlineAt)}</p> : ["work:await_start", "work:working"].includes(row.actionStage ?? "") && <p className="text-muted-foreground mt-1">{language === "ar" ? "موعد الفحص: غير مسجل" : "Inspection deadline not recorded"}</p>}</td>
            <td className="p-2 min-w-40">{selection?.metric === "received_value" ? row.amount == null ? copy.notRecorded : money(row.amount) : <><p>{owner(row)}</p>{row.actorNames.length > 0 && <p className="text-muted-foreground mt-1">{row.actorNames.join("، ")}</p>}{row.waitOwner !== "finished" && <p className="text-muted-foreground mt-1">{copy.waitHours}: {row.waitHours == null ? copy.notRecorded : number(row.waitHours)}</p>}</>}</td>
            <td className="p-2 whitespace-nowrap">{date(row.date)}</td><td className="p-2"><Button data-observer-navigation="true" variant="outline" size="sm" onClick={() => setExpandedKey(expandedKey === row.key ? null : row.key)}>{language === "ar" ? "عرض الرحلة" : copy.details}</Button><Button data-observer-navigation="true" variant="ghost" size="sm" onClick={() => navigate(link(row))} aria-label={`${copy.openDocument} ${row.number}`}><ArrowUpRight className="h-4 w-4" />{copy.openDocument}</Button></td>
          </tr>{expandedKey === row.key && <tr><td colSpan={7} className="p-3 bg-muted/20">{row.kind === "purchase" ? <PurchaseItemJourney id={row.id} now={data!.generatedAt} /> : row.journey?.length ? <div className="space-y-2">{row.inspectionOutcomeAt != null && row.deadlineAt != null && <p className="text-xs">{language === "ar" ? "نتيجة الفحص سُجلت" : "Inspection result recorded"}: {date(row.inspectionOutcomeAt)} · {row.inspectionOutcomeAt > row.deadlineAt ? `${language === "ar" ? "بعد الموعد المحدد بـ" : "After deadline by"} ${number((row.inspectionOutcomeAt - row.deadlineAt) / 3600000)} ${language === "ar" ? "ساعة" : "hours"}` : (language === "ar" ? "ضمن الموعد المحدد" : "Within deadline")}</p>}{row.journey.map((event, index) => {
            const previous = index ? row.journey![index - 1].at : null;
            const elapsed = event.at != null && previous != null && event.at >= previous ? (event.at - previous) / 3600000 : null;
            return <div key={`${event.label}:${index}`} className="rounded border bg-background p-2 text-xs"><strong>{event.label}</strong><p className="mt-1">{date(event.at)} · {event.actor || copy.notRecorded}{elapsed != null ? ` · ${number(elapsed)} ${language === "ar" ? "ساعة منذ المرحلة السابقة" : "hours since previous stage"}` : ""}</p>{event.note && <p className="mt-1 whitespace-pre-wrap">{event.note}</p>}</div>;
          })}</div> : <p className="text-sm text-muted-foreground">{language === "ar" ? "لم تُسجل تفاصيل مراحل كافية لهذا البلاغ." : copy.notRecorded}</p>}</td></tr>}</Fragment>)}</tbody>
        </table>{!details.data.rows.length && <p className="p-6 text-center text-muted-foreground">{copy.noData}</p>}</div>
        <div className="flex justify-between items-center gap-2"><Button data-observer-navigation="true" variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>{copy.previous}</Button><span className="text-xs text-muted-foreground">{number(page)} / {number(Math.max(1, Math.ceil(details.data.total / details.data.pageSize)))}</span><Button data-observer-navigation="true" variant="outline" size="sm" disabled={page * details.data.pageSize >= details.data.total} onClick={() => setPage(value => value + 1)}>{copy.next}</Button></div>
      </>}
      </div>
    </DialogContent></Dialog>
  </div>;
}
