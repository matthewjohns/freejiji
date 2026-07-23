import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const itchDistDir = path.join(rootDir, 'dist-itch');
const zipPath = path.join(rootDir, 'freejiji-itch.zip');

function copyFolderSync(from, to) {
  if (!fs.existsSync(from)) return;
  fs.mkdirSync(to, { recursive: true });
  fs.readdirSync(from).forEach((element) => {
    const fromPath = path.join(from, element);
    const toPath = path.join(to, element);
    if (fs.lstatSync(fromPath).isDirectory()) {
      copyFolderSync(fromPath, toPath);
    } else {
      fs.copyFileSync(fromPath, toPath);
    }
  });
}

function cleanDir(dir) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

try {
  console.log('--- Packaging Game for itch.io ---');
  
  if (!fs.existsSync(distDir)) {
    console.error('Error: "dist" folder not found. Please run "npm run build" first.');
    process.exit(1);
  }

  // Clean previous output
  cleanDir(itchDistDir);
  if (fs.existsSync(zipPath)) {
    fs.unlinkSync(zipPath);
  }

  // Create clean directory
  fs.mkdirSync(itchDistDir, { recursive: true });

  // Copy entry point and rename to index.html
  const freejijiHtmlPath = path.join(distDir, 'freejiji.html');
  if (!fs.existsSync(freejijiHtmlPath)) {
    console.error('Error: "dist/freejiji.html" not found. Build may have failed.');
    process.exit(1);
  }
  fs.copyFileSync(freejijiHtmlPath, path.join(itchDistDir, 'index.html'));
  console.log('Copied entry point: dist/freejiji.html -> dist-itch/index.html');

  // Copy other shared root assets
  ['favicon.svg', 'icons.svg'].forEach((file) => {
    const srcFile = path.join(distDir, file);
    if (fs.existsSync(srcFile)) {
      fs.copyFileSync(srcFile, path.join(itchDistDir, file));
      console.log(`Copied root file: dist/${file} -> dist-itch/${file}`);
    }
  });

  // Copy assets folder recursively
  const assetsSrc = path.join(distDir, 'assets');
  const assetsDst = path.join(itchDistDir, 'assets');
  if (fs.existsSync(assetsSrc)) {
    copyFolderSync(assetsSrc, assetsDst);
    console.log('Copied assets folder recursively: dist/assets -> dist-itch/assets');
  }

  // Zip the itch folder from inside dist-itch
  console.log('Creating zip archive: freejiji-itch.zip...');
  // Use relative path for zip to place it in root directory
  execSync('zip -r ../freejiji-itch.zip .', { cwd: itchDistDir, stdio: 'inherit' });
  console.log('Zip file created successfully at project root: freejiji-itch.zip');

  // Clean up temp directory
  cleanDir(itchDistDir);
  console.log('Cleaned up temporary "dist-itch" directory.');
  console.log('--- Packaging complete! Ready to upload to itch.io! ---');

} catch (error) {
  console.error('Packaging failed:', error);
  process.exit(1);
}
