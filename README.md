# Water Break

A water reminder with a daily goal, a streak counter and an aquarium that fills with a fish every day you reach your goal. Sign in with an email and password and your settings, history and fish sync across devices through Supabase.

Built with Vite (plain JavaScript) and `@supabase/supabase-js`. It deploys to Vercel as a static site.

## How it works

- The app works without an account. Everything is saved in the browser (`localStorage`).
- When Supabase is configured, a sign-in card appears. After signing in or creating an account, local data is merged into the account and every change is saved to Postgres. Changes made on one device appear on the others through Supabase Realtime.
- Row Level Security limits every table to the signed-in user's own rows.
- Reminders fire while the tab is open: an on-screen banner, a chime, a flashing tab title and (once allowed) a desktop notification.

```
index.html            page markup
src/main.js           app logic, reminders, rewards, sync wiring
src/supabase.js       Supabase client and database helpers
src/style.css         styles (light and dark)
supabase/schema.sql   tables, RLS policies, realtime
```

## 1. Run it locally

```bash
npm install
cp .env.example .env.local   # fill in after step 2
npm run dev
```

Without the env vars the app still runs, in local-only mode.

## 2. Set up Supabase

1. Create a project at https://supabase.com/dashboard.
2. Open **SQL Editor**, paste the contents of `supabase/schema.sql` and run it. This creates `water_settings`, `water_logs` and `water_rewards` with RLS and realtime.
3. Open **Project Settings > API** and copy the **Project URL** and the **anon public** key into `.env.local`:

   ```
   VITE_SUPABASE_URL=https://xxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJ...
   ```

4. Open **Authentication > Sign In / Providers > Email** and turn **off** "Confirm email". Then new accounts are signed in immediately and Supabase sends no emails, so you never hit its email limits. (If you leave it on, people must confirm through an email first.)
5. Open **Authentication > URL Configuration**. Set **Site URL** to your Vercel URL once you have it (step 4) and add `http://localhost:5173` under **Redirect URLs** for local testing.

There is no password reset flow. Someone who forgets their password can create a new account, but their old data stays with the old one.

The anon key is safe to ship in the browser because RLS protects the data. Never put the `service_role` key in this project.

## 3. Put it on GitHub

```bash
git init
git add .
git commit -m "Water Break"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/water-break.git
git push -u origin main
```

Create the empty `water-break` repository on GitHub first (no README or .gitignore), or run `gh repo create water-break --public --source=. --push`.

## 4. Deploy on Vercel

1. Go to https://vercel.com/new and import the GitHub repository. Vercel detects Vite automatically (build command `npm run build`, output `dist`).
2. Under **Environment Variables** add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` with the same values as `.env.local`.
3. Deploy. Then add the resulting URL (for example `https://water-break.vercel.app`) as the **Site URL** and a **Redirect URL** in Supabase (step 2.4), and redeploy if you changed anything.

Every push to `main` redeploys automatically.

## Known limits

- Reminders need the tab open. Browsers pause background tabs on phones, so a phone may miss reminders when locked. Reminders that arrive with the tab closed need Web Push (a service worker, push subscriptions stored in Supabase, and a scheduled job such as a Vercel Cron route that sends the pushes). That is not included here.
- On first sign-in on a device, per-day glass counts are merged by taking the higher number, so a count lowered with "-1" on another device can come back once. After that, every change is written directly.
