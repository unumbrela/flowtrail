# Upstream attribution

FlowTrail is a customized application built on [Skyvern](https://github.com/Skyvern-AI/skyvern).
The browser agent, Python backend, workflow runtime, SDKs, and most of the application
originate from Skyvern and its contributors. They are not original FlowTrail work.

- Source baseline: `73e49ce` (full commit recorded in the repository history).
- Original project documentation: [README.upstream.md](README.upstream.md).
- Original license: [GNU AGPL v3](LICENSE), retained unchanged.
- FlowTrail modifications: [contribution guide](docs/portfolio/contributions.md).
- Modification date: 2026-10-23.

The Python namespace, CLI, environment variables, container service identifiers, and
generated SDK names retain `skyvern` for compatibility. The application brand and
portfolio repository are FlowTrail. Third-party copyright and license notices remain
in their original locations. FlowTrail does not imply endorsement by Skyvern AI.

The WJX integration was independently implemented on Skyvern's existing APIs after
reviewing public projects. See [the research notes](docs/wenjuanxing.md).
