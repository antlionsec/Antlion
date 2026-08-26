#!/usr/bin/env bash
# ============================================================================
#  Antlion - Bug Bounty Toolchain Installer
# ----------------------------------------------------------------------------
#  Detects the Linux distribution and installs every external CLI tool the
#  Antlion pipeline drives, using the CORRECT package name for each OS:
#
#    Debian / Ubuntu / Kali / Mint ......... apt  (dnsutils, golang-go, python3-pip)
#    Arch / Manjaro / EndeavourOS .......... pacman (bind-tools, go, python-pip)
#    Fedora / RHEL / Rocky / Alma / Amazon . dnf  (bind-utils, golang, python3-pip)
#    openSUSE / SLES ....................... zypper (bind-utils, go, python3-pip)
#    Alpine ................................. apk  (bind-tools, go, py3-pip)
#    Void / Gentoo ......................... xbps / emerge (best effort)
#
#  Tools installed (all 21 tools from the Antlion registry):
#    subfinder amass assetfinder shuffledns dnsx     (subdomain enum)
#    gau katana gospider waybackurls                  (url discovery)
#    httpx nuclei                                     (probing + vuln scan)
#    ffuf dirsearch                                   (content discovery)
#    trufflehog gitleaks                              (secret detection)
#    shodan censys zoomeye-cli                        (intelligence)
#    nmap                                             (port scanning)
#    cloud_enum                                       (cloud asset enum)
#    gowitness (+ chromium)                           (screenshotting)
#
#  Also installs: Go toolchain, Python 3 + pip, git, curl, jq, dig,
#  SecLists wordlists (linked to /usr/share/wordlists), /etc/resolvers.txt
#  (public DNS resolvers) and the nuclei template pack.
#
#  Usage:
#    bash install-tools.sh              # full install (auto root/sudo)
#    bash install-tools.sh --user       # user-level install, no root needed
#    bash install-tools.sh --no-browser # skip chromium (heavy download)
#    bash install-tools.sh --force      # reinstall tools even if present
#
#  Idempotent: safe to re-run. Never aborts on a single failure - every step
#  is verified and reported in the final summary table. Full log:
#  /tmp/antlion-install.log
# ============================================================================

set -u
umask 022

LOGFILE="/tmp/antlion-install.log"
: >"$LOGFILE" 2>/dev/null || LOGFILE="/dev/null"

# ---------------------------------------------------------------------------
# Pretty logging
# ---------------------------------------------------------------------------
if [ -t 1 ]; then
  C_G=$'\e[32m'; C_R=$'\e[31m'; C_Y=$'\e[33m'; C_B=$'\e[36m'; C_D=$'\e[2m'; C_0=$'\e[0m'
else
  C_G=""; C_R=""; C_Y=""; C_B=""; C_D=""; C_0=""
fi

FAILURES=()
WARNINGS=()
COUNT_OK=0; COUNT_SKIP=0; COUNT_FAIL=0

info()  { printf '%s\n' "${C_B}[ .. ]${C_0} $*"; }
ok()    { printf '%s\n' "${C_G}[ ok ]${C_0} $*"; COUNT_OK=$((COUNT_OK+1)); }
skip()  { printf '%s\n' "${C_D}[skip]${C_0} $*"; COUNT_SKIP=$((COUNT_SKIP+1)); }
warn()  { printf '%s\n' "${C_Y}[warn]${C_0} $*"; WARNINGS+=("$*"); }
fail()  { printf '%s\n' "${C_R}[fail]${C_0} $*"; COUNT_FAIL=$((COUNT_FAIL+1)); FAILURES+=("$*"); }
step()  { printf '\n%s\n' "${C_B}==> $*${C_0}"; }

usage() {
  sed -n '2,45p' "$0" | sed 's/^#//;s/^ //'
}

# ---------------------------------------------------------------------------
# Preconditions, flags
# ---------------------------------------------------------------------------
if [ -z "${BASH_VERSION:-}" ]; then
  echo "ERROR: this script must run under bash." >&2
  echo "  Debian/Ubuntu: bash $0" >&2
  echo "  Alpine       : apk add bash && bash $0" >&2
  exit 1
fi

if [ "$(uname -s)" != "Linux" ]; then
  echo "ERROR: this installer targets Linux only (detected: $(uname -s))." >&2
  exit 1
fi

FORCE=0; USER_MODE=0; WANT_BROWSER=1
for arg in "$@"; do
  case "$arg" in
    --force|-f)     FORCE=1 ;;
    --user)         USER_MODE=1 ;;
    --no-browser)   WANT_BROWSER=0 ;;
    -h|--help)      usage; exit 0 ;;
    *)
      echo "ERROR: unknown option: $arg (see --help)" >&2
      exit 1
      ;;
  esac
done

