#!/bin/bash
set -e

# Parallel dependency installation script for Ariana agent machines
# Uses official installation methods - NO asdf
# APT installs run sequentially (dpkg lock), but curl/binary installs run in parallel

LOG_DIR="/tmp/install-logs"
mkdir -p "$LOG_DIR"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_info() { echo -e "${YELLOW}[INFO]${NC} $1"; }

# Track background jobs
declare -A PIDS
declare -A JOB_NAMES

wait_for_jobs() {
    local failed=0
    local failed_jobs=""
    for name in "${!PIDS[@]}"; do
        local pid=${PIDS[$name]}
        if wait $pid; then
            log_success "$name completed"
        else
            log_error "$name failed"
            failed_jobs="$failed_jobs $name"
            failed=1
        fi
    done
    PIDS=()
    JOB_NAMES=()

    # Dump failed job logs
    for name in $failed_jobs; do
        echo ""
        echo "========== FAILED: $name =========="
        cat "$LOG_DIR/${name}.log" 2>/dev/null || echo "(no log file)"
        echo "========== END $name =========="
        echo ""
    done

    return $failed
}

start_job() {
    local name=$1
    shift
    "$@" > "$LOG_DIR/${name}.log" 2>&1 &
    PIDS[$name]=$!
    JOB_NAMES[$!]=$name
    log_info "Started: $name (PID: ${PIDS[$name]})"
}

export DEBIAN_FRONTEND=noninteractive

echo "=============================================="
echo "  PHASE 1: Add all external repos first"
echo "=============================================="

apt-get update -qq
apt-get install -y -qq curl ca-certificates wget gnupg lsb-release software-properties-common dirmngr apt-transport-https debconf-utils

# R CRAN repo
log_info "Adding R CRAN repo..."
wget -qO- https://cloud.r-project.org/bin/linux/ubuntu/marutter_pubkey.asc | tee -a /etc/apt/trusted.gpg.d/cran_ubuntu_key.asc >/dev/null
echo "deb https://cloud.r-project.org/bin/linux/ubuntu $(lsb_release -cs)-cran40/" > /etc/apt/sources.list.d/cran.list

# Google Chrome repo (proper browser, not snap)
log_info "Adding Google Chrome repo..."
wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /etc/apt/keyrings/google-chrome.gpg
echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/google-chrome.gpg] https://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list

# PHP Ondrej PPA
log_info "Adding PHP PPA..."
add-apt-repository -y ppa:ondrej/php >/dev/null 2>&1

# Node.js repo (official)
log_info "Adding Node.js repo..."
curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null 2>&1

# GitHub CLI repo
log_info "Adding GitHub CLI repo..."
mkdir -p -m 755 /etc/apt/keyrings
curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /etc/apt/keyrings/githubcli-archive-keyring.gpg
chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list

# Erlang/Elixir - use Ubuntu's default packages (no external repo needed for Ubuntu 24.04)
log_info "Erlang/Elixir will be installed from Ubuntu repos..."

# .NET repo (Microsoft official)
log_info "Adding .NET repo..."
curl -fsSL https://packages.microsoft.com/config/ubuntu/$(lsb_release -rs)/packages-microsoft-prod.deb -o /tmp/packages-microsoft-prod.deb
dpkg -i /tmp/packages-microsoft-prod.deb
rm /tmp/packages-microsoft-prod.deb

# Docker repo (official)
log_info "Adding Docker repo..."
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" > /etc/apt/sources.list.d/docker.list

# VSCode repo (official Microsoft)
log_info "Adding VSCode repo..."
wget -qO- https://packages.microsoft.com/keys/microsoft.asc | gpg --dearmor -o /etc/apt/keyrings/packages.microsoft.gpg
echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/packages.microsoft.gpg] https://packages.microsoft.com/repos/code stable main" > /etc/apt/sources.list.d/vscode.list

log_success "All repos added"

echo "=============================================="
echo "  PHASE 2: Install all apt packages"
echo "=============================================="

apt-get update -qq

# Set system locale to English (Hetzner Germany defaults can cause German UI in Chrome/websites)
log_info "Setting system locale to en_US.UTF-8..."
apt-get install -y -qq locales
sed -i 's/# en_US.UTF-8 UTF-8/en_US.UTF-8 UTF-8/' /etc/locale.gen
locale-gen en_US.UTF-8
update-locale LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 LANGUAGE=en_US:en

# Preconfigure answers to avoid interactive prompts during install
echo "lightdm shared/default-x-display-manager select lightdm" | debconf-set-selections
echo "gdm3 shared/default-x-display-manager select lightdm" | debconf-set-selections
echo "keyboard-configuration keyboard-configuration/layout select English (US)" | debconf-set-selections
echo "keyboard-configuration keyboard-configuration/variant select English (US)" | debconf-set-selections
echo "console-setup console-setup/charmap47 select UTF-8" | debconf-set-selections

# Install everything from apt in one go
apt-get install -y -qq \
    git zip unzip bash coreutils tree \
    python3 python3-pip python3-venv \
    make g++ gcc pkg-config libssl-dev \
    build-essential zlib1g-dev libbz2-dev libreadline-dev libsqlite3-dev llvm \
    libncursesw5-dev xz-utils tk-dev libxml2-dev libxmlsec1-dev libffi-dev liblzma-dev \
    libyaml-dev autoconf \
    openjdk-11-jdk maven \
    budgie-desktop budgie-indicator-applet gnome-terminal nautilus lightdm xserver-xorg-video-dummy plank \
    google-chrome-stable code \
    ffmpeg imagemagick screen iproute2 sqlite3 pigz zstd restic \
    nodejs \
    gh \
    r-base r-base-dev \
    php8.4-cli php8.4-common php8.4-opcache php8.4-mysql php8.4-xml php8.4-curl php8.4-zip php8.4-mbstring php8.4-gd php8.4-intl php8.4-bcmath \
    erlang elixir \
    dotnet-sdk-8.0 \
    docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin \
    libwebkit2gtk-4.1-dev libxdo-dev libayatana-appindicator3-dev librsvg2-dev \
    libgtk-3-dev libgtk-3-0 libglib2.0-dev libglib2.0-0 \
    libgdk-pixbuf2.0-dev libgdk-pixbuf-2.0-0 \
    libpango1.0-dev libcairo2-dev libatk1.0-dev libsoup-3.0-dev \
    libjavascriptcoregtk-4.1-dev gir1.2-javascriptcoregtk-4.1 gir1.2-webkit2-4.1 \
    libwebkit2gtk-4.1-0 file patchelf libfuse2 \
    clang cmake ninja-build

log_success "All apt packages installed"

echo "=============================================="
echo "  PHASE 3: Binary/curl installs (PARALLEL)"
echo "=============================================="

