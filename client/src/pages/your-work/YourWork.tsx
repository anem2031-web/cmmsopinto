import { useEffect, useState, type KeyboardEvent } from "react";
import { ClipboardList } from "lucide-react";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { useLanguage } from "@/contexts/LanguageContext";
import { trpc } from "@/lib/trpc";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { canReadYourWork, YOUR_WORK_PATH, splitYourWork, yourWorkOverdueAt, type YourWorkIdentity, type YourWorkItem } from "@shared/your-work";
import { yourWorkCopy, yourWorkDate, yourWorkDuration } from "./copy";

export function YourWorkSidebarLink({ actor, collapsed, active, language, onNavigate }: {
  actor?: YourWorkIdentity | null; collapsed: boolean; active: boolean; language: string; onNavigate: (path: string) => void;
}) {
  if (!canReadYourWork(actor)) return null;
  const title = yourWorkCopy(language).title;
  return <SidebarMenu className="px-4 pb-2 pt-1" data-your-work-navigation="true">
    <SidebarMenuItem>
      <SidebarMenuButton isActive={active} onClick={() => onNavigate(YOUR_WORK_PATH)} tooltip={title}
        aria-label={title} aria-current={active ? "page" : undefined}
        className="h-10 text-start text-base font-bold hover:bg-sidebar-accent focus-visible:ring-sidebar-primary" style={{ color: "#C4B5FD" }}>
        <ClipboardList className="h-4 w-4 shrink-0" />
        {!collapsed && <span className="truncate font-bold">{title}</span>}
      </SidebarMenuButton>
    </SidebarMenuItem>
  </SidebarMenu>;
}

