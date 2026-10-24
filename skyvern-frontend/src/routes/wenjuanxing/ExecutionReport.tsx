import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getClient } from "@/api/AxiosClient";
import { useCredentialGetter } from "@/hooks/useCredentialGetter";
import { Button } from "@/components/ui/button";

type Report = {
  schema_version: number;
  operation_id: string;
  generated_at: string;
  executor: {
    status: string;
    duration_seconds: number | null;
    error_codes: string[];
  };
};

export function ExecutionReport({ operationId }: { operationId: string }) {
  const [opened, setOpened] = useState(false);
  const credentialGetter = useCredentialGetter();
  const report = useQuery({
    queryKey: ["flowtrail-report", operationId],
    enabled: opened,
    retry: false,
    queryFn: async () => {
      const client = await getClient(credentialGetter, "flowtrail");
      return (await client.get<Report>(`/operations/${operationId}/report`))
        .data;
    },
  });
  function download() {
    if (!report.data) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(report.data, null, 2)], {
        type: "application/json",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `flowtrail-${operationId}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <section aria-label="执行报告" className="space-y-3 rounded-lg border p-5">
      <Button
        variant="outline"
        onClick={() => {
          setOpened(true);
          if (opened) void report.refetch();
        }}
        disabled={report.isFetching}
      >
        {report.isFetching
          ? "正在读取报告…"
          : opened
            ? "刷新执行报告"
            : "查看执行报告"}
      </Button>
      {report.isError && <p role="alert">报告暂时无法读取，请重试。</p>}
      {opened && report.data && (
        <>
          <h2 className="font-medium">执行报告</h2>
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <dt>执行器状态</dt>
            <dd>{report.data.executor.status}</dd>
            <dt>执行耗时</dt>
            <dd>
              {report.data.executor.duration_seconds === null
                ? "暂不可用"
                : `${report.data.executor.duration_seconds} 秒`}
            </dd>
            <dt>字段核验</dt>
            <dd>未独立核验</dd>
            <dt>提交回执</dt>
            <dd>未独立核验</dd>
            <dt>错误类别</dt>
            <dd>{report.data.executor.error_codes.join("、") || "无记录"}</dd>
          </dl>
          <p className="text-xs leading-5 text-muted-foreground">
            执行器报告完成不代表答案已核对。请打开运行详情检查实际结果。
            导出内容包含运行引用和状态，不包含填写资料、答案或截图链接。
          </p>
          <p className="text-xs text-muted-foreground">
            快照时间：{report.data.generated_at}
          </p>
          <Button
            variant="outline"
            onClick={download}
            disabled={report.isFetching || report.isError}
          >
            导出 JSON 报告
          </Button>
        </>
      )}
    </section>
  );
}