# Rust (official rustup) - install globally to /usr/local
install_rust() {
    export RUSTUP_HOME="/usr/local/rustup"
    export CARGO_HOME="/usr/local/cargo"
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --no-modify-path
    # Create symlinks to /usr/local/bin for global access
    ln -sf /usr/local/cargo/bin/cargo /usr/local/bin/cargo
    ln -sf /usr/local/cargo/bin/rustc /usr/local/bin/rustc
    ln -sf /usr/local/cargo/bin/rustup /usr/local/bin/rustup
    ln -sf /usr/local/cargo/bin/rustfmt /usr/local/bin/rustfmt
    ln -sf /usr/local/cargo/bin/cargo-clippy /usr/local/bin/cargo-clippy
    ln -sf /usr/local/cargo/bin/clippy-driver /usr/local/bin/clippy-driver
    ln -sf /usr/local/cargo/bin/cargo-fmt /usr/local/bin/cargo-fmt
    ln -sf /usr/local/cargo/bin/rust-analyzer /usr/local/bin/rust-analyzer
    # Source and install rust-analyzer
    source "/usr/local/cargo/env"
    rustup component add rust-analyzer
    # Set RUSTUP_HOME globally so all users share the same toolchain
    # Do NOT set CARGO_HOME - let each user use ~/.cargo for registry cache
    # This avoids permission issues when users download crates
    if ! grep -q "RUSTUP_HOME" /etc/environment 2>/dev/null; then
        echo 'RUSTUP_HOME="/usr/local/rustup"' >> /etc/environment
    fi
    # Ensure cargo bin is in the system PATH in /etc/environment
    if grep -q "^PATH=" /etc/environment; then
        # Update existing PATH to include /usr/local/cargo/bin at the start
        sed -i 's|^PATH="\(.*\)"|PATH="/usr/local/cargo/bin:\1"|' /etc/environment
    else
        echo 'PATH="/usr/local/cargo/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"' >> /etc/environment
    fi

    # CRITICAL: Also add to /etc/bash.bashrc which is sourced by ALL bash shells
    # This ensures cargo works even in non-login, non-interactive shells (like "ssh user@host 'command'")
    # We add it at the TOP of the file, before the interactive check
    # NOTE: Only set RUSTUP_HOME, not CARGO_HOME - users get their own ~/.cargo
    if ! grep -q "RUSTUP_HOME" /etc/bash.bashrc 2>/dev/null; then
        # Create a temp file with our exports at the top
        cat > /tmp/bash.bashrc.new <<'BASHRC_RUST'
# Rust toolchain (added by install-all-deps.sh)
# RUSTUP_HOME is shared, CARGO_HOME defaults to ~/.cargo per user
export RUSTUP_HOME="/usr/local/rustup"
export PATH="/usr/local/cargo/bin:$PATH"

BASHRC_RUST
        cat /etc/bash.bashrc >> /tmp/bash.bashrc.new
        mv /tmp/bash.bashrc.new /etc/bash.bashrc
    fi

    # Also create profile.d script for login shells
    cat > /etc/profile.d/rust.sh <<'RUSTPROFILE'
export RUSTUP_HOME="/usr/local/rustup"
export PATH="/usr/local/cargo/bin:$PATH"
RUSTPROFILE
    chmod +x /etc/profile.d/rust.sh
}

# Bun (official)
install_bun() {
    curl -fsSL https://bun.sh/install | bash
    mv /root/.bun/bin/bun /usr/local/bin/
    chmod +x /usr/local/bin/bun
    ln -sf /usr/local/bin/bun /usr/local/bin/bunx
}

# Deno (official)
install_deno() {
    curl -fsSL https://deno.land/install.sh | sh
    mv /root/.deno/bin/deno /usr/local/bin/
    chmod +x /usr/local/bin/deno
}

# uv (official - fast Python package manager)
install_uv() {
    curl -LsSf https://astral.sh/uv/install.sh | sh
    mv /root/.local/bin/uv /usr/local/bin/ 2>/dev/null || mv /root/.cargo/bin/uv /usr/local/bin/ 2>/dev/null || true
    chmod +x /usr/local/bin/uv
}

# Go (official binary)
install_go() {
    local GO_VERSION="1.23.4"
    echo "[go] Starting Go ${GO_VERSION} installation..."

    echo "[go] Downloading go${GO_VERSION}.linux-amd64.tar.gz..."
    if ! wget -v "https://go.dev/dl/go${GO_VERSION}.linux-amd64.tar.gz" -O /tmp/go.tar.gz; then
        echo "[go] ERROR: wget download failed" >&2
        return 1
    fi

    echo "[go] Downloaded, file size: $(ls -lh /tmp/go.tar.gz 2>/dev/null | awk '{print $5}')"

    echo "[go] Removing existing /usr/local/go..."
    rm -rf /usr/local/go

    echo "[go] Extracting tarball to /usr/local..."
    if ! tar -C /usr/local -xzf /tmp/go.tar.gz; then
        echo "[go] ERROR: tar extraction failed" >&2
        return 1
    fi

    echo "[go] Cleaning up tarball..."
    rm /tmp/go.tar.gz

    echo "[go] Creating symlinks..."
    ln -sf /usr/local/go/bin/go /usr/local/bin/go
    ln -sf /usr/local/go/bin/gofmt /usr/local/bin/gofmt

    echo "[go] Verifying installation..."
    if [ -x /usr/local/go/bin/go ]; then
        echo "[go] SUCCESS: Go installed at /usr/local/go/bin/go"
        /usr/local/go/bin/go version
    else
        echo "[go] ERROR: Go binary not found or not executable after installation" >&2
        ls -la /usr/local/go/bin/ 2>&1 || echo "[go] /usr/local/go/bin/ does not exist"
        return 1
    fi
}

# nvm (official)
install_nvm() {
    export NVM_DIR="/root/.nvm"
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
    # Setup for all users
    echo 'export NVM_DIR="$HOME/.nvm"' > /etc/profile.d/nvm.sh
    echo '[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"' >> /etc/profile.d/nvm.sh
    chmod +x /etc/profile.d/nvm.sh
}

# Gradle (official binary)
install_gradle() {
    local GRADLE_VERSION="8.12"
    wget -q "https://services.gradle.org/distributions/gradle-${GRADLE_VERSION}-bin.zip" -O /tmp/gradle.zip
    unzip -q /tmp/gradle.zip -d /opt/
    ln -sf /opt/gradle-${GRADLE_VERSION}/bin/gradle /usr/local/bin/gradle
    rm /tmp/gradle.zip
}

