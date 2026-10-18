# XHS Monitor｜小红书竞品商品自动监控系统产品需求说明书（PRD）

> **版本**：v1.1.0 · MVP 开发状态同步
> **日期**：2026-10-18
> **仓库**：https://github.com/DoThingsWithAI/xhs-monitor
> **状态**：M1/M2 首批代码已提交并通过基础 CI；**尚未在用户 VPS 部署，真实商品数据源未验证，M3/M4 未验收**
> **产品类型**：个人自用的竞品监控后台（Single Tenant）
> **部署方案**：Ubuntu VPS 单机部署；Next.js + Playwright + TypeScript + SQLite + Docker Compose + Caddy
> **核心约束**：第一版必须自动采集、自动调度、自动保存历史快照；不以人工录入/CSV 导入冒充自动监控

---

## 0. 需求基线与解释原则

### 0.1 已确认的决策

1. 监控对象是**其他商家的小红书商品**，不是自身店铺订单。
2. 第一版的核心价值是**无人值守的自动监控**，添加监控任务后不能依赖手动刷新。
3. 浏览器自动化选用 **Playwright**，不使用 Puppeteer。
4. 所有应用代码与服务部署到**同一台 Ubuntu VPS**；不使用 Vercel 托管业务服务。
5. 第一版数据库采用 **SQLite**，不引入 Neon / PostgreSQL / Redis / BullMQ。
6. 代码统一保存在本 GitHub 仓库；每次需求变化须同步更新本 PRD 与版本记录。
7. 管理后台仅供所有者访问，必须有身份验证，不公开竞品数据与管理接口。

### 0.2 最重要的边界

- 自动抓取功能只能对**明确允许自动访问、保存和内部分析**的数据源启用；授权须能被记录和检查。技术上能打开某页面不等于拥有自动采集许可。
- 平台的商家商品/订单 API 不默认为竞争对手的订单查询 API。未经验证，不宣传可获取真实成交单量、支付订单、退款后净销量或真实 GMV。
- 对未取得可用来源许可的商品，允许保存监控意向，但必须显示 `等待数据源授权`，不得宣称`自动监控中`。
- 不实现验证码破解、风控绕过、签名逆向、指纹伪装、账号/会话盗用或代理池轮换；登录墙、403 等访问限制必须暂停受限采集并展示原因。
- 需求书定义的是**目标产品及验收条件**，不是已确认能从任意小红书链接持续获得销量。实际可采集的字段、覆盖率和授权条件需要在实施前由小样本验证。

### 0.3 核心术语

| 术语 | 含义 |
|---|---|
| 监控商品 | 用户希望持续观察的竞品商品 |
| 数据源 | 提供商品字段的已获许可网页、授权 API 或其他明确允许使用的渠道 |
| 采集任务 Job | 一次特定商品+来源+计划时间的采集工作单元 |
| 执行记录 Run | Job 某次执行尝试的开始、结果和异常 |
| 观察快照 Observation | 在特定时刻观察到的商品字段及原始文本，原则上只追加不覆盖 |
| 已售展示值 | 来源向用户展示的指标；其定义可能与真实成交订单不同 |
| 精确值 exact | 来源明确提供未缩写的数值；仍不意味着是“真实支付订单” |
| 下界 lower_bound | 例如 `1.2万+`，只能表示公开展示的最低门槛 |
| 缺失 missing | 页面或数据源无相应字段，数据库应为 NULL 而不是 0 |
| 过期 stale | 超过采集周期或阈值仍未拿到新的有效数据 |
| 阻断 blocked | 因访问权限、验证码或来源限制而暂停自动访问 |

---

## 1. 产品背景、目标与成功标准

### 1.1 背景与痛点

希望通过长期观察指定小红书竞品，回答：
- 哪些商品最近展示销售热度上升？
- 商品何时改价、上下架或出现销售展示门槛变化？
- 同类竞品中哪些增长趋势值得进一步人工研究？
- 哪些商品近期没有有效数据，是没有变化还是根本没有采集成功？

依靠每天人工打开商品页面效率低，且无法统一保存时间序列与失败信息。

### 1.2 产品目标

**G1 自动化**：新增一个存在许可数据源的监控目标后，自动首采、按计划重复采集、关闭浏览器后仍运行。

**G2 可溯源**：每条有效数据都能追溯到来源、采集时间、原始文本、指标口径与精度等级。

**G3 可信展示**：近似销量不转化为精确单量；字段缺失和采集失败不伪装成 0 或商品停卖。

**G4 可运维**：VPS 重启可恢复，任务不会无休止重试，浏览器进程崩溃不会阻断全部商品。

**G5 单机可部署**：只用一个仓库、一个 VPS、一套 Docker Compose 和持久化 SQLite 文件就可运行。

### 1.3 目标用户

V1 仅单人管理员。典型使用：选品研究、竞品资料监测、相似课程/教育资料/电商商品趋势比较。

### 1.4 成功指标（分母必须展示）

