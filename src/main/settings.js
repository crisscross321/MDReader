const { app } = require('electron');
const fs = require('fs');
const path = require('path');

/* Small JSON preferences store in userData. Holds the theme source, the
   two Markdown rendering switches and the recent-files list (kept here, not
   in the macOS-only recentDocuments role, so it works on every platform). */

const DEFAULTS = { theme: 'system', breaks: true, typographer: true, recent: [] };
const MAX_RECENT = 10;

let cache = null;

function file() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function load() {
  if (cache) return cache;
  try {
    cache = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(file(), 'utf-8')) };
  } catch (_) {
    cache = { ...DEFAULTS };
  }
  if (!['system', 'light', 'dark'].includes(cache.theme)) cache.theme = 'system';
  if (!Array.isArray(cache.recent)) cache.recent = [];
  return cache;
}

function persist() {
  try {
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    fs.writeFileSync(file(), JSON.stringify(cache, null, 2));
  } catch (err) {
    console.warn('[Settings] save failed:', err.message);
  }
}

function get() {
  return { ...load() };
}

function set(key, value) {
  load();
  if (key === 'theme' && !['system', 'light', 'dark'].includes(value)) return false;
  if ((key === 'breaks' || key === 'typographer') && typeof value !== 'boolean') return false;
  if (!['theme', 'breaks', 'typographer'].includes(key)) return false;
  cache[key] = value;
  persist();
  return true;
}

function addRecent(filePath) {
  load();
  cache.recent = [filePath, ...cache.recent.filter((p) => p !== filePath)].slice(0, MAX_RECENT);
  persist();
}

function clearRecent() {
  load();
  cache.recent = [];
  persist();
}

module.exports = { get, set, addRecent, clearRecent };
