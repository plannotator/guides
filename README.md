![plannotator-guide](banner.webp)

# plannotator-guide

An agent skill that writes a **Guided Review** — a chaptered walkthrough of a changeset with the real diffs inline — and exports it as one portable HTML file. The file is small (roughly the size of the diff); the renderer loads from [guides.show](https://guides.show).

The agent reads the diff and writes the guide. The [plannotator](https://plannotator.ai) CLI validates it, adds provenance, and writes the HTML:

```bash
plannotator guide export --guide guide.json --patch guide.patch
```

## Install

```bash
npx skills add plannotator/guides
```

Also needs git and the plannotator CLI:

```bash
curl -fsSL https://plannotator.ai/install.sh | bash -s -- --minimal
```

## Use

Ask your agent for a guide, walkthrough, or tour of a branch, PR, commit, or uncommitted work. It saves the diff, writes `guide.json`, runs the export, and hands you the path to the HTML. Open it in any browser.

The guide shape and the full flow are in [`skills/plannotator-guide/SKILL.md`](skills/plannotator-guide/SKILL.md).

## Related

- [Portable guide format](https://plannotator.ai/docs/reference/portable-guides/) — what is in the file, the snapshot format, and guides.show.
- [Plannotator](https://github.com/backnotprop/plannotator) — the review tool that generates these guides in-app.
