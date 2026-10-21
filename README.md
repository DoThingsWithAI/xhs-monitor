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

## 店铺信息监控字段（2026-10-19）

当前目标是每次合法自动采集商品页面时，同时将**商品指标与店铺指标分开入库**：

| 采集字段 | 来源 DOM | SQLite 保存值 |
| --- | --- | --- |
| 商品已售 | `.price-container .spu-text` | 原文/展示数值/精度；例：已售431 |
| 商品展示价格 | `.price-container .price` | 整数分；例：1990 |
| 店铺名称 | `.seller-container .seller-name` | 辰星提效社的店 |
| 卖家口碑 | `.seller-container .score-text` | 原文 4.32 / 整数百分位 432 |
| 店铺已售 | `.seller-container .name-info .sub-title` 中以「已售」开头的文本 | 已售426，独立于商品销量 |
| 店铺粉丝数 | 同一选择器中以「粉丝数」开头的文本 | 粉丝数1261 |

数据写在 `product_observations` 对应采集时间的历史快照中；已有 SQLite 使用无损增量迁移，旧快照新增列保持缺失而非 0。不同商品显示同一家店铺时，暂按每个商品的观察保存，不会错误拼成一条店铺数据。

**注意**：上方数字来自用户提供 HTML 的静态样本；新代码不会将其作为真实监控的历史结果。只有 VPS 上获许可的自动采集任务实际完成后才产生快照。

## 为什么商品显示「等待来源授权」？

**这是来源准入状态，不是商品 HTML 解析错误。** 提交代码、更新镜像或提供页面字段后，数据源仍默认关闭。只有使用合法获得许可的自动访问/存储/分析来源，且完成来源设置后，Worker 才会建立采集任务。不要把填写许可描述或勾选开关视为平台已经授权。

新版本商品列表会显示最主要的未就绪原因，可点击「查看来源设置」。如来源已合法启用但旧商品绑定仍在等待，调度器会在下一轮检测中尝试自动恢复绑定，不会给未授权数据源开后门。

**VPS 上只读核对（输出状态，不输出令牌或 Cookie）：**

```bash
cd /opt/xhs-monitor
XHS_DATA_DIR=/var/lib/xhs-monitor python3 scripts/check-sales.py 6a290d7c3222c60001e051bf
```

真正的成功需要同时看到商品执行记录与 SQLite 中的新观察值。

## 来源启用表单提示（v1.1.7）

设置页勾选“启用来源”后，如果授权依据只有“已经核实许可”（6 个字符），后台会**拒绝保存**：当前至少要求 12 个字符，且还需真实自动访问、存储、内部分析许可。新版本直接在按钮附近显示具体缺失条件与输入字符数，避免误将勾选当成已生效的授权状态。达到 12 个字符只表示通过格式校验，不是平台授权凭据。查看真实状态可运行 `scripts/check-sales.py`。

## 多商品采集节流（v1.1.8）

在**确有许可的自动数据源**上，同一来源的商品之间不再紧接着访问。默认在上次访问完成后至少间隔 120 秒，单 Worker 串行；SQLite 保存冷却时间，重启或同时启动多个 Worker 也不会重置。服务器 `.env` 可设置：

```dotenv
XHS_SOURCE_MIN_GAP_SECONDS=120
```

范围 60～3600 秒（小于 60 自动提升至 60），修改后重新部署使 Worker 加载配置。若来源返回 401/403/429 或要求验证码，将停止该来源的后续排队任务并标记 `blocked`，需要在合法许可条件下人工确认并重新启用。**节流不是绕过限制，也不能替代自动访问许可**；商品每 24 小时一次的监控周期维持不变。

## 监控商品列表直接看销量折线图（v1.1.9）

每个商品卡片默认展示 **最近 30 次有效商品销量观察的折线图**，不再必须点击“历史”才能看趋势。图表横坐标为采集时间、纵坐标为该来源页面的**累计展示销量**（不是新增成交订单）。

- 0 条有效销量：展示「暂无有效销量数据」，不会凭 HTML 示例填充虚构历史。
- 1 条有效销量：绘制单个点，提示需等下一次采集后才会形成趋势。
- 2～30 条：按时间绘制折线，悬停显示采集时间、销售原文和精度；支持“万+”等近似/下界展示但醒目标注。
- 商品卡片同时包含名称、价格、店铺口碑、店铺销量、粉丝数和监控状态。详细观察表继续保留为辅助入口。
- 后台 `GET /api/products` 返回有界的 `trend_points` 字段；只有真实数据进入 SQLite 后才会有图，不会绕过来源授权或改变采集周期。

## 为什么只在某一天采集一次，后续没有销量记录？

正常情况下每个已授权商品默认每 24 小时排期一次。看板折线图最后一个点显示**最近有效销量入库时间**，并不意味着之后没有执行任务：可能来源遭遇 403/429/验证而被整体暂停、近期任务失败/重试、缺少销量字段变成 partial，或 Worker 离线。

最新版在 VPS 上运行下列**只读诊断命令**，直接查看真实问题：

```bash
cd /opt/xhs-monitor
XHS_DATA_DIR=/var/lib/xhs-monitor python3 scripts/check-sales.py 6a290d7c3222c60001e051bf
docker compose -p xhs-monitor --env-file .env -f deploy/compose.yaml logs --since=72h --tail=200 worker
```

输出会包含下次采集（UTC）、最新任务状态/重试、来源启用和阻断原因、SQLite 节流时间及 Worker 最近心跳。若来源被限制，不应靠取消阻断或高频重试恢复；先核实权限和故障根因。要使用新增诊断功能，先用 `bash scripts/deploy.sh update` 更新 VPS 文件。

## 10 月 20/21 日 PARSER_NO_FIELDS 采集失败（v1.1.11）

用户的真实 VPS 任务记录证明：10 月 19 日首采成功，10 月 20/21 日都按计划执行，但商品标题、销量、价格和店铺字段全都读取不到，报 `PARSER_NO_FIELDS`；尚未证明是页面结构改动还是访问限制。

采集器现会等待允许访问页面的商品字段最多 15 秒，避免在 `domcontentloaded` 的空白壳页面上立即判断失败；遇到明显验证/限制要求仍会暂停来源。页面诊断只记录 HTTP 状态、DOM 状态、内容字符数、字段命中数和被白名单阻止的子资源数，不保存页面全文。看板即使存在旧销量，也会提示最近失败与错误码。

部署后等待下一次合法计划采集，然后用只读命令查看诊断元数据：

```bash
cd /opt/xhs-monitor
XHS_DATA_DIR=/var/lib/xhs-monitor python3 scripts/check-sales.py 6a290d7c3222c60001e051bf
```

如果仍然 `PARSER_NO_FIELDS`，请根据 `http`、`dom`、`bodyChars`、`fields`、`blockedSubresources` 判断后续应排查页面结构、客户端资源或访问权限，不要循环强制访问受限来源。

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
