import { describe, expect, test } from "bun:test";
import { normalizeTag, parseNote } from "../src/note";
import type { Note } from "../src/types";

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

describe("note declaration and empty input", () => {
  test("matches the parser and tag-normalizer signatures", () => {
    const parseNoteContract: (id: string, input: Uint8Array) => Note = parseNote;
    const normalizeTagContract: (value: string) => string | null = normalizeTag;
    expect(parseNoteContract("folder/empty", new Uint8Array())).toEqual({
      id: "folder/empty",
      hash: "811c9dc5",
      words: 1,
      title: "empty",
      tags: [],
      aliases: [],
      links: [],
      terms: [["empty", 3]],
    });
    expect(normalizeTagContract("Plan")).toBe("plan");
  });
});

describe("front matter", () => {
  test("uses the first closing delimiter, last recognized values, and input-order aliases", () => {
    const note = parseNote(
      "matter",
      bytes(
        "---\n TITLE :  ignored title \nTaGs: [old]\nALIASES: [Case, case, Case, , Alias]\n" +
          "unknown: value\ncolonless\ntitle: final: title  \t\ntags:  #WIP, Ideas,, \t\n" +
          "---\ntitle: body-value\n---\n# Body heading\n",
      ),
    );
    expect(note.title).toBe("final: title");
    expect(note.tags).toEqual(["ideas", "wip"]);
    expect(note.aliases).toEqual(["Case", "case", "Alias"]);
    expect(note.links).toEqual([]);
    expect(note.words).toBe(7);
    expect(note.terms).toEqual([
      ["body", 2],
      ["final", 3],
      ["heading", 1],
      ["title", 4],
      ["value", 1],
    ]);
  });

  test("treats an unterminated front-matter opener as ordinary body text", () => {
    const note = parseNote("folder/fallback", bytes("---\ntitle: ignored\n# Body title\n"));
    expect(note.title).toBe("Body title");
    expect(note.tags).toEqual([]);
    expect(note.aliases).toEqual([]);
    expect(note.words).toBe(6);
    expect(note.terms).toEqual([
      ["body", 4],
      ["ignored", 1],
      ["title", 5],
    ]);
  });

  test("accepts unbracketed lists, trims entries, and drops empty list items", () => {
    const note = parseNote(
      "lists",
      bytes("---\ntags: work, , PLAN\naliases: first, ,Second, first\n---\n"),
    );
    expect(note.tags).toEqual(["plan", "work"]);
    expect(note.aliases).toEqual(["first", "Second"]);
  });
});

describe("titles and code visibility", () => {
  test("prefers a nonempty front-matter title while retaining heading words in the body", () => {
    const note = parseNote("title", bytes("---\ntitle: Chosen title\n---\n# Body heading\n"));
    expect(note.title).toBe("Chosen title");
    expect(note.words).toBe(4);
    expect(note.terms).toEqual([
      ["body", 1],
      ["chosen", 3],
      ["heading", 1],
      ["title", 3],
    ]);
  });

  test("finds the first eligible unfenced H1 and trims only its trailing spaces and tabs", () => {
    const note = parseNote(
      "headings",
      bytes(
        "## Not a title\n    # Four-space heading\n   ```\n# Fenced heading\n   ```\n" +
          "   #\tChosen title \t\n",
      ),
    );
    expect(note.title).toBe("Chosen title");
    expect(note.words).toBe(9);
    expect(note.terms).toEqual([
      ["chosen", 4],
      ["four", 1],
      ["heading", 1],
      ["not", 1],
      ["space", 1],
      ["title", 5],
    ]);
  });

  test("recognizes fences with zero through three spaces, rejects four, and requires a valid closer", () => {
    const note = parseNote(
      "fences",
      bytes(
        "```\n[[hidden-zero]] #hidden\n```\n" +
          " ```\n[[hidden-one]] #hidden\n ```\n" +
          "  ~~~\n[[hidden-two]] #hidden\n  ~~~\n" +
          "   ```\n[[hidden-three]] #hidden\n   ```\n" +
          "    ```\n[[visible-four]] #shown\n" +
          "   ```\n[[hidden-after-short-close]]\n" +
          "  ~~~\n[[hidden-after-wrong-close]]\n  ``` trailing text\n" +
          "   ``` \t\n",
      ),
    );
    expect(note.links).toEqual([{ line: 14, target: "visible-four" }]);
    expect(note.tags).toEqual(["shown"]);
    expect(note.title).toBe("fences");
  });

  test("ignores an unclosed fence through end of file", () => {
    const note = parseNote("unclosed", bytes("# Visible\n~~~\n[[hidden]] #hidden\n"));
    expect(note.title).toBe("Visible");
    expect(note.links).toEqual([]);
    expect(note.tags).toEqual([]);
    expect(note.words).toBe(2);
  });

  test("removes paired inline-code spans while leaving an unmatched delimiter as text", () => {
    const note = parseNote(
      "inline",
      bytes(
        "Words `hidden [[not-a-link]] #hidden` kept `multi word` tail `unfinished #open [[visible]]",
      ),
    );
    expect(note.links).toEqual([{ line: 1, target: "visible" }]);
    expect(note.tags).toEqual(["open"]);
    expect(note.words).toBe(7);
    expect(note.terms).toEqual([
      ["inline", 3],
      ["kept", 1],
      ["open", 1],
      ["tail", 1],
      ["unfinished", 1],
      ["visible", 1],
      ["words", 1],
    ]);
  });
});

