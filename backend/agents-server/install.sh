#!/bin/bash
set -e

# Ariana Agents Server - Installation Script
# This script downloads and installs the Ariana agent server on your machine

REGISTRATION_TOKEN="$1"
INSTALL_DIR="/opt/ariana-agent"
GITHUB_REPO="ariana-dot-dev/agent-server"
AGENTS_SERVER_VERSION="${AGENTS_SERVER_VERSION:-latest}"
API_URL="${API_URL:-https://ariana.dev}"
# Set ARIANA_PORT with single default fallback at entry point
ARIANA_PORT="${ARIANA_PORT:-8911}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Print functions
print_error() {
  echo -e "${RED}❌ Error: $1${NC}" >&2
}

print_success() {
  echo -e "${GREEN}✅ $1${NC}"
}

print_info() {
  echo -e "${BLUE}ℹ️  $1${NC}"
}

print_warning() {
  echo -e "${YELLOW}⚠️  $1${NC}"
}

print_step() {
  echo ""
  echo -e "${BLUE}━━━ $1 ━━━${NC}"
  echo ""
}

# Validate token
if [ -z "$REGISTRATION_TOKEN" ]; then
  print_error "Registration token required"
  echo ""
  echo "Usage: curl -fsSL https://install.ariana.dev | bash -s -- <token>"
  echo ""
  echo "Get your registration token from: https://app.ariana.dev/settings/machines"
  exit 1
fi

# Check if running as root (needed for installing to /opt and /usr/local)
if [ "$EUID" -ne 0 ]; then
  print_warning "This script requires sudo/root access"
  echo "Attempting to re-run with sudo..."
  exec sudo bash "$0" "$@"
fi

# Determine the actual user (not root) for ownership
if [ -n "$SUDO_USER" ]; then
  RUN_AS_USER="$SUDO_USER"
  USER_HOME=$(eval echo ~$SUDO_USER)
else
  RUN_AS_USER="$(whoami)"
  USER_HOME="$HOME"
fi

print_step "🚀 Installing Ariana Agents Server"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Step 1: Detect Platform
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

detect_platform() {
  OS="$(uname -s)"
  ARCH="$(uname -m)"

  case "$OS" in
    Linux*)  OS_TYPE="linux" ;;
    Darwin*) OS_TYPE="darwin" ;;
    *)
      print_error "Unsupported OS: $OS"
      exit 1
      ;;
  esac

  case "$ARCH" in
    x86_64)  ARCH_TYPE="x64" ;;
    aarch64|arm64) ARCH_TYPE="arm64" ;;
    *)
      print_error "Unsupported architecture: $ARCH"
      exit 1
      ;;
  esac

  PLATFORM="${OS_TYPE}-${ARCH_TYPE}"
  print_info "Detected platform: $PLATFORM"

  # Detect if running in a container
  IN_CONTAINER=false
  if [ -f /.dockerenv ] || grep -qi docker /proc/1/cgroup 2>/dev/null || grep -qi lxc /proc/1/cgroup 2>/dev/null; then
    IN_CONTAINER=true
    print_info "Detected container environment"
  fi
}

detect_platform

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Step 2: Detect Machine Specs
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

detect_specs() {
  print_step "📊 Detecting Machine Specifications"

  HOSTNAME="$(hostname)"
  print_info "Hostname: $HOSTNAME"

  # CPU count
  if command -v nproc &> /dev/null; then
    CPU_COUNT=$(nproc)
  elif [ "$OS_TYPE" = "darwin" ]; then
    CPU_COUNT=$(sysctl -n hw.ncpu)
  else
    CPU_COUNT=1
  fi
  print_info "CPU cores: $CPU_COUNT"

  # Memory in GB
  if command -v free &> /dev/null; then
    MEMORY_GB=$(free -g | awk '/^Mem:/{print $2}')
  elif [ "$OS_TYPE" = "darwin" ]; then
    MEMORY_BYTES=$(sysctl -n hw.memsize)
    MEMORY_GB=$((MEMORY_BYTES / 1024 / 1024 / 1024))
  else
    MEMORY_GB=0
  fi
  print_info "Memory: ${MEMORY_GB}GB"

  # Public IP
  # Check if LOCAL_IP is set (for local development)
  if [ -n "$LOCAL_IP" ]; then
    PUBLIC_IP="$LOCAL_IP"
    print_info "Using LOCAL_IP: $PUBLIC_IP"
  else
    print_info "Detecting public IP..."
    # Force IPv4 with -4 flag to avoid getting IPv6 addresses
    PUBLIC_IP=$(curl -4 -s --max-time 5 ifconfig.me || curl -4 -s --max-time 5 icanhazip.com || curl -4 -s --max-time 5 api.ipify.org || echo "unknown")

    if [ "$PUBLIC_IP" = "unknown" ]; then
      print_warning "Could not detect public IP"
      print_warning "Make sure your machine is accessible from the internet"
    else
      print_info "Public IP: $PUBLIC_IP"
    fi
  fi

  # OS version
  if [ -f /etc/os-release ]; then
    OS_VERSION=$(grep '^PRETTY_NAME=' /etc/os-release | cut -d'"' -f2)
  elif [ "$OS_TYPE" = "darwin" ]; then
    OS_VERSION="macOS $(sw_vers -productVersion)"
  else
    OS_VERSION="$(uname -s)"
  fi
  print_info "OS: $OS_VERSION"
}

