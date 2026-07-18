export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

// Login URL points to local login page (username + password auth)
export const getLoginUrl = () => "/login";

// ── returnUrl: يحفظ الوجهة الأصلية (مثلاً /asset/1258 من مسح NFC) قبل تسجيل الدخول ──
// ويستخدمها بعد نجاح الدخول للعودة لنفس المكان بدل الرئيسية دائماً.

// يبني رابط /login?returnUrl=... بأمان من مسار حالي (path + search)
export const getLoginUrlWithReturn = (currentPath: string) => {
  // لا داعي لإضافة returnUrl لو كنا أصلاً في صفحة /login
  if (!currentPath || currentPath.startsWith("/login")) return getLoginUrl();
  return `${getLoginUrl()}?returnUrl=${encodeURIComponent(currentPath)}`;
};

// يقرأ returnUrl من رابط صفحة تسجيل الدخول الحالية بأمان
// (يقبل فقط مسارات داخلية تبدأ بـ "/" واحد، لمنع Open Redirect لمواقع خارجية)
export const getSafeReturnUrl = (fallback = "/"): string => {
  if (typeof window === "undefined") return fallback;
  const params = new URLSearchParams(window.location.search);
  const raw = params.get("returnUrl");
  if (!raw) return fallback;
  try {
    const decoded = decodeURIComponent(raw);
    const isInternalPath = decoded.startsWith("/") && !decoded.startsWith("//") && !decoded.includes("://");
    return isInternalPath ? decoded : fallback;
  } catch {
    return fallback;
  }
};
