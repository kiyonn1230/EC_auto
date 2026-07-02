/** xlsx由来テキストの掃除と整形 */

/** _x000d_ / _x000D_ などExcelエスケープ由来のゴミを改行に正規化し、制御文字を除去 */
export function cleanText(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  let s = String(raw);
  s = s.replace(/_x000d_/gi, "\n");
  s = s.replace(/_x([0-9a-f]{4})_/gi, (_, hex) => {
    const code = parseInt(hex, 16);
    return code === 0x0d || code === 0x0a ? "\n" : "";
  });
  s = s.replace(/\r\n?/g, "\n");
  // 改行・タブ以外の制御文字を除去
  // eslint-disable-next-line no-control-regex
  s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
  s = s.replace(/\n{3,}/g, "\n\n").trim();
  return s.length > 0 ? s : null;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 説明文プレーンテキスト → Body (HTML)。空行区切りで<p>、行内改行は<br> */
export function descriptionToHtml(text: string | null): string | null {
  if (!text) return null;
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (paragraphs.length === 0) return null;
  return paragraphs
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("\n");
}

/** ¥・円・カンマ等を除去して数値化。数値にならなければ null */
export function parseNumber(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  const s = String(raw)
    .replace(/[¥￥,，\s]/g, "")
    .replace(/円|yen|jpy|g|グラム|cm/gi, "")
    .replace(/[０-９．]/g, (c) =>
      c === "．" ? "." : String.fromCharCode(c.charCodeAt(0) - 0xfee0)
    );
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** セル値から画像URL群を抽出 (カンマ/空白/改行区切り、http(s)のみ) */
export function extractImageUrls(raw: unknown): string[] {
  if (raw === null || raw === undefined) return [];
  return String(raw)
    .split(/[,\n\t ]+/)
    .map((u) => u.trim())
    .filter((u) => /^https?:\/\//i.test(u));
}

/** Title → Shopify Handle。日本語はスラッグ化で消えるため常にSKUを付加して一意化 */
export function generateHandle(title: string, sku: string): string {
  const slug = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  const skuSlug = sku.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return slug ? `${slug}-${skuSlug}` : `item-${skuSlug}`;
}

/** "25x20x18" / "25×20×18cm" 形式の寸法文字列をパース */
export function parseDimensions(
  raw: unknown
): { length: number; width: number; height: number } | null {
  if (raw === null || raw === undefined) return null;
  const m = String(raw).match(
    /([\d.]+)\s*[x×*]\s*([\d.]+)\s*[x×*]\s*([\d.]+)/i
  );
  if (!m) return null;
  const [l, w, h] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (![l, w, h].every((v) => Number.isFinite(v) && v > 0)) return null;
  return { length: l, width: w, height: h };
}