detect_specs

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Step 2.5: Configure Work Directory
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

configure_work_dir() {
  print_step "📁 Configure Work Directory"

  # Get the directory from which the script was invoked (before sudo)
  if [ -n "$SUDO_USER" ]; then
    DEFAULT_WORK_DIR=$(eval echo ~$SUDO_USER)
  else
    DEFAULT_WORK_DIR="$HOME"
  fi

  # Try to use PWD if available (for piped installs from specific directory)
  if [ -n "$PWD" ] && [ "$PWD" != "/" ] && [ "$PWD" != "$HOME" ]; then
    DEFAULT_WORK_DIR="$PWD"
  fi

  # Check if WORK_DIR is set via environment (for non-interactive installs)
  if [ -n "$WORK_DIR" ]; then
    AGENT_WORK_DIR="$WORK_DIR"
    print_info "Using WORK_DIR from environment: $AGENT_WORK_DIR"
  else
    print_info "This is where Ariana will clone repositories and run agents."
    echo ""
    read -p "Work directory [$DEFAULT_WORK_DIR]: " USER_WORK_DIR
    AGENT_WORK_DIR="${USER_WORK_DIR:-$DEFAULT_WORK_DIR}"
  fi

  # Expand ~ if present
  AGENT_WORK_DIR="${AGENT_WORK_DIR/#\~/$HOME}"

  # Create directory if it doesn't exist
  if [ ! -d "$AGENT_WORK_DIR" ]; then
    print_info "Creating directory: $AGENT_WORK_DIR"
    mkdir -p "$AGENT_WORK_DIR"
  fi

  print_success "Work directory: $AGENT_WORK_DIR"
}

configure_work_dir

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Step 3: Register Machine with Ariana API
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

register_machine() {
  print_step "📡 Registering Machine with Ariana"

  # Write response to temp file to avoid shell escaping issues
  RESPONSE_FILE=$(mktemp)

  curl -s -X POST "$API_URL/api/machines/register" \
    -H "Content-Type: application/json" \
    -d "{\"registrationToken\":\"$REGISTRATION_TOKEN\",\"machineInfo\":{\"name\":\"$HOSTNAME\",\"os\":\"$OS_VERSION\",\"arch\":\"$ARCH\",\"cpuCount\":$CPU_COUNT,\"memoryGB\":$MEMORY_GB,\"publicIP\":\"$PUBLIC_IP\",\"port\":$ARIANA_PORT}}" \
    -o "$RESPONSE_FILE"

  RESPONSE=$(cat "$RESPONSE_FILE")

  # Check if jq is available
  if ! command -v jq &> /dev/null; then
    # Fallback to basic parsing
    MACHINE_ID=$(echo "$RESPONSE" | grep -o '"machineId":"[^"]*"' | cut -d'"' -f4)
    SHARED_KEY=$(echo "$RESPONSE" | grep -o '"sharedKey":"[^"]*"' | cut -d'"' -f4)
  else
    MACHINE_ID=$(echo "$RESPONSE" | jq -r '.machineId')
    SHARED_KEY=$(echo "$RESPONSE" | jq -r '.sharedKey')
  fi

  rm -f "$RESPONSE_FILE"

  if [ "$MACHINE_ID" = "null" ] || [ -z "$MACHINE_ID" ]; then
    print_error "Registration failed"
    echo "Response: $RESPONSE"
    echo ""
    echo "Possible reasons:"
    echo "  - Invalid or expired registration token"
    echo "  - API server unreachable"
    echo "  - Machine already registered"
    exit 1
  fi

  print_success "Machine registered: $MACHINE_ID"
}

