# BlindQueue Website (VS Code starter)

## Folder structure

```text
BlindQueue_Website/
├── index.html       # Page structure
├── css/
│   └── style.css    # Styling
├── js/
│   ├── config.js    # Supabase URL + public/publishable key
│   └── app.js       # Login, GPS, map, history, realtime logic
└── README.md
```

## Run in VS Code

1. Extract this folder from the ZIP.
2. Open VS Code -> File -> Open Folder -> select `BlindQueue_Website`.
3. Open `js/config.js` and paste your Supabase Project URL and publishable key (or legacy anon key). Do **not** use a `service_role`/secret key.
4. Install the VS Code **Live Server** extension if needed. Right-click `index.html` -> **Open with Live Server**. `http://127.0.0.1` / `localhost` is a secure context for browser GPS.
5. Create/sign in to the same account on the phone and laptop. For phone GPS, the website must be served on HTTPS; localhost on your laptop does not make the phone's page secure. Deploy/host it on an HTTPS static host before opening it on the phone.

## Supabase setup

Create the `public.location_points` table and RLS policies in Supabase SQL Editor:

```sql
create table public.location_points (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  latitude double precision not null,
  longitude double precision not null,
  accuracy_m double precision,
  recorded_at timestamptz not null default now()
);

alter table public.location_points enable row level security;

grant select, insert on public.location_points to authenticated;

create policy "Users can read their own locations"
on public.location_points for select to authenticated
using (auth.uid() = user_id);

create policy "Users can insert their own locations"
on public.location_points for insert to authenticated
with check (auth.uid() = user_id);
```

Enable `location_points` in Supabase Realtime / `supabase_realtime` publication if live updates do not arrive. If policies already exist, do not create duplicates.

## Important limitations

- This is a starter location dashboard, not the complete ESP32/queue-monitoring application yet.
- Browser GPS runs only while the page is open/active and permission is granted; it is not reliable background tracking with the screen off.
- Only track a person's location with their explicit consent.
- Do not commit `js/config.js` with private keys. The publishable/anon key is designed for browser use only when RLS policies are correct.
