import { trpc } from "@/lib/trpc";
import { keepPreviousData } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Pagination, PaginationContent, PaginationItem, PaginationLink,
  PaginationEllipsis,
} from "@/components/ui/pagination";
import { STATUS_COLORS, PRIORITY_COLORS } from "@shared/types";
import { Plus, Search, ClipboardList, Pencil, Trash2, ChevronLeft, ChevronRight } from "lucide-react";
import { ExportButton } from "@/components/common/ExportButton";
import { useState, useMemo, useEffect } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { useTranslation } from "@/contexts/LanguageContext";
import { useStaticLabels } from "@/hooks/useContentTranslation";
import { useTranslatedField } from "@/hooks/useTranslatedField";
import { useAuth } from "@/_core/hooks/useAuth";
import { toast } from "sonner";

// يبني قائمة أرقام الصفحات المطلوب عرضها (مع نقاط حذف "..." عند كثرة الصفحات)
// مثال لـ 10 صفحات وأنت بالصفحة 1: [1, 2, "dots", 10]
function getPageNumbers(current: number, total: number): (number | "dots")[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  const left = Math.max(2, current - 1);
  const right = Math.min(total - 1, current + 1);
  const range: (number | "dots")[] = [1];
  if (left > 2) range.push("dots");
  for (let i = left; i <= right; i++) range.push(i);
  if (right < total - 1) range.push("dots");
  range.push(total);
  return range;
}

