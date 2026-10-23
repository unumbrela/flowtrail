# FlowTrail · 流迹

**可追溯的 AI 浏览器自动化工作台 — Traceable AI browser automation.**

FlowTrail 围绕中文问卷填写提供资料输入、答案映射、浏览器执行、进度查看与人工接管入口。项目重点展示场景设计、React / TypeScript 工程实践、模型接入与端到端验证。

![FlowTrail 问卷星填写界面](docs/portfolio/screenshots/wenjuanxing.png)

## 核心能力

- **问卷星场景入口**：校验问卷链接、填写资料和逐题答案映射，再创建浏览器会话与执行任务。
- **可检查的执行过程**：提供运行记录、操作截图和浏览器查看能力，便于核对及手动处理。
- **明确的任务策略**：默认只填写，显式选择后才要求提交；缺失必填信息、登录或验证码要求停止并提示。
- **本地模型集成**：提供百炼 OpenAI-compatible 配置示例、固定镜像版本和模型注册脚本。
- **可重复演示**：提供两页中文问卷夹具与 fill / submit / missing 三种集成测试场景。

提交策略属于模型指令约束，并非浏览器层动作拦截。尚未验证全部真实问卷星题型；当前验证覆盖本地演示页面，不能当作通用成功率指标。

## 快速运行

需要 Docker Compose 2.24.4+、Node.js 22+ 和 Python 3.11+，以及支持视觉输入的百炼模型密钥。以下命令在全新克隆目录执行；已有配置请保留。

```bash
git clone https://github.com/unumbrela/flowtrail.git
cd flowtrail
cp .env.example .env
cp .env.bailian.example .env.bailian
cp skyvern-frontend/.env.example skyvern-frontend/.env
```

在 `.env.bailian` 中填写自己的 `OPENAI_COMPATIBLE_API_KEY`。删除 `skyvern-frontend/.env` 中的 `VITE_SKYVERN_API_KEY=YOUR_API_KEY` 占位行，UI 服务会读取后端首次启动生成的本地凭据。不要提交这些配置文件。

```bash
cd skyvern-frontend
npm ci
npm run build
cd ..
docker compose up -d
# 等待 docker compose ps 显示后端 healthy 后执行：
python3 scripts/setup_bailian.py
```

打开 [FlowTrail 问卷页面](http://localhost:8080/wenjuanxing)。本地演示问卷可在 [8765 端口](http://localhost:8765/wjx.html) 查看；集成脚本通过容器网络访问它，不需要真实外部问卷。

`docker-compose.override.yml` 固定已验证的后端镜像并挂载本项目构建产物。Python 包、API、服务名保留 `skyvern` 以保持兼容；本地修改后端源码不会自动进入该镜像。修改前端后重新构建并运行 `docker compose restart skyvern-ui`。

## 验证

```bash
cd skyvern-frontend
npm test -- src/routes/wenjuanxing src/api/AxiosClient.test.ts src/routes/root src/components/SidebarTreeNav.test.tsx src/hooks/localDiagnostics.test.ts
npm run build
# 以下测试会调用实际模型并产生模型用量，请串行执行：
node scripts/wenjuanxing-smoke.mjs fill
node scripts/wenjuanxing-smoke.mjs submit
node scripts/wenjuanxing-smoke.mjs missing
```

当前定向测试共 **88 项通过**，TypeScript 检查与生产构建通过。

本地浏览器实测：只填写场景停在提交前；提交场景服务端恰好新增一份回执；缺少邮箱场景返回 `MISSING_INFORMATION`。详细测试范围、运行记录及边界见 [问卷功能文档](docs/wenjuanxing.md)。这些结果来自本地测试，不代表外部网站全部兼容。

## 工程导航

| 位置 | 职责 |
| --- | --- |
| `skyvern-frontend/src/routes/wenjuanxing/` | 场景页面、输入校验、任务生成和测试 |
| `skyvern-frontend/src/api/AxiosClient.ts` | 请求及鉴权错误分类 |
| `skyvern-frontend/src/hooks/localDiagnostics.ts` | 本地可选诊断响应识别 |
| `local-demo/` | 可控演示页面与服务端回执 |
| `skyvern-frontend/scripts/wenjuanxing-smoke.mjs` | 真实模型集成验证 |
| `scripts/setup_bailian.py` | 本地百炼模型注册 |
| `skyvern/` | Python Agent 与后端 |

## 许可

遵循 [GNU AGPL v3](LICENSE)。

感谢 [Skyvern](https://github.com/Skyvern-AI/skyvern) 开源项目，本项目在开发过程中参考并复用了其诸多设计与实现。
