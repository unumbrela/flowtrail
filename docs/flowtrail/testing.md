# 验证指南

以下命令在仓库根目录运行。先按[快速开始](quickstart.md)安装前端依赖。

## 无模型调用的定向检查

```bash
npm --prefix skyvern-frontend test -- src/routes/wenjuanxing src/api/AxiosClient.test.ts src/routes/root src/components/SidebarTreeNav.test.tsx src/hooks/localDiagnostics.test.ts
npm --prefix skyvern-frontend run build
```

覆盖输入校验、任务生成、页面状态和鉴权诊断；构建命令包含 TypeScript 检查。测试数量会随代码变化，以实际输出为准。它们不能替代全仓后端回归。

## 真实模型集成验证

启动 Compose 服务并完成模型注册后，串行执行：

```bash
cd skyvern-frontend
node scripts/wenjuanxing-smoke.mjs fill
node scripts/wenjuanxing-smoke.mjs submit
node scripts/wenjuanxing-smoke.mjs missing
```

这些命令会调用模型并产生用量。脚本使用本地演示问卷，并非外部真实问卷。

| 场景 | 核对内容 |
| --- | --- |
| `fill` | 填写结束且没有新增提交回执，结合截图检查答案 |
| `submit` | 恰好新增一份回执并核对服务端字段 |
| `missing` | 缺少必填邮箱时返回 `MISSING_INFORMATION` |

历史运行 ID、结果和限制见[问卷验证记录](../wenjuanxing.md)。历史结果不代表本次重新执行。

## 全仓检查

按 [AGENTS.md](../../AGENTS.md) 的要求，提交代码前运行：

```bash
pre-commit run --all-files
```

需要安装 pre-commit 和对应后端依赖；检查可能执行格式修复，运行后请检查 diff。不要把缺失依赖或未执行的检查记录为通过。
