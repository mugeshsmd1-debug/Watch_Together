const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const IGNORED_DIRS = ['.git', 'node_modules', '.vercel', 'logs', '.gemini'];
const DEBOUNCE_DELAY = 4000; // wait 4 seconds after last file change before pushing

let debounceTimer = null;
let isPushing = false;
let pendingChanges = false;

console.log('========================================================');
console.log('🔄 Auto-Git Watcher Started');
console.log(`📁 Watching: ${ROOT_DIR}`);
console.log('✨ Any file changes will be automatically committed & pushed to GitHub (and Vercel)!');
console.log('========================================================\n');

function runGitAutoSync() {
  if (isPushing) {
    pendingChanges = true;
    return;
  }

  try {
    isPushing = true;
    pendingChanges = false;

    // Check if there are unstaged or uncommitted changes
    const status = execSync('git status --porcelain', { cwd: ROOT_DIR, encoding: 'utf8' }).trim();
    if (!status) {
      isPushing = false;
      return;
    }

    console.log(`[${new Date().toLocaleTimeString()}] 📝 File changes detected:`);
    const changedFiles = status.split('\n').slice(0, 5).map(line => '   ➜ ' + line.trim()).join('\n');
    console.log(changedFiles);
    if (status.split('\n').length > 5) {
      console.log(`   ➜ ... and ${status.split('\n').length - 5} more files`);
    }

    console.log('⏳ Staging changes (git add .)...');
    execSync('git add .', { cwd: ROOT_DIR, stdio: 'inherit' });

    const now = new Date();
    const timeString = now.toLocaleString('en-US', {
      dateStyle: 'short',
      timeStyle: 'medium',
      hour12: true
    });
    const commitMessage = `Auto-update: ${timeString}`;

    console.log(`📦 Committing: "${commitMessage}"...`);
    execSync(`git commit -m "${commitMessage}"`, { cwd: ROOT_DIR, stdio: 'inherit' });

    console.log('🚀 Pushing to GitHub (origin main)...');
    execSync('git push origin main', { cwd: ROOT_DIR, stdio: 'inherit' });

    console.log('✅ Successfully pushed to GitHub! Vercel is now deploying your updates.\n');
  } catch (err) {
    console.error('❌ Auto-Git push error:', err.message);
  } finally {
    isPushing = false;
    if (pendingChanges) {
      scheduleSync();
    }
  }
}

function scheduleSync() {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }
  debounceTimer = setTimeout(() => {
    runGitAutoSync();
  }, DEBOUNCE_DELAY);
}

// Watch project directory recursively
try {
  fs.watch(ROOT_DIR, { recursive: true }, (eventType, filename) => {
    if (!filename) return;

    // Check if changed file is in an ignored directory
    const normalized = filename.replace(/\\/g, '/');
    for (const ignored of IGNORED_DIRS) {
      if (normalized === ignored || normalized.startsWith(ignored + '/')) {
        return;
      }
    }

    // Ignore temporary files
    if (normalized.endsWith('~') || normalized.endsWith('.tmp') || normalized.includes('.crswap')) {
      return;
    }

    scheduleSync();
  });
} catch (err) {
  console.error('Failed to initialize recursive watcher:', err);
}

// Initial sync check on start
setTimeout(() => {
  runGitAutoSync();
}, 1000);
