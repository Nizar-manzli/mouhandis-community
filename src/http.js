'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { SafeHtml } = require('./util');

// Minimal router: app.get('/m/:id', handler). Handlers receive (req, res, ctx)
// and may return SafeHtml / string (sent as HTML) or call res helpers.
class Router {
  constructor() { this.routes = []; }
  add(method, pattern, ...handlers) {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
    this.routes.push({ method, re, keys, handlers });
  }
  get(p, ...h) { this.add('GET', p, ...h); }
  post(p, ...h) { this.add('POST', p, ...h); }
  match(method, pathname) {
    for (const r of this.routes) {
      if (r.method !== method) continue;
      const m = r.re.exec(pathname);
      if (m) {
        const params = {};
        r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
        return { handlers: r.handlers, params };
      }
    }
    return null;
  }
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

// Parses application/x-www-form-urlencoded. Repeated keys (checkbox groups)
// become arrays.
function parseForm(str) {
  const out = {};
  for (const [k, v] of new URLSearchParams(str)) {
    if (k in out) out[k] = [].concat(out[k], v);
    else out[k] = v;
  }
  return out;
}

function readBody(req, limit = 1e6) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error('Payload too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const MIME = { '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };

function serveStatic(root, pathname, res) {
  const file = path.normalize(path.join(root, pathname));
  if (!file.startsWith(root + path.sep)) return false;
  let stat;
  try { stat = fs.statSync(file); } catch { return false; }
  if (!stat.isFile()) return false;
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
    'Cache-Control': 'public, max-age=300',
  });
  fs.createReadStream(file).pipe(res);
  return true;
}

function enhance(res) {
  res.headers = {};
  res.cookie = (name, value, opts = {}) => {
    const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'SameSite=Lax'];
    if (opts.httpOnly !== false) parts.push('HttpOnly');
    if (opts.maxAge !== undefined) parts.push(`Max-Age=${opts.maxAge}`);
    if (process.env.NODE_ENV === 'production') parts.push('Secure');
    res.headers['Set-Cookie'] = [].concat(res.headers['Set-Cookie'] || [], parts.join('; '));
  };
  res.redirect = (loc, status = 303) => {
    res.writeHead(status, { ...res.headers, Location: loc });
    res.end();
  };
  res.html = (body, status = 200) => {
    res.writeHead(status, {
      ...res.headers,
      'Content-Type': 'text/html; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'same-origin',
      'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; form-action 'self'; frame-ancestors 'none'",
    });
    res.end(body instanceof SafeHtml ? body.s : String(body));
  };
  res.json = (obj, status = 200) => {
    res.writeHead(status, { ...res.headers, 'Content-Type': 'application/json' });
    res.end(JSON.stringify(obj));
  };
  return res;
}

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

module.exports = { Router, parseCookies, parseForm, readBody, serveStatic, enhance, HttpError };
