# 项目结构与修改入口

## 为什么本地目录还叫 skyvern？

仓库品牌是 **FlowTrail**，Git 远程地址是 `unumbrela/flowtrail`。本地克隆目录可以叫 `skyvern` 或 `flowtrail`，目录名不决定仓库归属。源码内的 `skyvern/` 则是 Python 包名，涉及导入、CLI、SDK 和部署约定，不能直接整体改名。

## 目录地图

```text
flowtrail/                       # 仓库根目录，本地名称可能为 skyvern
├── README.md                    # 中文项目首页
├── README.en.md                 # 英文项目首页
├── CONTRIBUTING.md              # FlowTrail 贡献流程
├── UPSTREAM.md                  # 上游来源、许可及兼容约定
├── docs/
│   ├── flowtrail/               # FlowTrail 入门、结构、测试与路线图
│   ├── wenjuanxing.md           # 问卷场景详细说明（保留现有链接）
│   ├── portfolio/              # 设计说明与真实界面截图
│   └── *.mdx / api-reference/   # 继承的 Skyvern 文档与 API 资料
├── skyvern-frontend/            # React + TypeScript 工作台
│   ├── src/routes/wenjuanxing/  # FlowTrail 问卷场景及就近测试
│   ├── src/api/                # API 客户端
│   ├── src/hooks/              # 共享 hooks 与本地诊断
│   └── scripts/                # 浏览器集成验证
├── flowtrail_service/           # FlowTrail 持久化编排、恢复与会话管理
├── skyvern/                     # Python Agent、API、CLI、浏览器执行
├── local-demo/                  # 中文演示问卷和回执服务
├── scripts/                     # 模型配置、维护与部署脚本
├── tests/                       # 上游及后端测试
├── alembic/                     # 数据库迁移
├── integrations/                # 外部系统集成
├── packages/skyvern-ui/          # UI 的 Python 分发包装
├── skyvern-ts/client/            # TypeScript SDK
├── fern/                        # API 定义与 SDK 生成配置
├── evaluation/                  # 评测工具
├── prompt_evaluation/           # 提示词评测工具
├── site_fixtures/               # 其他网站测试夹具
├── bitwarden-cli-server/        # 凭据集成服务
├── k8s/                        # Helm 图表
├── kubernetes-deployment/        # Kubernetes 部署资料
├── .github/                     # 工作流、Issue 与 PR 模板
├── docker-compose.yml           # 基础服务
└── docker-compose.override.yml  # 本地固定镜像、UI 挂载和问卷夹具
```

## 按需求定位代码

| 修改目标 | 入口 |
| --- | --- |
| 问卷链接、输入校验、任务指令 | `skyvern-frontend/src/routes/wenjuanxing/wenjuanxing.ts` |
| 填写页面和任务进度 | `skyvern-frontend/src/routes/wenjuanxing/WenjuanxingPage.tsx` |
| 路由与侧边导航 | `skyvern-frontend/src/router.tsx`、`src/routes/root/SideNav.tsx`（均在前端目录内） |
| 鉴权错误分类 | `skyvern-frontend/src/api/AxiosClient.ts` |
| 本地可选诊断 | `skyvern-frontend/src/hooks/localDiagnostics.ts` |
| 问卷演示与回执 | `local-demo/wjx.html`、`local-demo/server.py` |
| fill / submit / missing 验证 | `skyvern-frontend/scripts/wenjuanxing-smoke.mjs` |
| 百炼模型注册 | `scripts/setup_bailian.py` |
| 浏览器执行机制 | `skyvern/webeye/`、`skyvern/forge/` |

## 文件放置约定

- 新增 FlowTrail 使用文档放在 `docs/flowtrail/`；图像放在现有 `docs/portfolio/screenshots/`。
- 前端场景代码和组件测试就近放置；真实模型集成脚本放在 `skyvern-frontend/scripts/`。
- 可公开的演示数据使用虚构资料，问卷夹具放在 `local-demo/`。
- `.env`、运行截图、回执、`artifacts/`、`node_modules/`、构建产物属于本地数据，不作为项目展示素材直接提交。
- `.flowtrail/` 是持久化幂等记录，虽不提交 Git，但不能当作测试缓存删除。
- 保留根目录的 Docker、Python、迁移和工具配置，以维持现有命令和上游兼容。

本轮整理采用“统一入口 + 分类文档”，没有移动运行时代码。后续如需迁移目录，必须同步检查导入、Docker 挂载、脚本路径、CI 和文档链接。

执行报告边界位于 `flowtrail_service/report.py`，页面组件为 `skyvern-frontend/src/routes/wenjuanxing/ExecutionReport.tsx`。固定场景存放在 `skyvern-frontend/scripts/evals/`，批量入口是 `evaluate-questionnaires.mjs`，汇总口径由 `eval-summary.mjs` 定义。结果在忽略的 `artifacts/evaluations/`；不要与持久化 operation 账本 `.flowtrail/` 混用。
