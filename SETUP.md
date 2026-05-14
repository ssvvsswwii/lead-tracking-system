# LeadFlow CRM — Setup Guide

## Project Structure

```
CRM-Dashboard/
├── index.html          ← Sign In / Sign Up page
├── dashboard.html      ← Main dashboard (all roles)
├── css/styles.css      ← All styles
├── js/
│   ├── config.js       ← ⚠️ FILL IN your Supabase credentials here
│   ├── auth.js         ← Login / signup logic
│   └── app.js          ← Dashboard, leads, users, import
└── sql/
    └── setup.sql       ← Run this in Supabase SQL Editor
```

---

## Step 1 — Supabase Project Credentials

1. Go to your Supabase project → **Settings → API**
2. Copy **Project URL** and **anon / public key**
3. Open `js/config.js` and replace:

```js
const SUPABASE_URL     = 'YOUR_SUPABASE_PROJECT_URL';
const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY';
```

---

## Step 2 — Run the Database Schema + RLS

1. Go to Supabase Dashboard → **SQL Editor → New Query**
2. Paste the entire contents of `sql/setup.sql`
3. Click **Run**

This creates:
- `branches` table (with 4 default branches — edit as needed)
- `profiles` table (linked to Supabase Auth)
- `leads` table
- `lead_activities` table
- All Row Level Security (RLS) policies

---

## Step 3 — Configure Row Level Security (RLS) settings

In Supabase Dashboard → **Authentication → Settings**:
- Set **Site URL** to your app's URL (e.g. `http://localhost:3000` for local dev)

---

## Step 4 — Create Your First Admin Account

1. Open `index.html` in a browser
2. Click **Request Access** tab
3. Register with your email — choose any role (you'll upgrade it to Admin)
4. Go to Supabase → **SQL Editor** and run:

```sql
UPDATE profiles
SET role = 'admin', is_active = TRUE
WHERE email = 'your-email@example.com';
```

5. Sign in — you now have full admin access

---

## Step 5 — Import Your Existing Leads (Excel)

1. Sign in as Admin
2. Navigate to **Import Leads** in the sidebar
3. Drag & drop your `.xlsx` file (or click to browse)
4. Map your spreadsheet columns to the lead fields
5. Click **Import Leads**

Your spreadsheet columns are auto-detected. Common column names are
matched automatically (e.g. "First Name", "Email", "Phone", "Status").

---

## Role Permissions Summary

| Feature                    | Admin | Branch Manager | Consultant |
|----------------------------|-------|----------------|------------|
| View all leads             | ✅    | Branch only    | Own only   |
| Add leads                  | ✅    | ✅             | ❌         |
| Edit leads                 | ✅    | Branch only    | Own only   |
| Delete leads               | ✅    | ❌             | ❌         |
| Assign leads to consultant | ✅    | Branch only    | ❌         |
| View reports               | ✅    | ✅             | ❌         |
| Manage users               | ✅    | ❌             | ❌         |
| Activate accounts          | ✅    | ❌             | ❌         |
| Import leads               | ✅    | ✅             | ❌         |

---

## Security Notes

- **All new accounts start inactive** — Admin must activate before login works
- **Row Level Security** is enforced at the database level, not just the frontend
- **Anon key is safe to use client-side** — it cannot bypass RLS policies
- Client personal data (email, phone) is only accessible to authorised roles
- Supabase encrypts all data at rest by default

---

## Local Development

Since this is plain HTML/CSS/JS, you can open it directly — or use any static server:

```bash
# Python
python -m http.server 3000

# Node
npx serve .

# VS Code
# Install "Live Server" extension → right-click index.html → Open with Live Server
```
