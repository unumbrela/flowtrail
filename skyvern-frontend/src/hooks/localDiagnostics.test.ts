import { describe, expect, it } from "vitest";
import { isLocalDiagnosticsUnavailable } from "./localDiagnostics";

function httpError(status: number, detail?: string) {
  return { isAxiosError: true, response: { status, data: { detail } } };
}

describe("optional local diagnostics", () => {
  it("recognizes absent routes and Docker loopback restrictions", () => {
    expect(isLocalDiagnosticsUnavailable(httpError(404))).toBe(true);
    expect(
      isLocalDiagnosticsUnavailable(
        httpError(403, "Endpoint requires localhost access"),
      ),
    ).toBe(true);
  });

  it("preserves actual credential, network and server failures", () => {
    for (const error of [
      httpError(401),
      httpError(403, "Invalid API key"),
      httpError(403, "Endpoint only available in local env"),
      httpError(500),
      new Error("Network Error"),
    ]) {
      expect(isLocalDiagnosticsUnavailable(error)).toBe(false);
    }
  });
});
