# Antlion

[![GitHub stars](https://img.shields.io/github/stars/antlionsec/Antlion?style=social)](https://github.com/antlionsec/Antlion)
[![License](https://img.shields.io/badge/license-MIT-informational)](https://github.com/antlionsec/Antlion/blob/main/LICENSE)
[![GitHub issues](https://img.shields.io/github/issues/antlionsec/Antlion)](https://github.com/antlionsec/Antlion/issues)

Antlion is a local-first workspace designed for bug bounty reconnaissance. It centralizes program discovery, scope management, tool orchestration, and reporting into a single application. All data is stored in a local SQLite database, ensuring complete privacy with zero cloud dependencies and no telemetry.

> [!IMPORTANT]
> **Legal and Usage Disclaimer**
>
> Antlion automates security testing tools against user-defined targets. The repository owner assumes no liability for the misuse of this software. Unauthorized scanning of systems is illegal in most jurisdictions and violates the terms of service of all bug bounty platforms. 
> 
> You must only use this tool against programs where you are a registered participant, and strictly against assets explicitly listed as in-scope. This project is independent and not affiliated with, endorsed by, or connected to the platforms it integrates with. Provided as-is, with no warranty or support SLA.

---

## The Core Problem

Bug bounty reconnaissance often fragments across terminal multiplexers, scattered text files, and disparate tools. Manually tracking which subdomains are in scope, matching specific findings to the tools that generated them, and preventing accidental scans of out-of-scope assets is prone to human error. 

Antlion solves this by collapsing the workflow into a structured, trackable environment:

*   **Database-Driven Scope:** Assets and hard exclusions are imported directly from platforms and tracked per project. Out-of-scope boundaries are strictly enforced and visible wherever you look at targets.
*   **Orchestrated Pipeline:** A pre-configured pipeline wires 27 industry-standard recon tools across distinct stages (subdomain discovery, URL discovery, probing, screenshots, vulnerability scanning, content discovery, port scanning, secrets, OSINT). You can tune per-tool arguments directly in the app.
*   **Persistent Records:** Every run, finding, and target is logged locally. Each project remains isolated, ensuring you always know what was scanned, when, and with what configuration.
*   **Automated Reporting:** Triage your findings directly in the dashboard, then export self-contained HTML, Markdown, JSON, or plain-text reports. Reports automatically include an executive summary, evidence, remediation, and the full scope appendix without requiring manual copy-pasting.

---

## Features Matrix

*   **Platform Integration**: Features live listings from HackerOne, Bugcrowd, Intigriti, YesWeHack, Immunefi, and the disclose.io registry. Where exposed, data includes bounty ranges, total paid, average response times, and acceptance rates.
*   **Scope Management**: Allows one-click imports of a program's in-scope assets and strict out-of-scope exclusions. 
*   **Execution Controls**: Provides granular pipeline controls: Pause waits between tools, Resume continues execution, and Cancel actively kills the in-flight subprocess to finalize the run honestly (avoiding zombie processes).
*   **Environment Detection**: Probes your `$PATH` at startup to verify and display which of the 27 tools are installed, along with their versions.
*   **Triage Workflow**: Parsed per-tool output features severity metrics, CVSS, evidence, remediation, and custom tags. It includes a lifecycle tracker (new → todo → in-progress → reported → closed) and pinnable notes per finding for triage thoughts.
*   **Interactive Graphing**: A discovery tree visualizes scope domains branching into nested subdomains and findings grouped by type, colored by severity. Users can pan, zoom, search, filter, and click any node for a detail popup.
*   **Local Backups**: Supports full project exports to DEFLATE ZIP archives written in-process. Features manual snapshots, automated daily backups with configurable retention, and optional AES-256-GCM encryption utilizing a scrypt-derived key.
*   **Global Webhooks**: Configurable global notifications for run completions, failures, or critical findings via Discord, Slack, Telegram, SMTP (email), or generic JSON endpoints. 

---

## The Toolchain

The pipeline integrates 27 tools across 9 stages. The application will detect available binaries on your system and bypass stages where the tools are absent.

*   **Subdomain Discovery**: `subfinder`, `amass`, `assetfinder`, `shuffledns`, `dnsx`, `cloud_enum`.
*   **URL & Endpoint Discovery**: `gau`, `katana`, `gospider`, `waybackurls`.
*   **Probing & Fingerprinting**: `httpx`.
*   **Visual Capture**: `gowitness`.
*   **Vulnerability Scanning**: `nuclei`, `nikto`, `dalfox`, `tlsx`, `cariddi`, `whatweb`, `wpscan`.
*   **Content Discovery**: `ffuf`, `dirsearch`.
*   **Port Scanning**: `nmap`.
*   **Secret Scanning**: `gitleaks`, `trufflehog`.
*   **OSINT / External Intel**: `shodan`, `censys`, `zoomeye`.

### Vulnerability Scanning Deep Dive
The vulnerability stage layers seven complementary scanners:
*   **nuclei**: Utilized for template and CVE matching.
*   **nikto**: Targets web-server misconfigurations and outdated software.
*   **dalfox**: Designed for parameter-level XSS, providing payload evidence.
*   **tlsx**: Conducts TLS configuration audits to catch deprecated protocol versions, weak ciphers, and certificate problems.
*   **cariddi**: Performs crawl-time exposure hunting for leaked secrets (e.g., AWS keys), juicy parameters, verbose errors, and exposed `.env`/`.sql`/backup files.
*   **whatweb**: Handles CMS and technology fingerprinting to identify servers, frameworks, WordPress, Drupal, and Joomla with their respective versions.
*   **wpscan**: Executes dedicated WordPress scanning, including core version checks, main theme and plugin versions with outdated checks, `debug.log` and `readme.html` exposure, upload directory listings, and XML-RPC status.

Each tool produces dedicated finding types with severity, evidence, and remediation. If a scanner exits with errors mid-scan, its partial output is still parsed and safely stored with a warning in the run log.

---

## Installation & Setup

**Prerequisites:** 
*   Node.js 20+ (or Bun).
*   A Linux, macOS, or WSL machine.

### 1. Application Setup

Clone the repository and initialize the local database:

```bash
git clone <repository-url> antlion
cd antlion

npm install              # or: bun install

# Configure the SQLite database path
cp .env.example .env     

# Generate the Prisma client and initialize the database
npx prisma generate
npx prisma db push       

# Start the local server
npm run dev              # http://localhost:3000
```

### 2. Dependency Installation (Optional but Recommended)

To utilize the full pipeline, the underlying security tools must be installed. 

**For Linux (Debian/Ubuntu, Arch, Fedora, openSUSE, Alpine, Void, Gentoo):**
The bundled installation script resolves package-name differences across distros. It installs the Go, Python, and Ruby toolchains, builds the Go tools, installs the Ruby-based CMS scanners (`whatweb`, `wpscan`), clones SecLists, writes a resolver list, and fetches nuclei templates. This script is idempotent and logs to `/tmp/antlion-install.log`.

```bash
sudo bash scripts/install-tools.sh
```

**For macOS:**
Install the tools manually via Homebrew (e.g., `brew install subfinder nuclei httpx`). Antlion will detect them automatically on your `$PATH` via Global Settings → Tools → Rescan.

### 3. Global Configuration

*   **API Keys**: Shodan, Censys, and ZoomEye stages require API keys. Configure these via **Settings** (gear button on the landing page) → **API Keys**. Keys are stored locally and injected into the pipeline's tool environment during a run.
*   **Platform Accounts**: Bugcrowd and Intigriti require authenticated, logged-in sessions to view public program data. Configure credentials under **Settings** → **Platform Accounts**. All other platforms (HackerOne, YesWeHack, Immunefi, disclose.io) fetch data unauthenticated. 

---

## Standard Workflow

1.  **Initialize a Project:** Create a new workspace named for your target program. All downstream actions, targets, and findings live inside this project.
2.  **Import Scope:** Navigate to *Discover a Program*, search across the six platforms, and import the in-scope assets and out-of-scope exclusions directly.
3.  **Validate Targets:** Review the Target Selection interface to ensure exclusions are correctly enforced, and remove any assets you don't want touched.
4.  **Execute Pipeline:** Navigate to Pipeline Config. Adjust tool arguments as necessary, then execute. Monitor live per-tool output as stages complete in order.
5.  **Triage Findings:** Review the populated dashboard by severity. Update finding statuses as you work them, append custom notes, and verify the raw tool output.
6.  **Export:** Generate a self-contained report from the Reports view. 
7.  **Backups:** Utilize Project Settings → Backups & Export to download a ZIP of the whole project, snapshot it, or turn on automatic daily snapshots. 

---

## Architecture & Limitations

*   **Sequential Local Execution:** Antlion acts as a local workstation, running tools locally and sequentially per stage. It is not a distributed scanning cluster.
*   **Privilege Requirements:** Certain stages, such as `nmap` and headless `chromium`, require elevated privileges for some scan types. 
*   **Parser Constraints:** Finding parsing is best-effort. Raw, unparsed tool output is permanently retained alongside the parsed finding to prevent data loss.
*   **API Stability:** Bugcrowd and Intigriti integrations read researcher-facing endpoints and can break if those platforms update their APIs. Immunefi scope is scraped best-effort from embedded data on the program page.

---

## Resources

*   **Repository:** https://github.com/antlionsec/Antlion
*   **Wiki & Troubleshooting:** https://github.com/antlionsec/Antlion/wiki
*   **Issue Tracker:** https://github.com/antlionsec/Antlion/issues

*Note: The GitHub and Wiki buttons in the application's top bar link directly to these repository and documentation resources.*
