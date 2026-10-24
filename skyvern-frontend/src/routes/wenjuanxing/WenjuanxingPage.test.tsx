import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WenjuanxingPage } from "./WenjuanxingPage";

const mocks = vi.hoisted(() => ({ post: vi.fn(), get: vi.fn() }));
vi.mock("@/api/AxiosClient", () => ({ getClient: async () => mocks }));
vi.mock("@/hooks/useCredentialGetter", () => ({
  useCredentialGetter: () => null,
}));

function LocationProbe() {
  const location = useLocation();
  return (
    <output data-testid="location">
      {location.pathname + location.search}
    </output>
  );
}

function setup(entry = "/wenjuanxing") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[entry]}>
        <LocationProbe />
        <WenjuanxingPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  if (entry === "/wenjuanxing") {
    fireEvent.change(screen.getByLabelText("问卷链接"), {
      target: { value: "https://v.wjx.cn/vm/example.aspx" },
    });
    fireEvent.change(screen.getByLabelText("填写资料"), {
      target: { value: "姓名：张三" },
    });
  }
  return client;
}

beforeEach(() => {
  mocks.post.mockReset().mockImplementation(async (path, body) => ({
    data: {
      id: path.split("/").at(-1),
      state: "ready",
      session_id: "pbs_123",
      run_id: "tsk_123",
      submit: body.submit,
    },
  }));
  mocks.get.mockReset().mockImplementation(async (path) => ({
    data: path.startsWith("/operations/")
      ? {
          id: path.split("/").at(-1),
          state: "ready",
          session_id: "pbs_123",
          run_id: "tsk_123",
          submit: false,
          run_status: "completed",
          can_close: true,
        }
      : { status: "completed" },
  }));
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
    const client = setup();
    const start = screen.getByRole("button", { name: "开始填写" });
    fireEvent.click(start);
    fireEvent.click(start);
    await screen.findByText("任务已完成");
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(mocks.post).toHaveBeenCalledWith(
      expect.stringMatching(/^\/operations\/[a-f0-9]{32}$/),
      {
        submit: false,
        request: expect.objectContaining({
          prompt: expect.stringContaining("只填写，不提交"),
        }),
      },
    );
    expect(
      screen.getByRole("link", { name: "打开浏览器" }).getAttribute("href"),
    ).toBe("/browser-session/pbs_123");
    expect(
      screen.getByRole("link", { name: "查看运行详情" }).getAttribute("href"),
    ).toBe("/runs/tsk_123");
    const location = screen.getByTestId("location").textContent!;
    expect(location).toMatch(/operation=[a-f0-9]{32}/);
    expect(location).not.toContain("张三");
    cleanup();
    client.clear();
    const restored = setup(location);
    await screen.findByText("任务已完成");
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("link", { name: "打开浏览器" }).getAttribute("href"),
    ).toBe("/browser-session/pbs_123");
    expect(
      (screen.getByLabelText("填写资料") as HTMLTextAreaElement).value,
    ).toBe("");
    restored.clear();
  });
  it("only requests submission after the checkbox is selected", async () => {
    const client = setup();
    fireEvent.click(screen.getByRole("checkbox", { name: "填写后自动提交" }));
    fireEvent.click(screen.getByRole("button", { name: "开始填写并提交" }));
    await screen.findByText("任务已完成");
    expect(mocks.post.mock.calls[0]?.[1].request.prompt).toContain(
      "允许最终提交",
    );
    client.clear();
  });
  it("preserves inputs and the browser on task creation failure without retrying", async () => {
    mocks.post.mockRejectedValue(new Error("network"));
    mocks.get.mockResolvedValue({
      data: {
        id: "a".repeat(32),
        state: "unknown",
        session_id: "pbs_123",
        submit: false,
      },
    });
    const client = setup();
    fireEvent.click(screen.getByRole("button", { name: "开始填写" }));
    await screen.findByRole("alert");
    await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(1));
    expect(
      (screen.getByLabelText("填写资料") as HTMLTextAreaElement).value,
    ).toBe("姓名：张三");
    expect(screen.getByRole("link", { name: "打开浏览器" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "开始填写" })).toBeNull();
    client.clear();
  });
  it("restores a running task from the URL without creating a new task", async () => {
    mocks.get.mockResolvedValue({
      data: { status: "running", browser_session_id: "pbs_server" },
    });
    const client = setup("/wenjuanxing?run=tsk_restore");
    await screen.findByText("正在填写");
    expect(mocks.get).toHaveBeenCalledWith("/runs/tsk_restore");
    expect(mocks.post).not.toHaveBeenCalled();
    expect(
      screen.getByRole("link", { name: "打开浏览器" }).getAttribute("href"),
    ).toBe("/browser-session/pbs_server");
    expect(screen.queryByRole("button", { name: "开始填写" })).toBeNull();
    client.clear();
  });

  it("keeps restored references when polling fails and never retries task creation", async () => {
    mocks.get.mockRejectedValue(new Error("offline"));
    const client = setup("/wenjuanxing?run=tsk_restore&session=pbs_restore");
    await screen.findByText(
      "暂时无法获取进度，任务可能仍在运行，请查看运行详情。",
    );
    expect(mocks.post).not.toHaveBeenCalled();
    expect(
      screen.getByRole("link", { name: "查看运行详情" }).getAttribute("href"),
    ).toBe("/runs/tsk_restore");
    expect(screen.queryByRole("button", { name: "填写另一份" })).toBeNull();
    client.clear();
  });

  it("preserves an uncertain creation after reload and requires explicit reset", async () => {
    const client = setup("/wenjuanxing?session=pbs_uncertain");
    await screen.findByText(
      "任务创建结果未知。请先检查运行记录，确认没有仍在执行的任务后再填写另一份。",
    );
    expect(mocks.post).not.toHaveBeenCalled();
    expect(mocks.get).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "填写另一份" }));
    expect(screen.getByTestId("location").textContent).toBe("/wenjuanxing");
    expect(screen.getByRole("button", { name: "开始填写" })).toBeTruthy();
    client.clear();
  });

  it("clears completed references while preserving unrelated query parameters", async () => {
    const client = setup(
      "/wenjuanxing?run=tsk_done&session=pbs_done&mode=submit&view=compact",
    );
    await screen.findByText("请在运行详情核对提交结果。");
    fireEvent.click(screen.getByRole("button", { name: "填写另一份" }));
    expect(screen.getByTestId("location").textContent).toBe(
      "/wenjuanxing?view=compact",
    );
    expect(mocks.post).not.toHaveBeenCalled();
    client.clear();
  });

  it("does not infer submission intent when restoring a run-only link", async () => {
    const client = setup("/wenjuanxing?run=tsk_done");
    await screen.findByText("任务已结束。请在运行详情核对填写和提交结果。");
    expect(
      screen.queryByText(
        "自动填写任务已结束，尚未要求提交。请打开浏览器检查答案。",
      ),
    ).toBeNull();
    expect(mocks.post).not.toHaveBeenCalled();
    client.clear();
  });

  it("rejects malformed restored references without making API requests", async () => {
    const client = setup("/wenjuanxing?run=../../other");
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(mocks.get).not.toHaveBeenCalled();
    expect(mocks.post).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "清除无效链接" }));
    expect(screen.getByTestId("location").textContent).toBe("/wenjuanxing");
    client.clear();
  });
  it("retries the identical operation and payload after a lost response", async () => {
    mocks.post.mockRejectedValue(new Error("response lost"));
    mocks.get.mockRejectedValue(new Error("offline"));
    const client = setup();
    fireEvent.click(screen.getByRole("button", { name: "开始填写" }));
    const retry = await screen.findByRole("button", { name: "重发同一请求" });
    fireEvent.click(retry);
    await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(2));
    expect(mocks.post.mock.calls[1]).toEqual(mocks.post.mock.calls[0]);
    expect(screen.queryByRole("button", { name: "填写另一份" })).toBeNull();
    client.clear();
  });

  it("restores an uncertain operation without redispatching after refresh", async () => {
    mocks.get.mockResolvedValue({
      data: { id: "a".repeat(32), state: "unknown", submit: false },
    });
    const client = setup(`/wenjuanxing?operation=${"a".repeat(32)}`);
    await screen.findByText(
      "正在确认原请求。结果未知时不会自动创建第二个任务。",
    );
    expect(mocks.post).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "重发同一请求" })).toBeNull();
    expect(screen.queryByRole("button", { name: "开始填写" })).toBeNull();
    client.clear();
  });

  it("offers cancellation for active tasks and never offers resource release", async () => {
    const id = "a".repeat(32);
    mocks.get.mockResolvedValue({
      data: {
        id,
        state: "ready",
        run_id: "tsk_123",
        session_id: "pbs_123",
        run_status: "running",
        can_cancel: true,
      },
    });
    const client = setup(`/wenjuanxing?operation=${id}`);
    fireEvent.click(await screen.findByRole("button", { name: "取消任务" }));
    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith(`/operations/${id}/cancel`, {}),
    );
    expect(
      screen.queryByRole("button", { name: "关闭浏览器并释放资源" }),
    ).toBeNull();
    client.clear();
  });

  it("closes completed sessions explicitly and removes their browser link", async () => {
    const id = "a".repeat(32);
    const client = setup(`/wenjuanxing?operation=${id}`);
    const close = await screen.findByRole("button", {
      name: "关闭浏览器并释放资源",
    });
    mocks.get.mockResolvedValue({
      data: {
        id,
        state: "ready",
        run_id: "tsk_123",
        session_id: "pbs_123",
        run_status: "completed",
        session_state: "closed",
      },
    });
    fireEvent.click(close);
    await screen.findByText("浏览器会话已关闭、过期或不可用。");
    expect(mocks.post).toHaveBeenCalledWith(`/operations/${id}/close`, {});
    expect(screen.queryByRole("link", { name: "打开浏览器" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "填写另一份" }));
    expect(screen.getByTestId("location").textContent).toBe("/wenjuanxing");
    client.clear();
  });
});
