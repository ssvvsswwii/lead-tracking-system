// =============================================
//  APP MODULE — Dashboard, Leads, Users
// =============================================

const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let currentUser = null;
let currentProfile = null;
let allLeads = [];
let allUsers = [];
let allBranches = [];
let currentPage = 1;
let activityPage = 1;
const PAGE_SIZE = 100;
const ACTIVITY_PAGE_SIZE = 50;

// =============================================
//  INIT
// =============================================
(async () => {
  const { data: { session } } = await db.auth.getSession();
  if (!session) { window.location.href = 'index.html'; return; }
  currentUser = session.user;

  const { data: profile } = await db
    .from('profiles')
    .select('*, branches(name)')
    .eq('id', currentUser.id)
    .single();

  if (!profile || !profile.is_active) {
    await db.auth.signOut();
    window.location.href = 'index.html';
    return;
  }

  currentProfile = profile;
  renderUserInfo();
  await loadBranches();
  await loadDashboard();
  hideLoading();

  // Restrict nav items by role
  applyRoleNav();

  // Listen for auth changes (logout from another tab)
  db.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') window.location.href = 'index.html';
  });
})();

// =============================================
//  NAVIGATION
// =============================================
function navigateTo(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  const pageEl = document.getElementById(`page-${page}`);
  const navEl = document.querySelector(`.nav-item[data-page="${page}"]`);

  if (pageEl) pageEl.classList.add('active');
  if (navEl) navEl.classList.add('active');

  document.querySelector('.topbar-title').textContent = {
    dashboard: 'Dashboard',
    leads: 'Lead Management',
    users: 'User Management',
    reports: 'Reports & Analytics',
    import: 'Import Leads',
    export: 'Export Leads',
    duplicates: 'Duplicate Checker',
    activity: 'Activity Log',
  }[page] || page;

  if (page === 'leads') { loadLeads(); populateBulkConsultantDropdown(); populateBulkStatusDropdown(); loadPipelineSummary(); }
  if (page === 'users') loadUsers();
  if (page === 'reports') loadReports();
  if (page === 'import') initImport();
  if (page === 'export') initExport();
  if (page === 'activity') loadActivityLog();

  // Close sidebar on mobile
  document.querySelector('.sidebar').classList.remove('open');
}

document.querySelectorAll('.nav-item[data-page]').forEach(item => {
  item.addEventListener('click', () => navigateTo(item.dataset.page));
});

document.querySelector('.topbar-menu-btn')?.addEventListener('click', () => {
  document.querySelector('.sidebar').classList.toggle('open');
});

function applyRoleNav() {
  const role = currentProfile.role;
  // Hide admin-only items for non-admins
  if (role !== 'admin') {
    document.querySelectorAll('.admin-only').forEach(el => el.style.display = 'none');
  }
  // Hide user management for consultants
  if (role === 'client_consultant') {
    document.querySelectorAll('.manager-only').forEach(el => el.style.display = 'none');
  }
}

// =============================================
//  USER INFO
// =============================================
function renderUserInfo() {
  const initials = currentProfile.full_name?.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase() || '??';
  document.getElementById('user-initials').textContent = initials;
  document.getElementById('user-name').textContent = currentProfile.full_name || currentUser.email;
  const roleEl = document.getElementById('user-role');
  if (roleEl) {
    roleEl.textContent = ROLES[currentProfile.role]?.label || currentProfile.role;
    roleEl.className = `user-role-badge ${ROLES[currentProfile.role]?.color || ''}`;
  }
}

// =============================================
//  LOGOUT
// =============================================
document.getElementById('logout-btn')?.addEventListener('click', async () => {
  await db.auth.signOut();
  window.location.href = 'index.html';
});

// =============================================
//  BRANCHES
// =============================================
async function loadBranches() {
  const { data } = await db.from('branches').select('*').order('name');
  allBranches = data || [];
}

// =============================================
//  DASHBOARD
// =============================================
async function loadDashboard() {
  // Personalised greeting based on role & branch
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const firstName = currentProfile.full_name?.split(' ')[0] || '';
  const branchName = currentProfile.branches?.name || '';
  let context = "here's your lead summary";
  if (currentProfile.role === 'admin')                                   context = "here's your full system overview";
  else if (currentProfile.role === 'branch_manager' && branchName)       context = `${branchName} branch`;
  else if (currentProfile.role === 'client_consultant')                  context = "here's your assigned leads";
  setText('dashboard-greeting', `${greet}, ${firstName} — ${context}`);

  const base = () => {
    let q = db.from('leads').select('*', { count: 'exact', head: true });
    if (currentProfile.role === 'branch_manager') q = q.eq('branch_id', currentProfile.branch_id);
    if (currentProfile.role === 'client_consultant') q = q.eq('assigned_to', currentUser.id);
    return q;
  };

  const now = new Date();
  const monthStart    = new Date(now.getFullYear(), now.getMonth(),     1).toISOString();
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
  const lastMonthEnd   = new Date(now.getFullYear(), now.getMonth(),     0, 23, 59, 59).toISOString();

  const [
    { count: total },
    { count: converted },
    { count: active },
    { count: thisMonth },
    { count: lastMonth },
  ] = await Promise.all([
    base(),
    base().eq('status', 'converted'),
    base().not('status', 'in', '("converted","not_interested")'),
    base().gte('created_at', monthStart),
    base().gte('created_at', lastMonthStart).lte('created_at', lastMonthEnd),
  ]);

  setText('stat-total',  (total     ?? 0).toLocaleString());
  setText('stat-won',    (converted ?? 0).toLocaleString());
  setText('stat-active', (active    ?? 0).toLocaleString());
  setText('stat-month',  (thisMonth ?? 0).toLocaleString());

  // Dynamic stat-change subtexts
  const convRate = total ? ((converted / total) * 100).toFixed(1) : '0.0';
  setStatChange('stat-change-total',  `+${(thisMonth ?? 0).toLocaleString()} added this month`, 'up');
  setStatChange('stat-change-won',    `${convRate}% overall conversion rate`, convRate > 0 ? 'up' : '');
  setStatChange('stat-change-active', 'Excl. converted & not interested', '');

  const diff = (thisMonth ?? 0) - (lastMonth ?? 0);
  if      (diff > 0) setStatChange('stat-change-month', `↑ ${diff} more than last month`,           'up');
  else if (diff < 0) setStatChange('stat-change-month', `↓ ${Math.abs(diff)} fewer than last month`, 'down');
  else               setStatChange('stat-change-month', 'Same as last month', '');

  await loadPipelineCounts();
  await loadRecentLeads();
}

function setStatChange(id, text, direction) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  el.className = `stat-change ${direction}`.trim();
}

async function loadPipelineCounts() {
  const counts = {};
  await Promise.all(LEAD_STATUSES.map(async s => {
    let q = db.from('leads').select('*', { count: 'exact', head: true }).eq('status', s.value);
    if (currentProfile.role === 'branch_manager') q = q.eq('branch_id', currentProfile.branch_id);
    if (currentProfile.role === 'client_consultant') q = q.eq('assigned_to', currentUser.id);
    const { count } = await q;
    counts[s.value] = count || 0;
  }));

  const total = Object.values(counts).reduce((a, b) => a + b, 0) || 1;
  const bar = document.getElementById('pipeline-bar');
  const legendEl = document.getElementById('pipeline-legend');
  if (!bar) return;

  bar.innerHTML = '';
  legendEl.innerHTML = '';

  LEAD_STATUSES.forEach(s => {
    const count = counts[s.value] || 0;
    const pct = (count / total) * 100;
    if (pct > 0) {
      const seg = document.createElement('div');
      seg.className = 'pipeline-seg';
      seg.style.cssText = `width:${pct}%;background:${s.color};`;
      seg.title = `${s.label}: ${count}`;
      bar.appendChild(seg);
    }
    const leg = document.createElement('div');
    leg.className = 'legend-item';
    leg.innerHTML = `<span class="legend-dot" style="background:${s.color}"></span><span>${s.label} (${count})</span>`;
    legendEl.appendChild(leg);
  });
}


