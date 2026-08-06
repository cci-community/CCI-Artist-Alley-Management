/* ============================================================
   CCI Artist Alley Management — Application Logic
   ============================================================ */

'use strict';

// ============================================================
// CONFIGURATION
// ============================================================
const SHEET_ID  = '1H7_Vdsuq8B3Bp-f00CLRxUyDPk1QiWxLfwnhJaEmmR0';
const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=0`;

// CORS proxy fallback chain — tried in order until one succeeds
const FETCH_STRATEGIES = [
    url => ({ url }),
    url => ({ url: `https://corsproxy.io/?${encodeURIComponent(url)}` }),
    url => ({ url: `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}` }),
    url => ({ url: `https://thingproxy.freeboard.io/fetch/${url}` }),
];

const AVATAR_GRADIENTS = [
    ['#7c3aed', '#a855f7'],
    ['#0e7490', '#06b6d4'],
    ['#be123c', '#f43f5e'],
    ['#065f46', '#10b981'],
    ['#7e22ce', '#6366f1'],
    ['#92400e', '#f59e0b'],
    ['#1e3a8a', '#3b82f6'],
    ['#4a1d96', '#8b5cf6'],
    ['#134e4a', '#14b8a6'],
    ['#78350f', '#fb923c'],
];

// ============================================================
// STATE
// ============================================================
let allArtists   = [];
let filteredArtists = [];
let currentView  = 'grid';
let sortCol      = 'slNo';
let sortDir      = 'asc';
let chartsDrawn  = false;
let chartObjs    = {};
let totalBooths  = 20; // Default, might be parsed from title
let eventTitle   = 'Artist Alley';

// ============================================================
// CSV PARSER
// ============================================================
function parseCSV(raw) {
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;

    for (let i = 0; i < raw.length; i++) {
        const ch   = raw[i];
        const next = raw[i + 1];

        if (inQuotes) {
            if (ch === '"' && next === '"') {
                field += '"'; i++;
            } else if (ch === '"') {
                inQuotes = false;
            } else {
                field += ch;
            }
        } else {
            if (ch === '"') {
                inQuotes = true;
            } else if (ch === ',') {
                row.push(field.trim());
                field = '';
            } else if (ch === '\n') {
                row.push(field.trim());
                field = '';
                if (row.length > 0) rows.push(row);
                row = [];
            } else if (ch === '\r') {
                // skip
            } else {
                field += ch;
            }
        }
    }

    if (field !== '' || row.length > 0) {
        row.push(field.trim());
        if (row.some(c => c !== '')) rows.push(row);
    }
    return rows;
}

// ============================================================
// HELPERS
// ============================================================
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
// PARSE ARTIST FROM CSV ROW
// ============================================================
function parseArtist(row, idx) {
    return {
        id:            idx,
        slNo:          parseInt(row[0]) || (idx + 1),
        brandName:     row[1]?.trim() || '',
        poc:           row[2]?.trim() || '',
        email:         row[3]?.trim() || '',
        consentSent:   parseBool(row[4]),
        gstReceived:   parseBool(row[5]),
        bookLaunch:    parseBool(row[6]),
        stageActivity: row[7]?.trim() || '',
    };
}

// ============================================================
// DATA LOADING
// ============================================================
async function fetchWithFallback(targetUrl) {
    let lastErr;
    for (const strategy of FETCH_STRATEGIES) {
        const { url } = strategy(targetUrl);
        try {
            const controller = new AbortController();
            const timeout    = setTimeout(() => controller.abort(), 8000);
            const res = await fetch(url, { cache: 'no-store', signal: controller.signal });
            clearTimeout(timeout);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const text = await res.text();
            if (!text.includes('Brand Name') && !text.includes(',')) throw new Error('Unexpected response');
            console.log('[CCI] Fetched via:', url);
            return text;
        } catch (err) {
            console.warn('[CCI] Strategy failed:', url, err.message);
            lastErr = err;
        }
    }
    throw new Error('All fetch strategies failed. ' + (lastErr?.message || ''));
}

