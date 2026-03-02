import { execSync } from 'child_process';
import { mkdirSync } from 'fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const outDir = 'docs/screenshots';
mkdirSync(outDir, { recursive: true });

const pages = [
  { name: '01-login', url: 'http://localhost:3000/login' },
  { name: '02-signup', url: 'http://localhost:3000/signup' },
  { name: '03-dashboard', url: 'http://localhost:3000/dashboard' },
  { name: '04-documents', url: 'http://localhost:3000/documents' },
  { name: '05-transactions', url: 'http://localhost:3000/transactions' },
  { name: '06-insights', url: 'http://localhost:3000/insights' },
  { name: '07-settings', url: 'http://localhost:3000/settings' },
];

for (const page of pages) {
  console.log(`Capturing ${page.name}...`);
  try {
    execSync(
      `"${CHROME}" --headless=new --disable-gpu --no-sandbox --screenshot="${outDir}/${page.name}.png" --window-size=1440,900 "${page.url}"`,
      { timeout: 15000, stdio: 'pipe' },
    );
    console.log(`  ✅ ${page.name}.png`);
  } catch (e) {
    console.log(`  ⚠️  Failed: ${e.message?.slice(0, 100)}`);
  }
}

console.log('\nDone! Screenshots saved to docs/screenshots/');
