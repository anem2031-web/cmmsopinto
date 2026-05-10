import webpush from "web-push";
import { getAllPushSubscriptions, deletePushSubscription, getPushSubscriptionsByUser } from "./db";
import { env } from "./_core/config";

let initialized = false;
let vapidWarningLogged = false;

function ensureInit() {
  if (initialized) return;
  const publicKey = env.VAPID_PUBLIC_KEY;
  const privateKey = env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) {
    // Validation is now handled by config.ts, so this warning is less critical
    // but still useful if VAPID keys are optional in dev/test
    if (!vapidWarningLogged) {
      console.warn("[WebPush] VAPID keys not configured, push notifications disabled");
      vapidWarningLogged = true;
    }
    return;
  }
  webpush.setVapidDetails(
    "mailto:" + (env.VAPID_SUBJECT_EMAIL || "admin@cmms.local"),
    publicKey,
    privateKey
  );
  initialized = true;
}

export interface PushPayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  tag?: string;
  url?: string;
  type?: string;
}

/**
 * Send push notification to a specific user
 */
export async function sendPushToUser(userId: number, payload: PushPayload) {
  ensureInit();
  if (!initialized) return { sent: 0, failed: 0 };

  const subscriptions = await getPushSubscriptionsByUser(userId);
  return sendToSubscriptions(subscriptions, payload);
}

/**
 * Send push notification to all subscribed users
 */
export async function sendPushToAll(payload: PushPayload) {
  ensureInit();
  if (!initialized) return { sent: 0, failed: 0 };

  const subscriptions = await getAllPushSubscriptions();
  return sendToSubscriptions(subscriptions, payload);
}

/**
 * Send push notification to users with specific roles
 */
export async function sendPushToRoles(
  allSubscriptions: Array<{ userId: number; endpoint: string; p256dh: string; auth: string }>,
  payload: PushPayload
) {
  ensureInit();
  if (!initialized) return { sent: 0, failed: 0 };
  return sendToSubscriptions(allSubscriptions, payload);
}

async function sendToSubscriptions(
  subscriptions: Array<{ endpoint: string; p256dh: string; auth: string }>,
  payload: PushPayload
) {
  let sent = 0;
  let failed = 0;

  const payloadStr = JSON.stringify(payload);

  await Promise.allSettled(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payloadStr,
          { TTL: 3600 }
        );
        sent++;
      } catch (err: any) {
        failed++;
        // Remove expired/invalid subscriptions
        if (err.statusCode === 404 || err.statusCode === 410) {
          await deletePushSubscription(sub.endpoint).catch(() => {});
        } else {
          console.error("[WebPush] Failed to send notification:", err);
        }
      }
    })
  );

  return { sent, failed };
}
