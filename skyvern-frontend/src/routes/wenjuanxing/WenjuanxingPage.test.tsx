import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WenjuanxingPage } from "./WenjuanxingPage";

const mocks = vi.hoisted(() => ({ post: vi.fn(), get: vi.fn() }));
vi.mock("@/api/AxiosClient", () => ({ getClient: async () => mocks }));
vi.mock("@/hooks/useCredentialGetter", () => ({
  useCredentialGetter: () => null,
}));

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <WenjuanxingPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  fireEvent.change(screen.getByLabelText("问卷链接"), {
    target: { value: "https://v.wjx.cn/vm/example.aspx" },
  });
  fireEvent.change(screen.getByLabelText("填写资料"), {
    target: { value: "姓名：张三" },
  });
  return client;
}

beforeEach(() => {
  mocks.post.mockReset();
  mocks.get.mockReset().mockResolvedValue({ data: { status: "completed" } });
});
afterEach(cleanup);

describe("WenjuanxingPage", () => {
  it("validates before starting any browser or task", async () => {
    const client = setup();
    fireEvent.change(screen.getByLabelText("问卷链接"), {
      target: { value: "https://example.com/form" },
    });
    fireEvent.click(screen.getByRole("button", { name: "开始填写" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(mocks.post).not.toHaveBeenCalled();
    client.clear();
  });
  it("creates one persistent browser, starts fill-only, and links to real results", async () => {
    mocks.post
      .mockResolvedValueOnce({ data: { browser_session_id: "pbs_123" } })
      .mockResolvedValueOnce({ data: { run_id: "tsk_123" } });
    const client = setup();
    const start = screen.getByRole("button", { name: "开始填写" });
    fireEvent.click(start);
    fireEvent.click(start);
    await screen.findByText("任务已完成");
    expect(mocks.post).toHaveBeenCalledTimes(2);
    expect(mocks.post).toHaveBeenNthCalledWith(1, "/browser_sessions", {
      timeout: 60,
      proxy_location: "NONE",
      needs_live_view: true,
    });
    expect(mocks.post).toHaveBeenNthCalledWith(
      2,
      "/run/tasks",
      expect.objectContaining({
        browser_session_id: "pbs_123",
        prompt: expect.stringContaining("只填写，不提交"),
      }),
    );
    expect(
      screen.getByRole("link", { name: "打开浏览器" }).getAttribute("href"),
    ).toBe("/browser-session/pbs_123");
    expect(
      screen.getByRole("link", { name: "查看运行详情" }).getAttribute("href"),
    ).toBe("/runs/tsk_123");
    client.clear();
  });
  it("only requests submission after the checkbox is selected", async () => {
    mocks.post
      .mockResolvedValueOnce({ data: { browser_session_id: "pbs_123" } })
      .mockResolvedValueOnce({ data: { run_id: "tsk_123" } });
    const client = setup();
    fireEvent.click(screen.getByRole("checkbox", { name: "填写后自动提交" }));
    fireEvent.click(screen.getByRole("button", { name: "开始填写并提交" }));
    await screen.findByText("任务已完成");
    expect(mocks.post.mock.calls[1]?.[1].prompt).toContain("允许最终提交");
    client.clear();
  });
  it("preserves inputs and the browser on task creation failure without retrying", async () => {
    mocks.post
      .mockResolvedValueOnce({ data: { browser_session_id: "pbs_123" } })
      .mockRejectedValueOnce(new Error("network"));
    const client = setup();
    fireEvent.click(screen.getByRole("button", { name: "开始填写" }));
    await screen.findByRole("alert");
    await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(2));
    expect(
      (screen.getByLabelText("填写资料") as HTMLTextAreaElement).value,
    ).toBe("姓名：张三");
    expect(screen.getByRole("link", { name: "打开浏览器" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "开始填写" })).toBeNull();
    client.clear();
  });
});
