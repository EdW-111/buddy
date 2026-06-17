// Runs automatically after npm install.
// 1) Generates app icons (public/icons/)
// 2) Downloads VAD worklet + model (public/vad/)

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const PNG = require('pngjs').PNG;

const VAD_VERSION = '0.0.19';
const VAD_ASSETS = [
  {
    url: `https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@${VAD_VERSION}/dist/vad.worklet.bundle.min.js`,
    dest: 'public/vad/vad.worklet.bundle.min.js',
  },
  {
    url: `https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@${VAD_VERSION}/dist/silero_vad.onnx`,
    dest: 'public/vad/silero_vad.onnx',
  },
];

function download(url, dest, depth = 0) {
  if (depth > 5) return Promise.reject(new Error('Too many redirects'));
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        resolve(download(res.headers.location, dest, depth + 1));
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      const out = fs.createWriteStream(dest);
      res.pipe(out);
      out.on('finish', () => { out.close(); resolve(); });
      out.on('error', reject);
    }).on('error', reject);
  });
}

function createIcon(size, dest) {
  const png = new PNG({ width: size, height: size, filterType: -1 });
  const cx = size / 2, cy = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (size * y + x) * 4;
      const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
      const r = size * 0.42;
      if (dist <= r) {
        const t = 1 - dist / r;
        png.data[idx]     = Math.round(79  + (124 - 79)  * t); // R
        png.data[idx + 1] = Math.round(70  + (99  - 70)  * t); // G
        png.data[idx + 2] = Math.round(229 + (255 - 229) * t); // B
        png.data[idx + 3] = 255;
      } else {
        png.data[idx] = 15; png.data[idx + 1] = 15;
        png.data[idx + 2] = 26; png.data[idx + 3] = 255;
      }
    }
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, PNG.sync.write(png));
  console.log(`  ✓ ${dest}`);
}

async function main() {
  console.log('\nBuddy setup:');

  // Icons
  const icon192 = 'public/icons/icon-192.png';
  const icon512 = 'public/icons/icon-512.png';
  if (!fs.existsSync(icon192)) createIcon(192, icon192);
  else console.log(`  · ${icon192} (exists)`);
  if (!fs.existsSync(icon512)) createIcon(512, icon512);
  else console.log(`  · ${icon512} (exists)`);

  // VAD assets
  for (const asset of VAD_ASSETS) {
    if (fs.existsSync(asset.dest)) {
      console.log(`  · ${asset.dest} (exists)`);
      continue;
    }
    process.stdout.write(`  ↓ ${asset.dest} ... `);
    try {
      await download(asset.url, asset.dest);
      console.log('done');
    } catch (err) {
      console.log(`FAILED (${err.message})`);
      console.log('    Run "npm run setup" again once you have internet access.');
    }
  }

  console.log('');
}

main();
