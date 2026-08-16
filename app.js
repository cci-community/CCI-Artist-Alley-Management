/* ============================================================
   CCI Artist Alley Management — Multi-City Application Logic
   ============================================================ */

'use strict';

// ============================================================
// CONFIGURATION & CITY TAB DEFINITIONS
// ============================================================
const SHEET_ID = '1H7_Vdsuq8B3Bp-f00CLRxUyDPk1QiWxLfwnhJaEmmR0'; //

// Sheet tabs to check alongside the main Tracker sheet
const CITY_SHEETS = [
    { code: 'VCC',  name: 'Vizag' },
    { code: 'HCC',  name: 'Hyderabad' },
    { code: 'NMCC', name: 'Navi Mumbai' },
    { code: 'DCC',  name: 'Delhi' },
    { code: 'JCC',  name: 'Jaipur' },
    { code: 'ICC',  name: 'Indore' },
    { code: 'CCC',  name: 'Chennai' },
    { code: 'KoCC',  name: 'Kochi' },
    { code: 'PCC',  name: 'Pune' },
    { code: 'BCC',  name: 'Bengaluru' },
    { code: 'GCC',  name: 'Guwahati' },
    { code: 'KCC',  name: 'Kolkata' },
    { code: 'GGCC',  name: 'Gurugram' },
    { code: 'MCC',  name: 'Mumbai' }
];

// CORS proxy fallback strategy
const FETCH_STRATEGIES = [
    url => ({ url }),
    url => ({ url: `https://corsproxy.io/?${encodeURIComponent(url)}` }),
    url => ({ url: `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}` }),
];

const AVATAR_GRADIENTS = [
    ['#7c3aed', '#a855f7'], ['#0e7490', '#06b6d4'],
    ['#be123c', '#f43f5e'], ['#065f46', '#10b981'],
    ['#7e22ce', '#6366f1'], ['#92400e', '#f59e0b'],
    ['#1e3a8a', '#3b82f6'], ['#4a1d96', '#8b5cf6'],
];

// ============================================================
// STATE
// ============================================================
let allArtists      = [];
let filteredArtists = [];
let currentView     = 'grid';
let sortCol         = 'slNo';
let sortDir         = 'asc';

// ============================================================
// CSV PARSER
// ============================================================
function parseCSV(raw) {
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;

    for (let i = 0; i < raw.length; i++) {
        const ch = raw[i];
        const next = raw[i + 1];

        if (inQuotes) {
            if (ch === '"' && next === '"') { field += '"'; i++; }
            else if (ch === '"') { inQuotes = false; }
            else { field += ch; }
        } else {
            if (ch === '"') { inQuotes = true; }
            else if (ch === ',') { row.push(field.trim()); field = ''; }
            else if (ch === '\n') {
                row.push(field.trim()); field = '';
                if (row.length > 0) rows.push(row);
                row = [];
            } else if (ch !== '\r') { field += ch; }
        }
    }
    if (field !== '' || row.length > 0) {
        row.push(field.trim());
        if (row.some(c => c !== '')) rows.push(row);
    }
    return rows;
}

function parseBool(val) {
    if (typeof val !== 'string') return !!val;
    const v = val.trim().toUpperCase();
    return v === 'TRUE' || v === 'YES' || v === '1';
}

function getInitials(name) {
    if (!name) return '?';
    return name.split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
}

function getGradient(name) {
    if (!name) return AVATAR_GRADIENTS[0];
    const idx = [...name].reduce((acc, c) => acc + c.charCodeAt(0), 0) % AVATAR_GRADIENTS.length;
    return AVATAR_GRADIENTS[idx];
}