register_machine

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Step 3.5: Install System Dependencies
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

install_system_deps() {
  print_step "📦 Installing System Dependencies"

  if [ "$OS_TYPE" = "linux" ]; then
    # Install network tools (ss/netstat for port monitoring)
    if ! command -v ss &> /dev/null && ! command -v netstat &> /dev/null; then
      if command -v apt-get &> /dev/null; then
        print_info "Installing iproute2 (ss command)..."
        apt-get update -qq && apt-get install -y -qq iproute2
      elif command -v yum &> /dev/null; then
        print_info "Installing iproute (ss command)..."
        yum install -y -q iproute
      elif command -v apk &> /dev/null; then
        print_info "Installing iproute2..."
        apk add --quiet iproute2
      fi

      if command -v ss &> /dev/null; then
        print_success "Network tools installed"
      else
        print_warning "Could not install network tools - port monitoring may be limited"
      fi
    else
      print_success "Network tools already available"
    fi
  fi
}

install_system_deps

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Step 3.7: Install Git
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

install_git() {
  print_step "📦 Installing Git"

  if command -v git &> /dev/null; then
    print_success "Git already installed ($(git --version))"
    return
  fi

  if [ "$OS_TYPE" = "linux" ]; then
    # Ubuntu/Debian
    if command -v apt-get &> /dev/null; then
      print_info "Installing via apt..."
      apt-get update -qq
      apt-get install -y -qq git
    # RedHat/CentOS/Fedora
    elif command -v yum &> /dev/null; then
      print_info "Installing via yum..."
      yum install -y -q git
    else
      print_warning "Could not install git automatically"
      print_warning "Please install manually: https://git-scm.com/"
    fi
  elif [ "$OS_TYPE" = "darwin" ]; then
    if command -v brew &> /dev/null; then
      print_info "Installing via Homebrew..."
      # Run brew as the actual user, not as root
      if [ -n "$SUDO_USER" ]; then
        sudo -u "$SUDO_USER" brew install git
      else
        brew install git
      fi
    else
      print_warning "Homebrew not found"
      print_warning "Please install git manually: https://git-scm.com/"
    fi
  fi

  if command -v git &> /dev/null; then
    print_success "Git installed"
  else
    print_warning "Git not installed - some features may not work"
  fi
}

install_git

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Step 4: Install GitHub CLI
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

install_gh_cli() {
  print_step "📦 Installing GitHub CLI"

  if command -v gh &> /dev/null; then
    print_success "GitHub CLI already installed ($(gh --version | head -1))"
    return
  fi

  if [ "$OS_TYPE" = "linux" ]; then
    # Ubuntu/Debian
    if command -v apt-get &> /dev/null; then
      print_info "Installing via apt..."
      mkdir -p -m 755 /etc/apt/keyrings
      wget -nv -O /tmp/gh-keyring.gpg https://cli.github.com/packages/githubcli-archive-keyring.gpg 2>&1 | grep -v "saving to"
      cat /tmp/gh-keyring.gpg > /etc/apt/keyrings/githubcli-archive-keyring.gpg
      chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg
      echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list
      apt-get update -qq
      apt-get install -y -qq gh
      rm /tmp/gh-keyring.gpg
    # RedHat/CentOS/Fedora
    elif command -v yum &> /dev/null; then
      print_info "Installing via yum..."
      yum-config-manager --add-repo https://cli.github.com/packages/rpm/gh-cli.repo
      yum install -y -q gh
    else
      print_warning "Could not install GitHub CLI automatically"
      print_warning "Please install manually: https://github.com/cli/cli#installation"
    fi
  elif [ "$OS_TYPE" = "darwin" ]; then
    if command -v brew &> /dev/null; then
      print_info "Installing via Homebrew..."
      # Run brew as the actual user, not as root
      if [ -n "$SUDO_USER" ]; then
        sudo -u "$SUDO_USER" brew install gh
      else
        brew install gh
      fi
    else
      print_warning "Homebrew not found"
      print_warning "Please install GitHub CLI manually: https://github.com/cli/cli#installation"
    fi
  fi

  if command -v gh &> /dev/null; then
    print_success "GitHub CLI installed"
  else
    print_warning "GitHub CLI not installed - some features may not work"
  fi
}

