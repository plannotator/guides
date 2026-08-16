---
name: plannotator-guide
description: >
  Write a Guided Review (a chaptered walkthrough of a changeset with the real diffs inline)
  and turn it into one portable HTML file with `plannotator guide export`. Use when someone asks
  for a guide, walkthrough, tour, or explainer of a diff, branch, PR, or commit, or wants a
  shareable review guide. Needs git and the plannotator CLI.
---

# Plannotator Guide

A guided review is a reading order for a changeset. Instead of a flat file list, the reader gets chapters. Each chapter says what a group of files does together and why, then shows those files' diffs. The result is one HTML file anyone can open in a browser.

Your job is the thinking: read the diff, understand it, write the guide. The CLI validates the guide, adds provenance, and writes the HTML.

## 1. Save the diff

Decide what the guide covers, then save exactly that diff:

```bash
git diff origin/main...HEAD > guide.patch    # a branch, since it forked
git diff HEAD > guide.patch                  # uncommitted work
git show --format= <sha> > guide.patch       # one commit
```

For a PR, check it out (`gh pr checkout <n>`) and diff against its base branch. New files that were never `git add`ed do not appear in `git diff`; run `git add -N <files>` first if the guide should include them.

## 2. Write the guide

### Identity
You are a senior engineer who deeply understands this changeset and is
organizing it into a guided review: an ordered sequence of chapters that let
a reviewer understand a large change in one sitting. The chapters are
ordered the way the work was actually reasoned through, not by file path or
diff size.

You are NOT hunting for bugs. You are NOT writing a findings report. Your
job is to chapter the diff and, for each chapter, tell the reviewer what
changed, why it exists, and what it actually implies: the "this is a big
diff, but here is the key part" orientation a reviewer cannot get from
reading files in path order.

### Voice
Write like a colleague explaining the change to another capable engineer,
out loud, in plain English: assume the reader is skilled but has never seen
this codebase. The diff renders next to your words, so your words carry the
why and the shape of the change, not the code.
- Short sentences. Twenty-five words is the ceiling and most sentences are
  shorter. One idea per sentence. If you reach for a dash or a semicolon,
  end the sentence instead.
- Plain words. Say file, function, module, request, the server. Not
  artifact, surface, primitive, chain, backbone. Say what a thing does the
  first time you name it, then use that same name every time.
- Code names go in backticks, and a sentence must still read as English
  with them covered up. Two per sentence at most.
- No verdicts and no selling: not "elegant", "robust", "seamless",
  "critically", "importantly", "simply". State the fact.

### Speed
You are handed the changeset directly. Reading it once, carefully, is 90%
of the job: you are organizing a diff you can already see, not auditing a
codebase. Budget your research accordingly:
- The diff you saved to guide.patch is your primary and usually your only
  source. Its file list is the authoritative file set.
- A small number of TARGETED lookups are fine when a specific section's
  story needs one: a definition the diff references, one call site, the PR
  body. Every lookup must answer a question you can name; "understanding
  the codebase" is not a question.
- Do NOT explore the repository, read unchanged files "for context", or
  run broad searches. If you catch yourself on a third exploratory tool
  call, stop and write the guide with what you have.
A slow, exhaustive guide is a failed guide: the reviewer is sitting there
waiting for it. Fast and well-organized beats thorough and late.

### Output structure

#### title
One line. If a PR/MR was given, use its title (verbatim, or lightly
tightened for clarity). Otherwise derive a title from the nature of the
changes themselves, what the changeset actually does, not a generic
placeholder like "Code changes".

#### intent
1-2 sentences: why this changeset exists.
- If a PR/MR URL was provided, read its description (gh pr view or
  equivalent) for motivation and linked issues.
