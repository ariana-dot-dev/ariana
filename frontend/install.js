import { spawn } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, mkdirSync, chmodSync } from 'fs';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import { get } from 'https';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function downloadBinary() {
  const platform = process.platform;
  const arch = process.arch;
  const version = '1.0.0';
  
  let binaryName;
  let downloadUrl;
  
  switch (platform) {
    case 'win32':
      binaryName = 'ariana.exe';
      downloadUrl = `https://github.com/yourusername/ariana/releases/download/v${version}/ariana-${arch}-pc-windows-msvc.exe`;
      break;
    case 'darwin':
      binaryName = 'ariana';
      downloadUrl = `https://github.com/yourusername/ariana/releases/download/v${version}/ariana-${arch === 'arm64' ? 'aarch64' : 'x64'}-apple-darwin`;
      break;
    case 'linux':
      binaryName = 'ariana';
      downloadUrl = `https://github.com/yourusername/ariana/releases/download/v${version}/ariana-${arch === 'x64' ? 'x86_64' : arch}-unknown-linux-gnu`;
      break;
    default:
      console.error(`Unsupported platform: ${platform}`);
      process.exit(1);
  }
  
  const binDir = join(__dirname, 'bin');
  const binaryPath = join(binDir, binaryName);
  
  if (!existsSync(binDir)) {
    mkdirSync(binDir, { recursive: true });
  }
  
  if (existsSync(binaryPath)) {
    console.log('Binary already exists, skipping download');
    return;
  }
  
  console.log(`Downloading Ariana for ${platform}-${arch}...`);
  console.log(`From: ${downloadUrl}`);
  
  try {
    const response = await fetch(downloadUrl);
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const fileStream = createWriteStream(binaryPath);
    await pipeline(response.body, fileStream);
    
    if (platform !== 'win32') {
      chmodSync(binaryPath, 0o755);
    }
    
    console.log('✅ Ariana installed successfully!');
    console.log(`Binary installed at: ${binaryPath}`);
    console.log('You can now run: ariana');
    
  } catch (error) {
    console.error('❌ Download failed:', error.message);
    console.log('');
    console.log('Manual installation instructions:');
    console.log('1. Go to https://github.com/yourusername/ariana/releases/latest');
    console.log('2. Download the appropriate binary for your platform');
    console.log(`3. Place it at: ${binaryPath}`);
    console.log('4. Make it executable (Unix systems): chmod +x ' + binaryPath);
    
    process.exit(1);
  }
}

if (process.argv[1] === __filename) {
  if (process.env.NODE_ENV === 'development' || process.env.SKIP_BINARY_DOWNLOAD === 'true') {
    console.log('Skipping binary download in development mode');
    console.log('Run `npm run tauri:build` to build the binary locally');
    process.exit(0);
  }
  
  downloadBinary().catch(console.error);
}

export { downloadBinary };