| 指标 | 定义 | V1 验收方式 |
|---|---|---|
| 调度执行率 | 已实际开始的到期任务数 / 应到期任务数 | 7 天试运行统计；目标 ≥99%，不把暂停/未授权任务算应到期 |
| 来源成功率 | 获得非错误响应并成功识别商品的次数 / 发起尝试次数 | 只报告实测，不预设 100% |
| 销量字段有效率 | 销量字段有效快照数 / 该字段计划采集次数 | 单独展示，与“页面加载成功”区分 |
| 数据新鲜度 | 距上次有效观察的小时数 | 每个商品可见，超时有告警 |
| 无人值守 | 不依赖浏览器/个人电脑/人工点击 | 连续 7 天运行 |
| 正确性 | 近似/精确/缺失/确为 0 不混淆 | 自动化测试全通过 |
| 失败可追溯 | 失败具有状态、时间和错误码 | 人工注入异常验证 |

> 实际运行指标受许可数据源可用性限制；**程序按时运行成功 ≠ 取得销量字段成功**。

---

## 2. 范围与优先级

### 2.1 P0（第一版必须具备）

- 单管理员登录、退出、会话保护。
- 单个/批量添加商品链接，域名白名单、URL 规范化、去重、基础资料管理。
- 监控开关、分组/标签、采集周期配置。
- 数据源/许可状态管理，禁止未授权来源自动采集。
- Playwright 浏览器采集适配器，以及统一数据源接口；至少一个**真实可用且获得许可的来源适配器**完成端到端验证。
- 任务调度、首次立即入队、任务领取租约、重启恢复、低并发、超时、有限重试、阻断自动暂停。
- 快照持久化：商品、店铺、价格、销量展示值、原始文本、来源、计量口径、精度、时间。
- 监控看板、商品列表、商品详情历史图、任务日志/异常中心。
- 站内告警：价格变动、销量展示门槛提升、连续采集失败、数据过期、权限阻断。
- SQLite 持久化、WAL、迁移、备份恢复、Docker Compose、Caddy HTTPS、安全配置和基本监控。
- 自动化测试与 7 天无人值守验收报告。

### 2.2 P1（完成 V1 后规划）

- CSV 导入/导出、手动补录（补录数据与自动来源明确标注）。
- 更细的统计面板、分组比较、备注和自定义标签。
- OpenClaw / Hermes Agent 只读 API；只返回授权允许对外提供的数据。
- Telegram / 邮件等外部通知；失败抑制与摘要推送。
- 许可范围支持的多来源交叉验证和质量评估。

### 2.3 P2 / 明确不做

- 自动全站发现商品、关键词批量搜索、全网排行榜。
- 真实订单量、支付转化率、真实 GMV 等未经来源证实的数据。
- 评论/买家个人资料的大规模采集。
- 账号代登录、批量账号池、验证码绕过、风控规避。
- SaaS 多租户、团队角色、计费、分布式多机器采集。
- 仅展示静态示例数据就宣称实现自动监控。

---

## 3. 核心用户场景与交互规则

### US-01 添加单个商品（P0）

**前提**：管理员已登录。

**操作**：输入商品分享链接 / 规范 URL，可填写分类与标签，提交。

**系统行为**：
1. 仅允许配置过的目标域名与协议；解析和规范化 URL，拒绝危险重定向、内网地址及非目标站点（SSRF 防护）。
2. 尽可能解析平台商品 ID；无法确定时进入待识别状态，不凭 URL 猜测商品 ID。
3. 按平台+商品 ID 去重；如果 ID 暂未识别，则使用规范 URL 去重。
4. 创建商品及来源绑定；检查数据源的许可、有效期、频率与可用性。
5. 来源合法且可用：生成首采 Job 并设为立即到期；显示 `排队中`。
6. 来源未授权/不存在：保存商品，显示 `等待数据源授权`，**不执行页面访问**。
7. 对重复商品返回已存在记录及详情入口，不创建重复采集任务。

**验收**：输入同一商品多种等价链接不会产生重复有效商品；未授权来源没有采集请求。

### US-02 批量添加（P0）

- 支持一次粘贴最多 20 条链接（可配），逐条校验、去重、报告“成功 / 已存在 / 无效 / 待授权”。
- 批量新增不突破每来源频率限制；任务按序排队，不同时打开 20 个浏览器。
- 不支持通过输入任意站点 URL 让 Worker 访问内网/云元数据地址。

### US-03 自动定时监控（P0）

- 默认采集周期 24 小时；允许配置 6 小时或 1 小时，但必须同时满足来源许可及频率限制。
- Worker 为独立常驻进程，每 1 分钟检查到期 Job；这里的“1 分钟”是**本地扫描 SQLite 队列**，不是每分钟请求目标网站。
- 浏览器并发默认 1，最多 2（V1 配置硬上限）；单来源独立速率限制。
- 每轮调度基于数据库持久字段 `next_due_at` 计算，不依赖只在内存里的 setInterval 维持状态。
- Worker 取得到期任务时使用事务/租约与唯一的 `idempotency_key` 防止重复执行；崩溃后租约超时允许恢复。
- 采集后保存 run 和必要的 observation，安排下一计划执行时间；时间由计划触发点计算，防止任务耗时累积漂移。
- 暂停/删除/停用的商品不得再被领取；运行中取消应尽可能停止，已经记录的历史不删除。

### US-04 商品列表（P0）

**可见字段**：商品名称、店铺、所属分组、当前价格、最新销量展示值（原样）、精度标识、最后成功观察时间、下次计划、监控状态、最近异常。