# ---------------------------------------------------------------------------
# OS + package manager detection
# ---------------------------------------------------------------------------
OS_NAME="Linux (unknown)"
if [ -r /etc/os-release ]; then
  # shellcheck disable=SC1091
  . /etc/os-release
  OS_NAME="${PRETTY_NAME:-${NAME:-Linux}}"
fi

detect_pm() {
  if   command -v apt-get      >/dev/null 2>&1; then echo "apt-get"
  elif command -v apt          >/dev/null 2>&1; then echo "apt"
  elif command -v pacman       >/dev/null 2>&1; then echo "pacman"
  elif command -v dnf          >/dev/null 2>&1; then echo "dnf"
  elif command -v yum          >/dev/null 2>&1; then echo "yum"
  elif command -v zypper       >/dev/null 2>&1; then echo "zypper"
  elif command -v apk          >/dev/null 2>&1; then echo "apk"
  elif command -v xbps-install >/dev/null 2>&1; then echo "xbps-install"
  elif command -v emerge       >/dev/null 2>&1; then echo "emerge"
  else echo ""
  fi
}

PM="$(detect_pm)"
case "$PM" in
  apt-get|apt)        FAMILY="apt" ;;
  pacman)             FAMILY="pacman" ;;
  dnf|yum)            FAMILY="dnf" ;;
  zypper)             FAMILY="zypper" ;;
  apk)                FAMILY="apk" ;;
  xbps-install)       FAMILY="xbps" ;;
  emerge)             FAMILY="emerge" ;;
  *)                  FAMILY="" ;;
esac

if [ -z "$FAMILY" ]; then
  echo "ERROR: no supported package manager found (apt/pacman/dnf/zypper/apk/xbps/emerge)." >&2
  echo "Detected OS: $OS_NAME" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Privileges: run as root when possible (single sudo prompt), else user mode
# ---------------------------------------------------------------------------
ROOT=0
if [ "$(id -u)" -eq 0 ]; then
  ROOT=1
elif [ "$USER_MODE" -eq 1 ]; then
  ROOT=0
elif command -v sudo >/dev/null 2>&1; then
  if sudo -n true 2>/dev/null; then
    info "Elevating to root via passwordless sudo ..."
    exec sudo bash "$0" "$@"
  elif [ -t 0 ]; then
    info "Elevating to root via sudo (single password prompt) ..."
    exec sudo bash "$0" "$@"
  else
    warn "sudo present but no passwordless sudo and no terminal - continuing in USER mode"
    ROOT=0
  fi
else
  warn "no root privileges available - continuing in USER mode (system packages skipped)"
  ROOT=0
fi

# Install destinations
if [ "$ROOT" -eq 1 ]; then
  GOBIN_DIR="/usr/local/bin"
  SECLISTS_DIR="/usr/share/seclists"
  WORDLIST_DIR="/usr/share/wordlists"
  RESOLVERS_FILE="/etc/resolvers.txt"
  CLOUD_ENUM_DIR="/usr/local/share/cloud_enum"
else
  GOBIN_DIR="$HOME/.local/bin"
  SECLISTS_DIR="$HOME/.local/share/seclists"
  WORDLIST_DIR="$HOME/.local/share/wordlists"
  RESOLVERS_FILE="$HOME/.config/antlion/resolvers.txt"
  CLOUD_ENUM_DIR="$HOME/.local/share/cloud_enum"
fi
mkdir -p "$GOBIN_DIR" 2>/dev/null || true
export PATH="$GOBIN_DIR:$PATH"

printf '%s\n' "Antlion toolchain installer" \
  "  OS            : $OS_NAME" \
  "  Distro family : $FAMILY (via $PM)" \
  "  Mode          : $([ "$ROOT" -eq 1 ] && echo 'root' || echo 'user')" \
  "  Binary dir    : $GOBIN_DIR" \
  "  Log file      : $LOGFILE"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
ver_ge() { # ver_ge <have> <need> : true when have >= need
  [ "$(printf '%s\n' "$1" "$2" | sort -V | head -n1)" = "$2" ]
}

