import { useAuth } from "@/_core/hooks/useAuth";
import { useTranslation } from "@/contexts/LanguageContext";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ExecutionPanel } from "./ExecutionPanel";
import { useState, useEffect, useRef } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import type { WarehouseSection } from "@shared/maintenance-team-tickets/warehouse-materials";
import { matchesReturnSearch } from "@/lib/returnSearch";

export default function TicketWarehouseRequests({
  ticketId,
  section: selectedSection,
  embedded = false,
  search = "",
}: {
  ticketId?: number;
  section?: "returns";
  embedded?: boolean;
  search?: string;
} = {}) {
  const returnsOnly = embedded && selectedSection === "returns";
  const { user, loading } = useAuth();
  const { language, dir, t } = useTranslation();
  const l = (ar: string, en: string, ur: string) =>
    language === "ar" ? ar : language === "ur" ? ur : en;
  const utils = trpc.useUtils();
  const [sectionState, setSection] = useState<WarehouseSection>(selectedSection ?? "waiting");
  const section = returnsOnly ? "returns" : sectionState;
  const [limit, setLimit] = useState(20);
  const focused = useRef<number | null>(null);
  const sections: WarehouseSection[] = returnsOnly ? ["returns"] : ["waiting", "ready", "returns"];
  const labels = [
    l("تحتاج معالجة", "Needs processing", "کارروائی درکار"),
    l("جاهزة للصرف", "Ready to issue", "اجرا کے لیے تیار"),
    l("المرتجعات", "Returns", "واپسی"),
  ];
  const allowed =
    user?.isActive === 1 && ["warehouse", "owner", "admin"].includes(user.role);
  const requests = trpc.ticketTeamAssignments.warehouseRequests.useQuery(
    undefined,
    { enabled: !!allowed, retry: false, refetchOnWindowFocus: false }
  );
  const materials = (requests.data ?? []).flatMap(ticket =>
    (ticket.materialNeeds ?? []).map(need => ({ ticket, need }))
  );
  const matching = materials.filter(({ ticket, need }) => matchesReturnSearch(search, ticket.ticketNumber, ticket.title, ticket.teamName,
    ticket.warehouseName, ticket.siteName, ticket.sectionName, need.name, need.unit));
  const sorted = [...matching].sort(
    (a, b) =>
      Number(b.ticket.ticketId === ticketId) -
      Number(a.ticket.ticketId === ticketId)
  );
  useEffect(() => {
    if (returnsOnly || !ticketId || focused.current === ticketId) return;
    const ticket = requests.data?.find(t => t.ticketId === ticketId);
    if (!ticket) return;
    focused.current = ticketId;
    setSection(ticket.materialNeeds?.[0]?.section ?? "waiting");
    setLimit(20);
  }, [ticketId, requests.data, returnsOnly]);
  if (loading || (allowed && requests.isLoading))
    return <p className="p-6">{t.common.loading}</p>;
  if (!allowed)
    return (
      <p role="alert" className="p-6">
        {l(
          "طلبات مواد التذاكر للمستودع فقط",
          "Ticket material requests are for the warehouse only.",
          "ٹکٹ کے مواد کی درخواستیں صرف گودام کے لیے ہیں۔"
        )}
      </p>
    );
  return (
    <div className="space-y-4" dir={dir}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        {!embedded && <div>
          <h1 className="text-2xl font-bold">
            {l(
              "طلبات مواد تذاكر الصيانة",
              "Maintenance ticket material requests",
              "مرمت کے ٹکٹ کے مواد کی درخواستیں"
            )}
          </h1>
          <p className="text-sm text-muted-foreground">
            {l(
              "كل بطاقة تمثل احتياج مادة مرتبطًا بتذكرته وفريقه؛ اختر الإجراء حسب المخزون والحالة.",
              "Each card is a material need linked to its ticket and team; act according to stock and status.",
              "ہر کارڈ اپنے ٹکٹ اور ٹیم سے منسلک مواد کی ضرورت ہے؛ اسٹاک اور حالت کے مطابق کارروائی کریں۔"
            )}
          </p>
        </div>}
        <Button
          variant="outline"
          disabled={requests.isFetching}
          onClick={() =>
            void Promise.all([
              requests.refetch(),
              utils.ticketTeamExecution.details.invalidate(),
              ...(returnsOnly ? [] : [utils.ticketTeamExecution.balances.invalidate()]),
            ])
          }
        >
          {t.common.refresh}
        </Button>
      </div>
      {requests.error && (
        <p role="alert" className="text-destructive">
          {requests.error.message}
        </p>
      )}
      <Tabs
        value={section}
        onValueChange={value => {
          setSection(value as WarehouseSection);
          setLimit(20);
        }}
      >
        {!returnsOnly && <TabsList className="grid h-auto w-full grid-cols-3">
          {sections.map((value, index) => (
            <TabsTrigger key={value} value={value} className="gap-2 py-3">
              {labels[index]}{" "}
              <Badge variant="secondary">
                {matching.filter(m => m.need.section === value).length}
              </Badge>
            </TabsTrigger>
          ))}
        </TabsList>}
        {sections.map(value => {
          const rows = sorted.filter(m => m.need.section === value);
          return (
            <TabsContent key={value} value={value} className="space-y-4">
              {!rows.length && !(returnsOnly && requests.error) && (
                <p className="rounded-xl border bg-card p-6 text-muted-foreground">
                  {l(
                    "لا توجد طلبات مواد لتذاكر الصيانة في هذا القسم.",
                    "No maintenance ticket material requests in this section.",
                    "اس حصے میں مرمت کے ٹکٹ کے مواد کی کوئی درخواست نہیں ہے۔"
                  )}
                </p>
              )}
              {rows.slice(0, limit).map(({ ticket, need }) => (
                <div
                  key={`${ticket.assignmentId}:${need.needId}`}
                  className={
                    ticket.ticketId === ticketId
                      ? "rounded-xl ring-2 ring-primary/40"
                      : undefined
                  }
                >
                  <ExecutionPanel
                    assignmentId={ticket.assignmentId}
                    warehouseNeedId={need.needId}
                    warehouseTicket={ticket}
                    actorId={user!.id}
                    role={user!.role}
                    language={language}
                    mode="warehouse"
                    warehouseSection={value}
                    returnsOnly={returnsOnly}
                    onChanged={() => void requests.refetch()}
                  />
                </div>
              ))}
              {rows.length > limit && (
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => setLimit(count => count + 20)}
                >
                  {l(
                    "عرض المزيد من الاحتياجات",
                    "Show more material needs",
                    "مواد کی مزید ضروریات دکھائیں"
                  )}{" "}
                  ({rows.length - limit})
                </Button>
              )}
            </TabsContent>
          );
        })}
      </Tabs>
    </div>
  );
}
