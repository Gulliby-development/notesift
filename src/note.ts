import { asciiLower, decodeLossy, fnv1a } from "./text";
import { words } from "./tokens";
import type { Link, Note } from "./types";

interface BodyLine {
  number: number;
  text: string;
}

interface ProcessedLine extends BodyLine {
  inlineText: string;
}

function trimSpacesAndTabs(value: string): string {
  return value.replace(/^[ \t]+|[ \t]+$/g, "");
}

function splitLines(text: string): string[] {
  const lines = text.split("\n");
  return lines.map((line, index) => {
    if (index < lines.length - 1 && line.endsWith("\r")) return line.slice(0, -1);
    return line;
  });
}

function parseList(value: string): string[] {
  const contents = value.startsWith("[") && value.endsWith("]") ? value.slice(1, -1) : value;
  return contents
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function normalizeTag(value: string): string | null {
  let tag = asciiLower(value.trim());
  if (tag.startsWith("#")) tag = tag.slice(1);
  tag = tag.replace(/\/+$/, "");
  if (!/^[a-z0-9_-]+(?:\/[a-z0-9_-]+)*$/.test(tag) || !/[a-z]/.test(tag)) return null;
  return tag;
}

function removeInlineCode(line: string): string {
  let result = "";
  let cursor = 0;

  while (cursor < line.length) {
    const opening = line.indexOf("`", cursor);
    if (opening === -1) {
      result += line.slice(cursor);
      break;
    }

    const closing = line.indexOf("`", opening + 1);
    if (closing === -1) {
      result += line.slice(cursor);
      break;
    }

    result += line.slice(cursor, opening);
    result += " ";
    cursor = closing + 1;
  }

  return result;
}

function parseFrontMatter(lines: string[]): {
  bodyStart: number;
  values: Map<string, string>;
} {
  const values = new Map<string, string>();
  if (lines[0] !== "---") return { bodyStart: 0, values };

  const closing = lines.findIndex((line, index) => index > 0 && line === "---");
  if (closing === -1) return { bodyStart: 0, values };

  for (const line of lines.slice(1, closing)) {
    const colon = line.indexOf(":");
    if (colon === -1) continue;

    const key = asciiLower(line.slice(0, colon).trim());
    if (key === "title" || key === "tags" || key === "aliases") {
      values.set(key, trimSpacesAndTabs(line.slice(colon + 1)));
    }
  }

  return { bodyStart: closing + 1, values };
}

function fenceOpening(line: string): { character: "`" | "~"; length: number } | null {
  const match = /^ {0,3}(`{3,}|~{3,})/.exec(line);
  if (!match) return null;
  return { character: match[1][0] as "`" | "~", length: match[1].length };
}

function closesFence(line: string, fence: { character: "`" | "~"; length: number }): boolean {
  const match = /^ {0,3}(`+|~+)[ \t]*$/.exec(line);
  return match !== null && match[1][0] === fence.character && match[1].length >= fence.length;
}

function visibleBodyLines(lines: string[], bodyStart: number): ProcessedLine[] {
  const visible: ProcessedLine[] = [];
  let fence: { character: "`" | "~"; length: number } | null = null;

  for (let index = bodyStart; index < lines.length; index += 1) {
    const line = lines[index];
    if (fence !== null) {
      if (closesFence(line, fence)) fence = null;
      continue;
    }

    const opening = fenceOpening(line);
    if (opening !== null) {
      fence = opening;
      continue;
    }

    visible.push({ number: index + 1, text: line, inlineText: removeInlineCode(line) });
  }

  return visible;
}

function substituteLinks(
  line: string,
  lineNumber: number,
  links: Link[],
): {
  bodyText: string;
  tagText: string;
} {
  let bodyText = "";
  let tagText = "";
  let cursor = 0;

  for (const match of line.matchAll(/\[\[([^[\]]*)\]\]/g)) {
    const start = match.index;
    const end = start + match[0].length;
    const content = match[1];
    const separator = content.indexOf("|");
    const reference = separator === -1 ? content : content.slice(0, separator);
    const fragment = reference.indexOf("#");
    const target = trimSpacesAndTabs(fragment === -1 ? reference : reference.slice(0, fragment));

    bodyText += line.slice(cursor, start);
    tagText += line.slice(cursor, start);

    if (target.length === 0) {
      bodyText += " ";
    } else {
      links.push({ line: lineNumber, target });
      const label = separator === -1 ? target : trimSpacesAndTabs(content.slice(separator + 1));
      bodyText += label;
    }
    tagText += " ";
    cursor = end;
  }

  bodyText += line.slice(cursor);
  tagText += line.slice(cursor);
  return { bodyText, tagText };
}

function collectInlineTags(line: string, tags: Set<string>): void {
  for (const match of line.matchAll(/(?:^|[ \t])#([A-Za-z0-9_/-]+)/g)) {
    const tag = normalizeTag(match[1]);
    if (tag !== null) tags.add(tag);
  }
}

function headingTitle(lines: ProcessedLine[]): string | null {
  for (const line of lines) {
    const match = /^ {0,3}#[ \t](.*)$/.exec(line.text);
    if (!match) continue;
    const title = match[1].replace(/[ \t]+$/, "");
    if (title.length > 0) return title;
  }
  return null;
}

function increment(terms: Map<string, number>, tokens: string[], weight: number): void {
  for (const token of tokens) {
    terms.set(token, (terms.get(token) ?? 0) + weight);
  }
}

export function parseNote(id: string, bytes: Uint8Array): Note {
  const text = decodeLossy(bytes);
  const lines = splitLines(text);
  const frontMatter = parseFrontMatter(lines);
  const bodyLines = visibleBodyLines(lines, frontMatter.bodyStart);
  const links: Link[] = [];
  const tags = new Set<string>();

  for (const value of parseList(frontMatter.values.get("tags") ?? "")) {
    const tag = normalizeTag(value);
    if (tag !== null) tags.add(tag);
  }

  const aliases: string[] = [];
  const seenAliases = new Set<string>();
  for (const alias of parseList(frontMatter.values.get("aliases") ?? "")) {
    if (seenAliases.has(alias)) continue;
    seenAliases.add(alias);
    aliases.push(alias);
  }

  for (const line of bodyLines) {
    const { bodyText, tagText } = substituteLinks(line.inlineText, line.number, links);
    collectInlineTags(tagText, tags);
    line.inlineText = bodyText;
  }

  const lastSegment = id.split("/").at(-1) ?? "";
  const titleValue = frontMatter.values.get("title") ?? "";
  const title = titleValue.length > 0 ? titleValue : (headingTitle(bodyLines) ?? lastSegment);
  const titleTokens = words(title);
  const termCounts = new Map<string, number>();
  increment(termCounts, titleTokens, 3);

  let bodyWordCount = 0;
  for (const line of bodyLines) {
    const lineTokens = words(line.inlineText);
    bodyWordCount += lineTokens.length;
    increment(termCounts, lineTokens, 1);
  }

  return {
    id,
    hash: fnv1a(bytes),
    words: titleTokens.length + bodyWordCount,
    title,
    tags: [...tags].sort(),
    aliases,
    links,
    terms: [...termCounts.entries()].sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0,
    ),
  };
}
