#!/usr/bin/env node

import fs from 'fs';
import path from 'path';

const TAURI_CONFIG_PATH = './src-tauri/tauri.conf.json';

function parseArgs() {
  const args = process.argv.slice(2);
  
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Usage: node bump-version.js [--major|--minor|--patch]

Bumps the version in Tauri configuration file.

Options:
  --major    Bump major version (1.0.0 -> 2.0.0)
  --minor    Bump minor version (1.0.0 -> 1.1.0)
  --patch    Bump patch version (1.0.0 -> 1.0.1) [default]
  --help     Show this help message

Examples:
  node bump-version.js --minor
  node bump-version.js --major
  node bump-version.js          # defaults to patch
`);
    process.exit(0);
  }

  if (args.includes('--major')) return 'major';
  if (args.includes('--minor')) return 'minor';
  return 'patch'; // default
}

function bumpVersion(version, type) {
  const parts = version.split('.').map(Number);
  
  if (parts.length !== 3) {
    throw new Error(`Invalid version format: ${version}. Expected format: x.y.z`);
  }

  switch (type) {
    case 'major':
      parts[0]++;
      parts[1] = 0;
      parts[2] = 0;
      break;
    case 'minor':
      parts[1]++;
      parts[2] = 0;
      break;
    case 'patch':
      parts[2]++;
      break;
    default:
      throw new Error(`Unknown bump type: ${type}`);
  }

  return parts.join('.');
}

function main() {
  try {
    const bumpType = parseArgs();
    
    // Check if tauri config exists
    if (!fs.existsSync(path.join('./frontend', TAURI_CONFIG_PATH))) {
      console.error(`Error: Tauri config not found at ${TAURI_CONFIG_PATH}`);
      process.exit(1);
    }

    // Read and parse tauri config
    const configContent = fs.readFileSync(path.join('./frontend', TAURI_CONFIG_PATH), 'utf8');
    const config = JSON.parse(configContent);

    if (!config.version) {
      console.error('Error: No version field found in tauri.conf.json');
      process.exit(1);
    }

    const currentVersion = config.version;
    const newVersion = bumpVersion(currentVersion, bumpType);

    // Update version
    config.version = newVersion;

    // Write back to file with proper formatting
    const updatedContent = JSON.stringify(config, null, '\t');
    fs.writeFileSync(path.join('./frontend', TAURI_CONFIG_PATH), updatedContent);

    console.log(`Version bumped: ${currentVersion} -> ${newVersion} (${bumpType})`);
    console.log(`Updated: ${TAURI_CONFIG_PATH}`);
    console.log(`\nNext steps:`);
    console.log(`   git add ${TAURI_CONFIG_PATH}`);
    console.log(`   git commit -m "bump version to ${newVersion}"`);
    console.log(`   git tag v${newVersion}`);
    console.log(`   git push origin v${newVersion}`);

  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

main();