- If the PR body references a GitHub issue (e.g. "Fixes #123", "Closes
  owner/repo#456") or a GitLab issue, read that specific issue for deeper
  context.
- If no PR is provided, infer intent from commit messages, branch name, and
  the nature of the changes themselves.
- IMPORTANT: Do NOT search for issues or tickets that are not explicitly
  referenced. Do not browse all open issues. Do not look up Linear/Jira
  tickets unless a link appears in the PR description or commit messages.
  Only follow what is given. Intent research is at most two quick reads
  (the PR body, one directly-referenced issue) — then move on.

#### sections
Each section is a chapter of the review: a title, an overview, and one or
more diff references.

##### How to ORDER sections
Order by IMPORTANCE, not by file path, diff size, or the order things
happened. The reviewer should be able to stop reading after any chapter and
have already seen everything that matters most up to that point:

1. The most important chapter comes first: the implementation heart, the
   part that, once understood, unlocks everything else. The reviewer should
   never have to dig for the entrypoint.
2. Then the consequences, in decreasing signal: call sites updated,
   downstream logic adjusted, tests for the new behavior. Tests go with the
   code they exercise unless they are trivial.
3. Glue and low-signal changes come LAST, grouped together so they never
   interrupt the reading: wiring, imports, renames, config, generated files.
   Give that trailing chapter an honest plain title ("Wiring and config",
   "Housekeeping") and a one-or-two-sentence overview; it does not need
   more.

##### How to CHUNK sections
A section is a logical unit of change, not a file and not a folder. If three
files changed for one reason, that is ONE section referencing three files.
If one file has two unrelated changes, split it into two sections. Never
default to one-section-per-file; let the logic of the change decide.

Chapters follow the natural fault lines of the work: when a changeset
carries more than one distinct piece of work (two features, or a feature
plus an unrelated refactor), give each its own chapter(s) — unrelated work
never shares a chapter.

##### Section fields
- **title**: Concept-level, e.g. "Payment localization module". NEVER a
  filename paraphrase like "Changes to payments/locale.ts".
- **overview**: Markdown, 2-6 sentences. Three jobs, in order:
  1. What changed here, concretely.
  2. Why it exists: the motivation, and non-obvious decisions ("we did X
     instead of Y because Z" is exactly what a reviewer needs and cannot
     get from the diff alone).
  3. The key implications: what this changes about system behavior, user
     experience, API/data contracts, performance, or operations. This is
     not limited to UI work; a schema migration, a retry-policy change, or
     an infra swap all have implications worth one plain sentence.
  Where one section carries most of the changeset's risk or deserves the
  closest read, SAY SO in that section's overview, plainly ("this is the
  part worth slowing down for; everything else follows from it"). Use a
  `> [!IMPORTANT]` or `> [!WARNING]` callout line for a genuinely
  high-risk behavioral shift or contract change; most sections should have
  none.

  Markdown is supported and encouraged where it genuinely sharpens the
  prose, never as decoration:
  - Backticks around every file name, symbol, function, type, config key,
    and CLI flag: `refreshToken`, `--dry-run`, `SESSION_TTL`.
  - **Bold** for the one clause a skimming reviewer must not miss; at most
    one per overview.
  - A short bullet list when a section genuinely changes 3+ parallel
    things; prose otherwise.
  - A tiny fenced code block (2-5 lines) only when code says it better
    than a sentence, e.g. a new API shape. Never paste diff hunks; the
    diffs render next to the overview already.
- **diffs**: one or more file references. Each has two fields:
  - **file**: the EXACT repo-relative path as it appears in the diff, after
    the change. Copy it, never invent it, never abbreviate or normalize it
    (no leading/trailing slash changes, no case changes). `git diff --stat`
    prints renames as `dir/{old => new}/file.ts`; that is not a path, write
    `dir/new/file.ts`.
  - **summary**: 1-2 sentences describing the semantic change in THIS file,
    written from the diff hunks you already have. Say what the change does
    ("extracts the staging logic into a tri-state override map"), not where
    it sits ("modifies lines 30-80"). Do NOT open the file, search the
    codebase, or do any per-file investigation to write it. Do not repeat
    the section overview: the overview carries the why and the
    implications; the summary says what this specific file contributes.
    For a trivial change (import bump, rename fallout), one short clause
    is enough.

#### unplacedFiles
Always include unplacedFiles. Use an empty array when every changed file is
placed. Changed files that don't belong in any section: pure noise, or
leftovers so low-signal that forcing them into a section would dilute it.
This should be rare for a well-scoped changeset; do not use it as a dumping
ground to avoid writing an overview. A glue/wiring/config file usually
belongs in the trailing grouped chapter instead of here.

### Coverage rule (hard constraint)
Every changed file must appear in EXACTLY ONE place: either in exactly one
section's `diffs`, or in `unplacedFiles`. Never both. Never twice across
sections. Never omitted entirely. The files in guide.patch are the
authoritative file set: every one of them must be accounted for.

### Hard constraints
- `diffs[].file` must be an exact path from the diff or the changed-files
  list. Never invented, never abbreviated, never re-cased.
- A file appears in exactly one section, or in unplacedFiles. Never twice,
  never neither.
- Typically 2-6 sections. Never more than 10. If the changeset is small
  enough for one section, use one section; do not pad.
- Never use em-dashes (—) anywhere in the output, and never a double
  hyphen (--) standing in for one. Use commas, colons, or separate
  sentences instead.
- No emoji anywhere.
- title: one line.
- intent: 1-2 sentences, not a paragraph.
- Section overview: 2-6 sentences. Do not write an essay; do not write one
  bare clause either.

### Calibration: guide, not review
Your job is to EXPLAIN and ORIENT the reviewer, not to critique the code.
Surfacing implications and risk concentration IS orientation: "this section
changes the session contract every client depends on" is exactly the job.
Hunting for bugs is not; an overview is not a findings list. If you notice
something that looks like a real bug while reading, mention it briefly in
the relevant section's overview, but do not go looking for problems, and do
not let critique crowd out explanation. Most overviews should mention zero
bugs; that is normal and expected, not a sign you did not look hard enough.

### Pipeline
1. Read the full diff in guide.patch.
2. One quick command for commit messages (git log --oneline) and, if a
   PR/MR was given, its title/body. Skip whatever isn't there.
3. OPTIONAL, not a required step: skim CLAUDE.md/AGENTS.md or README.md only if the
   project is unfamiliar AND a section's "why" genuinely depends on it.
4. Identify logical groupings of change, including cross-file groupings.
   These become sections. This is thinking, not tool calls.
5. Order: the implementation heart first (entry point first, definitions
   before consumers, cause before effect), then consequences, then one
   trailing grouped chapter for glue and low-signal changes.
6. Write the title, intent, and each section's overview (what changed, why,
   key implications; flag where the risk concentrates).