**操作**：新增、批量添加、搜索、分类筛选、状态筛选、暂停/恢复、调整周期、查看详情、手动触发一次合规采集（仅管理员，用于调试，不是日常依赖）。

**原则**：
- 上一次有效数据可继续显示，但须标明“截至何时的历史值”及“过期”。
- 任务失败时不得更新“最后成功时间”，不得把销量或价格置零。
- 排行榜按照**可比较的同口径数据**排序；无法比较的数据仅显示“已售展示值变化/阈值跨越”，不参与精确新增榜。

### US-05 商品详情（P0）

- 商品基础信息、原始/规范化链接、数据源和授权状态。
- 7 / 30 天曲线：价格时间线、销量展示门槛/精确值记录、数据点精度图例。
- 历史快照表：UTC 采集时间（按界面时区展示）、销量原始文本、归一化值、精度、指标范围、价格、来源、有效字段。
- 最近 30 条运行记录：任务 ID、尝试次数、持续时间、响应状态、错误码、摘要和可重试性。
- 暂停/恢复、修改频率、删除商品（采用软删除，历史保留策略见 `9`）。
- 数据点必须注明“展示指标 ≠ 实际成交订单”。

### US-06 异常中心（P0）

- 异常类型：权限失效、访问受限、验证码/登录墙、网络超时、服务 5xx、429、页面结构变化、字段缺失、商品下架/不存在、解析异常、数据库写入失败、长期未成功。
- 显示异常的首次/最后发生时间、商品、来源、重复次数、是否自动恢复、已读/未读。
- 同一种商品/来源/异常类型的持续失败合并告警，避免重复轰炸。
- 管理员可确认、关闭、查看日志；解除 `blocked` 前必须明确校验来源权限恢复，不能无限循环试探。

### US-07 管理设置（P0）

- 基础配置：默认周期、时区（默认 Asia/Shanghai，可修改）、并发、超时、截图/日志保存期限。
- 数据源：名称、类型、许可依据、可采集字段、自动访问许可、内部保存许可、许可失效日期、最大频率、是否启用。
- 系统状态：最近 Worker 心跳、下次任务数、过去 24 小时执行成功/失败/阻断分布、数据库空间与上次备份时间。
- 密钥在服务器环境变量或专用 secret 存储中配置，页面不回显原文，不写入 GitHub。

---

## 4. 自动采集规范（核心 P0）

### 4.1 适配器接口

所有数据源实现统一逻辑：

`canHandle(target)` → `checkPermission(target, action)` → `collect(target, context)` → `normalize(raw)` → `validate(observation)`

至少保留如下适配器类别：
- `LicensedBrowserAdapter`：Playwright 访问明确许可的网页，读取可见信息；不使用隐藏/受限接口。
- `LicensedApiAdapter`：已获授权的 API 或数据服务。
- `FixtureAdapter`：仅用于本地开发/CI 的固定测试数据；生产 UI 必须明确标注模拟数据且不得作为真实自动监控成功证明。

来源权限要求**按动作区分**：`automated_access_allowed`、`storage_allowed`、`internal_analysis_allowed`、`redistribution_allowed`。只有前三者满足才允许首采和后续快照入库；禁再传播时不得对外部 Agent API 提供源数据。

### 4.2 浏览器生命周期

1. Worker 初始化匹配版本的 Chromium；以非 root、启用适当沙箱的进程运行。
2. 一个浏览器进程可顺序复用；每个任务使用独立 `BrowserContext`，任务完成即关闭 context。
3. 单任务超时默认 30 秒；必要时分离页面加载超时和字段等待超时。
4. 只读许可字段，不保存完整用户页面、Cookie 或私人会话数据。
5. 允许的诊断截图/Trace 默认关闭；出错时经脱敏策略保存，最多 7 天后清理。
6. 浏览器崩溃自动重建 worker 浏览器会话，当前 Run 明确标记失败并在允许时重试。

### 4.3 响应类型和重试策略

| 类型 | 示例 | V1 动作 |
|---|---|---|
| success | 商品匹配且指定字段有效 | 写快照，更新最后成功与下次计划 |
| partial | 商品匹配但部分字段缺失 | 只写可用字段，质量标记 partial，不写 0 |
| transient | DNS/网络超时、502/503 | 指数退避 + 抖动，最多重试 2 次 |
| rate_limited | 429 | 遵守来源许可与 Retry-After；不能确认安全重试则暂停 |
| blocked | 403、验证码、登录墙、来源明确拒绝 | 立即停止自动访问并告警，不重试绕过 |
| unavailable | 官方显示下架/不存在 | 标记商品可能不可用，保留历史，必要时人工复核 |
| parse_error | DOM 改版或字段格式未知 | 不写假数据；记录解析错误与适配器版本 |
| unauthorized | 无许可/过期/超出用途 | 不发请求；等待授权状态 |

**禁止**：将任何异常兜底为 `sales=0`；使用旧快照冒充新结果；遭到访问拒绝后持续密集尝试。

### 4.4 状态机（必须区分商品、任务、来源）

**商品监控状态**：`active` / `paused` / `deleted`。来源不足另显 `awaiting_source_authorization`。

**来源绑定状态**：`ready` / `awaiting_authorization` / `blocked` / `disabled`。

