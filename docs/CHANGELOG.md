# Changelog

## 2026-10-18 — MVP 开发里程碑 M1 + M2（代码已提交，生产未部署）

- 完成 TypeScript 项目、Next.js Web 管理后台及管理员登录。
- SQLite WAL 数据模型：商品、授权来源、绑定、任务、执行记录、观察快照、告警与审计。
- 持久化任务调度、首次/周期排期、租约领取、异常限次重试；Worker 心跳和状态监控。
- 完成 Playwright Chromium 采集适配器：非 root + 官方 seccomp、允许域名限制、可配置字段选择器、不同异常分类。
- 完成展示销量的精确/下界/缺失解析，避免将字段缺失写成 0；价格以整数分保存。
- 完成商品看板、趋势图、运行记录和数据源设置；Compose Web/Worker/Caddy 单 VPS 架构。
- 增加单元/数据库集成测试与 GitHub Actions 自动构建，发现并修复领取任务缺少来源表关联的问题。
- 已更新 PRD / README / 部署说明。**尚未在真实 VPS 上部署，尚无经核实获准采集的竞品销量来源，也未完成 7 天验收。**

## 2026-10-18 — Requirements and Ubuntu deployment scaffolding

- 提交完整产品需求文档 `docs/PRD.md` v1.0.0，锁定 Playwright、单 VPS、SQLite、自动监控 P0。
- 新增 Ubuntu 部署入口 `scripts/deploy.sh`，包含 `doctor`、`prepare`、`install-docker`、`deploy`、`update`、`backup`、`status`。
- 新增 `.env.example` 与 `docs/DEPLOY.md`。
- **当前应用代码尚未开发，部署脚本会拒绝启动不存在的服务。**