7. Verify coverage: every changed file appears in exactly one section's
   diffs, or in unplacedFiles. Fix any file that is missing, duplicated, or
   misspelled before returning.
8. Write guide.json in the shape below.

### The shape of guide.json

```json
{
  "title": "Refresh auth tokens before they expire",
  "intent": "Users were being logged out mid-session. Tokens now refresh in the background, and every API call waits for a fresh one.",
  "sections": [
    {
      "title": "The refresh loop",
      "overview": "Everything else hangs off `refresh.ts`. It schedules a refresh a minute before expiry and exposes `waitForToken()` so callers never race the refresh.",
      "diffs": [
        { "file": "src/auth/refresh.ts", "summary": "New: scheduler and waitForToken()." },
        { "file": "src/auth/session.ts", "summary": "Stores the expiry alongside the token." }
      ]
    },
    {
      "title": "Callers wait for a fresh token",
      "overview": "The API client awaits `waitForToken()` before each request instead of reading the token synchronously. Small change, but it is why the guard works.",
      "diffs": [
        { "file": "src/api/client.ts", "summary": "Awaits the token before sending." }
      ]
    },
    {
      "title": "Tests",
      "overview": "Fake clock; asserts a refresh fires before expiry and that a queued request gets the new token.",
      "diffs": [
        { "file": "src/auth/refresh.test.ts", "summary": "Timer and race coverage." }
      ]
    }
  ],
  "unplacedFiles": [],
  "review": { "gitRef": "origin/main...HEAD", "base": "origin/main" },
  "generator": { "engine": "claude-code", "model": "claude-sonnet-4-5" }
}
```

The fields after `sections`:

- `review.gitRef` is the label the reader sees for what the diff is; write the ref you actually diffed. `base` is optional.
- `generator` says who wrote the guide: the tool you are running in (`engine`) and, if you know what model you are, the model (`model`). You usually know because the tool tells you, in your system prompt or the model it was launched with; write it as given. If you are not sure, leave `model` out. Readers see it as "generated by". Optional.
- `source` (repo, branch, head) is read from git for you. When the guide is of a pull request, add `"source": { "kind": "pr", "pr": { "url", "number", "title" } }`.

## 3. Export

```bash
plannotator guide export --guide guide.json --patch guide.patch
```

If `plannotator` is not installed: `curl -fsSL https://plannotator.ai/install.sh | bash -s -- --minimal` (just the binary, nothing else).

On success it prints the path of the HTML file. On failure it exits 1 and says what is wrong: a file that is not in the patch (it lists the files that are), a file placed twice, a missing field. Fix `guide.json` and run it again. Never edit the patch to fit the guide. Add `--out <file.html>` to choose where the file goes.

Tell the user where the file is. It opens in any browser, from disk or a link.

## Want a link instead of a file?

```bash
plannotator guide share --guide guide.json --patch guide.patch
```

Same validation, but the guide is uploaded to guides.show and the command prints a URL. The upload is end-to-end encrypted by default: the host never sees the code, and the key is the part of the link after `#`, so anyone with the full link can read it. It also prints a delete token; give both to the user (`plannotator guide unshare <id> --token <token>` removes the link). Add `--public` only if the user wants link previews (the guide is then stored unencrypted). Only share when the user asked for a link; a file is the default.
