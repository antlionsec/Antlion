#!/usr/bin/env python3
# ANTLION — release packaging script
#
# Builds download/antlion-v0.3.0.zip — a clean, structured, ready-to-run
# snapshot of the project:
#
#   antlion/
#     README.md, LICENSE, package.json, configs, .env.example, .gitignore
#     src/            full application source (app, components, lib, hooks)
#     prisma/         schema (db is created on first run)
#     public/         brand assets (transparent logo set, favicon, icons)
#     docs/           screenshots + sample report
#     scripts/        installer, seeders, e2e test suites, dev utilities
#     tests/          container/runtime build tests
#
# Excluded on purpose: node_modules, .next, db/ (user data), logs,
# worklog/tool-results/upload/download/skills (session artifacts).

import os
import zipfile

ROOT = "/home/z/my-project"
OUT = os.path.join(ROOT, "download", "antlion-v0.3.0.zip")
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

DIRS = ["src", "prisma", "public", "docs", "scripts", "tests"]

SKIP_FILENAMES = {"logo-qa.jpg"}  # QA intermediate, not a deliverable

EXT_DENY = {".log"}

def include_dir_file(rel: str) -> bool:
    name = os.path.basename(rel)
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
        print("integrity OK — all critical entries present")

if __name__ == "__main__":
    main()