async function loadRecentLeads(localLeads) {
  let leads = localLeads;
  if (!leads || leads.length === 0) {
    let q = db.from('leads').select('id,first_name,last_name,email,status,created_at').order('created_at', { ascending: false }).limit(5);
    if (currentProfile.role === 'branch_manager') q = q.eq('branch_id', currentProfile.branch_id);
    if (currentProfile.role === 'client_consultant') q = q.eq('assigned_to', currentUser.id);
    const { data } = await q;
    leads = data || [];
  }

  const tbody = document.getElementById('recent-leads-body');
  if (!tbody) return;
  tbody.innerHTML = leads.map(l => `
    <tr>
      <td><strong>${l.first_name} ${l.last_name}</strong></td>
      <td>${l.email}</td>
      <td><span class="badge badge-${l.status}">${statusLabel(l.status)}</span></td>
      <td>${formatDate(l.created_at)}</td>
      <td><button class="btn btn-outline btn-sm" onclick="openLeadDetail('${l.id}')">View</button></td>
    </tr>
  `).join('') || '<tr><td colspan="5" class="empty-state" style="padding:24px;text-align:center;color:var(--text-muted)">No recent leads</td></tr>';
}

// =============================================
//  LEADS
// =============================================
async function loadLeads(resetPage = true) {
  if (resetPage) currentPage = 1;
  showTableLoading('leads-tbody', 7);

  const search = document.getElementById('lead-search')?.value.trim() || '';
  const statusFilter = document.getElementById('lead-status-filter')?.value || '';
  const branchFilter = document.getElementById('lead-branch-filter')?.value || '';
  const consultantFilter = document.getElementById('lead-consultant-filter')?.value || '';

  const sortVal = document.getElementById('lead-sort')?.value || 'created_at_desc';
  const sortMap = {
    name_asc:        { column: 'first_name', ascending: true },
    name_desc:       { column: 'first_name', ascending: false },
    created_at_asc:  { column: 'created_at', ascending: true },
    created_at_desc: { column: 'created_at', ascending: false },
  };
  const { column: sortCol, ascending: sortAsc } = sortMap[sortVal] || sortMap.created_at_desc;

  let query = db.from('leads')
    .select(`
      id, first_name, last_name, email, phone, status, source,
      created_at, updated_at, notes, assigned_name,
      branches(name),
      assigned_profile:profiles!leads_assigned_to_fkey(full_name)
    `, { count: 'exact' })
    .order(sortCol, { ascending: sortAsc });

  // Role-based scoping (enforced by RLS too — this just improves UX)
  if (currentProfile.role === 'branch_manager') {
    query = query.eq('branch_id', currentProfile.branch_id);
  } else if (currentProfile.role === 'client_consultant') {
    query = query.eq('assigned_to', currentUser.id);
  }

  if (search) {
    query = query.or(`first_name.ilike.%${search}%,last_name.ilike.%${search}%,email.ilike.%${search}%,phone.ilike.%${search}%`);
  }
  if (statusFilter) query = query.eq('status', statusFilter);
  if (branchFilter && currentProfile.role === 'admin') query = query.eq('branch_id', branchFilter);
  if (consultantFilter && currentProfile.role !== 'client_consultant') query = query.eq('assigned_to', consultantFilter);

  const from = (currentPage - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;
  query = query.range(from, to);

  const { data, count, error } = await query;

  if (error) { showToast('Failed to load leads', 'error'); return; }

  allLeads = data || [];
  renderLeadsTable(allLeads);
  renderPaginationControls(count || 0, 'leads-pagination', loadLeads);
  updateFilterIndicator();
}

function updateFilterIndicator() {
  const search     = document.getElementById('lead-search')?.value?.trim() || '';
  const status     = document.getElementById('lead-status-filter')?.value || '';
  const branch     = document.getElementById('lead-branch-filter')?.value || '';
  const consultant = document.getElementById('lead-consultant-filter')?.value || '';
  const activeCount = [search, status, branch, consultant].filter(Boolean).length;
  const badge = document.getElementById('filter-active-badge');
  if (!badge) return;
  badge.style.display = activeCount > 0 ? 'inline-flex' : 'none';
  badge.textContent = activeCount > 0
    ? `● ${activeCount} filter${activeCount > 1 ? 's' : ''} active`
    : '';
}

function renderLeadsTable(leads) {
  const tbody = document.getElementById('leads-tbody');
  if (!tbody) return;

  if (!leads.length) {
    tbody.innerHTML = `<tr><td colspan="9"><div class="empty-state"><div class="empty-icon">📋</div><h4>No leads found</h4><p>Try adjusting your filters or add a new lead.</p></div></td></tr>`;
    return;
  }

  tbody.innerHTML = leads.map(l => {
    // WhatsApp link — strip everything except digits
    const waPhone = (l.phone || '').replace(/[^\d]/g, '');
    const waLink = waPhone
      ? `<a href="https://wa.me/${waPhone}" target="_blank" rel="noopener"
            style="font-size:11px;color:#25d366;font-weight:600;text-decoration:none;display:inline-flex;align-items:center;gap:3px;margin-top:2px"
            title="Open WhatsApp chat" onclick="event.stopPropagation()">💬 WhatsApp</a>`
      : '';

    // Notes preview — truncated, full text on hover
    const notesPreview = l.notes
      ? `<div style="font-size:11px;color:var(--text-muted);margin-top:3px;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
              title="${escHtml(l.notes)}">📝 ${escHtml(l.notes.substring(0, 55))}${l.notes.length > 55 ? '…' : ''}</div>`
      : '';

    return `
    <tr>
      <td><input type="checkbox" class="lead-checkbox" value="${l.id}" onchange="updateBulkBar()" /></td>
      <td>
        <div style="font-weight:600">${escHtml(l.first_name)} ${escHtml(l.last_name)}</div>
        <div style="font-size:12px;color:var(--text-muted)">${escHtml(l.email || '')}</div>
        ${notesPreview}
      </td>
      <td>
        <div>${escHtml(l.phone || '—')}</div>
        ${waLink}
      </td>
      <td>
        <span class="badge badge-${l.status}"
              style="cursor:pointer;user-select:none"
              title="Click to change status"
              onclick="quickStatusMenu(event,'${l.id}','${l.status}')">
          ${statusLabel(l.status)}
        </span>
      </td>
      <td>${escHtml(l.source || '—')}</td>
      <td>${escHtml(l.branches?.name || '—')}</td>
      <td>${escHtml(l.assigned_profile?.full_name || l.assigned_name || 'Unassigned')}</td>
      <td style="white-space:nowrap">
        <div style="display:flex;gap:4px">
          <button class="btn btn-outline btn-sm" style="padding:4px 8px;font-size:12px" onclick="openLeadDetail('${l.id}')">View</button>
          ${canEditLead() ? `<button class="btn btn-outline btn-sm" style="padding:4px 8px;font-size:12px" onclick="openEditLead('${l.id}')">Edit</button>` : ''}
          ${currentProfile.role === 'admin' ? `<button class="btn btn-sm" style="padding:4px 8px;font-size:12px;color:var(--danger);border:1.5px solid var(--border);background:transparent" onclick="deleteLead('${l.id}')">Del</button>` : ''}
        </div>
      </td>
    </tr>`;
  }).join('');
}

function toggleSelectAll(checkbox) {
  document.querySelectorAll('.lead-checkbox').forEach(cb => cb.checked = checkbox.checked);
  updateBulkBar();
}

function updateBulkBar() {
  const selected = document.querySelectorAll('.lead-checkbox:checked');
  const bar = document.getElementById('bulk-bar');
  const countEl = document.getElementById('bulk-count');
  if (selected.length > 0) {
    bar.style.display = 'flex';
    countEl.textContent = `${selected.length} lead${selected.length > 1 ? 's' : ''} selected`;
  } else {
    bar.style.display = 'none';
  }
}

function clearSelection() {
  document.querySelectorAll('.lead-checkbox').forEach(cb => cb.checked = false);
  const selectAll = document.getElementById('select-all-leads');
  if (selectAll) selectAll.checked = false;
  document.getElementById('bulk-bar').style.display = 'none';
}

async function bulkAssign() {
  const selected = [...document.querySelectorAll('.lead-checkbox:checked')].map(cb => cb.value);
  if (!selected.length) return;

  const consultantId = document.getElementById('bulk-consultant-select').value;
  const consultantName = document.getElementById('bulk-consultant-name').value.trim();

  if (!consultantId && !consultantName) {
    showToast('Please select a consultant or type a name', 'error');
    return;
  }

  const payload = {};
  if (consultantId) {
    payload.assigned_to = consultantId;
    payload.assigned_name = null;
  } else {
    payload.assigned_name = consultantName;
    payload.assigned_to = null;
  }

  const { error } = await db.from('leads').update(payload).in('id', selected);
  if (error) { showToast('Failed to assign leads', 'error'); return; }

  showToast(`✅ ${selected.length} lead${selected.length > 1 ? 's' : ''} assigned to ${consultantId ? '' : consultantName}`, 'success');
  clearSelection();
  loadLeads();
}

function populateBulkStatusDropdown() {
  const sel = document.getElementById('bulk-status-select');
  if (sel) {
    sel.innerHTML = '<option value="">— Change Status —</option>' +
      LEAD_STATUSES.map(s => `<option value="${s.value}">${escHtml(s.label)}</option>`).join('');
  }
}

async function bulkUpdateStatus() {
  const selected = [...document.querySelectorAll('.lead-checkbox:checked')].map(cb => cb.value);
  if (!selected.length) return;
  const newStatus = document.getElementById('bulk-status-select').value;
  if (!newStatus) { showToast('Please select a status to change to', 'error'); return; }
  const statusName = LEAD_STATUSES.find(s => s.value === newStatus)?.label || newStatus;
  if (!confirm(`Update ${selected.length} lead${selected.length > 1 ? 's' : ''} to "${statusName}"?`)) return;
  const { error } = await db.from('leads').update({ status: newStatus, updated_at: new Date().toISOString() }).in('id', selected);
  if (error) { showToast('Failed to update status: ' + error.message, 'error'); return; }
  showToast(`✅ ${selected.length} lead${selected.length > 1 ? 's' : ''} updated to ${statusName}`, 'success');
  clearSelection();
  loadLeads();
  loadPipelineSummary();
}

async function populateBulkConsultantDropdown() {
  let q = db.from('profiles').select('id,full_name').eq('role','client_consultant').eq('is_active',true);
  if (currentProfile.role === 'branch_manager') q = q.eq('branch_id', currentProfile.branch_id);
  const { data } = await q;
  const sel = document.getElementById('bulk-consultant-select');
  if (sel) {
    sel.innerHTML = '<option value="">— Assign to consultant —</option>' +
      (data || []).map(c => `<option value="${c.id}">${escHtml(c.full_name)}</option>`).join('');
  }
}

function canEditLead() {
  return ['admin', 'branch_manager', 'client_consultant'].includes(currentProfile.role);
}

// ---- Open Lead Detail ----
async function openLeadDetail(id) {
  const { data: lead } = await db.from('leads')
    .select(`*, branches(name), assigned_profile:profiles!leads_assigned_to_fkey(full_name)`)
    .eq('id', id).single();

  if (!lead) { showToast('Lead not found', 'error'); return; }

  const { data: activities } = await db.from('lead_activities')
    .select(`*, actor:profiles!lead_activities_user_id_fkey(full_name)`)
    .eq('lead_id', id).order('created_at', { ascending: false }).limit(10);

  const modal = document.getElementById('lead-detail-modal');
  document.getElementById('detail-name').textContent = `${lead.first_name} ${lead.last_name}`;
  document.getElementById('detail-status').innerHTML = `<span class="badge badge-${lead.status}">${statusLabel(lead.status)}</span>`;

  const fields = {
    'detail-email': lead.email,
    'detail-phone': lead.phone || '—',
    'detail-source': lead.source || '—',
    'detail-branch': lead.branches?.name || '—',
    'detail-assigned': lead.assigned_profile?.full_name || lead.assigned_name || 'Unassigned',
    'detail-social-media': lead.social_media || '—',
    'detail-created': formatDate(lead.created_at),
    'detail-updated': formatDate(lead.updated_at),
    'detail-notes': lead.notes || 'No notes yet.',
  };
  Object.entries(fields).forEach(([id, val]) => setText(id, val));

  // Activity timeline
  const actEl = document.getElementById('detail-activities');
  if (actEl) {
    actEl.innerHTML = (activities || []).length
      ? activities.map(a => `
          <div class="activity-item">
            <div class="activity-dot"></div>
            <div class="activity-content">
              <div class="activity-text"><strong>${escHtml(a.actor?.full_name || 'System')}</strong> — ${escHtml(a.action)}</div>
              <div class="activity-time">${formatDate(a.created_at, true)}</div>
            </div>
          </div>`).join('')
      : '<p style="color:var(--text-muted);font-size:13px">No activity yet.</p>';
  }

  // Note logging
  document.getElementById('log-note-btn').onclick = async () => {
    const note = document.getElementById('new-note-input').value.trim();
    if (!note) return;
    await db.from('lead_activities').insert({ lead_id: id, user_id: currentUser.id, action: `Note: ${note}` });
    document.getElementById('new-note-input').value = '';
    showToast('Note saved', 'success');
    openLeadDetail(id);
  };

  openModal('lead-detail-modal');
}

// ---- Add / Edit Lead ----
function openAddLead() {
  document.getElementById('lead-form').reset();
  document.getElementById('lead-form-id').value = '';
  document.getElementById('lead-modal-title').textContent = 'Add New Lead';
  populateLeadFormDropdowns();
  openModal('lead-modal');
}

async function openEditLead(id) {
  const lead = allLeads.find(l => l.id === id);
  if (!lead) {
    const { data } = await db.from('leads').select('*').eq('id', id).single();
    if (!data) return;
    fillLeadForm(data);
  } else {
    fillLeadForm(lead);
  }
  document.getElementById('lead-modal-title').textContent = 'Edit Lead';
  populateLeadFormDropdowns();
  openModal('lead-modal');
}

function fillLeadForm(lead) {
  const f = document.getElementById('lead-form');
  document.getElementById('lead-form-id').value = lead.id;
  f.first_name.value = lead.first_name || '';
  f.last_name.value = lead.last_name || '';
  f.email.value = lead.email || '';
  f.phone.value = lead.phone || '';
  f.status.value = lead.status || 'new';
  f.source.value = lead.source || '';
  f.notes.value = lead.notes || '';
  if (f.branch_id) f.branch_id.value = lead.branch_id || '';
  if (f.assigned_to) f.assigned_to.value = lead.assigned_to || '';

  // Social media
  const knownPlatforms = ['WhatsApp','Facebook','Instagram','TikTok'];
  const sel = document.getElementById('social-media-select');
  const otherInput = document.getElementById('social-media-other');
  const otherGroup = document.getElementById('social-media-other-group');
  if (!lead.social_media) {
    sel.value = '';
    otherGroup.style.display = 'none';
  } else if (knownPlatforms.includes(lead.social_media)) {
    sel.value = lead.social_media;
    otherGroup.style.display = 'none';
  } else {
    sel.value = 'Others';
    otherInput.value = lead.social_media;
    otherGroup.style.display = 'block';
  }
}

function toggleSocialMediaOther(sel) {
  const otherGroup = document.getElementById('social-media-other-group');
  otherGroup.style.display = sel.value === 'Others' ? 'block' : 'none';
  if (sel.value !== 'Others') document.getElementById('social-media-other').value = '';
}

async function populateLeadFormDropdowns() {
  // Branches dropdown
  const branchSel = document.getElementById('form-branch');
  if (branchSel) {
    branchSel.innerHTML = '<option value="">— Select Branch —</option>' +
      allBranches.map(b => `<option value="${b.id}">${escHtml(b.name)}</option>`).join('');
  }

  // Consultant dropdown (admins/managers only)
  const assignSel = document.getElementById('form-assigned');
  if (assignSel && currentProfile.role !== 'client_consultant') {
    let q = db.from('profiles').select('id,full_name').eq('role', 'client_consultant').eq('is_active', true);
    if (currentProfile.role === 'branch_manager') q = q.eq('branch_id', currentProfile.branch_id);
    const { data: consultants } = await q;
    assignSel.innerHTML = '<option value="">— Unassigned —</option>' +
      (consultants || []).map(c => `<option value="${c.id}">${escHtml(c.full_name)}</option>`).join('');
  }

  // Status select
  const statusSel = document.getElementById('form-status');
  if (statusSel) {
    statusSel.innerHTML = LEAD_STATUSES.map(s => `<option value="${s.value}">${s.label}</option>`).join('');
  }

  // Source select
  const sourceSel = document.getElementById('form-source');
  if (sourceSel) {
    sourceSel.innerHTML = '<option value="">— Select Source —</option>' +
      LEAD_SOURCES.map(s => `<option value="${s}">${s}</option>`).join('');
  }
}

document.getElementById('lead-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const id = document.getElementById('lead-form-id').value;

  const socialSelect = document.getElementById('social-media-select').value;
  const socialOther  = document.getElementById('social-media-other').value.trim();
  const socialMedia  = socialSelect === 'Others' ? (socialOther || 'Others') : socialSelect;

  const payload = {
    first_name: f.first_name.value.trim(),
    last_name: f.last_name.value.trim(),
    email: f.email.value.trim().toLowerCase(),
    phone: f.phone.value.trim(),
    status: f.status.value,
    source: f.source.value,
    social_media: socialMedia || null,
    notes: f.notes.value.trim(),
    branch_id: f.branch_id?.value || currentProfile.branch_id,
    assigned_to: f.assigned_to?.value || null,
    updated_at: new Date().toISOString(),
  };

  setLoading('lead-save-btn', true);

  let error;
  if (id) {
    ({ error } = await db.from('leads').update(payload).eq('id', id));
    if (!error) {
      await db.from('lead_activities').insert({ lead_id: id, user_id: currentUser.id, action: 'Lead updated' });
    }
  } else {
    payload.created_by = currentUser.id;
    const { data: newLead, error: insertErr } = await db.from('leads').insert(payload).select().single();
    error = insertErr;
    if (!error && newLead) {
      await db.from('lead_activities').insert({ lead_id: newLead.id, user_id: currentUser.id, action: 'Lead created' });
    }
  }

  setLoading('lead-save-btn', false);

  if (error) { showToast('Failed to save lead: ' + error.message, 'error'); return; }

  showToast(id ? 'Lead updated successfully' : 'Lead added successfully', 'success');
  closeModal('lead-modal');
  loadLeads();
});

