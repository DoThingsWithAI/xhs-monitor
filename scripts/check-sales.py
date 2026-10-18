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
        " s.storage_allowed AS storage_allowed "
        "FROM product_source_bindings b JOIN data_sources s ON s.id=b.source_id "
        "WHERE b.product_id=? ORDER BY b.created_at DESC LIMIT 1", (pid,)
    ).fetchone()

    latest_observation = connection.execute(
        "SELECT observed_at, sales_raw_text, sales_value, sales_precision, price_minor,"
        " quality_status FROM product_observations "
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
        "job_counts": {r["status"]: r["total"] for r in queued}
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
              "| 自动访问许可:", binding.get("access_allowed"))
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
        print("注意：入库成功仅证明保存了该来源提供的展示值，不代表真实订单销量。")
    return 0 if result["sales_confirmed_in_db"] else 2

if __name__=="__main__":
    sys.exit(main())
