import type Database from "better-sqlite3";

/** Add the product image list without rewriting product or sales-history rows. */
export function migrateProductImageColumns(d: Database.Database): void {
  d.transaction(() => {
    const existing = new Set(
      (d.pragma("table_info(products)") as Array<{ name: string }>).map(row => row.name)
    );
    if (!existing.has("image_urls_json")) {
      d.exec("ALTER TABLE products ADD COLUMN image_urls_json TEXT NOT NULL DEFAULT '[]'");
    }
  }).immediate();
}
