# Herd: shared pet care

A web app your whole household adds to their home screen. Everyone sees today's
pet routines, checks things off with one tap, and sees who did what, live.
Nobody double-feeds the dog.

- **Accounts and households.** Sign up, start a household, and invite people with a link or code.
- **Pets and routines.** Any kind of pet. Routines can repeat every day, on certain days, or every few days, with times and an assigned person.
- **Today.** A checklist built from everyone's routines. Your check-off appears on everyone else's phone within a second.
- **Activity.** Two weeks of history, plus one-off entries like baths or vet visits.
- **Demo mode.** Works with no setup, so you can try it before connecting anything.

Built with React, TypeScript and Vite. Data, accounts and live updates come from
[Supabase](https://supabase.com) (free tier is plenty). Hosted free on GitHub Pages.

---

## Set it up (about 15 minutes, works from a PC or iPad)

### 1. Create the database

1. Sign up at [supabase.com](https://supabase.com) and create a new project. Pick any name and save the database password somewhere.
2. When it finishes, open **SQL Editor**, click **New query**, paste the whole of `supabase/schema.sql`, and click **Run**. You should see "Success. No rows returned".

That one file creates every table, the invite system, and the security rules that keep each household's data private.

### 2. Put the app on GitHub Pages

On Windows, double-click **`setup-github.cmd`** in this folder. It runs on your PC as you, and:

1. Installs Git and the GitHub CLI with winget if they're missing (it asks first).
2. Signs you in to GitHub in your browser, the first time only.
3. Makes the first commit with your own git name and email.
4. Creates a public `herd` repo on your account, turns on GitHub Pages, and pushes.
5. Opens the **Actions** tab. When the "Deploy to GitHub Pages" run turns green (about 2 minutes), your app is at `https://YOUR-USERNAME.github.io/herd/`.

The repo is public because GitHub Pages is free for public repos. Nothing secret lives in the code.

<details>
<summary>Doing it by hand instead</summary>

1. Create a new public repository on GitHub named `herd`.
2. Upload every file in this folder **except** `node_modules`, `dist` and `dist-preview` (on github.com: **Add file > Upload files**, including the hidden `.github` folder).
3. In the repo, go to **Settings > Pages** and set **Source** to **GitHub Actions**.
4. Open the **Actions** tab and wait for the run to turn green.
</details>

### 3. Connect the two

1. In Supabase, open **Project Settings > API** (on newer projects, **API Keys**). Copy the **Project URL** and the **publishable key** (older projects call it the **anon public** key).
2. In your GitHub repo, open `public/config.js`, click the pencil icon, paste both values in, and commit. GitHub rebuilds the app automatically.
3. In Supabase, open **Authentication > URL Configuration**:
   - **Site URL:** your GitHub Pages URL, for example `https://YOUR-USERNAME.github.io/herd/`
   - **Redirect URLs:** add the same URL.

   This makes the "confirm your email" and "reset password" links open your app.

The publishable/anon key is meant to be public. The rules in `schema.sql` decide who can read and write what, and they were tested to make sure one household can never see another's data.

### 4. Use it

1. Open your GitHub Pages URL in Safari on your iPhone, create an account, and start a household.
2. Tap **Share > Add to Home Screen**. It now opens like an app.
3. Go to the **Household** tab and tap **Share invite link**. Whoever opens it signs up and lands in your household.

**Tip while testing:** Supabase sends a confirmation email on sign-up, and the free tier limits how many it sends per hour. To skip it while you test, turn off **Authentication > Sign In / Providers > Email > Confirm email**. Turn it back on before sharing with other people.

---

## Shipping changes

Double-click **`ship.cmd`**. It shows what changed, asks you to confirm, then commits as you and pushes. GitHub rebuilds and redeploys the app in about 2 minutes. If a `.commit-message` file is in the folder, its text becomes the commit message; otherwise it asks for one.

## Working on the code

You need [Node.js](https://nodejs.org) 20 or newer (on Windows, the installer from nodejs.org is fine).

```
npm install
npm run dev            # local dev server, http://localhost:5173
npm test               # schedule logic tests
npm run test:schema    # runs schema.sql in an in-memory Postgres and checks the security rules
npm run build          # production build into dist/
npm run build:preview  # one self-contained demo file in dist-preview/index.html
```

Without real values in `public/config.js`, the app runs in demo-only mode, so you can work on the UI without touching Supabase.

### Where things live

| Path | What it does |
| --- | --- |
| `supabase/schema.sql` | Tables, invite codes, security rules, live updates |
| `src/lib/types.ts` | Data shapes and the `Backend` interface the screens talk to |
| `src/lib/supabaseBackend.ts` | The real backend (Supabase) |
| `src/lib/demoBackend.ts` | The in-browser demo, including the simulated second person |
| `src/lib/schedule.ts` | When routines are due, how they're described, what's overdue |
| `src/state.tsx` | Loading, live sync, and optimistic check-offs |
| `src/screens/` | Today, Pets, Activity, Household, sign-in and setup |
| `public/` | `config.js`, app icons, home screen manifest, offline service worker |

### How "nobody double-feeds the dog" works

Each routine can be checked off once per time slot per day. The database enforces that with a unique index (`task_logs_once_per_slot`), so if two people tap at the same moment, the second one gets a friendly "Alex already did this one" instead of a duplicate.

## What's next

- **Push reminders** ("Luna's dinner is 30 minutes late"). Needs a small scheduled Supabase Edge Function plus Web Push. iPhones support push for web apps added to the home screen.
- **Sitter links.** A no-account link for a dog walker or sitter that shows just the tasks for their visit.
- **App Store version** by wrapping this same code once the idea is proven.
