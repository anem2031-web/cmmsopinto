import { useEffect } from "react";
import { useLocation, useSearch } from "wouter";
import { readHistoryEntryState, writeHistoryEntryState } from "@/lib/backStack";

const LIST_SCROLL = "teamTicketListScroll";
function useOpenTicketExecution(parameter: "teamExecution" | "itExecution") {
  const [path, navigate] = useLocation();
  const search = useSearch();
  return (id: number) => {
    writeHistoryEntryState(
      LIST_SCROLL,
      typeof window === "undefined" ? 0 : window.scrollY
    );
    const params = new URLSearchParams(search);
    params.delete(
      parameter === "teamExecution" ? "itExecution" : "teamExecution"
    );
    params.set(parameter, String(id));
    navigate(`${path}?${params}`, {
      state: { fromTeamTicketList: true },
    });
  };
}

export function useOpenTeamExecution() {
  return useOpenTicketExecution("teamExecution");
}
export function useOpenItExecution() {
  return useOpenTicketExecution("itExecution");
}

export function useRestoreTeamTicketList(ready: boolean) {
  useEffect(() => {
    if (!ready) return;
    const y = readHistoryEntryState<number>(LIST_SCROLL);
    if (typeof y !== "number") return;
    const frame = window.requestAnimationFrame(() => window.scrollTo(0, y));
    return () => window.cancelAnimationFrame(frame);
  }, [ready]);
}
