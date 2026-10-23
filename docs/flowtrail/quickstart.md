# 本地启动

[文档导航](README.md) · [项目首页](../../README.md)


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


## 常见问题

| 现象 | 检查方法 |
| --- | --- |
| UI 无法打开 | 执行 `docker compose ps`，确认服务已启动且 8080 端口可用 |
| 后端未就绪 | 执行 `docker compose logs --tail=100 skyvern`，检查数据库和启动错误 |
| 模型无法调用 | 确认 `.env.bailian` 中的密钥和模型配置，待后端 healthy 后再次执行注册脚本 |
| 前端改动不生效 | 在 `skyvern-frontend/` 执行 `npm run build`，然后回到根目录重启 `skyvern-ui` |
| 后端源码改动不生效 | 默认 Compose 使用固定镜像，需要自行构建后端镜像并修改 Compose 配置 |
| 本地演示 URL 被拒绝 | 正常：UI 只接受问卷星域名，本地夹具由集成测试脚本访问 |

查看日志时请先移除密钥、个人资料和会话信息，再分享诊断内容。

## 下一步

阅读[问卷使用说明](../wenjuanxing.md)，或运行[验证指南](testing.md)中的定向测试。