async function loadData() {
    const btn = document.getElementById('refreshBtn');
    btn.classList.add('loading');
    btn.disabled = true;

    try {
        const text = await fetchWithFallback(SHEET_URL);
        processCSV(text);
        
        document.getElementById('lastUpdated').textContent =
            'Updated ' + new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
            
        document.getElementById('pasteCsvFallback').style.display = 'none';
        hideLoading();

    } catch (err) {
        console.error('[CCI] Load error:', err);
        showError('⚠️ Could not load sheet automatically. Use the manual fallback below. (' + err.message + ')');
        document.getElementById('pasteCsvFallback').style.display = 'block';
        hideLoading();
    }

    btn.classList.remove('loading');
    btn.disabled = false;
}

function loadPastedData() {
    const text = document.getElementById('csvPasteBox').value.trim();
    if (!text) {
        showError('⚠️ Please paste CSV data first');
        return;
    }
    
    try {
        processCSV(text);
        
        document.getElementById('lastUpdated').textContent = 'Updated (Manual)';
        document.getElementById('pasteCsvFallback').style.display = 'none';
        document.getElementById('csvPasteBox').value = ''; 
        
        const toast = document.getElementById('errorToast');
        toast.textContent = '✅ Data loaded successfully!';
        toast.style.background = 'var(--success)';
        toast.classList.add('show');
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.style.background = '', 300);
        }, 3000);
        
    } catch (err) {
        showError('⚠️ Error parsing CSV: ' + err.message);
    }
}

function processCSV(text) {
    const rows = parseCSV(text);
    if (rows.length < 2) throw new Error('Invalid CSV data');

    // Row 0 is often the title: "Visakhapatnam Comic Con 2026 [ 20 Booths]"
    const titleRow = rows[0][0] || '';
    if (titleRow && !titleRow.includes('Brand Name')) {
        eventTitle = titleRow.split('[')[0].trim() || 'Artist Alley';
        const match = titleRow.match(/\[\s*(\d+)\s*Booths\s*\]/i);
        if (match) totalBooths = parseInt(match[1]);
        document.querySelector('.brand-title').textContent = eventTitle;
        rows.shift(); // remove title row
    }

    // Now rows[0] is headers, skip it
    allArtists = rows
        .slice(1)
        .filter(r => r[1] && r[1].trim()) // must have a brand name
        .map((r, i) => parseArtist(r, i));

    filteredArtists = [...allArtists];

    renderStats();
    renderArtists();
    
    if (document.getElementById('tab-overview').classList.contains('active')) {
        drawCharts();
    } else {
        chartsDrawn = false;
    }
}

function hideLoading() {
    document.getElementById('loadingOverlay').classList.add('hidden');
}

function showError(msg) {
    const t = document.getElementById('errorToast');
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 6000);
}

// ============================================================
// STATS
// ============================================================
function renderStats() {
    document.getElementById('statTotalVal').textContent = totalBooths;
    document.getElementById('statAssignedVal').textContent = allArtists.length;

    const consents = allArtists.filter(a => a.consentSent).length;
    document.getElementById('statConsentVal').textContent = consents;

    const gsts = allArtists.filter(a => a.gstReceived).length;
    document.getElementById('statGstVal').textContent = gsts;

    const launches = allArtists.filter(a => a.bookLaunch).length;
    document.getElementById('statLaunchVal').textContent = launches;
}

// ============================================================
// FILTERS
// ============================================================
function applyFilters() {
    const search  = document.getElementById('searchInput').value.toLowerCase().trim();
    const statusF = document.getElementById('statusFilter').value;

    const hasFilters = search || statusF;
    document.getElementById('clearFiltersBtn').style.display = hasFilters ? 'block' : 'none';
    document.getElementById('searchClear').style.display = search ? 'flex' : 'none';

    filteredArtists = allArtists.filter(a => {
        if (search) {
            const haystack = [a.brandName, a.poc, a.email].join(' ').toLowerCase();
            if (!haystack.includes(search)) return false;
        }
        if (statusF === 'no-consent' && a.consentSent) return false;
        if (statusF === 'no-gst' && a.gstReceived) return false;
        if (statusF === 'book-launch' && !a.bookLaunch) return false;
        return true;
    });

    // Sort
    filteredArtists.sort((a, b) => {
        let va = sortCol === 'slNo' ? a.slNo : (a[sortCol] || '');
        let vb = sortCol === 'slNo' ? b.slNo : (b[sortCol] || '');
        if (typeof va === 'string') va = va.toLowerCase();
        if (typeof vb === 'string') vb = vb.toLowerCase();
        if (va < vb) return sortDir === 'asc' ? -1 : 1;
        if (va > vb) return sortDir === 'asc' ?  1 : -1;
        return 0;
    });

    renderArtists();
}