# Correct package name(s) per distro family for each "slot"
pkg_candidates() {
  case "$1" in
    curl)    echo "curl" ;;
    wget)    echo "wget" ;;
    git)     case "$FAMILY" in emerge) echo "dev-vcs/git";; *) echo "git";; esac ;;
    unzip)   case "$FAMILY" in emerge) echo "app-arch/unzip";; *) echo "unzip";; esac ;;
    jq)      case "$FAMILY" in emerge) echo "app-misc/jq";; *) echo "jq";; esac ;;
    python)  case "$FAMILY" in pacman) echo "python";; apt|dnf|zypper|apk|xbps) echo "python3";; emerge) echo "dev-lang/python";; esac ;;
    pip)     case "$FAMILY" in apt) echo "python3-pip";; pacman) echo "python-pip";; dnf) echo "python3-pip";; zypper) echo "python3-pip";; apk) echo "py3-pip";; xbps) echo "python3-pip";; emerge) echo "dev-python/pip";; esac ;;
    go)      case "$FAMILY" in apt) echo "golang-go";; pacman) echo "go";; dnf) echo "golang";; zypper) echo "go go1.24 go1.23 go1.22 go1.21";; apk) echo "go";; xbps) echo "go";; emerge) echo "dev-lang/go";; esac ;;
    dig)     case "$FAMILY" in apt) echo "dnsutils";; pacman) echo "bind-tools bind";; dnf) echo "bind-utils";; zypper) echo "bind-utils";; apk) echo "bind-tools";; xbps) echo "bind-tools";; emerge) echo "net-dns/bind-tools";; esac ;;
    nmap)    case "$FAMILY" in emerge) echo "net-analyzer/nmap";; *) echo "nmap";; esac ;;
    browser) case "$FAMILY" in apt) echo "chromium chromium-browser";; pacman) echo "chromium";; dnf) echo "chromium";; zypper) echo "chromium";; apk) echo "chromium";; xbps) echo "chromium";; emerge) echo "www-client/chromium";; esac ;;
  esac
}

pm_install() { # install one package with the distro's manager (output -> log)
  local pkg="$1"
  case "$PM" in
    apt-get) DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "$pkg" >>"$LOGFILE" 2>&1 ;;
    apt)     DEBIAN_FRONTEND=noninteractive apt     install -y --no-install-recommends "$pkg" >>"$LOGFILE" 2>&1 ;;
    pacman)  pacman -S --needed --noconfirm "$pkg" >>"$LOGFILE" 2>&1 ;;
    dnf)     dnf install -y "$pkg" >>"$LOGFILE" 2>&1 ;;
    yum)     yum install -y "$pkg" >>"$LOGFILE" 2>&1 ;;
    zypper)  zypper --non-interactive install --no-recommends "$pkg" >>"$LOGFILE" 2>&1 ;;
    apk)     apk add "$pkg" >>"$LOGFILE" 2>&1 ;;
    xbps-install) xbps-install -Sy "$pkg" >>"$LOGFILE" 2>&1 ;;
    emerge)  emerge --quiet "$pkg" >>"$LOGFILE" 2>&1 ;;
  esac
}

ensure_pkg() { # $1 slot, $2 verify command
  local slot="$1" check="${2:-}" pkg found
  local candidates; candidates="$(pkg_candidates "$slot")"
  if [ -n "$check" ] && eval "$check" >/dev/null 2>&1; then
    found="$(eval "$check" 2>/dev/null | head -n1)"
    skip "$slot already present ($found)"
    return 0
  fi
  if [ "$ROOT" -eq 0 ]; then
    warn "no root - cannot install '$slot' via $PM (candidates: $candidates)"
    return 1
  fi
  for pkg in $candidates; do
    if pm_install "$pkg"; then
      if [ -z "$check" ] || eval "$check" >/dev/null 2>&1; then
        ok "$slot installed (package: $pkg)"
        return 0
      fi
    fi
  done
  warn "could not install '$slot' (tried: $candidates)"
  return 1
}

# ---------------------------------------------------------------------------
# STEP 1 - system packages
# ---------------------------------------------------------------------------
step "1/8  System packages ($FAMILY)"

if [ "$FAMILY" = "apt" ] && [ "$ROOT" -eq 1 ]; then
  info "refreshing apt indexes ..."
  DEBIAN_FRONTEND=noninteractive apt-get update >>"$LOGFILE" 2>&1 \
    || warn "apt-get update failed - continuing with cached indexes"
fi

ensure_pkg curl    "command -v curl"
ensure_pkg wget    "command -v wget"
ensure_pkg git     "command -v git"
ensure_pkg unzip   "command -v unzip"
ensure_pkg jq      "command -v jq"
ensure_pkg python  "command -v python3"
ensure_pkg pip     "python3 -m pip --version"
ensure_pkg dig     "command -v dig"
ensure_pkg nmap    "command -v nmap"

# pip fallback for exotic distros where the pip package name did not match
if ! python3 -m pip --version >/dev/null 2>&1; then
  info "pip still missing - trying 'python3 -m ensurepip' ..."
  if python3 -m ensurepip --user >>"$LOGFILE" 2>&1 || python3 -m ensurepip >>"$LOGFILE" 2>&1; then
    ok "pip bootstrapped via ensurepip"
  else
    warn "pip unavailable - Python tools (shodan/censys/dirsearch) will be skipped"
  fi
fi

if [ "$WANT_BROWSER" -eq 1 ]; then
  ensure_pkg browser "command -v chromium || command -v chromium-browser || command -v google-chrome || command -v google-chrome-stable"
else
  skip "browser install skipped (--no-browser)"
fi

# ---------------------------------------------------------------------------
# STEP 2 - Go toolchain (distro package first, official tarball as fallback)
# ---------------------------------------------------------------------------
step "2/8  Go toolchain"

