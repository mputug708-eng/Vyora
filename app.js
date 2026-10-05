'use strict';
const $ = s => document.querySelector(s), root = $('#root');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let token = null, me = null, route = 'discover', chatWith = null, lastMsg = 0, timer = null, authMode = 'login';
try { token = localStorage.getItem('vyora_token'); } catch {}
const ST = { token: t => { token = t; try { t ? localStorage.setItem('vyora_token', t) : localStorage.removeItem('vyora_token'); } catch {} } };
async function api(path, method = 'GET', body) {
  const r = await fetch('/api' + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && token) { ST.token(null); me = null; boot(); }
  if (!r.ok) throw new Error(j.error || 'Erreur ' + r.status);
  return j;
}
const toast = t => { const d = document.createElement('div'); d.className = 'toast'; d.textContent = t; document.body.appendChild(d); setTimeout(() => d.remove(), 2500); };
const guard = async fn => { try { return await fn(); } catch (e) { toast(e.message); } };
const NAV = [['discover', '♡', 'Match'], ['moments', '◈', 'Moments'], ['messages', '☷', 'Messages'], ['live', '▣', 'Live & Chat'], ['wallet', '🪙', 'Portefeuille'], ['profile', '●', 'Profil']];
const head = (t, s) => `<div class="page-head"><div><div class="eyebrow">VYORA</div><h1>${t}</h1><p>${s}</p></div></div>`;
const time = ts => new Date(ts).toLocaleString([], { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });

function authView() {
  const reg = authMode === 'register';
  root.innerHTML = `<div class="auth-screen"><div class="auth-visual g3"><div class="vmark giant">V</div><h1>VYORA</h1><p>Meet. Live. Connect.</p></div><div class="auth-box"><h2>${reg ? 'Créer mon compte' : 'Bienvenue sur VYORA !'}</h2><div class="form">
  ${reg ? '<input id="f_name" placeholder="Pseudo" maxlength="24">' : ''}<input id="f_email" type="email" placeholder="E-mail" autocomplete="email"><input id="f_pw" type="password" placeholder="Mot de passe (8 caractères min.)" autocomplete="${reg ? 'new-password' : 'current-password'}">
  ${reg ? `<label>Date de naissance (18+)<input id="f_birth" type="date"></label><select id="f_gender"><option value="female">Femme</option><option value="male">Homme</option><option value="other">Autre</option></select><input id="f_country" placeholder="Pays (code 2 lettres, ex. FR, CD, CA)" maxlength="2"><label class="check"><input id="f_terms" type="checkbox"><span class="legal">J'ai 18 ans ou plus et j'accepte les <a href="/legal/cgu.html" target="_blank">conditions d'utilisation</a> et la <a href="/legal/privacy.html" target="_blank">politique de confidentialité</a>.</span></label>` : ''}
  <div class="err" id="err"></div><button class="pink full" data-act="${reg ? 'register' : 'login'}">${reg ? 'Créer mon compte' : 'Se connecter'}</button><button class="secondary full" data-act="toggleAuth">${reg ? "J'ai déjà un compte" : 'Créer un compte'}</button></div></div></div>`;
}
function shell() {
  const nav = NAV.concat(me.role === 'admin' ? [['admin', '⚙', 'Admin']] : []);
  root.innerHTML = `<div class="app-shell"><header class="topbar"><div class="brand"><div class="vmark">V</div><div><strong>VYORA</strong><small>Meet. Live. Connect.</small></div></div><div class="top-actions"><button class="icon-btn" data-go="wallet">🪙 <b id="coins">${me.coins}</b></button><div class="mini-avatar">${esc(me.name[0].toUpperCase())}</div></div></header><div class="body"><aside class="sidebar"><div class="side-label">VYORA</div>${nav.map(n => `<button class="side-item ${route === n[0] ? 'on' : ''}" data-go="${n[0]}"><span>${n[1]}</span><span>${n[2]}</span></button>`).join('')}</aside><main id="main"></main></div><nav class="bottom-nav">${nav.slice(0, 6).map(n => `<button class="bn ${route === n[0] ? 'on' : ''}" data-go="${n[0]}"><b>${n[1]}</b><small>${n[2]}</small></button>`).join('')}</nav></div>`;
  draw();
}
function go(r, opts = {}) { clearInterval(timer); route = r; if (opts.chat) chatWith = opts.chat; shell(); }
async function draw() { const m = $('#main'); await guard(async () => { await VIEWS[route](m); }); }

const VIEWS = {
  async discover(m, g = '') {
    const { users } = await api('/discover' + (g ? '?gender=' + g : ''));
    m.innerHTML = head('Rencontres ♡', 'Découvre des personnes et fais des matchs.') + `<div class="row" style="margin-bottom:14px"><select id="gfilter"><option value="">Tous</option><option value="female">Femmes</option><option value="male">Hommes</option><option value="other">Autres</option></select></div>` +
      (users.length ? `<div class="ugrid">${users.map(u => `<div class="ucard"><div class="avatar-big">${esc(u.name[0].toUpperCase())}</div><h3>${esc(u.name)}, ${u.age}</h3><small>${esc(u.country || '')} ${esc(u.bio || '')}</small><div class="row"><button class="pink" data-act="like" data-id="${u.id}">${u.liked ? '♥ Aimé' : '♡ J\'aime'}</button><button data-act="chat" data-id="${u.id}">💬</button><button data-act="report" data-id="${u.id}">⚑</button><button data-act="block" data-id="${u.id}">⛔</button></div></div>`).join('')}</div>` : '<div class="panel">Aucun profil pour le moment. Invitez vos amis à rejoindre VYORA !</div>');
    $('#gfilter').value = g; $('#gfilter').onchange = e => guard(() => VIEWS.discover(m, e.target.value));
  },
  async moments(m) {
    const { moments } = await api('/moments');
    m.innerHTML = head('Moments ✨', 'Partage ce que tu vis avec la communauté.') + `<div class="compose"><input id="mtext" maxlength="500" placeholder="Quoi de neuf ?"><button class="pink" data-act="post">Publier</button></div>` +
      (moments.map(p => `<div class="post"><b>${esc(p.name)}</b> <small>${time(p.created)}</small><p>${esc(p.body)}</p><div class="row"><button data-act="mlike" data-id="${p.id}">${p.liked ? '♥' : '♡'} ${p.likes}</button><button data-act="comments" data-id="${p.id}">💬 ${p.comments}</button>${p.uid === me.id || me.role === 'admin' ? `<button data-act="mdel" data-id="${p.id}">🗑</button>` : `<button data-act="mreport" data-id="${p.id}">⚑</button>`}</div><div id="c${p.id}"></div></div>`).join('') || '<div class="panel">Sois le premier à publier un Moment !</div>');
  },
  async messages(m) {
    const { conversations } = await api('/conversations');
    m.innerHTML = head('Messages 💬', 'Tes conversations.') + `<div class="messages-layout"><div class="panel contacts">${conversations.map(c => `<button class="contact" data-act="chat" data-id="${c.id}"><span class="contact-pic g2">${esc(c.name[0].toUpperCase())}</span><span><b>${esc(c.name)}</b><small>${esc(c.body)}</small></span></button>`).join('') || '<small>Aucune conversation. Va dans Match pour écrire à quelqu\'un.</small>'}</div><div class="panel chat" id="chatbox">${chatWith ? '' : '<small>Choisis une conversation.</small>'}</div></div>`;
    if (chatWith) openChat(chatWith);
  },
  async live(m) {
    let ok = false; try { await api('/live/token'); ok = true; } catch (e) { var msg = e.message; }
    m.innerHTML = head('Live & Chat vocal/vidéo ▣', 'Appels et salons en temps réel.') + `<div class="panel"><b>${ok ? 'Prêt' : 'Non activé sur ce serveur'}</b><p>${esc(ok ? '' : msg)}</p><p><small>Voir DEPLOY.md → « Temps réel » pour brancher LiveKit ou Agora.</small></p></div>`;
  },
  async wallet(m) {
    const w = await api('/wallet'); me.coins = w.coins;
    m.innerHTML = head('Mon portefeuille 🪙', 'Tes V-Coins et tes revenus créateur.') + `<div class="wallet-cards"><div class="money-card coins-card"><span>Mes V-Coins</span><strong>${w.coins}</strong><button data-act="buy">Recharger</button></div><div class="money-card diamond-card"><span>Diamants</span><strong>${w.diamonds}</strong></div></div><div class="panel"><h3>Historique</h3><div class="transactions">${w.history.map(h => `<div><b>${esc(h.reason)}</b><small>${time(h.created)}</small><strong>${h.coins ? h.coins : '+' + h.diamonds + ' 💎'}</strong></div>`).join('') || '<small>Aucune transaction.</small>'}</div></div>`;
    window._gifts = w.gifts;
  },
  async profile(m) {
    const { user } = await api('/me'); me = user;
    m.innerHTML = head('Mon profil ●', esc(user.email)) + `<div class="panel form"><label>Bio<textarea id="pbio" maxlength="300" rows="3">${esc(user.bio)}</textarea></label><label>Pays (code 2 lettres)<input id="pcountry" maxlength="2" value="${esc(user.country || '')}"></label><button class="pink" data-act="saveProfile">Enregistrer</button><button class="secondary" data-act="logout">Se déconnecter</button><hr><p class="legal"><a href="/legal/cgu.html" target="_blank">Conditions</a> · <a href="/legal/privacy.html" target="_blank">Confidentialité</a></p><button data-act="delete">Supprimer mon compte et mes données</button></div>`;
  },
  async admin(m) {
    const [s, r] = await Promise.all([api('/admin/stats'), api('/admin/reports')]);
    m.innerHTML = head('Administration ⚙', 'Modération et statistiques.') + `<div class="panel"><b>${s.users}</b> utilisateurs · <b>${s.banned}</b> bannis · <b>${s.moments}</b> moments · <b>${s.messages}</b> messages · <b>${s.openReports}</b> signalements ouverts</div>` + r.reports.map(x => `<div class="post"><b>${esc(x.kind)} #${x.target}</b> — ${esc(x.reason)}<br><small>par ${esc(x.reporter_name)} · ${time(x.created)}</small><div class="row">${x.kind === 'user' ? `<button data-act="ban" data-id="${x.target}">Bannir</button>` : ''}<button data-act="resolve" data-id="${x.id}">Classer</button></div></div>`).join('');
  }
};
async function openChat(id) {
  chatWith = id; lastMsg = 0; const box = $('#chatbox'); if (!box) return;
  const first = await api('/messages/' + id);
  box.innerHTML = `<div class="chat-head"><b>${esc(first.with.name)}</b></div><div class="giftbar">${(window._gifts || []).map(g => `<button data-act="gift" data-gift="${g.id}">${g.icon} ${g.price}</button>`).join('')}</div><div class="chat-body" id="cb"></div><div class="compose"><input id="mi" maxlength="1000" placeholder="Écrire un message…"><button class="pink" data-act="send">Envoyer</button></div>`;
  if (!window._gifts) { try { window._gifts = (await api('/wallet')).gifts; openChat(id); return; } catch {} }
  const add = list => { const cb = $('#cb'); if (!cb) return; list.forEach(x => { cb.insertAdjacentHTML('beforeend', `<div class="bubble ${x.from_id === me.id ? 'me' : ''}">${esc(x.body)}</div>`); lastMsg = x.id; }); if (list.length) cb.scrollTop = cb.scrollHeight; };
  add(first.messages);
  clearInterval(timer);
  timer = setInterval(async () => { if (route !== 'messages') return clearInterval(timer); try { add((await api(`/messages/${id}?after=${lastMsg}`)).messages); } catch {} }, 3000);
  window._add = add;
}