function clearSearch() {
    document.getElementById('searchInput').value = '';
    applyFilters();
}

function clearAllFilters() {
    document.getElementById('searchInput').value = '';
    document.getElementById('statusFilter').value = '';
    applyFilters();
}

// ============================================================
// RENDER — ARTISTS
// ============================================================
function renderArtists() {
    const count = `Showing <strong>${filteredArtists.length}</strong> of ${allArtists.length} assigned artists`;
    document.getElementById('resultsCount').innerHTML = count;
    currentView === 'grid' ? renderGrid() : renderTable();
}

function setView(v) {
    currentView = v;
    document.getElementById('artistsGrid').style.display  = v === 'grid'  ? 'grid' : 'none';
    document.getElementById('artistsTable').classList.toggle('hidden', v !== 'table');
    document.getElementById('gridViewBtn').classList.toggle('active', v === 'grid');
    document.getElementById('tableViewBtn').classList.toggle('active', v === 'table');
    renderArtists();
}

// --- GRID ---
function renderGrid() {
    const grid = document.getElementById('artistsGrid');

    if (!filteredArtists.length) {
        grid.innerHTML = `
          <div class="empty-state">
            <div class="empty-icon">🔍</div>
            <h3>No artists found</h3>
            <p>Try adjusting your search or clearing filters</p>
          </div>`;
        return;
    }

    grid.innerHTML = filteredArtists.map((a, i) => buildCard(a, i)).join('');
}

function buildCard(a, animIndex) {
    const [g1, g2]  = getGradient(a.brandName);
    const initials  = getInitials(a.brandName);

    const consentClass = a.consentSent ? 'done' : 'pending';
    const gstClass     = a.gstReceived ? 'done' : 'pending';

    return `
      <div class="artist-card" onclick="openModal(${a.id})" style="animation-delay:${animIndex * 0.03}s">
        <div class="card-num">#${a.slNo}</div>

        <div class="card-header-row">
          <div class="card-avatar" style="background:linear-gradient(135deg,${g1},${g2})">${initials}</div>
          <div>
            <div class="card-brand">${a.brandName}</div>
            <div class="card-poc">${a.poc || '—'}</div>
          </div>
        </div>

        <div class="card-tags">
          ${a.bookLaunch ? `<span class="badge badge-conv">📖 Book Launch</span>` : ''}
        </div>

        <div class="card-asset-row">
          <div class="asset-check-row" style="margin-bottom:6px">
            <div class="asset-check-icon-box ${consentClass}" style="width:18px;height:18px;font-size:10px">${a.consentSent ? '✓' : '○'}</div>
            <span class="asset-check-label" style="font-size:11px">Consent</span>
            <span class="asset-check-status ${consentClass}" style="font-size:10px">${a.consentSent ? 'Sent' : 'Pending'}</span>
          </div>
          <div class="asset-check-row">
            <div class="asset-check-icon-box ${gstClass}" style="width:18px;height:18px;font-size:10px">${a.gstReceived ? '✓' : '○'}</div>
            <span class="asset-check-label" style="font-size:11px">GST</span>
            <span class="asset-check-status ${gstClass}" style="font-size:10px">${a.gstReceived ? 'Received' : 'Pending'}</span>
          </div>
        </div>

        <div class="card-footer">
          <div class="conv-tally"></div>
          <button class="btn-detail" onclick="event.stopPropagation();openModal(${a.id})">Details</button>
        </div>
      </div>`;
}