**任务状态**：`queued` / `leased` / `running` / `succeeded` / `partial` / `retry_wait` / `failed` / `blocked` / `cancelled`。

**新鲜度状态（派生）**：`fresh` / `stale` / `never_collected`；不可与任务状态混为同一枚举。

**执行规则**：事务领取 → 许可检查 → 采集 → 校验 → 快照与结果同事务写入 → 更新下次计划。重试的执行尝试应有独立 Run，重复回调不能重复写观察快照。

---

## 5. 指标定义和计算规则（不可自行简化）

### 5.1 数值结构

每个指标保存：
- `raw_text`：来源原文，如 `已售 1.2 万+`。
- `metric_key`：如 `sales_display` / `list_price`。
- `numeric_value`：可解析值，例如 `12000`。
- `precision`：`exact` / `lower_bound` / `range` / `approximate` / `missing`。
- `unit`：`item`、`CNY_cent` 等。
- `scope`：`product_cumulative_display` / `sku_cumulative_display` / `period_display` 等。
- `source_id`、`observed_at`、`raw_label`、`parser_version`。
- `confidence`：数据质量标记，不代表统计置信区间。
- `currency`：默认 CNY，价格以整数分存储。

### 5.2 判定示例

| 页面原文 | 结构化保存 | 可得结论 |
|---|---|---|
| `已售 0` | value=0, exact（经真实字段确认） | 页面显示 0 |
| `已售 123` | value=123, exact | 页面显示整数 123；非订单真实性保证 |
| `已售 1.2万+` | value=12000, lower_bound | 页面展示下界至少 12000 |
| `已售 10万+` | value=100000, lower_bound | 页面展示下界至少 100000 |
| 空/未出现 | value=NULL, missing | 没拿到，不代表销量为 0 |
| `¥19.9` | price_minor=1990 | 展示价格为 19.90 元 |
| `起售价 ¥9.9` | price_minor=990 + price_kind=starting_from | 起售价，不当作全 SKU 售价 |

### 5.3 趋势和排名

1. **只有相同商品 ID、同一数据源、同一统计范围/口径、同一单位、精度可比较时才计算差值**。
2. 两个精确累计展示数可计算 `展示值差`，但仍不是实际新增成交订单；负数需展示“展示值减少/数据异常”，不自动推断退款。
3. 近似/下界数值：不显示精确“新增 1000 单”，只显示 `展示门槛上升（1.2万+ → 1.3万+）`。
4. 不用 `当前价格 × 展示值差` 作为真实 GMV。
5. 7 天/30 天图表允许不规则采样；缺失期间断线而非补 0 或插值为真实值。
6. 排行榜默认可按 `销量展示门槛变化` 与 `价格变化` 查看，精确数值排名只能对同口径且精度可比的数据提供。
7. 数据源切换时产生新序列；只有明确核对口径一致时才允许合并对比。

---

## 6. 页面、导航与交互信息架构

### 6.1 路由

| 页面 | 路由 | P0 内容 |
|---|---|---|
| 登录 | `/login` | 管理员登录 |
| 总览 | `/dashboard` | 商品总数、正常监控数、数据过期数、告警数、采集健康 |
| 商品列表 | `/products` | 搜索/分类/状态、批量添加、最新观察、下次到期 |
| 商品详情 | `/products/[id]` | 历史曲线、价格、快照记录、最近任务、暂停/恢复 |
| 运行记录 | `/runs` | 任务状态、耗时、错误、来源、重试次数 |
| 告警中心 | `/alerts` | 异常合并、未读计数、查看详情、标记已读 |
| 数据源/设置 | `/settings` | 来源授权/频率、时区、系统运行参数 |
| 健康检查 | `/healthz` | 最小可用健康响应（敏感详情只在登录后） |

### 6.2 交互原则

- 面向桌面优先，同时适配手机浏览器。
- 所有异步操作显示 `pending/success/error`；不要仅用“请求已受理”表示“采集成功”。
- 展示值必须同时显示精度和时间，例：`已售 1.2万+ · 下界 · 更新于 2026-10-18 09:01`。
- 已过期数值可展示历史快照，但使用醒目的过期文字标记。
- 新增商品完成后优先展示`排队中`，一旦失败及时可见错误。
- 空状态展示下一步动作与原因，例如`没有取得许可的数据源，因此未启动自动监控`。
- 页面不能默认将“无数据”画成 0。

---

## 7. 数据库逻辑模型（SQLite V1）

### 7.1 基本要求

- SQLite 文件路径：`/data/xhs-monitor.sqlite`（宿主机持久化目录映射）。
- `PRAGMA foreign_keys=ON`、`journal_mode=WAL`、`busy_timeout=5000`；所有服务操作同一个**本地文件系统**，禁止多台主机共享 NFS 上的 WAL 文件。
- 迁移采用版本化 SQL / Drizzle migrations；生产启动时检查迁移状态，失败时阻止 Worker 启动并报警。
- 时间均以 UTC 毫秒整数或统一 ISO UTC 文本存储，**全库统一一种方式**；UI 按设定时区展示。
- 不依赖 SQLite 进行并行多写入：单 Worker、短事务、受控并发；所有写入路径使用事务和唯一约束。

### 7.2 表 1：`products`

