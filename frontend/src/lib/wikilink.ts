const WIKILINK = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
const CODE_SPAN = /(```[\s\S]*?```|`[^`\n]+`)/g;

/** Private URL scheme used to hand `[[wikilinks]]` through remark to the link renderer. */
export const WIKILINK_SCHEME = "wikilink:";

/** Every `[[target]]` in the text, deduped, in order of first appearance. */
export function extractLinks(text: string): string[] {
  const found = new Set<string>();
  for (const match of (text ?? "").matchAll(WIKILINK)) {
    const target = match[1].trim();
    if (target) found.add(target);
  }
  return [...found];
}

/** Whether `name` appears as a plain-text mention that is *not* already a wikilink. */
export function hasUnlinkedMention(text: string, name: string): boolean {
  const stripped = (text ?? "").replace(WIKILINK, " ");
  return stripped.toLowerCase().includes(name.toLowerCase());
}

/** Wrap the first unlinked plain-text occurrence of `name` in `[[ ]]`. */
export function linkFirstMention(text: string, name: string): string {
  const lower = text.toLowerCase();
  const target = name.toLowerCase();
  let from = 0;
  while (from <= lower.length - target.length) {
    const at = lower.indexOf(target, from);
    if (at === -1) return text;
    const before = text.slice(Math.max(0, at - 2), at);
    const after = text.slice(at + name.length, at + name.length + 2);
    if (before.endsWith("[[") || after.startsWith("]]")) {
      from = at + name.length;
      continue;
    }
    return `${text.slice(0, at)}[[${text.slice(at, at + name.length)}]]${text.slice(at + name.length)}`;
  }
  return text;
}

/**
 * Rewrite `[[target]]` / `[[target|alias]]` into ordinary Markdown links under the
 * `wikilink:` scheme, so remark parses them and the link renderer can intercept
 * them. Code spans and fences are left untouched — a memory that documents the
 * wikilink syntax shouldn't have its own example silently turn into a link.
 */
export function encodeWikilinks(text: string): string {
  return (text ?? "")
    .split(CODE_SPAN)
    .map((segment, i) =>
      i % 2 === 1
        ? segment
        : segment.replace(WIKILINK, (_all, rawTarget: string, alias?: string) => {
            const target = rawTarget.trim();
            const label = (alias ?? target).trim().replace(/[[\]]/g, "");
            return `[${label}](${WIKILINK_SCHEME}${encodeURIComponent(target)})`;
          })
    )
    .join("");
}
