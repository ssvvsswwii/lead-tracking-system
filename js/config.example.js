// =============================================
//  SUPABASE CONFIGURATION — EXAMPLE TEMPLATE
//
//  1. Copy this file and rename it to config.js
//  2. Fill in your real Supabase credentials
//  3. Never commit config.js (it's in .gitignore)
//
//  Find your credentials in:
//  Supabase Dashboard → Settings → API
// =============================================

const SUPABASE_URL = 'YOUR_SUPABASE_PROJECT_URL';      // e.g. https://abcxyz.supabase.co
const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY';    // Starts with "eyJ..."

const APP_NAME = 'LeadFlow CRM';
const APP_VERSION = '1.0.0';

const LEAD_STATUSES = [
  { value: 'new',        label: 'New',        color: '#2563eb' },
  { value: 'contacted',  label: 'Contacted',  color: '#d97706' },
  { value: 'qualified',  label: 'Qualified',  color: '#7c3aed' },
  { value: 'proposal',   label: 'Proposal',   color: '#ea580c' },
  { value: 'won',        label: 'Won',        color: '#059669' },
  { value: 'lost',       label: 'Lost',       color: '#dc2626' },
];

const LEAD_SOURCES = [
  'Referral', 'Website', 'Cold Call', 'Social Media',
  'Email Campaign', 'Walk-in', 'Event', 'Partner', 'Other'
];

const ROLES = {
  admin: { label: 'Admin', color: 'role-admin' },
  branch_manager: { label: 'Branch Manager', color: 'role-branch_manager' },
  client_consultant: { label: 'Client Consultant', color: 'role-client_consultant' },
};
