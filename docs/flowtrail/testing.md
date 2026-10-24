# 验证指南

以下命令在仓库根目录运行。先按[快速开始](quickstart.md)安装前端依赖。

## 无模型调用的定向检查

```bash
npm --prefix skyvern-frontend test -- src/routes/wenjuanxing src/api/AxiosClient.test.ts src/routes/root src/components/SidebarTreeNav.test.tsx src/hooks/localDiagnostics.test.ts
node --test skyvern-frontend/scripts/tests/*.node.mjs
python3 -m unittest discover -s local-demo -p 'test_*.py'
python3 scripts/check_flowtrail_docs.py
npm --prefix skyvern-frontend run build
```

覆盖输入校验、任务生成、页面状态和鉴权诊断；构建命令包含 TypeScript 检查。测试数量会随代码变化，以实际输出为准。它们不能替代全仓后端回归。

## 真实模型集成验证

启动 Compose 服务并完成模型注册后，串行执行。更新夹具服务代码后先运行 `docker compose restart form-demo`，等待服务可访问再开始测试：

```bash
cd skyvern-frontend
node scripts/wenjuanxing-smoke.mjs fill
node scripts/wenjuanxing-smoke.mjs submit
node scripts/wenjuanxing-smoke.mjs missing
```

这些命令会调用模型并产生用量。脚本使用本地演示问卷，并非外部真实问卷。

| 场景 | 核对内容 |
| --- | --- |
| `fill` | `completed`、最终表单页、全部 DOM 字段匹配且该 case 零回执 |
| `submit` | `completed`、DOM 字段匹配、该 case 恰好一份回执且全部字段匹配 |
| `missing` | `terminated`、结构化 `MISSING_INFORMATION` 错误指出邮箱、实际邮箱为空且零回执 |

每次运行使用独立随机 case ID。夹具通过 input/change 事件和周期观测读取 DOM，不会替模型填写答案；观测写入 `observations.jsonl`，真正提交才写入 `submissions.jsonl`。这能区分“模型自述完成”“表单实际已填”和“实际已提交”。多选按集合内容比较，额外选项也会失败。

脚本在 `artifacts/wenjuanxing/<run_id>-verification.json` 保存状态、观测、回执和逐项失败原因。该目录不提交 Git；记录只用于本地演示验证，不是对任意网站的第三方审计机制。

CI 的 `FlowTrail checks` 工作流对 `main`、`codex/flowtrail` 的 push 和 PR 执行无模型检查，也支持手动触发。它不需要真实密钥，也不会调用模型。真实模型验证在已配置的本地环境手动运行。

历史运行 ID、结果和限制见[问卷验证记录](../wenjuanxing.md)。历史结果不代表本次重新执行。

本轮改进后的实际运行及检查结果见[第一轮可靠性验证](reliability.md)。

## 全仓检查

按 [AGENTS.md](../../AGENTS.md) 的要求，提交代码前运行：

```bash
pre-commit run --all-files
```

需要安装 pre-commit 和对应后端依赖；检查可能执行格式修复，运行后请检查 diff。不要把缺失依赖或未执行的检查记录为通过。

## 持久化编排检查

第二轮新增的后端单元/HTTP 测试及真实取消测试见[任务生命周期](lifecycle.md)。前端定向命令继续覆盖原页面回归，同时覆盖 operation 刷新恢复、相同请求重发、取消与会话释放。CI 会安装编排服务测试依赖后运行故障注入测试。

## 批量评测与报告

[第三轮执行报告与评测](evaluation.md)说明版本化场景、默认六次串行运行、统计分母和失败保留策略。执行 `node skyvern-frontend/scripts/evaluate-questionnaires.mjs 2`；结果保存到独立 suite 目录，不覆盖历史批次。
