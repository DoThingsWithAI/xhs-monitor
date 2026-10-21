#!/usr/bin/env python3
"""Read-only sales-collection diagnostic for a Xiaohongshu goods-detail product.

Usage:
  python3 scripts/check-sales.py 6a290d7c3222c60001e051bf
  DB_PATH=/data/xhs-monitor.sqlite python3 scripts/check-sales.py <24-hex-id> --json

Exit codes: 0 = sales value found in SQLite; 2 = no sales value; 1 = diagnosis failed.
A stored sales value is NOT independent confirmation of real orders or platform accuracy.
"""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import sqlite3
import sys
from urllib.parse import quote, urlparse

def iso(millis):
    if millis is None:
        return None
    return datetime.fromtimestamp(millis / 1000, tz=timezone.utc).isoformat(timespec="seconds")

def is_product_url(url, product_id):
    try:
        parsed = urlparse(url)
        return (parsed.hostname in ("xiaohongshu.com", "www.xiaohongshu.com", "m.xiaohongshu.com",
                                    "www.xiaohongshu.com.cn")
                and parsed.path.lower().rstrip("/") == "/goods-detail/" + product_id)
    except (ValueError, TypeError):
        return False

def inspect(connection, product_id):
    connection.row_factory = sqlite3.Row
    product = connection.execute(
        "SELECT id, platform_product_id, canonical_url, monitor_status FROM products "
        "WHERE platform_product_id=? LIMIT 1", (product_id,)
    ).fetchone()
    if product is None:
        old = connection.execute(
            "SELECT id, platform_product_id, canonical_url, monitor_status FROM products "
            "WHERE canonical_url LIKE ? LIMIT 200",
            ("%/goods-detail/" + product_id + "%",)
        ).fetchall()
        product = next((r for r in old if is_product_url(r["canonical_url"], product_id)), None)
    if product is None:
        return {"product_id": product_id, "status": "PRODUCT_NOT_IN_DATABASE",
                "sales_confirmed_in_db": False}

    pid = product["id"]
    binding = connection.execute(
        "SELECT b.status, b.last_attempt_at,b.last_success_at,b.next_due_at,"
        " b.interval_seconds,b.blocked_reason,b.consecutive_failures,"
        " s.enabled AS source_enabled,s.automated_access_allowed AS access_allowed,"
        " s.storage_allowed AS storage_allowed,s.analysis_allowed AS analysis_allowed,"
        " length(trim(s.permission_basis)) AS permission_basis_length,"
        " s.permission_expires_at AS permission_expires_at "
        "FROM product_source_bindings b JOIN data_sources s ON s.id=b.source_id "
        "WHERE b.product_id=? ORDER BY b.created_at DESC LIMIT 1", (pid,)
    ).fetchone()

    columns = {row["name"] for row in connection.execute("PRAGMA table_info(product_observations)")}
    optional = ("shop_observed", "shop_rating_raw_text", "shop_rating_hundredths",
                "shop_sales_raw_text", "shop_sales_value", "shop_sales_precision",
                "shop_followers_raw_text", "shop_followers_value", "shop_followers_precision")
    # Existing SQLite databases may not yet have applied the additive migration.
    safe_columns = ", ".join((name if name in columns else "NULL AS " + name) for name in optional)
    latest_observation = connection.execute(
        "SELECT observed_at, sales_raw_text, sales_value, sales_precision, price_minor,"
        " quality_status, " + safe_columns + " FROM product_observations "
        "WHERE product_id=? ORDER BY observed_at DESC LIMIT 1", (pid,)
    ).fetchone()
    latest_sales = connection.execute(
        "SELECT observed_at, sales_raw_text, sales_value, sales_precision, quality_status "
        "FROM product_observations WHERE product_id=? AND sales_value IS NOT NULL "
        "ORDER BY observed_at DESC LIMIT 1", (pid,)
    ).fetchone()
    recent_runs = connection.execute(
        "SELECT r.started_at, r.finished_at,r.result,r.error_code, j.status AS job_status "
        "FROM collection_runs r JOIN collection_jobs j ON j.id=r.job_id "
        "JOIN product_source_bindings b ON b.id=j.binding_id "
        "WHERE b.product_id=? ORDER BY r.started_at DESC LIMIT 5", (pid,)
    ).fetchall()
    queued = connection.execute(
        "SELECT status, count(*) AS total FROM collection_jobs "
        "WHERE binding_id IN (SELECT id FROM product_source_bindings WHERE product_id=?) "
        "GROUP BY status", (pid,)
    ).fetchall()
    latest_job = connection.execute(
        "SELECT j.status, j.scheduled_for, j.attempt_count, j.next_retry_at, "
        " j.lease_expires_at, j.created_at "
        "FROM collection_jobs j "
        "JOIN product_source_bindings b ON b.id=j.binding_id "
        "WHERE b.product_id=? ORDER BY j.created_at DESC, j.rowid DESC LIMIT 1",
        (pid,)
    ).fetchone()
    pacing_available = connection.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='source_request_pacing'"
    ).fetchone() is not None
    pacing = connection.execute(
        "SELECT pace.last_started_at, pace.next_allowed_at FROM source_request_pacing pace "
        "JOIN product_source_bindings b ON b.source_id=pace.source_id "
        "WHERE b.product_id=? LIMIT 1", (pid,)
    ).fetchone() if pacing_available else None
    heartbeat = connection.execute(
        "SELECT last_seen_at FROM system_heartbeats WHERE name='worker'"
    ).fetchone()

    now = datetime.now(tz=timezone.utc).timestamp() * 1000
    interval = binding["interval_seconds"] if binding else 86400
    fresh = bool(latest_sales and now-latest_sales["observed_at"] <= max(3600000, 2 * interval * 1000))
    observed_sales = bool(latest_sales and latest_sales["sales_value"] is not None)
    newest_has_sales = bool(latest_observation and latest_observation["sales_value"] is not None)
    output = {
        "product_id": product_id,
        "status": "SALES_STORED" if observed_sales else "NO_SALES_VALUE",
        "sales_confirmed_in_db": observed_sales,
        "latest_attempt_has_sales": newest_has_sales,
        "sales_is_fresh_by_configured_interval": fresh,
        "note": "This confirms recorded display data, NOT genuine paid orders or source correctness.",
        "monitor_status": product["monitor_status"],
        "source": dict(binding) if binding else None,
        "worker_last_heartbeat_utc": iso(heartbeat["last_seen_at"]) if heartbeat else None,
        "worker_heartbeat_recent": bool(heartbeat and now-heartbeat["last_seen_at"]<600000),
        "latest_observation": (
            {**dict(latest_observation), "observed_at_utc": iso(latest_observation["observed_at"])}
            if latest_observation else None),
        "latest_nonnull_sales": (
            {**dict(latest_sales), "observed_at_utc": iso(latest_sales["observed_at"])}
            if latest_sales else None),
        "recent_runs": [{**dict(r), "started_at_utc": iso(r["started_at"]),
                         "finished_at_utc": iso(r["finished_at"])} for r in recent_runs],
        "job_counts": {r["status"]: r["total"] for r in queued},
        "latest_job": (
            {**dict(latest_job),
             "scheduled_for_utc": iso(latest_job["scheduled_for"]),
             "next_retry_at_utc": iso(latest_job["next_retry_at"]),
             "lease_expires_at_utc": iso(latest_job["lease_expires_at"])}
            if latest_job else None
        ),
        "source_pacing": (
            {**dict(pacing), "next_allowed_at_utc": iso(pacing["next_allowed_at"])}
            if pacing else None
        )
    }
    if output["source"]:
        b=output["source"]
        for key in ["last_attempt_at","last_success_at","next_due_at"]:
            b[key+"_utc"]=iso(b[key])
    return output

