import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { pricingBundleText } from "../../client/src/i18n/pricingBundles";
const state = vi.hoisted(() => ({ language: "ar", role: "delegate", enabled: true, status: "open", member: false, pending: "", approved: false }));
vi.mock("../../client/src/_core/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: 11, role: state.role, isActive: 1 } }) }));
vi.mock("../../client/src/contexts/LanguageContext", () => ({ useTranslation: () => ({ language: state.language, dir: state.language === "en" ? "ltr" : "rtl" }) }));
vi.mock("wouter", () => ({ useSearch: () => "", Link: ({ href, children, ...props }: any) => <a href={href} {...props}>{children}</a> }));
vi.mock("../../client/src/lib/trpc", () => {
  const proxy = (path = ""): any => new Proxy(() => {}, { get(_target, key) {
    if (key === "useUtils") return () => proxy("utils");
    if (key === "useMutation") return () => ({ isPending: path.endsWith(`.${state.pending}`), mutate: vi.fn() });
    if (key === "invalidate") return vi.fn();
    if (key === "useQuery") return () => ({ data: path.endsWith(".status") ? { enabled: state.enabled } : path.endsWith(".list") ? [{ id: 1, bundleNumber: "DPB-2026-000001", status: state.status, itemCount: 2, total:45, createdAt:"2026-10-18T08:00:00Z" }]
      : path.endsWith(".detail") ? { id: 1, bundleNumber: "DPB-2026-000001", status: state.status, revision: 2, delegateName: "Delegate fixture", createdAt: "2026-10-17T12:00:00Z", effectsDone: 1, total: 45, pdfAllowed: !["accountant", "senior_management"].includes(state.role) || state.approved,
        items: [{ id: state.member ? 5 : 1, itemName: "مادة الاختبار", categoryName: "الكهرباء", purchaseOrderId: 101, poNumber: "PR-101", sectionName: "Section A", quantity: 3, unit: "قطعة", estimatedUnitCost: "10", estimatedTotalCost: "30", supplierName: "Supplier A" },
          { id: 2, itemName: "Test material", categoryName: "Plumbing", purchaseOrderId: 102, poNumber: "PR-102", sectionName: "Section B", quantity: 1, unit: "Piece", estimatedUnitCost: "15", estimatedTotalCost: "15", supplierName: "Supplier B" }] } : [], isLoading: false, error: null });
    return proxy(path ? `${path}.${String(key)}` : String(key));
  } });
  return { trpc: proxy() };
});
import DelegatePricingBundles from "../../client/src/pages/purchase/DelegatePricingBundles";
import { PricingBundleAddButton, PricingBundleLink } from "../../client/src/components/purchase/PricingBundleActions";
describe("Real pricing bundle page and delegate controls", () => {
  it.each(["accountant", "senior_management"])("keeps %s reviewing structured items until exact approval, then permits PDF", role => {
    state.language = "ar"; state.role = role; state.status = "archived"; state.enabled = true; state.approved = false;
    const pending = renderToStaticMarkup(<DelegatePricingBundles />);
    expect(pending).toContain("PR-101"); expect(pending).toContain("Supplier A");
    expect(pending).not.toContain(pricingBundleText.ar.pdf);
    expect(pending).not.toContain(pricingBundleText.ar.send);
    expect(pending).not.toContain(pricingBundleText.ar.back);
    state.approved = true;
    expect(renderToStaticMarkup(<DelegatePricingBundles />)).toContain(pricingBundleText.ar.pdf);
  });
  it.each(["ar", "en", "ur"])("renders original PR/section/prices/supplier and open actions in %s", language => {
    state.language = language; state.role = "delegate"; state.status = "open"; state.enabled = true;
    const text = pricingBundleText[language as keyof typeof pricingBundleText], html = renderToStaticMarkup(<DelegatePricingBundles />);
    for (const value of [text.title, text.send, text.back, text.price, text.supplier, "DPB-2026-000001", "PR-101", "PR-102", "Section A", "Section B", "Supplier A"]) expect(html).toContain(value);
    expect(html).not.toContain("<input"); expect(html).toContain("/purchase-orders/102?itemId=2");
    expect(html).not.toContain(text.pdf); expect(html).not.toContain("<iframe");
    expect(html).toContain(text.number); expect(html).toContain(text.date); expect(html).toContain(text.archiveList);
  });
  it.each(["ar","en","ur"])("offers download after send/archival without an archive action or iframe in %s",language=>{
    state.enabled=true; state.language=language; state.role="delegate";
    const text=pricingBundleText[language as keyof typeof pricingBundleText];
    for(const status of ["sent","archived"]){state.status=status;const html=renderToStaticMarkup(<DelegatePricingBundles/>);
      expect(html).toContain(text.pdf); expect(html).not.toContain(`<iframe`); expect(html).not.toContain(text.send); expect(html).toContain(text.archiveList);
    }
  });
  it("shows a pending action for sending and preparing a download",()=>{
    state.enabled=true;state.language="ar";state.role="delegate";state.status="open";state.pending="send";
    expect(renderToStaticMarkup(<DelegatePricingBundles/>)).toContain(pricingBundleText.ar.sending);
    state.status="sent";state.pending="pdf";
    expect(renderToStaticMarkup(<DelegatePricingBundles/>)).toContain(pricingBundleText.ar.preparingPdf);state.pending="";
  });
  it("keeps observer read-only with no PDF export or mutations, and hides sent editing actions", () => {
    state.language = "ar"; state.role = "observer"; state.status = "sent"; const html = renderToStaticMarkup(<DelegatePricingBundles />);
    expect(html).toContain("PR-101"); for (const action of [pricingBundleText.ar.send, pricingBundleText.ar.back, pricingBundleText.ar.pdf]) expect(html).not.toContain(action);
    state.role = "delegate"; const sent = renderToStaticMarkup(<DelegatePricingBundles />); expect(sent).toContain(pricingBundleText.ar.pdf); expect(sent).not.toContain(pricingBundleText.ar.back);
  });
  it("mounts no new data screen before manual rollout", () => {
    state.enabled = false; state.role = "delegate"; expect(renderToStaticMarkup(<DelegatePricingBundles />)).toContain(pricingBundleText.ar.disabled);
    expect(renderToStaticMarkup(<PricingBundleLink />)).toBe(""); expect(renderToStaticMarkup(<PricingBundleAddButton itemId={5} />)).toBe("");
  });
  it("shows add only to delegates; a reserved member links to its bundle", () => {
    state.enabled = true; state.status = "open"; state.role = "delegate"; state.member = false;
    expect(renderToStaticMarkup(<PricingBundleAddButton itemId={5} />)).toContain(pricingBundleText.ar.add);
    state.member = true; expect(renderToStaticMarkup(<PricingBundleAddButton itemId={5} />)).toContain(pricingBundleText.ar.added);
    state.role = "warehouse"; expect(renderToStaticMarkup(<PricingBundleAddButton itemId={5} />)).toBe("");
  });
});
