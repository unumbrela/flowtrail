import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { ExecutionReport } from "./ExecutionReport";
const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/api/AxiosClient", () => ({ getClient: async () => mocks }));
vi.mock("@/hooks/useCredentialGetter", () => ({
  useCredentialGetter: () => null,
}));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <ExecutionReport operationId={"a".repeat(32)} />
    </QueryClientProvider>,
  );
  return client;
}
it("loads on demand and never presents completed as field verification", async () => {
  const data = {
    schema_version: 1,
    generated_at: "2026-10-24",
    executor: { status: "completed", duration_seconds: null, error_codes: [] },
  };
  mocks.get.mockReset().mockResolvedValue({ data });
  const client = setup();
  expect(mocks.get).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("查看执行报告"));
  await screen.findByText("completed");
  expect(screen.getAllByText("未独立核验")).toHaveLength(2);
  expect(screen.getByText("暂不可用")).toBeTruthy();
  const create = vi.fn(() => "blob:report");
  const revoke = vi.fn();
  vi.stubGlobal("URL", { createObjectURL: create, revokeObjectURL: revoke });
  const click = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(() => {});
  fireEvent.click(screen.getByText("导出 JSON 报告"));
  expect(create).toHaveBeenCalledOnce();
  expect(click).toHaveBeenCalledOnce();
  await waitFor(() => expect(revoke).toHaveBeenCalledOnce(), { timeout: 2000 });
  client.clear();
  vi.unstubAllGlobals();
});
it("allows retry after report failure", async () => {
  mocks.get.mockReset().mockRejectedValue(new Error("offline"));
  const client = setup();
  fireEvent.click(screen.getByText("查看执行报告"));
  await screen.findByRole("alert");
  fireEvent.click(screen.getByText("刷新执行报告"));
  await waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(2));
  client.clear();
});
