import { useTranslation } from "@/contexts/LanguageContext";
import { getCatalogError } from "@/i18n/catalogUi";
import { getCatalogItemsText } from "@/i18n/catalogItems";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Download, Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

function downloadBase64Excel(buffer: string, fileName: string) {
  const link = document.createElement("a");
  link.href = `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${buffer}`;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export default function CatalogExportButton({
  search,
  nodeIds,
  includeInactive,
}: {
  search?: string;
  nodeIds?: number[];
  includeInactive?: boolean;
}) {
  const { language } = useTranslation();
  const text = getCatalogItemsText(language);
  const [loading, setLoading] = useState(false);
  const exportMutation = trpc.catalog.importExport.exportItemsExcel.useMutation();

  const handleExport = async () => {
    setLoading(true);
    try {
      const result = await exportMutation.mutateAsync({
        search: search?.trim() || undefined,
        nodeIds: nodeIds && nodeIds.length > 0 ? nodeIds : undefined,
        includeInactive,
      });

      downloadBase64Excel(result.buffer, result.fileName);
      toast.success(text.exportSuccess);
    } catch (err: any) {
      toast.error(getCatalogError(err, language, text.exportFailed));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button variant="outline" onClick={handleExport} disabled={loading}>
      {loading
        ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
        : <Download className="h-4 w-4 mr-2" />}
      {text.exportExcel}
    </Button>
  );
}
