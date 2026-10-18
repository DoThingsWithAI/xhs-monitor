# Changelog

## 2026-10-18 — Requirements and Ubuntu deployment scaffolding

- 提交完整产品需求文档 `docs/PRD.md` v1.0.0，锁定 Playwright、单 VPS、SQLite、自动监控 P0。
- 新增 Ubuntu 部署入口 `scripts/deploy.sh`，包含 `doctor`、`prepare`、`install-docker`、`deploy`、`update`、`backup`、`status`。
- 新增 `.env.example` 与 `docs/DEPLOY.md`。
- **当前应用代码尚未开发，部署脚本会拒绝启动不存在的服务。**