| 字段 | 类型 | 说明 |
|---|---|---|
| id | TEXT PK | ULID/UUID |
| platform | TEXT NOT NULL | 固定 xiaohongshu |
| platform_product_id | TEXT NULL | 真正解析得到的平台 ID |
| original_url / canonical_url | TEXT | 录入 URL 与规范链接 |
| title / shop_name | TEXT NULL | 最新可信的商品名、店铺名 |
| category / tags_json | TEXT | 用户分组与标签 |
| monitor_status | TEXT | active / paused / deleted |
| created_at / updated_at | INTEGER | UTC 时间 |
| deleted_at | INTEGER NULL | 软删除 |

唯一性：`(platform, platform_product_id)` 对非 NULL ID 唯一；规范 URL 有对应的去重策略。

### 7.3 表 2：`data_sources`

`id`、`name`、`type`（licensed_browser / licensed_api / fixture）、`enabled`、`auto_access_allowed`、`storage_allowed`、`analysis_allowed`、`redistribution_allowed`、`permission_basis`、`permission_verified_at`、`permission_expires_at`、`minimum_interval_seconds`、`allowed_fields_json`、`config_version`、`created_at`、`updated_at`。

数据源的权限需有管理操作审计；缺少证明或过期不能默认为允许。

### 7.4 表 3：`product_source_bindings`

`id`、`product_id` FK、`source_id` FK、`status`、`interval_seconds`、`next_due_at`、`last_attempt_at`、`last_success_at`、`consecutive_failures`、`blocked_reason`、`created_at`、`updated_at`。

约束：单个商品同一来源不能重复绑定；`interval_seconds` 不小于数据源的`minimum_interval_seconds`；`status=blocked` 时不得由调度器领取。

### 7.5 表 4：`collection_jobs`

`id`、`binding_id` FK、`scheduled_for`、`status`、`priority`、`idempotency_key` UNIQUE、`lease_owner`、`lease_expires_at`、`attempt_count`、`next_retry_at`、`created_at`、`updated_at`。

使用原子事务`UPDATE...RETURNING`或等效策略领取 Job。重启后只有租约到期的任务可重新领取；原完成 Job 不重复采集。

### 7.6 表 5：`collection_runs`

`id`、`job_id` FK、`attempt_no`、`started_at`、`finished_at`、`duration_ms`、`result`、`error_code`、`error_message_redacted`、`http_status`、`adapter_version`、`trace_path`（可空）、`created_at`。

保留每次尝试，不能用后一次运行覆盖前一次失败。错误信息须脱敏，禁止保存 Cookie/Token。

### 7.7 表 6：`product_observations`

`id`、`product_id` FK、`source_id` FK、`job_id` FK、`run_id` FK、`observed_at`、`product_status`、`sales_raw_text`、`sales_value` NULLABLE、`sales_precision`、`sales_scope`、`sales_unit`、`price_raw_text`、`price_minor` NULLABLE、`price_kind`、`currency`、`title_observed`、`shop_observed`、`parser_version`、`quality_status`、`created_at`。

原则：
- 一次成功/部分成功的有效观察记录一条快照，禁止覆盖历史；
- 同一次 Job 不可重复写快照（`UNIQUE(job_id, source_id)` 或等效约束）；
- 异常时不能插入“假 0”快照；
- `sales_precision=missing` 时，`sales_value` 必须为 NULL；
- `sales_precision=exact` 且确认为 0 时，允许保存整数 0。

### 7.8 表 7：`alert_events`

`id`、`product_id` NULL、`source_id` NULL、`type`、`severity`、`dedupe_key`、`first_seen_at`、`last_seen_at`、`occurrences`、`status`（open / acknowledged / resolved）、`details_json`、`created_at`。

### 7.9 表 8：`audit_logs`

`id`、`actor`、`action`、`entity_type`、`entity_id`、`safe_change_json`、`created_at`。

记录数据源许可改动、频率变更、账号登录、手动触发、暂停/恢复与删除。敏感字段不得写入审计内容。

### 7.10 表 9：`app_settings`（可选 K/V）

`key` PK、`value_json`、`updated_at`。只保存非敏感配置；密钥必须留在环境变量或 secrets 中。

### 7.11 核心索引

- `products(platform, platform_product_id)` 唯一（非空）。
- `product_source_bindings(status, next_due_at)`。
- `collection_jobs(status, scheduled_for, next_retry_at)`。
- `collection_jobs(idempotency_key)` 唯一。
- `collection_runs(job_id, attempt_no)` 唯一。
- `product_observations(product_id, source_id, observed_at DESC)`。
- `alert_events(status, last_seen_at DESC)`，`alert_events(dedupe_key)` 按活跃状态去重。

---

## 8. API 设计（V1 内部）

### 8.1 鉴权与原则

- 全部业务 API 需要管理员身份；服务间 Worker 不经公网 API 写 SQLite，直接通过共享的数据访问层。
- 输入使用 Zod 等进行 schema 验证；CSRF、SameSite、安全 Cookie、限速和审计。
- JSON 返回标准格式：`{ data, error: { code, message }, requestId }`（成功时 error=null）。
- 创建资源允许 `Idempotency-Key`；错误必须有可机器读取的代码，不仅是自然语言。
- API 返回的观察快照必须带 `source`、`observedAt`、`precision`、`quality`。

