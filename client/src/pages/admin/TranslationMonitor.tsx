import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Languages, RefreshCw, CheckCircle2, XCircle, Clock, Loader2,
  Search, Filter, Eye, Edit3, RotateCcw, AlertCircle,
  Globe, FileText, Database, TrendingUp, Zap
} from "lucide-react";
import { useState, useMemo } from "react";
import { toast } from "sonner";
import { useTranslation } from "@/contexts/LanguageContext";

const statusColors: Record<string, string> = {
  pending: "bg-amber-100 text-amber-800 border-amber-200",
  processing: "bg-blue-100 text-blue-800 border-blue-200",
  completed: "bg-emerald-100 text-emerald-800 border-emerald-200",
  failed: "bg-red-100 text-red-800 border-red-200",
  approved: "bg-purple-100 text-purple-800 border-purple-200",
};

const statusIcons: Record<string, any> = {
  pending: Clock,
  processing: Loader2,
  completed: CheckCircle2,
  failed: XCircle,
  approved: CheckCircle2,
};

const entityLabels: Record<string, string> = {
  ticket: "بلاغ صيانة",
  purchase_order: "طلب شراء",
  po_item: "صنف شراء",
  inventory: "مخزون",
  notification: "إشعار",
};

const langLabels: Record<string, string> = {
  ar: "العربية",
  en: "English",
  ur: "اردو",
};