# Kotlin (official binary)
install_kotlin() {
    local KOTLIN_VERSION="2.1.0"
    wget -q "https://github.com/JetBrains/kotlin/releases/download/v${KOTLIN_VERSION}/kotlin-compiler-${KOTLIN_VERSION}.zip" -O /tmp/kotlin.zip
    unzip -q /tmp/kotlin.zip -d /opt/
    ln -sf /opt/kotlinc/bin/kotlin /usr/local/bin/kotlin
    ln -sf /opt/kotlinc/bin/kotlinc /usr/local/bin/kotlinc
    rm /tmp/kotlin.zip
}

# Scala via Coursier (official)
install_scala() {
    curl -fL https://github.com/coursier/coursier/releases/latest/download/cs-x86_64-pc-linux.gz | gzip -d > /tmp/cs
    chmod +x /tmp/cs
    /tmp/cs setup --yes --install-dir /usr/local/bin --apps scala,scalac,sbt
    rm /tmp/cs
}

# Ruby (via ruby-build, installed globally to /usr/local)
install_ruby() {
    local RUBY_VERSION="4.0.1"
    git clone --depth 1 https://github.com/rbenv/ruby-build.git /tmp/ruby-build
    /tmp/ruby-build/bin/ruby-build "$RUBY_VERSION" /usr/local
    rm -rf /tmp/ruby-build
    # Install bundler globally
    /usr/local/bin/gem install bundler --no-document
}

# Composer (official PHP)
install_composer() {
    curl -sS https://getcomposer.org/installer | php -- --install-dir=/usr/local/bin --filename=composer
    chmod +x /usr/local/bin/composer
}

# Sunshine streaming server (for Moonlight web desktop)
install_sunshine() {
    local SUNSHINE_VERSION="2025.924.154138"

    # Try Ubuntu 24.04 package first, then Debian Bookworm as fallback
    if ! wget -q "https://github.com/LizardByte/Sunshine/releases/download/v${SUNSHINE_VERSION}/sunshine-ubuntu-24.04-amd64.deb" -O /tmp/sunshine.deb; then
        if ! wget -q "https://github.com/LizardByte/Sunshine/releases/download/v${SUNSHINE_VERSION}/sunshine-debian-bookworm-amd64.deb" -O /tmp/sunshine.deb; then
            echo "ERROR: Failed to download Sunshine ${SUNSHINE_VERSION} - both Ubuntu and Debian packages failed" >&2
            return 1
        fi
    fi

    if [ ! -f /tmp/sunshine.deb ]; then
        echo "ERROR: Sunshine .deb file not found after download" >&2
        return 1
    fi

    if ! apt-get install -y /tmp/sunshine.deb; then
        echo "ERROR: Failed to install Sunshine .deb package" >&2
        apt-get install -f -y || true  # Try to fix broken deps
        rm -f /tmp/sunshine.deb
        return 1
    fi
    rm -f /tmp/sunshine.deb

    # Configure Sunshine for headless operation
    mkdir -p /etc/sunshine
    cat > /etc/sunshine/sunshine.conf << 'SUNCONF'
# Sunshine configuration for headless agent VPS
address_family = both
channels = 5
encoder = software
min_fps = 30
max_fps = 60
hevc_mode = 0
audio_sink =
key_repeat_delay = 500
key_repeat_frequency = 50
origin_web_ui_allowed = lan
SUNCONF

    # Create systemd service for Sunshine
    cat > /etc/systemd/system/sunshine.service << 'SUNSVC'
[Unit]
Description=Sunshine Streaming Server
After=network.target display-manager.service
Requires=display-manager.service

[Service]
Type=simple
ExecStartPre=/bin/bash -c 'for i in $(seq 1 30); do DISPLAY=:0 xdpyinfo >/dev/null 2>&1 && exit 0; sleep 1; done; echo "X11 not ready after 30s" >&2; exit 1'
ExecStart=/usr/bin/sunshine
Restart=always
RestartSec=3
User=ariana
Environment=DISPLAY=:0
Environment=XAUTHORITY=/home/ariana/.Xauthority
Environment=HOME=/home/ariana

[Install]
WantedBy=multi-user.target
SUNSVC
    systemctl daemon-reload
    systemctl enable sunshine
}

# Moonlight Web streaming server (WebRTC bridge for Sunshine -> Browser)
# NOTE: We use our own fork with the renegotiation fix! Binaries are copied at deploy time.
# See: moonlight-fork/ directory for the patched source code
install_moonlight_web() {
    local MOONLIGHT_WEB_DIR="/opt/moonlight-web"

    echo "Preparing Moonlight Web directory (binaries will be deployed separately)..." >&2

    # Create directory structure only - binaries are copied at deploy time from moonlight-fork
    mkdir -p "$MOONLIGHT_WEB_DIR"
    mkdir -p "$MOONLIGHT_WEB_DIR/server"
    mkdir -p "$MOONLIGHT_WEB_DIR/static"

    # Note: ownership set later in Phase 5 after ariana user is created

    echo "Moonlight Web directory prepared (patched binaries deployed at launch)" >&2
}

# Claude Code CLI (npm)
install_claude() {
    npm config set prefix /usr/local
    npm install -g @anthropic-ai/claude-code
    chmod +x /usr/local/bin/claude 2>/dev/null || true
    # Remove npmrc to avoid nvm conflicts - claude is already installed globally
    rm -f /root/.npmrc 2>/dev/null || true
}

# Poetry (official)
install_poetry() {
    curl -sSL https://install.python-poetry.org | python3 -
    ln -sf /root/.local/bin/poetry /usr/local/bin/poetry
}

# pnpm (via npm - avoids wrapper issues)
install_pnpm() {
    npm config set prefix /usr/local
    npm install -g pnpm
    chmod +x /usr/local/bin/pnpm 2>/dev/null || true
    # Remove npmrc to avoid nvm conflicts - pnpm is already installed globally
    rm -f /root/.npmrc 2>/dev/null || true
}

# Ghostty terminal (community-maintained Ubuntu package)
install_ghostty() {
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/mkasberg/ghostty-ubuntu/HEAD/install.sh)"
}

# cmake (official binary)
install_cmake() {
    local CMAKE_VERSION="3.31.3"
    wget -q "https://github.com/Kitware/CMake/releases/download/v${CMAKE_VERSION}/cmake-${CMAKE_VERSION}-linux-x86_64.tar.gz" -O /tmp/cmake.tar.gz
    tar -xzf /tmp/cmake.tar.gz -C /opt/
    ln -sf /opt/cmake-${CMAKE_VERSION}-linux-x86_64/bin/cmake /usr/local/bin/cmake
    ln -sf /opt/cmake-${CMAKE_VERSION}-linux-x86_64/bin/ctest /usr/local/bin/ctest
    ln -sf /opt/cmake-${CMAKE_VERSION}-linux-x86_64/bin/cpack /usr/local/bin/cpack
    rm /tmp/cmake.tar.gz
}

