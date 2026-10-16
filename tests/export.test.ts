import { describe, expect, test } from "bun:test";
import { renderExport } from "../src/export";
import { parseNote } from "../src/note";
import type { Note } from "../src/types";

const encoder = new TextEncoder();

function parsedNote(id: string, text: string): Note {
  return parseNote(id, encoder.encode(text));
}

type NoteFields = Pick<Partial<Note>, "words" | "tags" | "aliases" | "links">;

function noteRecord(id: string, title: string, fields: NoteFields = {}): Note {
  return {
    id,
    hash: "00000000",
    words: fields.words ?? 0,
    title,
    tags: fields.tags ?? [],
    aliases: fields.aliases ?? [],
    links: fields.links ?? [],
    terms: [],
  };
}

function fiveExampleNotes(): Note[] {
  return [
    parsedNote(
      "ideas",
      "---\ntitle: Ideas\ntags: [inbox]\naliases: [brainstorm]\n---\n" +
        "Rough ideas for the [[projects/alpha|alpha launch]] and a #garden plan.\n" +
        "See [[todo]] and [[missing-note]].",
    ),
    parsedNote(
      "projects/alpha",
      "---\ntitle: Alpha project\ntags: [work/active, Plan]\n---\n# Alpha\n" +
        "Plan the launch with [[projects/beta]]. The launch needs a plan and a plan review.\n" +
        "```text\n[[not-a-link]] #nottag\n```",
    ),
    parsedNote(
      "projects/beta",
      "# Beta project\nWaiting for the [[alpha]] review. Tags: #work/active #2024",
    ),
    parsedNote(
      "daily/todo",
      "---\naliases: [brainstorm]\n---\nWater the plants. Read about the launch plan.",
    ),
    parsedNote("work/todo", "# Todo\nCall the vendor about the garden."),
  ];
}

