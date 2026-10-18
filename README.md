# XHS Monitor

小红书竞品商品**公开展示指标**自动监控工作台。单管理员使用，完整业务服务放在同一台 Ubuntu VPS：Next.js + Playwright + SQLite + Docker Compose + Caddy。

## 当前开发状态（2026-10-18）

**M1 基础应用和 M2 自动任务核心代码已提交**：登录、商品列表/详情、来源许可管理、SQLite 快照和任务、Playwright Worker、异常日志、Docker Compose、CI 测试。

**尚未完成**：在你自己的 VPS 上部署；获准访问的真实小红书竞品销售数据源接入与选择器验证；连续 7 天稳定性验收。因此请勿将源码存在等同于“监控已上线”或“已获取真实订单销量”。

- [完整需求说明书](docs/PRD.md)
- [Ubuntu VPS 部署指南](docs/DEPLOY.md)
- [开发变更记录](docs/CHANGELOG.md)
- [GitHub Actions 构建状态](https://github.com/DoThingsWithAI/xhs-monitor/actions)

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
