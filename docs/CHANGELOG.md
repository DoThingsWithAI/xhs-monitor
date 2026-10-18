# Changelog

## 2026-10-19 — Ubuntu 08:00 自动更新部署（v1.1.4）

- 新增 `scripts/auto-update.sh`、`deploy/systemd/xhs-monitor-auto-update.service` 与 `.timer`：每日北京时间 08:00 自动检查 GitHub main 分支，有新版本则部署；无变更则跳过重启。
- `scripts/deploy.sh` 增加 `schedule`、`schedule-status`、`unschedule`，首次成功部署自动安装计划任务；`update` 与自动任务使用同一进程锁。
- 更新分为预构建+临时数据库单元测试+Chromium 烟测、在线 SQLite 备份、启动并等待健康检查三个阶段；禁止覆盖本地修改或强制重置 Git。
- 日志和成功 SHA 记录在 root 目录/systemd journal；服务器重启导致错过触发时自动补执行。
- 部署定时任务不代表“自动采集竞品销量”；实际授权/数据源/生产部署仍须分别验证。


## 2026-10-19 — 商品价格和销量 DOM 字段定位（v1.1.3）

- 基于用户上传的商品详情页面 HTML，确认商品展示「已售431」、展示价格「¥19.9」，另有对比价「¥39」和店铺统计「已售426」；严格区分商品指标与店铺指标。
- 采集 CSS 选择器：`.goods-name`、`.price-container .spu-text`、`.price-container .price`、`.seller-name`。
- 新数据源初始化默认选择器改为经该快照验证的字段，仅对旧版仍关闭、从未配置的默认记录进行非破坏升级，**保持自动访问许可开关关闭**。
- 增加 431/1990 分单元测试、SQLite 默认值检查及 Playwright Chromium 最小 DOM 冒烟测试。
- HTML 静态解析不等于生产实时采集，实际 VPS 数据还需用 `python3 scripts/check-sales.py` 核对。


## 2026-10-18 — goods-detail 链接兼容与隐私修复（v1.1.2）

- 核实用户提供的 `goods-detail` 链接可由 URL 路径解析 24 位商品 ID，不能把分享参数里的嵌套 `itemId` 误当作该商品 ID。
- 添加商品时只保存去除全部 query/fragment 的标准链接，避免 `xsec_token`、`instation_link`、`share_id` 被保存为商品数据。
- 同一商品的多个分享链接采用商品 ID 去重，兼容已入库的旧版带参链接，重复添加时可原位清理。
- API 添加接口不再回传原始带追踪参数 URL；增加相应自动化回归测试。
- 真实商品名称、价格和销量尚未能经网页或授权 API 确认，不应宣称已成功采集。


## 2026-10-18 — Docker deployment fixes (v1.1.1)

- 修复生产 Docker 镜像需显式安装 TypeScript/tsx 构建依赖的问题。
- 调整 Playwright seccomp 路径，使其相对于 Compose 文件所在目录。
- GitHub Actions 增加 Web 和 Worker Docker 构建测试；仓库仍未在实际 VPS 部署。


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