// ============================================================
// FETCH ENGINE (TAB BY TAB)
// ============================================================
async function fetchSheetTab(sheetName) {
    const targetUrl = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`;
    
    for (const strategy of FETCH_STRATEGIES) {
        const { url } = strategy(targetUrl);
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 6000);
            const res = await fetch(url, { cache: 'no-store', signal: controller.signal });
            clearTimeout(timeout);
            if (!res.ok) continue;
            const text = await res.text();
            if (text && text.length > 10) return text;
        } catch (err) {
            // Try next proxy
        }
    }
    return null;
}

// ============================================================
// DATA LOADING & CROSS-TAB MATCHING
// ============================================================
async function loadAllData() {
    const btn = document.getElementById('refreshBtn');
    if (btn) { btn.classList.add('loading'); btn.disabled = true; }

    try {
        // 1. Fetch Main Tracker Database
        const trackerCsv = await fetchSheetTab('Tracker') || await fetchSheetTab('Sheet1');
        if (!trackerCsv) throw new Error('Could not fetch main Tracker sheet.');

        const trackerRows = parseCSV(trackerCsv);
        
        // Remove header row
        const dataRows = trackerRows.slice(1).filter(r => r[1] && r[1].trim());

        // Parse Master Artists from Tracker[cite: 1]
        allArtists = dataRows.map((row, idx) => ({
            id:            idx,
            slNo:          parseInt(row[0]) || (idx + 1),
            brandName:     row[1]?.trim() || '',
            poc:           row[2]?.trim() || '',
            email:         row[3]?.trim() || '',
            consentSent:   parseBool(row[4]),
            gstReceived:   parseBool(row[5]),
            bookLaunch:    parseBool(row[6]),
            stageActivity: row[7]?.trim() || '',
            cities:        [] // Will be populated from city sheets[cite: 1]
        }));

        // 2. Fetch all City Sheets in parallel and cross-reference[cite: 1]
        const cityPromises = CITY_SHEETS.map(async (city) => {
            const csvText = await fetchSheetTab(city.code);
            if (!csvText) return;

            const rows = parseCSV(csvText);
            const cityArtists = rows.slice(1).map(r => ({
                brand: r[1]?.toLowerCase().trim(),
                email: r[3]?.toLowerCase().trim()
            })).filter(a => a.brand || a.email);

            // Match back to Master List[cite: 1]
            allArtists.forEach(artist => {
                const artistEmail = artist.email.toLowerCase().trim();
                const artistBrand = artist.brandName.toLowerCase().trim();

                const isParticipating = cityArtists.some(ca => 
                    (artistEmail && ca.email && ca.email === artistEmail) ||
                    (artistBrand && ca.brand && ca.brand === artistBrand)
                );

                if (isParticipating && !artist.cities.some(c => c.code === city.code)) {
                    artist.cities.push(city);
                }
            });
        });

        await Promise.all(cityPromises);

        filteredArtists = [...allArtists];

        renderStats();
        populateCityFilter();
        applyFilters();
        hideLoading();

        document.getElementById('lastUpdated').textContent =
            'Updated ' + new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

    } catch (err) {
        console.error('[CCI] Load Error:', err);
        showError('⚠️ Failed to load sheet data: ' + err.message);
        hideLoading();
    }

    if (btn) { btn.classList.remove('loading'); btn.disabled = false; }
}

// ============================================================
// UI RENDERING & MODAL INTEGRATION
// ============================================================
function populateCityFilter() {
    const sel = document.getElementById('cityFilter') || document.getElementById('statusFilter');
    if (!sel) return;

    // Check if city dropdown exists or append options
    let citySel = document.getElementById('cityFilter');
    if (!citySel) {
        citySel = document.createElement('select');
        citySel.id = 'cityFilter';
        citySel.className = 'filter-sel';
        citySel.onchange = applyFilters;
        sel.parentNode.insertBefore(citySel, sel.nextSibling);
    }

    citySel.innerHTML = '<option value="">All Cities</option>' +
        CITY_SHEETS.map(c => `<option value="${c.code}">${c.name} (${c.code})</option>`).join('');
}

function applyFilters() {
    const search  = document.getElementById('searchInput')?.value.toLowerCase().trim() || '';
    const statusF = document.getElementById('statusFilter')?.value || '';
    const cityF   = document.getElementById('cityFilter')?.value || '';

    filteredArtists = allArtists.filter(a => {
        if (search) {
            const haystack = [a.brandName, a.poc, a.email].join(' ').toLowerCase();
            if (!haystack.includes(search)) return false;
        }
        if (statusF === 'no-consent' && a.consentSent) return false;
        if (statusF === 'no-gst' && a.gstReceived) return false;
        if (statusF === 'book-launch' && !a.bookLaunch) return false;
        if (cityF && !a.cities.some(c => c.code === cityF)) return false;
        return true;
    });

    renderArtists();
}

function renderArtists() {
    const grid = document.getElementById('artistsGrid');
    if (!grid) return;

    if (!filteredArtists.length) {
        grid.innerHTML = `<div class="empty-state"><h3>No artists found</h3></div>`;
        return;
    }

    grid.innerHTML = filteredArtists.map(a => {
        const [g1, g2] = getGradient(a.brandName);
        const initials = getInitials(a.brandName);
        
        // Render City Badges on Artist Card[cite: 1]
        const cityBadges = a.cities.length > 0 
            ? a.cities.map(c => `<span class="badge badge-conv" style="font-size:10px;margin-right:4px;">📍 ${c.code}</span>`).join('')
            : `<span style="font-size:11px;color:var(--text-muted)">No cities assigned</span>`;

        return `
          <div class="artist-card" onclick="openModal(${a.id})">
            <div class="card-num">#${a.slNo}</div>
            <div class="card-header-row">
              <div class="card-avatar" style="background:linear-gradient(135deg,${g1},${g2})">${initials}</div>
              <div>
                <div class="card-brand">${a.brandName}</div>
                <div class="card-poc">👤 ${a.poc || '—'}</div>
              </div>
            </div>

            <!-- CITY PARTICIPATION BADGES -->
            <div class="card-tags" style="margin: 10px 0;">
                ${cityBadges}
            </div>

            <div class="card-footer">
              <span style="font-size:11px;color:var(--text-muted)">${a.cities.length} City/Cities</span>
              <button class="btn-detail" onclick="event.stopPropagation();openModal(${a.id})">Details</button>
            </div>
          </div>`;
    }).join('');
}

// ============================================================
// ARTIST DETAILS MODAL WITH PARTICIPATING CITIES TAB/SECTION[cite: 1]
// ============================================================
function openModal(id) {
    const a = allArtists.find(x => x.id === id);
    if (!a) return;

    const [g1, g2] = getGradient(a.brandName);
    const initials = getInitials(a.brandName);

    // Build List of Cities for this Artist[cite: 1]
    const citiesListHtml = a.cities.length > 0
        ? a.cities.map(c => `
            <div style="display:inline-flex;align-items:center;gap:6px;background:rgba(124,58,237,0.15);border:1px solid rgba(124,58,237,0.4);padding:6px 12px;border-radius:8px;font-size:12px;font-weight:700;color:#c084fc;">
                📍 ${c.name} (${c.code})
            </div>`).join(' ')
        : '<span style="color:var(--text-muted);font-style:italic">No participating cities found for this artist.</span>';

    document.getElementById('modalContent').innerHTML = `
      <div class="modal-header">
        <div class="modal-avatar" style="background:linear-gradient(135deg,${g1},${g2})">${initials}</div>
        <div style="flex:1;min-width:0">
          <div class="modal-name">${a.brandName}</div>
          <div class="modal-poc">👤 ${a.poc || '—'}</div>
        </div>
      </div>

      <!-- PARTICIPATING CITIES SECTION -->
      <div class="modal-section">
        <div class="modal-section-label">🎪 Participating Cities (${a.cities.length})</div>
        <div style="display:flex;flex-wrap:wrap;gap:8px;padding:8px 0;">
            ${citiesListHtml}
        </div>
      </div>

      <!-- CONTACT INFO -->
      <div class="modal-section">
        <div class="modal-section-label">Contact Information</div>
        <div class="info-grid">
          <div class="info-item full">
            <div class="info-label">✉️ Email</div>
            <div class="info-value">${a.email || '—'}</div>
          </div>
          <div class="info-item">
            <div class="info-label">🔢 Entry No.</div>
            <div class="info-value">#${a.slNo}</div>
          </div>
        </div>
      </div>

      <!-- COMPLIANCE STATUS -->
      <div class="modal-section">
        <div class="modal-section-label">Compliance Status</div>
        <div class="asset-checklist-modal">
          <div class="asset-check-row">
            <span class="asset-check-label">Consent Letter:</span>
            <span class="asset-check-status">${a.consentSent ? '✅ Sent' : '❌ Pending'}</span>
          </div>
          <div class="asset-check-row">
            <span class="asset-check-label">GST Details:</span>
            <span class="asset-check-status">${a.gstReceived ? '✅ Received' : '❌ Pending'}</span>
          </div>
        </div>
      </div>`;

    document.getElementById('modalOverlay').classList.add('open');
    document.body.style.overflow = 'hidden';
}

function closeModal() {
    document.getElementById('modalOverlay').classList.remove('open');
    document.body.style.overflow = '';
}

function hideLoading() {
    const el = document.getElementById('loadingOverlay') || document.getElementById('loadingEl');
    if (el) el.classList.add('hidden');
}

function showError(msg) {
    const t = document.getElementById('errorToast') || document.getElementById('toast');
    if (t) { t.textContent = msg; t.classList.add('show'); }
}

function renderStats() {
    const totalEl = document.getElementById('statAssignedVal') || document.getElementById('sv-db');
    if (totalEl) totalEl.textContent = allArtists.length;
}

// ============================================================
// BOOT
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
    loadAllData();
});