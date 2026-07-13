import { trpc } from "@/lib/trpc";
import { getLocalizedName } from "@/hooks/useTranslatedField";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Building2, Plus, Pencil, Trash2, MapPin, ChevronDown, ChevronRight } from "lucide-react";
import { useState, useMemo } from "react";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { useTranslation } from "@/contexts/LanguageContext";

export default function Sections() {
  const { t, language } = useTranslation();
  const utils = trpc.useUtils();

  const { data: sites, isLoading: sitesLoading } = trpc.sites.list.useQuery();
  const { data: sections, isLoading: sectionsLoading } = trpc.sections.list.useQuery(undefined);

  const createMut = trpc.sections.create.useMutation({
    onSuccess: () => {
      toast.success(t.common.savedSuccessfully);
      utils.sections.list.invalidate();
      setOpen(false);
      resetForm();
    },
    onError: (err) => toast.error(err.message),
  });

  const updateMut = trpc.sections.update.useMutation({
    onSuccess: () => {
      toast.success(t.common.savedSuccessfully);
      utils.sections.list.invalidate();
      setEditOpen(false);
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteMut = trpc.sections.delete.useMutation({
    onSuccess: () => {
      toast.success(t.common.deletedSuccessfully);
      utils.sections.list.invalidate();
      setDeleteOpen(false);
    },
    onError: (err) => toast.error(err.message),
  });

  const [open, setOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [selectedSection, setSelectedSection] = useState<any>(null);
  const [expandedSites, setExpandedSites] = useState<Set<number>>(new Set());
  const [filterSiteId, setFilterSiteId] = useState<string>("all");

  const [form, setForm] = useState({ name: "", siteId: "", description: "" });
  const [editForm, setEditForm] = useState({ name: "", description: "", isActive: true });

  const resetForm = () => setForm({ name: "", siteId: "", description: "" });

  const openEdit = (section: any) => {
    setSelectedSection(section);
    setEditForm({ name: section.name, description: section.description || "", isActive: section.isActive });
    setEditOpen(true);
  };

  const openDelete = (section: any) => {
    setSelectedSection(section);
    setDeleteOpen(true);
  };

  const toggleSite = (siteId: number) => {
    setExpandedSites(prev => {
      const next = new Set(prev);
      if (next.has(siteId)) next.delete(siteId);
      else next.add(siteId);
      return next;
    });
  };

  // Group sections by site
  const sectionsBySite = useMemo(() => {
    const map = new Map<number, any[]>();
    (sections || []).forEach(sec => {
      if (!map.has(sec.siteId)) map.set(sec.siteId, []);
      map.get(sec.siteId)!.push(sec);
    });
    return map;
  }, [sections]);

  const filteredSites = useMemo(() => {
    if (!sites) return [];
    if (filterSiteId === "all") return sites;
    return sites.filter(s => s.id === Number(filterSiteId));
  }, [sites, filterSiteId]);

  const isLoading = sitesLoading || sectionsLoading;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t.nav.sectionsPage}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t.sections?.subtitle || "تفريع المواقع إلى أقسام"}</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Filter by site */}
          <Select value={filterSiteId} onValueChange={setFilterSiteId}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder={t.common.allSites} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t.common.allSites}</SelectItem>
              {(sites || []).map(s => (
                <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Add Section */}
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2"><Plus className="w-4 h-4" /> {t.sections?.addSection || "إضافة قسم"}</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>{t.sections?.addNewSection || "إضافة قسم جديد"}</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>{t.common.location} *</Label>
                  <Select value={form.siteId} onValueChange={v => setForm(f => ({ ...f, siteId: v }))}>
                    <SelectTrigger>
                      <SelectValue placeholder={t.common.selectSite || "اختر الموقع"} />
                    </SelectTrigger>
                    <SelectContent>
                      {(sites || []).map(s => (
                        <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>{t.sections?.sectionName || "اسم القسم"} *</Label>
                  <Input
                    placeholder="مثال: محل كون زون"
                    value={form.name}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t.common.description}</Label>
                  <Textarea
                    value={form.description}
                    onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                    rows={2}
                  />
                </div>
                <Button
                  onClick={() => {
                    if (!form.name.trim()) { toast.error("اسم القسم مطلوب"); return; }
                    if (!form.siteId) { toast.error("يجب اختيار الموقع"); return; }
                    createMut.mutate({ name: form.name.trim(), siteId: Number(form.siteId), description: form.description || undefined });
                  }}
                  disabled={createMut.isPending}
                  className="w-full"
                >
                  {createMut.isPending ? t.common.saving : t.common.add}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-blue-500/10 flex items-center justify-center">
              <MapPin className="w-4 h-4 text-blue-500" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{t.nav.sites}</p>
              <p className="text-xl font-bold">{sites?.length || 0}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-emerald-500/10 flex items-center justify-center">
              <Building2 className="w-4 h-4 text-emerald-500" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{t.sections?.totalSections || "إجمالي الأقسام"}</p>
              <p className="text-xl font-bold">{sections?.length || 0}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-green-500/10 flex items-center justify-center">
              <Building2 className="w-4 h-4 text-green-500" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{t.sections?.activeSections || "أقسام نشطة"}</p>
              <p className="text-xl font-bold">{sections?.filter(s => s.isActive).length || 0}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-amber-500/10 flex items-center justify-center">
              <Building2 className="w-4 h-4 text-amber-500" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{t.sections?.avgPerSite || "متوسط أقسام/موقع"}</p>
              <p className="text-xl font-bold">
                {sites?.length ? Math.round((sections?.length || 0) / sites.length * 10) / 10 : 0}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tree View */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}><CardContent className="p-4"><Skeleton className="h-16 w-full" /></CardContent></Card>
          ))}
        </div>
      ) : !filteredSites.length ? (
        <Card>
          <CardContent className="p-12 text-center">
            <MapPin className="w-12 h-12 mx-auto text-muted-foreground/40 mb-4" />
            <h3 className="font-semibold text-lg mb-1">{t.common.noData}</h3>
            <p className="text-sm text-muted-foreground">{t.sections?.noSites || "لا توجد مواقع. أضف مواقع أولاً."}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filteredSites.map(site => {
            const siteSections = sectionsBySite.get(site.id) || [];
            const isExpanded = expandedSites.has(site.id) || filterSiteId !== "all";
            return (
              <Card key={site.id} className="overflow-hidden">
                {/* Site Header */}
                <div
                  className="flex items-center gap-3 p-4 cursor-pointer hover:bg-muted/30 transition-colors"
                  onClick={() => toggleSite(site.id)}
                >
                  <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <MapPin className="w-4 h-4 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-sm">{getLocalizedName(site, language)}</h3>
                      <Badge variant="secondary" className="text-xs">{siteSections.length} {t.nav.sectionsPage}</Badge>
                    </div>
                    {site.address && <p className="text-xs text-muted-foreground mt-0.5">{site.address}</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1 text-xs h-7"
                      onClick={e => {
                        e.stopPropagation();
                        setForm(f => ({ ...f, siteId: String(site.id) }));
                        setOpen(true);
                      }}
                    >
                      <Plus className="w-3 h-3" /> {t.sections?.addSection || "قسم"}
                    </Button>
                    {isExpanded ? (
                      <ChevronDown className="w-4 h-4 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="w-4 h-4 text-muted-foreground" />
                    )}
                  </div>
                </div>

                {/* Sections List */}
                {isExpanded && (
                  <div className="border-t divide-y">
                    {siteSections.length === 0 ? (
                      <div className="px-6 py-4 text-sm text-muted-foreground text-center">
                        {t.sections?.noSectionsYet || "لا توجد أقسام لهذا الموقع بعد"}
                      </div>
                    ) : (
                      siteSections.map(section => (
                        <div key={section.id} className="flex items-center gap-3 px-6 py-3 hover:bg-muted/20 transition-colors">
                          <div className="w-7 h-7 rounded-md bg-emerald-500/10 flex items-center justify-center shrink-0">
                            <Building2 className="w-3.5 h-3.5 text-emerald-600" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium">{getLocalizedName(section, language)}</span>
                              {!section.isActive && (
                                <Badge variant="outline" className="text-xs text-muted-foreground">{t.common.inactive}</Badge>
                              )}
                            </div>
                            {section.description && (
                              <p className="text-xs text-muted-foreground mt-0.5">{section.description}</p>
                            )}
                          </div>
                          <div className="flex gap-1 shrink-0">
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(section)}>
                              <Pencil className="w-3.5 h-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => openDelete(section)}>
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t.common.edit} {t.nav.sectionsPage} - {getLocalizedName(selectedSection, language)}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t.sections?.sectionName || "اسم القسم"} *</Label>
              <Input value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>{t.common.description}</Label>
              <Textarea value={editForm.description} onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))} rows={2} />
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="isActive"
                checked={editForm.isActive}
                onChange={e => setEditForm(f => ({ ...f, isActive: e.target.checked }))}
                className="w-4 h-4"
              />
              <Label htmlFor="isActive">{t.common.active || "نشط"}</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>{t.common.cancel}</Button>
            <Button
              onClick={() => {
                if (!editForm.name.trim()) { toast.error("اسم القسم مطلوب"); return; }
                updateMut.mutate({ id: selectedSection.id, name: editForm.name.trim(), description: editForm.description || undefined, isActive: editForm.isActive });
              }}
              disabled={updateMut.isPending}
            >
              {updateMut.isPending ? t.common.saving : t.common.save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle className="text-destructive">{t.common.confirmDelete}</DialogTitle>
            <DialogDescription>
              {t.common.deleteWarning} <strong>{getLocalizedName(selectedSection, language)}</strong>؟ {t.common.cannotUndo}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>{t.common.cancel}</Button>
            <Button
              variant="destructive"
              onClick={() => deleteMut.mutate({ id: selectedSection.id })}
              disabled={deleteMut.isPending}
            >
              {deleteMut.isPending ? t.common.deleting : t.common.delete}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