export default function Tickets() {
  const [, setLocation] = useLocation();
  const searchParams = new URLSearchParams(useSearch());
  
  // Whitelist Validation & Initial Hydration (One-time only)
  const initialFilters = useMemo(() => {
    const status = searchParams.get("status");
    const priority = searchParams.get("priority");
    
    return {
      status: ["open", "all"].includes(status || "") ? status : "all",
      priority: ["critical", "all"].includes(priority || "") ? priority : "all"
    };
  }, []); // Empty dependency array ensures this only runs once on mount

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState(initialFilters.status || "all");
  const [priorityFilter, setPriorityFilter] = useState(initialFilters.priority || "all");
  const [siteFilter, setSiteFilter] = useState("all");
  const [sectionFilter, setSectionFilter] = useState("all");
  const [technicianFilter, setTechnicianFilter] = useState("all");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 10;
  
  const { t, language } = useTranslation();
  const { getStatusLabel, getPriorityLabel, getCategoryLabel } = useStaticLabels();
  const { getField } = useTranslatedField();
  const { user } = useAuth();
  const utils = trpc.useUtils();

  const canManage = user && ["owner", "admin", "maintenance_manager"].includes(user.role);
  const canDelete = user && ["owner", "admin"].includes(user.role);

  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [selectedTicket, setSelectedTicket] = useState<any>(null);
  const [editData, setEditData] = useState({ title: "", description: "", priority: "", category: "" });

  const { data: sites = [] } = trpc.sites.list.useQuery();
  const { data: allSections } = trpc.sections.list.useQuery(undefined);
  const { data: userTechniciansList = [] } = trpc.users.listTechnicians.useQuery();
  const allTechnicians = userTechniciansList.map((u: any) => ({ id: u.id, name: u.name || u.email }));

  // أي تغيير في البحث أو الفلاتر يرجعنا تلقائياً لأول صفحة
  // (تفادياً للوقوف على صفحة فاضية بعد ما تتغير نتائج الفلترة)
  useEffect(() => {
    setPage(1);
  }, [search, statusFilter, priorityFilter, siteFilter, sectionFilter, technicianFilter]);

  const { data: ticketsData, isLoading } = trpc.tickets.listPaginated.useQuery({
    status: statusFilter !== "all" ? statusFilter : undefined,
    priority: priorityFilter !== "all" ? priorityFilter : undefined,
    siteId: siteFilter !== "all" ? Number(siteFilter) : undefined,
    sectionId: sectionFilter !== "all" ? Number(sectionFilter) : undefined,
    search: search || undefined,
    assignedToId: technicianFilter !== "all" ? Number(technicianFilter) : undefined,
    page,
    pageSize: PAGE_SIZE,
  }, {
    placeholderData: keepPreviousData, // يمنع اختفاء القائمة/الصفحات لحظياً عند التنقل بين الصفحات
  });

  const tickets = ticketsData?.tickets ?? [];
  const totalTickets = ticketsData?.total ?? 0;
  const totalPages = ticketsData?.totalPages ?? 1;
  const pageNumbers = useMemo(() => getPageNumbers(page, totalPages), [page, totalPages]);

  const updateMutation = trpc.tickets.update.useMutation({
    onSuccess: () => {
      toast.success(t.common.savedSuccessfully);
      utils.tickets.list.invalidate();
      utils.tickets.listPaginated.invalidate();
      setEditOpen(false);
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteMutation = trpc.tickets.delete.useMutation({
    onSuccess: () => {
      toast.success(t.common.deletedSuccessfully);
      utils.tickets.list.invalidate();
      utils.tickets.listPaginated.invalidate();
      setDeleteOpen(false);
    },
    onError: (err) => toast.error(err.message),
  });

  const openEdit = (ticket: any, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedTicket(ticket);
    setEditData({ title: ticket.title, description: ticket.description || "", priority: ticket.priority, category: ticket.category });
    setEditOpen(true);
  };

  const openDelete = (ticket: any, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedTicket(ticket);
    setDeleteOpen(true);
  };

  const locale = language === "ar" ? "ar-SA" : language === "ur" ? "ur-PK" : "en-US";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t.tickets.title}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t.tickets.description}</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <ExportButton endpoint="tickets" filename="tickets" />
          <Button onClick={() => setLocation("/tickets/new")} className="gap-2">
            <Plus className="w-4 h-4" />
            {t.tickets.createNew}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 items-end">
        <div className="flex flex-col gap-1 flex-1 min-w-[200px]">
          <span className="text-xs text-muted-foreground">{t.common.search}</span>
          <div className="relative">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder={`${t.common.search}...`}
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pr-10"
            />
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">{t.common.status}</span>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder={t.common.status} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t.common.all}</SelectItem>
              {Object.keys(t.ticketStatus).map(k => (
                <SelectItem key={k} value={k}>{getStatusLabel(k)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">{t.tickets.priority}</span>
          <Select value={priorityFilter} onValueChange={setPriorityFilter}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder={t.tickets.priority} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t.common.all}</SelectItem>
              {Object.keys(t.priority).map(k => (
                <SelectItem key={k} value={k}>{getPriorityLabel(k)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">{t.tickets.site}</span>
          <Select value={siteFilter} onValueChange={v => { setSiteFilter(v); setSectionFilter("all"); }}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder={t.tickets.site} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t.common.all}</SelectItem>
              {sites.map((s: any) => (
                <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {siteFilter !== "all" && (
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">{t.tickets.section}</span>
            <Select value={sectionFilter} onValueChange={setSectionFilter}>
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder={t.tickets.section} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t.common.all}</SelectItem>
                {allSections?.filter((s: any) => s.siteId === Number(siteFilter)).map((s: any) => (
                  <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        {allTechnicians.length > 0 && (
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">{t.tickets.technician}</span>
            <Select value={technicianFilter} onValueChange={setTechnicianFilter}>
              <SelectTrigger className="w-[170px]">
                <SelectValue placeholder={t.tickets.technician} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t.common.all}</SelectItem>
                {allTechnicians.map((tech: any) => (
                  <SelectItem key={tech.id} value={String(tech.id)}>{tech.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Card key={i}><CardContent className="p-4"><Skeleton className="h-16 w-full" /></CardContent></Card>
          ))}
        </div>
      ) : !tickets?.length ? (
        <Card>
          <CardContent className="p-12 text-center">
            <ClipboardList className="w-12 h-12 mx-auto text-muted-foreground/40 mb-4" />
            <h3 className="font-semibold text-lg mb-1">{t.tickets.noTickets}</h3>
            <p className="text-sm text-muted-foreground">{t.common.noData}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {tickets.map(ticket => (
            <Card
              key={ticket.id}
              className="hover:shadow-lg hover:border-primary/20 transition-all duration-200 cursor-pointer"
              onClick={() => setLocation(`/tickets/${ticket.id}`)}
            >
              <CardContent className="p-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-mono text-muted-foreground">{ticket.ticketNumber}</span>
                      <Badge variant="outline" className={`text-[11px] ${PRIORITY_COLORS[ticket.priority] || ""}`}>
                        {getPriorityLabel(ticket.priority)}
                      </Badge>
                    </div>
                    <h3 className="font-medium text-sm truncate">{getField(ticket, "title")}</h3>
                    <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground flex-wrap">
                      <span>{getCategoryLabel(ticket.category)}</span>
                      <span>{new Date(ticket.createdAt).toLocaleDateString(locale)}</span>
                      {((ticket as any).assignedToUserName || (ticket as any).assignedTechnicianName) && (
                        <span className="flex items-center gap-1 text-blue-600 dark:text-blue-400 font-medium">
                          <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-400" />
                          {(ticket as any).assignedToUserName || (ticket as any).assignedTechnicianName}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {(canManage || ticket.reportedById === user?.id) && ticket.status !== "closed" && (
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={(e) => openEdit(ticket, e)}>
                        <Pencil className="w-4 h-4" />
                      </Button>
                    )}
                    {canDelete && (
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={(e) => openDelete(ticket, e)}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    )}
                    <Badge className={`status-badge ${STATUS_COLORS[ticket.status] || "bg-gray-100 text-gray-700"}`}>
                      {getStatusLabel(ticket.status)}
                    </Badge>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {!isLoading && tickets.length > 0 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-1">
          <span className="text-xs text-muted-foreground">
            {t.tickets.results}: {totalTickets}
          </span>
          {totalPages > 1 && (
            <Pagination className="mx-0 w-auto">
              <PaginationContent>
                <PaginationItem>
                  <PaginationLink
                    href="#"
                    size="default"
                    aria-label={t.common.previous}
                    onClick={e => { e.preventDefault(); if (page > 1) setPage(page - 1); }}
                    className={`gap-1 px-2.5 ${page <= 1 ? "pointer-events-none opacity-50" : ""}`}
                  >
                    <ChevronLeft className="w-4 h-4" />
                    <span className="hidden sm:block">{t.common.previous}</span>
                  </PaginationLink>
                </PaginationItem>
                {pageNumbers.map((p, idx) =>
                  p === "dots" ? (
                    <PaginationItem key={`dots-${idx}`}>
                      <PaginationEllipsis />
                    </PaginationItem>
                  ) : (
                    <PaginationItem key={p}>
                      <PaginationLink
                        href="#"
                        isActive={p === page}
                        onClick={e => { e.preventDefault(); setPage(p as number); }}
                      >
                        {p}
                      </PaginationLink>
                    </PaginationItem>
                  )
                )}
                <PaginationItem>
                  <PaginationLink
                    href="#"
                    size="default"
                    aria-label={t.common.next}
                    onClick={e => { e.preventDefault(); if (page < totalPages) setPage(page + 1); }}
                    className={`gap-1 px-2.5 ${page >= totalPages ? "pointer-events-none opacity-50" : ""}`}
                  >
                    <span className="hidden sm:block">{t.common.next}</span>
                    <ChevronRight className="w-4 h-4" />
                  </PaginationLink>
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          )}
        </div>
      )}

      {/* Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>{t.common.edit} - {selectedTicket?.ticketNumber}</DialogTitle>
            <DialogDescription>{t.tickets.description}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label>{t.tickets.title}</Label>
              <Input value={editData.title} onChange={e => setEditData({ ...editData, title: e.target.value })} />
            </div>
            <div className="grid gap-2">
              <Label>{t.tickets.description}</Label>
              <Textarea value={editData.description} onChange={e => setEditData({ ...editData, description: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>{t.tickets.priority}</Label>
                <Select value={editData.priority} onValueChange={v => setEditData({ ...editData, priority: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.keys(t.priority).map(k => (
                      <SelectItem key={k} value={k}>{getPriorityLabel(k)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>{t.tickets.category}</Label>
                <Select value={editData.category} onValueChange={v => setEditData({ ...editData, category: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.keys(t.category).map(k => (
                      <SelectItem key={k} value={k}>{getCategoryLabel(k)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>{t.common.cancel}</Button>
            <Button onClick={() => updateMutation.mutate({ id: selectedTicket.id, ...editData })} disabled={updateMutation.isPending}>
              {t.common.save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.common.delete} - {selectedTicket?.ticketNumber}</DialogTitle>
            <DialogDescription>{t.common.deleteWarning}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>{t.common.cancel}</Button>
            <Button variant="destructive" onClick={() => deleteMutation.mutate({ id: selectedTicket.id })} disabled={deleteMutation.isPending}>
              {t.common.delete}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
