// =============================================
//  SUPABASE CONFIGURATION
//  Fill in your Project URL and Anon Key below.
//  Find these in: Supabase Dashboard → Settings → API
// =============================================

const SUPABASE_URL = 'https://azfnkiqjiuacocawayqq.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF6Zm5raXFqaXVhY29jYXdheXFxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg3NDQ0NzIsImV4cCI6MjA5NDMyMDQ3Mn0.sz-jazEXf135kyNf627T6fWvHAhRLFFV78rCMHKI3vg';

// App settings
const APP_NAME = 'LeadFlow CRM';
const APP_VERSION = '1.0.0';

// Lead status options (order matters — used for pipeline display)
const LEAD_STATUSES = [
  { value: 'new',             label: 'New',             color: '#2563eb' },
  { value: 'called',          label: 'Called',          color: '#d97706' },
  { value: 'interested',      label: 'Interested',      color: '#7c3aed' },
  { value: 'appointment_set', label: 'Appointment Set', color: '#ea580c' },
  { value: 'converted',       label: 'Converted',       color: '#059669' },
  { value: 'not_interested',  label: 'Not Interested',  color: '#dc2626' },
];

// Lead source options
const LEAD_SOURCES = [
  'Referral', 'Website', 'Cold Call', 'Social Media',
  'Email Campaign', 'Walk-in', 'Event', 'Partner', 'Other'
];

// Role definitions
const ROLES = {
  admin: { label: 'Admin', color: 'role-admin' },
  branch_manager: { label: 'Branch Manager', color: 'role-branch_manager' },
  client_consultant: { label: 'Client Consultant', color: 'role-client_consultant' },
};