GO_INSTALL_DIR=""
install_go_tarball() {
  local goarch="" ver="" url="" tmpdir=""
  case "$(uname -m)" in
    x86_64)        goarch="amd64" ;;
    aarch64|arm64) goarch="arm64" ;;
    *)
      warn "unsupported architecture for Go tarball: $(uname -m)"
      return 1
      ;;
  esac
  ver="$(curl -fsSL --max-time 30 'https://go.dev/VERSION?m=text' 2>/dev/null | head -n1 | grep -oE 'go[0-9]+\.[0-9]+(\.[0-9]+)?')"
  if [ -z "$ver" ]; then
    ver="$(curl -fsSL --max-time 30 'https://go.dev/dl/?mode=json' 2>/dev/null \
           | grep -oE '"version":"go[0-9]+\.[0-9]+(\.[0-9]+)?"' | head -n1 | cut -d'"' -f4)"
  fi
  if [ -z "$ver" ]; then
    warn "could not determine latest Go version - falling back to go1.23.4"
    ver="go1.23.4"
  fi
  url="https://go.dev/dl/${ver}.linux-${goarch}.tar.gz"
  tmpdir="$(mktemp -d)" || return 1
  info "downloading $url"
  if ! curl -fSL --retry 2 --max-time 900 -o "$tmpdir/go.tgz" "$url" >>"$LOGFILE" 2>&1; then
    rm -rf "$tmpdir"; warn "download failed: $url"; return 1
  fi
  if [ "$ROOT" -eq 1 ]; then
    rm -rf /usr/local/go
    tar -C /usr/local -xzf "$tmpdir/go.tgz" >>"$LOGFILE" 2>&1 || { rm -rf "$tmpdir"; warn "tar extraction failed"; return 1; }
    GO_INSTALL_DIR="/usr/local/go"
  else
    mkdir -p "$HOME/.local"
    rm -rf "$HOME/.local/go"
    tar -C "$HOME/.local" -xzf "$tmpdir/go.tgz" >>"$LOGFILE" 2>&1 || { rm -rf "$tmpdir"; warn "tar extraction failed"; return 1; }
    GO_INSTALL_DIR="$HOME/.local/go"
  fi
  rm -rf "$tmpdir"
  export PATH="$GO_INSTALL_DIR/bin:$PATH"
  command -v go >/dev/null 2>&1
}

# Re-detect a Go toolchain installed by a previous run of this script
# (the tarball location is not on PATH in a fresh shell).
if ! command -v go >/dev/null 2>&1; then
  if [ -x "$HOME/.local/go/bin/go" ]; then
    export PATH="$HOME/.local/go/bin:$PATH"
    GO_INSTALL_DIR="$HOME/.local/go"
  elif [ -x /usr/local/go/bin/go ]; then
    export PATH="/usr/local/go/bin:$PATH"
    GO_INSTALL_DIR="/usr/local/go"
  fi
fi

if command -v go >/dev/null 2>&1; then
  GOVER="$(go version 2>/dev/null | grep -oE 'go1\.[0-9]+(\.[0-9]+)?' | head -n1 | sed 's/^go//')"
  [ -n "$GOVER" ] || GOVER="0"
  if ver_ge "$GOVER" "1.21"; then
    ok "Go toolchain present (go$GOVER - auto toolchain upgrades enabled)"
  else
    warn "system Go too old (go$GOVER, need >= 1.21) - installing official toolchain"
    install_go_tarball && ok "official Go toolchain installed" || fail "Go toolchain upgrade failed"
  fi
else
  info "Go not found - installing official toolchain"
  install_go_tarball && ok "official Go toolchain installed" || fail "Go toolchain installation failed"
fi

export GOBIN="$GOBIN_DIR"
export GO111MODULE=on
export GOTOOLCHAIN=auto
export GOPROXY="${GOPROXY:-https://proxy.golang.org,direct}"

# On low-memory machines (< ~4.5GB), cap Go build parallelism so compilation
# cannot trigger the OOM killer (very common on small VPS boxes).
MEM_KB="$(awk '/MemTotal/ {print $2}' /proc/meminfo 2>/dev/null || echo 0)"
if [ "$MEM_KB" -gt 0 ] && [ "$MEM_KB" -lt 4500000 ]; then
  export GOMAXPROCS="${GOMAXPROCS:-2}"
  export GOFLAGS="${GOFLAGS:--p=2 }"
  warn "low-memory machine ($((MEM_KB / 1024))MB) - Go builds limited to 2 parallel jobs"
fi

# ---------------------------------------------------------------------------
# STEP 3 - Go-based security tools
# ---------------------------------------------------------------------------
step "3/8  Go tools (subfinder, amass, nuclei, httpx, ffuf, ...)"

