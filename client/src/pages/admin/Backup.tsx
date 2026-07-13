import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download, Upload, Loader2, Database, CheckCircle2, XCircle, Clock } from "lucide-react";
import { useState, useRef } from "react";
import { toast } from "sonner";
import { useTranslation, useLanguage } from "@/contexts/LanguageContext";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export default function Backup() {
  const { t: tr } = useLanguage();
  const { t, language } = useTranslation();
  const locale = language === "ar" ? "ar-SA" : language === "ur" ? "ur-PK" : "en-US";
  const bt = (t as any).backup || {};
  const fileRef = useRef<HTMLInputElement>(null);
  const [restoreId, setRestoreId] = useState<number | null>(null);

  const { data: backups, refetch } = trpc.backups.list.useQuery();

  const createMut = trpc.backups.create.useMutation({
    onSuccess: () => {
      toast.success(bt.backupCreated || "تم إنشاء النسخة الاحتياطية بنجاح");
      refetch();
    },
    onError: (err: any) => toast.error(err.message),
  });

  const restoreMut = trpc.backups.restore.useMutation({
    onSuccess: () => {
      toast.success(bt.backupRestored || "تم استعادة النسخة الاحتياطية بنجاح");
      refetch();
      setRestoreId(null);
    },
    onError: (err: any) => {
      toast.error(err.message);
      setRestoreId(null);
    },
  });

  const handleRestore = () => {
    if (restoreId) {
      restoreMut.mutate({ id: restoreId });
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "completed":
        return <Badge variant="outline" className="text-emerald-600 border-emerald-200 bg-emerald-50"><CheckCircle2 className="w-3 h-3 ml-1" />{bt.completed || "مكتمل"}</Badge>;
      case "failed":
        return <Badge variant="outline" className="text-red-600 border-red-200 bg-red-50"><XCircle className="w-3 h-3 ml-1" />{bt.failed || "فشل"}</Badge>;
      default:
        return <Badge variant="outline" className="text-amber-600 border-amber-200 bg-amber-50"><Clock className="w-3 h-3 ml-1" />{bt.inProgress || "جاري"}</Badge>;
    }
  };

  const formatDate = (d: any) => {
    if (!d) return "-";
    return new Date(d).toLocaleString(locale, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-bold">{bt.title || "النسخ الاحتياطي"}</h1>
        <p className="text-sm text-muted-foreground mt-1">{bt.description || "إنشاء واستعادة نسخ احتياطية لقاعدة البيانات"}</p>
      </div>

      {/* Action Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Create Backup */}
        <Card>
          <CardContent className="p-6 flex flex-col items-center text-center gap-4">
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
              <Download className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h3 className="font-semibold">{bt.createBackup || "إنشاء نسخة احتياطية"}</h3>
              <p className="text-sm text-muted-foreground mt-1">{bt.createBackupDesc || "حفظ نسخة من قاعدة البيانات الحالية"}</p>
            </div>
            <Button
              onClick={() => createMut.mutate()}
              disabled={createMut.isPending}
              className="w-full"
            >
              {createMut.isPending ? <Loader2 className="w-4 h-4 animate-spin ml-2" /> : <Download className="w-4 h-4 ml-2" />}
              {bt.createNow || "إنشاء نسخة الآن"}
            </Button>
          </CardContent>
        </Card>

        {/* Restore Backup */}
        <Card>
          <CardContent className="p-6 flex flex-col items-center text-center gap-4">
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
              <Upload className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h3 className="font-semibold">{bt.restoreBackup || "استعادة نسخة احتياطية"}</h3>
              <p className="text-sm text-muted-foreground mt-1">{bt.restoreBackupDesc || "استعادة قاعدة البيانات من نسخة سابقة"}</p>
            </div>
            <Button
              variant="outline"
              className="w-full"
              disabled={!backups || backups.length === 0}
              onClick={() => {
                if (backups && backups.length > 0) {
                  setRestoreId(backups[0].id);
                }
              }}
            >
              <Upload className="w-4 h-4 ml-2" />
              {bt.restoreNow || "استعادة نسخة"}
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Previous Backups */}
      <Card>
        <CardContent className="p-6">
          <h3 className="font-semibold mb-4">{bt.previousBackups || "النسخ الاحتياطية السابقة"}</h3>
          {!backups || backups.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
              <Database className="w-12 h-12 mb-3 opacity-40" />
              <p className="text-sm">{bt.noBackups || "لا توجد نسخ احتياطية سابقة"}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {backups.map((backup: any) => (
                <div key={backup.id} className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50 transition-colors">
                  <div className="flex items-center gap-3">
                    <Database className="w-5 h-5 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium">{formatDate(backup.createdAt)}</p>
                      <p className="text-xs text-muted-foreground">
                        {backup.tablesCount} {bt.tables || "جداول"} · {backup.totalRecords} {bt.records || "سجلات"}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {getStatusBadge(backup.status)}
                    {backup.status === "completed" && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setRestoreId(backup.id)}
                      >
                        {bt.restore || "استعادة"}
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Restore Confirmation Dialog */}
      <AlertDialog open={!!restoreId} onOpenChange={(open) => !open && setRestoreId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{bt.restoreBackup || "استعادة نسخة احتياطية"}</AlertDialogTitle>
            <AlertDialogDescription>
              {bt.confirmRestore || "هل أنت متأكد من استعادة هذه النسخة؟ سيتم استبدال البيانات الحالية."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.common.cancel}</AlertDialogCancel>
            <AlertDialogAction onClick={handleRestore} disabled={restoreMut.isPending}>
              {restoreMut.isPending ? <Loader2 className="w-4 h-4 animate-spin ml-2" /> : null}
              {bt.restore || "استعادة"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
