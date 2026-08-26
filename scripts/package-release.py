#!/usr/bin/env python3
# ANTLION — release packaging script (CLEAN build)
#
# Builds download/antlion-v<version>.zip (version from package.json) — a clean,
# structured, ready-to-run snapshot of the project with optional/dev-only files
# stripped:
#
#   antlion/
#     README.md, LICENSE, package.json, configs, .env.example, .gitignore
#     src/            full application source (app, components, lib, hooks)
#     prisma/         schema (db is created on first run)
#     public/         brand assets (transparent logo set, favicon, icons)
#     docs/           screenshots + sample report
#     scripts/        install-tools.sh ONLY (README-referenced tool installer)
#
# Excluded on purpose (besides node_modules, .next, db/, logs and session
# artifacts):
#   - tests/           dead template leftovers (reference python-runtime /
#                      next-service-dist build paths that don't exist here)
#   - scripts/e2e-*    e2e proof suites — dev-machine only
#   - scripts/test-*   local test targets / parsers — dev-machine only
#   - scripts/seed-*   demo data seeders
#   - dump-db.mjs, smtp-test-server.mjs, webhook-receiver.mjs,
#     check-excluded.mjs, make-logo-assets.py, package-release.py,
#     start-dev.sh     debug / one-off / maintainer / sandbox utilities
# None of these are referenced by README.md, package.json or src/.

import os
import json
import zipfile

ROOT = "/home/z/my-project"
with open(os.path.join(ROOT, "package.json")) as f:
    _VERSION = json.load(f)["version"]
OUT = os.path.join(ROOT, "download", f"antlion-v{_VERSION}.zip")
PREFIX = "antlion"

ROOT_FILES = [
    "README.md",
    "LICENSE",
    "package.json",
    ".env.example",
    ".gitignore",
    "eslint.config.mjs",
    "next.config.ts",
    "next-env.d.ts",
    "postcss.config.mjs",
    "tailwind.config.ts",
    "tsconfig.json",
    "components.json",
    "Caddyfile",
    "bun.lock",
]

DIRS = ["src", "prisma", "public", "docs", "scripts"]

# scripts/ ships ONLY the installer; every other file there is dev-only.
DIR_FILE_WHITELIST = {"scripts": {"install-tools.sh"}}

SKIP_FILENAMES = {"logo-qa.jpg"}  # QA intermediate, not a deliverable

EXT_DENY = {".log"}

def include_dir_file(rel: str) -> bool:
    parts = rel.split(os.sep)
    name = os.path.basename(rel)
    # per-directory whitelist (clean release: scripts/ = installer only)
    if len(parts) >= 2 and parts[0] in DIR_FILE_WHITELIST:
        if name not in DIR_FILE_WHITELIST[parts[0]]:
            return False
    if name in SKIP_FILENAMES:
        return False
    if os.path.splitext(name)[1] in EXT_DENY:
        return False
    return True

def main() -> None:
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    if os.path.exists(OUT):
        os.remove(OUT)

    count = 0
    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for f in ROOT_FILES:
            src = os.path.join(ROOT, f)
            if not os.path.isfile(src):
                print(f"  ! missing root file (skipped): {f}")
                continue
            z.write(src, f"{PREFIX}/{f}")
            count += 1

        for d in DIRS:
            base = os.path.join(ROOT, d)
            if not os.path.isdir(base):
                print(f"  ! missing dir (skipped): {d}")
                continue
            for dirpath, dirnames, filenames in os.walk(base):
                # prune junk inside walked trees
                dirnames[:] = [x for x in dirnames if x not in {"node_modules", "__pycache__"}]
                for fn in sorted(filenames):
                    full = os.path.join(dirpath, fn)
                    rel = os.path.relpath(full, ROOT)
                    if not include_dir_file(rel):
                        continue
                    z.write(full, f"{PREFIX}/{rel}")
                    count += 1

    size_mb = os.path.getsize(OUT) / 1024 / 1024
    print(f"packaged {count} files -> {OUT} ({size_mb:.1f} MB)")

    # verify integrity + spot-check critical entries
    with zipfile.ZipFile(OUT) as z:
        bad = z.testzip()
        if bad:
            raise SystemExit(f"corrupt entry: {bad}")
        names = set(z.namelist())
        for must in [
            f"{PREFIX}/README.md",
            f"{PREFIX}/LICENSE",
            f"{PREFIX}/package.json",
            f"{PREFIX}/prisma/schema.prisma",
            f"{PREFIX}/public/logo-96.png",
            f"{PREFIX}/public/favicon.ico",
            f"{PREFIX}/src/app/page.tsx",
            f"{PREFIX}/src/lib/notify.ts",
            f"{PREFIX}/docs/screenshots/dashboard.png",
            f"{PREFIX}/scripts/install-tools.sh",
        ]:
            if must not in names:
                raise SystemExit(f"missing expected entry: {must}")
        # clean-release guarantees: no dev scripts, no dead tests tree
        leaked = [n for n in names if n.startswith(f"{PREFIX}/tests/")]
        dev_scripts = [n for n in names if n.startswith(f"{PREFIX}/scripts/") and n != f"{PREFIX}/scripts/install-tools.sh"]
        if leaked or dev_scripts:
            raise SystemExit(f"clean-release violation: {leaked + dev_scripts}")
        print("integrity OK — all critical entries present, zero optional files")

if __name__ == "__main__":
    main()
