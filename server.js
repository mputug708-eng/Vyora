'use strict';
// VYORA — serveur sans dépendances (Node 22+). API + fichiers statiques.
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const PORT = +process.env.PORT || 3000;
const PROD = process.env.NODE_ENV === 'production';
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'vyora.db');
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || '').toLowerCase();
const WELCOME_COINS = +process.env.WELCOME_COINS || 0;      // 0 en production
const CREATOR_SHARE = +process.env.CREATOR_SHARE || 0.6;    // part du créateur en diamants
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
let SECRET = process.env.APP_SECRET;
if (!SECRET) {
  if (PROD) { console.error('APP_SECRET est obligatoire en production.'); process.exit(1); }
  SECRET = crypto.randomBytes(32).toString('hex');
  console.warn('[dev] APP_SECRET aléatoire : les sessions seront perdues au redémarrage.');
}
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec(`
PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, name TEXT NOT NULL, name_lc TEXT NOT NULL UNIQUE, email TEXT NOT NULL UNIQUE, pass TEXT NOT NULL, birth TEXT NOT NULL, gender TEXT, country TEXT, bio TEXT DEFAULT '', role TEXT DEFAULT 'user', coins INTEGER DEFAULT 0, diamonds INTEGER DEFAULT 0, banned INTEGER DEFAULT 0, terms_at INTEGER NOT NULL, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS likes(from_id INTEGER, to_id INTEGER, created INTEGER, PRIMARY KEY(from_id,to_id));
CREATE TABLE IF NOT EXISTS blocks(from_id INTEGER, to_id INTEGER, PRIMARY KEY(from_id,to_id));
CREATE TABLE IF NOT EXISTS reports(id INTEGER PRIMARY KEY, reporter INTEGER, kind TEXT, target INTEGER, reason TEXT, status TEXT DEFAULT 'open', created INTEGER);
CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY, from_id INTEGER, to_id INTEGER, body TEXT, created INTEGER);
CREATE INDEX IF NOT EXISTS msg_pair ON messages(from_id,to_id,id);
CREATE TABLE IF NOT EXISTS moments(id INTEGER PRIMARY KEY, user_id INTEGER, body TEXT, created INTEGER);
CREATE TABLE IF NOT EXISTS moment_likes(moment_id INTEGER, user_id INTEGER, PRIMARY KEY(moment_id,user_id));
CREATE TABLE IF NOT EXISTS comments(id INTEGER PRIMARY KEY, moment_id INTEGER, user_id INTEGER, body TEXT, created INTEGER);
CREATE TABLE IF NOT EXISTS ledger(id INTEGER PRIMARY KEY, user_id INTEGER, coins INTEGER DEFAULT 0, diamonds INTEGER DEFAULT 0, reason TEXT, ref TEXT, created INTEGER);
`);
const q = (sql, ...a) => db.prepare(sql).all(...a);
const one = (sql, ...a) => db.prepare(sql).get(...a);
const run = (sql, ...a) => db.prepare(sql).run(...a);
const tx = fn => { db.exec('BEGIN IMMEDIATE'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } };
const now = () => Date.now();

const GIFTS = { coeur: ['❤️', 'Cœur', 10], rose: ['🌹', 'Rose', 50], panda: ['🐼', 'Panda', 100], diamant: ['💎', 'Diamant', 500], couronne: ['👑', 'Couronne', 2000], supercar: ['🚗', 'Supercar', 10000] };

