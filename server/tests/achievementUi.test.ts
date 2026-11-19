import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("../../client/src/lib/trpc", () => ({ trpc: { achievement: {
  purchaseItems: { useQuery: () => ({ isLoading: false, data: { items: [{
    id: 1, itemName: "مصباح LED", poNumber: "PR-123", quantity: 1, unit: "قطعة",
    status: "pending", orderStatus: "pending_estimate", delegateName: "عمر", delegateRole: "delegate",
    submittedAt: "2026-11-11T17:00:00Z", delegateWaitStartedAt: "2026-11-13T05:00:00Z",
    ticketNumbers: ["MT-123"], ticketEvidenceAvailable: true, issues: [],
  }], nextId: null } }) },
  purchaseItem: { useQuery: () => ({ isLoading: true }) },
} } }));
import Achievement from "../../client/src/pages/achievement/Achievement";

afterEach(() => vi.useRealTimers());
it("shows the authorized purchase-item summary with total age and current delegate wait", () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-13T09:00:00Z"));
  const html = renderToStaticMarkup(React.createElement(Achievement));
  for (const text of ["وحدة الإنجاز", "طلبات الشراء", "مصباح LED", "PR-123", "MT-123", "40 ساعة", "عمر", "4 ساعة"])
    expect(html).toContain(text);
  expect(html).not.toContain("تم صرفه");
});
