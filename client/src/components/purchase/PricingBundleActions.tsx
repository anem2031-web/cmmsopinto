import { isDelegateRole } from "@shared/roles";
import { Link } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { useTranslation } from "@/contexts/LanguageContext";
import { Button } from "@/components/ui/button";
import { pricingBundleText } from "@/i18n/pricingBundles";
import { toast } from "sonner";
export function PricingBundleLink() {
  const { user } = useAuth(); const { language } = useTranslation();
  const status = trpc.delegatePricingBundles.status.useQuery(undefined, { enabled: isDelegateRole(user?.role), retry: false });
  if (!isDelegateRole(user?.role) || !status.data?.enabled) return null;
  return <Link href="/delegate-pricing-bundles"><Button variant="outline">{pricingBundleText[language].title}</Button></Link>;
}
export function PricingBundleAddButton({ itemId }: { itemId: number }) {
  const { user } = useAuth(); const { language } = useTranslation(); const text = pricingBundleText[language]; const utils = trpc.useUtils();
  const status = trpc.delegatePricingBundles.status.useQuery(undefined, { enabled: isDelegateRole(user?.role), retry: false });
  const list = trpc.delegatePricingBundles.list.useQuery(undefined, { enabled: isDelegateRole(user?.role) && status.data?.enabled === true });
  const open = list.data?.find((bundle: any) => bundle.status === "open");
  const detail = trpc.delegatePricingBundles.detail.useQuery({ id: Number(open?.id || 0) }, { enabled: !!open });
  const member = detail.data?.items.some((item: any) => item.id === itemId);
  const add = trpc.delegatePricingBundles.add.useMutation({ onSuccess: async () => {
    toast.success(text.saved);
    await Promise.all([utils.delegatePricingBundles.invalidate(), utils.purchaseOrders.invalidate()]);
  }, onError: error => toast.error(error.message) });
  if (!isDelegateRole(user?.role) || !status.data?.enabled) return null;
  return <span onClick={event => event.stopPropagation()}>{member ? <Link href="/delegate-pricing-bundles"><Button size="sm" variant="outline">{text.added}</Button></Link> : <Button size="sm" className="bg-teal-700 hover:bg-teal-800" disabled={add.isPending || list.isLoading || (!!open && detail.isLoading)} onClick={() => add.mutate({ itemId })}>{text.add}</Button>}</span>;
}
