# XHS Monitor

小红书竞品商品自动监控系统（个人自用）。

> 当前进度：**M0 产品需求说明书已完成**。尚未实现采集 Worker、管理后台或 VPS 部署。
>
> 真实竞品指标的自动采集需要具备对应数据源的自动访问和使用授权；“系统能够定时运行”不等于“能获取真实成交订单”。

## 项目文档

- [完整产品需求说明书（PRD v1.0）](docs/PRD.md)：功能范围、页面、数据源权限、Playwright 采集流程、数据质量、SQLite 逻辑表结构、运维安全、测试和验收标准。

## 已确认技术栈

- TypeScript + Playwright（浏览器自动化）
- Next.js（Web 管理后台 + API）
- SQLite + Drizzle ORM
- Docker Compose + Caddy
- Ubuntu VPS 单机部署（所有代码和数据运行于 VPS）

## 实施里程碑

1. **M0**：完整 PRD（已完成）
2. **M1**：Next.js/SQLite/身份验证/容器基础设施
3. **M2**：调度器、Playwright Worker、来源适配器、快照与错误处理
4. **M3**：商品看板、趋势、任务日志及告警
5. **M4**：VPS 部署、备份恢复、真实已许可数据源的连续自动监控验收

需求更新时必须同步修改 [docs/PRD.md](docs/PRD.md)；代码迭代须更新 CHANGELOG 和技术/部署文档。

**重要：** 未获得许可的数据源不得启用自动化采集。未经来源证实的“已售”展示值不能当成真实订单销量或 GMV。
