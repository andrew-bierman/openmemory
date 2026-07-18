export const DEFAULT_API_URL = "http://127.0.0.1:54150";

export function getProductionDefaultApiUrl(
  location: Pick<Location, "hostname" | "origin" | "protocol">,
) {
  if (location.protocol !== "https:" || isLocalHostname(location.hostname)) {
    return null;
  }

  return location.origin;
}

export function isLocalApiUrl(apiUrl: string) {
  try {
    return isLocalHostname(new URL(apiUrl).hostname);
  } catch {
    return false;
  }
}

export function isLocalHostname(hostname: string) {
  return (
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1"
  );
}
