# 问卷星自动填写

入口：侧边栏 **问卷星**，或本地页面 <http://localhost:8080/wenjuanxing>。

1. 粘贴问卷星的完整填写链接（支持 `wjx.cn`、`wjx.top`、`wjx.com` 及其子域）。
2. 在“填写资料”中输入姓名、联系方式、职业等实际要填写的信息。
3. 可添加“题目或关键词 → 答案”。这些答案优先于一般资料，多选可写“阅读、运动”，矩阵需明确每行答案。
4. 点击“开始填写”。默认只填写；需要自动提交时勾选“填写后自动提交”。
5. 页面显示任务进度，点击“打开浏览器”查看或手动补充，点击“查看运行详情”查看操作与截图。

填写资料不会额外写入浏览器 localStorage，但会作为任务内容发送至当前模型并保存到运行记录。浏览器会话最多保留 60 分钟。新任务在发送前将 operation ID 写入 URL，刷新后通过编排服务查询原运行，不会再次创建任务。资料与答案不写入 URL，也不会在刷新后恢复。旧版 run/session 链接仍可查看。原请求仍在内存时可以使用同一编号重发；详情见[任务生命周期](flowtrail/lifecycle.md)。

缺少必填信息、答案冲突时要求 Agent 停止并报告具体问题；遇到登录或验证码也要求停止，用户可在保留的浏览器中处理。自动提交只要求提交一份，需确认成功页面；网络异常不会自动重试任务创建。创建结果不确定时，请先检查运行记录。

## 调研与实现选择

调研日期：2026-10-22。

| 项目 | 已查阅的实现 | 与本功能的关系 |
| --- | --- | --- |
| [zerro-223/wjx-autofill](https://github.com/zerro-223/wjx-autofill) | [wjx_fill.py](https://github.com/zerro-223/wjx-autofill/blob/main/wjx_fill.py)：定位题干、关键词匹配、进入问卷、填写文本；[MIT 许可](https://github.com/zerro-223/wjx-autofill/blob/main/LICENSE) | 参考按题干匹配及入口按钮处理思路。原实现主要支持文本输入，未直接移植其独立浏览器和定时逻辑。 |
| [Ggbikun/wjx](https://github.com/Ggbikun/wjx) | README 与 Python 目录提供多题型、比例配置、翻页等方案 | 作为功能调研参考；未复制代码，也未引入批量随机作答逻辑。 |

本实现为独立编写，没有复制第三方源代码或新增自动化依赖。对当前项目，使用现有执行引擎比嵌入另一套 Selenium / Playwright 进程更适合：当前 Docker 后端已有执行能力，前端即可提供结构化任务入口。

## 实现位置

- `skyvern-frontend/src/routes/wenjuanxing/wenjuanxing.ts`：链接与输入校验、任务生成。
- `skyvern-frontend/src/routes/wenjuanxing/WenjuanxingPage.tsx`：表单、浏览器会话创建、任务启动与进度。
- `skyvern-frontend/src/router.tsx` / `routes/root/SideNav.tsx`：页面入口。
- `skyvern-frontend/src/api/AxiosClient.ts`：仅对两个可选本地诊断接口的特定 localhost 限制响应跳过鉴权错误提示；真正的鉴权失败仍报告。
- `local-demo/wjx.html`：带入口页与两页中文题目的本地演示问卷。

使用现有 `POST /v1/browser_sessions`（60 分钟）和 `POST /v1/run/tasks`，执行引擎 `skyvern-1.0`、无代理、最多 30 步。Skyvern 数据库和固定后端镜像保持兼容；新增 FlowTrail 独立 SQLite 编排记录和服务。

## 验证与边界

```bash
cd skyvern-frontend
npm test -- src/routes/wenjuanxing src/api/AxiosClient.test.ts src/routes/root src/components/SidebarTreeNav.test.tsx
npm run build
cd ..
docker compose restart skyvern-ui
```

本地浏览器验证使用现有百炼模型和 `http://form-demo:8765/wjx.html`，测试信息均为虚构资料。此 URL 仅用于后端集成测试，不开放给问卷星页面的链接校验。

本地运行记录保存在被 Git 忽略的 `artifacts/wenjuanxing/`，不随仓库发布。真实填写过程包括进入问卷、文本输入、下拉、单选、多选、翻页和停在提交前。

可重复的本地集成测试（会调用已配置模型，产生模型用量；请串行执行）：

```bash
cd skyvern-frontend
node scripts/wenjuanxing-smoke.mjs fill
node scripts/wenjuanxing-smoke.mjs submit
node scripts/wenjuanxing-smoke.mjs missing
```

脚本使用实际前端任务生成器，只将测试目标替换成本地演示问卷。每次执行使用独立 case ID，夹具从 DOM 采集真实字段状态，并将观测与提交回执分别保存。脚本核对文本、下拉、单选、多选及确认框；fill 要求停在第二页且零回执，submit 要求恰好一份字段匹配的回执，missing 要求结构化 `MISSING_INFORMATION` 错误指出邮箱且观测到邮箱为空。每次使用独立浏览器会话，结束后关闭；轮询超时则保留运行 ID 供排查。

历史版本相关单元与组件测试共 86 项通过；该历史记录的 TypeScript、定向 ESLint 和生产构建通过。当前验证命令与范围见[验证指南](flowtrail/testing.md)。本机未安装 `pre-commit`，因此未完成 `pre-commit run --all-files` 全仓检查。

本次实际浏览器验证：

| 场景 | 运行 ID | 结果 |
| --- | --- | --- |
| 只填写 | `tsk_588287513585980694` | completed；两页填完，最后停在提交按钮前，浏览器可查看 |
| 填写并提交 | `tsk_588288514313360874` | completed；恰好新增一份回执 `DEMO-3b5aa57d`，服务端字段匹配 |
| 缺少必填邮箱 | `tsk_588288900860417718` | terminated；明确报告 `MISSING_INFORMATION` 和缺少邮箱 |

本地汇总（不随仓库发布）：`artifacts/wenjuanxing/verification.json`。这些运行使用独立会话；当前后端镜像在一次试验中对已完成任务的旧会话仍报告占用，因此新页面每次创建独立会话，手动检查通过浏览器入口进行。

这是基于模型的自动填写，提交策略和答案匹配由任务指令约束，并非浏览器层的强制动作拦截。题型适配取决于页面结构与当前模型；本地演示不代表所有真实问卷都已验证。矩阵、评分、复杂联动、登录与验证码尚需具体真实链接验证。未提供答案的主观题不会要求模型自行编造。

当前 API 在部分完成任务上返回 `output: null`，所以页面不将该字段当作填写报告，而提供运行操作、截图和浏览器入口供核对。