# name|primary spec|fallback spec|github release repo (optional 4th field:
# used to fetch a prebuilt release binary when 'go install' is impossible,
# e.g. when the module's go.mod contains replace directives) | optional flag
# (5th field "1" = missing tool is a warning, not a failure)
GO_TOOL_SPECS=(
  "subfinder|github.com/projectdiscovery/subfinder/v2/cmd/subfinder@latest|github.com/projectdiscovery/subfinder/v2/cmd/subfinder@master"
  "amass|github.com/owasp-amass/amass/v4/cmd/amass@master|github.com/owasp-amass/amass/v4/cmd/amass@latest"
  "assetfinder|github.com/tomnomnom/assetfinder@latest|github.com/tomnomnom/assetfinder@master"
  "shuffledns|github.com/projectdiscovery/shuffledns/cmd/shuffledns@latest|github.com/projectdiscovery/shuffledns/cmd/shuffledns@master"
  "dnsx|github.com/projectdiscovery/dnsx/cmd/dnsx@latest|github.com/projectdiscovery/dnsx/cmd/dnsx@master"
  "gau|github.com/lc/gau/v2/cmd/gau@latest|github.com/lc/gau/v2/cmd/gau@master"
  "katana|github.com/projectdiscovery/katana/cmd/katana@latest|github.com/projectdiscovery/katana/cmd/katana@master"
  "gospider|github.com/jaeles-project/gospider@latest|github.com/jaeles-project/gospider@master"
  "waybackurls|github.com/tomnomnom/waybackurls@latest|github.com/tomnomnom/waybackurls@master"
  "httpx|github.com/projectdiscovery/httpx/cmd/httpx@latest|github.com/projectdiscovery/httpx/cmd/httpx@master"
  "nuclei|github.com/projectdiscovery/nuclei/v3/cmd/nuclei@latest|github.com/projectdiscovery/nuclei/v3/cmd/nuclei@master"
  "ffuf|github.com/ffuf/ffuf/v2@latest|github.com/ffuf/ffuf/v2@master"
  "gitleaks|github.com/zricethezav/gitleaks/v8@latest|github.com/zricethezav/gitleaks/v8@master"
  "trufflehog|github.com/trufflesecurity/trufflehog/v3@latest|github.com/trufflesecurity/trufflehog/v3@master|trufflesecurity/trufflehog"
  "gowitness|github.com/sensepost/gowitness@latest|github.com/sensepost/gowitness/cmd/gowitness@latest"
  "zoomeye-cli|github.com/zoomeye/zoomeye-cli@latest|github.com/zoomeye/zoomeye-cli@master||1"
)

# Fetch a prebuilt binary from the latest GitHub release of a repo.
# Used when 'go install' cannot work (replace directives in go.mod etc).
install_gh_binary() { # $1 repo (owner/name), $2 binary name
  local repo="$1" binname="$2" arch url tmpdir found
  case "$(uname -m)" in
    x86_64)        arch="amd64" ;;
    aarch64|arm64) arch="arm64" ;;
    *)
      warn "$binname: unsupported architecture for release binaries: $(uname -m)"
      return 1
      ;;
  esac
  url="$(curl -fsSL --retry 2 --retry-delay 2 --max-time 60 "https://api.github.com/repos/$repo/releases/latest" 2>/dev/null \
        | grep -oE '"browser_download_url": *"[^"]+"' | cut -d'"' -f4 \
        | grep -Ei "linux[_-]($arch|x86_64|x64)" | grep -Ev "sha256|checksum|sbom|\.sig$" | head -n1)"
  if [ -z "$url" ]; then
    warn "$binname: no linux-$arch release asset found on $repo"
    return 1
  fi
  tmpdir="$(mktemp -d)" || return 1
  info "$binname: downloading $(basename "$url") from $repo releases"
  if ! curl -fSL --retry 2 --max-time 600 -o "$tmpdir/asset" "$url" >>"$LOGFILE" 2>&1; then
    rm -rf "$tmpdir"; warn "$binname: release download failed"; return 1
  fi
  mkdir -p "$tmpdir/x"
  case "$url" in
    *.tar.gz|*.tgz) tar -C "$tmpdir/x" -xzf "$tmpdir/asset" >>"$LOGFILE" 2>&1 ;;
    *.zip)           (cd "$tmpdir/x" && unzip -oq "$tmpdir/asset") >>"$LOGFILE" 2>&1 ;;
    *.gz)            gunzip -c "$tmpdir/asset" >"$tmpdir/x/$binname" 2>>"$LOGFILE" ;;
    *)               cp "$tmpdir/asset" "$tmpdir/x/$binname" ;;
  esac
  found="$(find "$tmpdir/x" -type f -name "$binname" -perm /111 2>/dev/null | head -n1)"
  [ -z "$found" ] && found="$(find "$tmpdir/x" -type f -name "$binname" 2>/dev/null | head -n1)"
  if [ -n "$found" ]; then
    if install -m 0755 "$found" "$GOBIN_DIR/$binname" 2>>"$LOGFILE"; then
      rm -rf "$tmpdir"
      ok "$binname -> $GOBIN_DIR/$binname (from GitHub release)"
      return 0
    fi
  fi
  rm -rf "$tmpdir"
  warn "$binname: could not locate the binary inside the release asset"
  return 1
}

