![plannotator-guide](banner.webp)

# plannotator-guide

An agent skill that writes a **Guided Review**, a chaptered walkthrough of a diff, and exports it as a single portable HTML file. The file is roughly the size of the diff; the renderer loads from [guides.show](https://guides.show), pinned to an exact build, so the file keeps opening as-is.

The agent reads the diff and writes the guide. The [plannotator](https://plannotator.ai) CLI validates it, adds provenance (repo, branch, head SHA), and writes the HTML:

```bash
plannotator guide export --guide guide.json --patch guide.patch
```

If a link is easier than a file, the same input can be uploaded instead:

```bash
plannotator guide share --guide guide.json --patch guide.patch
```

This prints a `https://guides.show/g/<id>#key=...` URL and a one-time delete token. The upload is encrypted end to end by default: the key lives only in the part of the link after `#`, so the host stores ciphertext it cannot read, and anyone with the full link can open the guide. Add `--public` to store it unencrypted so chat apps can show a title preview. `plannotator guide unshare <id> --token <token>` removes it. Nothing is uploaded unless you ask for a link.

The host is a small Cloudflare Worker you can run yourself. Point the CLI at your deployment with `PLANNOTATOR_GUIDE_SHARE_URL=https://guides.example.com` (and `PLANNOTATOR_GUIDE_VIEWER_URL=https://guides.example.com/v1/` for the files). Recipe: [`apps/guides-show`](https://github.com/backnotprop/plannotator/tree/main/apps/guides-show) in the Plannotator repo.

## Install

```bash
npx skills add plannotator/guides
```

Also needs git and the plannotator CLI (the minimal install is enough if you don't use the Plannotator UI):

```bash
curl -fsSL https://plannotator.ai/install.sh | bash -s -- --minimal
```

## Use

Ask your agent for a guide, walkthrough, or tour of a branch, PR, commit, or uncommitted work. It saves the diff, writes `guide.json`, runs the export, and gives you the path to the HTML. Open it in any browser, or run the same thing from a PR pipeline with whichever agent you use there.

The guide shape and the full flow are in [`skills/plannotator-guide/SKILL.md`](skills/plannotator-guide/SKILL.md).

## Related

- [Portable guide format](https://plannotator.ai/docs/reference/portable-guides/): what is in the file, the snapshot format, share links, and guides.show.
- [Plannotator](https://github.com/backnotprop/plannotator): the review tool that generates these guides in-app.