// --- TABLE ---
function renderTable() {
    const tbody = document.getElementById('tableBody');

    if (!filteredArtists.length) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:48px;color:var(--text-muted)">No artists match your filters</td></tr>`;
        return;
    }

    tbody.innerHTML = filteredArtists.map(a => {
        const [g1, g2]  = getGradient(a.brandName);
        const initials  = getInitials(a.brandName);

        const emailHtml = a.email   
            ? `<a href="mailto:${a.email}" onclick="event.stopPropagation()" style="color:var(--text-muted);text-decoration:none;font-size:11px">${a.email.split(',')[0].trim()}</a>` 
            : '—';

        const cBadge = a.consentSent ? `<span class="badge badge-success" style="font-size:10px">Sent</span>` : `<span class="badge" style="background:rgba(239,68,68,0.2);color:var(--danger);font-size:10px">Pending</span>`;
        const gBadge = a.gstReceived ? `<span class="badge badge-success" style="font-size:10px">Received</span>` : `<span class="badge" style="background:rgba(239,68,68,0.2);color:var(--danger);font-size:10px">Pending</span>`;

        return `
          <tr onclick="openModal(${a.id})">
            <td class="td-num">${a.slNo}</td>
            <td>
              <div class="td-inline">
                <div class="td-avatar" style="background:linear-gradient(135deg,${g1},${g2})">${initials}</div>
                <span class="td-brand">${a.brandName}</span>
              </div>
            </td>
            <td>${a.poc || '—'}</td>
            <td style="font-size:12px">${emailHtml}</td>
            <td>${cBadge}</td>
            <td>${gBadge}</td>
            <td>${a.bookLaunch ? '✅ Yes' : '—'}</td>
            <td>
              <button class="btn-detail" onclick="event.stopPropagation();openModal(${a.id})" style="font-size:10px;padding:5px 11px">Details</button>
            </td>
          </tr>`;
    }).join('');
}

// ============================================================
// MODAL
// ============================================================
function openModal(id) {
    const a = allArtists.find(x => x.id === id);
    if (!a) return;

    const [g1, g2]   = getGradient(a.brandName);
    const initials   = getInitials(a.brandName);

    const emailHtml = a.email
        ? a.email.split(',').map(e => e.trim()).filter(Boolean)
              .map(e => `<a href="mailto:${e}">${e}</a>`).join(', ')
        : '—';

    document.getElementById('modalContent').innerHTML = `
      <div class="modal-header">
        <div class="modal-avatar" style="background:linear-gradient(135deg,${g1},${g2})">${initials}</div>
        <div style="flex:1;min-width:0">
          <div class="modal-name">${a.brandName}</div>
          <div class="modal-poc">👤 ${a.poc || '—'}</div>
          <div class="modal-tags">
            ${a.bookLaunch ? `<span class="badge badge-conv">📖 Book Launch</span>` : ''}
          </div>
        </div>
      </div>

      <!-- CONTACT INFO -->
      <div class="modal-section">
        <div class="modal-section-label">Contact Information</div>
        <div class="info-grid">
          <div class="info-item full">
            <div class="info-label">✉️ Email</div>
            <div class="info-value" style="font-size:12px">${emailHtml}</div>
          </div>
          <div class="info-item">
            <div class="info-label">🔢 Entry No.</div>
            <div class="info-value">#${a.slNo}</div>
          </div>
        </div>
      </div>

      <!-- COMPLIANCE -->
      <div class="modal-section">
        <div class="modal-section-label">Compliance Status</div>
        <div class="asset-checklist-modal">
          <div class="asset-check-row">
            <div class="asset-check-icon-box ${a.consentSent ? 'done' : 'pending'}">${a.consentSent ? '✓' : '○'}</div>
            <span class="asset-check-label">Consent Letter</span>
            <span class="asset-check-status ${a.consentSent ? 'done' : 'pending'}">${a.consentSent ? 'Sent' : 'Pending'}</span>
          </div>
          <div class="asset-check-row">
            <div class="asset-check-icon-box ${a.gstReceived ? 'done' : 'pending'}">${a.gstReceived ? '✓' : '○'}</div>
            <span class="asset-check-label">GST Details</span>
            <span class="asset-check-status ${a.gstReceived ? 'done' : 'pending'}">${a.gstReceived ? 'Received' : 'Pending'}</span>
          </div>
        </div>
      </div>
      
      <!-- STAGE ACTIVITY -->
      <div class="modal-section">
        <div class="modal-section-label">Stage Activity Description</div>
        <div style="background: rgba(255,255,255,0.03); padding: 12px; border-radius: 8px; font-size: 13px; color: var(--text); line-height: 1.5; border: 1px solid rgba(255,255,255,0.05);">
            ${a.stageActivity || '<span style="color:var(--text-muted);font-style:italic">No activity described</span>'}
        </div>
      </div>`;

    document.getElementById('modalOverlay').classList.add('open');
    document.body.style.overflow = 'hidden';
}

