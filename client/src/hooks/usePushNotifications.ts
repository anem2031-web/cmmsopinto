import { useState, useEffect, useCallback } from "react";
import { trpc } from "@/lib/trpc";

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string;

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export type PushPermission = "default" | "granted" | "denied" | "unsupported";

export function usePushNotifications() {
  const [permission, setPermission] = useState<PushPermission>("default");
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!VAPID_PUBLIC_KEY) {
      console.error("[Push] VAPID Public Key is missing from environment variables!");
    }
  }, []);

  const subscribeMut = trpc.push.subscribe.useMutation();
  const unsubscribeMut = trpc.push.unsubscribe.useMutation();

  const isSupported =
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    !!VAPID_PUBLIC_KEY;

  useEffect(() => {
    if (!isSupported) {
      setPermission("unsupported");
      return;
    }
    setPermission(Notification.permission as PushPermission);

    // Check if already subscribed
    navigator.serviceWorker.ready.then((reg) => {
      reg.pushManager.getSubscription().then((sub) => {
        setIsSubscribed(!!sub);
      });
    });

    // Listen for subscription change messages from service worker
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === "PUSH_SUBSCRIPTION_CHANGED") {
        const sub = event.data.subscription;
        if (sub?.endpoint) {
          subscribeMut.mutate({
            endpoint: sub.endpoint,
            p256dh: sub.keys?.p256dh || "",
            auth: sub.keys?.auth || "",
            userAgent: navigator.userAgent,
          });
        }
      }
    };

    navigator.serviceWorker.addEventListener("message", handleMessage);
    return () => {
      navigator.serviceWorker.removeEventListener("message", handleMessage);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSupported]);

  const subscribe = useCallback(async () => {
    if (!isSupported) return false;
    setIsLoading(true);
    try {
      // Register service worker
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;

      // Request permission
      const perm = await Notification.requestPermission();
      setPermission(perm as PushPermission);
      if (perm !== "granted") return false;

      // Unsubscribe from any existing subscription first to avoid conflicts
      const existingSub = await reg.pushManager.getSubscription();
      if (existingSub) {
        await existingSub.unsubscribe();
      }

      // Subscribe to push
      console.log("[Push] Subscribing with key:", VAPID_PUBLIC_KEY);
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });

      const subJson = sub.toJSON();
      console.log("[Push] Subscription successful:", subJson.endpoint);
      await subscribeMut.mutateAsync({
        endpoint: subJson.endpoint!,
        p256dh: (subJson.keys as any)?.p256dh || "",
        auth: (subJson.keys as any)?.auth || "",
        userAgent: navigator.userAgent,
      });

      setIsSubscribed(true);
      return true;
    } catch (err) {
      console.error("[Push] Subscribe failed:", err);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [isSupported, subscribeMut]);

  const unsubscribe = useCallback(async () => {
    if (!isSupported) return;
    setIsLoading(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await unsubscribeMut.mutateAsync({ endpoint: sub.endpoint });
        await sub.unsubscribe();
        setIsSubscribed(false);
      }
    } catch (err) {
      console.error("[Push] Unsubscribe failed:", err);
    } finally {
      setIsLoading(false);
    }
  }, [isSupported, unsubscribeMut]);

  return { isSupported, permission, isSubscribed, isLoading, subscribe, unsubscribe };
}
