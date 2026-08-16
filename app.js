/* ============================================================
   CCI Artist Alley Management — Tracker & Multi-City Fetcher
   ============================================================ */

'use strict';

// ============================================================
// CONFIGURATION
// ============================================================
const SHEET_ID = '1H7_Vdsuq8B3Bp-f00CLRxUyDPk1QiWxLfwnhJaEmmR0';

// City mapping corresponding to Columns I to V (Indices 8 to 21) in Tracker
const CITY_COLUMNS = [
  { key: 'VCC',  city: 'Vizag',       colIndex: 8  }, // Col I
  { key: 'HCC',  city: 'Hyderabad',   colIndex: 9  }, // Col J
  { key: 'NMCC', city: 'Navi Mumbai', colIndex: 10 }, // Col K
  { key: 'DCC',  city: 'Delhi',       colIndex: 11 }, // Col L
  { key: 'JCC',  city: 'Jaipur',      colIndex: 12 }, // Col M
  { key: 'ICC',  city: 'Indore',      colIndex: 13 }, // Col N
  { key: 'CCC',  city: 'Chennai',     colIndex: 14 }, // Col O
  { key: 'KoCC', city: 'Kochi',       colIndex: 15 }, // Col P
  { key: 'PCC',  city: 'Pune',        colIndex: 16 }, // Col Q
  { key: 'BCC',  city: 'Bengaluru',   colIndex: 17 }, // Col R
  { key: 'GCC',  city: 'Guwahati',    colIndex: 18 }, // Col S
  { key: 'KCC',  city: 'Kolkata',     colIndex: 19 }, // Col T
  { key: 'GGCC', city: 'Gurugram',    colIndex: 20 }, // Col U
  { key: 'MCC',  city: 'Mumbai',      colIndex: 21 }, // Col V
];

const PROXIES = [
  u => u,
  u => `https://corsproxy.io/?${encodeURIComponent(u)}`,
  u => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
];

const GRADS = [
  ['#7c3aed','#a855f7'],['#0e7490','#06b6d4'],['#be123c','#f43f5e'],
  ['#065f46','#10b981'],['#7e22ce','#6366f1'],['#92400e','#f59e0b'],
  ['#1e3a8a','#3b82f6'],['#4a1d96','#8b5cf6'],['#134e4a','#14b8a6'],
  ['#78350f','#fb923c'],
];

// ============================================================
// STATE
// ============================================================
let allArtists      = [];
let filteredArtists = [];
let showData        = {}; // showKey -> artist list from city sheet
let currentView     = 'grid';
let mainView        = 'database';
let sortCol         = 'slNo';
let sortDir         = 'asc';

// ============================================================
// HELPERS
// ============================================================
const initials = n => n ? n.split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase() : '?';
const grad     = n => GRADS[[...n].reduce((a, c) => a + c.charCodeAt(0), 0) % GRADS.length];
const bool     = v => { if (typeof v !== 'string') return !!v; const s = v.trim().toUpperCase(); return s === 'TRUE' || s === 'YES' || s === '1'; };
const esc      = s => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ============================================================
// CSV PARSER
// ============================================================
function parseCSV(raw) {
  const rows = []; let row = [], field = '', inQ = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i], n = raw[i + 1];
    if (inQ) {
      if (c === '"' && n === '"') { field += '"'; i++; }
      else if (c === '"') { inQ = false; }
      else { field += c; }
    } else {
      if (c === '"') { inQ = true; }
      else if (c === ',') { row.push(field.trim()); field = ''; }
      else if (c === '\n') {
        row.push(field.trim()); field = '';
        if (row.length) rows.push(row); row = [];
      } else if (c !== '\r') { field += c; }
    }
  }
  if (field || row.length) { row.push(field.trim()); if (row.some(c => c !== '')) rows.push(row); }
  return rows;
}