async function deleteLead(id) {
  if (!confirm('Delete this lead? This action cannot be undone.')) return;
  const { error } = await db.from('leads').delete().eq('id', id);
  if (error) { showToast('Failed to delete lead', 'error'); return; }
  showToast('Lead deleted', 'success');
  loadLeads();
}

// ---- Lead Filters ----
document.getElementById('lead-search')?.addEventListener('input', debounce(() => loadLeads(), 350));
document.getElementById('lead-status-filter')?.addEventListener('change', () => { loadLeads(); loadPipelineSummary(); });
document.getElementById('lead-branch-filter')?.addEventListener('change', () => loadLeads());
document.getElementById('lead-consultant-filter')?.addEventListener('change', () => loadLeads());
document.getElementById('lead-sort')?.addEventListener('change', () => loadLeads());

async function initLeadFilters() {
  // Populate branch filter (admin only)
  const branchFilter = document.getElementById('lead-branch-filter');
  if (branchFilter && currentProfile.role === 'admin') {
    branchFilter.innerHTML = '<option value="">All Branches</option>' +
      allBranches.map(b => `<option value="${b.id}">${escHtml(b.name)}</option>`).join('');
  } else if (branchFilter) {
    branchFilter.parentElement?.remove();
  }

  // Populate consultant filter
  const consultantFilter = document.getElementById('lead-consultant-filter');
  if (consultantFilter && currentProfile.role !== 'client_consultant') {
    let q = db.from('profiles').select('id,full_name').eq('role','client_consultant').eq('is_active',true);
    if (currentProfile.role === 'branch_manager') q = q.eq('branch_id', currentProfile.branch_id);
    const { data } = await q;
    consultantFilter.innerHTML = '<option value="">All Consultants</option>' +
      (data || []).map(c => `<option value="${c.id}">${escHtml(c.full_name)}</option>`).join('');
  } else if (consultantFilter) {
    consultantFilter.parentElement?.remove();
  }
}

