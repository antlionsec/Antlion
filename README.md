# Antlion

[![GitHub stars](https://img.shields.io/github/stars/antlionsec/Antlion?style=social)](https://github.com/antlionsec/Antlion)
[![License](https://img.shields.io/badge/license-MIT-informational)](https://github.com/antlionsec/Antlion/blob/main/LICENSE)
[![GitHub issues](https://img.shields.io/github/issues/antlionsec/Antlion)](https://github.com/antlionsec/Antlion/issues)

Antlion is a local-first workspace designed for bug bounty reconnaissance. It centralizes program discovery, scope management, tool orchestration, and reporting into a single application. All data is stored in a local SQLite database, ensuring complete privacy with zero cloud dependencies and no telemetry.

> [!IMPORTANT]
> **Legal and Usage Disclaimer**
>
> Antlion automates security testing tools against user-defined targets. The repository owner assumes no liability for the misuse of this software. Unauthorized scanning of systems is illegal and violates the terms of service of all bug bounty platforms. 
> 
> You must only use this tool against programs where you are an authorized participant, and strictly against assets explicitly marked as in-scope. This project is independent and not affiliated with the platforms it integrates with. Provided as-is, with no warranty or support SLA.

---

## The Core Problem

Bug bounty reconnaissance often fragments across terminal multiplexers, scattered text files, and disparate tools. Manually tracking which subdomains are in scope, matching specific findings to the tools that generated them, and preventing accidental scans of out-of-scope assets is prone to human error. 

Antlion solves this by collapsing the workflow into a structured, trackable environment:

*   **Database-Driven Scope:** Assets and hard exclusions are imported directly from platforms and tracked per project. Out-of-scope boundaries are strictly enforced.
*   **Orchestrated Pipeline:** A pre-configured pipeline runs 21 industry-standard recon tools across distinct stages (discovery, probing, vulnerability scanning, OSINT).
*   **Persistent Records:** Every run, finding, and target is logged locally. You always know what was scanned, when, and with what configuration.
*   **Automated Reporting:** Transition from raw findings to actionable, exportable HTML/JSON reports without manual copy-pasting.

---

## Features Matrix

| Feature | Implementation |
| :--- | :--- |
| **Platform Integration** | Live listings from HackerOne, Bugcrowd, Intigriti, YesWeHack, Immunefi, and disclose.io, including bounty ranges and response metrics. |
| **Scope Management** | One-click import of in-scope assets and strict out-of-scope exclusions. |
| **Execution Controls** | Granular pipeline controls: Pause between tools, Resume, and Cancel (which actively kills the in-flight subprocess to prevent zombie processes). |
| **Environment Detection** | Probes your `$PATH` at startup to verify tool availability and versions. |
| **Triage Workflow** | Parsed per-tool output featuring severity metrics, CVSS, and custom tags. Includes a lifecycle tracker (new → todo → in-progress → reported → closed) and pinnable notes. |
| **Interactive Graphing** | A discovery tree visualizes scope domains branching into subdomains and findings grouped by type, colored by severity. |
| **Local Backups** | Full project exports to DEFLATE ZIP archives. Supports manual snapshots, automated daily backups, and optional AES-256-GCM encryption. |
| **Global Webhooks** | Configurable notifications for run completions, failures, or critical findings via Discord, Slack, Telegram, SMTP, or generic JSON endpoints. |

---

## The Toolchain

The pipeline integrates the following tools. The application will detect available binaries on your system and bypass stages where the tools are absent.

| Stage | Integrated Tools |
| :--- | :--- |
| **Subdomain Discovery** | `subfinder`, `amass`, `assetfinder`, `shuffledns`, `dnsx`, `cloud_enum` |
| **URL & Endpoint Discovery** | `gau`, `katana`, `gospider`, `waybackurls` |
| **Probing & Fingerprinting** | `httpx` |
| **Visual Capture** | `gowitness` |
| **Vulnerability Scanning** | `nuclei` |
| **Content Discovery** | `ffuf`, `dirsearch` |
| **Port Scanning** | `nmap` |
| **Secret Scanning** | `gitleaks`, `trufflehog` |
| **OSINT / External Intel** | `shodan`, `censys`, `zoomeye` |

---

## Installation & Setup

**Prerequisites:** 
*   Node.js 20+ (or Bun)
*   A Linux, macOS, or WSL environment.

### 1. Application Setup

Clone the repository and initialize the local database:

```bash
git clone https://github.com/antlionsec/Antlion
cd antlion

npm install 

# Configure the SQLite database path
cp .env.example .env 

# Generate the Prisma client and initialize the database
npx prisma generate
npx prisma db push 

# Start the local server
npm run dev
```
The application will be available at `http://localhost:3000`.

### 2. Dependency Installation (Recommended)

To utilize the full pipeline, the underlying security tools must be installed. 

**For Linux (Debian/Ubuntu, Arch, Fedora, openSUSE, Alpine, Void, Gentoo):**
The bundled installation script resolves package-name differences, installs required Go/Python toolchains, clones SecLists, and fetches nuclei templates. The script is idempotent.

```bash
sudo bash scripts/install-tools.sh
```

**For macOS:**
Install the tools manually via Homebrew (e.g., `brew install subfinder nuclei httpx`). Antlion will detect them automatically on your `$PATH`.

### 3. Configuration

*   **API Keys:** Keys for Shodan, Censys, and ZoomEye are configured via **Settings** → **API Keys**. These are stored locally and injected into the pipeline's runtime environment.
*   **Platform Accounts:** Bugcrowd and Intigriti require authenticated sessions to view public program data. Configure these credentials under **Settings** → **Platform Accounts**. All other platforms (HackerOne, YesWeHack, Immunefi, disclose.io) fetch data unauthenticated.

---

## Standard Workflow

1.  **Initialize a Project:** Create a new workspace named for your target program.
2.  **Import Scope:** Navigate to *Discover a Program*, locate your target across the supported platforms, and import the in-scope and out-of-scope assets directly.
3.  **Validate Targets:** Review the Target Selection interface to ensure exclusions are correctly enforced and remove any assets you wish to omit.
4.  **Execute Pipeline:** Navigate to Pipeline Config. Adjust arguments if necessary, then execute. Monitor live stdout/stderr output as the tools run sequentially.
5.  **Triage Findings:** Review the populated dashboard. Update finding statuses, append custom notes, and verify the raw tool output.
6.  **Export:** Generate a self-contained HTML or JSON report for submission. 

---

## Architecture & Limitations

*   **Sequential Local Execution:** Antlion is designed as a local workstation tool, not a distributed scanning cluster. The pipeline executes tools sequentially per stage on your local hardware. 
*   **Privilege Requirements:** Certain stages (e.g., specific `nmap` scans, headless Chromium actions) may require elevated privileges depending on your operating system's configuration.
*   **Parser Constraints:** Finding parsing is best-effort based on current tool output structures. The raw, unparsed output is permanently retained alongside the finding to ensure zero data loss if a parser fails to catch a specific edge case.

---

## Resources

*   **Repository:** [https://github.com/antlionsec/Antlion](https://github.com/antlionsec/Antlion)
*   **Wiki & Troubleshooting:** [https://github.com/antlionsec/Antlion/wiki](https://github.com/antlionsec/Antlion/wiki)
*   **Issue Tracker:** [https://github.com/antlionsec/Antlion/issues](https://github.com/antlionsec/Antlion/issues)