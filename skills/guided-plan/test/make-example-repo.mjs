#!/usr/bin/env node
// Makes the git repository the worked example cites: examples/paste-expiry/pastebox/ committed
// once, with a fixed author, committer and date, so the commit hash is the same on every machine.
//
//   node skills/guided-plan/test/make-example-repo.mjs [DIR]     (default: examples/paste-expiry/.repo)
//
// pastebox is an invented project; the repository exists only so `build.mjs --check` has a
// commit to reopen.
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
export const EXAMPLE = resolve(here, "../../../examples/paste-expiry");

export function makeExampleRepo(dir = join(EXAMPLE, ".repo")) {
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  cpSync(join(EXAMPLE, "pastebox"), dir, { recursive: true });
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: "pastebox", GIT_AUTHOR_EMAIL: "pastebox@example.invalid", GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z",
    GIT_COMMITTER_NAME: "pastebox", GIT_COMMITTER_EMAIL: "pastebox@example.invalid", GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z",
    GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null",
  };
  const git = (...a) => execFileSync("git", ["-C", dir, "-c", "core.autocrlf=false", "-c", "commit.gpgsign=false", "-c", "init.defaultBranch=main", ...a], { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-q");
  git("add", "-A");
  git("commit", "-q", "-m", "pastebox");
  return { dir, commit: git("rev-parse", "HEAD") };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { dir, commit } = makeExampleRepo(process.argv[2] ? resolve(process.argv[2]) : undefined);
  console.log(`${dir}  ${commit}`);
}