// =============================================
//  USER MANAGEMENT (Admin only)
// =============================================
async function loadUsers() {
  if (currentProfile.role !== 'admin') return;
  showTableLoading('users-tbody', 6);

  const { data: users } = await db.from('profiles')
    .select('*, branches(name)')
    .order('created_at', { ascending: false });

  allUsers = users || [];

  const tbody = document.getElementById('users-tbody');
  if (!tbody) return;

  if (!allUsers.length) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><div class="empty-icon">👥</div><h4>No users found</h4></div></td></tr>`;
    return;
  }

  tbody.innerHTML = allUsers.map(u => `
    <tr>
      <td>
        <div class="td-user">
          <div class="user-table-avatar">${initials(u.full_name)}</div>
          <div class="td-user-info">
            <div class="td-user-name">${escHtml(u.full_name || '—')}</div>
            <div class="td-user-email">${escHtml(u.email)}</div>
          </div>
        </div>
      </td>
      <td><span class="user-role-badge ${ROLES[u.role]?.color || ''}">${ROLES[u.role]?.label || u.role}</span></td>
      <td>${escHtml(u.branches?.name || '—')}</td>
      <td>
        <label class="toggle">
          <input type="checkbox" ${u.is_active ? 'checked' : ''} onchange="toggleUserActive('${u.id}', this.checked)">
          <span class="toggle-slider" style="background:${u.is_active ? '#10b981' : '#ef4444'};" id="toggle-${u.id}"></span>
        </label>
      </td>
      <td>${formatDate(u.created_at)}</td>
      <td>
        <div style="display:flex;gap:6px">
          <button class="btn btn-outline btn-sm" onclick="openEditUser('${u.id}')">Edit</button>
          ${u.id !== currentUser.id ? `<button class="btn btn-sm" style="color:var(--danger);border:1.5px solid var(--border);background:transparent" onclick="deleteUser('${u.id}')">Remove</button>` : ''}
        </div>
      </td>
    </tr>
  `).join('');
}

async function toggleUserActive(userId, active) {
  const { error } = await db.from('profiles').update({ is_active: active }).eq('id', userId);
  if (error) { showToast('Failed to update user status', 'error'); return; }
  const slider = document.getElementById(`toggle-${userId}`);
  if (slider) slider.style.background = active ? '#10b981' : '#ef4444';
  showToast(`User ${active ? 'activated' : 'deactivated'}`, 'success');
}

async function openEditUser(userId) {
  const user = allUsers.find(u => u.id === userId);
  if (!user) return;

  document.getElementById('edit-user-id').value = user.id;
  document.getElementById('edit-user-name').value = user.full_name || '';
  document.getElementById('edit-user-role').value = user.role;

  const branchSel = document.getElementById('edit-user-branch');
  branchSel.innerHTML = '<option value="">— No Branch —</option>' +
    allBranches.map(b => `<option value="${b.id}">${escHtml(b.name)}</option>`).join('');
  branchSel.value = user.branch_id || '';

  openModal('edit-user-modal');
}

document.getElementById('edit-user-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('edit-user-id').value;
  const payload = {
    full_name: document.getElementById('edit-user-name').value.trim(),
    role: document.getElementById('edit-user-role').value,
    branch_id: document.getElementById('edit-user-branch').value || null,
  };
  const { error } = await db.from('profiles').update(payload).eq('id', id);
  if (error) { showToast('Failed to update user', 'error'); return; }
  showToast('User updated', 'success');
  closeModal('edit-user-modal');
  loadUsers();
});

async function deleteUser(userId) {
  if (!confirm('Remove this user from the system? They will be permanently removed from the user list.')) return;
  const { error } = await db.from('profiles').delete().eq('id', userId);
  if (error) { showToast('Failed to remove user: ' + error.message, 'error'); return; }
  showToast('User removed', 'success');
  loadUsers();
}

// =============================================
//  REPORTS
// =============================================
async function loadReports() {
  const base = () => {
    let q = db.from('leads').select('*', { count: 'exact', head: true });
    if (currentProfile.role === 'branch_manager') q = q.eq('branch_id', currentProfile.branch_id);
    if (currentProfile.role === 'client_consultant') q = q.eq('assigned_to', currentUser.id);
    return q;
  };

  // Count each status in parallel
  const statusCounts = {};
  await Promise.all(LEAD_STATUSES.map(async s => {
    const { count } = await base().eq('status', s.value);
    statusCounts[s.value] = count || 0;
  }));

  const total = Object.values(statusCounts).reduce((a, b) => a + b, 0);
  const converted = statusCounts['converted'] || 0;
  const convRate = total ? ((converted / total) * 100).toFixed(1) : 0;

  setText('report-total-leads', total);
  setText('report-total-won', converted);
  setText('report-conversion', convRate + '%');

  // Status breakdown
  const breakdownEl = document.getElementById('report-status-breakdown');
  if (breakdownEl) {
    breakdownEl.innerHTML = LEAD_STATUSES.map(s => {
      const count = statusCounts[s.value] || 0;
      const pct = total ? ((count / total) * 100).toFixed(0) : 0;
      return `
        <div style="margin-bottom:14px">
          <div style="display:flex;justify-content:space-between;margin-bottom:6px;font-size:13px">
            <span style="font-weight:500">${s.label}</span>
            <span style="color:var(--text-muted)">${count} leads (${pct}%)</span>
          </div>
          <div class="progress"><div class="progress-bar" style="width:${pct}%;background:${s.color}"></div></div>
        </div>`;
    }).join('');
  }
}

// =============================================
//  IMPORT
// =============================================
function initImport() {
  const zone = document.getElementById('import-zone');
  if (!zone) return;
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragover'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
  zone.addEventListener('drop', e => { e.preventDefault(); zone.classList.remove('dragover'); handleFile(e.dataTransfer.files[0]); });

  document.getElementById('import-file-input')?.addEventListener('change', e => handleFile(e.target.files[0]));
}

async function handleFile(file) {
  if (!file) return;
  const ext = file.name.split('.').pop().toLowerCase();
  if (!['csv','xlsx','xls'].includes(ext)) { showToast('Please upload a CSV or Excel file', 'error'); return; }

  showToast('Reading file...', 'info');

  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      let rows;
      if (ext === 'csv') {
        rows = parseCSV(e.target.result);
      } else {
        // XLSX requires SheetJS (loaded from CDN)
        const wb = XLSX.read(e.target.result, { type: 'binary' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
      }

      previewImport(rows, file.name);
    } catch (err) {
      showToast('Failed to read file: ' + err.message, 'error');
    }
  };

  if (ext === 'csv') reader.readAsText(file);
  else reader.readAsBinaryString(file);
}

function parseCSV(text) {
  const lines = text.split('\n').filter(l => l.trim());
  const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
  return lines.slice(1).map(line => {
    const vals = line.split(',').map(v => v.trim().replace(/"/g, ''));
    return Object.fromEntries(headers.map((h, i) => [h, vals[i] || '']));
  });
}

function previewImport(rows, filename) {
  if (!rows.length) { showToast('No data found in file', 'error'); return; }

  const previewEl = document.getElementById('import-preview');
  const countEl = document.getElementById('import-count');
  if (countEl) countEl.textContent = `${rows.length} records found in "${filename}"`;

  // Auto-map columns
  const colMap = autoMapColumns(Object.keys(rows[0]));
  document.getElementById('import-col-map').innerHTML = Object.entries(colMap).map(([src, dst]) =>
    `<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;font-size:13px">
       <span style="background:var(--bg);padding:4px 10px;border-radius:4px;border:1px solid var(--border);min-width:140px">${escHtml(src)}</span>
       <span>→</span>
       <select class="filter-select col-map-sel" data-src="${escHtml(src)}" style="flex:1">
         <option value="">— Skip —</option>
         ${['full_name','first_name','last_name','phone','email','status','source','notes','value','caller','date'].map(f => `<option value="${f}" ${dst===f?'selected':''}>${f}</option>`).join('')}
       </select>
     </div>`
  ).join('');

  // Preview table (first 5 rows)
  const headers = Object.keys(rows[0]);
  const previewTable = document.getElementById('import-table');
  if (previewTable) {
    previewTable.innerHTML = `
      <table class="table"><thead><tr>${headers.map(h => `<th>${escHtml(h)}</th>`).join('')}</tr></thead>
      <tbody>${rows.slice(0, 5).map(r => `<tr>${headers.map(h => `<td>${escHtml(String(r[h] || ''))}</td>`).join('')}</tr>`).join('')}</tbody>
      </table>${rows.length > 5 ? `<p style="padding:8px 16px;font-size:12px;color:var(--text-muted)">...and ${rows.length - 5} more rows</p>` : ''}`;
  }

  if (previewEl) previewEl.style.display = 'block';

  document.getElementById('confirm-import-btn').onclick = () => confirmImport(rows);
}

function autoMapColumns(headers) {
  const map = {};
  const aliases = {
    full_name:  ['name', 'full name', 'fullname', 'client name', 'customer name'],
    first_name: ['first name','firstname','first','fname','given name'],
    last_name:  ['last name','lastname','last','lname','surname','family name'],
    email:      ['email','e-mail','email address','contact'],
    phone:      ['phone','phone no','phone number','mobile','tel','telephone','contact number','hp'],
    status:     ['status','lead status','stage','result'],
    source:     ['source','lead source','channel','origin','responses'],
    notes:      ['notes','note','comments','remark','remarks'],
    value:      ['value','deal value','amount','deal size','revenue'],
    caller:     ['caller','agent','consultant','assigned to','staff'],
    date:       ['date','date added','created','lead date'],
  };
  headers.forEach(h => {
    const lower = h.toLowerCase().trim();
    for (const [field, alts] of Object.entries(aliases)) {
      if (alts.includes(lower) || lower === field) { map[h] = field; break; }
    }
    if (!map[h]) map[h] = '';
  });
  return map;
}

async function confirmImport(rows) {
  const colMaps = {};
  document.querySelectorAll('.col-map-sel').forEach(sel => {
    if (sel.value) colMaps[sel.dataset.src] = sel.value;
  });

  const leads = rows.map(row => {
    // Skip completely empty rows
    const hasAnyValue = Object.values(row).some(v => String(v || '').trim() !== '');
    if (!hasAnyValue) return null;

    const lead = { branch_id: currentProfile.branch_id, created_by: currentUser.id };
    Object.entries(colMaps).forEach(([src, dst]) => {
      const val = String(row[src] || '').trim();
      if (!val) return;
      if (dst === 'full_name') {
        const parts = val.split(/\s+/);
        lead.first_name = parts[0] || '';
        lead.last_name = parts.slice(1).join(' ') || '';
      } else if (dst === 'caller') {
        lead.notes = (lead.notes ? lead.notes + ' | ' : '') + 'Caller: ' + val;
      } else if (dst === 'date') {
        // Handle DD/MM/YY and DD/MM/YYYY formats
        const ddmmyy = val.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
        if (ddmmyy) {
          let [, d, m, y] = ddmmyy;
          if (y.length === 2) y = '20' + y;
          const parsed = new Date(`${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`);
          if (!isNaN(parsed)) lead.created_at = parsed.toISOString();
        } else {
          const parsed = new Date(val);
          if (!isNaN(parsed)) lead.created_at = parsed.toISOString();
        }
      } else {
        lead[dst] = val;
      }
    });

    // Normalise status
    const statusVal = (lead.status || '').toLowerCase().trim();
    const matched = LEAD_STATUSES.find(s => s.value === statusVal || s.label.toLowerCase() === statusVal);
    lead.status = matched ? matched.value : 'new';

    // Clean up value field
    if (lead.value) lead.value = parseFloat(String(lead.value).replace(/[^0-9.]/g, '')) || null;

    // Must have at least a name or phone to be worth importing
    return (lead.first_name || lead.last_name || lead.phone) ? lead : null;
  }).filter(Boolean);

  if (!leads.length) { showToast('No valid rows to import', 'error'); return; }

  const btn = document.getElementById('confirm-import-btn');
  const progressBar = document.getElementById('import-progress-bar');
  const progressWrap = document.getElementById('import-progress-wrap');
  btn.disabled = true;
  if (progressWrap) progressWrap.style.display = 'block';

  let imported = 0;
  let failed = 0;
  const batchSize = 50; // Small batches to avoid timeouts

  for (let i = 0; i < leads.length; i += batchSize) {
    const batch = leads.slice(i, i + batchSize);
    const progress = Math.round(((i + batch.length) / leads.length) * 100);
    btn.textContent = `Importing... ${progress}% (${i + batch.length} of ${leads.length})`;
    if (progressBar) progressBar.style.width = progress + '%';

    // Timeout wrapper — skip batch if it hangs for 15 seconds
    const insertWithTimeout = new Promise(async (resolve) => {
      const timer = setTimeout(() => resolve({ error: { message: 'timeout' } }), 15000);
      const result = await db.from('leads').insert(batch);
      clearTimeout(timer);
      resolve(result);
    });

    const { error } = await insertWithTimeout;

    if (!error) {
      imported += batch.length;
    } else {
      // Retry row by row on failure
      for (const lead of batch) {
        const { error: rowErr } = await db.from('leads').insert(lead);
        if (!rowErr) imported++;
        else failed++;
      }
    }

    // Pause between batches
    await new Promise(r => setTimeout(r, 300));
  }

  btn.disabled = false; btn.textContent = 'Import Leads';
  const msg = failed > 0
    ? `✅ Imported ${imported} leads. ⚠️ ${failed} rows had errors and were skipped.`
    : `✅ Successfully imported ${imported} leads`;
  showToast(msg, failed > 0 ? 'warning' : 'success');
  document.getElementById('import-preview').style.display = 'none';
  navigateTo('leads');
}

// =============================================
//  QUICK STATUS CHANGE
// =============================================
function quickStatusMenu(event, leadId, currentStatus) {
  event.stopPropagation();
  document.getElementById('quick-status-menu')?.remove();

  const menu = document.createElement('div');
  menu.id = 'quick-status-menu';
  menu.style.cssText = `
    position:fixed; z-index:500;
    background:var(--surface); border:1.5px solid var(--border);
    border-radius:var(--radius); box-shadow:var(--shadow-lg);
    padding:6px; min-width:175px;
  `;

  // Position — flip upward if near bottom of screen
  const rect = event.target.getBoundingClientRect();
  const below = window.innerHeight - rect.bottom;
  if (below < 220) {
    menu.style.bottom = (window.innerHeight - rect.top + 4) + 'px';
  } else {
    menu.style.top = (rect.bottom + 4) + 'px';
  }
  menu.style.left = Math.min(rect.left, window.innerWidth - 185) + 'px';

  menu.innerHTML = `
    <div style="font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.6px;padding:4px 8px 6px">Change Status</div>
    ${LEAD_STATUSES.map(s => `
      <div class="quick-status-opt"
           onclick="quickUpdateStatus('${leadId}','${s.value}')"
           style="padding:7px 10px;border-radius:6px;cursor:pointer;display:flex;align-items:center;gap:8px;${s.value === currentStatus ? 'background:var(--bg)' : ''}">
        <span class="badge badge-${s.value}" style="font-size:11px;pointer-events:none">${s.label}</span>
        ${s.value === currentStatus ? '<span style="margin-left:auto;color:var(--success)">✓</span>' : ''}
      </div>`).join('')}`;

  document.body.appendChild(menu);

  // Close on next click anywhere
  setTimeout(() => {
    document.addEventListener('click', () => document.getElementById('quick-status-menu')?.remove(), { once: true });
  }, 0);
}

async function quickUpdateStatus(leadId, newStatus) {
  document.getElementById('quick-status-menu')?.remove();
  const label = statusLabel(newStatus);

  const { error } = await db.from('leads')
    .update({ status: newStatus, updated_at: new Date().toISOString() })
    .eq('id', leadId);

  if (error) { showToast('Failed to update status', 'error'); return; }

  // Log to activity trail
  await db.from('lead_activities').insert({
    lead_id: leadId,
    user_id: currentUser.id,
    action: `Status changed to ${label}`,
  });

  showToast(`✅ Status updated to ${label}`, 'success');
  loadLeads(false);       // keep current page
  loadPipelineSummary();  // refresh counts strip
}

// =============================================
//  EXPORT LEADS
// =============================================
function initExport() {
  const statusSel = document.getElementById('export-status');
  if (statusSel && statusSel.options.length <= 1) {
    statusSel.innerHTML = '<option value="">All Statuses</option>' +
      LEAD_STATUSES.map(s => `<option value="${s.value}">${s.label}</option>`).join('');
  }
  const branchSel = document.getElementById('export-branch');
  if (branchSel && currentProfile.role === 'admin') {
    branchSel.innerHTML = '<option value="">All Branches</option>' +
      allBranches.map(b => `<option value="${b.id}">${escHtml(b.name)}</option>`).join('');
  }
}

function buildExportFilters(query) {
  const status   = document.getElementById('export-status')?.value || '';
  const branch   = document.getElementById('export-branch')?.value || '';
  const dateFrom = document.getElementById('export-date-from')?.value || '';
  const dateTo   = document.getElementById('export-date-to')?.value || '';
  if (currentProfile.role === 'branch_manager') query = query.eq('branch_id', currentProfile.branch_id);
  if (currentProfile.role === 'client_consultant') query = query.eq('assigned_to', currentUser.id);
  if (status) query = query.eq('status', status);
  if (branch && currentProfile.role === 'admin') query = query.eq('branch_id', branch);
  if (dateFrom) query = query.gte('created_at', dateFrom);
  if (dateTo)   query = query.lte('created_at', dateTo + 'T23:59:59');
  return query;
}

async function countExportLeads() {
  const infoEl = document.getElementById('export-preview-info');
  if (infoEl) infoEl.textContent = 'Counting...';
  const { count } = await buildExportFilters(
    db.from('leads').select('*', { count: 'exact', head: true })
  );
  if (infoEl) infoEl.innerHTML = `<strong>${(count || 0).toLocaleString()} leads</strong> match your filters and will be exported.`;
}

async function doExport(format) {
  showToast('Preparing export — please wait...', 'info');
  let allData = [];
  let from = 0;
  const batchSize = 1000;

  while (true) {
    const { data, error } = await buildExportFilters(
      db.from('leads')
        .select(`first_name,last_name,email,phone,status,source,social_media,notes,assigned_name,created_at,branches(name),assigned_profile:profiles!leads_assigned_to_fkey(full_name)`)
        .order('created_at', { ascending: false })
        .range(from, from + batchSize - 1)
    );
    if (error || !data || !data.length) break;
    allData = allData.concat(data);
    if (data.length < batchSize) break;
    from += batchSize;
  }

  if (!allData.length) { showToast('No leads found to export', 'error'); return; }

  const rows = allData.map(l => ({
    'First Name':   l.first_name || '',
    'Last Name':    l.last_name  || '',
    'Email':        l.email      || '',
    'Phone':        l.phone      || '',
    'Status':       statusLabel(l.status),
    'Source':       l.source     || '',
    'Branch':       l.branches?.name || '',
    'Assigned To':  l.assigned_profile?.full_name || l.assigned_name || '',
    'Social Media': l.social_media || '',
    'Notes':        l.notes      || '',
    'Date Added':   formatDate(l.created_at),
  }));

  format === 'csv' ? exportCSV(rows, 'leads_export') : exportXLSX(rows, 'leads_export');
  showToast(`✅ Exported ${rows.length.toLocaleString()} leads`, 'success');
}

function exportCSV(rows, filename) {
  const headers = Object.keys(rows[0]);
  const csv = [
    headers.join(','),
    ...rows.map(r => headers.map(h => `"${String(r[h] || '').replace(/"/g, '""')}"`).join(','))
  ].join('\n');
  const blob = new Blob(['﻿' + csv, { type: 'text/csv;charset=utf-8;' }]);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${filename}_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
}

