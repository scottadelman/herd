// Builds supabase/schema.sql (the one file a NEW project runs) from the
// numbered files in supabase/migrations, so the two can never drift apart.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';

const dir = new URL('../supabase/migrations/', import.meta.url);
const files = readdirSync(dir).filter((f) => /^\d+_.*\.sql$/.test(f)).sort();
const header = `-- Herd: full database setup for a NEW Supabase project.
-- Paste this whole file into Supabase > SQL Editor and click Run, once.
--
-- Already running Herd? Don't run this file. Run only the newest file in
-- supabase/migrations that you haven't run yet.
--
-- Generated from supabase/migrations by "npm run build:schema". Edit those files, not this one.
`;
const body = files
  .map((f) => `\n-- ===========================================================================\n-- ${f}\n-- ===========================================================================\n\n${readFileSync(new URL(f, dir), 'utf8').trim()}\n`)
  .join('');
writeFileSync(new URL('../supabase/schema.sql', import.meta.url), header + body);
console.log(`schema.sql built from ${files.join(', ')}`);
