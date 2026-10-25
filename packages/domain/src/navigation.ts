export function safeReturnPath(value: string | null) {
  if (!value?.startsWith("/") || value.startsWith("//") || value.includes("\\"))
    return "/workspace";
  try {
    const url = new URL(value, "https://rallypoint.invalid");
    return url.origin === "https://rallypoint.invalid" &&
      ![
        "/sign-in",
        "/sign-up",
        "/forgot-password",
        "/reset-password",
        "/auth/callback",
      ].includes(url.pathname)
      ? url.pathname + url.search + url.hash
      : "/workspace";
  } catch {
    return "/workspace";
  }
}
