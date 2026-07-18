import { useEffect } from "react";
import { useRoute, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Loader2, PackageX, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

// ── صفحة تحويل NFC/RFID ──
// الرابط المكتوب على شريحة NFC (خصوصاً للآيفون، حيث لا يوجد Web NFC) يشير هنا:
//   https://دومينك.com/tag/16
// حيث "16" هو نفس رقم "بطاقة RFID" المسجّل على الأصل داخل النظام
// (وليس المعرّف الداخلي لقاعدة البيانات). هذه الصفحة تبحث عن الأصل بهذا الرقم
// وتحوّل المستخدم تلقائياً لصفحة تفاصيله الفعلية /asset/:id
export default function NfcRedirect() {
  const [, params] = useRoute("/tag/:rfidTag");
  const [, navigate] = useLocation();
  const rfidTag = params?.rfidTag ?? "";

  const { data, isLoading, isError } = trpc.nfc.lookupTag.useQuery(
    { rfidTag },
    { enabled: !!rfidTag, retry: false }
  );

  useEffect(() => {
    if (data?.asset?.id) {
      navigate(`/asset/${data.asset.id}`, { replace: true });
    }
  }, [data, navigate]);

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] gap-3 text-muted-foreground">
        <Loader2 className="w-8 h-8 animate-spin" />
        <p className="text-sm">جاري البحث عن الأصل رقم {rfidTag}...</p>
      </div>
    );
  }

  if (isError || (data === null)) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] gap-4 text-center px-4">
        <PackageX className="w-12 h-12 text-muted-foreground/40" />
        <div>
          <h2 className="font-semibold text-lg mb-1">الأصل غير موجود</h2>
          <p className="text-sm text-muted-foreground">
            لا يوجد أصل مسجّل ببطاقة RFID رقم <span className="font-mono">{rfidTag}</span>.
            <br />تأكد من تسجيل الرقاقة على الأصل الصحيح داخل النظام أولاً.
          </p>
        </div>
        <Button variant="outline" onClick={() => navigate("/assets")} className="gap-2">
          <ArrowRight className="w-4 h-4" />
          الذهاب لقائمة الأصول
        </Button>
      </div>
    );
  }

  // بمجرد نجاح البحث، الـ useEffect أعلاه سيحوّل المستخدم تلقائياً
  return (
    <div className="flex flex-col items-center justify-center h-[60vh] gap-3 text-muted-foreground">
      <Loader2 className="w-8 h-8 animate-spin" />
      <p className="text-sm">جاري التحويل...</p>
    </div>
  );
}
