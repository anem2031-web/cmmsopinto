import React, { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Search } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { achievementDuration, achievementElapsed, achievementEventTitle, achievementMillis, achievementStatus, type AchievementItem } from "@shared/achievement";

function dateText(value: unknown): string {
  const ms = achievementMillis(value);
  return ms == null ? "غير مسجل" : new Intl.DateTimeFormat("ar-SA-u-ca-gregory", {
    timeZone: "Asia/Riyadh", dateStyle: "medium", timeStyle: "short",
  }).format(new Date(ms));
}

function Summary({ item, now }: { item: AchievementItem; now: number }) {
  const status = achievementStatus(item);
  const age = achievementElapsed(item.submittedAt, now);
  const waiting = achievementElapsed(status.since, now);
  return <>
    <div className="grid gap-2 text-sm sm:grid-cols-2 xl:grid-cols-4">
      <div><span className="text-muted-foreground">طلب الشراء: </span><strong dir="ltr">{item.poNumber}</strong></div>
      <div><span className="text-muted-foreground">البلاغ المرتبط: </span><strong dir="ltr">{item.ticketNumbers.join("، ") || "غير مسجل"}</strong></div>
      <div><span className="text-muted-foreground">الكمية: </span><strong>{item.quantity} {item.unit || ""}</strong></div>
      <div><span className="text-muted-foreground">منذ إرسال الطلب: </span><strong>{achievementDuration(age)}</strong></div>
    </div>
    <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
      <strong>الحالة الآن: </strong>{status.text}{waiting != null && !["delivered_to_requester"].includes(item.status) ? ` منذ ${achievementDuration(waiting)}` : ""}{waiting == null && ["pending_review", "pending"].includes(item.status) ? " (وقت بداية المرحلة غير مسجل)" : ""}
    </div>
  </>;
}

type Event = { id: string; date: unknown; title: string; actorName?: string | null; note?: string | null; newDelegateName?: string | null; previousDelegateName?: string | null; eventType?: string };
function buildEvents(data: any): Event[] {
  const { item } = data;
  const events: Event[] = [];
  if (item.submittedAt) events.push({ id: "submitted", date: item.submittedAt, title: "أُرسل طلب الشراء للمراجعة", actorName: item.requesterName });
  const real = data.events.filter((event: any) => achievementEventTitle(event));
  if (item.effectiveReviewedAt && !real.some((event: any) => event.eventType === "review_decision")) {
    events.push({ id: "review", date: item.effectiveReviewedAt, title: "تمت مراجعة الصنف", actorName: item.reviewerName });
  }
  if (item.delegateAssignedAt && !real.some((event: any) => event.eventType === "delegate_changed")) {
    events.push({ id: "assigned", date: item.delegateAssignedAt, title: "أُسند الصنف للمندوب", newDelegateName: item.delegateName });
  }
  for (const event of real) events.push({ ...event, title: achievementEventTitle(event)!, date: event.date });
  for (const issue of item.issues) events.push({ id: `issue:${issue.id}`, date: issue.date,
    title: `سُجّل صرف ${issue.quantity} للبلاغ ${issue.ticketNumber}`,
    actorName: issue.actorName, note: `المستلم: ${issue.recipientName || "غير مسجل"} · سند الصرف: ${issue.documentNumber || "غير مسجل"}` });
  const submitted = achievementMillis(item.submittedAt);
  return events.filter(event => {
    const date = achievementMillis(event.date);
    return date != null && (submitted == null || date >= submitted);
  }).sort((a, b) => (achievementMillis(a.date) ?? 0) - (achievementMillis(b.date) ?? 0));
}