def main():
    parser = argparse.ArgumentParser(description="Read-only SQLite sales-collection verification")
    parser.add_argument("product_id", help="24-character hex product ID from goods-detail URL")
    parser.add_argument("--json", action="store_true", help="Machine-readable output")
    args = parser.parse_args()
    pid = args.product_id.lower()
    if not re.fullmatch(r"[0-9a-f]{24}", pid):
        parser.error("Product ID must be 24 hexadecimal characters")
    source = Path(os.environ.get("DB_PATH") or
                  os.path.join(os.environ.get("XHS_DATA_DIR", "/data"), "xhs-monitor.sqlite")).absolute()
    if not source.is_file():
        print("ERROR: SQLite database not found at " + str(source), file=sys.stderr)
        return 1
    try:
        uri="file:" + quote(str(source), safe="/") + "?mode=ro"
        with sqlite3.connect(uri,uri=True,timeout=4) as conn:
            conn.execute("PRAGMA query_only=ON")
            result=inspect(conn,pid)
    except sqlite3.Error as exc:
        print("ERROR: SQLite inspection failed: " + str(exc), file=sys.stderr)
        return 1
    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        print("=== 小红书商品销量抓取验证（SQLite 只读） ===")
        print("商品 ID:", pid)
        print("判断:", "已有非空销量展示值入库" if result["sales_confirmed_in_db"] else "未发现成功保存的销量值")
        if result["status"] == "PRODUCT_NOT_IN_DATABASE":
            print("原因: SQLite 中找不到该商品；先确认商品已添加、数据库路径正确。")
            return 2
        print("监控状态:", result["monitor_status"])
        binding=result["source"] or {}
        print("来源绑定:", binding.get("status", "无"),
              "| 来源启用:", binding.get("source_enabled"),
              "| 自动访问许可:", binding.get("access_allowed"),
              "| 存储许可:", binding.get("storage_allowed"),
              "| 分析许可:", binding.get("analysis_allowed"))
        print("监控周期:", (binding.get("interval_seconds") or 0)//3600, "小时",
              "| 下次应采集 (UTC):",binding.get("next_due_at_utc"),
              "| 最近成功 (UTC):", binding.get("last_success_at_utc"),
              "| 最近尝试 (UTC):", binding.get("last_attempt_at_utc"))
        if binding.get("blocked_reason"):
            print("来源阻断原因:", binding["blocked_reason"])
        if binding:
            missing=[]
            if not binding.get("source_enabled"):
                missing.append("数据源未启用")
            if not binding.get("access_allowed"):
                missing.append("未核实自动访问权限")
            if not binding.get("storage_allowed"):
                missing.append("未核实存储权限")
            if not binding.get("analysis_allowed"):
                missing.append("未核实分析权限")
            if (binding.get("permission_basis_length") or 0)<12:
                missing.append("缺少有效授权依据")
            if binding.get("permission_expires_at") is not None and binding["permission_expires_at"]<=datetime.now(tz=timezone.utc).timestamp()*1000:
                missing.append("来源许可过期")
            if missing:
                print("等待原因:", "、".join(missing))
            elif binding.get("status")=="awaiting_authorization":
                print("等待原因: 来源条件已满足但绑定仍待同步；更新 Worker 后检查最近任务。")
        print("Worker 近期有心跳:", result["worker_heartbeat_recent"],
              "| 最近心跳 UTC:", result["worker_last_heartbeat_utc"])
        print("最新观察含销量:", result["latest_attempt_has_sales"],
              "| 历史销量新鲜:", result["sales_is_fresh_by_configured_interval"])
        latest=result["latest_observation"]
        if latest:
            print("最新观察:", latest["observed_at_utc"],
                  "| 销量原文:", latest["sales_raw_text"],
                  "| 数值:", latest["sales_value"],
                  "| 精度:", latest["sales_precision"],
                  "| 质量:", latest["quality_status"])
            print("店铺名称:", latest["shop_observed"] or "未抓到")
            print("店铺口碑:", latest["shop_rating_raw_text"] or "未抓到",
                  "| 整数百分位:",latest["shop_rating_hundredths"])
            print("店铺已售:", latest["shop_sales_raw_text"] or "未抓到",
                  "| 数值:",latest["shop_sales_value"],
                  "| 精度:",latest["shop_sales_precision"])
            print("店铺粉丝:", latest["shop_followers_raw_text"] or "未抓到",
                  "| 数值:",latest["shop_followers_value"],
                  "| 精度:",latest["shop_followers_precision"])
        else:
            print("最新观察: 无")
        valid=result["latest_nonnull_sales"]
        if valid:
            print("最近一次成功入库的销量:", valid["sales_raw_text"], "(数值:",
                  valid["sales_value"],", 精度:",valid["sales_precision"],")",
                  "| 时间 UTC:",valid["observed_at_utc"])
        print("最近任务:")
        for run in result["recent_runs"][:5]:
            print(" -",run["started_at_utc"],"result=",run["result"],
                  "job=",run["job_status"],"error=",run["error_code"])
        if not result["recent_runs"]:
            print(" - 无执行记录（可能仍在等待来源授权或首次任务）")
        print("任务总数:",result["job_counts"])
        latest_job=result["latest_job"]
        print("最新任务:", (latest_job or {}).get("status", "无"),
              "| 原定 UTC:", (latest_job or {}).get("scheduled_for_utc"),
              "| 已尝试:", (latest_job or {}).get("attempt_count", 0),
              "| 下次重试 UTC:", (latest_job or {}).get("next_retry_at_utc"))
        pacing=result["source_pacing"]
        if pacing:
            print("数据源节流：下次允许访问 UTC:",pacing.get("next_allowed_at_utc"))
        # A stored old value does not imply a recent successful scheduled run.
        reasons=[]
        if result["monitor_status"]!="active":
            reasons.append("商品已暂停，调度器不会采集")
        if binding.get("blocked_reason") or binding.get("status")=="blocked":
            reasons.append("来源因访问限制或校验失败而被阻断，请核查上面错误码")
        if not binding.get("source_enabled"):
            reasons.append("数据源处于关闭状态，后续商品任务无法领取")
        if not result["worker_heartbeat_recent"]:
            reasons.append("Worker 近 10 分钟没有心跳，检查容器和日志")
        if latest_job and latest_job["status"] in ("failed", "blocked", "retry_wait"):
            reasons.append("最近任务状态为 "+latest_job["status"]+"，查看最近任务错误码")
        if latest_job and latest_job["status"]=="queued":
            reasons.append("存在排队任务，请检查冷却时间、来源启用状态和 Worker")
        due=binding.get("next_due_at")
        if due and due>datetime.now(tz=timezone.utc).timestamp()*1000:
            reasons.append("下次计划时间尚未到达")
        if (not reasons and binding.get("status")=="ready" and due and
                due<datetime.now(tz=timezone.utc).timestamp()*1000):
            reasons.append("计划已到期仍无正常执行，需检查 Worker 的调度循环日志")
        print("停止更新的可能原因:", "；".join(reasons) if reasons else "请核对最新任务和执行错误码")
        print("注意：入库成功仅证明保存了该来源提供的展示值，不代表真实订单销量。")
    return 0 if result["sales_confirmed_in_db"] else 2

if __name__=="__main__":
    sys.exit(main())