export default function TranslationMonitor() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState("overview");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [entityFilter, setEntityFilter] = useState<string>("all");
  const [langFilter, setLangFilter] = useState<string>("all");
  const [editDialog, setEditDialog] = useState<any>(null);
  const [editedText, setEditedText] = useState("");

  // Fetch translation stats
  const { data: stats, isLoading: statsLoading, refetch: refetchStats } = trpc.translation.getStats.useQuery();

  // Fetch translation jobs
  const { data: jobs, isLoading: jobsLoading, refetch: refetchJobs } = trpc.translation.getJobs.useQuery({
    status: statusFilter !== "all" ? statusFilter : undefined,
    entityType: entityFilter !== "all" ? entityFilter : undefined,
    limit: 50,
  });

  // Mutations
  const retryMut = trpc.translation.retryFailed.useMutation({
    onSuccess: (data) => {
      toast.success(`${t.translationMonitor.retryFailed}: ${data.retriedCount}`);
      refetchJobs();
      refetchStats();
    },
    onError: (err) => toast.error(err.message),
  });

  const updateMut = trpc.translation.manualOverride.useMutation({
    onSuccess: () => {
      toast.success(t.common.save);
      setEditDialog(null);
      refetchJobs();
    },
    onError: (err: { message: string }) => toast.error(err.message),
  });

  // Stats summary
  const totalTranslations = stats?.translations?.total || 0;
  const pendingCount = stats?.translations?.pending || 0;
  const completedCount = stats?.translations?.completed || 0;
  const failedCount = stats?.translations?.failed || 0;
  const approvedCount = stats?.translations?.approved || 0;
  const processingCount = stats?.translations?.processing || 0;

  // Filter jobs
  const filteredJobs = useMemo(() => {
    if (!jobs) return [];
    let result = jobs;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter((j: any) =>
        j.sourceText?.toLowerCase().includes(q) ||
        j.translatedText?.toLowerCase().includes(q) ||
        j.entityType?.toLowerCase().includes(q)
      );
    }
    return result;
  }, [jobs, searchQuery]);

  if (statsLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-28 w-full" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Languages className="w-6 h-6 text-primary" /> {t.translationMonitor.title}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">{t.translationMonitor.stats}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => { refetchStats(); refetchJobs(); }} className="gap-1.5">
            <RefreshCw className="w-4 h-4" /> {t.common.refresh}
          </Button>
          {failedCount > 0 && (
            <Button size="sm" variant="destructive" onClick={() => retryMut.mutate({})} disabled={retryMut.isPending} className="gap-1.5">
              {retryMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
              {t.translationMonitor.retryAll} ({failedCount})
            </Button>
          )}
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Card className="border-slate-200 hover:shadow-md transition-all">
          <CardContent className="p-4 text-center">
            <Database className="w-5 h-5 mx-auto text-slate-600 mb-2" />
            <p className="text-2xl font-bold">{totalTranslations}</p>
            <p className="text-xs text-muted-foreground">{t.translationMonitor.totalTranslations}</p>
          </CardContent>
        </Card>
        <Card className="border-amber-200 bg-amber-50/30 hover:shadow-md transition-all">
          <CardContent className="p-4 text-center">
            <Clock className="w-5 h-5 mx-auto text-amber-600 mb-2" />
            <p className="text-2xl font-bold text-amber-800">{pendingCount}</p>
            <p className="text-xs text-amber-600">{t.translationMonitor.pendingTranslations}</p>
          </CardContent>
        </Card>
        <Card className="border-blue-200 bg-blue-50/30 hover:shadow-md transition-all">
          <CardContent className="p-4 text-center">
            <Loader2 className="w-5 h-5 mx-auto text-blue-600 mb-2" />
            <p className="text-2xl font-bold text-blue-800">{processingCount}</p>
            <p className="text-xs text-blue-600">{t.translationMonitor.processingTranslations}</p>
          </CardContent>
        </Card>
        <Card className="border-emerald-200 bg-emerald-50/30 hover:shadow-md transition-all">
          <CardContent className="p-4 text-center">
            <CheckCircle2 className="w-5 h-5 mx-auto text-emerald-600 mb-2" />
            <p className="text-2xl font-bold text-emerald-800">{completedCount}</p>
            <p className="text-xs text-emerald-600">{t.translationMonitor.completedTranslations}</p>
          </CardContent>
        </Card>
        <Card className="border-red-200 bg-red-50/30 hover:shadow-md transition-all">
          <CardContent className="p-4 text-center">
            <XCircle className="w-5 h-5 mx-auto text-red-600 mb-2" />
            <p className="text-2xl font-bold text-red-800">{failedCount}</p>
            <p className="text-xs text-red-600">{t.translationMonitor.failedTranslations}</p>
          </CardContent>
        </Card>
        <Card className="border-purple-200 bg-purple-50/30 hover:shadow-md transition-all">
          <CardContent className="p-4 text-center">
            <CheckCircle2 className="w-5 h-5 mx-auto text-purple-600 mb-2" />
            <p className="text-2xl font-bold text-purple-800">{approvedCount}</p>
            <p className="text-xs text-purple-600">{t.translationMonitor.approvedTranslations}</p>
          </CardContent>
        </Card>
      </div>

      {/* Distribution Cards */}
      {stats?.byEntity && stats?.byLanguage && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <FileText className="w-4 h-4" /> {t.translationMonitor.byEntity}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {stats.byEntity.map((item) => (
                  <div key={item.entityType} className="flex items-center justify-between p-2 bg-muted/50 rounded-lg">
                    <span className="text-sm">{entityLabels[item.entityType] || item.entityType}</span>
                    <Badge variant="secondary">{item.count}</Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Globe className="w-4 h-4" /> {t.translationMonitor.byLanguage}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {stats.byLanguage.map((item) => (
                  <div key={item.languageCode} className="flex items-center justify-between p-2 bg-muted/50 rounded-lg">
                    <span className="text-sm">{langLabels[item.languageCode] || item.languageCode}</span>
                    <Badge variant="secondary">{item.count}</Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Jobs List */}
      <Card>
        <CardHeader>
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Zap className="w-4 h-4" /> {t.translationMonitor.jobs}
            </CardTitle>
            <div className="flex flex-wrap gap-2">
              <div className="relative">
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder={t.common.search}
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="pr-9 w-48"
                />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t.common.all}</SelectItem>
                  <SelectItem value="pending">{t.translationMonitor.pendingTranslations}</SelectItem>
                  <SelectItem value="processing">{t.translationMonitor.processingTranslations}</SelectItem>
                  <SelectItem value="completed">{t.translationMonitor.completedTranslations}</SelectItem>
                  <SelectItem value="failed">{t.translationMonitor.failedTranslations}</SelectItem>
                  <SelectItem value="approved">{t.translationMonitor.approvedTranslations}</SelectItem>
                </SelectContent>
              </Select>
              <Select value={entityFilter} onValueChange={setEntityFilter}>
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t.common.all}</SelectItem>
                  <SelectItem value="ticket">{t.nav.tickets}</SelectItem>
                  <SelectItem value="purchase_order">{t.nav.purchaseOrders}</SelectItem>
                  <SelectItem value="po_item">{t.purchaseOrders.items}</SelectItem>
                  <SelectItem value="inventory">{t.nav.inventory}</SelectItem>
                </SelectContent>
              </Select>
              <Select value={langFilter} onValueChange={setLangFilter}>
                <SelectTrigger className="w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t.common.all}</SelectItem>
                  <SelectItem value="ar">العربية</SelectItem>
                  <SelectItem value="en">English</SelectItem>
                  <SelectItem value="ur">اردو</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {jobsLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}
            </div>
          ) : filteredJobs.length === 0 ? (
            <div className="text-center py-12">
              <Languages className="w-10 h-10 mx-auto text-muted-foreground/30 mb-3" />
              <p className="text-sm text-muted-foreground">{t.translationMonitor.noJobs}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredJobs.map((job: any) => {
                const StatusIcon = statusIcons[job.status] || Clock;
                return (
                  <div key={job.id} className="border rounded-lg p-4 hover:shadow-sm transition-all">
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div className="flex items-center gap-2">
                        <Badge className={`text-[10px] ${statusColors[job.status] || ""}`}>
                          <StatusIcon className={`w-3 h-3 mr-1 ${job.status === "processing" ? "animate-spin" : ""}`} />
                          {job.status}
                        </Badge>
                        <Badge variant="outline" className="text-[10px]">
                          {entityLabels[job.entityType] || job.entityType}
                        </Badge>
                        <span className="text-xs text-muted-foreground">#{job.entityId}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-muted-foreground">
                          {langLabels[job.sourceLang] || job.sourceLang} → {langLabels[job.targetLang] || job.targetLang}
                        </span>
                        {job.status === "completed" && (
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => {
                            setEditDialog(job);
                            setEditedText(job.translatedText || "");
                          }}>
                            <Edit3 className="w-3.5 h-3.5" />
                          </Button>
                        )}
                        {job.status === "failed" && (
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-red-600" onClick={() => retryMut.mutate({ entityType: job.entityType })}>
                            <RotateCcw className="w-3.5 h-3.5" />
                          </Button>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="bg-muted/30 rounded-lg p-2.5">
                        <p className="text-[10px] text-muted-foreground mb-1 flex items-center gap-1">
                          <FileText className="w-3 h-3" /> {t.translationMonitor.sourceText}
                        </p>
                        <p className="text-sm line-clamp-2">{job.sourceText || "—"}</p>
                      </div>
                      <div className={`rounded-lg p-2.5 ${job.translatedText ? "bg-emerald-50/50" : "bg-muted/30"}`}>
                        <p className="text-[10px] text-muted-foreground mb-1 flex items-center gap-1">
                          <Globe className="w-3 h-3" /> {t.translationMonitor.translatedText}
                        </p>
                        <p className="text-sm line-clamp-2">{job.translatedText || "—"}</p>
                      </div>
                    </div>

                    {job.errorMessage && (
                      <div className="mt-2 bg-red-50 border border-red-200 rounded-lg p-2 flex items-start gap-2">
                        <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                        <p className="text-xs text-red-700">{job.errorMessage}</p>
                      </div>
                    )}

                    <div className="flex items-center gap-3 mt-2 text-[10px] text-muted-foreground">
                      <span>{t.translationMonitor.jobId}: {job.id}</span>
                      {job.retryCount > 0 && <span>{t.translationMonitor.retryCount}: {job.retryCount}</span>}
                      {job.fieldName && <span>{job.fieldName}</span>}
                      {job.createdAt && <span>{new Date(job.createdAt).toLocaleString()}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Edit Dialog */}
      <Dialog open={!!editDialog} onOpenChange={(open) => { if (!open) setEditDialog(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-base flex items-center gap-2">
              <Edit3 className="w-4 h-4" /> {t.common.edit}
            </DialogTitle>
          </DialogHeader>
          {editDialog && (
            <div className="space-y-4">
              <div className="bg-muted/50 rounded-lg p-3">
                <Label className="text-xs text-muted-foreground">{t.translationMonitor.sourceText}</Label>
                <p className="text-sm mt-1">{editDialog.sourceText}</p>
              </div>
              <div className="space-y-2">
                <Label>{t.translationMonitor.translatedText}</Label>
                <Textarea
                  value={editedText}
                  onChange={e => setEditedText(e.target.value)}
                  rows={4}
                  className="text-sm"
                />
              </div>
              <div className="flex gap-2">
                <Button
                  className="flex-1 gap-1.5"
                  onClick={() => {
                    updateMut.mutate({
                      entityType: editDialog.entityType,
                      entityId: editDialog.entityId,
                      fieldName: editDialog.fieldName || "title",
                      languageCode: editDialog.targetLang || "en",
                      translatedText: editedText,
                    });
                  }}
                  disabled={updateMut.isPending}
                >
                  {updateMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                  {t.common.save}
                </Button>
                <Button variant="outline" onClick={() => setEditDialog(null)}>
                  {t.common.cancel}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
