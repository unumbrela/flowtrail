import { useRef, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PlusIcon, ReloadIcon, TrashIcon } from "@radix-ui/react-icons";
import { getClient } from "@/api/AxiosClient";
import { useCredentialGetter } from "@/hooks/useCredentialGetter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  buildQuestionnaireRequest,
  terminalRunStatuses,
  type QuestionnaireAnswer,
} from "./wenjuanxing";

import { ExecutionReport } from "./ExecutionReport";

const statusLabels: Record<string, string> = {
  created: "等待启动",
  queued: "排队中",
  running: "正在填写",
  completed: "任务已完成",
  failed: "填写失败",
  terminated: "需要处理",
  timed_out: "运行超时",
  canceled: "已取消",
};

type Operation = {
  id: string;
  state: string;
  session_id?: string | null;
  run_id?: string | null;
  submit: boolean | number;
  run_status?: string;
  failure_reason?: string | null;
  session_state?: string | null;
  detail?: string | null;
  can_cancel?: boolean;
  can_close?: boolean;
};

function WenjuanxingPage() {
  const credentialGetter = useCredentialGetter();
  const [url, setUrl] = useState("");
  const [information, setInformation] = useState("");
  const [answers, setAnswers] = useState<QuestionnaireAnswer[]>([]);
  const [submit, setSubmit] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Persist references only: profile information and answers never enter the URL.
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const operationId = searchParams.get("operation");
  const runId = searchParams.get("run");
  const storedSessionId = searchParams.get("session");
  const invalidReference =
    (!!operationId && !/^[a-f0-9]{32}$/.test(operationId)) ||
    (!!runId && !/^tsk_[a-zA-Z0-9_-]+$/.test(runId)) ||
    (!!storedSessionId && !/^pbs_[a-zA-Z0-9_-]+$/.test(storedSessionId));
  const inFlight = useRef(false);
  const attempt = useRef<{
    id: string;
    request: ReturnType<typeof buildQuestionnaireRequest>;
    submit: boolean;
  } | null>(null);

  function resetReferences() {
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        for (const key of ["run", "session", "mode", "operation"])
          next.delete(key);
        return next;
      },
      { replace: true },
    );
    attempt.current = null;
    setError(null);
    mutation.reset();
  }

  const mutation = useMutation({
    retry: false,
    mutationFn: async (input: NonNullable<typeof attempt.current>) => {
      const client = await getClient(credentialGetter, "flowtrail");
      const response = await client.post<Operation>(`/operations/${input.id}`, {
        request: input.request,
        submit: input.submit,
      });
      return response.data;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["flowtrail-operation", data.id], data);
      setError(null);
    },
    onError: () =>
      setError(
        "启动结果尚未确认。请按原请求编号继续确认，避免重复填写；资料已保留。",
      ),
    onSettled: () => {
      inFlight.current = false;
    },
  });

  const operationQuery = useQuery({
    queryKey: ["flowtrail-operation", operationId],
    enabled: !!operationId && !invalidReference && !mutation.isPending,
    retry: false,
    queryFn: async () => {
      const client = await getClient(credentialGetter, "flowtrail");
      return (await client.get<Operation>(`/operations/${operationId}`)).data;
    },
    refetchInterval: (query) =>
      query.state.data?.session_state === "closed" &&
      terminalRunStatuses.has(query.state.data?.run_status ?? "")
        ? false
        : 3000,
  });
  const operation = operationId ? operationQuery.data : undefined;
  const actualRunId = operationId ? operation?.run_id : runId;
  const run =
    actualRunId && !invalidReference
      ? {
          id: actualRunId,
          submit: operationId
            ? !!operation?.submit
            : searchParams.get("mode") === "submit"
              ? true
              : searchParams.get("mode") === "fill"
                ? false
                : null,
        }
      : null;
  // Retain compatibility with links produced before the coordinator existed.
  const runQuery = useQuery({
    queryKey: ["wenjuanxing-run", run?.id],
    enabled: !!run && !operationId,
    queryFn: async () => {
      const client = await getClient(credentialGetter, "sans-api-v1");
      return (
        await client.get<{
          status: string;
          failure_reason?: string | null;
          browser_session_id?: string | null;
        }>(`/runs/${run!.id}`)
      ).data;
    },
    refetchInterval: (query) =>
      terminalRunStatuses.has(query.state.data?.status ?? "") ? false : 3000,
  });
  const runData = operationId
    ? {
        status: operation?.run_status,
        failure_reason: operation?.failure_reason,
      }
    : runQuery.data;
  const queryFailed = operationId ? operationQuery.isError : runQuery.isError;
  const sessionId = invalidReference
    ? null
    : operationId
      ? operation?.session_id
      : (runQuery.data?.browser_session_id ?? storedSessionId);
  const sessionClosed =
    operation?.session_state === "closed" ||
    operation?.session_state === "unavailable";
  const actionMutation = useMutation({
    retry: false,
    mutationFn: async (action: "cancel" | "close") => {
      const client = await getClient(credentialGetter, "flowtrail");
      await client.post(`/operations/${operationId}/${action}`, {});
    },
    onSettled: () => {
      void operationQuery.refetch();
    },
  });

  function start(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current || operationId || run || sessionId || invalidReference)
      return;
    setError(null);
    try {
      const request = buildQuestionnaireRequest({
        url,
        information,
        answers,
        submit,
      });
      const id = crypto.randomUUID().replace(/-/g, "");
      attempt.current = { id, request, submit };
      inFlight.current = true;
      // Write the correlation reference before sending any side-effecting request.
      setSearchParams(
        (previous) => {
          const next = new URLSearchParams(previous);
          next.set("operation", id);
          return next;
        },
        { replace: true },
      );
      mutation.mutate(attempt.current);
    } catch (cause) {
      inFlight.current = false;
      setError(cause instanceof Error ? cause.message : "请检查填写内容。");
    }
  }

  const locked =
    mutation.isPending ||
    !!operationId ||
    !!run ||
    !!sessionId ||
    invalidReference;
  const finished = terminalRunStatuses.has(runData?.status ?? "");

  return (
    <div className="mx-auto w-full max-w-3xl space-y-7 pb-12">
      <header className="space-y-2">
        <p className="text-sm font-medium text-brand">问卷助手</p>
        <h1 className="text-3xl font-semibold">问卷星自动填写</h1>
        <p className="text-sm leading-6 text-muted-foreground">
          粘贴问卷链接，提供资料和答案，FlowTrail 会在浏览器中逐题填写。
        </p>
      </header>
      {invalidReference && (
        <div role="alert" className="space-y-2 text-sm text-destructive">
          <p>运行链接格式无效，未发起任务或状态请求。</p>
          <Button variant="outline" onClick={resetReferences}>
            清除无效链接
          </Button>
        </div>
      )}
      <form onSubmit={start} className="space-y-6">
        <fieldset disabled={locked} className="space-y-6 disabled:opacity-70">
          <div className="space-y-2">
            <Label htmlFor="wjx-url">问卷链接</Label>
            <Input
              id="wjx-url"
              type="url"
              required
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://v.wjx.cn/vm/xxxxxxxx.aspx"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="wjx-information">填写资料</Label>
            <Textarea
              id="wjx-information"
              rows={6}
              maxLength={10000}
              value={information}
              onChange={(e) => setInformation(e.target.value)}
              placeholder={
                "例如：\n姓名：张三\n邮箱：zhangsan@example.com\n职业：软件工程师\n参加方式：线上"
              }
            />
            <p className="text-xs leading-5 text-muted-foreground">
              只填写你提供的信息。必填题缺少答案时会停止，方便你补充。
            </p>
          </div>
          <section className="space-y-3" aria-labelledby="wjx-answers-title">
            <div>
              <h2 id="wjx-answers-title" className="text-sm font-medium">
                指定题目答案（可选）
              </h2>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                按题目或关键词匹配，优先使用这里的答案。多选可填写“阅读、运动”；矩阵题请写明行名和对应答案。
              </p>
            </div>
            {answers.map((item, index) => (
              <div key={index} className="flex items-start gap-2">
                <div className="grid flex-1 gap-2 sm:grid-cols-2">
                  <Input
                    aria-label={`题目 ${index + 1}`}
                    maxLength={500}
                    placeholder="题目或关键词，如：兴趣爱好"
                    value={item.question}
                    onChange={(e) =>
                      setAnswers(
                        answers.map((a, i) =>
                          i === index ? { ...a, question: e.target.value } : a,
                        ),
                      )
                    }
                  />
                  <Input
                    aria-label={`答案 ${index + 1}`}
                    maxLength={5000}
                    placeholder="答案，如：阅读、运动"
                    value={item.answer}
                    onChange={(e) =>
                      setAnswers(
                        answers.map((a, i) =>
                          i === index ? { ...a, answer: e.target.value } : a,
                        ),
                      )
                    }
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`删除答案 ${index + 1}`}
                  onClick={() =>
                    setAnswers(answers.filter((_, i) => i !== index))
                  }
                >
                  <TrashIcon />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={answers.length >= 100}
              onClick={() =>
                setAnswers([...answers, { question: "", answer: "" }])
              }
            >
              <PlusIcon className="mr-2" />
              添加题目答案
            </Button>
          </section>
          <div className="rounded-lg border p-4">
            <label className="flex items-center gap-3 text-sm font-medium">
              <input
                type="checkbox"
                checked={run?.submit ?? submit}
                onChange={(e) => setSubmit(e.target.checked)}
              />
              填写后自动提交
            </label>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              默认停在提交前。浏览器会话保留最多 60
              分钟，可打开查看或手动补充；勾选后将在答案完整时提交一次。
            </p>
          </div>
        </fieldset>
        {error && !run && (
          <div role="alert" className="text-sm text-destructive">
            {error}{" "}
            <Link to="/runs" className="underline">
              查看运行记录
            </Link>
          </div>
        )}
        {!operationId && !run && !sessionId && (
          <Button type="submit" disabled={locked}>
            {mutation.isPending && <ReloadIcon className="mr-2 animate-spin" />}
            {mutation.isPending
              ? "正在启动…"
              : submit
                ? "开始填写并提交"
                : "开始填写"}
          </Button>
        )}
      </form>
      {(operationId || sessionId || run) && (
        <section
          className="space-y-3 rounded-lg border bg-muted/30 p-5"
          aria-label="填写进度"
        >
          <p role="status" className="font-medium">
            {run
              ? runData?.status
                ? (statusLabels[runData.status] ?? runData.status)
                : "正在获取任务状态…"
              : mutation.isPending
                ? "正在创建浏览器与任务…"
                : operationId
                  ? "创建结果尚未确认"
                  : "浏览器已保留，请检查运行记录"}
          </p>
          {runData?.status === "completed" && (
            <p className="text-sm text-muted-foreground">
              {run?.submit === null
                ? "任务已结束。请在运行详情核对填写和提交结果。"
                : run?.submit
                  ? "请在运行详情核对提交结果。"
                  : "自动填写任务已结束，尚未要求提交。请打开浏览器检查答案。"}
            </p>
          )}
          {runData?.failure_reason && (
            <p className="whitespace-pre-wrap text-sm">
              {runData.failure_reason}
            </p>
          )}
          {queryFailed && (
            <p role="alert" className="text-sm text-destructive">
              暂时无法获取进度，任务可能仍在运行，请查看运行详情。
            </p>
          )}
          <div className="flex flex-wrap gap-3">
            {sessionId && !sessionClosed && (
              <Button asChild variant="outline">
                <Link
                  to={`/browser-session/${sessionId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  打开浏览器
                </Link>
              </Button>
            )}
            {run && (
              <Button asChild variant="outline">
                <Link
                  to={`/runs/${run.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  查看运行详情
                </Link>
              </Button>
            )}
            {!run && operationId && !mutation.isPending && (
              <div className="space-y-2 text-sm">
                <p>正在确认原请求。结果未知时不会自动创建第二个任务。</p>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void operationQuery.refetch()}
                >
                  查询原请求
                </Button>
                {attempt.current?.id === operationId && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      if (!mutation.isPending && attempt.current)
                        mutation.mutate(attempt.current);
                    }}
                  >
                    重发同一请求
                  </Button>
                )}
                <Link to="/runs" className="ml-3 underline">
                  检查运行记录
                </Link>
              </div>
            )}
            {operation?.detail === "cancel_requested" && !finished && (
              <p className="text-sm">已请求取消，等待执行器确认。</p>
            )}
            {operation?.detail === "close_requested" && !sessionClosed && (
              <p className="text-sm">已请求关闭，等待浏览器状态确认。</p>
            )}
            {sessionClosed && (
              <p className="text-sm">浏览器会话已关闭、过期或不可用。</p>
            )}
            {operation?.can_cancel && (
              <Button
                variant="outline"
                disabled={actionMutation.isPending}
                onClick={() => actionMutation.mutate("cancel")}
              >
                取消任务
              </Button>
            )}
            {operation?.can_close && !sessionClosed && (
              <Button
                variant="outline"
                disabled={actionMutation.isPending}
                onClick={() => actionMutation.mutate("close")}
              >
                关闭浏览器并释放资源
              </Button>
            )}
            {actionMutation.isError && (
              <p role="alert">操作结果尚未确认，请查询状态后再尝试。</p>
            )}
            {!operationId && !run && sessionId && !mutation.isPending && (
              <p className="text-sm text-muted-foreground">
                任务创建结果未知。请先检查运行记录，确认没有仍在执行的任务后再填写另一份。
              </p>
            )}
            {(finished ||
              (!operationId && !run && sessionId && !mutation.isPending)) && (
              <Button variant="ghost" onClick={resetReferences}>
                {operationId && !sessionClosed
                  ? "保留浏览器，填写另一份"
                  : "填写另一份"}
              </Button>
            )}
          </div>
        </section>
      )}
      {operationId && !invalidReference && operation && (
        <ExecutionReport key={operationId} operationId={operationId} />
      )}
      <p className="text-xs leading-5 text-muted-foreground">
        填写资料会随任务发送给当前配置的模型，并保存在 FlowTrail
        运行记录中。遇到登录或验证码时，可在浏览器中手动处理。
      </p>
    </div>
  );
}

export { WenjuanxingPage };