function exportXLSX(rows, filename) {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Leads');
  XLSX.writeFile(wb, `${filename}_${new Date().toISOString().slice(0,10)}.xlsx`);
}

// =============================================
//  DUPLICATE CHECKER
// =============================================
async function scanDuplicates() {
  const container = document.getElementById('duplicates-container');
  if (!container) return;

  container.innerHTML = `<div class="card"><div class="card-body" style="text-align:center;padding:48px">
    <div class="spinner" style="margin:0 auto 16px"></div>
    <p style="color:var(--text-muted);font-size:14px">Scanning all leads for duplicate phone numbers...</p>
  </div></div>`;

  // Fetch all leads in batches
  let allData = [];
  let from = 0;
  const batchSize = 1000;

  while (true) {
    let q = db.from('leads')
      .select('id,first_name,last_name,phone,status,created_at,branches(name)')
      .order('created_at', { ascending: true })
      .range(from, from + batchSize - 1);
    if (currentProfile.role === 'branch_manager') q = q.eq('branch_id', currentProfile.branch_id);
    if (currentProfile.role === 'client_consultant') q = q.eq('assigned_to', currentUser.id);
    const { data, error } = await q;
    if (error || !data || !data.length) break;
    allData = allData.concat(data);
    if (data.length < batchSize) break;
    from += batchSize;
  }

  // Group by normalised phone number
  const phoneMap = {};
  allData.forEach(lead => {
    const phone = (lead.phone || '').replace(/[\s\-]/g, '').trim();
    if (!phone) return;
    if (!phoneMap[phone]) phoneMap[phone] = [];
    phoneMap[phone].push(lead);
  });

  const duplicates = Object.entries(phoneMap).filter(([, leads]) => leads.length > 1);

  if (!duplicates.length) {
    container.innerHTML = `<div class="card"><div class="card-body" style="text-align:center;padding:48px">
      <div style="font-size:48px;margin-bottom:16px">✅</div>
      <h4 style="font-size:16px;font-weight:600;color:var(--success);margin-bottom:8px">No duplicates found!</h4>
      <p style="color:var(--text-muted);font-size:14px">All ${allData.length.toLocaleString()} leads have unique phone numbers.</p>
    </div></div>`;
    return;
  }

  const totalExtras = duplicates.reduce((sum, [, leads]) => sum + leads.length - 1, 0);

  container.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;padding:12px 16px;background:#fef3c7;border:1.5px solid #fde68a;border-radius:var(--radius)">
      <span style="font-size:22px">⚠️</span>
      <div>
        <div style="font-size:14px;font-weight:600;color:#92400e">${duplicates.length} duplicate phone number${duplicates.length > 1 ? 's' : ''} found</div>
        <div style="font-size:13px;color:#78350f">${totalExtras} extra record${totalExtras > 1 ? 's' : ''} can be removed. The oldest entry is marked <strong>Keep</strong> — remove the rest.</div>
      </div>
    </div>
    ${duplicates.map(([phone, leads]) => `
      <div class="dup-group">
        <div class="dup-group-header">
          <span class="dup-phone">📱 ${escHtml(phone)}</span>
          <span class="dup-count">${leads.length} entries</span>
        </div>
        ${leads.map((l, i) => `
          <div class="dup-lead-row ${i === 0 ? 'keep' : ''}">
            <div>
              <div style="font-weight:600;font-size:13.5px">${escHtml(l.first_name || '')} ${escHtml(l.last_name || '')}</div>
              <div style="font-size:12px;color:var(--text-muted);margin-top:2px">
                ${escHtml(l.branches?.name || '—')} &nbsp;·&nbsp; Added ${formatDate(l.created_at)} &nbsp;·&nbsp;
                <span class="badge badge-${l.status}" style="font-size:10px;padding:2px 7px">${statusLabel(l.status)}</span>
              </div>
            </div>
            <div style="display:flex;align-items:center;gap:8px">
              ${i === 0
                ? '<span style="font-size:11px;font-weight:600;color:var(--success);background:#dcfce7;padding:3px 12px;border-radius:10px">✓ Keep</span>'
                : `<button class="btn btn-sm" style="color:var(--danger);border:1.5px solid var(--danger);background:transparent;font-size:12px;padding:4px 10px" onclick="deleteDuplicateLead('${l.id}')">🗑 Remove</button>`}
              <button class="btn btn-outline btn-sm" style="font-size:12px;padding:4px 10px" onclick="openLeadDetail('${l.id}')">View</button>
            </div>
          </div>`).join('')}
      </div>`).join('')}`;
}

async function deleteDuplicateLead(id) {
  if (!confirm('Remove this duplicate lead? This cannot be undone.')) return;
  const { error } = await db.from('leads').delete().eq('id', id);
  if (error) { showToast('Failed to remove: ' + error.message, 'error'); return; }
  showToast('Duplicate removed ✅', 'success');
  scanDuplicates();
}

// =============================================
//  ACTIVITY LOG
// =============================================
async function loadActivityLog(resetPage = true) {
  if (resetPage) activityPage = 1;
  showTableLoading('activity-tbody', 4);

  const dateFrom = document.getElementById('activity-date-from')?.value || '';
  const dateTo   = document.getElementById('activity-date-to')?.value || '';
  const from = (activityPage - 1) * ACTIVITY_PAGE_SIZE;
  const to   = from + ACTIVITY_PAGE_SIZE - 1;

  let q = db.from('lead_activities')
    .select(`id, action, created_at,
      lead:leads(first_name, last_name),
      actor:profiles!lead_activities_user_id_fkey(full_name)
    `, { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to);

  if (dateFrom) q = q.gte('created_at', dateFrom);
  if (dateTo)   q = q.lte('created_at', dateTo + 'T23:59:59');

  const { data, count, error } = await q;

  if (error) { showToast('Failed to load activity log', 'error'); return; }

  const tbody = document.getElementById('activity-tbody');
  if (!tbody) return;

  if (!data || !data.length) {
    tbody.innerHTML = `<tr><td colspan="4"><div class="empty-state"><div class="empty-icon">📋</div><h4>No activity found</h4><p>Try adjusting the date filters.</p></div></td></tr>`;
  } else {
    tbody.innerHTML = data.map(a => `
      <tr>
        <td style="font-weight:600">${escHtml(((a.lead?.first_name || '') + ' ' + (a.lead?.last_name || '')).trim() || '—')}</td>
        <td style="max-width:320px;color:var(--text-secondary)">${escHtml(a.action)}</td>
        <td style="white-space:nowrap">${escHtml(a.actor?.full_name || 'System')}</td>
        <td style="white-space:nowrap;color:var(--text-muted);font-size:12px">${formatDate(a.created_at, true)}</td>
      </tr>`).join('');
  }

  renderActivityPagination(count || 0);
}

function renderActivityPagination(total) {
  const container = document.getElementById('activity-pagination');
  if (!container) return;
  const totalPages = Math.ceil(total / ACTIVITY_PAGE_SIZE);
  const start = (activityPage - 1) * ACTIVITY_PAGE_SIZE + 1;
  const end   = Math.min(activityPage * ACTIVITY_PAGE_SIZE, total);
  if (total === 0) { container.innerHTML = ''; return; }
  container.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 20px;border-top:1px solid var(--border)">
      <div class="pagination-info">Showing ${start}–${end} of ${total.toLocaleString()} records</div>
      <div style="display:flex;gap:4px;align-items:center">
        <button class="page-btn" onclick="changeActivityPage(-1)" ${activityPage <= 1 ? 'disabled' : ''}>‹</button>
        <span style="padding:0 10px;font-size:13px;color:var(--text-secondary)">Page ${activityPage} of ${totalPages}</span>
        <button class="page-btn" onclick="changeActivityPage(1)" ${activityPage >= totalPages ? 'disabled' : ''}>›</button>
      </div>
    </div>`;
}