// ---------- sécurité ----------
const hashPw = pw => { const s = crypto.randomBytes(16); return s.toString('hex') + ':' + crypto.scryptSync(pw, s, 64).toString('hex'); };
const checkPw = (pw, st) => { const [s, h] = st.split(':'); const a = crypto.scryptSync(pw, Buffer.from(s, 'hex'), 64), b = Buffer.from(h, 'hex'); return a.length === b.length && crypto.timingSafeEqual(a, b); };
const sign = uid => { const p = uid + '.' + (now() + 30 * 864e5); return p + '.' + crypto.createHmac('sha256', SECRET).update(p).digest('base64url'); };
const verifyTok = t => { const [u, e, s] = String(t || '').split('.'); if (!s) return null; const ok = crypto.createHmac('sha256', SECRET).update(u + '.' + e).digest('base64url'); const A = Buffer.from(s), B = Buffer.from(ok); if (A.length !== B.length || !crypto.timingSafeEqual(A, B) || +e < now()) return null; return +u; };
const hits = new Map();
const limited = (ip, key, max, ms) => { const k = key + ip, h = hits.get(k); if (!h || h.r < now()) { hits.set(k, { n: 1, r: now() + ms }); return false; } return ++h.n > max; };
setInterval(() => { for (const [k, v] of hits) if (v.r < now()) hits.delete(k); }, 60000).unref();

// ---------- utilitaires ----------
class HttpError extends Error { constructor(c, m) { super(m); this.code = c; } }
const bad = (m, c = 400) => { throw new HttpError(c, m); };
const send = (res, code, obj, extra = {}) => { const b = JSON.stringify(obj); res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra }); res.end(b); };
const readBody = req => new Promise((ok, ko) => { let d = '', n = 0; req.on('data', c => { n += c.length; if (n > 50e3) { ko(new HttpError(413, 'Requête trop grande')); req.destroy(); } else d += c; }); req.on('end', () => { try { ok(d ? JSON.parse(d) : {}); } catch { ko(new HttpError(400, 'JSON invalide')); } }); });
const age = b => { const d = new Date(b), t = new Date(); let a = t.getFullYear() - d.getFullYear(); if (t < new Date(t.getFullYear(), d.getMonth(), d.getDate())) a--; return a; };
const pub = u => ({ id: u.id, name: u.name, age: age(u.birth), gender: u.gender, country: u.country, bio: u.bio });
const self = u => ({ ...pub(u), email: u.email, role: u.role, coins: u.coins, diamonds: u.diamonds });
const str = (v, min, max, label) => { v = typeof v === 'string' ? v.trim() : ''; if (v.length < min || v.length > max) bad(`${label} : ${min}-${max} caractères`); return v; };
const isBlocked = (a, b) => !!one('SELECT 1 x FROM blocks WHERE (from_id=? AND to_id=?) OR (from_id=? AND to_id=?)', a, b, b, a);
const getUser = id => one('SELECT * FROM users WHERE id=? AND banned=0', id) || bad('Utilisateur introuvable', 404);

// ---------- routes ----------
const routes = [];
const R = (m, p, h, o = {}) => routes.push({ m, re: new RegExp('^' + p.replace(/:\w+/g, '(\\d+)') + '$'), h, o });

