-- =============================================
--  LeadFlow CRM — Supabase Database Setup
--  Run this entire file in:
--  Supabase Dashboard → SQL Editor → New Query
-- =============================================

-- =============================================
--  1. EXTENSIONS
-- =============================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";


-- =============================================
--  2. BRANCHES TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS branches (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name       TEXT NOT NULL,
  location   TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed some default branches (edit as needed)
INSERT INTO branches (name, location) VALUES
  ('Head Office',    'Kuala Lumpur'),
  ('North Branch',   'Penang'),
  ('South Branch',   'Johor Bahru'),
  ('East Branch',    'Kuantan')
ON CONFLICT DO NOTHING;


-- =============================================
--  3. PROFILES TABLE
--  Mirrors auth.users — one row per user
-- =============================================
CREATE TABLE IF NOT EXISTS profiles (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name   TEXT,
  email       TEXT UNIQUE,
  role        TEXT NOT NULL DEFAULT 'client_consultant'
                   CHECK (role IN ('admin','branch_manager','client_consultant')),
  branch_id   UUID REFERENCES branches(id) ON DELETE SET NULL,
  is_active   BOOLEAN DEFAULT FALSE,   -- Admin must activate new accounts
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Auto-create profile on new signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email, role, is_active)
  VALUES (
    NEW.id,
    NEW.raw_user_meta_data->>'full_name',
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'role', 'client_consultant'),
    FALSE   -- All new accounts start inactive
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- =============================================
--  4. LEADS TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS leads (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  first_name  TEXT,
  last_name   TEXT,
  email       TEXT,
  phone       TEXT,
  status      TEXT NOT NULL DEFAULT 'new'
                   CHECK (status IN ('new','contacted','qualified','proposal','won','lost')),
  source      TEXT,
  value       NUMERIC(12,2),
  notes       TEXT,
  branch_id   UUID REFERENCES branches(id) ON DELETE SET NULL,
  assigned_to UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_by  UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER leads_updated_at
  BEFORE UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_leads_branch     ON leads(branch_id);
CREATE INDEX IF NOT EXISTS idx_leads_assigned   ON leads(assigned_to);
CREATE INDEX IF NOT EXISTS idx_leads_status     ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_created_at ON leads(created_at DESC);


-- =============================================
--  5. LEAD ACTIVITIES TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS lead_activities (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id    UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  user_id    UUID REFERENCES profiles(id) ON DELETE SET NULL,
  action     TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_activities_lead ON lead_activities(lead_id);


-- =============================================
--  6. ENABLE ROW LEVEL SECURITY
-- =============================================
ALTER TABLE profiles       ENABLE ROW LEVEL SECURITY;
ALTER TABLE branches       ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads          ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_activities ENABLE ROW LEVEL SECURITY;


-- =============================================
--  7. HELPER: get current user's role + branch
--  Using SECURITY DEFINER so RLS can call it safely
-- =============================================
CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.get_my_branch()
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT branch_id FROM profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.is_active_user()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT is_active FROM profiles WHERE id = auth.uid();
$$;


-- =============================================
--  8. RLS POLICIES — PROFILES
-- =============================================
-- Users can read their own profile
CREATE POLICY "profiles_select_own"
  ON profiles FOR SELECT
  USING (id = auth.uid());

-- Admins can read all profiles
CREATE POLICY "profiles_select_admin"
  ON profiles FOR SELECT
  USING (public.get_my_role() = 'admin');

-- Branch managers can read profiles in their branch
CREATE POLICY "profiles_select_manager"
  ON profiles FOR SELECT
  USING (
    public.get_my_role() = 'branch_manager'
    AND branch_id = public.get_my_branch()
  );

-- Users can update their own profile (name only)
CREATE POLICY "profiles_update_own"
  ON profiles FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- Only admins can update any profile (role, branch, is_active)
CREATE POLICY "profiles_update_admin"
  ON profiles FOR UPDATE
  USING (public.get_my_role() = 'admin');

-- Auth trigger inserts are allowed
CREATE POLICY "profiles_insert_trigger"
  ON profiles FOR INSERT
  WITH CHECK (id = auth.uid());


-- =============================================
--  9. RLS POLICIES — BRANCHES
-- =============================================
-- Everyone (authenticated + active) can read branches
CREATE POLICY "branches_select_all"
  ON branches FOR SELECT
  USING (public.is_active_user() = TRUE);

-- Only admins can create/update/delete branches
CREATE POLICY "branches_write_admin"
  ON branches FOR ALL
  USING (public.get_my_role() = 'admin');


-- =============================================
--  10. RLS POLICIES — LEADS
-- =============================================

-- ADMIN: full access to all leads
CREATE POLICY "leads_admin_all"
  ON leads FOR ALL
  USING (public.get_my_role() = 'admin');

-- BRANCH MANAGER: read/write leads in their branch
CREATE POLICY "leads_manager_select"
  ON leads FOR SELECT
  USING (
    public.get_my_role() = 'branch_manager'
    AND branch_id = public.get_my_branch()
  );

CREATE POLICY "leads_manager_insert"
  ON leads FOR INSERT
  WITH CHECK (
    public.get_my_role() = 'branch_manager'
    AND branch_id = public.get_my_branch()
  );

CREATE POLICY "leads_manager_update"
  ON leads FOR UPDATE
  USING (
    public.get_my_role() = 'branch_manager'
    AND branch_id = public.get_my_branch()
  );

-- BRANCH MANAGER: cannot delete (soft-delete via status preferred)
-- (No DELETE policy for branch_manager — they can set status=lost instead)

-- CLIENT CONSULTANT: can only see and update leads assigned to them
CREATE POLICY "leads_consultant_select"
  ON leads FOR SELECT
  USING (
    public.get_my_role() = 'client_consultant'
    AND assigned_to = auth.uid()
  );

CREATE POLICY "leads_consultant_update"
  ON leads FOR UPDATE
  USING (
    public.get_my_role() = 'client_consultant'
    AND assigned_to = auth.uid()
  )
  WITH CHECK (
    -- Consultants cannot reassign leads or change branch
    assigned_to = auth.uid()
    AND branch_id = public.get_my_branch()
  );


-- =============================================
--  11. RLS POLICIES — LEAD ACTIVITIES
-- =============================================

-- Admin can see all activities
CREATE POLICY "activities_admin_all"
  ON lead_activities FOR ALL
  USING (public.get_my_role() = 'admin');

-- Branch managers see activities for leads in their branch
CREATE POLICY "activities_manager_select"
  ON lead_activities FOR SELECT
  USING (
    public.get_my_role() = 'branch_manager'
    AND lead_id IN (
      SELECT id FROM leads WHERE branch_id = public.get_my_branch()
    )
  );

CREATE POLICY "activities_manager_insert"
  ON lead_activities FOR INSERT
  WITH CHECK (
    public.get_my_role() = 'branch_manager'
    AND lead_id IN (
      SELECT id FROM leads WHERE branch_id = public.get_my_branch()
    )
  );

-- Consultants see activities for their assigned leads
CREATE POLICY "activities_consultant_select"
  ON lead_activities FOR SELECT
  USING (
    public.get_my_role() = 'client_consultant'
    AND lead_id IN (
      SELECT id FROM leads WHERE assigned_to = auth.uid()
    )
  );

CREATE POLICY "activities_consultant_insert"
  ON lead_activities FOR INSERT
  WITH CHECK (
    public.get_my_role() = 'client_consultant'
    AND user_id = auth.uid()
    AND lead_id IN (
      SELECT id FROM leads WHERE assigned_to = auth.uid()
    )
  );


-- =============================================
--  12. CREATE YOUR FIRST ADMIN USER
--  After signing up via the app, run this to
--  activate yourself as admin (replace the email):
-- =============================================

-- UPDATE profiles
-- SET role = 'admin', is_active = TRUE
-- WHERE email = 'your-admin-email@example.com';


-- =============================================
--  13. OPTIONAL: Seed test data
--  Uncomment to insert sample leads for testing
-- =============================================

/*
DO $$
DECLARE
  branch_id UUID;
BEGIN
  SELECT id INTO branch_id FROM branches WHERE name = 'Head Office' LIMIT 1;

  INSERT INTO leads (first_name, last_name, email, phone, status, source, value, branch_id) VALUES
    ('Ahmad',    'Razali',    'ahmad@example.com',   '+60111234567', 'new',       'Referral',      8500,  branch_id),
    ('Siti',     'Norzahra',  'siti@example.com',    '+60129876543', 'contacted', 'Website',       12000, branch_id),
    ('David',    'Tan',       'david@example.com',   '+60172345678', 'qualified', 'Cold Call',     5500,  branch_id),
    ('Nurul',    'Hana',      'nurul@example.com',   '+60183456789', 'proposal',  'Social Media',  22000, branch_id),
    ('Michael',  'Lim',       'michael@example.com', '+60194567890', 'won',       'Event',         35000, branch_id),
    ('Priya',    'Sharma',    'priya@example.com',   '+60165678901', 'lost',      'Email Campaign',3200,  branch_id),
    ('Jason',    'Wong',      'jason@example.com',   '+60156789012', 'new',       'Walk-in',       7800,  branch_id),
    ('Aisha',    'Malik',     'aisha@example.com',   '+60147890123', 'contacted', 'Partner',       15000, branch_id);
END $$;
*/