export function ItemDetails({ id, now }: { id: number; now: number }) {
  const detail = trpc.achievement.purchaseItem.useQuery({ id });
  const events = useMemo(() => detail.data ? buildEvents(detail.data) : [], [detail.data]);
  if (detail.isLoading) return <p className="p-3 text-sm">جاري تحميل رحلة الصنف...</p>;
  if (detail.error || !detail.data) return <p role="alert" className="p-3 text-sm text-destructive">تعذر تحميل رحلة الصنف. حاول مرة أخرى.</p>;
  const item = detail.data.item as AchievementItem;
  const reason = achievementStatus(item).reason;
  return <div className="mt-4 rounded-xl bg-muted/30 p-4">
    <h3 className="font-semibold">حياة الصنف</h3>
    {!item.submittedAt && <p className="mt-2 text-sm text-amber-700">وقت إرسال الطلب غير مسجل؛ لا يمكن حساب العمر الكامل.</p>}
    <div className="mt-3 space-y-3 border-s-2 border-primary/30 ps-4">
      {events.length ? events.map((event, index) => {
        const previous = index ? events[index - 1] : null;
        const duration = previous ? achievementElapsed(previous.date, event.date) : null;
        return <div key={event.id} className="rounded-lg border bg-background p-3 text-sm">
          <div className="font-medium">{index + 1}. {event.title}</div>
          <p className="mt-1 text-muted-foreground">{dateText(event.date)} · نفّذ الإجراء: {event.actorName || "غير مسجل"}</p>
          {event.newDelegateName && <p>أُسند إلى: {event.newDelegateName}{event.previousDelegateName ? ` (السابق: ${event.previousDelegateName})` : ""}</p>}
          {duration != null && <p>المدة منذ الخطوة السابقة: {achievementDuration(duration)}</p>}
          {event.note && <p className="mt-1 break-words">{event.note}</p>}
        </div>;
      }) : <p className="text-sm">لا توجد أحداث بتاريخ مسجل.</p>}
    </div>
    <p className="mt-3 text-sm">السبب المسجل للحالة الحالية: {reason || "لم يُسجّل سبب"}</p>
    {item.ticketNumbers.length > 0 && !item.issues.length && <p className="mt-2 text-sm text-muted-foreground">لم يُعثر على صرف مرتبط مباشرة بلوت هذا الصنف في السجلات المفحوصة؛ راجع مستندات الصرف قبل الجزم.</p>}
    {!item.ticketEvidenceAvailable && <p className="mt-2 text-sm text-muted-foreground">لا تتوفر بيانات ربط صرف البلاغ في هذا النظام.</p>}
  </div>;
}

export default function Achievement() {
  const [search, setSearch] = useState("");
  const [term, setTerm] = useState("");
  const [cursors, setCursors] = useState<Array<number | undefined>>([undefined]);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 60_000); return () => window.clearInterval(timer); }, []);
  const result = trpc.achievement.purchaseItems.useQuery({ search: term, beforeId: cursors[page] });
  const items = (result.data?.items || []) as AchievementItem[];
  const searchNow = (event: React.FormEvent) => { event.preventDefault(); setTerm(search.trim()); setCursors([undefined]); setPage(0); setSelected(null); };
  return <main dir="rtl" className="mx-auto max-w-6xl space-y-5 p-1 sm:p-3">
    <div><h1 className="text-2xl font-bold">وحدة الإنجاز</h1><p className="mt-1 text-sm text-muted-foreground">تابع حياة كل صنف منذ إرسال طلب الشراء.</p></div>
    <div className="inline-flex rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">طلبات الشراء</div>
    <form onSubmit={searchNow} className="flex max-w-2xl gap-2"><Input aria-label="البحث" value={search} onChange={event => setSearch(event.target.value)} placeholder="ابحث باسم الصنف أو رقم طلب الشراء أو البلاغ المرتبط بالطلب" /><Button type="submit"><Search className="h-4 w-4" /> بحث</Button></form>
    <p className="text-xs text-muted-foreground">تُحسب الأوقات من تاريخ إرسال الطلب المسجل. لا تعني مدة الانتظار وحدها وجود تأخير.</p>
    {result.isLoading && <p>جاري تحميل الأصناف...</p>}
    {result.error && <p role="alert" className="text-destructive">تعذر تحميل الأصناف. حاول مرة أخرى.</p>}
    {!result.isLoading && !result.error && !items.length && <p className="rounded-lg border p-5">لا توجد أصناف مطابقة.</p>}
    <div className="space-y-3">{items.map(item => <article key={item.id} className="rounded-xl border bg-card p-4 shadow-sm">
      <button type="button" className="block w-full text-start" onClick={() => setSelected(selected === item.id ? null : item.id)} aria-expanded={selected === item.id}>
        <span className="flex items-center justify-between gap-3"><span className="font-semibold">{item.itemName}</span>{selected === item.id ? <ChevronUp className="h-5 w-5 shrink-0" /> : <ChevronDown className="h-5 w-5 shrink-0" />}</span>
        <div className="mt-3"><Summary item={item} now={now} /></div>
      </button>
      {selected === item.id && <ItemDetails id={item.id} now={now} />}
    </article>)}</div>
    <div className="flex gap-2"><Button variant="outline" disabled={page === 0} onClick={() => { setPage(page - 1); setSelected(null); }}>السابق</Button><Button variant="outline" disabled={!result.data?.nextId} onClick={() => { if (!result.data?.nextId) return; const next = cursors.slice(0, page + 1); next.push(result.data.nextId); setCursors(next); setPage(page + 1); setSelected(null); }}>التالي</Button></div>
  </main>;
}
