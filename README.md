# notesift

<p align="center"><img src="docs/logo.svg" width="96" alt="notesift logo"></p>

[![CI](https://github.com/Gulliby-development/notesift/actions/workflows/ci.yml/badge.svg)](https://github.com/Gulliby-development/notesift/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

notesift is an offline command-line tool for people who keep notes as Markdown files: wiki users, Zettelkasten writers and journal keepers. It builds a persistent index so you can search notes, follow wiki links, find link problems, explore related notes, inspect tags and export your collection without a network connection.

## Install

Install the project dependencies with `bun install`. There is no build step; run a command directly with `bun run src/main.ts COMMAND`.

## Usage

```text
usage: notesift index [--dir DIR]
       notesift search [--dir DIR] [--limit N] QUERY...
       notesift links [--dir DIR] NOTE
       notesift backlinks [--dir DIR] NOTE
       notesift check [--dir DIR]
       notesift path [--dir DIR] FROM TO
       notesift related [--dir DIR] [--limit N] NOTE
       notesift tags [--dir DIR] [TAG]
       notesift stats [--dir DIR]
       notesift export [--dir DIR] --format json|dot|csv|md
       notesift capture [--dir DIR] [--title TEXT] [--tag TAG]... NAME
```

The examples below use a folder named `notes`. Put each fixture at its shown path, then run the `index` command on that folder before querying it. The search and check output shown later is for this same folder.

### notes/ideas.md

```markdown
---
title: Ideas
tags: [inbox]
aliases: [brainstorm]
---
Rough ideas for the [[projects/alpha|alpha launch]] and a #garden plan.
See [[todo]] and [[missing-note]].
```

### notes/projects/alpha.md

````markdown
---
title: Alpha project
tags: [work/active, Plan]
---
# Alpha
Plan the launch with [[projects/beta]]. The launch needs a plan and a plan review.
```text
[[not-a-link]] #nottag
```
````

### notes/projects/beta.md

```markdown
# Beta project
Waiting for the [[alpha]] review. Tags: #work/active #2024
```

### notes/daily/todo.md

```markdown
---
aliases: [brainstorm]
---
Water the plants. Read about the launch plan.
```

### notes/work/todo.md

```markdown
# Todo
Call the vendor about the garden.
```

With these fixtures indexed, `notesift search launch plan --dir notes` produces:

```text
5.519  projects/alpha  Alpha project
4.467  daily/todo  todo
3.740  ideas  Ideas
3 results
```

`notesift check --dir notes` produces:

```text
daily/todo: NS003 alias "brainstorm" is also used by ideas
daily/todo: NS004 note has no links in or out
ideas: NS003 alias "brainstorm" is also used by daily/todo
ideas:7: NS001 broken link "missing-note"
ideas:7: NS002 ambiguous link "todo" (daily/todo or work/todo)
work/todo: NS004 note has no links in or out
6 problems in 3 notes
```

## Notes

A note is a file whose extension is exactly `.md`, located anywhere below the selected folder except inside a hidden file or folder (a name beginning with `.`). Its ID is the relative path with `/` separators and without the extension. Notes are processed in code-point order.

File bytes are decoded as UTF-8: one leading byte-order mark is removed and invalid sequences become replacement characters. Lines split at LF, with a CR immediately before LF removed. Front matter is recognized only when the first line is exactly `---` and a later line is exactly `---`; the first closing delimiter ends it. Between those delimiters, lines with a colon are split at the first colon, keys are trimmed and ASCII-lowercased, values are trimmed of spaces and tabs, and the last repeated key wins. Only `title`, `tags` and `aliases` are used. A tags or aliases value may have one surrounding pair of square brackets; its comma-separated entries are trimmed and empty entries are ignored.

In the body, fenced code is ignored. A fence opens when a line has up to three leading spaces followed by at least three backticks or tildes. It closes on a line with up to three leading spaces containing only the same fence character, repeated at least as many times, plus optional spaces or tabs. An unclosed fence continues to the end. Outside fences, each backtick is replaced by one space; the text between successive backticks on the same line remains.

The title is the nonempty front-matter title, otherwise the first level-one heading with up to three leading spaces and trailing spaces or tabs removed, otherwise the final ID segment. Wiki links use `[[target]]` or `[[target|label]]`; link text inside code is ignored. For resolution, the target is the text before the first `|`, with any `#` fragment and following text removed, then trimmed. An empty target is ignored. A link resolves first by exact ID, then by alias, title or final ID segment (the latter three comparisons are ASCII case-insensitive); unresolved targets are broken and multiple matches are ambiguous. Self-links do not form graph edges.

Tags come from front matter and inline text. For inline tags, replace each link with a space before scanning; a `#` at the start of a line or after a space or tab introduces the longest run of ASCII letters, digits, underscores, hyphens or slashes. Trailing slashes are removed. A front-matter tag is trimmed and has one leading `#` removed before ASCII lowercasing. Tags in either form must match `[a-z0-9_-]+(/[a-z0-9_-]+)*` and contain a letter; invalid tags are ignored. Each note's tags are unique and sorted; aliases retain their order, are unique and keep their case.

Words are runs of ASCII letters or digits in the title and body. For a wiki link, the label after `|` is counted when present; otherwise its target is counted. Words are lowercased and these stop words are omitted: `a an and are as at be by for from in is it of on or that the to with`. The word count includes the title and body. Search terms count each body occurrence once and each title occurrence three times. A note's content hash is FNV-1a over the original file bytes, formatted as eight lowercase hexadecimal digits.

## Index

The index is stored at `DIR/.notesift/index.txt` (with `DIR` defaulting to `.`, normalized to forward slashes without a trailing slash). Run `index` to scan Markdown files and create or refresh the persistent index. Refreshing reuses unchanged notes, updates added or changed notes and removes entries for deleted notes; the index is written only if it is missing, damaged or the collection changed. All commands except `index` and `capture` read from the index rather than rescanning the notes folder, so index after changing notes before using those commands. `capture` writes a note but does not update the index.

## Commands

Every command accepts `--dir DIR`; it defaults to the current directory. Option values may follow the option or be supplied with `=`. The last value wins for scalar options.

- `index [--dir DIR]` creates or refreshes the index and reports the new, changed, removed and unchanged note counts.
- `search [--dir DIR] [--limit N] QUERY...` ranks notes matching every query word and filter. The default limit is 10; `N` must be from 1 to 999. Use `tag:T` to include notes tagged `T` or a descendant tag, `title:TEXT` to require title words, `in:FOLDER` to keep only notes whose ID starts with `FOLDER/` (repeat it to allow several folders), and `not:TEXT` to exclude notes containing those words.
- `links [--dir DIR] NOTE` lists outgoing links from a resolved note.
- `backlinks [--dir DIR] NOTE` lists notes linking to a resolved note.
- `check [--dir DIR]` reports broken and ambiguous links, duplicate aliases and notes with no incoming or outgoing links.
- `path [--dir DIR] FROM TO` finds a shortest link path between two resolved notes.
- `related [--dir DIR] [--limit N] NOTE` ranks other notes by term-vector cosine similarity. The default limit is 5; `N` must be from 1 to 999.
- `tags [--dir DIR] [TAG]` lists tags and their note counts, or lists notes with the given tag and its descendants.
- `stats [--dir DIR]` summarizes note, word, tag, link, diagnostic, orphan and connected-component counts.
- `export [--dir DIR] --format F` exports notes as `json`, `dot`, `csv` or `md`; `--format` is required.
- `capture [--dir DIR] [--title TEXT] [--tag TAG]... NAME` creates a Markdown note from standard input. Tags may be repeated; when no title is supplied, one is derived from the final name segment. The index is left unchanged.

A note argument can be an ID, alias, title or final ID segment. If a name is ambiguous, choose a more specific ID.

## Checks

`check` reports these diagnostics:

- **NS001** — broken wiki link.
- **NS002** — ambiguous wiki link.
- **NS003** — alias used by more than one note.
- **NS004** — note with no incoming or outgoing graph links.

## Exit codes

- `0` — command succeeded; for `check`, no problems were found, or for `path`, a path was found.
- `1` — `check` found problems or `path` found no path.
- `2` — command-line or work error reported as a `CliError`.

## Development

Run the project's checks with:

```sh
bun test
bun run typecheck
bun run lint
```

## License

MIT, see [LICENSE](LICENSE).

---

Built with BAKED
