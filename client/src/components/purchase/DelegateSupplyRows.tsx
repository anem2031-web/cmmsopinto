import { SupplyWaitExplanation } from "./SupplyWaitExplanation";
import { Link } from "wouter";
import { delegateSupplyStage } from "@shared/delegateSupplyStage";
import { delegateFollowupText } from "@/i18n/delegateFollowup";
import { useTranslation } from "@/contexts/LanguageContext";
import { getLocalizedItemField } from "@/hooks/useContentTranslation";
export function DelegateSupplyRows({ items }: { items: any[] }) {
  const { language } = useTranslation(); const text = delegateFollowupText[language];
  return <div className="rounded-xl border bg-card overflow-hidden"><table className="w-full text-sm"><thead className="bg-muted/50"><tr><th className="p-3 text-start">{text.item}</th><th className="p-3 text-start">{text.stage}</th></tr></thead><tbody>{items.map(item => {
    const key = delegateSupplyStage(item) as keyof typeof text.stages;
    return <tr key={item.id} className="border-t hover:bg-muted/30"><td className="p-3"><Link className="font-medium text-primary hover:underline break-words" href={`/purchase-orders/${item.purchaseOrderId}?itemId=${item.id}&source=supply`}>{getLocalizedItemField(item, "itemName", language) || item.itemName}</Link><SupplyWaitExplanation itemId={item.id} purchaseOrderId={item.purchaseOrderId} /></td><td className="p-3">{text.stages[key] || text.stages.unknown}</td></tr>;
  })}</tbody></table></div>;
}
