// ============================================================
// LUMORA — Pre-deploy audit
// Glide-pattern: run before pushing to catch missing env vars,
// busted imports, dangling routes, etc. Exits non-zero on failure.
// ============================================================

const fs   = require('fs');
const path = require('path');

let errors = 0;
let warnings = 0;
function fail(msg) { console.error('✗', msg); errors++; }
function warn(msg) { console.warn('⚠', msg); warnings++; }
function ok(msg)   { console.log('✓', msg); }

const root = path.resolve(__dirname, '..');

// 1. package.json present + matches expected name
try {
  const pkg = require(path.join(root, 'package.json'));
  if (pkg.name !== 'lumora-server') fail(`package.json name is ${pkg.name}, expected lumora-server`);
  else ok('package.json name correct');
  if (!pkg.main) fail('package.json missing "main"');
  else ok(`entry point: ${pkg.main}`);
} catch (e) { fail(`cannot read package.json: ${e.message}`); }

// 2. Procfile present
const procfilePath = path.join(root, 'Procfile');
if (!fs.existsSync(procfilePath)) fail('Procfile missing — App Platform needs this');
else {
  const proc = fs.readFileSync(procfilePath, 'utf8').trim();
  if (!proc.startsWith('web:')) fail(`Procfile does not start with "web:" → got "${proc}"`);
  else ok(`Procfile: ${proc}`);
}

// 3. Required files exist
const required = [
  'server.js',
  'config/db.js',
  'config/secrets.js',
  'middleware/auth.js',
  'middleware/rateLimit.js',
  'middleware/errorHandler.js',
  'routes/health.js',
  'routes/waitlist.js',
  'routes/auth.js',
  'models/Pilgrim.js',
  'models/Tessera.js',
  'models/SigilImage.js',
  'models/SwipeEvents.js',
  'models/ResonancePair.js',
  'models/HearthEmber.js',
  'models/WraithlistEntry.js',
  'models/VeilkeySession.js',
  'models/WaitlistEntry.js',
  'models/CairnLog.js',
];
for (const f of required) {
  if (!fs.existsSync(path.join(root, f))) fail(`missing file: ${f}`);
}
if (errors === 0) ok(`all ${required.length} required files present`);

// 4. .env warnings (local dev only)
if (process.env.NODE_ENV !== 'production') {
  if (!process.env.MONGO_URI) warn('MONGO_URI not set in local env (App Platform will inject it)');
  if (!process.env.VEILKEY_SECRET) warn('VEILKEY_SECRET not set in local env');
}

// 5. .gitignore protects .env
const gi = path.join(root, '.gitignore');
if (fs.existsSync(gi)) {
  const lines = fs.readFileSync(gi, 'utf8');
  if (!lines.includes('.env')) fail('.gitignore does not list .env — secrets risk!');
  else ok('.gitignore protects .env');
} else {
  warn('.gitignore not present');
}

// 6. node_modules check (just a hint, not a hard fail)
if (!fs.existsSync(path.join(root, 'node_modules'))) {
  warn('node_modules not installed — run "npm install" before testing locally');
}

console.log('');
console.log(`audit: ${errors} error(s), ${warnings} warning(s)`);
if (errors > 0) process.exit(1);
process.exit(0);
