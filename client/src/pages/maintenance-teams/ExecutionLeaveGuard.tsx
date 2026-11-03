import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  type ReactNode,
} from "react";

const LeaveContext = createContext<{
  setDirty: (id: string, value: boolean) => void;
  canLeave: () => boolean;
} | null>(null);

/** Drafts stay local. This guard never saves or changes the execution workflow. */
export function ExecutionLeaveGuard({
  language,
  busy,
  children,
}: {
  language: string;
  busy: boolean;
  children: ReactNode;
}) {
  const dirty = useRef(new Set<string>());
  const setDirty = useCallback((id: string, value: boolean) => {
    if (value) dirty.current.add(id);
    else dirty.current.delete(id);
  }, []);
  const canLeave = useCallback(() => {
    if (busy) return false;
    if (!dirty.current.size) return true;
    const discard = window.confirm(
      language === "ar"
        ? "لديك تغييرات غير محفوظة. هل تريد المغادرة دون حفظ؟ اختر إلغاء للبقاء والحفظ."
        : language === "ur"
          ? "آپ کی تبدیلیاں محفوظ نہیں ہوئیں۔ محفوظ کیے بغیر واپس جائیں؟ رکنے اور محفوظ کرنے کے لیے منسوخ کریں۔"
          : "You have unsaved changes. Leave without saving? Cancel to stay and save."
    );
    if (discard) dirty.current.clear();
    return discard;
  }, [busy, language]);
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => {
      if (!dirty.current.size && !busy) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", unload);
    return () => window.removeEventListener("beforeunload", unload);
  }, [busy]);
  useEffect(() => {
    const click = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return;
      const navigation = event.target.closest(
        "[data-observer-navigation] [data-slot='sidebar-menu-button'], a[href]"
      );
      if (
        !navigation ||
        event.defaultPrevented ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const link = navigation.closest("a");
      if (
        link &&
        (link.target === "_blank" ||
          link.hasAttribute("download") ||
          link.href === window.location.href ||
          link.getAttribute("href")?.startsWith("#"))
      )
        return;
      if (!canLeave()) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    document.addEventListener("click", click, true);
    return () => {
      document.removeEventListener("click", click, true);
    };
  }, [canLeave]);
  return (
    <LeaveContext.Provider value={{ setDirty, canLeave }}>
      {children}
    </LeaveContext.Provider>
  );
}

export function useExecutionDraftDirty(dirty: boolean) {
  const id = useId(),
    context = useContext(LeaveContext);
  const setDirty = context?.setDirty;
  useEffect(() => {
    setDirty?.(id, dirty);
    return () => setDirty?.(id, false);
  }, [id, dirty, setDirty]);
}

export function useExecutionCanLeave() {
  const context = useContext(LeaveContext);
  return context?.canLeave ?? (() => true);
}