# Start all parallel installs (curl/binary only - NO apt/dpkg jobs here!)
start_job "rust" install_rust
start_job "bun" install_bun
start_job "deno" install_deno
start_job "uv" install_uv
start_job "go" install_go
start_job "nvm" install_nvm
start_job "gradle" install_gradle
start_job "kotlin" install_kotlin
start_job "scala" install_scala
start_job "ruby" install_ruby
start_job "composer" install_composer
start_job "moonlight-web" install_moonlight_web
start_job "claude" install_claude
start_job "poetry" install_poetry
start_job "pnpm" install_pnpm
start_job "cmake" install_cmake

wait_for_jobs || { log_error "Some parallel installs failed, aborting!"; exit 1; }

# These use apt/dpkg so they must run sequentially (dpkg lock contention)
log_info "Installing apt-based tools sequentially..."
install_sunshine && log_success "sunshine completed" || { log_error "sunshine failed"; exit 1; }
install_ghostty && log_success "ghostty completed" || { log_error "ghostty failed"; exit 1; }

# Clean up npmrc to avoid nvm conflicts (might have been created by parallel npm installs)
rm -f /root/.npmrc 2>/dev/null || true

echo "=============================================="
echo "  PHASE 4: nvm Node.js versions"
echo "=============================================="

export NVM_DIR="/root/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

nvm install 24 || log_error "nvm install Node 24 failed"
nvm install 22 || log_error "nvm install Node 22 failed"
nvm alias default 24 || true

log_success "Node.js versions installed via nvm"

echo "=============================================="
echo "  PHASE 5: Create ariana user & permissions"
echo "=============================================="

# Create ariana user
useradd -m -s /bin/bash ariana 2>/dev/null || true

# Add ariana to docker group
usermod -aG docker ariana || true
chown -R ariana:ariana /opt/moonlight-web 2>/dev/null || true

# Set up environment for ariana user
mkdir -p /home/ariana
mkdir -p /home/ariana/.ssh
chmod 700 /home/ariana/.ssh
chown -R ariana:ariana /home/ariana

# Copy nvm to ariana's home directory
cp -r /root/.nvm /home/ariana/.nvm 2>/dev/null || true
chown -R ariana:ariana /home/ariana/.nvm 2>/dev/null || true

# Rust is installed globally to /usr/local/cargo and /usr/local/rustup
# No need to copy to user home - just set environment variables

# Copy uv to ariana's home directory
mkdir -p /home/ariana/.local/bin
cp /usr/local/bin/uv /home/ariana/.local/bin/ 2>/dev/null || true
chown -R ariana:ariana /home/ariana/.local 2>/dev/null || true

# Make tools accessible
chmod 755 /usr/local/bin/deno 2>/dev/null || true
chmod 755 /usr/local/bin/bun 2>/dev/null || true
chmod 755 /usr/local/bin/go 2>/dev/null || true

# Add environment setup to ~/.profile for login shells (used by SSH and automation scripts)
# This is the standard location for PATH exports in login shells
cat >> /home/ariana/.profile <<'PROFILE'

# GUI display settings - ensures GUI apps work from any context
export DISPLAY=${DISPLAY:-:0}
export XAUTHORITY=${XAUTHORITY:-$HOME/.Xauthority}

# Force English locale (Hetzner Germany GeoIP causes German defaults)
export LANG=en_US.UTF-8
export LC_ALL=en_US.UTF-8
export LANGUAGE=en_US:en

# Go
export PATH="/usr/local/go/bin:$PATH"

# Rust toolchain (shared RUSTUP_HOME, user-specific ~/.cargo)
export RUSTUP_HOME="/usr/local/rustup"
export PATH="/usr/local/cargo/bin:$PATH"

# nvm
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

# Local bin (uv, poetry, etc)
export PATH="$HOME/.local/bin:/usr/local/bin:$PATH"
PROFILE
chown ariana:ariana /home/ariana/.profile

# Also add to .bashrc for interactive non-login shells
cat >> /home/ariana/.bashrc <<'BASHRCGUI'

# GUI display settings - ensures GUI apps work from any context
export DISPLAY=${DISPLAY:-:0}
export XAUTHORITY=${XAUTHORITY:-$HOME/.Xauthority}

# Rust toolchain (shared RUSTUP_HOME, user-specific ~/.cargo)
export RUSTUP_HOME="/usr/local/rustup"
export PATH="/usr/local/cargo/bin:$PATH"
BASHRCGUI
chown ariana:ariana /home/ariana/.bashrc

# Add environment setup to root's .bashrc as well
cat >> /root/.bashrc <<'ROOTBASHRC'
# Go
export PATH="/usr/local/go/bin:$PATH"

# Rust toolchain (shared RUSTUP_HOME, user-specific ~/.cargo)
export RUSTUP_HOME="/usr/local/rustup"
export PATH="/usr/local/cargo/bin:$PATH"

# nvm
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

# Local bin (uv, poetry, etc)
export PATH="$HOME/.local/bin:/usr/local/bin:$PATH"
ROOTBASHRC

# Allow ariana user full sudo access without password
echo 'ariana ALL=(ALL) NOPASSWD: ALL' > /etc/sudoers.d/ariana
chmod 0440 /etc/sudoers.d/ariana

# Give ariana full ownership of all dev tool directories
# This ensures ariana can install toolchains, packages, and modify any dev tools
chown -R ariana:ariana /usr/local /opt

# Configure journald for longer log retention
# Default Ubuntu journald rotates too aggressively, causing important
# restore/snapshot logs to be lost within minutes due to polling noise
mkdir -p /etc/systemd/journald.conf.d
cat > /etc/systemd/journald.conf.d/retention.conf <<'JOURNALD'
[Journal]
SystemMaxUse=500M
SystemMaxFileSize=50M
MaxRetentionSec=7day
JOURNALD

log_success "User ariana configured"

echo "=============================================="
echo "  PHASE 6: Helper scripts"
echo "=============================================="

# Create log directory with proper permissions for ariana user
mkdir -p /var/log/agents-server
chown ariana:ariana /var/log/agents-server

# Note: Moonlight Web is now built and configured in install_moonlight_web function
# which is called in PHASE 4 parallel installations

# Start agents server script
cat > /usr/local/bin/start-agents-server <<'EOF'
#!/bin/bash
cd /app
screen -S agents-server -X quit 2>/dev/null || true
screen -dmS agents-server -L -Logfile /var/log/agents-server/server.log bun run start
EOF
chmod +x /usr/local/bin/start-agents-server

# Stop agents server script
cat > /usr/local/bin/stop-agents-server <<'EOF'
#!/bin/bash
screen -S agents-server -X quit 2>/dev/null || true
EOF
chmod +x /usr/local/bin/stop-agents-server