R('GET', '/healthz', () => ({ ok: true }));
R('POST', '/api/auth/register', ({ body, ip }) => {
  if (limited(ip, 'auth', 10, 6e4)) bad('Trop de tentatives, réessayez dans une minute', 429);
  const name = str(body.name, 3, 24, 'Pseudo');
  if (!/^[\p{L}\p{N}_.\- ]+$/u.test(name)) bad('Pseudo : lettres, chiffres, _ . - uniquement');
  const email = str(body.email, 5, 120, 'E-mail').toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) bad('E-mail invalide');
  const pw = typeof body.password === 'string' ? body.password : '';
  if (pw.length < 8 || pw.length > 200) bad('Mot de passe : 8 caractères minimum');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(body.birth || '') || isNaN(new Date(body.birth))) bad('Date de naissance invalide');
  if (age(body.birth) < 18) bad('VYORA est réservé aux personnes de 18 ans et plus', 403);
  if (body.terms !== true) bad("Vous devez accepter les conditions d'utilisation et la politique de confidentialité");
  const gender = ['female', 'male', 'other'].includes(body.gender) ? body.gender : 'other';
  const country = /^[A-Za-z]{2}$/.test(body.country || '') ? body.country.toUpperCase() : null;
  if (one('SELECT 1 x FROM users WHERE name_lc=? OR email=?', name.toLowerCase(), email)) bad('Pseudo ou e-mail déjà utilisé', 409);
  const role = ADMIN_EMAIL && email === ADMIN_EMAIL ? 'admin' : 'user';
  const r = run('INSERT INTO users(name,name_lc,email,pass,birth,gender,country,role,coins,terms_at,created) VALUES(?,?,?,?,?,?,?,?,?,?,?)', name, name.toLowerCase(), email, hashPw(pw), body.birth, gender, country, role, WELCOME_COINS, now(), now());
  const u = one('SELECT * FROM users WHERE id=?', Number(r.lastInsertRowid));
  return { token: sign(u.id), user: self(u) };
});
R('POST', '/api/auth/login', ({ body, ip }) => {
  if (limited(ip, 'auth', 10, 6e4)) bad('Trop de tentatives, réessayez dans une minute', 429);
  const u = one('SELECT * FROM users WHERE email=?', String(body.email || '').toLowerCase().trim());
  if (!u || !checkPw(String(body.password || ''), u.pass)) bad('Identifiants incorrects', 401);
  if (u.banned) bad('Compte suspendu', 403);
  return { token: sign(u.id), user: self(u) };
});
R('GET', '/api/me', ({ user }) => ({ user: self(user) }), { auth: 1 });
R('PATCH', '/api/me', ({ user, body }) => {
  const bio = body.bio === undefined ? user.bio : str(body.bio || '', 0, 300, 'Bio');
  const gender = ['female', 'male', 'other'].includes(body.gender) ? body.gender : user.gender;
  const country = body.country === undefined ? user.country : (/^[A-Za-z]{2}$/.test(body.country) ? body.country.toUpperCase() : null);
  run('UPDATE users SET bio=?,gender=?,country=? WHERE id=?', bio, gender, country, user.id);
  return { user: self(one('SELECT * FROM users WHERE id=?', user.id)) };
}, { auth: 1 });
R('DELETE', '/api/me', ({ user, body }) => {  // droit à l'effacement (RGPD)
  if (!checkPw(String(body.password || ''), user.pass)) bad('Mot de passe incorrect', 401);
  const id = user.id;
  tx(() => {
    run('DELETE FROM comments WHERE moment_id IN (SELECT id FROM moments WHERE user_id=?)', id);
    run('DELETE FROM moment_likes WHERE moment_id IN (SELECT id FROM moments WHERE user_id=?)', id);
    run('DELETE FROM moments WHERE user_id=?', id);
    run('DELETE FROM comments WHERE user_id=?', id);
    run('DELETE FROM moment_likes WHERE user_id=?', id);
    run('DELETE FROM likes WHERE from_id=? OR to_id=?', id, id);
    run('DELETE FROM blocks WHERE from_id=? OR to_id=?', id, id);
    run('DELETE FROM messages WHERE from_id=? OR to_id=?', id, id);
    run('DELETE FROM ledger WHERE user_id=?', id);
    run('DELETE FROM reports WHERE reporter=?', id);
    run('DELETE FROM users WHERE id=?', id);
  });
  return { ok: true };
}, { auth: 1 });

