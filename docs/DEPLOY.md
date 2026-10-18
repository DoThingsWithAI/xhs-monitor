# Ubuntu VPS 部署和维护指南

> 项目：`DoThingsWithAI/xhs-monitor` · 版本：部署脚本 v1.0 · 2026-10-18
>
> **当前状态：仓库暂时只有 PRD、部署准备脚本和文档。Web、Playwright Worker 与 Compose 尚未开发，因此目前不能真正启动商品监控。** 脚本会主动检查并阻止“假成功”。

## 1. 适用环境

- Ubuntu 22.04、24.04 或 26.04 LTS；amd64/x86_64 或 arm64/aarch64。
- 用户提供内核版本 `6.8.0-146-generic` / `x86_64`。**内核号不能判定 Ubuntu 发行版版本**，请先执行 `cat /etc/os-release`。
- VPS 建议预留至少 2 vCPU / 4 GiB RAM 供 Web + Playwright Chromium 使用；若已有其他服务，需另外预留资源。
- SSH 登录后以 `root` 或 `sudo` 运行部署脚本。
- 生产建议有解析到 VPS 的域名，以便 Caddy 自动签发 HTTPS 证书。请先检查 80/443 是否被现有代理或其他项目使用。

## 2. 快速执行（现在可以做的准备工作）

```bash
# 运行位置：你的 Ubuntu VPS
sudo apt-get update
sudo apt-get install -y git python3
git clone https://github.com/DoThingsWithAI/xhs-monitor.git /opt/xhs-monitor
cd /opt/xhs-monitor

# 1. 非破坏性环境检查
sudo bash scripts/deploy.sh doctor

# 2. 如果 Docker 已安装，跳过这步；脚本不会替换现有 Docker
# 仅全新 Ubuntu 主机且确实没有 Docker 时执行，需先确认对其他服务无影响
sudo bash scripts/deploy.sh install-docker

# 3. 初始化独立的数据目录 + 私有 .env（重复执行不会覆盖）
sudo bash scripts/deploy.sh prepare

# 4. 编辑 .env：将 APP_DOMAIN=CHANGE_ME 改成真实域名
sudo nano /opt/xhs-monitor/.env
```

**重要**：你 VPS 上可能已经跑其他应用。先执行 `doctor`，不要在未确认现有 Docker、代理和防火墙配置时贸然执行 `install-docker`；本脚本不会自动删除/升级/替换现存容器。

`install-docker` 使用 Docker **官方 Ubuntu apt 仓库**安装 Engine 和 Compose v2；如果发现系统已有 Docker、containerd 或其他潜在冲突组件，脚本会拒绝无提示迁移。**不会运行 `get.docker.com` 便利脚本**。

## 3. 正式一键部署（M1/M2 应用代码齐备后）

完整项目至少需要：
- `apps/web/` Next.js 生产代码；
- `apps/worker/` Playwright Worker 生产代码；
- `deploy/compose.yaml` 定义 `web`、`worker`、`caddy` 三个服务；
- Caddy 配置，支持应用登录鉴权、HTTPS、健康检查；
- web/worker 按应用容器用户 UID/GID 10001 与可写共享数据目录配置；
- 实现数据库迁移和管理员安全初始化；
- Playwright 使用合适的浏览器沙箱并按许可规则决定是否采集。

当以上实现、检查过生产环境变量且域名/端口准备好后：

```bash
cd /opt/xhs-monitor
sudo bash scripts/deploy.sh deploy
```

脚本依次运行：检查 Ubuntu → 检查项目应用文件 → 检查 Docker/Compose → 保留已有 `.env` → 持久化数据目录 → 检查 Compose 服务 → 如数据库存在先做 SQLite 一致性备份 → `docker compose -p xhs-monitor up -d --build --wait` → 显示本项目容器状态。

**现在运行 `deploy` 会明确报错缺少 `deploy/compose.yaml`，这是正确行为，并不代表脚本损坏。** 开发任务仍以 [PRD](PRD.md) 的里程碑为准。