describe("export renderers", () => {
  test("renders the supplied two-note JSON example as an exact golden", () => {
    const notes = [
      parsedNote("a", '---\ntitle: Alpha "A"\ntags: [x]\n---\nSee [[b]].'),
      parsedNote("b", "# B"),
    ];

    expect(renderExport(notes, "json")).toBe(String.raw`[
  {
    "id": "a",
    "title": "Alpha \"A\"",
    "tags": [
      "x"
    ],
    "aliases": [],
    "words": 3,
    "links": [
      "b"
    ],
    "backlinks": []
  },
  {
    "id": "b",
    "title": "B",
    "tags": [],
    "aliases": [],
    "words": 2,
    "links": [],
    "backlinks": [
      "a"
    ]
  }
]
`);
  });

  test("preserves JSON properties, aliases, and escaped string values", () => {
    const id = "line\tid\n雪😀";
    const title = 'Quote " slash \\ tab\t return\r newline\n 🐿';
    const note = noteRecord(id, title, {
      tags: ["a", "z/tag"],
      aliases: ["second", "first"],
      words: 7,
    });
    const rendered = renderExport([note], "json");

    expect(rendered).toContain('"id": "line\\tid\\n雪😀"');
    expect(rendered).toContain('"title": "Quote \\" slash \\\\ tab\\t return\\r newline\\n 🐿"');
    expect(JSON.parse(rendered)).toEqual([
      {
        id,
        title,
        tags: ["a", "z/tag"],
        aliases: ["second", "first"],
        words: 7,
        links: [],
        backlinks: [],
      },
    ]);
  });

  test("matches the supplied five-note CSV and DOT goldens", () => {
    const notes = fiveExampleNotes();

    expect(renderExport(notes, "csv")).toBe(`id,title,words,tags,inbound,outbound
daily/todo,todo,7,,0,0
ideas,Ideas,11,garden;inbox,0,1
projects/alpha,Alpha project,12,plan;work/active,2,1
projects/beta,Beta project,11,work/active,1,1
work/todo,Todo,6,,0,0
`);

    expect(renderExport(notes, "dot")).toBe(`digraph notes {
  "daily/todo" [label="todo"];
  "ideas" [label="Ideas"];
  "projects/alpha" [label="Alpha project"];
  "projects/beta" [label="Beta project"];
  "work/todo" [label="Todo"];
  "ideas" -> "projects/alpha";
  "projects/alpha" -> "projects/beta";
  "projects/beta" -> "projects/alpha";
}
`);
  });

  test("escapes only DOT quotes and backslashes in nodes, labels, and edge endpoints", () => {
    const source = noteRecord('a"\\id', 'A "quoted" \\ label', {
      links: [{ line: 1, target: 'b"\\id' }],
    });
    const target = noteRecord('b"\\id', "B");

    expect(renderExport([target, source], "dot")).toBe(String.raw`digraph notes {
  "a\"\\id" [label="A \"quoted\" \\ label"];
  "b\"\\id" [label="B"];
  "a\"\\id" -> "b\"\\id";
}
`);
  });

  test("quotes each CSV trigger, doubles quotes, preserves CR/LF, and leaves plain fields bare", () => {
    const notes = [
      noteRecord("a", "comma, title", { words: 1 }),
      noteRecord("b", 'say "hi"', { words: 2 }),
      noteRecord("c", "return\rtitle", { words: 3 }),
      noteRecord("d", "line one\nline two", { words: 4 }),
      noteRecord("e", "plain", { words: 5 }),
    ];

    expect(renderExport(notes, "csv")).toBe(
      "id,title,words,tags,inbound,outbound\n" +
        'a,"comma, title",1,,0,0\n' +
        'b,"say ""hi""",2,,0,0\n' +
        'c,"return\rtitle",3,,0,0\n' +
        'd,"line one\nline two",4,,0,0\n' +
        "e,plain,5,,0,0\n",
    );
  });

  test("renders literal Markdown punctuation and optional canonical tag suffixes", () => {
    const notes = [
      noteRecord("z", "Plain <text> & punctuation"),
      noteRecord("a", "Title [with] *punctuation*", { tags: ["plan", "work/active"] }),
    ];

    expect(renderExport(notes, "md")).toBe(
      "# Notes\n\n" +
        "- [[a]] Title [with] *punctuation* (tags: plan, work/active)\n" +
        "- [[z]] Plain <text> & punctuation\n",
    );
  });

  test("orders supplementary Unicode ids by code point in every format", () => {
    const bmp = "\uE000";
    const astral = "\u{10000}";
    const notes = [
      noteRecord(astral, "Astral"),
      noteRecord("source", "Source", {
        links: [
          { line: 1, target: astral },
          { line: 2, target: bmp },
        ],
      }),
      noteRecord(bmp, "BMP"),
    ];

    const jsonRecords = JSON.parse(renderExport(notes, "json")) as {
      id: string;
      links: string[];
    }[];
    expect(jsonRecords.map((record) => record.id)).toEqual(["source", bmp, astral]);
    expect(jsonRecords[0].links).toEqual([bmp, astral]);
    expect(renderExport(notes, "dot")).toBe(
      `digraph notes {\n  "source" [label="Source"];\n  "${bmp}" [label="BMP"];\n  "${astral}" [label="Astral"];\n  "source" -> "${bmp}";\n  "source" -> "${astral}";\n}\n`,
    );
    expect(renderExport(notes, "csv")).toBe(
      `id,title,words,tags,inbound,outbound\nsource,Source,0,,0,2\n${bmp},BMP,0,,1,0\n${astral},Astral,0,,1,0\n`,
    );
    expect(renderExport(notes, "md")).toBe(
      `# Notes\n\n- [[source]] Source\n- [[${bmp}]] BMP\n- [[${astral}]] Astral\n`,
    );
  });

  test("uses shared graph resolution, deduplicates edges, and omits self, broken, and ambiguous links", () => {
    const notes = [
      noteRecord("title-owner", "Title Ref"),
      noteRecord("b-dupe", "Duplicate B", { aliases: ["dupe"] }),
      noteRecord("source", "Source", {
        links: [
          { line: 1, target: "exact-target" },
          { line: 2, target: "alias-ref" },
          { line: 3, target: "TiTle ReF" },
          { line: 4, target: "basename" },
          { line: 5, target: "mixed" },
          { line: 6, target: "exact-target" },
          { line: 7, target: "source" },
          { line: 8, target: "missing" },
          { line: 9, target: "dupe" },
        ],
      }),
      noteRecord("dir/basename", "Basename"),
      noteRecord("alias-owner", "Alias Owner", { aliases: ["alias-ref"] }),
      noteRecord("a-dupe", "Duplicate A", { aliases: ["dupe"] }),
      noteRecord("exact-target", "Exact Target"),
      noteRecord("alias-first", "Alias First", { aliases: ["Mixed"] }),
      noteRecord("title-second", "Mixed"),
    ];

    const jsonRecords = JSON.parse(renderExport(notes, "json")) as {
      id: string;
      links: string[];
      backlinks: string[];
    }[];
    expect(jsonRecords.map(({ id, links, backlinks }) => ({ id, links, backlinks }))).toEqual([
      { id: "a-dupe", links: [], backlinks: [] },
      { id: "alias-first", links: [], backlinks: ["source"] },
      { id: "alias-owner", links: [], backlinks: ["source"] },
      { id: "b-dupe", links: [], backlinks: [] },
      { id: "dir/basename", links: [], backlinks: ["source"] },
      { id: "exact-target", links: [], backlinks: ["source"] },
      {
        id: "source",
        links: ["alias-first", "alias-owner", "dir/basename", "exact-target", "title-owner"],
        backlinks: [],
      },
      { id: "title-owner", links: [], backlinks: ["source"] },
      { id: "title-second", links: [], backlinks: [] },
    ]);

    expect(renderExport(notes, "dot")).toBe(`digraph notes {
  "a-dupe" [label="Duplicate A"];
  "alias-first" [label="Alias First"];
  "alias-owner" [label="Alias Owner"];
  "b-dupe" [label="Duplicate B"];
  "dir/basename" [label="Basename"];
  "exact-target" [label="Exact Target"];
  "source" [label="Source"];
  "title-owner" [label="Title Ref"];
  "title-second" [label="Mixed"];
  "source" -> "alias-first";
  "source" -> "alias-owner";
  "source" -> "dir/basename";
  "source" -> "exact-target";
  "source" -> "title-owner";
}
`);

    expect(renderExport(notes, "csv")).toBe(`id,title,words,tags,inbound,outbound
a-dupe,Duplicate A,0,,0,0
alias-first,Alias First,0,,1,0
alias-owner,Alias Owner,0,,1,0
b-dupe,Duplicate B,0,,0,0
dir/basename,Basename,0,,1,0
exact-target,Exact Target,0,,1,0
source,Source,0,,0,5
title-owner,Title Ref,0,,1,0
title-second,Mixed,0,,0,0
`);
  });

  test("returns exact empty output for all formats", () => {
    expect(renderExport([], "json")).toBe("[]\n");
    expect(renderExport([], "dot")).toBe("digraph notes {\n}\n");
    expect(renderExport([], "csv")).toBe("id,title,words,tags,inbound,outbound\n");
    expect(renderExport([], "md")).toBe("# Notes\n\n");
  });

  test("is repeatable and does not mutate notes or nested arrays in any format", () => {
    const notes = fiveExampleNotes();
    const original = JSON.stringify(notes);
    const json = renderExport(notes, "json");
    const dot = renderExport(notes, "dot");
    const csv = renderExport(notes, "csv");
    const markdown = renderExport(notes, "md");

    expect(renderExport(notes, "json")).toBe(json);
    expect(renderExport(notes, "dot")).toBe(dot);
    expect(renderExport(notes, "csv")).toBe(csv);
    expect(renderExport(notes, "md")).toBe(markdown);
    expect(JSON.stringify(notes)).toBe(original);
  });
});