go_install_tool() {
  local name="$1" primary="$2" fallback="$3" ghrepo="${4:-}" optional="${5:-}" out rc
  if [ "$FORCE" -eq 0 ] && [ -x "$GOBIN_DIR/$name" ]; then
    skip "$name already installed ($GOBIN_DIR/$name)"
    return 0
  fi
  info "go install $primary"
  out="$(cd /tmp && GOBIN="$GOBIN_DIR" go install "$primary" 2>&1)"; rc=$?
  printf '%s\n' "$out" >>"$LOGFILE"
  if [ $rc -eq 0 ] && [ -x "$GOBIN_DIR/$name" ]; then
    ok "$name -> $GOBIN_DIR/$name"
    return 0
  fi
  info "$name: retrying with $fallback"
  out="$(cd /tmp && GOBIN="$GOBIN_DIR" go install "$fallback" 2>&1)"; rc=$?
  printf '%s\n' "$out" >>"$LOGFILE"
  if [ $rc -eq 0 ] && [ -x "$GOBIN_DIR/$name" ]; then
    ok "$name -> $GOBIN_DIR/$name (via fallback spec)"
    return 0
  fi
  if [ -n "$ghrepo" ] && install_gh_binary "$ghrepo" "$name"; then
    return 0
  fi
  if [ -n "$optional" ]; then
    warn "$name: could not be installed (upstream unavailable) - optional tool, see warnings"
  else
    fail "$name: go install failed (see $LOGFILE)"
  fi
  return 1
}

if command -v go >/dev/null 2>&1; then
  for spec in "${GO_TOOL_SPECS[@]}"; do
    IFS='|' read -r tname tprimary tfallback tghrepo toptional <<<"$spec"
    go_install_tool "$tname" "$tprimary" "$tfallback" "$tghrepo" "$toptional"
  done
else
  warn "no Go toolchain available - skipping all Go tools"
fi

# ---------------------------------------------------------------------------
# STEP 4 - Python tools (shodan, censys, dirsearch)
# ---------------------------------------------------------------------------
step "4/8  Python tools (shodan, censys, dirsearch)"

pip_install_one() { # returns 0 on success; handles venv + PEP 668 (externally-managed env)
  local out rc uargs bargs
  uargs=""; bargs="--break-system-packages"
  [ "$ROOT" -eq 0 ] && uargs="--user"
  # shellcheck disable=SC2086
  out="$(python3 -m pip install $uargs "$@" 2>&1)"; rc=$?
  printf '%s\n' "$out" >>"$LOGFILE"
  [ $rc -eq 0 ] && return 0
  out="$(python3 -m pip install "$@" 2>&1)"; rc=$?            # venv python (no --user allowed)
  printf '%s\n' "$out" >>"$LOGFILE"
  [ $rc -eq 0 ] && return 0
  # shellcheck disable=SC2086
  out="$(python3 -m pip install $uargs $bargs "$@" 2>&1)"; rc=$?   # PEP 668 distros
  printf '%s\n' "$out" >>"$LOGFILE"
  [ $rc -eq 0 ] && return 0
  if [ "$ROOT" -eq 1 ]; then
    out="$(python3 -m pip install $bargs "$@" 2>&1)"; rc=$?
    printf '%s\n' "$out" >>"$LOGFILE"
    [ $rc -eq 0 ] && return 0
  fi
  return 1
}

install_pytool() { # $1 binary name, $2 pip package
  local bin="$1" pkg="$2" up
  if [ "$FORCE" -eq 0 ] && command -v "$bin" >/dev/null 2>&1; then
    skip "$bin already installed ($(command -v "$bin"))"
    return 0
  fi
  info "pip install $pkg"
  if [ "$FORCE" -eq 1 ]; then
    pip_install_one --upgrade "$pkg" && command -v "$bin" >/dev/null 2>&1 \
      && { ok "$bin installed"; return 0; }
  else
    pip_install_one "$pkg" && command -v "$bin" >/dev/null 2>&1 \
      && { ok "$bin installed"; return 0; }
  fi
  fail "$bin: pip install failed (see $LOGFILE)"
  return 1
}

if python3 -m pip --version >/dev/null 2>&1; then
  install_pytool shodan    shodan
  install_pytool censys    censys
  install_pytool dirsearch dirsearch
else
  warn "pip not available - skipping shodan / censys / dirsearch"
fi