R('GET', '/api/discover', ({ user, url }) => {
  const g = url.searchParams.get('gender'), c = url.searchParams.get('country');
  let sql = 'SELECT * FROM users WHERE banned=0 AND id!=? AND id NOT IN (SELECT to_id FROM blocks WHERE from_id=?) AND id NOT IN (SELECT from_id FROM blocks WHERE to_id=?)', a = [user.id, user.id, user.id];
  if (['female', 'male', 'other'].includes(g)) { sql += ' AND gender=?'; a.push(g); }
  if (/^[A-Za-z]{2}$/.test(c || '')) { sql += ' AND country=?'; a.push(c.toUpperCase()); }
  const liked = new Set(q('SELECT to_id FROM likes WHERE from_id=?', user.id).map(r => r.to_id));
  return { users: q(sql + ' ORDER BY id DESC LIMIT 60', ...a).map(u => ({ ...pub(u), liked: liked.has(u.id) })) };
}, { auth: 1 });
R('POST', '/api/like/:id', ({ user, p }) => {
  const t = getUser(+p[0]); if (t.id === user.id) bad('Action impossible');
  if (isBlocked(user.id, t.id)) bad('Action impossible', 403);
  run('INSERT OR IGNORE INTO likes VALUES(?,?,?)', user.id, t.id, now());
  return { match: !!one('SELECT 1 x FROM likes WHERE from_id=? AND to_id=?', t.id, user.id) };
}, { auth: 1 });
R('POST', '/api/block/:id', ({ user, p }) => { getUser(+p[0]); run('INSERT OR IGNORE INTO blocks VALUES(?,?)', user.id, +p[0]); return { ok: true }; }, { auth: 1 });
R('POST', '/api/report', ({ user, body }) => {
  const kind = ['user', 'moment', 'message'].includes(body.kind) ? body.kind : bad('Type de signalement invalide');
  const target = +body.target; if (!target) bad('Cible invalide');
  run('INSERT INTO reports(reporter,kind,target,reason,created) VALUES(?,?,?,?,?)', user.id, kind, target, str(body.reason, 3, 500, 'Motif'), now());
  return { ok: true };
}, { auth: 1 });

R('GET', '/api/conversations', ({ user }) => ({ conversations: q(`SELECT u.id,u.name, m.body, m.created FROM messages m JOIN users u ON u.id=(CASE WHEN m.from_id=? THEN m.to_id ELSE m.from_id END) WHERE m.id IN (SELECT MAX(id) FROM messages WHERE from_id=? OR to_id=? GROUP BY (CASE WHEN from_id=? THEN to_id ELSE from_id END)) AND u.banned=0 AND u.id NOT IN (SELECT to_id FROM blocks WHERE from_id=?) ORDER BY m.id DESC`, user.id, user.id, user.id, user.id, user.id) }), { auth: 1 });
R('GET', '/api/messages/:id', ({ user, p, url }) => {
  const o = getUser(+p[0]), after = +url.searchParams.get('after') || 0;
  if (isBlocked(user.id, o.id)) bad('Conversation indisponible', 403);
  return { with: pub(o), messages: q('SELECT id,from_id,body,created FROM messages WHERE id>? AND ((from_id=? AND to_id=?) OR (from_id=? AND to_id=?)) ORDER BY id LIMIT 200', after, user.id, o.id, o.id, user.id) };
}, { auth: 1 });
R('POST', '/api/messages/:id', ({ user, p, body, ip }) => {
  if (limited(ip + user.id, 'msg', 40, 6e4)) bad('Vous envoyez trop de messages', 429);
  const o = getUser(+p[0]); if (o.id === user.id || isBlocked(user.id, o.id)) bad('Envoi impossible', 403);
  const r = run('INSERT INTO messages(from_id,to_id,body,created) VALUES(?,?,?,?)', user.id, o.id, str(body.body, 1, 1000, 'Message'), now());
  return { id: Number(r.lastInsertRowid) };
}, { auth: 1 });

