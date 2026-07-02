import type { ComplianceKeyword, ComplianceNote } from "@/lib/types";

export interface ComplianceInput {
  title: string | null;
  description: string | null;
  category: string | null;
  ipName: string | null;
  characterName: string | null;
}

export interface ComplianceResult {
  ipCaution: boolean;
  bootlegSuspect: boolean;
  restrictedItem: boolean;
  notes: ComplianceNote[];
}

/**
 * キーワード辞書スキャン。警告のみで出品はブロックしない。
 * ※偽物出品は Shopify AUP 違反＆決済停止リスク → UI側で注記表示
 */
export function checkCompliance(
  input: ComplianceInput,
  keywords: ComplianceKeyword[]
): ComplianceResult {
  const fields: [string, string | null][] = [
    ["title", input.title],
    ["description", input.description],
    ["category", input.category],
    ["ip_name", input.ipName],
    ["character_name", input.characterName],
  ];

  const notes: ComplianceNote[] = [];
  const seen = new Set<string>();

  for (const [fieldName, value] of fields) {
    if (!value) continue;
    const haystack = value.toLowerCase();
    for (const kw of keywords) {
      const needle = kw.keyword.toLowerCase();
      if (!needle || !haystack.includes(needle)) continue;
      const dedupeKey = `${kw.flag_type}:${kw.keyword}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      notes.push({
        flag_type: kw.flag_type,
        keyword: kw.keyword,
        field: fieldName,
        note: kw.note ?? undefined,
      });
    }
  }

  return {
    ipCaution: notes.some((n) => n.flag_type === "ip_caution"),
    bootlegSuspect: notes.some((n) => n.flag_type === "bootleg_suspect"),
    restrictedItem: notes.some((n) => n.flag_type === "restricted_item"),
    notes,
  };
}