## 4. 后续升级、查看状态和备份

```bash
# 仅 main 分支且没有本地已跟踪文件修改时，快进拉取并重新部署
sudo bash scripts/deploy.sh update

# 查看本项目容器状态（不会展示其他 Compose 项目）
sudo bash scripts/deploy.sh status

# 备份已经存在的 SQLite 数据库（需要 Python 3）
sudo bash scripts/deploy.sh backup

# 环境自检
sudo bash scripts/deploy.sh doctor
```

`update` 使用 `git pull --ff-only`，不会 `git reset --hard`；如果检测到本地已跟踪文件修改则停止，避免覆盖修改。

### SQLite 数据路径和权限

- 数据库预定路径：`/var/lib/xhs-monitor/xhs-monitor.sqlite`（或 `.env` 中 `XHS_DATA_DIR` 指定的绝对路径）。
- `prepare` 首次创建的数据目录 owner 是 `10001:10001`，权限 `0770`；已有目录不会自动 `chown`。
- `web` 与 `worker` 必须运行在相同宿主机、访问**同一本地磁盘**。SQLite WAL 不适合多个主机通过 NFS 共享。
- 应用连接 SQLite 时设置 `PRAGMA journal_mode=WAL;`、`PRAGMA busy_timeout=5000;` 和 `PRAGMA foreign_keys=ON;`。
- **严禁**使用 `docker compose down -v`、清空宿主机数据目录，或将 `/var/lib/xhs-monitor` 放进仓库。
- 应用升级时先运行与迁移版本匹配的数据库迁移；生产迁移失败必须停止启动，不可忽略错误。

### 备份说明

- `backup` 使用 Python 标准库 `sqlite3.Connection.backup()` 在线创建一致性副本，不直接复制活跃 WAL 的主数据库文件。
- 备份输出：`/var/backups/xhs-monitor/xhs-monitor-YYYYMMDDTHHMMSSZ.sqlite`，权限 0600，并执行完整性检查。
- 当前备份命令需人工/任务调度器触发，**没有自动异地上传或备份清理功能**。M4 应添加每日调度、保留策略、异地加密备份和恢复演练。
- 要恢复时先停止应用写入，验证备份完整性后恢复数据库文件；恢复操作需单独制定并测试 SOP，脚本故意不提供危险的覆盖命令。

## 5. 生产安全和网络注意事项

1. 仓库公开：`.env`、登录凭证、Cookies、SQLite、截图、Trace **绝不**入库。
2. 此脚本不会修改 UFW/iptables、SSH 或 80/443 端口。Docker 发布容器端口可能绕开 UFW 规则；配置服务时必须检查绑定地址和 Docker 防火墙策略。
3. Caddy 建议只有它发布 80/443；Web/Worker/SQLite 不允许公网直连。已有 Nginx/Caddy 监听端口时先决定统一入口，**不能直接抢占端口**。
4. Playwright 爬取外部页面应以非 root 运行、保持 Chromium 沙箱；不要把 `--no-sandbox` 当作默认方案。
5. 加入 CPU/内存上限、健康检查、重启策略、日志轮转和 Worker 心跳告警。
6. **只自动访问具备明确许可的数据源**。平台 403/429、验证码、登录墙等情况应停止或暂停采集，不能绕过。
7. 完成部署后，还须根据 PRD 真实验证**授权数据源**和连续无人值守计划任务，才算“竞品自动监控上线”。
8. 任何开发变动必须同时更新 `docs/PRD.md` 和 `docs/CHANGELOG.md`。

## 6. 官方参考

- [Docker Ubuntu 安装](https://docs.docker.com/engine/install/ubuntu/)
- [Docker Compose](https://docs.docker.com/compose/install/linux/)
- [Playwright Docker](https://playwright.dev/docs/docker)
- [SQLite 在线备份](https://sqlite.org/backup.html)
- [SQLite WAL](https://sqlite.org/wal.html)