R('GET', '/api/moments', ({ user }) => ({ moments: q(`SELECT m.id,m.body,m.created,u.id uid,u.name,(SELECT COUNT(*) FROM moment_likes WHERE moment_id=m.id) likes,(SELECT COUNT(*) FROM comments WHERE moment_id=m.id) comments,EXISTS(SELECT 1 FROM moment_likes WHERE moment_id=m.id AND user_id=?) liked FROM moments m JOIN users u ON u.id=m.user_id WHERE u.banned=0 AND u.id NOT IN (SELECT to_id FROM blocks WHERE from_id=?) AND u.id NOT IN (SELECT from_id FROM blocks WHERE to_id=?) ORDER BY m.id DESC LIMIT 50`, user.id, user.id, user.id) }), { auth: 1 });
R('POST', '/api/moments', ({ user, body, ip }) => {
  if (limited(ip + user.id, 'mom', 20, 36e5)) bad('Limite de publications atteinte', 429);
  const r = run('INSERT INTO moments(user_id,body,created) VALUES(?,?,?)', user.id, str(body.body, 1, 500, 'Publication'), now());
  return { id: Number(r.lastInsertRowid) };
}, { auth: 1 });
R('POST', '/api/moments/:id/like', ({ user, p }) => {
  if (!one('SELECT 1 x FROM moments WHERE id=?', +p[0])) bad('Introuvable', 404);
  const d = run('DELETE FROM moment_likes WHERE moment_id=? AND user_id=?', +p[0], user.id);
  if (!d.changes) run('INSERT INTO moment_likes VALUES(?,?)', +p[0], user.id);
  return { liked: !d.changes };
}, { auth: 1 });
R('GET', '/api/moments/:id/comments', ({ p }) => ({ comments: q('SELECT c.id,c.body,c.created,u.name FROM comments c JOIN users u ON u.id=c.user_id WHERE c.moment_id=? AND u.banned=0 ORDER BY c.id LIMIT 100', +p[0]) }), { auth: 1 });
R('POST', '/api/moments/:id/comments', ({ user, p, body }) => {
  if (!one('SELECT 1 x FROM moments WHERE id=?', +p[0])) bad('Introuvable', 404);
  run('INSERT INTO comments(moment_id,user_id,body,created) VALUES(?,?,?,?)', +p[0], user.id, str(body.body, 1, 300, 'Commentaire'), now()); return { ok: true };
}, { auth: 1 });
R('DELETE', '/api/moments/:id', ({ user, p }) => {
  const m = one('SELECT * FROM moments WHERE id=?', +p[0]) || bad('Introuvable', 404);
  if (m.user_id !== user.id && user.role !== 'admin') bad('Interdit', 403);
  tx(() => { run('DELETE FROM comments WHERE moment_id=?', m.id); run('DELETE FROM moment_likes WHERE moment_id=?', m.id); run('DELETE FROM moments WHERE id=?', m.id); }); return { ok: true };
}, { auth: 1 });

R('GET', '/api/wallet', ({ user }) => ({ coins: user.coins, diamonds: user.diamonds, gifts: Object.entries(GIFTS).map(([id, g]) => ({ id, icon: g[0], name: g[1], price: g[2] })), history: q('SELECT coins,diamonds,reason,created FROM ledger WHERE user_id=? ORDER BY id DESC LIMIT 30', user.id) }), { auth: 1 });
R('POST', '/api/gifts/send', ({ user, body }) => {
  const g = GIFTS[body.gift] || bad('Cadeau inconnu'), to = getUser(+body.to);
  if (to.id === user.id || isBlocked(user.id, to.id)) bad('Envoi impossible', 403);
  return tx(() => {  // débit/crédit atomiques
    const me = one('SELECT coins FROM users WHERE id=?', user.id);
    if (me.coins < g[2]) bad('Pas assez de V-Coins', 402);
    const dia = Math.floor(g[2] * CREATOR_SHARE);
    run('UPDATE users SET coins=coins-? WHERE id=?', g[2], user.id); run('UPDATE users SET diamonds=diamonds+? WHERE id=?', dia, to.id);
    run('INSERT INTO ledger(user_id,coins,reason,ref,created) VALUES(?,?,?,?,?)', user.id, -g[2], 'gift_sent', String(to.id), now());
    run('INSERT INTO ledger(user_id,diamonds,reason,ref,created) VALUES(?,?,?,?,?)', to.id, dia, 'gift_received', String(user.id), now());
    run('INSERT INTO messages(from_id,to_id,body,created) VALUES(?,?,?,?)', user.id, to.id, `${g[0]} ${g[1]}`, now());
    return { coins: me.coins - g[2] };
  });
}, { auth: 1 });
R('POST', '/api/wallet/checkout', () => {
  // POINT D'INTÉGRATION PAIEMENT : créer ici une session Stripe/Mobile Money, puis créditer via webhook signé.
  if (!process.env.PAYMENT_PROVIDER) bad("Paiements non configurés (voir DEPLOY.md, section Paiements)", 501);
  bad('Fournisseur de paiement à implémenter', 501);
}, { auth: 1 });
R('GET', '/api/live/token', () => {
  // POINT D'INTÉGRATION VOCAL/VIDÉO : générer ici un jeton LiveKit/Agora signé côté serveur.
  if (!process.env.LIVEKIT_API_KEY) bad('Chat vocal/vidéo non configuré (voir DEPLOY.md, section Temps réel)', 501);
  bad('Fournisseur temps réel à implémenter', 501);
}, { auth: 1 });