function changeActivityPage(delta) {
  activityPage += delta;
  loadActivityLog(false);
}

// =============================================
//  PIPELINE SUMMARY STRIP (Leads page)
// =============================================
async function loadPipelineSummary() {
  const strip = document.getElementById('pipeline-strip');
  if (!strip) return;

  // Show skeleton while loading
  strip.innerHTML = LEAD_STATUSES.map(() =>
    `<div class="pipeline-pill" style="background:var(--bg);border-color:var(--border)">
       <div style="height:22px;background:var(--border);border-radius:4px;margin-bottom:4px"></div>
       <div style="height:10px;background:var(--border);border-radius:4px;width:60%;margin:0 auto"></div>
     </div>`
  ).join('');

  // Fetch counts per status (role-scoped), in parallel
  const counts = {};
  await Promise.all(LEAD_STATUSES.map(async s => {
    let q = db.from('leads').select('*', { count: 'exact', head: true }).eq('status', s.value);
    if (currentProfile.role === 'branch_manager') q = q.eq('branch_id', currentProfile.branch_id);
    if (currentProfile.role === 'client_consultant') q = q.eq('assigned_to', currentUser.id);
    const { count } = await q;
    counts[s.value] = count || 0;
  }));

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const currentFilter = document.getElementById('lead-status-filter')?.value || '';

  const allActive = !currentFilter;

  strip.innerHTML = [
    // "All" pill
    `<div class="pipeline-pill ${allActive ? 'active' : ''}"
          style="${allActive ? 'border-color:#791e1e;background:#fdf2f2;' : ''}"
          onclick="setPipelineFilter('')">
       <div class="pipeline-pill-count" style="color:#791e1e">${total.toLocaleString()}</div>
       <div class="pipeline-pill-label">All Leads</div>
       <div class="pipeline-pill-pct">&nbsp;</div>
       <div class="pipeline-pill-bar" style="width:100%;background:#791e1e;opacity:${allActive?1:.3}"></div>
     </div>`,
    ...LEAD_STATUSES.map(s => {
      const count = counts[s.value] || 0;
      const pct = total ? Math.round((count / total) * 100) : 0;
      const isActive = currentFilter === s.value;
      return `
        <div class="pipeline-pill ${isActive ? 'active' : ''}"
             style="${isActive ? `border-color:${s.color};background:${s.color}18;` : ''}"
             onclick="setPipelineFilter('${s.value}')">
          <div class="pipeline-pill-count" style="color:${s.color}">${count.toLocaleString()}</div>
          <div class="pipeline-pill-label">${escHtml(s.label)}</div>
          <div class="pipeline-pill-pct">${pct}%</div>
          <div class="pipeline-pill-bar" style="width:${pct}%;background:${s.color};opacity:${isActive?1:.5}"></div>
        </div>`;
    })
  ].join('');
}

