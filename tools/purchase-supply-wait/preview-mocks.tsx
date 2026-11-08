import { useSyncExternalStore } from "react";
let revision = 0;
const listeners = new Set<() => void>();
const state: any = { role: "delegate", offset: 0, note: null };
const tick = () => { revision++; listeners.forEach(listener => listener()); };
const subscribe = (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); };
const read = () => revision;
const watch = () => useSyncExternalStore(subscribe, read, read);
export const preview = { state, tick };
const identity = () => ({ id: state.role === "warehouse" ? 20 : state.role === "senior_management" ? 30 : state.role === "admin" ? 1 : 10, role: state.role, isActive: 1 });
export const useAuth = () => { watch(); return { user: identity(), authenticatedUser: identity() }; };
export const useTranslation = () => ({ language: "ar" as const });
export const independentReadOptions = {};
export const localizeApiError = (value: string) => value;
export const trpc = {
  useQueries: (factory: any) => {
    watch();
    const actor = identity(), now = Date.now() + state.offset;
    const admin = actor.role === "admin", delegate = actor.role === "delegate" || actor.role === "delegate_manager";
    const deadline = state.note ? Date.parse(state.note.createdAt) + 7200000 : 0;
    return factory({ purchaseSupplyWait: { list: (input: any) => ({ dataUpdatedAt: Date.now(), isError: false,
      data: { available: true, viewerId: actor.id, viewerRole: actor.role, serverNow: new Date(now).toISOString(), items: input.items.map((item: any) => ({ ...item,
        canCreate: !state.note && (admin || delegate), note: state.note && (admin || delegate || now >= deadline)
          ? { ...state.note, editableUntil: new Date(deadline).toISOString(), canEdit: admin || delegate && now < deadline } : null,
      })) } }) } });
  },
  useUtils: () => ({ purchaseSupplyWait: { invalidate: async () => { tick(); } } }),
  purchaseSupplyWait: { save: { useMutation: (options: any) => ({ isPending: false, mutate: (input: any) => {
    const actor = identity(), now = new Date(Date.now() + state.offset).toISOString();
    state.note = { ...input, createdById: state.note?.createdById ?? actor.id, createdByName: state.note?.createdByName ?? "عبدالعزيز — معاينة",
      createdAt: state.note?.createdAt ?? now, updatedById: actor.id, updatedByName: "حساب المعاينة", updatedAt: now, revision: state.note ? state.note.revision + 1 : 0 };
    tick(); void options.onSuccess();
  } }) } },
};
