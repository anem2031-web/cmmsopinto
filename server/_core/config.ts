import { z } from "zod";

const serverEnvSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  JWT_SECRET: z.string().min(1, "JWT_SECRET is required"),
  OAUTH_SERVER_URL: z.string().min(1, "OAUTH_SERVER_URL is required"),
  OWNER_OPEN_ID: z.string().min(1, "OWNER_OPEN_ID is required"),
  REDIS_URL: z.string().optional(),
  VAPID_PUBLIC_KEY: z.string().min(1, "VAPID_PUBLIC_KEY is required for push notifications").optional(),
  VAPID_PRIVATE_KEY: z.string().min(1, "VAPID_PRIVATE_KEY is required for push notifications").optional(),
  VAPID_SUBJECT_EMAIL: z.string().email("VAPID_SUBJECT_EMAIL must be a valid email").optional(),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  BUILT_IN_FORGE_API_URL: z.string().optional(),
  BUILT_IN_FORGE_API_KEY: z.string().optional(),
  VITE_APP_ID: z.string().optional(),
});

export const validateEnv = () => {
  try {
    const parsed = serverEnvSchema.parse(process.env);
    if (parsed.NODE_ENV === "production") {

      // Enforce VAPID keys in production if push notifications are enabled
      // For now, keep them optional, but warn if not present
      if (!parsed.VAPID_PUBLIC_KEY || !parsed.VAPID_PRIVATE_KEY) {
        console.warn("VAPID keys are recommended in production for push notifications");
      }
    }
    return parsed;
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error("❌ Invalid environment variables:", error.flatten().fieldErrors);
      throw new Error("Invalid environment variables");
    } else {
      console.error("❌ Environment variable validation failed:", error);
      throw new Error("Environment variable validation failed");
    }
  }
};

export type ServerEnv = z.infer<typeof serverEnvSchema>;

// Run validation immediately on import
export const env = validateEnv();
