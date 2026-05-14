// =============================================
//  AUTH MODULE
//  Handles Sign In, Sign Up, Session management
// =============================================

const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ---- Tab switching ----
const tabBtns = document.querySelectorAll('.auth-tab');
const signinForm = document.getElementById('signin-form');
const signupForm = document.getElementById('signup-form');

tabBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    tabBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const tab = btn.dataset.tab;
    signinForm.style.display = tab === 'signin' ? 'block' : 'none';
    signupForm.style.display = tab === 'signup' ? 'block' : 'none';
    clearErrors();
  });
});

// ---- Password visibility toggle ----
document.querySelectorAll('.toggle-pw').forEach(btn => {
  btn.addEventListener('click', () => {
    const input = btn.previousElementSibling;
    const isText = input.type === 'text';
    input.type = isText ? 'password' : 'text';
    btn.textContent = isText ? '👁️' : '🙈';
  });
});

// ---- Sign In ----
document.getElementById('signin-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearErrors();
  const email = e.target.email.value.trim();
  const password = e.target.password.value;

  setLoading('signin-btn', true);

  const { data, error } = await db.auth.signInWithPassword({ email, password });

  if (error) {
    showError('signin-error', friendlyAuthError(error.message));
    setLoading('signin-btn', false);
    return;
  }

  // Fetch profile to check role & status
  const { data: profile, error: profileErr } = await db
    .from('profiles')
    .select('role, full_name, is_active, branch_id')
    .eq('id', data.user.id)
    .single();

  if (profileErr || !profile) {
    await db.auth.signOut();
    showError('signin-error', 'Account setup incomplete. Please contact your administrator.');
    setLoading('signin-btn', false);
    return;
  }

  if (!profile.is_active) {
    await db.auth.signOut();
    showError('signin-error', 'Your account has been deactivated. Contact your administrator.');
    setLoading('signin-btn', false);
    return;
  }

  window.location.href = 'dashboard.html';
});

// ---- Sign Up ----
document.getElementById('signup-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearErrors();

  const fullName = e.target.full_name.value.trim();
  const email = e.target.email.value.trim();
  const password = e.target.password.value;
  const confirmPassword = e.target.confirm_password.value;
  const role = e.target.role.value;

  if (!fullName || !email || !password || !role) {
    showError('signup-error', 'Please fill in all required fields.');
    return;
  }

  if (password.length < 8) {
    showError('signup-error', 'Password must be at least 8 characters.');
    return;
  }

  if (password !== confirmPassword) {
    showError('signup-error', 'Passwords do not match.');
    return;
  }

  // Admin role signup requires approval — accounts are created inactive
  setLoading('signup-btn', true);

  const { data, error } = await db.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName, role }
    }
  });

  if (error) {
    showError('signup-error', friendlyAuthError(error.message));
    setLoading('signup-btn', false);
    return;
  }

  // Insert profile (trigger also handles this, but explicit insert as fallback)
  if (data.user) {
    await db.from('profiles').upsert({
      id: data.user.id,
      full_name: fullName,
      email,
      role,
      is_active: false  // Requires admin activation
    });
  }

  setLoading('signup-btn', false);
  showSuccess('signup-success',
    '✅ Account created! An administrator must activate your account before you can sign in.'
  );
  e.target.reset();
});

// ---- Check existing session ----
(async () => {
  const { data: { session } } = await db.auth.getSession();
  if (session) {
    window.location.href = 'dashboard.html';
  }
})();

// ---- Helpers ----
function setLoading(btnId, loading) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.disabled = loading;
  const spinner = btn.querySelector('.btn-spinner');
  const text = btn.querySelector('.btn-text');
  if (spinner) spinner.style.display = loading ? 'inline-block' : 'none';
  if (text) text.textContent = loading ? 'Please wait...' : btn.dataset.text;
}

function showError(id, msg) {
  const el = document.getElementById(id);
  if (el) { el.textContent = msg; el.style.display = 'block'; }
}

function showSuccess(id, msg) {
  const el = document.getElementById(id);
  if (el) { el.textContent = msg; el.style.display = 'block'; el.className = 'form-msg success'; }
}

function clearErrors() {
  document.querySelectorAll('.form-msg').forEach(el => {
    el.style.display = 'none'; el.textContent = '';
  });
}

function friendlyAuthError(msg) {
  if (msg.includes('Invalid login credentials')) return 'Incorrect email or password.';
  if (msg.includes('Email not confirmed')) return 'Please check your email to confirm your account.';
  if (msg.includes('already registered')) return 'An account with this email already exists.';
  if (msg.includes('rate limit')) return 'Too many attempts. Please wait a moment and try again.';
  return msg;
}
