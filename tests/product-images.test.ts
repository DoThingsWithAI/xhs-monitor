import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  normalizeProductImageUrl,
  normalizeProductImageUrls,
  selectProductImageUrls,
  type ProductImageCandidate
} from "../packages/core/product-images";
import { migrateProductImageColumns } from "../packages/db/product-image-migration";

test("only public HTTPS Xiaohongshu image hosts are retained", () => {
  const allowed = "https://sns-webpic-qc.xhscdn.com/product/main.jpg?imageView2=2";
  assert.equal(normalizeProductImageUrl(allowed), allowed);
  assert.equal(
    normalizeProductImageUrl("/goods/image.jpg", "https://www.xiaohongshu.com/goods-detail/item"),
    "https://www.xiaohongshu.com/goods/image.jpg"
  );
  assert.equal(normalizeProductImageUrl("http://sns-webpic-qc.xhscdn.com/a.jpg"), null);
  assert.equal(normalizeProductImageUrl("https://not-xhscdn.com/a.jpg"), null);
  assert.equal(normalizeProductImageUrl("https://example.com/a.jpg"), null);
  assert.equal(normalizeProductImageUrl("https://user:pass@sns-webpic-qc.xhscdn.com/a.jpg"), null);
  assert.equal(normalizeProductImageUrl("https://sns-webpic-qc.xhscdn.com/a.jpg?xsec_token=private"), null);
});

test("stored image lists are deduplicated, capped at seven and parsed defensively", () => {
  const urls = Array.from({ length: 9 }, (_, index) =>
    "https://sns-webpic-qc.xhscdn.com/product/" + index + ".jpg"
  );
  const result = normalizeProductImageUrls([urls[0], urls[0], ...urls.slice(1), "https://example.com/no.jpg"]);
  assert.equal(result.length, 7);
  assert.deepEqual(result, urls.slice(0, 7));
  assert.deepEqual(normalizeProductImageUrls("not-an-array"), []);
});

test("large gallery images are selected while small thumbnails are ignored", () => {
  const candidates: ProductImageCandidate[] = [
    {
      urls: ["https://sns-webpic-qc.xhscdn.com/thumb.jpg"],
      naturalWidth: 800, naturalHeight: 800, renderedWidth: 64, renderedHeight: 64
    },
    {
      urls: ["https://sns-webpic-qc.xhscdn.com/main.jpg"],
      naturalWidth: 800, naturalHeight: 1000, renderedWidth: 320, renderedHeight: 400
    },
    {
      urls: ["https://sns-webpic-qc.xhscdn.com/hidden-slide.jpg"],
      naturalWidth: 500, naturalHeight: 600, renderedWidth: 0, renderedHeight: 0
    }
  ];
  assert.deepEqual(
    selectProductImageUrls(candidates, "https://www.xiaohongshu.com/goods-detail/item"),
    [
      "https://sns-webpic-qc.xhscdn.com/main.jpg",
      "https://sns-webpic-qc.xhscdn.com/hidden-slide.jpg"
    ]
  );
});

test("legacy products gain an empty image list through an idempotent additive migration", () => {
  const d = new Database(":memory:");
  try {
    d.exec("CREATE TABLE products (id TEXT PRIMARY KEY, title TEXT); INSERT INTO products (id,title) VALUES ('legacy','Old product')");
    migrateProductImageColumns(d);
    migrateProductImageColumns(d);
    const columns = (d.pragma("table_info(products)") as Array<{ name: string }>).map(row => row.name);
    assert.ok(columns.includes("image_urls_json"));
    const row = d.prepare("SELECT title,image_urls_json FROM products WHERE id='legacy'").get() as {
      title: string; image_urls_json: string
    };
    assert.equal(row.title, "Old product");
    assert.equal(row.image_urls_json, "[]");
  } finally {
    d.close();
  }
});
