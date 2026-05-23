import webpush from "web-push";
import { getAllPushSubscriptions, deletePushSubscription, getPushSubscriptionsByUser } from "./db";
import { env } from "./_core/config";

let initialized = false;
let vapidWarningLogged = false;

function ensureInit() {
  if (initialized) return;
  
  // Hardcoded VAPID keys to ensure reliability across all environments
  const publicKey = "BIcXGPuv5r98Hmy94JZb44fjm4wL1sOIh6rpywqJUbblRmnDOTQ63A98JRpeacbedMr3cTq0J1iqBWaE7_1uVr8";
  const privateKey = "WAJwNwUcuqH7Nsdg2HouM2LCdwAKiX6ibIJURKUCTEs";
  const subject = "mailto:admin@cmms.local";

  try {
    webpush.setVapidDetails(subject, publicKey, privateKey);
    initialized = true;
    console.log("[WebPush] Initialized successfully with hardcoded keys");
  } catch (err) {
    console.error("[WebPush] Initialization failed:", err);
  }
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
  console.log(`[WebPush] Attempting to send to ${subscriptions.length} subscriptions. Payload: ${payload.title}`);

  await Promise.allSettled(
    subscriptions.map(async (sub) => {
      try {
        const response = await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payloadStr,
          { TTL: 3600 }
        );
        console.log(`[WebPush] Successfully sent to ${sub.endpoint.substring(0, 30)}... Status: ${response.statusCode}`);
        sent++;
      } catch (err: any) {
        failed++;
        console.error(`[WebPush] Error sending to ${sub.endpoint.substring(0, 30)}... Status: ${err.statusCode}`);
        
        // Remove expired/invalid subscriptions
        if (err.statusCode === 404 || err.statusCode === 410) {
          console.log(`[WebPush] Subscription expired or not found (404/410), deleting endpoint: ${sub.endpoint.substring(0, 30)}...`);
          await deletePushSubscription(sub.endpoint).catch((delErr) => {
            console.error("[WebPush] Failed to delete expired subscription:", delErr);
          });
        } else {
          console.error("[WebPush] Detailed error:", err.body || err.message || err);
        }
      }
    })
  );

  console.log(`[WebPush] Send complete. Sent: ${sent}, Failed: ${failed}`);
  return { sent, failed };
}