### 8.2 主要路由

| 方法 | 路由 | 功能 |
|---|---|---|
| POST | `/api/auth/login` | 管理员登录 |
| POST | `/api/auth/logout` | 退出 |
| GET | `/api/products` | 分页/搜索/筛选 |
| POST | `/api/products` | 添加商品并自动排首采（获许可时） |
| POST | `/api/products/batch` | 批量添加（≤20） |
| GET | `/api/products/:id` | 商品详情 |
| PATCH | `/api/products/:id` | 分类、备注、周期、开关 |
| DELETE | `/api/products/:id` | 软删除并停止后续调度 |
| GET | `/api/products/:id/observations` | 历史快照 |
| POST | `/api/products/:id/collect` | 受许可约束的手动调试触发 |
| GET | `/api/jobs` | 分页任务列表 |
| GET | `/api/runs` | 采集运行记录 |
| GET | `/api/alerts` | 告警 |
| PATCH | `/api/alerts/:id` | 已读/确认 |
| GET | `/api/sources` | 来源及许可状态 |
| PATCH | `/api/sources/:id` | 管理许可状态、启用开关 |
| GET | `/api/system/health` | 登录后系统运行详情 |
| GET | `/healthz` | 匿名精简健康状态 |

### 8.3 Agent API

V1 不提供对外 Agent 数据接口（P1），避免在来源许可和敏感信息检查完成前开放数据；预留模块接口。

---

## 9. 非功能需求：可靠性、安全与运维

### 9.1 部署拓扑

`Internet → Caddy(HTTPS) → Next.js(web+API) → SQLite(/data) ← Playwright Worker`

- 服务划分：`caddy`、`web`、`worker`，另可配置一次性迁移/备份任务；SQLite 不是独立网络服务。
- 所有应用服务运行在**同一台 VPS 的本地磁盘**上；web 与 worker 挂载同一受控数据目录，限制为需要访问的容器。
- HTTPS 由 Caddy 处理；业务服务端口不直接暴露公网；防火墙只放通必需端口。
- Compose 设置 `restart: unless-stopped` / 合理的健康检查和资源限制。
- 生产容器不挂载 Docker socket；日志按大小轮转；数据卷在重建镜像后保持不变。
- 不在本版引入 Redis、PostgreSQL、Kubernetes 或 Vercel。

### 9.2 数据库可靠性

- 使用 WAL 和 `busy_timeout`；控制写入事务时长，防止 `SQLITE_BUSY`。
- 使用 SQLite Online Backup API 或 `VACUUM INTO` 做一致性备份；**不能在 WAL 活跃时只用 cp 复制主 db 文件当作可靠热备份**。
- 每日备份、保留最近 7 个每日备份和最近 4 个每周备份（可配置）；至少一份加密备份放在 VPS 外。
- 每月进行一次恢复演练；数据库迁移前自动备份并验证可回滚。
- 生产数据库、密钥、Trace 均不得提交 GitHub。
- 指标目标：RPO ≤24h（备份周期保证时），RTO ≤2h（文档化恢复并验证后）；若尚未实测，只标为设计目标。

### 9.3 浏览器安全

- 遵循 Playwright 官方关于爬取外部网页的指导：独立非 root 用户、恰当 seccomp/Chromium sandbox。
- 不以 `--no-sandbox`、`--disable-web-security` 作为默认启动方式。
- 容器设置内存/CPU 限制；V1 仅启动一个浏览器、默认同时一个采集任务。
- 访问目标 URL 需 allowlist、DNS/IP 和跳转链校验，禁止 SSRF 到 VPS 内网、Docker 网络、metadata 或 localhost。
- 浏览器不持有管理员后台会话、备份密钥或不必要的数据库凭据。
- 截图/Trace 在确需排错时按最小化原则保存，并设置短期清理/访问权限。

### 9.4 后台安全

- 单用户管理员，首次通过安全初始化流程设置密码，服务器保存 Argon2id（或强度相当）密码哈希。
- 生产开启安全 Cookie、会话过期、登录速率限制与失败审计；严禁默认演示账户密码。
- 认证、授权、频率限制在服务端执行，不能只隐藏前端按钮。
- 对外接口最小权限，禁止读取任意文件和访问任意域名。
- `.env`、数据库、密钥、备份与执行 Trace 必须在 `.gitignore` 排除；提交前配置 secret scanning。

### 9.5 日志和可观测性

- 结构化 JSON 日志：`timestamp, level, requestId, jobId, productId, sourceId, durationMs, errorCode`。
- 日志不能含 Token、Cookie、完整私人页面内容。
- 健康指标：Web 存活、Worker 最近心跳、队列积压、过去 24 小时任务运行率、有效字段率、连续失败商品数、数据库/磁盘占用、备份最近成功时间。
- Worker 心跳超过 10 分钟未更新时产生内部告警；后台明显提示自动监控可能停止。
- 最近一次失败不能覆盖最近一次成功时间。

### 9.6 性能与容量假设

- 第一版目标 10–50 个监控商品；默认每日采集，浏览器并发 1，内存预算建议从 2 vCPU / 4 GB VPS 起实测。
- SQLite 对这个规模适用；如需要多 VPS/高并发写入，再评估 PostgreSQL，非当前必需。
- 页面列表必须服务端分页；历史查询应以 `product_id + observed_at` 索引执行。
- P95 列表接口本地处理目标 <500ms（排除公网延迟、冷启动与超大数据库，需压测验证）。
- 单采集任务默认超时 30 秒，并可配置；外部响应不可控，不能承诺固定成功时长。

