import { useAuth } from "@/_core/hooks/useAuth";
import { SupplierReturns } from "@/components/purchase/SupplierReturns";
import { canRoleAccessPath } from "@shared/roles";

/** Dedicated entry into the same assigned-case reader and action guards. */
export default function WarehouseReturnFollowup() {
  const { user, loading } = useAuth();
  if (loading) return <p className="p-6">جارٍ تحميل الحساب…</p>;
  if (!canRoleAccessPath(user?.role, "/warehouse-returns-followup")) {
    return <p role="alert" className="p-6 text-destructive">ليس لديك صلاحية لهذه الصفحة.</p>;
  }
  return <main className="space-y-4 p-4 sm:p-6" dir="rtl">
    <h1 className="text-xl font-bold">مرتجعات المستودع</h1>
    <p className="text-sm text-muted-foreground">تأكيد استلام المرتجعات ومتابعة التعويض أو الاسترداد. تبقى المعاملة معلقة حتى اتخاذ الإجراء المطلوب.</p>
    <SupplierReturns />
  </main>;
}
