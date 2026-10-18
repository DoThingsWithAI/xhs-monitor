# XHS Monitor

小红书竞品商品**公开展示指标**自动监控工作台。单管理员使用，完整业务服务放在同一台 Ubuntu VPS：Next.js + Playwright + SQLite + Docker Compose + Caddy。

## 当前开发状态（2026-10-18）

**M1 基础应用和 M2 自动任务核心代码已提交**：登录、商品列表/详情、来源许可管理、SQLite 快照和任务、Playwright Worker、异常日志、Docker Compose、CI 测试。

**尚未完成**：在你自己的 VPS 上部署；获准访问的真实小红书竞品销售数据源接入与选择器验证；连续 7 天稳定性验收。因此请勿将源码存在等同于“监控已上线”或“已获取真实订单销量”。

- [完整需求说明书](docs/PRD.md)
- [Ubuntu VPS 部署指南](docs/DEPLOY.md)
- [开发变更记录](docs/CHANGELOG.md)
- [GitHub Actions 构建状态](https://github.com/DoThingsWithAI/xhs-monitor/actions)

## 支持的商品链接格式

当前已支持小红书商城 `goods-detail` 形态，包括完整 App 分享链接。

例如：

```text
https://www.xiaohongshu.com/goods-detail/6a290d7c3222c60001e051bf
```

链接在录入时自动提取路径中的 24 位商品 ID，去除所有分享及追踪查询参数。同一商品不同分享链接会去重。旧版已保存的带参链接，在更新代码后重新添加一次相同商品链接即可规范化，**不会删除已有销量历史**。

这只是商品链接解析功能：**尚未验证该商品的真实名称、价格、销量及其可自动采集权限**。没有获得许可的数据来源时，仍会显示「等待来源授权」。

## 商品字段样本适配（2026-10-19）

用户提供的一份商城商品详情页面 HTML 中，商品「已售431」、当前展示价「¥19.9」（1990 分）；页面另有店铺的「已售426」和对比价格「¥39」，**不能混为一个字段**。

样本已验证选择器：

| 采集字段 | CSS 选择器 |
| --- | --- |
| 商品标题 | `.goods-name` |
| 当前价 | `.price-container .price` |
| 商品展示已售 | `.price-container .spu-text` |
| 店铺名称 | `.seller-name` |

这些选择器已作为**默认建议**写入程序（不会自动开启数据源或覆盖现有自定义设置），另有脱敏合成 HTML 的 Playwright 烟测。静态网页 HTML 解析只是字段适配；**不是生产 VPS 上的实时采集成功证明**。

只读检查单个商品的 SQLite 数据（在 VPS 执行）：

```bash
cd /opt/xhs-monitor
XHS_DATA_DIR=/var/lib/xhs-monitor python3 scripts/check-sales.py 6a290d7c3222c60001e051bf
```

检查会输出来源绑定状态、Worker 心跳、运行记录、最近有效观察和最近一次非空销量值，不更改数据库。

## 已实现功能

- 单管理员：交互式创建管理员账号、加盐 scrypt 密码校验和带签名的 HttpOnly 会话
- 商品链接：规范化、去重、单个/批量添加、暂停/恢复
- 数据源权限：默认为**关闭**；仅明确许可自动访问、存储和内部分析的数据源才能排期
- 自动化：持久化 SQLite 队列，重启可恢复，单 Worker、任务租约、指数退避、拒绝/验证码暂停
- Playwright：隔离浏览器上下文、配置化 CSS 选择器、限定 HTTPS 主机、IP/域名限制
- 观察快照：销量原始展示值、精度（精确/下界/缺失）、价格、时间和数据来源
- 管理后台：监控总览、商品列表、历史观察、运行记录、告警及来源设置
- 部署：Docker Compose 单机，SQLite 文件宿主机持久化，Caddy HTTPS

## 部署准备（VPS）

```bash
apt-get update && apt-get install -y git python3
git clone https://github.com/DoThingsWithAI/xhs-monitor.git /opt/xhs-monitor
cd /opt/xhs-monitor
bash scripts/deploy.sh doctor
# 如没有 Docker：bash scripts/deploy.sh install-docker
bash scripts/deploy.sh prepare
nano .env
# 将 APP_DOMAIN=CHANGE_ME 改成实际指向 VPS 的域名
bash scripts/deploy.sh deploy
```

**首次部署后，必须手动创建管理员**（不会生成默认账号）：

```bash
docker compose -p xhs-monitor --env-file .env -f deploy/compose.yaml exec web npm run admin:init
```

然后通过 `https://你的域名` 登录。首次添加商品时默认会处于「等待来源授权」，这是预期行为。来源字段/授权未核实前，**不能**把监控标为成功。

> 部署前须检查该 VPS 是否已有服务使用 80/443 端口。此 Compose 自带 Caddy，如果已有 Nginx/Caddy，应改为由现有反向代理接入，不能直接抢占端口。
>
> 系统能按时执行任务并不表示已获取真实小红书订单数据。“已售 1.2万+”只能代表展示门槛值变化，而不是精确新成交订单。

## 每天 08:00 自动更新部署（北京时间）

**无需每天人工更新代码。** 初次成功执行 `bash scripts/deploy.sh deploy` 后，自动启用 `systemd timer`；老用户仅需在 Ubuntu VPS 上执行一次：

```bash
cd /opt/xhs-monitor
git pull --ff-only
bash scripts/deploy.sh schedule
bash scripts/deploy.sh schedule-status
```

定时器每天北京时间 08:00 检查 GitHub `main` 分支：没有新提交则跳过；有新提交则先构建、运行单元测试和 Chromium 烟测、备份 SQLite，再替换本项目容器并做健康检查。失败记录在 `journalctl -u xhs-monitor-auto-update.service` 中；不会覆盖本地修改或强制重置仓库。重启错过的计划会补执行。时区可通过 `.env` 的 `AUTO_DEPLOY_TIMEZONE` 修改。

这与 **Playwright 商品销量的采集计划** 是两件不同的事。详细说明：[自动部署运维指南](docs/DEPLOY.md)。

## 开发

```bash
npm install
DB_PATH=/tmp/xhs-monitor-dev.sqlite npm run db:init
npm test
npm run typecheck
npm run build
```

本项目的 Chromium 运行安全参照 [Playwright 官方 Docker 指南](https://playwright.dev/docs/docker)，使用 Playwright 版本对应的镜像和独立 seccomp 配置。

## 仓库维护约束

任何需求变动先更新 `docs/PRD.md`，代码变动更新 `docs/CHANGELOG.md` 和相关部署文档。不要提交真实 `.env`、SQLite 数据、Cookies、账号密钥、浏览器截图/Trace。
