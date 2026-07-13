import { Button } from "@/components/ui/button";
import { Download, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "@/contexts/LanguageContext";

interface ExportButtonProps {
  endpoint: string;
  filename: string;
  label?: string;
  params?: Record<string, string>;
  variant?: "default" | "outline" | "ghost" | "secondary";
  size?: "default" | "sm" | "lg" | "icon";
}

export function ExportButton({ endpoint, filename, label, params, variant = "outline", size = "sm" }: ExportButtonProps) {
  const [loading, setLoading] = useState(false);
  const { t } = useTranslation();

  const handleExport = async () => {
    setLoading(true);
    try {
      const queryStr = params ? "?" + new URLSearchParams(params).toString() : "";
      const response = await fetch(`/api/export/${endpoint}${queryStr}`);
      if (!response.ok) throw new Error("Export failed");
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${filename}-${new Date().toISOString().split("T")[0]}.xlsx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      toast.success(t.common.savedSuccessfully);
    } catch {
      toast.error(t.common.close);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button variant={variant} size={size} onClick={handleExport} disabled={loading} className="gap-1.5">
      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
      {label || t.common.export || "تصدير Excel"}
    </Button>
  );
}