# Patch Chrome launcher to allow running in virtual environment
# Modify /opt/google/chrome/google-chrome to add --no-sandbox flag to the exec line
sed -i 's|exec -a "$0" "$HERE/chrome" "$@"|exec -a "$0" "$HERE/chrome" "$@" --no-sandbox --disable-dev-shm-usage --password-store=basic --lang=en-US|' /opt/google/chrome/google-chrome

# Create ariana Desktop with app shortcuts
mkdir -p /home/ariana/Desktop

# Desktop icons: Chrome, VSCode, Ghostty, GNOME Terminal, File Explorer, Settings
cp /usr/share/applications/google-chrome.desktop /home/ariana/Desktop/
chmod +x /home/ariana/Desktop/google-chrome.desktop

cp /usr/share/applications/code.desktop /home/ariana/Desktop/
chmod +x /home/ariana/Desktop/code.desktop

# Ghostty desktop shortcut (installed via apt, .desktop file should exist)
cp /usr/share/applications/com.mitchellh.ghostty.desktop /home/ariana/Desktop/ 2>/dev/null || true
chmod +x /home/ariana/Desktop/com.mitchellh.ghostty.desktop 2>/dev/null || true

cp /usr/share/applications/org.gnome.Terminal.desktop /home/ariana/Desktop/
chmod +x /home/ariana/Desktop/org.gnome.Terminal.desktop

cp /usr/share/applications/nemo.desktop /home/ariana/Desktop/
chmod +x /home/ariana/Desktop/nemo.desktop

cp /usr/share/applications/org.gnome.Settings.desktop /home/ariana/Desktop/ 2>/dev/null || \
    cp /usr/share/applications/budgie-control-center.desktop /home/ariana/Desktop/ 2>/dev/null || true
chmod +x /home/ariana/Desktop/org.gnome.Settings.desktop 2>/dev/null || true
chmod +x /home/ariana/Desktop/budgie-control-center.desktop 2>/dev/null || true

