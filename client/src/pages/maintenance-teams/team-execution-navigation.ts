import { useEffect } from "react";
import { useLocation, useSearch } from "wouter";
import { readHistoryEntryState, writeHistoryEntryState } from "@/lib/backStack";

const LIST_SCROLL = "teamTicketListScroll";
export function useOpenTeamExecution() {
  const [path, navigate] = useLocation();
  const search = useSearch();
  return (assignmentId: number) => {
    writeHistoryEntryState(LIST_SCROLL, window.scrollY);
    const params = new URLSearchParams(search);
    params.set("teamExecution", String(assignmentId));
    navigate(`${path}?${params}`, {
      state: { fromTeamTicketList: true },
    });
  };
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