// ============================================================
// FETCH ENGINE
// ============================================================
async function fetchTabCSV(sheetName) {
  const target = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`;
  let lastErr;
  for (const proxy of PROXIES) {
    const url = proxy(target);
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 8000);
      const res = await fetch(url, { cache: 'no-store', signal: ctrl.signal });
      clearTimeout(t);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      if (text.length > 20) return text;
    } catch (e) { lastErr = e; }
  }
  throw new Error(lastErr?.message || 'Fetch failed');
}

// ============================================================
// LOAD MASTER DATA FROM TRACKER SHEET
// ============================================================
async function loadAllData() {
  const btn = document.getElementById('refreshBtn');
  if (btn) { btn.classList.add('spin'); btn.disabled = true; }

  try {
    // 1. Fetch Master Tracker Tab
    const trackerText = await fetchTabCSV('Tracker');
    const rows = parseCSV(trackerText);
    
    // Header check
    let startIdx = 0;
    if (rows[0] && !rows[0].join('').toLowerCase().includes('brand')) {
      startIdx = 1;
    }

    const dataRows = rows.slice(startIdx + 1).filter(r => r[1] && r[1].trim());

    // Parse artists and check columns I to V for checked cities
    allArtists = dataRows.map((r, i) => {
      const shows = [];
      
      CITY_COLUMNS.forEach(c => {
        const val = r[c.colIndex];
        if (bool(val)) {
          shows.push(c.key);
        }
      });

      return {
        id:            i,
        slNo:          parseInt(r[0]) || (i + 1),
        brandName:     r[1]?.trim() || '',
        poc:           r[2]?.trim() || '',
        email:         r[3]?.trim() || '',
        consentSent:   bool(r[4]),
        gstReceived:   bool(r[5]),
        bookLaunch:    bool(r[6]),
        stageActivity: r[7]?.trim() || '',
        shows:         shows,
        isOnboarded:   shows.length > 0 // False if no checkbox is checked in columns I-V
      };
    });

    // 2. Fetch details from individual City Sheets
    const cityPromises = CITY_COLUMNS.map(async (city) => {
      try {
        const csv = await fetchTabCSV(city.key);
        const cityRows = parseCSV(csv);
        let cStart = 0;
        if (cityRows[0] && !cityRows[0].join('').toLowerCase().includes('brand')) cStart = 1;

        showData[city.key] = cityRows.slice(cStart + 1)
          .filter(r => r[1] && r[1].trim())
          .map((r, idx) => ({
            slNo:          parseInt(r[0]) || (idx + 1),
            brandName:     r[1]?.trim() || '',
            poc:           r[2]?.trim() || '',
            email:         r[3]?.trim() || '',
            consentSent:   bool(r[4]),
            gstReceived:   bool(r[5]),
            bookLaunch:    bool(r[6]),
            stageActivity: r[7]?.trim() || '',
          }));
          
        // Merge compliance details back into master artist profiles
        showData[city.key].forEach(cArtist => {
          const match = allArtists.find(a => 
            (a.email && cArtist.email && a.email.toLowerCase() === cArtist.email.toLowerCase()) ||
            (a.brandName.toLowerCase() === cArtist.brandName.toLowerCase())
          );

          if (match) {
            if (cArtist.consentSent) match.consentSent = true;
            if (cArtist.gstReceived) match.gstReceived = true;
            if (cArtist.bookLaunch)  match.bookLaunch  = true;
            if (cArtist.stageActivity && !match.stageActivity) match.stageActivity = cArtist.stageActivity;
          }
        });
      } catch (e) {
        console.warn(`[CCI] Could not fetch city sheet ${city.key}:`, e.message);
        showData[city.key] = [];
      }
    });

    await Promise.all(cityPromises);

    // Update stats
    const onboardedCount = allArtists.filter(a => a.isOnboarded).length;
    document.getElementById('sv-db').textContent = allArtists.length;
    document.getElementById('sv-onboarded').textContent = onboardedCount;

    populateShowFilter();
    applyFilters();
    hideLoading();

    document.getElementById('lastUpdated').textContent = 'Updated ' +
      new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

  } catch (err) {
    console.error('[CCI] Critical load error:', err);
    showToast('⚠️ Could not load sheet data: ' + err.message);
    hideLoading();
  }

  if (btn) { btn.classList.remove('spin'); btn.disabled = false; }
}

// ============================================================
// FILTERS & VIEWS
// ============================================================
function getViewArtists() {
  if (mainView === 'onboarded') return allArtists.filter(a => a.isOnboarded);
  return allArtists;
}

function applyFilters() {
  const q   = document.getElementById('searchInput')?.value.toLowerCase().trim() || '';
  const sf  = document.getElementById('statusFilter')?.value || '';
  const shf = document.getElementById('showFilter')?.value || '';

  let base = getViewArtists();

  filteredArtists = base.filter(a => {
    if (q && !([a.brandName, a.poc, a.email].join(' ').toLowerCase().includes(q))) return false;
    if (sf === 'no-consent'  && a.consentSent)  return false;
    if (sf === 'no-gst'      && a.gstReceived)  return false;
    if (sf === 'book-launch' && !a.bookLaunch)  return false;
    if (sf === 'stage'       && !a.stageActivity) return false;
    if (sf === 'not-onboarded' && a.isOnboarded) return false;
    if (shf && !a.shows.includes(shf))          return false;
    return true;
  });

  filteredArtists.sort((a, b) => {
    let va = a[sortCol] ?? a.slNo;
    let vb = b[sortCol] ?? b.slNo;
    if (typeof va === 'string') va = va.toLowerCase();
    if (typeof vb === 'string') vb = vb.toLowerCase();
    if (va < vb) return sortDir === 'asc' ? -1 : 1;
    if (va > vb) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });

  const label = mainView === 'onboarded' ? 'onboarded' : 'total';
  document.getElementById('resultsBar').innerHTML =
    `Showing <strong>${filteredArtists.length}</strong> of ${base.length} ${label} artists`;

  currentView === 'grid' ? renderGrid() : renderTableView();
}

function populateShowFilter() {
  const sel = document.getElementById('showFilter');
  if (!sel) return;
  sel.innerHTML = '<option value="">All Shows</option>' +
    CITY_COLUMNS.map(s => `<option value="${s.key}">${s.city} (${s.key})</option>`).join('');
}

// ============================================================
// RENDERING CARDS & TABLE
// ============================================================
function showPills(shows, isOnboarded) {
  if (!isOnboarded || shows.length === 0) {
    return `<span class="badge b-pend" style="background:rgba(239,68,68,0.15);color:var(--danger)">Not Onboarded</span>`;
  }
  return shows.map(k => {
    const s = CITY_COLUMNS.find(x => x.key === k);
    return `<span class="badge b-show">${s ? s.city : k}</span>`;
  }).join('');
}

function renderGrid() {
  const g = document.getElementById('artistsGrid');
  if (!filteredArtists.length) {
    g.innerHTML = `<div class="empty"><h3>No artists found</h3></div>`;
    return;
  }
  g.innerHTML = filteredArtists.map((a, i) => buildCard(a, i)).join('');
}

function buildCard(a, i) {
  const [g1, g2] = grad(a.brandName);
  const ini = initials(a.brandName);

  return `
  <div class="artist-card" onclick="openModal(${a.id})" style="animation-delay:${i * 0.025}s">
    <div class="card-num">#${a.slNo}</div>
    <div class="card-head">
      <div class="avatar" style="background:linear-gradient(135deg,${g1},${g2})">${ini}</div>
      <div>
        <div class="card-brand">${esc(a.brandName)}</div>
        <div class="card-poc">${esc(a.poc || '—')}</div>
      </div>
    </div>
    <div class="card-shows">${showPills(a.shows, a.isOnboarded)}</div>
    <div class="card-checks">
      <div class="check-row">
        <div class="chk ${a.consentSent ? 'done' : 'pend'}">${a.consentSent ? '✓' : '○'}</div>
        <span class="check-lbl">Consent</span>
        <span class="check-val ${a.consentSent ? 'done' : 'pend'}">${a.consentSent ? 'Sent' : 'Pending'}</span>
      </div>
      <div class="check-row">
        <div class="chk ${a.gstReceived ? 'done' : 'pend'}">${a.gstReceived ? '✓' : '○'}</div>
        <span class="check-lbl">GST</span>
        <span class="check-val ${a.gstReceived ? 'done' : 'pend'}">${a.gstReceived ? 'Received' : 'Pending'}</span>
      </div>
      ${a.bookLaunch ? `<div class="check-row"><div class="chk done">📖</div><span class="check-lbl" style="color:var(--cyan)">Book Launch</span></div>` : ''}
    </div>
    <div class="card-footer">
      <button class="btn-detail" onclick="event.stopPropagation();openModal(${a.id})">Details →</button>
    </div>
  </div>`;
}

function renderTableView() {
  const tb = document.getElementById('tableBody');
  if (!filteredArtists.length) {
    tb.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:32px;">No artists found</td></tr>`;
    return;
  }
  tb.innerHTML = filteredArtists.map(a => {
    const [g1, g2] = grad(a.brandName);
    const ini = initials(a.brandName);
    const cb = a.consentSent ? `<span class="badge b-ok">Sent</span>` : `<span class="badge b-pend">Pending</span>`;
    const gb = a.gstReceived ? `<span class="badge b-ok">Received</span>` : `<span class="badge b-pend">Pending</span>`;

    return `
    <tr onclick="openModal(${a.id})">
      <td>${a.slNo}</td>
      <td><div style="display:flex;align-items:center;gap:8px">
        <div class="avatar-sm" style="background:linear-gradient(135deg,${g1},${g2})">${ini}</div>
        <span>${esc(a.brandName)}</span>
      </div></td>
      <td>${esc(a.poc || '—')}</td>
      <td>${esc(a.email || '—')}</td>
      <td>${showPills(a.shows, a.isOnboarded)}</td>
      <td>${cb}</td>
      <td>${gb}</td>
      <td>${a.bookLaunch ? '📖 Yes' : '—'}</td>
      <td><button class="btn-detail" onclick="event.stopPropagation();openModal(${a.id})">Details</button></td>
    </tr>`;
  }).join('');
}

