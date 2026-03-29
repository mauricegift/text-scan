'use strict';
/**
 * IP-based daily request limiter.
 * Persists usage counts to lib/ips.json (resets per calendar day, UTC).
 * Automatically purges entries from previous days on each write to keep the file small.
 */
const fs   = require('fs');
const path = require('path');

const DB_PATH    = path.join(__dirname, 'ips.json');
const DAILY_MAX  = 20;

/** YYYY-MM-DD (UTC) */
function today() {
  return new Date().toISOString().slice(0, 10);
}

/** UTC time remaining until midnight (human-readable). */
function timeUntilMidnight() {
  const now  = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const ms   = next - now;
  const h    = Math.floor(ms / 3600000);
  const m    = Math.floor((ms % 3600000) / 60000);
  if (h > 0) return `${h}h ${m}m`;
  return `${m} minute${m !== 1 ? 's' : ''}`;
}

function loadDb() {
  try { return JSON.parse(fs.readFileSync(DB_PATH, 'utf8')); }
  catch (_) { return {}; }
}

function saveDb(db) {
  /* purge stale (yesterday or older) entries before writing */
  const date = today();
  for (const ip of Object.keys(db)) {
    if (db[ip].date !== date) delete db[ip];
  }
  try { fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2)); }
  catch (_) { /* non-fatal: disk write failure should not block requests */ }
}

/** Extract the real client IP, respecting the trust-proxy setting. */
function clientIp(req) {
  return (req.ip || req.socket?.remoteAddress || 'unknown').replace(/^::ffff:/, '');
}

/**
 * Express middleware — enforces DAILY_MAX POST /extract requests per unique IP.
 * Must be placed AFTER express-rate-limit (which handles burst protection).
 */
function ipDailyLimit(req, res, next) {
  const ip   = clientIp(req);
  const date = today();
  const db   = loadDb();

  const entry = db[ip];

  /* First request of the day — or first ever */
  if (!entry || entry.date !== date) {
    db[ip] = { date, count: 1 };
    saveDb(db);
    return next();
  }

  /* Limit reached */
  if (entry.count >= DAILY_MAX) {
    return res.status(429).json({
      error: `😡 Daily limit reached (${DAILY_MAX} extractions/day). Resets in ${timeUntilMidnight()}.`,
    });
  }

  /* Increment and continue */
  entry.count += 1;
  saveDb(db);
  next();
}

module.exports = { ipDailyLimit };