install_gh_cli

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Step 4.2: Install Node.js/npm
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

install_nodejs() {
  # Check if npm is already installed
  if command -v npm &> /dev/null; then
    print_info "Node.js/npm already installed ($(node --version 2>/dev/null || echo 'version unknown'))"
    return
  fi

  print_step "📦 Installing Node.js/npm"

  if [ "$OS_TYPE" = "linux" ]; then
    # Detect Linux distribution
    if [ -f /etc/os-release ]; then
      . /etc/os-release
      DISTRO=$ID
    else
      print_warning "Cannot detect Linux distribution - skipping Node.js installation"
      return
    fi

    if [[ "$DISTRO" == "ubuntu" ]] || [[ "$DISTRO" == "debian" ]]; then
      print_info "Installing Node.js via apt..."
      # Install Node.js LTS from NodeSource
      curl -fsSL https://deb.nodesource.com/setup_lts.x | bash -
      apt-get install -y nodejs
    elif [[ "$DISTRO" == "centos" ]] || [[ "$DISTRO" == "rhel" ]] || [[ "$DISTRO" == "fedora" ]]; then
      print_info "Installing Node.js via yum/dnf..."
      # Install Node.js LTS from NodeSource
      curl -fsSL https://rpm.nodesource.com/setup_lts.x | bash -
      yum install -y nodejs || dnf install -y nodejs
    else
      print_warning "Unsupported Linux distribution: $DISTRO"
      print_warning "Please install Node.js manually: https://nodejs.org/"
      return
    fi
  elif [ "$OS_TYPE" = "darwin" ]; then
    if command -v brew &> /dev/null; then
      print_info "Installing Node.js via Homebrew..."
      brew install node
    else
      print_warning "Homebrew not found"
      print_warning "Please install Node.js manually: https://nodejs.org/"
      return
    fi
  fi

  # Verify installation
  if command -v npm &> /dev/null; then
    print_success "Node.js/npm installed ($(node --version 2>/dev/null || echo 'version unknown'))"
  else
    print_warning "Node.js/npm installation may have failed"
    print_warning "Please install manually: https://nodejs.org/"
  fi
}

install_nodejs

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Step 4.5: Install Claude Code CLI
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

install_claude_code() {
  print_step "🤖 Installing Claude Code CLI"

  # Check if already installed
  if command -v claude &> /dev/null; then
    print_success "Claude Code CLI already installed ($(claude --version 2>/dev/null || echo 'version unknown'))"
    CLAUDE_PATH=$(which claude)
    print_info "Claude path: $CLAUDE_PATH"
    return
  fi

  # Check for npm (should be installed by install_nodejs)
  if ! command -v npm &> /dev/null; then
    print_warning "npm not found - cannot install Claude Code CLI automatically"
    print_warning "Please install Node.js/npm first, then run: npm install -g @anthropic-ai/claude-code"
    return
  fi

  print_info "Installing Claude Code CLI via npm..."
  npm install -g @anthropic-ai/claude-code

  if command -v claude &> /dev/null; then
    CLAUDE_PATH=$(which claude)
    print_success "Claude Code CLI installed at: $CLAUDE_PATH"

    # Create symlink at /usr/local/bin/claude if not already there (matching Hetzner setup)
    if [ "$CLAUDE_PATH" != "/usr/local/bin/claude" ] && [ ! -L "/usr/local/bin/claude" ]; then
      print_info "Creating symlink: /usr/local/bin/claude -> $CLAUDE_PATH"
      ln -sf "$CLAUDE_PATH" /usr/local/bin/claude
      CLAUDE_PATH="/usr/local/bin/claude"
    fi
  else
    print_warning "Claude Code CLI installation may have failed"
    print_warning "Please install manually: npm install -g @anthropic-ai/claude-code"
  fi
}

install_claude_code

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Step 5: Download and Install Agents Server
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