R('GET', '/api/admin/stats', () => ({ users: one('SELECT COUNT(*) n FROM users').n, banned: one('SELECT COUNT(*) n FROM users WHERE banned=1').n, moments: one('SELECT COUNT(*) n FROM moments').n, messages: one('SELECT COUNT(*) n FROM messages').n, openReports: one("SELECT COUNT(*) n FROM reports WHERE status='open'").n }), { auth: 1, admin: 1 });
R('GET', '/api/admin/reports', () => ({ reports: q("SELECT r.*,u.name reporter_name FROM reports r JOIN users u ON u.id=r.reporter WHERE status='open' ORDER BY r.id DESC LIMIT 100") }), { auth: 1, admin: 1 });
R('POST', '/api/admin/ban/:id', ({ p }) => { run("UPDATE users SET banned=1 WHERE id=? AND role!='admin'", +p[0]); return { ok: true }; }, { auth: 1, admin: 1 });
R('POST', '/api/admin/reports/:id/resolve', ({ p }) => { run("UPDATE reports SET status='closed' WHERE id=?", +p[0]); return { ok: true }; }, { auth: 1, admin: 1 });

// ---------- serveur ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
const SEC = { 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer', 'Permissions-Policy': 'camera=(self), microphone=(self), geolocation=()', 'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' wss: https:; frame-ancestors 'none'", ...(PROD ? { 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains' } : {}) };
// Version « fichiers à plat » : seuls ces fichiers sont servis (server.js et la base ne le sont jamais).
const FILES = { '/': 'index.html', '/index.html': 'index.html', '/app.js': 'app.js', '/styles.css': 'styles.css', '/extra.css': 'extra.css', '/icon.svg': 'icon.svg', '/manifest.webmanifest': 'manifest.webmanifest', '/legal/cgu.html': 'legal-cgu.html', '/legal/privacy.html': 'legal-privacy.html' };

const server = http.createServer(async (req, res) => {
  for (const [k, v] of Object.entries(SEC)) res.setHeader(k, v);
  const ip = (TRUST_PROXY && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || '?';
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname.startsWith('/api/') || url.pathname === '/healthz') {
      if (limited(ip, 'all', 300, 6e4)) bad('Trop de requêtes', 429);
      const route = routes.find(r => r.m === req.method && r.re.test(url.pathname));
      if (!route) bad('Route introuvable', 404);
      const ctx = { ip, url, p: url.pathname.match(route.re).slice(1), body: ['POST', 'PATCH', 'DELETE', 'PUT'].includes(req.method) ? await readBody(req) : {} };
      if (route.o.auth) {
        const m = /^Bearer (.+)$/.exec(req.headers.authorization || ''), uid = m && verifyTok(m[1]);
        ctx.user = uid && one('SELECT * FROM users WHERE id=?', uid);
        if (!ctx.user) bad('Non connecté', 401);
        if (ctx.user.banned) bad('Compte suspendu', 403);
        if (route.o.admin && ctx.user.role !== 'admin') bad('Interdit', 403);
      }
      return send(res, 200, route.h(ctx));
    }
    const f = path.join(__dirname, FILES[url.pathname] || 'index.html');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': f.endsWith('.html') ? 'no-cache' : 'public, max-age=3600' });
    fs.createReadStream(f).pipe(res);
  } catch (e) {
    if (!(e instanceof HttpError)) console.error(e);
    send(res, e.code || 500, { error: e instanceof HttpError ? e.message : 'Erreur serveur' });
  }
});
if (require.main === module) server.listen(PORT, () => console.log(`VYORA : http://localhost:${PORT}`));
module.exports = { server, db };