export default function YourWork() {
  const { user, authenticatedUser, loading: authLoading } = useAuth();
  const { language, dir } = useLanguage();
  const copy = yourWorkCopy(language);
  const actor = authenticatedUser ?? user;
  const allowed = !authLoading && canReadYourWork(actor);
  const [, navigate] = useLocation();
  const [tab, setTab] = useState<"overdue" | "required">("overdue");
  const [now, setNow] = useState(() => Date.now());
  const result = trpc.yourWork.list.useQuery({ viewerId: actor?.id ?? 0, viewerRole: actor?.role ?? "", language }, {
    enabled: allowed, refetchInterval: 30_000, refetchIntervalInBackground: false, refetchOnWindowFocus: true, refetchOnMount: "always",
    placeholderData: () => undefined,
  });
  useEffect(() => {
    if (!allowed) return;
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, [allowed]);
  if (authLoading) return <main dir={dir} className="p-4"><p role="status">{copy.loading}</p></main>;
  if (!allowed) return <main dir={dir} className="p-4"><p role="alert">{copy.denied}</p></main>;
  const referenceNow = Math.max(now, result.data?.generatedAt ?? now);
  const data = result.data ? splitYourWork([...result.data.overdue, ...result.data.required], referenceNow) : undefined;
  const rows: YourWorkItem[] = data?.[tab] || [];
  const counts = data?.counts || { overdue: 0, required: 0 };
  const name = (actor as { name?: string | null; username?: string | null })?.name?.trim()
    || (actor as { username?: string | null })?.username || "";
  const openRow = (row: YourWorkItem) => navigate(row.href);
  const keyOpenRow = (event: KeyboardEvent<HTMLTableRowElement>, row: YourWorkItem) => {
    if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault(); openRow(row);
    }
  };
  return <main dir={dir} className="mx-auto max-w-6xl space-y-5 p-2 sm:p-4" data-your-work-page="true">
    <header>
      <h1 className="text-2xl font-bold text-start">{copy.title}</h1>
      <p className="mt-3 text-xl font-semibold text-start">{copy.greeting(name)}</p>
      {!result.isLoading && !result.error && data && <p className="mt-2 text-sm text-muted-foreground text-start" aria-live="polite">
        {counts.overdue + counts.required ? copy.summary(counts.overdue, counts.required) : copy.noWork}
      </p>}
    </header>
    <div role="tablist" aria-label={copy.title} className="flex flex-wrap gap-2 border-b pb-3">
      {(["overdue", "required"] as const).map(value => <button key={value} type="button" role="tab"
        id={`your-work-tab-${value}`} aria-controls="your-work-panel" aria-selected={tab === value}
        onClick={() => setTab(value)} className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${tab === value ? value === "overdue" ? "bg-red-600 text-white" : "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/70"}`}>
        {copy[value]} <span dir="ltr">({data && !result.error ? counts[value] : "—"})</span>
      </button>)}
    </div>
    <section id="your-work-panel" role="tabpanel" aria-labelledby={`your-work-tab-${tab}`}>
      {result.isLoading ? <p role="status" className="py-8 text-center text-muted-foreground">{copy.loading}</p>
        : result.error ? <p role="alert" className="rounded-lg border border-destructive/30 p-5 text-destructive">{copy.loadError}</p>
        : <div className="w-full overflow-x-auto rounded-xl border bg-card">
          <table className="w-full min-w-[680px] table-fixed text-sm" aria-label={copy[tab]}>
            <colgroup><col className="w-[6%]" /><col className="w-[31%]" /><col className="w-[25%]" /><col className="w-[23%]" /><col className="w-[15%]" /></colgroup>
            <thead className="border-b bg-muted/40"><tr>
              <th scope="col" className="px-3 py-3 text-center font-semibold">{copy.number}</th>
              <th scope="col" className="px-3 py-3 text-start font-semibold">{copy.transaction}</th>
              <th scope="col" className="px-3 py-3 text-start font-semibold">{copy.action}</th>
              <th scope="col" className="px-3 py-3 text-center font-semibold">{copy.arrived}</th>
              <th scope="col" className="px-3 py-3 text-center font-semibold">{tab === "overdue" ? copy.overdueDuration : copy.elapsed}</th>
            </tr></thead>
            <tbody>{rows.length ? rows.map((row, index) => {
              const since = tab === "overdue" ? yourWorkOverdueAt(row.arrivedAt) : row.arrivedAt;
              const duration = since == null ? null : Math.max(0, referenceNow - since);
              const description = `${copy.kinds[row.kind]} ${row.reference} — ${copy.actions[row.action]}`;
              return <tr key={row.key} tabIndex={0} onClick={() => openRow(row)} onKeyDown={event => keyOpenRow(event, row)}
                aria-label={description} data-work-key={row.key}
                className="cursor-pointer border-b last:border-b-0 hover:bg-muted/40 focus-visible:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary">
                <td className="px-3 py-4 text-center tabular-nums">{index + 1}</td>
                <td className="px-3 py-4 text-start align-top"><a href={row.href} className="font-semibold text-primary hover:underline"
                  onClick={event => { event.preventDefault(); event.stopPropagation(); openRow(row); }}>
                  {copy.kinds[row.kind]} <bdi dir="ltr">{row.reference}</bdi>
                </a>{row.title && <p className="mt-1 break-words text-xs text-muted-foreground">{row.title}</p>}</td>
                <td className="px-3 py-4 text-start align-top">{copy.actions[row.action]}</td>
                <td className="px-3 py-4 text-center align-top"><time dir="ltr" dateTime={row.arrivedAt == null ? undefined : new Date(row.arrivedAt).toISOString()} className="inline-block whitespace-nowrap tabular-nums">{yourWorkDate(row.arrivedAt, copy.unknownTime)}</time></td>
                <td className={`px-3 py-4 text-center align-top ${tab === "overdue" ? "font-semibold text-red-700 dark:text-red-400" : ""}`}>{yourWorkDuration(duration, language, copy.unknownTime)}</td>
              </tr>;
            }) : <tr><td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">{tab === "overdue" ? copy.noOverdue : copy.noRequired}</td></tr>}</tbody>
          </table>
        </div>}
    </section>
  </main>;
}
