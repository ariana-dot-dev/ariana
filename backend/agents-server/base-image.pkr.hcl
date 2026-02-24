packer {
  required_plugins {
    hcloud = {
      version = ">= 1.0.0"
      source  = "github.com/hashicorp/hcloud"
    }
  }
}

variable "hcloud_token" {
  type = string
}

source "hcloud" "ubuntu-base" {
  token        = var.hcloud_token
  image        = "ubuntu-24.04"
  location     = "fsn1"
  server_type  = "cx43"
  ssh_username = "root"

  snapshot_name = "ubuntu-agents-base-${timestamp()}"
  snapshot_labels = {
    os      = "ubuntu-base"
    version = "24.04"
    type    = "base"
  }
}

build {
  sources = ["source.hcloud.ubuntu-base"]

  # Copy install-all-deps.sh script
  provisioner "file" {
    source      = "./scripts/install-all-deps.sh"
    destination = "/tmp/install-all-deps.sh"
  }

  # Run the installation script
  provisioner "shell" {
    inline = [
      "chmod +x /tmp/install-all-deps.sh",
      "/tmp/install-all-deps.sh",
      "rm /tmp/install-all-deps.sh"
    ]
    timeout = "45m"
  }

  # Create app directory
  provisioner "shell" {
    inline = [
      "mkdir -p /app"
    ]
  }

  # Copy moonlight-fork source (from ../../moonlight-fork relative to agents-server)
  provisioner "shell" {
    inline = [
      "mkdir -p /tmp/moonlight-fork"
    ]
  }

  provisioner "file" {
    source      = "../../moonlight-fork/Cargo.toml"
    destination = "/tmp/moonlight-fork/"
  }

  provisioner "file" {
    source      = "../../moonlight-fork/Cargo.lock"
    destination = "/tmp/moonlight-fork/"
  }

  provisioner "file" {
    source      = "../../moonlight-fork/moonlight-common"
    destination = "/tmp/moonlight-fork/"
  }

  provisioner "file" {
    source      = "../../moonlight-fork/moonlight-common-sys"
    destination = "/tmp/moonlight-fork/"
  }

  provisioner "file" {
    source      = "../../moonlight-fork/moonlight-client-simple"
    destination = "/tmp/moonlight-fork/"
  }

  provisioner "file" {
    source      = "../../moonlight-fork/moonlight-web"
    destination = "/tmp/moonlight-fork/"
  }

  provisioner "file" {
    source      = "../../moonlight-fork/xdotool-server.py"
    destination = "/tmp/moonlight-fork/"
  }

  # Build moonlight-fork and install binaries
  provisioner "shell" {
    inline = [
      "#!/bin/bash",
      "set -e",
      "export RUSTUP_HOME=/usr/local/rustup",
      "export CARGO_HOME=/usr/local/cargo",
      "export PATH=/usr/local/cargo/bin:$PATH",

      # Install nightly and set as default for this build (moonlight-fork requires nightly features)
      "rustup toolchain install nightly",
      "rustup default nightly",

      # Build frontend first
      "cd /tmp/moonlight-fork/moonlight-web/web-server",
      "npm install",
      # Generate bindings first (uses cargo, not node_modules/.bin)
      "npm run generate-bindings",
      # Install tsc globally and run directly (symlinks in node_modules/.bin break during packer file copy)
      "npm install -g typescript cpx",
      "tsc",
      "cpx 'web/**/*.{html,json,css,svg,png,js,wasm}' dist/",

      # Build Rust binaries
      "cd /tmp/moonlight-fork",
      "cargo build --release --package streamer --package web-server",

      # Restore stable as default
      "rustup default stable",

      # Install binaries to /opt/moonlight-web
      "mkdir -p /opt/moonlight-web/server /opt/moonlight-web/static",
      "cp target/release/streamer /opt/moonlight-web/",
      "cp target/release/web-server /opt/moonlight-web/",
      "cp -r moonlight-web/web-server/dist/* /opt/moonlight-web/static/",
      "cp xdotool-server.py /opt/moonlight-web/",
      "chmod +x /opt/moonlight-web/streamer /opt/moonlight-web/web-server /opt/moonlight-web/xdotool-server.py",

      # Verify installation
      "ls -la /opt/moonlight-web/streamer /opt/moonlight-web/web-server",
      "grep -q '/clipboard' /opt/moonlight-web/xdotool-server.py || (echo 'ERROR: xdotool-server.py missing clipboard endpoint!' && exit 1)",

      # Clean up
      "rm -rf /tmp/moonlight-fork",

      "echo 'Moonlight-fork binaries installed to /opt/moonlight-web/'"
    ]
    timeout = "30m"
  }
}