describe("links and whole-file line numbers", () => {
  test("keeps each valid occurrence, strips fragments, uses labels, and ignores empty or bracketed candidates", () => {
    const note = parseNote(
      "links",
      bytes(
        "---\ntitle: Link title\n---\n" +
          "See [[ path#section| Label ]] and [[path#section]] and [[ #only| ignored ]] " +
          "and [[#section]] and [[a[b]] and [[b]x]] and [[x]] [[x]] and [[target| #hidden]].\n" +
          "   ```\n[[fenced]]\n   ```\n",
      ),
    );
    expect(note.links).toEqual([
      { line: 4, target: "path" },
      { line: 4, target: "path" },
      { line: 4, target: "x" },
      { line: 4, target: "x" },
      { line: 4, target: "target" },
    ]);
    expect(note.tags).toEqual([]);
    expect(note.terms).toEqual([
      ["b", 2],
      ["hidden", 1],
      ["label", 1],
      ["link", 3],
      ["path", 1],
      ["see", 1],
      ["title", 3],
      ["x", 3],
    ]);
  });

  test("preserves CRLF numbering and removes CR only before LF", () => {
    const note = parseNote(
      "line-breaks",
      bytes("---\r\ntitle: X\r\n---\r\nfirst\r\n[[second]]\r\n"),
    );
    expect(note.title).toBe("X");
    expect(note.links).toEqual([{ line: 5, target: "second" }]);
    expect(note.words).toBe(3);
    expect(note.terms).toEqual([
      ["first", 1],
      ["second", 1],
      ["x", 3],
    ]);
  });
});

describe("tag normalization and extraction", () => {
  test("normalizes valid front-matter and inline tags and sorts unique results", () => {
    const note = parseNote(
      "tags",
      bytes(
        "---\ntags: [#Work/Active/, PLAN, plan, 2024, a//b, /a, é, ##a]\n---\n" +
          "#inline #2024 x#not-a-tag\n#Work/Active/ #_bad\n",
      ),
    );
    expect(note.tags).toEqual(["_bad", "inline", "plan", "work/active"]);
    expect(normalizeTag("#Work/Active/")).toBe("work/active");
    expect(normalizeTag(" Plan ")).toBe("plan");
    expect(normalizeTag("a_1-b")).toBe("a_1-b");
  });

  test("rejects tags without a letter, empty segments, invalid characters, or a second leading hash", () => {
    expect(normalizeTag("2024")).toBeNull();
    expect(normalizeTag("a//b")).toBeNull();
    expect(normalizeTag("/a")).toBeNull();
    expect(normalizeTag("é")).toBeNull();
    expect(normalizeTag("##a")).toBeNull();
    expect(normalizeTag("")).toBeNull();
    expect(normalizeTag("a/")).toBe("a");
    expect(normalizeTag("a///")).toBe("a");
  });

  test("requires inline tags to start at line start or after horizontal whitespace", () => {
    const note = parseNote(
      "inline-tags",
      bytes("x#hidden #visible\t#also-visible\nword#hidden-again"),
    );
    expect(note.tags).toEqual(["also-visible", "visible"]);
  });
});

