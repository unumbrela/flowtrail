import axios from "axios";

export function isLocalDiagnosticsUnavailable(error: unknown): boolean {
  if (!axios.isAxiosError(error)) return false;

  // Docker forwarding is not loopback from the API's perspective. These optional
  // diagnostics are unavailable there; normal API authentication still applies.
  return (
    error.response?.status === 404 ||
    (error.response?.status === 403 &&
      error.response.data?.detail === "Endpoint requires localhost access")
  );
}