# The upstream zoomeye-cli Go repository has been unavailable for a while
# (returns 404). Offer the official ZoomEye Python CLI as a working fallback;
# note the app registry looks for the binary name 'zoomeye-cli' (disabled by
# default) - the Python CLI installs as 'zoomeye'.
if ! command -v zoomeye-cli >/dev/null 2>&1 && python3 -m pip --version >/dev/null 2>&1; then
  info "trying official ZoomEye Python CLI as zoomeye-cli fallback (pip: zoomeye)"
  if pip_install_one zoomeye && command -v zoomeye >/dev/null 2>&1; then
    ok "installed 'zoomeye' (official ZoomEye Python CLI) - usable for ZoomEye queries"
  else
    warn "zoomeye-cli: upstream Go repo unavailable - ZoomEye stage stays disabled"
  fi
fi

# ---------------------------------------------------------------------------
# STEP 5 - cloud_enum (Python, from GitHub)
# ---------------------------------------------------------------------------
step "5/8  cloud_enum (cloud asset enumeration)"

if [ "$FORCE" -eq 0 ] && command -v cloud_enum >/dev/null 2>&1; then
  skip "cloud_enum already installed ($(command -v cloud_enum))"
elif ! command -v git >/dev/null 2>&1; then
  warn "cloud_enum: git is required - skipping"
else
  if [ ! -d "$CLOUD_ENUM_DIR/.git" ]; then
    rm -rf "$CLOUD_ENUM_DIR"
    info "git clone https://github.com/initstring/cloud_enum.git"
    if git clone --depth 1 https://github.com/initstring/cloud_enum.git "$CLOUD_ENUM_DIR" >>"$LOGFILE" 2>&1; then
      ok "cloud_enum cloned to $CLOUD_ENUM_DIR"
    else
      warn "cloud_enum: git clone failed - skipping"
    fi
  fi
  if [ -d "$CLOUD_ENUM_DIR/.git" ]; then
    # Upstream moved to pyproject.toml (no requirements.txt anymore)
    if pip_install_one "$CLOUD_ENUM_DIR"; then
      chmod +x "$CLOUD_ENUM_DIR/cloud_enum.py"
      ln -sf "$CLOUD_ENUM_DIR/cloud_enum.py" "$GOBIN_DIR/cloud_enum"
      if command -v cloud_enum >/dev/null 2>&1; then
        ok "cloud_enum -> $GOBIN_DIR/cloud_enum"
      else
        fail "cloud_enum: symlink did not land on PATH"
      fi
    else
      warn "cloud_enum: python dependencies failed to install (see $LOGFILE)"
    fi
  fi
fi

# ---------------------------------------------------------------------------
# STEP 6 - SecLists wordlists + default wordlist links + public resolvers
# ---------------------------------------------------------------------------
step "6/8  SecLists wordlists + DNS resolvers"

if [ -d "$SECLISTS_DIR/Discovery/DNS" ]; then
  skip "SecLists already present at $SECLISTS_DIR"
elif command -v git >/dev/null 2>&1; then
  info "git clone https://github.com/danielmiessler/SecLists.git (shallow)"
  if git clone --depth 1 https://github.com/danielmiessler/SecLists.git "$SECLISTS_DIR" >>"$LOGFILE" 2>&1; then
    ok "SecLists -> $SECLISTS_DIR"
  else
    warn "SecLists: git clone failed (see $LOGFILE)"
  fi
else
  warn "SecLists: git is required - skipping"
fi

if [ "$ROOT" -eq 1 ] && [ -d "$SECLISTS_DIR/Discovery/DNS" ]; then
  mkdir -p "$WORDLIST_DIR"
  ln -sfn "$SECLISTS_DIR/Discovery/DNS/subdomains-top1million-5000.txt"     "$WORDLIST_DIR/subdomains.txt"
  ln -sfn "$SECLISTS_DIR/Discovery/Web-Content/raft-medium-directories.txt" "$WORDLIST_DIR/content.txt"
  ln -sfn "$SECLISTS_DIR/Discovery/Web-Content/common.txt"                  "$WORDLIST_DIR/common.txt"
  ok "default wordlists linked into $WORDLIST_DIR (subdomains.txt, content.txt, common.txt)"
elif [ "$ROOT" -eq 0 ] && [ -d "$SECLISTS_DIR/Discovery/DNS" ]; then
  mkdir -p "$WORDLIST_DIR" 2>/dev/null || true
  warn "user mode: wordlists live in $SECLISTS_DIR (run as root to symlink /usr/share/wordlists defaults)"
fi

RESOLV_DIR="$(dirname "$RESOLVERS_FILE")"
mkdir -p "$RESOLV_DIR" 2>/dev/null || true
if printf '%s\n' \
  1.1.1.1 1.0.0.1 \
  8.8.8.8 8.8.4.4 \
  9.9.9.9 149.112.112.112 \
  208.67.222.222 208.67.220.220 \
  74.82.42.42 64.6.64.6 >"$RESOLVERS_FILE" 2>/dev/null; then
  ok "public DNS resolvers -> $RESOLVERS_FILE (shuffledns default)"
else
  warn "could not write $RESOLVERS_FILE"
fi