function closeModal() {
    document.getElementById('modalOverlay').classList.remove('open');
    document.body.style.overflow = '';
}

// ============================================================
// CHARTS
// ============================================================
function drawCharts() {
    if (chartsDrawn) {
        Object.values(chartObjs).forEach(c => c.destroy());
        chartObjs = {};
    }

    const gridColor = 'rgba(255,255,255,0.05)';
    const tickColor = '#4b5675';
    const fontFamily = 'Inter';

    const baseScales = {
        y: { grid: { color: gridColor }, ticks: { color: tickColor, font: { family: fontFamily, size: 11 } }, border: { display: false } },
        x: { grid: { display: false }, ticks: { color: tickColor, font: { family: fontFamily, size: 11 } }, border: { display: false } }
    };

    const legendDefaults = {
        labels: { color: tickColor, font: { family: fontFamily, size: 11 }, padding: 14, boxWidth: 12, boxHeight: 12 }
    };

    // 1. Compliance Chart
    const consents = allArtists.filter(a => a.consentSent).length;
    const gsts = allArtists.filter(a => a.gstReceived).length;

    chartObjs.compliance = new Chart(document.getElementById('complianceChart'), {
        type: 'bar',
        data: {
            labels: ['Consent Letters', 'GST Received'],
            datasets: [
                {
                    label: 'Completed',
                    data: [consents, gsts],
                    backgroundColor: 'rgba(16,185,129,0.75)',
                    borderRadius: 6,
                },
                {
                    label: 'Pending',
                    data: [allArtists.length - consents, allArtists.length - gsts],
                    backgroundColor: 'rgba(239,68,68,0.35)',
                    borderRadius: 6,
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { labels: { ...legendDefaults.labels } }
            },
            scales: {
                ...baseScales,
                x: { ...baseScales.x, stacked: true },
                y: { ...baseScales.y, stacked: true, beginAtZero: true, ticks: { ...baseScales.y.ticks, stepSize: 1 } }
            }
        }
    });

    // 2. Booth Allocation Doughnut
    chartObjs.booths = new Chart(document.getElementById('boothChart'), {
        type: 'doughnut',
        data: {
            labels: ['Assigned', 'Available'],
            datasets: [{
                data: [allArtists.length, Math.max(0, totalBooths - allArtists.length)],
                backgroundColor: ['#8b5cf6', 'rgba(255,255,255,0.05)'],
                borderColor: '#0f0f28',
                borderWidth: 3,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '65%',
            plugins: {
                legend: { position: 'right', labels: { ...legendDefaults.labels } }
            }
        }
    });

    chartsDrawn = true;
}

// ============================================================
// TAB SWITCHING
// ============================================================
function switchTab(name) {
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
    document.querySelectorAll('.tab-content').forEach(s => s.classList.toggle('active', s.id === `tab-${name}`));

    if (name === 'overview' && !chartsDrawn) {
        setTimeout(drawCharts, 60);
    }
}

// ============================================================
// TABLE SORTING
// ============================================================
function initTableSorting() {
    document.querySelectorAll('th.sortable').forEach(th => {
        th.addEventListener('click', () => {
            const col = th.dataset.col;
            if (sortCol === col) {
                sortDir = sortDir === 'asc' ? 'desc' : 'asc';
            } else {
                sortCol = col;
                sortDir = 'asc';
            }
            document.querySelectorAll('th').forEach(t => t.classList.remove('sort-asc', 'sort-desc'));
            th.classList.add(sortDir === 'asc' ? 'sort-asc' : 'sort-desc');
            applyFilters();
        });
    });
}

// ============================================================
// BOOT
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
    // Tabs
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });

    // Search
    const searchEl = document.getElementById('searchInput');
    let searchTimer;
    searchEl.addEventListener('input', () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(applyFilters, 180);
    });

    // Filter select
    document.getElementById('statusFilter').addEventListener('change', applyFilters);

    // Keyboard
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') closeModal();
    });

    initTableSorting();
    loadData();
});