function setPipelineFilter(status) {
  const filterEl = document.getElementById('lead-status-filter');
  if (filterEl) filterEl.value = status;
  loadLeads();
  loadPipelineSummary();
}

// =============================================
//  PAGINATION
// =============================================
function renderPaginationControls(total, containerId, loadFn) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const start = (currentPage - 1) * PAGE_SIZE + 1;
  const end = Math.min(currentPage * PAGE_SIZE, total);

  // Build sliding window: always show first, last, current ±2, with ellipsis
  const pages = new Set([1, totalPages, currentPage, currentPage - 1, currentPage + 1, currentPage - 2, currentPage + 2]);
  const validPages = [...pages].filter(p => p >= 1 && p <= totalPages).sort((a, b) => a - b);

  let pageButtons = '';
  let prev = null;
  for (const p of validPages) {
    if (prev && p - prev > 1) pageButtons += `<span style="padding:0 4px;color:var(--text-muted)">…</span>`;
    pageButtons += `<button class="page-btn ${p === currentPage ? 'active' : ''}" onclick="goToPage(${p}, '${containerId}')">${p}</button>`;
    prev = p;
  }

  container.innerHTML = `
    <div class="pagination-info">Showing ${total ? start : 0}–${end} of ${total} leads</div>
    <div class="pagination-controls" style="display:flex;align-items:center;gap:4px">
      <button class="page-btn" onclick="goToPage(1, '${containerId}')" ${currentPage <= 1 ? 'disabled' : ''} title="First">«</button>
      <button class="page-btn" onclick="changePage(-1, '${containerId}')" ${currentPage <= 1 ? 'disabled' : ''}>‹</button>
      ${pageButtons}
      <button class="page-btn" onclick="changePage(1, '${containerId}')" ${currentPage >= totalPages ? 'disabled' : ''}>›</button>
      <button class="page-btn" onclick="goToPage(${totalPages}, '${containerId}')" ${currentPage >= totalPages ? 'disabled' : ''} title="Last">»</button>
    </div>`;
}

