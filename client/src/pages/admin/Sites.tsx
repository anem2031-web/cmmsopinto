import { trpc } from "@/lib/trpc";
import { getLocalizedName } from "@/hooks/useTranslatedField";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { MapPin, Plus, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { useTranslation } from "@/contexts/LanguageContext";

export default function Sites() {
  const { t, language } = useTranslation();
  const utils = trpc.useUtils();
  const { data: sites, isLoading } = trpc.sites.list.useQuery();

  const createMut = trpc.sites.create.useMutation({
    onSuccess: () => { toast.success(t.common.savedSuccessfully); utils.sites.list.invalidate(); setOpen(false); resetForm(); },
    onError: (err) => toast.error(err.message),
  });
  const updateMut = trpc.sites.update.useMutation({
    onSuccess: () => { toast.success(t.common.savedSuccessfully); utils.sites.list.invalidate(); setEditOpen(false); },
    onError: (err) => toast.error(err.message),
  });
  const deleteMut = trpc.sites.delete.useMutation({
    onSuccess: () => { toast.success(t.common.deletedSuccessfully); utils.sites.list.invalidate(); setDeleteOpen(false); },
    onError: (err) => toast.error(err.message),
  });

  const [open, setOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [selectedSite, setSelectedSite] = useState<any>(null);
  const [form, setForm] = useState({ name: "", address: "", description: "" });
  const [editForm, setEditForm] = useState({ name: "", address: "", description: "" });
  const resetForm = () => setForm({ name: "", address: "", description: "" });

  const openEdit = (site: any) => {
    setSelectedSite(site);
    setEditForm({ name: site.name, address: site.address || "", description: site.description || "" });
    setEditOpen(true);
  };

  const openDelete = (site: any) => {
    setSelectedSite(site);
    setDeleteOpen(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t.sites.title}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t.sites.description}</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2"><Plus className="w-4 h-4" /> {t.sites.addSite}</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>{t.sites.addSite}</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2"><Label>{t.sites.siteName} *</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
              <div className="space-y-2"><Label>{t.sites.address}</Label><Input value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} /></div>
              <div className="space-y-2"><Label>{t.sites.description}</Label><Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={3} /></div>
              <Button onClick={() => { if (!form.name.trim()) { toast.error(t.sites.siteName); return; } createMut.mutate(form); }} disabled={createMut.isPending} className="w-full">{t.common.add}</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">{Array.from({ length: 4 }).map((_, i) => <Card key={i}><CardContent className="p-4"><Skeleton className="h-20 w-full" /></CardContent></Card>)}</div>
      ) : !sites?.length ? (
        <Card><CardContent className="p-12 text-center">
          <MapPin className="w-12 h-12 mx-auto text-muted-foreground/40 mb-4" />
          <h3 className="font-semibold text-lg mb-1">{t.common.noData}</h3>
        </CardContent></Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {sites.map(site => (
            <Card key={site.id} className="hover:shadow-lg hover:border-primary/20 transition-all duration-200">
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                    <MapPin className="w-5 h-5 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-medium text-sm">{getLocalizedName(site, language)}</h3>
                    {site.address && <p className="text-xs text-muted-foreground mt-0.5">{site.address}</p>}
                    {site.description && <p className="text-xs text-muted-foreground mt-1">{site.description}</p>}
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(site)}>
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => openDelete(site)}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t.common.edit} - {selectedSite?.name}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2"><Label>{t.sites.siteName} *</Label><Input value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} /></div>
            <div className="space-y-2"><Label>{t.sites.address}</Label><Input value={editForm.address} onChange={e => setEditForm(f => ({ ...f, address: e.target.value }))} /></div>
            <div className="space-y-2"><Label>{t.sites.description}</Label><Textarea value={editForm.description} onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))} rows={3} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>{t.common.cancel}</Button>
            <Button onClick={() => { if (!editForm.name.trim()) { toast.error(t.sites.siteName); return; } updateMut.mutate({ id: selectedSite.id, ...editForm }); }} disabled={updateMut.isPending}>
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
            <DialogDescription>{t.common.deleteWarning} <strong>{selectedSite?.name}</strong>? {t.common.cannotUndo}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>{t.common.cancel}</Button>
            <Button variant="destructive" onClick={() => deleteMut.mutate({ id: selectedSite.id })} disabled={deleteMut.isPending}>
              {deleteMut.isPending ? t.common.deleting : t.common.delete}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
