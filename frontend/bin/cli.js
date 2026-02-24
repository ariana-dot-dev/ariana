#!/usr/bin/env node

import { spawn } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function getPlatformBinary() {
  const platform = process.platform;
  const arch = process.arch;
  
  let binaryName;
  
  switch (platform) {
    case 'win32':
      binaryName = 'ariana.exe';
      break;
    case 'darwin':
      binaryName = 'ariana';
      break;
    case 'linux':
      binaryName = 'ariana';
      break;
    default:
      console.error(`Unsupported platform: ${platform}`);
      process.exit(1);
  }
  
  return join(__dirname, binaryName);
}

function main() {
  const binaryPath = getPlatformBinary();
  
  if (!existsSync(binaryPath)) {
    console.error(`Binary not found at ${binaryPath}`);
    console.error('Please ensure the binary is present or run npm install again.');
    process.exit(1);
  }
  
  // Launch the Tauri app
  const child = spawn(binaryPath, process.argv.slice(2), {
    stdio: 'inherit',
    detached: false
  });
  
  child.on('error', (error) => {
    console.error('Failed to launch Ariana:', error.message);
    process.exit(1);
  });
  
  child.on('exit', (code) => {
    process.exit(code || 0);
  });
}

main();