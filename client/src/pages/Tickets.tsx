import { trpc } from "@/lib/trpc";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { STATUS_COLORS, PRIORITY_COLORS } from "@shared/types";
import { Plus, Search, ClipboardList, Pencil, Trash2 } from "lucide-react";
import { ExportButton } from "@/components/ExportButton";
import { useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { useTranslation } from "@/contexts/LanguageContext";
import { useStaticLabels } from "@/hooks/useContentTranslation";
import { useTranslatedField } from "@/hooks/useTranslatedField";
import { useAuth } from "@/_core/hooks/useAuth";
import { toast } from "sonner";

export default function Tickets() {
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [siteFilter, setSiteFilter] = useState("all");
  const [sectionFilter, setSectionFilter] = useState("all");
  const [technicianFilter, setTechnicianFilter] = useState("all");
  const { t, language } = useTranslation();
  const { getStatusLabel, getPriorityLabel, getCategoryLabel } = useStaticLabels();
  const { getField } = useTranslatedField();
  const { user } = useAuth();
  const utils = trpc.useUtils();

  const canManage = user && ["owner", "admin", "maintenance_manager"].includes(user.role);

  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [selectedTicket, setSelectedTicket] = useState<any>(null);
  const [editData, setEditData] = useState({ title: "", description: "", priority: "", category: "" });

  const { data: sites = [] } = trpc.sites.list.useQuery();
  const { data: allSections } = trpc.sections.list.useQuery(undefined);
  // Phase 4: use users.listTechnicians as the SOLE internal source for the technician filter dropdown.
  // Legacy technicians.list is NOT used for filtering because the filter now targets assignedToId (internal users).
  // External technicians remain accessible via the legacy path in TicketDetail reassignment.
  const { data: userTechniciansList = [] } = trpc.users.listTechnicians.useQuery();
  const allTechnicians = userTechniciansList.map((u: any) => ({ id: u.id, name: u.name || u.email }));
  const { data: tickets, isLoading } = trpc.tickets.list.useQuery({
    status: statusFilter !== "all" ? statusFilter : undefined,
    priority: priorityFilter !== "all" ? priorityFilter : undefined,
    siteId: siteFilter !== "all" ? Number(siteFilter) : undefined,
    sectionId: sectionFilter !== "all" ? Number(sectionFilter) : undefined,
    search: search || undefined,
    // Phase 4: filter by assignedToId (internal user) — was incorrectly using assignedTechnicianId
    assignedToId: technicianFilter !== "all" ? Number(technicianFilter) : undefined,
  });

  const updateMutation = trpc.tickets.update.useMutation({
    onSuccess: () => {
      toast.success(t.common.savedSuccessfully);
      utils.tickets.list.invalidate();
      setEditOpen(false);
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteMutation = trpc.tickets.delete.useMutation({
    onSuccess: () => {
      toast.success(t.common.deletedSuccessfully);
      utils.tickets.list.invalidate();
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

      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder={`${t.common.search}...`}
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pr-10"
          />
        </div>
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
        <Select value={siteFilter} onValueChange={v => { setSiteFilter(v); setSectionFilter("all"); }}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="الموقع" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t.common.all}</SelectItem>
            {sites.map((s: any) => (
              <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {siteFilter !== "all" && (
          <Select value={sectionFilter} onValueChange={setSectionFilter}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="القسم" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t.common.all}</SelectItem>
              {allSections?.filter((s: any) => s.siteId === Number(siteFilter)).map((s: any) => (
                <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {allTechnicians.length > 0 && (
          <Select value={technicianFilter} onValueChange={setTechnicianFilter}>
            <SelectTrigger className="w-[170px]">
              <SelectValue placeholder="الفني المُسند" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t.common.all}</SelectItem>
              {allTechnicians.map((tech: any) => (
                <SelectItem key={tech.id} value={String(tech.id)}>{tech.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
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
                      {/* Phase 4: show internal user name first (assignedToId), fallback to external technician name */}
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
                    {canManage && (
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

      {/* Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>{t.common.edit} - {selectedTicket?.ticketNumber}</DialogTitle>
            <DialogDescription>{t.tickets.title}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>{t.tickets.ticketTitle}</Label>
              <Input value={editData.title} onChange={e => setEditData(prev => ({ ...prev, title: e.target.value }))} />
            </div>
            <div>
              <Label>{t.common.description}</Label>
              <Textarea value={editData.description} onChange={e => setEditData(prev => ({ ...prev, description: e.target.value }))} rows={3} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>{t.tickets.priority}</Label>
                <Select value={editData.priority} onValueChange={v => setEditData(prev => ({ ...prev, priority: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.keys(t.priority).map(k => (
                      <SelectItem key={k} value={k}>{getPriorityLabel(k)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>{t.tickets.category}</Label>
                <Select value={editData.category} onValueChange={v => setEditData(prev => ({ ...prev, category: v }))}>
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
              {updateMutation.isPending ? t.common.saving : t.common.save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle className="text-destructive">{t.common.confirmDelete}</DialogTitle>
            <DialogDescription>
              {t.common.deleteWarning} <strong>{selectedTicket?.ticketNumber} - {selectedTicket?.title}</strong>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>{t.common.cancel}</Button>
            <Button variant="destructive" onClick={() => deleteMutation.mutate({ id: selectedTicket.id })} disabled={deleteMutation.isPending}>
              {deleteMutation.isPending ? t.common.deleting : t.common.delete}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