install_agents_server() {
  # Stop existing service if running
  if [ "$OS_TYPE" = "linux" ] && command -v systemctl &> /dev/null; then
    if systemctl is-active --quiet ariana-agent 2>/dev/null; then
      print_info "Stopping existing ariana-agent service..."
      systemctl stop ariana-agent
      sleep 1  # Wait for process to fully stop
      print_success "Existing service stopped"
    fi
  elif [ "$OS_TYPE" = "darwin" ] && command -v launchctl &> /dev/null; then
    if launchctl list | grep -q com.ariana.agent 2>/dev/null; then
      print_info "Stopping existing ariana-agent service..."
      launchctl bootout system/com.ariana.agent 2>/dev/null || true
      sleep 1  # Wait for process to fully stop
      print_success "Existing service stopped"
    fi
  fi

  # Create install directory
  mkdir -p "$INSTALL_DIR"

  # Check if using local binary
  if [ -n "$BINARY_PATH" ]; then
    print_step "📦 Installing Local Agents Server"

    if [ ! -f "$BINARY_PATH" ]; then
      print_error "Local binary not found at: $BINARY_PATH"
      exit 1
    fi

    print_info "Using local binary: $BINARY_PATH"
    cp "$BINARY_PATH" "$INSTALL_DIR/ariana-agents-server"
    chmod +x "$INSTALL_DIR/ariana-agents-server"
    chown "$RUN_AS_USER" "$INSTALL_DIR/ariana-agents-server"

    print_success "Local agents server installed"
  else
    print_step "📦 Downloading Agents Server"

    # Determine download URL
    if [ "$AGENTS_SERVER_VERSION" = "latest" ]; then
      RELEASE_URL="https://github.com/$GITHUB_REPO/releases/latest/download"
    else
      RELEASE_URL="https://github.com/$GITHUB_REPO/releases/download/agent-server-v${AGENTS_SERVER_VERSION}"
    fi

    BINARY_NAME="ariana-agents-server-${PLATFORM}"
    DOWNLOAD_URL="${RELEASE_URL}/${BINARY_NAME}"

    print_info "Downloading from: $DOWNLOAD_URL"

    # Download binary
    if ! curl -L --fail --progress-bar "$DOWNLOAD_URL" -o "$INSTALL_DIR/ariana-agents-server"; then
      print_error "Failed to download agents server binary"
      echo ""
      echo "URL: $DOWNLOAD_URL"
      echo ""
      echo "Possible reasons:"
      echo "  - Release not yet published"
      echo "  - Network connection issues"
      echo "  - Invalid version specified"
      exit 1
    fi

    # Make executable and set ownership
    chmod +x "$INSTALL_DIR/ariana-agents-server"
    chown "$RUN_AS_USER" "$INSTALL_DIR/ariana-agents-server"

    print_success "Agents server downloaded"
  fi

  # Detect Claude path if not already set
  if [ -z "$CLAUDE_PATH" ]; then
    if command -v claude &> /dev/null; then
      CLAUDE_PATH=$(which claude)
      print_info "Claude detected at: $CLAUDE_PATH"

      # Create symlink at /usr/local/bin/claude if not already there (matching Hetzner setup)
      if [ "$CLAUDE_PATH" != "/usr/local/bin/claude" ] && [ ! -L "/usr/local/bin/claude" ]; then
        print_info "Creating symlink: /usr/local/bin/claude -> $CLAUDE_PATH"
        ln -sf "$CLAUDE_PATH" /usr/local/bin/claude
        CLAUDE_PATH="/usr/local/bin/claude"
      fi
    else
      CLAUDE_PATH="/usr/local/bin/claude"
      print_warning "Claude not found - using default path: $CLAUDE_PATH"
    fi
  fi

  # Create .env file
  cat > "$INSTALL_DIR/.env" <<EOF
MACHINE_ID=$MACHINE_ID
SHARED_KEY=$SHARED_KEY
ARIANA_PORT=$ARIANA_PORT
WORK_DIR=$AGENT_WORK_DIR
CLAUDE_PATH=${CLAUDE_PATH:-/usr/local/bin/claude}
IS_SANDBOX=1
EOF

  print_success "Configuration saved"
}

install_agents_server

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Step 6: Setup Service (systemd/launchd)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

