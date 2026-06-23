import { useRef } from "react";
import { Tldraw } from "tldraw";
import "tldraw/tldraw.css";
import { Button } from "@/components/ui/button";
import { Info } from "lucide-react";
import { toast } from "sonner";

interface Props {
  projectId: number;
}

export default function ProjectWhiteboard({ projectId }: Props) {
  const editorRef = useRef<any>(null);

  const handleExport = async () => {
    try {
      const editor = editorRef.current;
      if (!editor) { toast.error("اللوحة غير جاهزة بعد"); return; }
      const shapeIds = Array.from(editor.getCurrentPageShapeIds() as Set<string>);
      if (shapeIds.length === 0) { toast.info("لا يوجد محتوى للتصدير"); return; }
      const result = await editor.getSvgString(shapeIds, { padding: 32 });
      if (!result?.svg) { toast.error("فشل التصدير"); return; }
      const blob = new Blob([result.svg], { type: "image/svg+xml" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `whiteboard-project-${projectId}.svg`; a.click();
      URL.revokeObjectURL(url);
      toast.success("تم تصدير اللوحة بصيغة SVG");
    } catch {
      toast.error("فشل في التصدير");
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 flex-1">
          <Info className="w-3.5 h-3.5 flex-shrink-0" />
          <span>
            ارسم، أضف ملاحظات، أو ارفع مخطط هندسي كخلفية. التغييرات تُحفظ محلياً في المتصفح.
          </span>
        </div>
        <Button size="sm" variant="outline" onClick={handleExport} className="gap-1.5 text-xs flex-shrink-0">
          تصدير SVG
        </Button>
      </div>
      <div
        className="w-full rounded-xl overflow-hidden border border-slate-200 shadow-sm"
        style={{ height: "calc(100vh - 300px)", minHeight: "500px" }}
      >
        <Tldraw
          persistenceKey={`construction-wb-${projectId}`}
          onMount={(editor) => { editorRef.current = editor; }}
        />
      </div>
    </div>
  );
}