### 9.7 保留和删除

- 有效商品快照默认持续保留（个人自用，受来源授权期限限制）；超出许可保留期时必须清理。
- 原始诊断截图/Trace 最多保留 7 天；常规运行日志保留 30 天或按磁盘容量提前轮转。
- 商品删除默认软删除，停止调度；管理员可单独确认永久删除相关快照。
- 数据源许可终止时，按合同/授权要求停止采集并删除需要清理的数据。

---

## 10. 质量保证与验收用例

### 10.1 单元测试

| ID | 场景 | 预期 |
|---|---|---|
| UT-01 | 解析“已售 0” | 0 + exact，而不是 missing |
| UT-02 | 解析“已售 1.2万+” | 12000 + lower_bound |
| UT-03 | 销量元素缺失 | NULL + missing |
| UT-04 | 价格“¥19.9” | 1990 分 |
| UT-05 | 起售价“¥9.9起” | 正确标记起售价 |
| UT-06 | 同 URL 重复添加 | 一个有效商品、一份生效监控 |
| UT-07 | 不同 URL 对应同商品 ID | 不产生重复商品 |
| UT-08 | 来源未授权/许可过期 | 零外部采集请求 |
| UT-09 | 近似销量门槛变化 | 仅提示阈值提升，不产生“新增 1000 单” |
| UT-10 | 新采集失败 | 保留历史有效值和原最近成功时间 |
| UT-11 | 同一 Job 重复回调 | 不重复写入 Observation |
| UT-12 | SQL 事务写入失败 | 无半成功的关联记录 |

### 10.2 集成/异常测试

| ID | 场景 | 预期 |
|---|---|---|
| IT-01 | 新增许可目标 | 自动首采并保存首次快照 |
| IT-02 | 定时周期到期 | 自动排入任务，无须用户点击 |
| IT-03 | 关闭浏览器 | VPS 上 Worker 持续执行 |
| IT-04 | Worker 重启 | 恢复到期任务，不重复快照 |
| IT-05 | 浏览器崩溃 | 错误记录且后续商品仍可运行 |
| IT-06 | 网络超时或 503 | 有限重试后明确失败 |
| IT-07 | 429 | 按 Retry-After/许可暂停或限次恢复 |
| IT-08 | 403/验证码/登录墙 | blocked + 告警，无自动绕过 |
| IT-09 | 下架或 404 | 保留历史，商品标记不可用待核验 |
| IT-10 | DOM 结构变化 | parse_error，未写入虚假 0 |
| IT-11 | 并发竞争同一 Job | 仅一个执行持有租约 |
| IT-12 | Docker 重建 | SQLite 数据无丢失 |
| IT-13 | 热备份与恢复 | 恢复数据和最近快照一致 |
| IT-14 | 未登录访问业务 API | 401 / 重定向且无敏感泄露 |
| IT-15 | 恶意内网 URL/跳转 | 被拒绝，无 SSRF |
| IT-16 | 许可撤销 | 下一轮任务不再访问该来源 |

### 10.3 上线门槛（必须同时满足）

1. **功能**：P0 页面与 API 实际可用，而非静态 mock。
2. **自动化**：至少 10 个**已取得许可、提供可用字段**的真实商品目标连续 7 个计划周期无人值守；若无法获得许可，则真实竞品自动监控功能不可标记“验收通过”。
3. **可靠性**：任务执行率 ≥99%（按已到期且获准运行的任务统计），关键异常测试均通过；外部数据成功率如实报告。
4. **数据质量**：精确、下界、缺失、0、跨来源不可比等测试全部通过。
5. **安全**：后台必须登录、密钥不入库/仓库、SSRF 防护、受限采集可自动停用。
6. **恢复**：Docker 重建、Worker 重启、数据库备份恢复流程至少各成功测试一次。
7. **资料**：README、部署文档、环境变量样例、变更记录、验证报告完整。

如果只有 `FixtureAdapter` 测试通过，则可以宣布**系统基础能力完成**，但不能宣布真实竞品自动监控交付完成。

---

## 11. 开发实施顺序与里程碑

**M0 — 需求基线**：完成并提交本 PRD；明确产品数据许可和真实指标范围。*当前阶段*。

**M1 — 技术骨架**：初始化 pnpm workspace、Next.js、TypeScript、SQLite/Drizzle、Docker Compose、登录和基础表迁移；完成健康检查。

**M2 — 自动采集闭环**：完成数据源权限、统一 Adapter、Playwright Worker、任务/运行状态机、错误码、幂等、快照与后台状态；先以 Fixture 做 CI 验证，再接入至少一个真实已许可数据源。

**M3 — 可视化与告警**：商品列表/详情、历史图、监控健康、价格与销量展示值变化、站内异常提醒。

**M4 — VPS 上线验证**：独立容器安全、HTTPS、备份恢复、7 天无人值守试运行、测试报告，确认真实监控能力及数据局限。

每个里程碑都应：更新文档 → 开发代码 → 测试 → 更新变更记录。未完成对应验收条件时不能跳过标记完成。