// ============================================================
// MODAL DETAILS
// ============================================================
function openModal(id) {
  const a = allArtists.find(x => x.id === id);
  if (!a) return;
  const [g1, g2] = grad(a.brandName);
  const ini = initials(a.brandName);

  const showsHtml = a.isOnboarded && a.shows.length
    ? a.shows.map(k => {
        const s = CITY_COLUMNS.find(x => x.key === k);
        return `<div class="show-list-item">
                  <div class="sli-city">🎪 ${s ? s.city : k} (${k})</div>
                </div>`;
      }).join('')
    : '<div class="no-shows" style="color:var(--danger)">Artist is not onboarded for any city</div>';

  document.getElementById('modalBody').innerHTML = `
  <div class="modal-head">
    <div class="modal-av" style="background:linear-gradient(135deg,${g1},${g2})">${ini}</div>
    <div>
      <div class="modal-name">${esc(a.brandName)}</div>
      <div class="modal-poc">👤 ${esc(a.poc || '—')}</div>
    </div>
  </div>

  <div class="section-lbl">Contact Information</div>
  <div class="info-grid">
    <div class="info-box full"><div class="info-lbl">✉️ Email</div><div class="info-val">${esc(a.email || '—')}</div></div>
    <div class="info-box"><div class="info-lbl">🔢 Entry No.</div><div class="info-val">#${a.slNo}</div></div>
    <div class="info-box"><div class="info-lbl"> Status</div><div class="info-val">${a.isOnboarded ? '✅ Onboarded' : '❌ Not Onboarded'}</div></div>
  </div>

  <div class="section-lbl">Participating Cities</div>
  <div class="show-list">${showsHtml}</div>
  `;

  document.getElementById('overlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  document.getElementById('overlay').classList.remove('open');
  document.body.style.overflow = '';
}

function hideLoading() {
  const el = document.getElementById('loadingEl');
  if (el) el.classList.add('gone');
}

function showToast(msg) {
  const t = document.getElementById('toast');
  if (t) { t.textContent = msg; t.className = 'toast show'; setTimeout(() => t.className = 'toast', 4000); }
}

function setMainView(v) {
  mainView = v;
  applyFilters();
}

function setTab(tab) {
  document.getElementById('view-artists').classList.toggle('active', tab === 'artists');
  applyFilters();
}

function setView(v) {
  currentView = v;
  applyFilters();
}

document.addEventListener('DOMContentLoaded', () => {
  loadAllData();
});