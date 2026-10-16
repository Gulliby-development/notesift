import { compareCodePoints } from "./index-file";
import { normalizeTag } from "./note";
import { plural } from "./text";
import { CliError, type Note } from "./types";

export function renderTags(notes: Note[], tag: string | null): string {
  if (tag === null) {
    const counts = new Map<string, number>();

    for (const note of notes) {
      for (const exactTag of new Set(note.tags)) {
        counts.set(exactTag, (counts.get(exactTag) ?? 0) + 1);
      }
    }

    const inventory = [...counts.entries()].sort(
      ([leftTag, leftCount], [rightTag, rightCount]) =>
        rightCount - leftCount || compareCodePoints(leftTag, rightTag),
    );
    const lines = inventory.map(([exactTag, count]) => `${exactTag}  ${count}`);
    lines.push(plural(inventory.length, "tag", "tags"));
    return `${lines.join("\n")}\n`;
  }

  const normalizedTag = normalizeTag(tag);
  if (normalizedTag === null) throw new CliError(`invalid tag "${tag}"`);

  const selected = notes
    .filter((note) =>
      note.tags.some(
        (noteTag) => noteTag === normalizedTag || noteTag.startsWith(`${normalizedTag}/`),
      ),
    )
    .sort((left, right) => compareCodePoints(left.id, right.id));
  const lines = selected.map((note) => `${note.id}  ${note.title}`);
  lines.push(plural(selected.length, "note", "notes"));
  return `${lines.join("\n")}\n`;
}
