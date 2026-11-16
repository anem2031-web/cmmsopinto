import { FileText } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { useLanguage } from "@/contexts/LanguageContext";

interface PurchaseOrderSourceReferenceProps {
  order: {
    sourceSystem?: string | null;
    sourceReference?: string | null;
  };
  detail?: boolean;
}

export function PurchaseOrderSourceReference({
  order,
  detail,
}: PurchaseOrderSourceReferenceProps) {
  const { t } = useLanguage();
  if (order.sourceSystem !== "PSCM" || !order.sourceReference) return null;

  const reference = (
    <span className="inline-flex flex-wrap items-baseline gap-x-1.5">
      <span>{t.purchaseOrders.relatedPscmRequisition}</span>
      <bdi dir="ltr" className="font-mono font-semibold break-all">
        {order.sourceReference}
      </bdi>
    </span>
  );

  if (detail) {
    return (
      <Card className="border-teal-200 bg-teal-50/50 py-0 dark:border-teal-900 dark:bg-teal-950/40">
        <CardContent className="flex items-center gap-3 p-3 text-sm font-medium text-teal-800 dark:text-teal-200">
          <FileText className="size-4 shrink-0" aria-hidden="true" />
          {reference}
        </CardContent>
      </Card>
    );
  }

  return <span className="text-xs text-muted-foreground">{reference}</span>;
}
