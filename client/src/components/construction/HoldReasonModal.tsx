import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { AlertTriangle } from "lucide-react";

const HOLD_REASONS = [
  { value: "weather",          label: "🌧 طقس", desc: "أمطار، رياح، حرارة شديدة" },
  { value: "pending_approval", label: "✋ انتظار اعتماد", desc: "بانتظار موافقة المهندس أو الإدارة" },
  { value: "subcontractor",    label: "🔨 مقاول فرعي", desc: "تأخر المقاول الفرعي أو غيابه" },
  { value: "administrative",   label: "📋 إداري", desc: "قرار إداري أو ظرف تنظيمي" },
  { value: "other",            label: "⏸ أخرى", desc: "سبب آخر — يُرجى التوضيح" },
];

interface HoldReasonModalProps {
  onConfirm: (reason: string, note: string) => void;
  onCancel: () => void;
}

export default function HoldReasonModal({ onConfirm, onCancel }: HoldReasonModalProps) {
  const [selected, setSelected] = useState<string>("");
  const [note, setNote] = useState("");

  const canConfirm = !!selected && (selected !== "other" || note.trim().length > 0);

  return (
    <Dialog open onOpenChange={onCancel}>
      <DialogContent className="max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[#DC2626]">
            <AlertTriangle className="w-5 h-5" />
            تحديد سبب التوقف
          </DialogTitle>
          <DialogDescription className="text-slate-500 text-sm">
            يجب تحديد سبب التوقف قبل تغيير الحالة. هذا إلزامي لأغراض التقارير.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <Label className="text-sm font-medium text-[#1A2B4A]">سبب التوقف *</Label>
          <div className="space-y-2">
            {HOLD_REASONS.map(reason => (
              <button
                key={reason.value}
                onClick={() => setSelected(reason.value)}
                className={`w-full text-right p-3 rounded-lg border-2 transition-all ${
                  selected === reason.value
                    ? "border-[#DC2626] bg-red-50"
                    : "border-slate-200 hover:border-slate-300 bg-white"
                }`}
              >
                <p className="font-medium text-sm text-[#1A2B4A]">{reason.label}</p>
                <p className="text-xs text-slate-400 mt-0.5">{reason.desc}</p>
              </button>
            ))}
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm font-medium text-[#1A2B4A]">
              ملاحظة {selected === "other" ? "*" : "(اختياري)"}
            </Label>
            <Textarea
              placeholder="أضف تفاصيل إضافية..."
              value={note}
              onChange={e => setNote(e.target.value)}
              rows={3}
              className="text-right resize-none"
            />
          </div>
        </div>

        <DialogFooter className="gap-2 flex-row-reverse">
          <Button
            onClick={() => canConfirm && onConfirm(selected, note)}
            disabled={!canConfirm}
            className="bg-[#DC2626] hover:bg-red-700 text-white"
          >
            تأكيد التوقف
          </Button>
          <Button variant="outline" onClick={onCancel}>إلغاء</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
