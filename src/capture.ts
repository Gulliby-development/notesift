import { normalizeTag } from "./note";
import { cleanDir } from "./scan";
import { decodeStrict } from "./text";
import { CliError, type Io } from "./types";

function isValidName(name: string): boolean {
  return name.split("/").every((segment) => /^[a-z0-9][a-z0-9_-]{0,63}$/.test(segment));
}

function defaultTitle(name: string): string {
  const lastSegment = name.split("/").at(-1) ?? "";
  const spaced = lastSegment.replace(/[-_]/g, " ");
  return spaced.replace(/[a-z]/, (letter) => letter.toUpperCase());
}

export function capture(
  io: Io,
  dir: string,
  name: string,
  title: string | null,
  tags: string[],
): string {
  if (!isValidName(name)) {
    throw new CliError(`invalid NAME "${name}"`);
  }

  if (title !== null && (title.trim().length === 0 || /[\r\n]/.test(title))) {
    throw new CliError(`invalid --title "${title}"`);
  }

  const normalizedTags: string[] = [];
  const seenTags = new Set<string>();
  for (const tagInput of tags) {
    const tag = normalizeTag(tagInput);
    if (tag === null) {
      throw new CliError(`invalid --tag "${tagInput}"`);
    }
    if (!seenTags.has(tag)) {
      seenTags.add(tag);
      normalizedTags.push(tag);
    }
  }

  const input = decodeStrict(io.readStdin());
  if (input === null) {
    throw new CliError("stdin: input is not valid UTF-8");
  }

  const normalizedDir = cleanDir(dir);
  let files: string[];
  try {
    files = io.files(normalizedDir);
  } catch {
    throw new CliError(`${normalizedDir}: cannot read the directory`);
  }

  const fileName = `${name}.md`;
  if (files.includes(fileName)) {
    throw new CliError(`${fileName}: already exists`);
  }

  const resolvedTitle = title ?? defaultTitle(name);
  const frontMatter = [
    "---",
    `title: ${resolvedTitle}`,
    ...(normalizedTags.length === 0 ? [] : [`tags: [${normalizedTags.join(", ")}]`]),
    "---",
    "",
  ].join("\n");
  const body = input.replace(/\r\n?/g, "\n").replace(/\n+$/, "");
  const contents = body.length === 0 ? frontMatter : `${frontMatter}\n${body}\n`;

  io.write(`${normalizedDir}/${fileName}`, new TextEncoder().encode(contents));
  return `wrote ${fileName}\n`;
}
