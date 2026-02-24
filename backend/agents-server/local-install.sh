#!/bin/bash
#
# Local Development Installation Helper
#
# This script simplifies local testing by:
# - Building the binary if needed
# - Setting all required environment variables
# - Running the install script with local backend and binary
#
# Usage:
#   ./local-install.sh <registration-token>
#
# Example:
#   ./local-install.sh amt_abc123...
#

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_error() {
  echo -e "${RED}❌ Error: $1${NC}"
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

# Check if registration token provided
if [ -z "$1" ]; then
  print_error "Registration token required"
  echo ""
  echo "Usage: ./local-install.sh <registration-token>"
  echo ""
  echo "To get a registration token:"
  echo "  1. Start your local backend (cd backend && bun run index.ts)"
  echo "  2. Start your local frontend (cd frontend && npm run dev)"
  echo "  3. Go to http://localhost:5173/settings/machines"
  echo "  4. Click 'Add Custom Machine' and copy the token"
  exit 1
fi

REGISTRATION_TOKEN="$1"

# Get script directory (works from any location)
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

print_info "Script directory: $SCRIPT_DIR"

# Detect platform
if [[ "$OSTYPE" == "darwin"* ]]; then
  if [[ $(uname -m) == "arm64" ]]; then
    PLATFORM="darwin-arm64"
  else
    PLATFORM="darwin-x64"
  fi
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
  if [[ $(uname -m) == "x86_64" ]]; then
    PLATFORM="linux-x64"
  elif [[ $(uname -m) == "aarch64" ]]; then
    PLATFORM="linux-arm64"
  fi
else
  print_error "Unsupported platform: $OSTYPE"
  exit 1
fi

BINARY_NAME="ariana-agents-server-${PLATFORM}"
BINARY_PATH="$SCRIPT_DIR/dist-binaries/$BINARY_NAME"

# Check if binary exists
if [ ! -f "$BINARY_PATH" ]; then
  print_step "🔨 Building Agents Server Binary"

  print_info "Binary not found at: $BINARY_PATH"
  print_info "Running build script..."

  if [ ! -f "$SCRIPT_DIR/scripts/build-all.sh" ]; then
    print_error "Build script not found at: $SCRIPT_DIR/scripts/build-all.sh"
    exit 1
  fi

  cd "$SCRIPT_DIR"
  ./scripts/build-all.sh local

  if [ ! -f "$BINARY_PATH" ]; then
    print_error "Build failed - binary not created"
    exit 1
  fi

  print_success "Binary built successfully"
else
  print_success "Binary found at: $BINARY_PATH"
fi

# Configuration
API_URL="${API_URL:-http://localhost:3000}"
INSTALL_SCRIPT="$SCRIPT_DIR/install.sh"

if [ ! -f "$INSTALL_SCRIPT" ]; then
  print_error "Install script not found at: $INSTALL_SCRIPT"
  exit 1
fi

print_step "🚀 Running Local Installation"

print_info "Configuration:"
echo "  API URL: $API_URL"
echo "  Binary: $BINARY_PATH"
echo "  Local IP: host.docker.internal (for Docker backend)"
echo "  Work directory: $(pwd)"
echo "  Install script: $INSTALL_SCRIPT"
echo "  Token: ${REGISTRATION_TOKEN:0:10}..."
echo ""

# Run install script with local configuration
# Pass current directory as WORK_DIR for non-interactive install
sudo API_URL="$API_URL" \
     BINARY_PATH="$BINARY_PATH" \
     LOCAL_IP="host.docker.internal" \
     WORK_DIR="$(pwd)" \
     bash "$INSTALL_SCRIPT" "$REGISTRATION_TOKEN"

print_step "✨ Installation Complete"

print_success "Your custom machine is now registered!"
echo ""
echo "Next steps:"
echo "  1. Check service status:"
if [[ "$OSTYPE" == "darwin"* ]]; then
  echo "     sudo launchctl list | grep ariana"
  echo "     sudo launchctl print system/com.ariana.agent"
else
  echo "     sudo systemctl status ariana-agent"
  echo "     sudo journalctl -u ariana-agent -f"
fi
echo ""
echo "  2. Check health:"
echo "     curl http://localhost:8911/health"
echo ""
echo "  3. View logs:"
if [[ "$OSTYPE" == "darwin"* ]]; then
  echo "     tail -f /var/log/ariana-agent.log"
else
  echo "     tail -f /var/log/agents-server/agents-server.log"
fi
echo ""
echo "  4. Use your machine in the frontend:"
echo "     Go to http://localhost:5173 and create an agent with your custom machine"