# ---------------------------------------------------------------------------
# STEP 7 - nuclei templates
# ---------------------------------------------------------------------------
step "7/8  nuclei templates"

if command -v nuclei >/dev/null 2>&1; then
  info "downloading nuclei template pack (best effort, may take a minute) ..."
  if timeout 600 nuclei -ut >>"$LOGFILE" 2>&1; then
    ok "nuclei templates updated"
  else
    warn "nuclei template download did not complete - nuclei will retry on first run"
  fi
else
  skip "nuclei not installed - template step not needed"
fi

# ---------------------------------------------------------------------------
# STEP 8 - PATH persistence
# ---------------------------------------------------------------------------
step "8/8  PATH persistence"

if [ "$ROOT" -eq 1 ]; then
  if [ -n "$GO_INSTALL_DIR" ]; then
    if printf '%s\n' 'export PATH="/usr/local/go/bin:$PATH"' > /etc/profile.d/antlion-go.sh 2>/dev/null; then
      ok "PATH entry written to /etc/profile.d/antlion-go.sh"
    fi
  else
    skip "tools live in /usr/local/bin - already on every PATH"
  fi
else
  PATHLINE='export PATH="$HOME/.local/bin:$HOME/.local/go/bin:$PATH"'
  for rc in "$HOME/.bashrc" "$HOME/.zshrc"; do
    if [ -f "$rc" ] && ! grep -qF '.local/bin' "$rc" 2>/dev/null; then
      printf '\n# added by Antlion installer\n%s\n' "$PATHLINE" >>"$rc"
      ok "PATH entry appended to $rc"
    fi
  done
fi

# ---------------------------------------------------------------------------
# Final verification + summary
# ---------------------------------------------------------------------------
ALL_TOOLS="subfinder amass assetfinder shuffledns dnsx cloud_enum gau katana gospider waybackurls httpx nuclei shodan censys zoomeye-cli trufflehog gitleaks nmap ffuf dirsearch gowitness"

printf '\n%s\n' "${C_B}=================== INSTALLATION SUMMARY ===================${C_0}"
printf '  OS: %s | family: %s | mode: %s\n' "$OS_NAME" "$FAMILY" "$([ "$ROOT" -eq 1 ] && echo root || echo user)"
printf '%s\n' "---------------------------------------------------------------"
printf '%-14s %-9s %s\n' "TOOL" "STATUS" "LOCATION"
printf '%s\n' "---------------------------------------------------------------"
found=0; total=0
for t in $ALL_TOOLS; do
  total=$((total+1))
  tpath="$(command -v "$t" 2>/dev/null || true)"
  if [ -n "$tpath" ]; then
    found=$((found+1))
    printf '%-14s %-9s %s\n' "$t" "${C_G}FOUND${C_0}" "$tpath"
  else
    printf '%-14s %-9s %s\n' "$t" "${C_R}MISSING${C_0}" "-"
  fi
done
printf '%s\n' "---------------------------------------------------------------"
printf '  Tools ready: %d/%d\n' "$found" "$total"

if command -v chromium >/dev/null 2>&1 || command -v chromium-browser >/dev/null 2>&1 || command -v google-chrome >/dev/null 2>&1; then
  printf '  Browser     : present (gowitness / katana JS rendering ready)\n'
else
  printf '  Browser     : %snone%s (install chromium for gowitness screenshots)\n' "$C_Y" "$C_0"
fi

if [ "$COUNT_FAIL" -gt 0 ]; then
  printf '\n%s\n' "${C_R}Failed steps (${COUNT_FAIL}):${C_0}"
  printf '  - %s\n' "${FAILURES[@]}"
fi
if [ "${#WARNINGS[@]}" -gt 0 ]; then
  printf '\n%s\n' "${C_Y}Warnings (${#WARNINGS[@]}):${C_0}"
  printf '  - %s\n' "${WARNINGS[@]}"
fi

printf '\n%s\n' "Next steps:"
printf '  1. Open a NEW terminal (so PATH changes apply), or re-login.\n'
printf '  2. In Antlion: Settings -> "Rescan tools" - the app detects the\n'
printf '     tools automatically from the command line.\n'
printf '  3. API keys (Settings -> API Keys): SHODAN_API_KEY, CENSYS_API_ID +\n'
printf '     CENSYS_API_SECRET, ZOOMEYE_API_KEY - only needed for the\n'
printf '     intelligence stages.\n'
printf '  4. Re-run this script any time to retry failures (it is idempotent).\n'
if command -v go >/dev/null 2>&1; then
  printf '  5. Low on disk? Reclaim the Go caches with:\n'
  printf '        go clean -cache      (build cache, safe to remove)\n'
  printf '        go clean -modcache   (module cache, re-downloads on demand)\n'
fi
printf '  Full log: %s\n' "$LOGFILE"

if [ "$COUNT_FAIL" -gt 0 ]; then
  exit 1
fi
exit 0