---

## 12. 代码组织规范（方案）

```text
xhs-monitor/
├── apps/
│   ├── web/                 # Next.js 页面与 API
│   └── worker/              # Playwright Worker / 调度
├── packages/
│   ├── db/                  # SQLite schema / Drizzle migrations
│   ├── core/                # 领域类型、解析、数据校验和业务规则
│   └── collectors/          # 获许可的数据源适配器
├── deploy/
│   ├── compose.yaml
│   ├── Caddyfile
│   └── docker/              # 安全镜像定义
├── docs/
│   ├── PRD.md               # 本需求说明书
│   ├── ARCHITECTURE.md      # M1 产生
│   ├── DEPLOY.md            # M1/M4 完善
│   ├── TEST_PLAN.md         # M2/M4 完善
│   └── CHANGELOG.md         # 随开发同步更新
├── .env.example
├── .gitignore
├── README.md
└── package.json
```

> V1 优先单机稳定性与可观测性，不为将来可能的高规模预设复杂微服务。

---

## 13. 依赖、风险与应对

| 风险 | 可能后果 | 对策 |
|---|---|---|
| 竞品来源未授权或缺少自动接口 | 无法持续取得真实商品指标 | 上线前来源许可核实；不启动未授权采集；通过 Fixture 验证技术闭环 |
| 页面不显示销量 | 监控值缺失 | 明确 missing，允许价格/状态等其他字段观察 |
| 平台结构变化 | 解析器失效 | 适配器版本、解析测试样例、错误分类和告警 |
| 平台风控/验证 | 数据源 blocked | 立即停采，核实授权后再人工恢复 |
| 销量缩写不精确 | 错误排名和结论 | 原始文本、精度等级、按阈值展示而非精确新增 |
| SQLite 并发写锁 | 写入失败/运行卡住 | 单 Worker、短事务、WAL、busy_timeout、合适索引 |
| VPS 磁盘故障 | 监控数据丢失 | 每日一致性备份+异机副本+恢复演练 |
| Playwright 容器权限过大 | VPS 其他服务受影响 | 非 root、沙箱、隔离、资源限制、禁敏感卷 |
| 公有 GitHub 仓库泄露敏感信息 | 密钥/数据库暴露 | .gitignore、secret scanning、审计、切勿提交 Cookie |
| 未按期调度 | “监控中”实际无更新 | Worker 心跳、队列积压、stale 告警和健康页 |

---

## 14. 未验证项与决策门槛

下列不是请用户重复回答的问题，而是**实施阶段必须验证并记录的客观事实**：

1. 真实竞品销量字段能否通过某个**取得许可**的数据源自动获取，数据服务有哪些字段和用途限制？
2. 商品 ID 的真实可解析形态、规范 URL 规则、跳转行为和商品/店铺口径。
3. 销量“已售”是商品/SPU/SKU/历史累计还是别的统计维度；是否存在四舍五入/门槛展示。
4. VPS 的实际可用内存、浏览器沙箱支持、域名/DNS/HTTPS 条件及磁盘挂载路径。
5. 实测超时、采集字段覆盖率、单浏览器吞吐与连续运行故障类型。

这些项未解决时，开发可以先做通用产品底座与模拟测试，但**不得宣称真实自动销量监控已在生产稳定运行**。

---

## 15. 变更控制

- 本文件是产品需求的**单一事实来源**；需求变更必须更新 `docs/PRD.md` 的版本、日期、变更内容及受影响验收项。
- 功能代码变动必须同步维护 `docs/CHANGELOG.md` 与相关技术/部署文档。
- 必须区分：`未开发`、`开发中`、`模拟验证通过`、`真实来源验证通过`、`生产验收通过`。
- 默认不在首次提交时加入未经验证的浏览器爬虫代码，以免误将未获得许可或无数据可用的来源宣称为“已支持”。

### 版本记录

| 版本 | 日期 | 变更 |
|---|---|---|
| 1.0.0 | 2026-10-18 | 根据已确认决策形成完整 PRD：Playwright、单 VPS、SQLite、自动监控 P0、数据源授权、数据质量、状态机、逻辑数据模型、部署、安全与验收 |
| 1.0.1 | 2026-10-18 | 提交 Ubuntu 单 VPS 部署入口 scripts/deploy.sh、.env.example、.gitignore 与 docs/DEPLOY.md；增加 Docker 安装防冲突检查、SQLite 一致性备份、HTTPS/域名配置检查；Web/Worker 仍未开发 |
| 1.1.0 | 2026-10-18 | 开始开发：提交 Next.js 管理后台、SQLite 数据层、Playwright Worker、定时队列、来源许可、异常日志、Compose 与自动化测试。基础功能有代码，不代表真实竞品销量已可用；VPS/7 天验收未完成。 |

---

## 16. 参考文档

- 小红书开放平台开发者文档：https://open.xiaohongshu.com/document/developer/file/17
- Playwright 官方 Docker / 浏览器安全建议：https://playwright.dev/docs/docker
- SQLite WAL 模式：https://www.sqlite.org/wal.html
- SQLite Online Backup：https://www.sqlite.org/backup.html
- Docker Compose 生产指南：https://docs.docker.com/compose/how-tos/production/
