# 参与 FlowTrail

欢迎提交文档改进、可复现的问题、问卷夹具和代码改动。中文和英文均可。

## 开始之前

1. 阅读[项目结构](docs/flowtrail/structure.md)和[功能边界](docs/wenjuanxing.md)。
2. 按[快速开始](docs/flowtrail/quickstart.md)配置本地环境。
3. 较大的改动先在本仓库的 Issue 或草稿 PR 中说明场景、实现范围和验收方式。

若仓库未启用 Issues，可使用草稿 PR 说明问题。FlowTrail 特有的问题请留在本仓库；可在未修改的 Skyvern 上复现的问题，可向上游提供最小复现。

## 提交问题

请提供操作系统、Node / Python / Docker Compose 版本、复现步骤、预期与实际行为，以及脱敏日志或截图。模型相关问题附上模型名称和运行状态，不要上传 API 密钥、Cookie、个人资料或真实问卷回答。

安全问题请参阅 [SECURITY.md](SECURITY.md)，不要公开敏感复现细节。

## 提交代码

- 功能、修复和维护分支分别使用 `feature/`、`fix/`、`chore/` 前缀，遵循 [AGENTS.md](AGENTS.md)。
- 一次 PR 聚焦一个问题；解释行为变化，界面改动附截图。
- 前端测试与场景代码就近放置，新增题型尽量提供虚构资料的本地夹具。
- 按[验证指南](docs/flowtrail/testing.md)运行相关测试和构建，并运行 `pre-commit run --all-files`。
- 在 PR 中明确哪些检查通过、失败或未运行，以及原因。
- 保留上游版权和许可声明；不要为品牌统一而批量替换 Python 包名、API 或服务标识。

提交信息格式：`[Component] Action: Brief description`。合并前需要至少一位审阅者批准。

## 文档贡献

FlowTrail 指南放在 `docs/flowtrail/`，README 中英文入口保持能力与边界一致。新增文档请加入[文档导航](docs/flowtrail/README.md)。不要把规划功能写成已经实现，也不要将单次本地测试包装为通用成功率。

参与时请遵循 [Code of Conduct](CODE_OF_CONDUCT.md)。贡献内容需具备必要授权，并遵循仓库的 [AGPL v3 许可](LICENSE)。
