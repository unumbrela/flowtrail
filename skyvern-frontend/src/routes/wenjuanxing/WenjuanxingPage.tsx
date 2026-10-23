import { useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
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

function WenjuanxingPage() {
  const credentialGetter = useCredentialGetter();
  const [url, setUrl] = useState("");
  const [information, setInformation] = useState("");
  const [answers, setAnswers] = useState<QuestionnaireAnswer[]>([]);
  const [submit, setSubmit] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [run, setRun] = useState<{ id: string; submit: boolean } | null>(null);
  const inFlight = useRef(false);

  const mutation = useMutation({
    retry: false,
    mutationFn: async (
      request: ReturnType<typeof buildQuestionnaireRequest>,
    ) => {
      const client = await getClient(credentialGetter, "sans-api-v1");
      const session = await client.post<{ browser_session_id: string }>(
        "/browser_sessions",
        {
          timeout: 60,
          proxy_location: "NONE",
          needs_live_view: true,
        },
      );
      const id = session.data.browser_session_id;
      setSessionId(id);
      // Keep this session available if task creation fails, so the user can inspect it.
      const response = await client.post<{ run_id: string }>("/run/tasks", {
        ...request,
        browser_session_id: id,
      });
      return response.data;
    },
    onSuccess: (data) => setRun({ id: data.run_id, submit }),
    onError: () =>
      setError(
        "启动未确认成功。请先到运行记录检查是否已创建任务，避免重复填写；资料已保留。",
      ),
    onSettled: () => {
      inFlight.current = false;
    },
  });

  const runQuery = useQuery({
    queryKey: ["wenjuanxing-run", run?.id],
    enabled: !!run,
    queryFn: async () => {
      const client = await getClient(credentialGetter, "sans-api-v1");
      const response = await client.get<{
        status: string;
        failure_reason?: string | null;
      }>(`/runs/${run!.id}`);
      return response.data;
    },
    refetchInterval: (query) =>
      terminalRunStatuses.has(query.state.data?.status ?? "") ? false : 3000,
  });

  function start(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current || run || sessionId) return;
    setError(null);
    try {
      const request = buildQuestionnaireRequest({
        url,
        information,
        answers,
        submit,
      });
      inFlight.current = true;
      mutation.mutate(request);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "请检查填写内容。");
    }
  }

  const locked = mutation.isPending || !!run || !!sessionId;
  const finished = terminalRunStatuses.has(runQuery.data?.status ?? "");

  return (
    <div className="mx-auto w-full max-w-3xl space-y-7 pb-12">
      <header className="space-y-2">
        <p className="text-sm font-medium text-brand">问卷助手</p>
        <h1 className="text-3xl font-semibold">问卷星自动填写</h1>
        <p className="text-sm leading-6 text-muted-foreground">
          粘贴问卷链接，提供资料和答案，FlowTrail 会在浏览器中逐题填写。
        </p>
      </header>
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
                checked={submit}
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
        {error && (
          <div role="alert" className="text-sm text-destructive">
            {error}{" "}
            <Link to="/runs" className="underline">
              查看运行记录
            </Link>
          </div>
        )}
        {!run && !sessionId && (
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
      {(sessionId || run) && (
        <section
          className="space-y-3 rounded-lg border bg-muted/30 p-5"
          aria-label="填写进度"
        >
          <p role="status" className="font-medium">
            {run
              ? (statusLabels[runQuery.data?.status ?? "created"] ??
                runQuery.data?.status)
              : mutation.isPending
                ? "浏览器已创建，正在启动任务…"
                : "浏览器已保留，请检查运行记录"}
          </p>
          {runQuery.data?.status === "completed" && (
            <p className="text-sm text-muted-foreground">
              {run?.submit
                ? "请在运行详情核对提交结果。"
                : "自动填写任务已结束，尚未要求提交。请打开浏览器检查答案。"}
            </p>
          )}
          {runQuery.data?.failure_reason && (
            <p className="whitespace-pre-wrap text-sm">
              {runQuery.data.failure_reason}
            </p>
          )}
          {runQuery.isError && (
            <p role="alert" className="text-sm text-destructive">
              暂时无法获取进度，任务可能仍在运行，请查看运行详情。
            </p>
          )}
          <div className="flex flex-wrap gap-3">
            {sessionId && (
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
            {(finished || (mutation.isError && !run)) && (
              <Button
                variant="ghost"
                onClick={() => {
                  setRun(null);
                  setSessionId(null);
                  setError(null);
                  mutation.reset();
                }}
              >
                填写另一份
              </Button>
            )}
          </div>
        </section>
      )}
      <p className="text-xs leading-5 text-muted-foreground">
        填写资料会随任务发送给当前配置的模型，并保存在 FlowTrail
        运行记录中。遇到登录或验证码时，可在浏览器中手动处理。
      </p>
    </div>
  );
}

export { WenjuanxingPage };