setup_service() {
  print_step "🔧 Setting up Service"

  if [ "$OS_TYPE" = "linux" ]; then
    # Check if systemd is available and system is not containerized
    if command -v systemctl &> /dev/null && systemctl is-system-running &>/dev/null 2>&1 && [ "$IN_CONTAINER" = false ]; then
      print_info "Creating systemd service..."

      cat > /etc/systemd/system/ariana-agent.service <<EOF
[Unit]
Description=Ariana Agent Server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=$INSTALL_DIR
EnvironmentFile=$INSTALL_DIR/.env
ExecStart=$INSTALL_DIR/ariana-agents-server
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

      systemctl daemon-reload
      systemctl enable ariana-agent
      systemctl start ariana-agent

      print_success "Service started and enabled"

    elif [ "$IN_CONTAINER" = true ]; then
      # Container environment - use background process
      print_info "Container environment detected - starting agent server"

      # Create helper scripts
      cat > "$INSTALL_DIR/start.sh" <<'EOF'
#!/bin/bash
cd "$(dirname "$0")"
if [ -f .env ]; then
  set -a
  source .env
  set +a
fi
nohup ./ariana-agents-server > agent.log 2>&1 &
echo $! > agent.pid
echo "Agent server started (PID: $(cat agent.pid))"
echo "Logs: tail -f $INSTALL_DIR/agent.log"
EOF
      chmod +x "$INSTALL_DIR/start.sh"

      cat > "$INSTALL_DIR/stop.sh" <<'EOF'
#!/bin/bash
cd "$(dirname "$0")"
if [ -f agent.pid ]; then
  kill $(cat agent.pid) 2>/dev/null && echo "Agent server stopped" || echo "Process not running"
  rm -f agent.pid
else
  echo "No PID file found"
  pkill -f ariana-agents-server && echo "Agent server killed"
fi
EOF
      chmod +x "$INSTALL_DIR/stop.sh"

      cat > "$INSTALL_DIR/logs.sh" <<'EOF'
#!/bin/bash
cd "$(dirname "$0")"
tail -f agent.log
EOF
      chmod +x "$INSTALL_DIR/logs.sh"

      # Start the agent
      cd "$INSTALL_DIR"
      set -a
      source .env
      set +a
      nohup ./ariana-agents-server > agent.log 2>&1 &
      echo $! > agent.pid

      sleep 2

      if [ -f agent.pid ] && kill -0 $(cat agent.pid) 2>/dev/null; then
        print_success "Agent server started (PID: $(cat agent.pid))"
        print_info "Logs: $INSTALL_DIR/logs.sh"
        print_info "Stop: $INSTALL_DIR/stop.sh"
      else
        print_error "Failed to start agent server"
        print_info "Check logs: cat $INSTALL_DIR/agent.log"
        exit 1
      fi

    else
      print_warning "systemd not available"
      print_info "Start manually: cd $INSTALL_DIR && ./ariana-agents-server"
    fi

  elif [ "$OS_TYPE" = "darwin" ]; then
    print_info "Creating launchd service..."

    cat > /Library/LaunchDaemons/com.ariana.agent.plist <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.ariana.agent</string>
    <key>UserName</key>
    <string>$RUN_AS_USER</string>
    <key>ProgramArguments</key>
    <array>
        <string>$INSTALL_DIR/ariana-agents-server</string>
    </array>
    <key>WorkingDirectory</key>
    <string>$INSTALL_DIR</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>MACHINE_ID</key>
        <string>$MACHINE_ID</string>
        <key>SHARED_KEY</key>
        <string>$SHARED_KEY</string>
        <key>ARIANA_PORT</key>
        <string>$ARIANA_PORT</string>
        <key>WORK_DIR</key>
        <string>$AGENT_WORK_DIR</string>
        <key>HOME</key>
        <string>$USER_HOME</string>
        <key>PATH</key>
        <string>$(dirname "${CLAUDE_PATH:-/usr/local/bin/claude}"):/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
        <key>GIT_CONFIG_NOSYSTEM</key>
        <string>1</string>
        <key>CLAUDE_PATH</key>
        <string>${CLAUDE_PATH:-/usr/local/bin/claude}</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/var/log/ariana-agent.log</string>
    <key>StandardErrorPath</key>
    <string>/var/log/ariana-agent.error.log</string>
</dict>
</plist>
EOF

    # Set ownership of entire install directory to the user
    chown -R "$RUN_AS_USER" "$INSTALL_DIR"
    print_info "Set ownership of $INSTALL_DIR to $RUN_AS_USER"

    # Create and set ownership of log files (so the service can write to them as the user)
    touch /var/log/ariana-agent.log /var/log/ariana-agent.error.log
    chown "$RUN_AS_USER" /var/log/ariana-agent.log /var/log/ariana-agent.error.log

    # Unload existing service first (if any) to pick up new config
    launchctl unload /Library/LaunchDaemons/com.ariana.agent.plist 2>/dev/null || true
    launchctl load /Library/LaunchDaemons/com.ariana.agent.plist

    print_success "Service started and enabled"
  fi
}

