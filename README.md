# Herd: shared pet care

A web app your whole household adds to their home screen. Everyone sees today's
pet routines, checks things off with one tap, and sees who did what, live.
Nobody double-feeds the dog.

- **Accounts and households.** Sign up, start a household, invite people with a link or code. Belong to more than one household and switch between them.
- **Pets.** Any kind of pet, with a photo. Starter routines for each species, plus your own tasks from the first screen.
- **Routines.** Every day, certain days, every few days, or one time. Times, an assigned person, and notes.
- **Health.** Medications with doses, vaccines, vet visits, and a weight log with a trend chart.
- **Today.** A checklist built from everyone's routines. Look ahead to tomorrow or any day. Skip a task, snooze it a day, add a note, or fix the time on a check-off.
- **Calendar.** A month view of medications, vaccines, vet visits and other scheduled tasks, with what's coming up.
- **Activity.** Two weeks of history and a "last 7 days" count of who did what.
- **Sitter links.** A no-account link for a walker or sitter that shows only today's tasks for the pets you pick, and stops working on a date you choose.
- **Reminders.** Push notifications when a task is 30 minutes late, and an optional morning summary.
- **Demo mode.** Works with no setup, so you can try it before connecting anything.

Built with React, TypeScript and Vite. Data, accounts and live updates come from
[Supabase](https://supabase.com) (the free tier is plenty). Hosted free on GitHub Pages.

---

## Updating an existing setup

Already running Herd? Each update that changes the database comes with a numbered
file in `supabase/migrations`. Run each new one once, in order.

**Update 002** (photos, health, sitter links, reminders, skip and snooze):

1. Open `supabase/migrations/002_health_sitters_reminders.sql` in Notepad, select all, and copy.
2. In Supabase, open **SQL Editor**, click **New query**, paste, and click **Run**. You should see "Success. No rows returned".
3. Double-click `ship.cmd` to push the new app code. GitHub redeploys in about 2 minutes.

Run the database step before or at the same time as pushing the code. The new app
shows a message asking for the update if the database is behind.

Then, to get reminders, follow **Turn on reminders** below.

---

## Set it up from scratch (about 15 minutes)

### 1. Create the database

1. Sign up at [supabase.com](https://supabase.com) and create a new project. Pick any name and save the database password somewhere.
2. When it finishes, open **SQL Editor**, click **New query**, paste the whole of `supabase/schema.sql`, and click **Run**. You should see "Success. No rows returned".

That one file creates every table, the invite system, sitter links, and the security
rules that keep each household's data private. (It's the migrations folder joined
into one file.)

### 2. Put the app on GitHub Pages

On Windows, double-click **`setup-github.cmd`** in this folder. It runs on your PC as you, and:

1. Installs Git and the GitHub CLI with winget if they're missing (it asks first).
2. Signs you in to GitHub in your browser, the first time only.
3. Makes the first commit with your own git name and email.
4. Creates a public `herd` repo on your account, turns on GitHub Pages, and pushes.
5. Opens the **Actions** tab. When the "Deploy to GitHub Pages" run turns green (about 2 minutes), your app is at `https://YOUR-USERNAME.github.io/herd/`.

The repo is public because GitHub Pages is free for public repos. Nothing secret lives in the code.

### 3. Connect the two

1. In Supabase, click **Connect** at the top of the project and copy the **Project URL**. Then open **Project Settings > API Keys** and copy the **publishable key**.
2. Open `public/config.js` in Notepad on your PC, paste both values in, save, and double-click `ship.cmd`.
3. In Supabase, open **Authentication > URL Configuration**. Set **Site URL** to your GitHub Pages URL and add the same URL under **Redirect URLs**.
4. If you deploy to a different Supabase project later, also change the project URL inside `supabase/enable-reminders.sql`.

The publishable key is meant to be public. The rules in the database decide who can
read and write what, and they're tested to make sure one household can never see
another's data.

### 4. Use it

1. Open your GitHub Pages URL in Safari on your iPhone, create an account, and start a household.
2. Tap **Share > Add to Home Screen**. It now opens like an app.
3. Go to the **Household** tab and tap **Share invite link**. Whoever opens it signs up and lands in your household.

---

## Turn on reminders (about 10 minutes, once)

Reminders come from a small function that runs on Supabase every 5 minutes. It
creates its own push keys the first time it runs, so there's nothing secret to copy.

1. **Create the function.** In Supabase, click **Edge Functions** in the left sidebar, then **Deploy a new function > Via Editor**.
2. **Name it** `send-reminders` (exactly that).
3. **Paste the code.** Open `supabase/functions/send-reminders/index.ts` in Notepad, select all, copy, and replace everything in the editor with it. Click **Deploy function** and wait for the success message.
4. **Turn off JWT verification** for this function. Open the function's details or settings and switch off the option to verify JWTs (it may be labeled "Verify JWT" or "Enforce JWT verification"), then save. The function checks its own password instead.
5. **Schedule it.** Open **SQL Editor**, paste the whole of `supabase/enable-reminders.sql`, and click **Run**.
6. **Wait 5 minutes** for the first run. Then on your iPhone, open Herd **from the Home Screen**, go to **Household > Reminders**, tap **Turn on reminders**, and tap **Allow**.

Everyone who wants reminders does step 6 on their own phone. Each person picks
whether they get late-task alerts and a morning summary in the same section.

**Checking it works:** in Supabase, open **Edge Functions > send-reminders > Logs**.
A run every 5 minutes with status 200 means it's working. To turn reminders off for
everyone, run `select cron.unschedule('herd-reminders');` in the SQL Editor.

---

## Sitter links

In **Household > Sitter links**, tap **New sitter link**, enter who it's for, pick
the pets and how long it lasts, then share it by text. The sitter:

- sees today's tasks for those pets, the pet notes, and who already did what
- checks things off without an account (their check-offs show as "Maria (sitter)")
- can't see the calendar, history, other pets, your household's people, or the invite code

Tap **See what they see** to preview their page. **Turn off** ends the link right away.

---

## Shipping changes

Double-click **`ship.cmd`**. It shows what changed, asks you to confirm, then commits as you and pushes. GitHub rebuilds and redeploys the app in about 2 minutes. If a `.commit-message` file is in the folder, its text becomes the commit message; otherwise it asks for one.

## Working on the code

You need [Node.js](https://nodejs.org) 20 or newer.

```
npm install
npm run dev             # local dev server, http://localhost:5173
npm test                # schedule, skip/snooze and reminder rules
npm run test:schema     # rebuilds schema.sql, runs it in an in-memory Postgres, checks the security rules
npm run build           # production build into dist/
npm run build:function  # rebuilds supabase/functions/send-reminders/index.ts from its src files
npm run build:preview   # one self-contained demo file in dist-preview/index.html
```

Without real values in `public/config.js`, the app runs in demo-only mode.

### Where things live

| Path | What it does |
| --- | --- |
| `supabase/migrations/` | Numbered database changes. Run new ones on an existing project |
| `supabase/schema.sql` | All migrations in one file, for a new project |
| `supabase/functions/send-reminders/` | The reminder function (`index.ts` is what you paste) |
| `supabase/enable-reminders.sql` | Schedules the reminder function every 5 minutes |
| `src/lib/types.ts` | Data shapes and the `Backend` interface the screens talk to |
| `src/lib/supabaseBackend.ts` | The real backend (Supabase) |
| `src/lib/demoBackend.ts` | The in-browser demo, including Priya and Maria |
| `src/lib/schedule.ts` | When routines are due and how they're described |
| `src/lib/day.ts` | One day's tasks after skips and snoozes |
| `src/state.tsx` | Loading, live sync, and optimistic check-offs |
| `src/screens/` | Today, Calendar, Pets, Activity, Household, Sitter, sign-in and setup |
| `public/` | `config.js`, icons, home screen manifest, service worker (offline + notifications) |

### How "nobody double-feeds the dog" works

Each routine can be resolved once per time slot per day: done, skipped, or snoozed.
The database enforces that with a unique index (`task_logs_once_per_slot`), so if two
people tap at the same moment, the second one gets "Priya already took care of this
one" instead of a duplicate. A snoozed task keeps that same record and moves it to
the next day, so finishing it there can also only happen once.

## What's next

- **Kids' schedules** for babysitters, using the same routines and sitter links.
- **App Store version** by wrapping this same code once the idea is proven. Apple will also require in-app account deletion and a privacy policy page.
