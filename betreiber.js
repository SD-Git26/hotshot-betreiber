'use strict';

// ---------- Betreiber-Seite: alle Vereine verwalten (ohne Ergebnisse der Mitglieder) ----------
// Anmeldung mit dem eigenen Betreiber-Konto (E-Mail-Adresse), siehe supabase/betreiber-einrichten.sql.

const app = document.getElementById('app');

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmtDate(s) {
  if (!s) return '–';
  const [y, m, d] = s.slice(0, 10).split('-');
  return `${d}.${m}.${y}`;
}

let toastTimer = null;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

// Bestätigungsfenster; mit input = true zusätzlich ein Eingabefeld (liefert dann den Text oder null)
function dialog(message, okLabel, { input = false, danger = false } = {}) {
  return new Promise(resolve => {
    const dlg = document.createElement('dialog');
    dlg.className = 'confirm';
    const [title, ...rest] = message.split('\n\n');
    dlg.innerHTML = `
      <p class="confirm-title">${esc(title)}</p>
      ${rest.map(p => `<p class="confirm-text">${esc(p)}</p>`).join('')}
      ${input ? '<input type="text" id="dlg-input" autocomplete="off" style="margin-top:8px">' : ''}
      <div class="actions">
        <button type="button" class="btn" data-answer="no">Abbrechen</button>
        <button type="button" class="btn ${danger ? 'danger-fill' : 'primary'}" data-answer="yes">${esc(okLabel)}</button>
      </div>`;
    const field = () => dlg.querySelector('#dlg-input');
    const finish = yes => {
      const value = input ? (yes ? field().value : null) : yes;
      dlg.close(); dlg.remove(); resolve(value);
    };
    dlg.querySelectorAll('[data-answer]').forEach(b => b.onclick = () => finish(b.dataset.answer === 'yes'));
    dlg.addEventListener('cancel', e => { e.preventDefault(); finish(false); });
    if (input) field().addEventListener('keydown', e => { if (e.key === 'Enter') finish(true); });
    document.body.appendChild(dlg);
    dlg.showModal();
    if (input) field().focus();
  });
}

function setSignedIn(on) {
  document.body.classList.toggle('signed-out', !on);
}

// ---------- Anmeldung ----------

function renderLogin(message) {
  setSignedIn(false);
  if (!Cloud.client) {
    app.innerHTML = `<div class="dash-center card"><h2>Keine Verbindung</h2>
      <p class="hint">Die Supabase-Bibliothek konnte nicht geladen werden. Bitte Internetverbindung prüfen und neu laden.</p></div>`;
    return;
  }
  app.innerHTML = `<div class="dash-center">
    <div class="auth-brand">
      <img src="icons/icon.svg" alt="" width="72" height="72">
      <div class="auth-name">Hot Shot</div>
      <div class="auth-sub">Betreiber</div>
    </div>
    <form class="card" id="login-form" novalidate>
      <h2>Anmelden</h2>
      <p class="hint" style="margin:-6px 0 16px">Nur für das Betreiber-Konto. Vereins-Admins nutzen das Vereins-Dashboard.</p>
      <div class="field">
        <label for="l-email">E-Mail</label>
        <input id="l-email" type="email" autocomplete="username" autocapitalize="none" spellcheck="false">
      </div>
      <div class="field">
        <label for="l-pass">Passwort</label>
        <input id="l-pass" type="password" autocomplete="current-password">
      </div>
      <div class="error" id="l-error" ${message ? '' : 'hidden'}>${esc(message || '')}</div>
      <div class="actions"><button class="btn primary" type="submit" id="l-submit">Anmelden</button></div>
    </form></div>`;
  document.getElementById('l-email').focus();
  document.getElementById('login-form').onsubmit = async e => {
    e.preventDefault();
    const btn = document.getElementById('l-submit');
    btn.disabled = true;
    try {
      const { data, error } = await Cloud.client.auth.signInWithPassword({
        email: document.getElementById('l-email').value.trim().toLowerCase(),
        password: document.getElementById('l-pass').value,
      });
      if (error) throw error;
      await start(data.session.user.id);
    } catch (err) {
      btn.disabled = false;
      const el = document.getElementById('l-error');
      el.hidden = false;
      el.textContent = /invalid login/i.test(String(err.message)) ? 'E-Mail oder Passwort falsch' : Cloud.errorText(err);
    }
  };
}

