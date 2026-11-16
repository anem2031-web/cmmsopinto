import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PurchaseOrderSourceReference } from "./PurchaseOrderSourceReference";
import { Boxes, ChevronDown, ChevronLeft, ChevronRight, Package, User } from "lucide-react";
import { useState } from "react";
import { useStaticLabels } from "@/hooks/useContentTranslation";
import { useLanguage } from "@/contexts/LanguageContext";

// ============================================================
// [PB] بطاقة حزمة الشراء — مكوّن عرض بحت (2026-08-29)
//
// المبدأ الحاكم: "البطاقة تغيّر ما يُعرض وكيف يُجمّع، ولا تغيّر ما يُستدعى".
// هذا المكوّن لا يستدعي أي إجراء ولا يعرف شيئًا عن الـWorkflow — يستقبل
// بيانات جاهزة ويعرضها. كل زر إجراء يُمرَّر إليه من الشاشة المضيفة.
//
// التصميم البصري مطابق لبطاقة الطلب المفرد في PurchaseOrders.tsx حتى
// تبدو القائمة الموحّدة متجانسة، لا كأنها شاشتان مدموجتان.
// ============================================================

const PO_STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  pending_review: "bg-blue-100 text-blue-700",
  pending_estimate: "bg-amber-100 text-amber-700",
  pending_accounting: "bg-orange-100 text-orange-700",
  pending_management: "bg-orange-100 text-orange-700",
  approved: "bg-teal-100 text-teal-700",
  partial_purchase: "bg-cyan-100 text-cyan-700",
  purchased: "bg-emerald-100 text-emerald-700",
  received: "bg-green-100 text-green-700",
  closed: "bg-gray-100 text-gray-700",
  rejected: "bg-red-100 text-red-700",
};

export interface PackageOrder {
  id: number;
  poNumber: string;
  status: string;
  createdAt: string | Date;
  items?: any[];
  sourceSystem?: string | null;
  sourceReference?: string | null;
  [key: string]: any;
}

export interface PurchaseBatchCardProps {
  /** رقم الحزمة المعروض للمستخدم، مثال: PB-2026-00001 */
  packageNumber: string;
  createdAt: string | Date;
  orders: PackageOrder[];
  /** فتح بطاقة الحزمة (صفحة التفاصيل) */
  onOpen?: () => void;
  /** فتح طلب بعينه من داخل الحزمة */
  onOpenOrder?: (orderId: number) => void;
  /** أزرار إجراءات تُمرَّر من الشاشة المضيفة — البطاقة لا تعرف محتواها */
  actions?: React.ReactNode;
  /** فتح قائمة الطلبات افتراضيًا */
  defaultExpanded?: boolean;
  locale?: string;
}

export function PurchaseBatchCard({
  packageNumber,
  createdAt,
  orders,
  onOpen,
  onOpenOrder,
  actions,
  defaultExpanded = false,
  locale = "ar",
}: PurchaseBatchCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const { getPOStatusLabel } = useStaticLabels();
  const { t, language, dir } = useLanguage();
  const w = t.workflow.purchase;
  const countText = (template: string, count: number) => template.replace("{count}", String(count));
  const effectiveLocale = locale === "ar" ? (language === "en" ? "en-US" : language === "ur" ? "ur-PK" : "ar-SA") : locale;

  const totalItems = orders.reduce((sum, o) => sum + (o.items?.length ?? 0), 0);

  return (
    <Card className="hover:shadow-lg hover:border-primary/20 transition-all duration-200 border-primary/30">
      <CardContent className="p-4">
        {/* رأس الحزمة */}
        <div className="flex items-center justify-between gap-4">
          <div
            className="flex-1 min-w-0 cursor-pointer"
            onClick={() => (onOpen ? onOpen() : setExpanded(!expanded))}
          >
            <div className="flex items-center gap-2 mb-1">
              <Boxes className="w-4 h-4 text-primary shrink-0" />
              <span className="text-sm font-semibold font-mono">{packageNumber}</span>
              <Badge variant="secondary" className="text-[10px]">
                {countText(w.packageOrdersCount, orders.length)}
              </Badge>
            </div>
            <div className="flex items-center gap-4 text-xs text-muted-foreground mt-1 flex-wrap">
              <span className="flex items-center gap-1">
                <Package className="w-3 h-3" />
                {countText(w.packageItemsCount, totalItems)}
              </span>
              <span>{new Date(createdAt).toLocaleDateString(effectiveLocale)}</span>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {actions}
            <button
              type="button"
              className="p-1 rounded hover:bg-muted transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                setExpanded(!expanded);
              }}
              aria-label={expanded ? w.collapseOrders : w.showOrders}
            >
              {expanded ? <ChevronDown className="w-4 h-4" /> : (dir === "rtl" ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />)}
            </button>
          </div>
        </div>

        {/* طلبات الحزمة — كل طلب بهويته ورقمه وحالته المستقلة */}
        {expanded && (
          <div className="mt-3 pt-3 border-t space-y-2">
            {orders.map((po) => (
              <div
                key={po.id}
                className="flex items-center justify-between gap-3 px-3 py-2 rounded-md bg-muted/40 hover:bg-muted transition-colors cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenOrder?.(po.id);
                }}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-xs font-mono text-muted-foreground shrink-0">
                      {po.poNumber}
                    </span>
                    {po.requestedByName && (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground truncate">
                        <User className="w-3 h-3 shrink-0" />
                        {po.requestedByName}
                      </span>
                    )}
                    <span className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
                      <Package className="w-3 h-3" />
                      {po.items?.length ?? 0}
                    </span>
                  </div>
                  <PurchaseOrderSourceReference order={po} />
                </div>
                <Badge
                  className={`status-badge shrink-0 ${
                    PO_STATUS_COLORS[po.status] || "bg-gray-100 text-gray-700"
                  }`}
                >
                  {getPOStatusLabel(po.status)}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default PurchaseBatchCard;
