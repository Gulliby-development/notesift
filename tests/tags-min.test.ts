import { describe, expect, test } from "bun:test";
import { parseArgs } from "../src/args";
import { run } from "../src/cli";
import { formatIndex } from "../src/index-file";
import { parseNote } from "../src/note";
import { indexPath } from "../src/scan";
import { renderTags } from "../src/tags";
import type { Io, Note } from "../src/types";

const encoder = new TextEncoder();

function note(id: string, tags: string[]): Note {
  return parseNote(id, encoder.encode(`---\ntags: [${tags.join(", ")}]\n---\nBody of ${id}.`));
}

function sampleNotes(): Note[] {
  return [
    note("a", ["plan", "work/active", "inbox"]),
    note("b", ["plan", "work/active"]),
    note("c", ["plan"]),
    note("d", []),
  ];
}

function runTags(args: string[]): { code: number; out: string; err: string } {
  const files = new Map([[indexPath("notes"), encoder.encode(formatIndex(sampleNotes()))]]);
  let out = "";
  let err = "";
  const io: Io = {
    files: () => [],
    read(path) {
      const bytes = files.get(path);
      if (bytes === undefined) throw new Error("file unavailable");
      return bytes;
    },
    write() {},
    readStdin: () => new Uint8Array(),
    out(text) {
      out += text;
    },
    err(text) {
      err += text;
    },
  };
  const code = run(["tags", "--dir=notes", ...args], io);
  return { code, out, err };
}

describe("tags --min", () => {
  test("keeps only the tags used by at least N notes and counts only those", () => {
    const notes = sampleNotes();

    expect(renderTags(notes, null, 1)).toBe("plan  3\nwork/active  2\ninbox  1\n3 tags\n");
    expect(renderTags(notes, null, 2)).toBe("plan  3\nwork/active  2\n2 tags\n");
    expect(renderTags(notes, null, 3)).toBe("plan  3\n1 tag\n");
    expect(renderTags(notes, null, 4)).toBe("0 tags\n");
    expect(renderTags(notes, null)).toBe(renderTags(notes, null, 1));
  });

  test("does not change the listing of the notes of one tag", () => {
    expect(renderTags(sampleNotes(), "work", 1)).toBe("a  a\nb  b\n2 notes\n");
  });

  test("is parsed as a number from 1 to 999 and only for tags", () => {
    expect(parseArgs(["tags", "--min", "2"]).min).toBe(2);
    expect(parseArgs(["tags", "--min=999"]).min).toBe(999);
    expect(parseArgs(["tags", "--min", "1", "--min", "3"]).min).toBe(3);
    expect(parseArgs(["tags"]).min).toBeNull();
    expect(() => parseArgs(["tags", "--min", "0"])).toThrow('invalid --min "0"');
    expect(() => parseArgs(["tags", "--min", "1000"])).toThrow('invalid --min "1000"');
    expect(() => parseArgs(["tags", "--min", "x"])).toThrow('invalid --min "x"');
    expect(() => parseArgs(["tags", "--min"])).toThrow("--min needs a value");
    expect(() => parseArgs(["stats", "--min", "2"])).toThrow('unknown option "--min"');
    expect(() => parseArgs(["search", "--min=2", "q"])).toThrow('unknown option "--min=2"');
  });

  test("cannot be combined with a TAG operand", () => {
    expect(() => parseArgs(["tags", "--min", "2", "work"])).toThrow("--min works only without TAG");
    expect(() => parseArgs(["tags", "--min", "0", "work"])).toThrow('invalid --min "0"');
  });

  test("runs through the command line", () => {
    expect(runTags(["--min", "2"])).toEqual({
      code: 0,
      out: "plan  3\nwork/active  2\n2 tags\n",
      err: "",
    });
    expect(runTags(["--min=9"])).toEqual({ code: 0, out: "0 tags\n", err: "" });
    expect(runTags(["--min", "2", "work"])).toEqual({
      code: 2,
      out: "",
      err: "notesift: --min works only without TAG\n",
    });
  });
});
