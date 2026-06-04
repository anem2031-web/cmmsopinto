import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Download, Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

export default function CatalogExportButton() {

  const [loading, setLoading] = useState(false);

  // mutation بدل useQuery — يضمن التنفيذ الفوري عند الضغط
  const exportMutation = trpc.catalog.importExport.exportExcel.useMutation();

  const handleExport = async () => {
    setLoading(true);
    try {
      const result = await exportMutation.mutateAsync();

      const link    = document.createElement("a");
      link.href     = `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${result.buffer}`;
      link.download = result.fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      toast.success("تم تصدير الكتالوج بنجاح");

    } catch (err: any) {
      toast.error(err.message ?? "حدث خطأ أثناء التصدير");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button
      variant="outline"
      onClick={handleExport}
      disabled={loading}
    >
      {loading
        ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
        : <Download className="h-4 w-4 mr-2" />
      }
      تصدير Excel
    </Button>
  );
}