setup_service

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Step 7: Configure Firewall
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

configure_firewall() {
  print_step "🔥 Configuring Firewall"

  if [ "$OS_TYPE" = "linux" ]; then
    if command -v ufw &> /dev/null; then
      print_info "Configuring ufw..."
      # Check if ufw is active before trying to add rule
      if sudo ufw status | grep -q "Status: active"; then
        sudo ufw allow $ARIANA_PORT/tcp
        print_success "Port $ARIANA_PORT opened in ufw"
      else
        print_info "ufw is not active - skipping firewall configuration"
        print_info "If you enable ufw later, run: sudo ufw allow $ARIANA_PORT/tcp"
      fi
    elif command -v firewall-cmd &> /dev/null; then
      print_info "Configuring firewalld..."
      sudo firewall-cmd --permanent --add-port=$ARIANA_PORT/tcp
      sudo firewall-cmd --reload
      print_success "Port $ARIANA_PORT opened in firewalld"
    else
      print_warning "No firewall detected - make sure port $ARIANA_PORT is accessible"
    fi
  elif [ "$OS_TYPE" = "darwin" ]; then
    print_info "macOS firewall configuration may be needed"
    print_info "System Preferences > Security & Privacy > Firewall"
  fi
}

configure_firewall

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Step 8: Verify Installation
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

verify_installation() {
  print_step "🔍 Verifying Installation"

  sleep 3

  if curl -s --max-time 5 http://localhost:$ARIANA_PORT/health > /dev/null; then
    print_success "Ariana Agent Server is running!"
  else
    print_warning "Health check failed - checking logs..."
    echo ""
    if [ "$IN_CONTAINER" = true ]; then
      print_info "Recent logs:"
      tail -20 "$INSTALL_DIR/agent.log" 2>/dev/null || echo "No logs yet"
    elif [ "$OS_TYPE" = "linux" ] && command -v journalctl &> /dev/null; then
      print_info "Recent logs:"
      journalctl -u ariana-agent -n 20 --no-pager 2>/dev/null || echo "No logs available"
    else
      print_info "Recent logs:"
      tail -20 /var/log/ariana-agent.log 2>/dev/null || echo "No logs yet"
    fi
  fi
}

verify_installation

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Final Summary
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
print_success "Installation Complete!"
echo ""
echo "Machine ID: $MACHINE_ID"
echo "Port: $ARIANA_PORT"
echo ""

if [ "$IN_CONTAINER" = true ]; then
  echo "Manage agent (container mode):"
  echo "  Logs:    $INSTALL_DIR/logs.sh"
  echo "  Restart: $INSTALL_DIR/stop.sh && $INSTALL_DIR/start.sh"
  echo "  Stop:    $INSTALL_DIR/stop.sh"
elif [ "$OS_TYPE" = "linux" ] && command -v systemctl &> /dev/null; then
  echo "Manage service:"
  echo "  Status:  systemctl status ariana-agent"
  echo "  Logs:    journalctl -u ariana-agent -f"
  echo "  Restart: systemctl restart ariana-agent"
  echo "  Stop:    systemctl stop ariana-agent"
elif [ "$OS_TYPE" = "darwin" ]; then
  echo "Manage service:"
  echo "  Status:  launchctl list | grep ariana"
  echo "  Logs:    tail -f /var/log/ariana-agent.log"
  echo "  Restart: launchctl kickstart -k system/com.ariana.agent"
  echo "  Stop:    launchctl stop com.ariana.agent"
fi

echo ""
print_info "The machine should now appear in your Ariana app!"
print_info "Visit: https://app.ariana.dev/settings/machines"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
