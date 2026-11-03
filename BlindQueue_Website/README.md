BLINDQUEUE DASHBOARD SETUP

1. Keep the folders and filenames as supplied:
   index.html
   css/style.css
   js/config.js
   js/app.js
   supabase_setup.sql

2. Open js/config.js. Replace the two placeholders with your Supabase Project URL and publishable/anon key from Project Settings > API. NEVER use the service_role key in browser code.

3. Your existing location_points table is retained. It must have:
   id, user_id, latitude, longitude, accuracy_m, recorded_at
   Make sure RLS allows authenticated users to insert/select only rows where auth.uid() = user_id.

4. Run supabase_setup.sql in Supabase > SQL Editor. This creates saved_places and user-specific RLS policies.

5. The SQL setup script adds location_points to the supabase_realtime publication. If the script reports that the publication is missing, enable it in Supabase > Database > Publications, then rerun the script.

6. Replace the existing files in the GitHub repository connected to Vercel, preserving css and js folders, then redeploy.

7. Sign in on laptop and Android phone with the same account. On the phone press Start GPS tracking and allow location permission. Keep the page open and active.

8. To register Home/Hospital/XYZ: stand at the place, enter its name, press Use current GPS, then Save place. The radius defaults to 100 metres and can be changed. “Unlabeled GPS location” means the phone's GPS fix is available but is not inside a saved place radius; the dashboard shows coordinates and the nearest saved place so you can label it.

Sustained unlabeled stops now appear in Today's visits with their average coordinates. Select Save as place, enter a recognizable name, and save it; the dashboard will then match recorded visits to that name. GPS by itself cannot infer a place's real-world name.
   The dashboard also looks up a nearby OpenStreetMap name automatically for the current location and the latest 10 unlabeled visits. It refreshes the current lookup as the phone moves about 50 metres and prioritizes the newest position ahead of older visit lookups. This sends those GPS coordinates to the public Nominatim service, caches results in the active page, and limits requests to less than one per second. Names depend on map coverage and can be approximate; see the linked Nominatim policy in the dashboard.

LIMITATIONS
- Browser watchPosition is not guaranteed to continue when the screen locks, browser closes, or Android suspends the page. Reliable all-day background tracking needs a native Android app with background location permission.
- GPS can be inaccurate indoors. This prototype detects broad locations by radius, not hospital rooms or exact counters.
- Visit durations and distance are estimates; GPS drift and gaps affect them.
- Track only with informed consent and keep dashboard access limited.