function changePage(delta, containerId) {
  currentPage += delta;
  loadLeads(false);
}

function goToPage(page, containerId) {
  currentPage = page;
  loadLeads(false);
}

// =============================================
//  MODAL HELPERS
// =============================================
function openModal(id) {
  document.getElementById(id)?.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeModal(id) {
  document.getElementById(id)?.classList.remove('open');
  document.body.style.overflow = '';
}

document.querySelectorAll('.modal-close, .modal-cancel').forEach(btn => {
  btn.addEventListener('click', () => {
    const modal = btn.closest('.modal-backdrop');
    if (modal) { modal.classList.remove('open'); document.body.style.overflow = ''; }
  });
});

document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) { backdrop.classList.remove('open'); document.body.style.overflow = ''; }
  });
});

// =============================================
//  TOAST
// =============================================
function showToast(msg, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
  toast.innerHTML = `<span>${icons[type] || 'ℹ️'}</span><span>${escHtml(msg)}</span>`;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

// =============================================
//  UTILITIES
// =============================================
function escHtml(str) {
  const d = document.createElement('div');
  d.textContent = String(str || '');
  return d.innerHTML;
}

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val ?? '';
}

function formatDate(dateStr, withTime = false) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (withTime) return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function statusLabel(s) {
  return LEAD_STATUSES.find(x => x.value === s)?.label || s;
}

function initials(name) {
  return (name || '?').split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
}

function debounce(fn, delay) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), delay); };
}

function hideLoading() {
  document.getElementById('loading-screen')?.remove();
}

function showTableLoading(tbodyId, cols) {
  const tbody = document.getElementById(tbodyId);
  if (tbody) tbody.innerHTML = `<tr><td colspan="${cols}" style="text-align:center;padding:32px;color:var(--text-muted)"><div class="spinner" style="margin:0 auto"></div></td></tr>`;
}

function setLoading(btnId, loading) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.disabled = loading;
  const text = btn.querySelector('.btn-text') || btn;
  if (btn.dataset.text && loading) text.textContent = 'Saving...';
  else if (btn.dataset.text) text.textContent = btn.dataset.text;
}

// =============================================
//  AUTO-LOGOUT AFTER 5 MINUTES INACTIVITY
// =============================================
(function initAutoLogout() {
  const INACTIVE_LIMIT = 5 * 60 * 1000;   // 5 minutes
  const WARN_BEFORE    = 60 * 1000;        // warn 1 minute before logout
  let logoutTimer, warnTimer, warningEl;

  function createWarning() {
    warningEl = document.createElement('div');
    warningEl.id = 'inactivity-warning';
    warningEl.style.cssText = `
      position:fixed; bottom:24px; left:50%; transform:translateX(-50%);
      background:#1e293b; color:white; padding:14px 24px; border-radius:10px;
      font-size:14px; z-index:9999; box-shadow:0 4px 20px rgba(0,0,0,.3);
      display:flex; align-items:center; gap:16px;
    `;
    warningEl.innerHTML = `
      <span>⚠️ You'll be logged out in <strong id="countdown">60</strong>s due to inactivity</span>
      <button onclick="resetInactivityTimer()" style="background:#2563eb;border:none;color:white;padding:6px 14px;border-radius:6px;cursor:pointer;font-size:13px">Stay logged in</button>
    `;
    document.body.appendChild(warningEl);

    // Countdown
    let secs = 60;
    const countInterval = setInterval(() => {
      secs--;
      const el = document.getElementById('countdown');
      if (el) el.textContent = secs;
      if (secs <= 0) clearInterval(countInterval);
    }, 1000);
    warningEl._countInterval = countInterval;
  }

  function removeWarning() {
    if (warningEl) {
      clearInterval(warningEl._countInterval);
      warningEl.remove();
      warningEl = null;
    }
  }

  async function autoLogout() {
    removeWarning();
    await db.auth.signOut();
    window.location.href = 'index.html';
  }

  function resetInactivityTimer() {
    clearTimeout(logoutTimer);
    clearTimeout(warnTimer);
    removeWarning();

    warnTimer   = setTimeout(createWarning, INACTIVE_LIMIT - WARN_BEFORE);
    logoutTimer = setTimeout(autoLogout,    INACTIVE_LIMIT);
  }

  // Reset on any user interaction
  ['mousemove','mousedown','keydown','touchstart','scroll','click'].forEach(evt => {
    document.addEventListener(evt, resetInactivityTimer, { passive: true });
  });

  // Start the timer
  resetInactivityTimer();
  window.resetInactivityTimer = resetInactivityTimer;
})();

// Global handlers for inline onclick calls
window.toggleSocialMediaOther = toggleSocialMediaOther;
window.toggleSelectAll = toggleSelectAll;
window.updateBulkBar = updateBulkBar;
window.clearSelection = clearSelection;
window.bulkAssign = bulkAssign;
window.openLeadDetail = openLeadDetail;
window.openEditLead = openEditLead;
window.deleteLead = deleteLead;
window.openEditUser = openEditUser;
window.deleteUser = deleteUser;
window.toggleUserActive = toggleUserActive;
window.changePage = changePage;
window.goToPage = goToPage;
window.setPipelineFilter = setPipelineFilter;
window.loadPipelineSummary = loadPipelineSummary;
window.quickStatusMenu = quickStatusMenu;
window.quickUpdateStatus = quickUpdateStatus;
window.bulkUpdateStatus = bulkUpdateStatus;
window.countExportLeads = countExportLeads;
window.doExport = doExport;
window.scanDuplicates = scanDuplicates;
window.deleteDuplicateLead = deleteDuplicateLead;
window.loadActivityLog = loadActivityLog;
window.changeActivityPage = changeActivityPage;
window.openModal = openModal;
window.closeModal = closeModal;
window.openAddLead = openAddLead;
window.navigateTo = navigateTo;

// Init filters after branches loaded
setTimeout(initLeadFilters, 500);