document.getElementById('logout').onclick = async () => {
  await Cloud.signOut();
  renderLogin();
};

async function start(userId) {
  const me = await Cloud.getProfile(userId);
  if (!me || !me.is_operator) {
    await Cloud.signOut();
    renderLogin('Dieses Konto ist kein Betreiber-Konto.');
    return;
  }
  setSignedIn(true);
  renderClubs();
}

// ---------- Vereine ----------

async function renderClubs() {
  if (!app.querySelector('.operator')) app.innerHTML = '<div class="card empty">Vereine werden geladen …</div>';
  let list;
  try { list = await Cloud.call('operator_clubs'); } catch (e) {
    app.innerHTML = `<div class="card empty">${esc(Cloud.errorText(e))}</div>`;
    return;
  }
  const fresh = list.filter(c => !c.operator_seen).length;
  const members = list.reduce((n, c) => n + Number(c.member_count), 0);
  const rows = list.map(c => `
    <tr>
      <td><div>${esc(c.name)}${c.operator_seen ? '' : ' <span class="badge">neu</span>'}</div>${c.location ? `<div class="dash-meta">${esc(c.location)}</div>` : ''}</td>
      <td>${esc(c.contact_name || '–')}${c.contact_email ? `<div class="dash-meta"><a href="mailto:${esc(c.contact_email)}">${esc(c.contact_email)}</a></div>` : ''}</td>
      <td><span class="club-code">${esc(c.code)}</span></td>
      <td class="num">${c.member_count}</td>
      <td>${esc(c.admins || '–')}</td>
      <td>${fmtDate(c.created_at)}</td>
      <td>${c.status === 'locked' ? '<span class="delta neg">gesperrt</span>' : 'aktiv'}</td>
      <td class="num">
        ${c.operator_seen ? '' : `<button class="btn small" data-op-seen="${c.id}">Gesehen</button>`}
        <button class="btn small" data-op-lock="${c.id}">${c.status === 'locked' ? 'Entsperren' : 'Sperren'}</button>
        <button class="btn small danger" data-op-delete="${c.id}">Löschen</button>
      </td>
    </tr>`).join('');

  app.innerHTML = `
    <div class="operator">
      <div class="card">
        <div class="card-head"><h2>Vereine (${list.length})</h2></div>
        <p class="hint" style="margin:-4px 0 10px">${members} Mitgliedschaften insgesamt${fresh ? ` · ${fresh} neue ${fresh === 1 ? 'Verein' : 'Vereine'} seit dem letzten Ansehen` : ''}. Ergebnisse der Mitglieder sind hier bewusst nicht zu sehen.</p>
        <div class="table-wrap">
          <table class="data">
            <thead><tr><th>Verein</th><th>Ansprechpartner</th><th>Code</th><th class="num">Mitglieder</th><th>Admins</th><th>Angelegt</th><th>Status</th><th class="num">Aktionen</th></tr></thead>
            <tbody>${rows || '<tr><td colspan="8" class="dash-meta">Noch keine Vereine.</td></tr>'}</tbody>
          </table>
        </div>
        <div class="actions"><button class="btn" id="op-refresh">Aktualisieren</button></div>
      </div>
      <div class="card narrow">
        <h2>Hilfe für Vereine</h2>
        <p class="hint" style="margin:-4px 0 14px">Für Fälle, die ein Vereins-Admin nicht selbst lösen kann – z. B. ein Mitglied in mehreren Vereinen hat sein Passwort vergessen, oder ein Verein hat keinen Admin mehr.</p>
        <div class="form-grid">
          <div class="field">
            <label for="op-user">Benutzername</label>
            <input id="op-user" autocomplete="off" autocapitalize="none" spellcheck="false">
          </div>
          <div class="field">
            <label for="op-club">Verein</label>
            <select id="op-club">${list.map(c => `<option value="${c.id}">${esc(c.name)}${c.location ? ` (${esc(c.location)})` : ''}</option>`).join('')}</select>
          </div>
        </div>
        <div class="actions">
          <button class="btn" id="op-reset">Passwort zurücksetzen</button>
          <button class="btn" id="op-admin">Im gewählten Verein zum Admin machen</button>
        </div>
      </div>
    </div>`;

  const byId = id => list.find(c => c.id === id);
  const act = async (fn, args, ok) => {
    try { await Cloud.call(fn, args); toast(ok); renderClubs(); } catch (e) { toast(Cloud.errorText(e)); }
  };
  document.getElementById('op-refresh').onclick = () => renderClubs();
  app.querySelectorAll('[data-op-seen]').forEach(b => b.onclick = () => {
    const c = byId(b.dataset.opSeen);
    act('operator_update_club', { club: c.id, new_status: c.status, seen: true }, 'Als gesehen markiert');
  });
  app.querySelectorAll('[data-op-lock]').forEach(b => b.onclick = async () => {
    const c = byId(b.dataset.opLock);
    const lock = c.status !== 'locked';
    if (lock && !(await dialog(`„${c.name}“ sperren?\n\nDie Admins kommen nicht mehr ins Dashboard und niemand kann mehr mit dem Vereinscode beitreten. Die Mitglieder können die App weiter benutzen.`, 'Sperren', { danger: true }))) return;
    act('operator_update_club', { club: c.id, new_status: lock ? 'locked' : 'active', seen: true }, lock ? 'Verein gesperrt' : 'Verein entsperrt');
  });
  app.querySelectorAll('[data-op-delete]').forEach(b => b.onclick = async () => {
    const c = byId(b.dataset.opDelete);
    const typed = await dialog(`„${c.name}“ endgültig löschen?\n\nDer Verein und alle Mitgliedschaften werden gelöscht. Die Konten der Mitglieder und ihre eigenen Ergebnisse bleiben erhalten.\n\nZum Bestätigen den Vereinsnamen eintippen:`, 'Endgültig löschen', { input: true, danger: true });
    if (typed === null) return;
    if (typed.trim() !== c.name) { toast('Der Name stimmt nicht – nichts gelöscht'); return; }
    act('operator_delete_club', { club: c.id }, 'Verein gelöscht');
  });
  const user = () => document.getElementById('op-user').value.trim();
  document.getElementById('op-reset').onclick = async () => {
    if (!user()) { toast('Bitte einen Benutzernamen eingeben'); return; }
    const pw = await dialog(`Neues Passwort für ${user()}\n\nMindestens 6 Zeichen. Teile es der Person persönlich mit.`, 'Passwort setzen', { input: true });
    if (pw === null) return;
    act('operator_reset_password', { target_username: user(), new_password: pw }, 'Passwort geändert');
  };
  document.getElementById('op-admin').onclick = () => {
    if (!user()) { toast('Bitte einen Benutzernamen eingeben'); return; }
    const club = document.getElementById('op-club').value;
    act('operator_set_admin', { club, target_username: user(), value: true }, `${user()} ist jetzt Admin`);
  };
}

// ---------- Start ----------

async function boot() {
  if (!Cloud.client) { renderLogin(); return; }
  const session = await Cloud.getSession().catch(() => null);
  if (!session) { renderLogin(); return; }
  try {
    await start(session.user.id);
  } catch (e) {
    renderLogin(Cloud.errorText(e));
  }
}

boot();