const ACT = {
  toggleAuth() { authMode = authMode === 'login' ? 'register' : 'login'; authView(); },
  async login() { await doAuth('/auth/login', { email: $('#f_email').value, password: $('#f_pw').value }); },
  async register() { await doAuth('/auth/register', { name: $('#f_name').value, email: $('#f_email').value, password: $('#f_pw').value, birth: $('#f_birth').value, gender: $('#f_gender').value, country: $('#f_country').value, terms: $('#f_terms').checked }); },
  async like(b) { const r = await api('/like/' + b.dataset.id, 'POST'); toast(r.match ? "C'est un match 🎉" : 'Like envoyé'); b.textContent = '♥ Aimé'; },
  chat(b) { go('messages', { chat: +b.dataset.id }); },
  async block(b) { if (confirm('Bloquer cet utilisateur ?')) { await api('/block/' + b.dataset.id, 'POST'); draw(); } },
  async report(b) { const reason = prompt('Motif du signalement ?'); if (reason) { await api('/report', 'POST', { kind: 'user', target: +b.dataset.id, reason }); toast('Signalement envoyé'); } },
  async mreport(b) { const reason = prompt('Motif du signalement ?'); if (reason) { await api('/report', 'POST', { kind: 'moment', target: +b.dataset.id, reason }); toast('Signalement envoyé'); } },
  async post() { const v = $('#mtext').value.trim(); if (v) { await api('/moments', 'POST', { body: v }); draw(); } },
  async mlike(b) { await api(`/moments/${b.dataset.id}/like`, 'POST'); draw(); },
  async mdel(b) { if (confirm('Supprimer ?')) { await api('/moments/' + b.dataset.id, 'DELETE'); draw(); } },
  async comments(b) { const id = b.dataset.id, { comments } = await api(`/moments/${id}/comments`); $('#c' + id).innerHTML = comments.map(c => `<div class="cm"><b>${esc(c.name)}</b> ${esc(c.body)}</div>`).join('') + `<div class="compose"><input id="ci${id}" maxlength="300" placeholder="Commenter…"><button data-act="comment" data-id="${id}">OK</button></div>`; },
  async comment(b) { const v = $('#ci' + b.dataset.id).value.trim(); if (v) { await api(`/moments/${b.dataset.id}/comments`, 'POST', { body: v }); draw(); } },
  async send() { const i = $('#mi'), v = i.value.trim(); if (!v) return; await api('/messages/' + chatWith, 'POST', { body: v }); i.value = ''; window._add((await api(`/messages/${chatWith}?after=${lastMsg}`)).messages); },
  async gift(b) { const r = await api('/gifts/send', 'POST', { to: chatWith, gift: b.dataset.gift }); me.coins = r.coins; $('#coins').textContent = r.coins; window._add((await api(`/messages/${chatWith}?after=${lastMsg}`)).messages); },
  async buy() { await api('/wallet/checkout', 'POST', {}); },
  async saveProfile() { await api('/me', 'PATCH', { bio: $('#pbio').value, country: $('#pcountry').value }); toast('Profil enregistré'); },
  logout() { ST.token(null); me = null; boot(); },
  async delete() { const pw = prompt('Confirme avec ton mot de passe. Cette action est définitive.'); if (pw) { await api('/me', 'DELETE', { password: pw }); ACT.logout(); } },
  async ban(b) { if (confirm('Bannir cet utilisateur ?')) { await api('/admin/ban/' + b.dataset.id, 'POST'); draw(); } },
  async resolve(b) { await api(`/admin/reports/${b.dataset.id}/resolve`, 'POST'); draw(); }
};
async function doAuth(p, body) { try { const r = await api(p, 'POST', body); ST.token(r.token); me = r.user; route = 'discover'; shell(); } catch (e) { const el = $('#err'); if (el) el.textContent = e.message; } }
document.addEventListener('click', e => {
  const g = e.target.closest('[data-go]'); if (g) return go(g.dataset.go);
  const a = e.target.closest('[data-act]'); if (a && ACT[a.dataset.act]) guard(() => ACT[a.dataset.act](a));
});
document.addEventListener('keydown', e => { if (e.key === 'Enter') { if (e.target.id === 'mi') ACT.send(); if (e.target.id === 'f_pw' && authMode === 'login') guard(ACT.login); } });
async function boot() { if (!token) return authView(); try { me = (await api('/me')).user; shell(); } catch { authView(); } }
boot();
