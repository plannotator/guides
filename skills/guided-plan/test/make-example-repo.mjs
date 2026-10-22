#!/usr/bin/env node
// Makes the git repository an example cites: its invented project committed once, with a fixed
// author, committer and date, so the commit hash is the same on every machine.
//
//   node skills/guided-plan/test/make-example-repo.mjs [DIR]                  examples/paste-expiry/pastebox
//                                                                            (default DIR: examples/paste-expiry/.repo)
//   node skills/guided-plan/test/make-example-repo.mjs --example pickup-times  examples/pickup-times/larkspur
//                                                                            into examples/pickup-times/.repo
//
// pastebox and larkspur are invented projects; the repositories exist only so `build.mjs --check`
// has a commit to reopen.
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
export const EXAMPLE = resolve(here, "../../../examples/paste-expiry");
// Each example with a repository, and the folder of its invented project.
export const PROJECTS = { "paste-expiry": "pastebox", "pickup-times": "larkspur" };

export function makeExampleRepo(dir = join(EXAMPLE, ".repo"), { example = "paste-expiry" } = {}) {
  const from = join(EXAMPLE, "..", example, PROJECTS[example]);
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  cpSync(from, dir, { recursive: true });
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: "pastebox", GIT_AUTHOR_EMAIL: "pastebox@example.invalid", GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z",
    GIT_COMMITTER_NAME: "pastebox", GIT_COMMITTER_EMAIL: "pastebox@example.invalid", GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z",
    GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null",
  };
  const git = (...a) => execFileSync("git", ["-C", dir, "-c", "core.autocrlf=false", "-c", "commit.gpgsign=false", "-c", "init.defaultBranch=main", ...a], { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-q");
  git("add", "-A");
  git("commit", "-q", "-m", PROJECTS[example]);
  return { dir, commit: git("rev-parse", "HEAD") };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const i = args.indexOf("--example");
  const example = i >= 0 ? args[i + 1] : "paste-expiry";
  if (!PROJECTS[example]) { console.error(`unknown example ${example}; one of ${Object.keys(PROJECTS).join(", ")}`); process.exit(1); }
  const dirArg = args.find((a, j) => !a.startsWith("--") && j !== i + 1);
  const { dir, commit } = makeExampleRepo(dirArg ? resolve(dirArg) : join(EXAMPLE, "..", example, ".repo"), { example });
  console.log(`${dir}  ${commit}`);
}