# Allow launching all desktop files (mark as trusted)
for f in /home/ariana/Desktop/*.desktop; do
    gio set "$f" metadata::trusted true 2>/dev/null || true
done

# Configure Plank dock to have apps pinned (for ariana user)
mkdir -p /home/ariana/.config/plank/dock1/launchers
cat > /home/ariana/.config/plank/dock1/launchers/google-chrome.dockitem <<'DOCKITEM'
[PlankDockItemPreferences]
Launcher=file:///usr/share/applications/google-chrome.desktop
DOCKITEM

cat > /home/ariana/.config/plank/dock1/launchers/org.gnome.Terminal.dockitem <<'DOCKITEM'
[PlankDockItemPreferences]
Launcher=file:///usr/share/applications/org.gnome.Terminal.desktop
DOCKITEM

cat > /home/ariana/.config/plank/dock1/launchers/org.gnome.Nautilus.dockitem <<'DOCKITEM'
[PlankDockItemPreferences]
Launcher=file:///usr/share/applications/org.gnome.Nautilus.desktop
DOCKITEM

cat > /home/ariana/.config/plank/dock1/launchers/code.dockitem <<'DOCKITEM'
[PlankDockItemPreferences]
Launcher=file:///usr/share/applications/code.desktop
DOCKITEM

cat > /home/ariana/.config/plank/dock1/launchers/ghostty.dockitem <<'DOCKITEM'
[PlankDockItemPreferences]
Launcher=file:///usr/share/applications/com.mitchellh.ghostty.desktop
DOCKITEM

# Note: ownership of plank config will be fixed by final chown -R at end of Phase 7

# Update desktop database
update-desktop-database /usr/share/applications/ 2>/dev/null || true

log_success "Helper scripts created"

echo "=============================================="
echo "  PHASE 7: Desktop environment permissions"
echo "=============================================="

# Configure desktop environment for ariana user
# This ensures theme, background, and keyboard settings work properly

# Create all necessary user directories and XDG directories in one place
mkdir -p /home/ariana/Desktop /home/ariana/Downloads /home/ariana/Documents
mkdir -p /home/ariana/Pictures /home/ariana/Videos /home/ariana/Music
mkdir -p /home/ariana/.config/autostart /home/ariana/.config/dconf
mkdir -p /home/ariana/.config/gtk-3.0 /home/ariana/.config/gtk-4.0
mkdir -p /home/ariana/.local/share/applications /home/ariana/.local/share/backgrounds
mkdir -p /home/ariana/.local/share/icons /home/ariana/.local/share/themes
mkdir -p /home/ariana/.local/share/fonts /home/ariana/.cache

# Create .Xauthority file for ariana (needed for X11 authentication)
touch /home/ariana/.Xauthority

# Configure X11 for 1920x1080 virtual display (default resolution)
mkdir -p /etc/X11/xorg.conf.d
cat > /etc/X11/xorg.conf.d/10-virtual-display.conf <<'XORGCONF'
Section "Device"
    Identifier  "Configured Video Device"
    Driver      "dummy"
    VideoRam    256000
EndSection

Section "Monitor"
    Identifier  "Configured Monitor"
    HorizSync   30.0-90.0
    VertRefresh 50.0-75.0
    # 1920x1080 @ 60Hz (CVT modeline)
    Modeline "1920x1080_60.00"  173.00  1920 2048 2248 2576  1080 1083 1088 1120 -hsync +vsync
EndSection

Section "Screen"
    Identifier  "Default Screen"
    Monitor     "Configured Monitor"
    Device      "Configured Video Device"
    DefaultDepth 24
    SubSection "Display"
        Depth 24
        Modes "1920x1080_60.00"
        Virtual 1920 1080
    EndSubSection
EndSection
XORGCONF

log_success "X11 configured for 1920x1080 resolution"

# Configure Google Chrome to skip first-run setup and use English
# This creates the default preferences that Chrome uses on first launch
mkdir -p /home/ariana/.config/google-chrome/Default
cat > /home/ariana/.config/google-chrome/Default/Preferences <<'CHROMEPREFS'
{
  "browser": {
    "has_seen_welcome_page": true,
    "should_reset_check_default_browser": false,
    "check_default_browser": false
  },
  "distribution": {
    "import_bookmarks": false,
    "import_history": false,
    "import_search_engine": false,
    "suppress_first_run_bubble": true,
    "suppress_first_run_default_browser_prompt": true,
    "skip_first_run_ui": true,
    "make_chrome_default_for_user": false
  },
  "first_run_tabs": [],
  "intl": {
    "accept_languages": "en-US,en",
    "selected_languages": "en-US,en"
  },
  "translate": {
    "enabled": false
  },
  "translate_blocked_languages": ["de", "fr", "es", "it", "pt", "nl", "pl", "ru", "ja", "zh", "ko"],
  "default_search_provider_data": {
    "template_url_data": {
      "keyword": "google.com"
    }
  },
  "search": {
    "suggest_enabled": true
  },
  "signin": {
    "allowed": true
  },
  "sync_promo": {
    "show_on_first_run_allowed": false
  },
  "profile": {
    "default_content_setting_values": {},
    "password_manager_enabled": false
  },
  "autofill": {
    "profile_enabled": false,
    "credit_card_enabled": false
  },
  "credentials_enable_service": false,
  "credentials_enable_autosignin": false
}
CHROMEPREFS

# Set Chrome managed policy to force English (survives profile resets and updates)
mkdir -p /etc/opt/chrome/policies/managed
cat > /etc/opt/chrome/policies/managed/locale.json <<'CHROMEPOLICY'
{
  "ApplicationLocaleValue": "en-US",
  "SpellcheckLanguage": ["en-US"]
}
CHROMEPOLICY

# Create First Run file to indicate Chrome has been set up
touch "/home/ariana/.config/google-chrome/First Run"

# Create Local State file with language settings
cat > /home/ariana/.config/google-chrome/Local\ State <<'LOCALSTATE'
{
  "intl": {
    "app_locale": "en-US"
  },
  "browser": {
    "enabled_labs_experiments": []
  }
}
LOCALSTATE

log_success "Chrome configured for English and first-run skipped"

# Disable GNOME Keyring unlock prompt on login
# This prevents the annoying "Enter password to unlock keyring" popup
# We create an empty default keyring with no password
mkdir -p /home/ariana/.local/share/keyrings
cat > /home/ariana/.local/share/keyrings/default <<'KEYRING'
default
KEYRING
# Create an unlocked default keyring (empty, no password required)
cat > /home/ariana/.local/share/keyrings/Default_keyring.keyring <<'KEYRINGFILE'
[keyring]
display-name=Default keyring
ctime=0
mtime=0
lock-on-idle=false
lock-after=false
KEYRINGFILE
chmod 600 /home/ariana/.local/share/keyrings/Default_keyring.keyring

# Also disable keyring via autostart override
mkdir -p /home/ariana/.config/autostart
cat > /home/ariana/.config/autostart/gnome-keyring-secrets.desktop <<'KEYRINGAUTO'
[Desktop Entry]
Type=Application
Hidden=true
KEYRINGAUTO
cat > /home/ariana/.config/autostart/gnome-keyring-ssh.desktop <<'KEYRINGAUTO'
[Desktop Entry]
Type=Application
Hidden=true
KEYRINGAUTO

log_success "GNOME Keyring auto-unlock configured"

# Enable nemo-desktop to manage desktop icons
# Budgie doesn't show desktop icons by default - nemo-desktop handles this
cat > /home/ariana/.config/autostart/nemo-desktop.desktop <<'NEMOAUTO'
[Desktop Entry]
Type=Application
Name=Nemo Desktop
Comment=Show desktop icons managed by Nemo
Exec=nemo-desktop
AutostartCondition=GSettings org.nemo.desktop show-desktop-icons
X-GNOME-Autostart-Phase=Desktop
X-GNOME-AutoRestart=true
NoDisplay=true
NEMOAUTO

log_success "Nemo desktop icons autostart configured"

# Disable screensaver and lock screen completely
# This prevents the password prompt when connecting via RustDesk after idle
# We use dconf database to set these at system level (before user session starts)
mkdir -p /etc/dconf/profile
cat > /etc/dconf/profile/user <<'DCONFPROFILE'
user-db:user
system-db:local
DCONFPROFILE

mkdir -p /etc/dconf/db/local.d
cat > /etc/dconf/db/local.d/00-disable-lockscreen <<'DCONFLOCKSCREEN'
[org/gnome/desktop/screensaver]
lock-enabled=false
idle-activation-enabled=false
ubuntu-lock-on-suspend=false

[org/gnome/desktop/session]
idle-delay=uint32 0

[org/gnome/desktop/lockdown]
disable-lock-screen=true

[org/nemo/desktop]
show-desktop-icons=true
DCONFLOCKSCREEN

# Create locks to prevent user from changing these settings (optional but recommended)
mkdir -p /etc/dconf/db/local.d/locks
cat > /etc/dconf/db/local.d/locks/lockscreen <<'DCONFLOCKS'
/org/gnome/desktop/screensaver/lock-enabled
/org/gnome/desktop/screensaver/idle-activation-enabled
/org/gnome/desktop/screensaver/ubuntu-lock-on-suspend
/org/gnome/desktop/lockdown/disable-lock-screen
DCONFLOCKS

# Update dconf database
dconf update

# Also disable gnome-screensaver autostart
cat > /home/ariana/.config/autostart/gnome-screensaver.desktop <<'SCREENSAVERAUTO'
[Desktop Entry]
Type=Application
Hidden=true
SCREENSAVERAUTO

# Disable Budgie screensaver autostart as well
cat > /home/ariana/.config/autostart/org.buddiesofbudgie.BudgieDesktopScreensaver.desktop <<'SCREENSAVERAUTO'
[Desktop Entry]
Type=Application
Hidden=true
SCREENSAVERAUTO

log_success "Screensaver and lock screen disabled"

echo "=============================================="
echo "  PHASE 7b: Moonlight Desktop Streaming Setup"
echo "=============================================="

# This phase pre-configures everything needed for moonlight desktop streaming
# that doesn't depend on the machine's runtime IP address.
# Runtime-dependent config (TURN password, IP, pairing) is done at deploy time.

# --- 1. Replace gnome-screensaver binary with no-op (CRITICAL for Budgie) ---
# Budgie desktop auto-activates gnome-screensaver via D-Bus even if disabled in settings.
# The screensaver creates a fullscreen window that covers the entire desktop.
# Solution: Replace the binary with a no-op that stays resident but never locks.
log_info "Replacing gnome-screensaver with no-op..."
dpkg-divert --add --rename --divert /usr/bin/gnome-screensaver.real /usr/bin/gnome-screensaver 2>/dev/null || true
cat > /usr/bin/gnome-screensaver << 'NOOP_SC'
#!/bin/bash
# No-op gnome-screensaver replacement for moonlight streaming
# Stays resident on D-Bus but never activates the lock screen
while true; do sleep 3600; done
NOOP_SC
chmod +x /usr/bin/gnome-screensaver

# --- 2. Replace gnome-screensaver-dialog with instant-exit no-op ---
dpkg-divert --add --rename --divert /usr/libexec/gnome-screensaver-dialog.real /usr/libexec/gnome-screensaver-dialog 2>/dev/null || true
cat > /usr/libexec/gnome-screensaver-dialog << 'NOOP_DLG'
#!/bin/bash
# No-op: immediately exit with success (unlock)
exit 0
NOOP_DLG
chmod +x /usr/libexec/gnome-screensaver-dialog

# --- 3. Extended dconf settings for moonlight streaming ---
# Add power management settings to prevent any sleep/dimming
cat >> /etc/dconf/db/local.d/00-disable-lockscreen << 'DCONF_POWER'

[org/gnome/settings-daemon/plugins/power]
sleep-inactive-ac-type='nothing'
sleep-inactive-battery-type='nothing'
idle-dim=false
DCONF_POWER

# Lock power settings too
cat >> /etc/dconf/db/local.d/locks/lockscreen << 'DCONF_POWER_LOCKS'
/org/gnome/settings-daemon/plugins/power/sleep-inactive-ac-type
/org/gnome/settings-daemon/plugins/power/sleep-inactive-battery-type
/org/gnome/settings-daemon/plugins/power/idle-dim
DCONF_POWER_LOCKS

dconf update

# --- 4. Mask system sleep/suspend/hibernate ---
log_info "Masking sleep/suspend/hibernate targets..."
systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target 2>/dev/null || true

# --- 5. Remove ariana user password (prevents lock screen from blocking) ---
log_info "Removing ariana user password..."
passwd -d ariana 2>/dev/null || true

# --- 6. Install coturn and xclip (for TURN relay and clipboard) ---
log_info "Installing coturn and xclip..."
apt-get install -y -qq coturn xclip wmctrl

# --- 7. Install PulseAudio (for audio streaming) ---
log_info "Installing PulseAudio..."
apt-get install -y -qq pulseaudio pulseaudio-utils

# --- 8. Configure PulseAudio with Sunshine audio sink ---
mkdir -p /home/ariana/.config/pulse
cat > /home/ariana/.config/pulse/default.pa << 'PULSECONF'
.include /etc/pulse/default.pa
load-module module-null-sink sink_name=SunshineSink sink_properties=device.description="Sunshine_Audio"
set-default-sink SunshineSink
PULSECONF
chown -R ariana:ariana /home/ariana/.config/pulse

# --- 9. Pre-configure Sunshine (static parts only) ---
# SSL certs and credentials are generated at deploy time
log_info "Pre-configuring Sunshine..."
mkdir -p /home/ariana/.config/sunshine
cat > /home/ariana/.config/sunshine/sunshine.conf << 'SUNCONF'
capture = x11
min_log_level = 2
origin_web_ui_allowed = wan
upnp = off
address_family = ipv4
port = 47989
pkey = /home/ariana/.config/sunshine/sunshine.key
cert = /home/ariana/.config/sunshine/sunshine.cert
audio_sink = SunshineSink.monitor
SUNCONF
chown -R ariana:ariana /home/ariana/.config/sunshine

# --- 10. Create systemd service files for moonlight streaming ---
log_info "Creating moonlight streaming systemd services..."

cat > /etc/systemd/system/sunshine.service << 'SVCEOF'
[Unit]
Description=Sunshine Streaming Server
After=network.target display-manager.service
Requires=display-manager.service

[Service]
Type=simple
# Wait for X11 display to be ready before starting Sunshine.
# After a fork (fresh boot from snapshot), systemd's After=display-manager.service
# doesn't guarantee DISPLAY=:0 is responding — LightDM may be "active" before X11
# finishes initializing. This causes Sunshine to fail with "Unable to initialize
# capture method" and all encoders fail because there's no display to capture.
ExecStartPre=/bin/bash -c 'for i in $(seq 1 30); do DISPLAY=:0 xdpyinfo >/dev/null 2>&1 && exit 0; sleep 1; done; echo "X11 not ready after 30s" >&2; exit 1'
ExecStart=/usr/bin/sunshine
Restart=always
RestartSec=3
User=ariana
Environment=DISPLAY=:0
Environment=XAUTHORITY=/home/ariana/.Xauthority
Environment=HOME=/home/ariana

[Install]
WantedBy=multi-user.target
SVCEOF

cat > /etc/systemd/system/moonlight-web.service << 'SVCEOF'
[Unit]
Description=Moonlight Web Streaming Server
After=network.target sunshine.service

[Service]
Type=simple
WorkingDirectory=/opt/moonlight-web
Environment=RUST_LOG=info
ExecStart=/opt/moonlight-web/web-server --config-path server/config.json
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
SVCEOF

cat > /etc/systemd/system/xdotool-server.service << 'SVCEOF'
[Unit]
Description=Xdotool Keyboard Input Server
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/moonlight-web
Environment=DISPLAY=:0
Environment=XAUTHORITY=/home/ariana/.Xauthority
ExecStart=/usr/bin/python3 /opt/moonlight-web/xdotool-server.py
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
SVCEOF

systemctl daemon-reload

# --- 11. Pre-open firewall ports for moonlight streaming ---
log_info "Opening firewall ports for moonlight streaming..."
ufw allow 8090/tcp comment "Moonlight Web Server"
ufw allow 3478/tcp comment "TURN TCP"
ufw allow 3478/udp comment "TURN UDP"
ufw allow 47989:47990/tcp comment "Sunshine API"
ufw allow 47998:48010/udp comment "Sunshine Streaming"
ufw allow 49152:65535/udp comment "TURN Relay Ports"

log_success "Moonlight desktop streaming pre-configuration complete"

# Configure lightdm to auto-login as ariana and set up proper session
cat > /etc/lightdm/lightdm.conf.d/50-ariana.conf <<'LIGHTDMCONF'
[Seat:*]
autologin-user=ariana
autologin-user-timeout=0
user-session=budgie-desktop
greeter-session=lightdm-gtk-greeter
LIGHTDMCONF

# Set up PolicyKit rule to allow ariana to change system settings
mkdir -p /etc/polkit-1/localauthority/50-local.d
cat > /etc/polkit-1/localauthority/50-local.d/10-ariana-settings.pkla <<'POLKITCONF'
[Allow ariana to change system settings]
Identity=unix-user:ariana
Action=org.freedesktop.locale1.*;org.freedesktop.hostname1.*;org.gnome.controlcenter.*;org.gnome.settings-daemon.*
ResultAny=yes
ResultInactive=yes
ResultActive=yes
POLKITCONF

# Create an Xsession.d script to fix permissions on login
cat > /etc/X11/Xsession.d/99-fix-ariana-permissions <<'XSESSIONFIX'
# Ensure ariana owns their home directory config files on each login
# This handles any files that might have been created by root
if [ "$(whoami)" = "ariana" ]; then
    # Fix ownership of config directories if owned by root
    for dir in ~/.config ~/.local ~/.cache; do
        if [ -d "$dir" ] && [ "$(stat -c '%U' "$dir" 2>/dev/null)" = "root" ]; then
            sudo chown -R ariana:ariana "$dir" 2>/dev/null || true
        fi
    done
fi
XSESSIONFIX
chmod +x /etc/X11/Xsession.d/99-fix-ariana-permissions

# Final ownership fix for entire ariana home directory
chown -R ariana:ariana /home/ariana

log_success "Desktop environment configured"

echo "=============================================="
echo "  PHASE 8: Firewall"
echo "=============================================="

ufw allow 22/tcp
ufw allow 8911/tcp
# Note: Moonlight streaming ports (8090, 3478, 47989-47990, 47998-48010, 49152-65535)
# are already configured in Phase 7b above
ufw --force enable

# Block Docker-published ports by default (Docker bypasses ufw, DOCKER-USER does not)
mkdir -p /etc/systemd/system/docker.service.d
cat > /etc/systemd/system/docker.service.d/firewall.conf << 'EOF'
[Service]
ExecStartPost=/sbin/iptables -I DOCKER-USER -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN
ExecStartPost=/sbin/iptables -A DOCKER-USER -i eth0 -m conntrack --ctstate NEW -j DROP
EOF
systemctl daemon-reload

# Apply now if Docker is running
if systemctl is-active --quiet docker; then
    iptables -I DOCKER-USER -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN 2>/dev/null || true
    iptables -A DOCKER-USER -i eth0 -m conntrack --ctstate NEW -j DROP 2>/dev/null || true
fi

log_success "Firewall configured"

echo "=============================================="
echo "  PHASE 9: Verify installations"
echo "=============================================="

echo "=== Verifying as root ==="
echo "Docker: $(docker --version 2>/dev/null || echo 'FAILED')"
echo "Node.js: $(node --version 2>/dev/null || echo 'FAILED')"
echo "npm: $(npm --version 2>/dev/null || echo 'FAILED')"
echo "Bun: $(bun --version 2>/dev/null || echo 'FAILED')"
echo "Deno: $(deno --version 2>/dev/null | head -1 || echo 'FAILED')"
echo "Go: $(go version 2>/dev/null || echo 'FAILED')"
echo "Rust: $(rustc --version 2>/dev/null || echo 'FAILED')"
echo "Python: $(python3 --version 2>/dev/null || echo 'FAILED')"
echo "uv: $(uv --version 2>/dev/null || echo 'FAILED')"
echo "Poetry: $(poetry --version 2>/dev/null || echo 'FAILED')"
echo "pnpm: $(pnpm --version 2>/dev/null || echo 'FAILED')"
echo "gh: $(gh --version 2>/dev/null | head -1 || echo 'FAILED')"
echo "Claude: $(claude --version 2>/dev/null || echo 'FAILED')"
echo "R: $(R --version 2>/dev/null | head -1 || echo 'FAILED')"
echo "Ruby: $(ruby --version 2>/dev/null || echo 'FAILED')"
echo "Bundler: $(bundle --version 2>/dev/null || echo 'FAILED')"
echo "PHP: $(php --version 2>/dev/null | head -1 || echo 'FAILED')"
echo "Composer: $(composer --version 2>/dev/null | head -1 || echo 'FAILED')"
echo "Java: $(java --version 2>/dev/null | head -1 || echo 'FAILED')"
echo "Maven: $(mvn --version 2>/dev/null | head -1 || echo 'FAILED')"
echo "Gradle: $(gradle --version 2>/dev/null | grep Gradle || echo 'FAILED')"
echo "Kotlin: $(kotlin -version 2>/dev/null || echo 'FAILED')"
echo "Scala: $(scala --version 2>/dev/null || echo 'FAILED')"
echo "Erlang: $(erl -eval 'erlang:display(erlang:system_info(otp_release)), halt().' -noshell 2>/dev/null || echo 'FAILED')"
echo "Elixir: $(elixir --version 2>/dev/null | head -1 || echo 'FAILED')"
echo ".NET: $(dotnet --version 2>/dev/null || echo 'FAILED')"
echo "GCC: $(gcc --version 2>/dev/null | head -1 || echo 'FAILED')"
echo "CMake: $(cmake --version 2>/dev/null | head -1 || echo 'FAILED')"
echo "SQLite: $(sqlite3 --version 2>/dev/null || echo 'FAILED')"
echo "ffmpeg: $(ffmpeg -version 2>/dev/null | head -1 || echo 'FAILED')"
echo "ImageMagick: $(convert --version 2>/dev/null | head -1 || echo 'FAILED')"
echo "Chrome: $(google-chrome-stable --version 2>/dev/null || echo 'FAILED')"
echo "Restic: $(restic version 2>/dev/null || echo 'FAILED')"
echo "Sunshine: $(sunshine --version 2>/dev/null || echo 'FAILED')"
echo "Ghostty: $(ghostty --version 2>/dev/null || echo 'FAILED')"
echo "Moonlight Web: $([ -d /opt/moonlight-web ] && echo 'Directory prepared (binaries deployed at launch)' || echo 'NOT PREPARED')"

echo ""
echo "=== Verifying as ariana user ==="
sudo -u ariana bash -c '
source /home/ariana/.bashrc
echo "Docker: $(docker --version 2>/dev/null || echo FAILED)"
echo "Go: $(go version 2>/dev/null || echo FAILED)"
echo "Rust: $(rustc --version 2>/dev/null || echo FAILED)"
echo "Node (nvm): $(node --version 2>/dev/null || echo FAILED)"
echo "Bun: $(bun --version 2>/dev/null || echo FAILED)"
echo "Deno: $(deno --version 2>/dev/null | head -1 || echo FAILED)"
echo "Python: $(python3 --version 2>/dev/null || echo FAILED)"
echo "uv: $(uv --version 2>/dev/null || echo FAILED)"
'

echo ""
echo "=============================================="
echo "  CRITICAL VERIFICATION"
echo "=============================================="

# These MUST exist or the image is broken
CRITICAL_FAILED=0

if ! which sunshine >/dev/null 2>&1; then
    log_error "CRITICAL: sunshine binary not found"
    CRITICAL_FAILED=1
fi

# Note: moonlight-web binaries are deployed at launch time from our fork
if [ ! -d /opt/moonlight-web ]; then
    log_error "CRITICAL: moonlight-web directory not found"
    CRITICAL_FAILED=1
fi

if ! which claude >/dev/null 2>&1; then
    log_error "CRITICAL: claude CLI not found"
    CRITICAL_FAILED=1
fi

if ! which docker >/dev/null 2>&1; then
    log_error "CRITICAL: docker not found"
    CRITICAL_FAILED=1
fi

if [ $CRITICAL_FAILED -eq 1 ]; then
    log_error "Critical components missing - image build FAILED"
    exit 1
fi

log_success "All critical components verified"

echo ""
echo "=============================================="
echo "  INSTALLATION COMPLETE!"
echo "=============================================="
echo ""
echo "Logs available in: $LOG_DIR"
echo ""