describe("word counts, weights, and byte hashes", () => {
  test("counts title tokens once as words and three times as term weight", () => {
    const note = parseNote("x", bytes("# Alpha\nAlpha beta"));
    expect(note.title).toBe("Alpha");
    expect(note.words).toBe(4);
    expect(note.terms).toEqual([
      ["alpha", 5],
      ["beta", 1],
    ]);
  });

  test("strips one BOM for parsing but hashes the original bytes", () => {
    const note = parseNote("bom", new Uint8Array([0xef, 0xbb, 0xbf, 0x23, 0x20, 0x41]));
    expect(note.hash).toBe("c178618e");
    expect(note.title).toBe("A");
    expect(note.words).toBe(0);
    expect(note.terms).toEqual([]);
  });

  test("lossily separates malformed UTF-8 while hashing the original bytes", () => {
    const input = new Uint8Array([
      0x61, 0x6c, 0x70, 0x68, 0x61, 0x20, 0xff, 0x20, 0x62, 0x65, 0x74, 0x61,
    ]);
    const note = parseNote("raw", input);
    expect(note.hash).toBe("edb656bc");
    expect(note.title).toBe("raw");
    expect(note.words).toBe(3);
    expect(note.terms).toEqual([
      ["alpha", 1],
      ["beta", 1],
      ["raw", 3],
    ]);
  });

  test("counts repeated body tokens on a single line", () => {
    const note = parseNote(
      "x",
      bytes("alpha alpha alpha alpha alpha alpha alpha alpha alpha alpha"),
    );
    expect(note.words).toBe(11);
    expect(note.terms).toEqual([
      ["alpha", 10],
      ["x", 3],
    ]);
  });
});

describe("the five supplied note fixtures", () => {
  const ideas = bytes(
    "---\ntitle: Ideas\ntags: [inbox]\naliases: [brainstorm]\n---\n" +
      "Rough ideas for the [[projects/alpha|alpha launch]] and a #garden plan.\n" +
      "See [[todo]] and [[missing-note]].",
  );
  const alpha = bytes(
    "---\ntitle: Alpha project\ntags: [work/active, Plan]\n---\n# Alpha\n" +
      "Plan the launch with [[projects/beta]]. The launch needs a plan and a plan review.\n" +
      "```text\n[[not-a-link]] #nottag\n```",
  );
  const beta = bytes("# Beta project\nWaiting for the [[alpha]] review. Tags: #work/active #2024");
  const dailyTodo = bytes(
    "---\naliases: [brainstorm]\n---\nWater the plants. Read about the launch plan.",
  );
  const workTodo = bytes("# Todo\nCall the vendor about the garden.");

  test("matches all supplied titles, sorted metadata, links, counts, hashes, and terms", () => {
    expect(parseNote("ideas", ideas)).toEqual({
      id: "ideas",
      hash: "95605a00",
      words: 11,
      title: "Ideas",
      tags: ["garden", "inbox"],
      aliases: ["brainstorm"],
      links: [
        { line: 6, target: "projects/alpha" },
        { line: 7, target: "todo" },
        { line: 7, target: "missing-note" },
      ],
      terms: [
        ["alpha", 1],
        ["garden", 1],
        ["ideas", 4],
        ["launch", 1],
        ["missing", 1],
        ["note", 1],
        ["plan", 1],
        ["rough", 1],
        ["see", 1],
        ["todo", 1],
      ],
    });
    expect(parseNote("projects/alpha", alpha)).toEqual({
      id: "projects/alpha",
      hash: "9608abbc",
      words: 12,
      title: "Alpha project",
      tags: ["plan", "work/active"],
      aliases: [],
      links: [{ line: 6, target: "projects/beta" }],
      terms: [
        ["alpha", 4],
        ["beta", 1],
        ["launch", 2],
        ["needs", 1],
        ["plan", 3],
        ["project", 3],
        ["projects", 1],
        ["review", 1],
      ],
    });
    expect(parseNote("projects/beta", beta)).toEqual({
      id: "projects/beta",
      hash: "666e4b53",
      words: 11,
      title: "Beta project",
      tags: ["work/active"],
      aliases: [],
      links: [{ line: 2, target: "alpha" }],
      terms: [
        ["2024", 1],
        ["active", 1],
        ["alpha", 1],
        ["beta", 4],
        ["project", 4],
        ["review", 1],
        ["tags", 1],
        ["waiting", 1],
        ["work", 1],
      ],
    });
    expect(parseNote("daily/todo", dailyTodo)).toEqual({
      id: "daily/todo",
      hash: "9640e742",
      words: 7,
      title: "todo",
      tags: [],
      aliases: ["brainstorm"],
      links: [],
      terms: [
        ["about", 1],
        ["launch", 1],
        ["plan", 1],
        ["plants", 1],
        ["read", 1],
        ["todo", 3],
        ["water", 1],
      ],
    });
    expect(parseNote("work/todo", workTodo)).toEqual({
      id: "work/todo",
      hash: "c4720a34",
      words: 6,
      title: "Todo",
      tags: [],
      aliases: [],
      links: [],
      terms: [
        ["about", 1],
        ["call", 1],
        ["garden", 1],
        ["todo", 4],
        ["vendor", 1],
      ],
    });
    expect(11 + 12 + 11 + 7 + 6).toBe(47);
  });
});
