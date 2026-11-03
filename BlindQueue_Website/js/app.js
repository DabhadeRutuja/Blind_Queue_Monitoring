(() => {
  const $ = id => document.getElementById(id), URL = window.BLINDQUEUE_SUPABASE_URL || "", KEY = window.BLINDQUEUE_SUPABASE_KEY || "";
  const POINTS = "location_points", PLACES = "saved_places";
  const configured = URL.startsWith("https://") && !URL.includes("PASTE_") && KEY.length > 20 && !KEY.includes("PASTE_");
  const knownLandmarks = [{ id: "avcoe", name: "Amrutvahini College of Engineering (AVCOE)", latitude: 19.6142, longitude: 74.1848, radius_m: 350 }];
  let sb = null, user = null, watchId = null, channel = null, map = null, marker = null, line = null, points = [], places = [], latest = null, lastUpload = 0;
  const locationLookups = new Map(), geocodeQueue = [], queuedLocationKeys = new Set();
  let geocodeTimer = null, lastGeocodeRequest = 0, geocodeGeneration = 0;
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const status = (s, type = "") => { $("authStatus").textContent = s; $("authStatus").className = "notice " + type };
  const tracking = s => $("trackingStatus").textContent = s;
  const time = v => v ? new Date(v).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—";
  const dateTime = v => v ? new Date(v).toLocaleString() : "—";
  const today = v => new Date(v).toDateString() === new Date().toDateString();
  const duration = ms => { let m = Math.max(0, Math.round(ms / 60000)); return m < 60 ? m + " min" : Math.floor(m / 60) + " hr " + m % 60 + " min" };
  const locationKey = p => `${(Math.round(+p.latitude * 2000) / 2000).toFixed(4)},${(Math.round(+p.longitude * 2000) / 2000).toFixed(4)}`;
  const lookupFor = p => locationLookups.get(locationKey(p));
  function distance(a, b) { const r = n => n * Math.PI / 180, R = 6371000, dl = r(b.latitude - a.latitude), dn = r(b.longitude - a.longitude), x = Math.sin(dl / 2) ** 2 + Math.cos(r(a.latitude)) * Math.cos(r(b.latitude)) * Math.sin(dn / 2) ** 2; return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x)) }
  function coordinates(p) { return p.latitude !== null && p.latitude !== "" && p.longitude !== null && p.longitude !== "" && Number.isFinite(+p.latitude) && Number.isFinite(+p.longitude) && +p.latitude >= -90 && +p.latitude <= 90 && +p.longitude >= -180 && +p.longitude <= 180 }
  function nearestPlace(p) { return places.map(q => ({ place: q, metres: distance(p, { latitude: +q.latitude, longitude: +q.longitude }) })).sort((a, b) => a.metres - b.metres)[0] || null }
  function buttons() { let signed = !!user; $("loginBtn").classList.toggle("hidden", signed); $("signupBtn").classList.toggle("hidden", signed); $("logoutBtn").classList.toggle("hidden", !signed); $("startBtn").disabled = !signed || watchId !== null; $("stopBtn").disabled = watchId === null; $("refreshBtn").disabled = !signed; $("savePlaceBtn").disabled = !signed }
  function initMap() { if (!window.L || map) return; map = L.map("map").setView([19, 75], 6); L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap contributors" }).addTo(map) }
  function match(p) { if (!coordinates(p)) return null; let found = null, best = Infinity, accuracy = Number.isFinite(+p.accuracy_m) && +p.accuracy_m >= 0 ? Math.min(+p.accuracy_m, 100) : 0; for (const q of places) { let d = distance(p, { latitude: +q.latitude, longitude: +q.longitude }), radius = +(q.radius_m || 100); if (d <= radius + accuracy && d < best) { found = q; best = d } } return found }
  function knownLandmark(p) { if (!coordinates(p)) return null; const accuracy = Number.isFinite(+p.accuracy_m) && +p.accuracy_m >= 0 ? Math.min(+p.accuracy_m, 100) : 0; return knownLandmarks.find(place => distance(p, place) <= place.radius_m + accuracy) || null }
  function resolvedPlace(p) { return match(p) || knownLandmark(p) }
  function valid(list) { return list.filter(p => coordinates(p) && p.accuracy_m !== null && p.accuracy_m !== "" && Number.isFinite(+p.accuracy_m) && +p.accuracy_m >= 0 && +p.accuracy_m <= 100) }
  function visitPoints(list) { return list.filter(p => coordinates(p) && (p.accuracy_m === null || p.accuracy_m === "" || Number.isFinite(+p.accuracy_m) && +p.accuracy_m >= 0 && +p.accuracy_m <= 250)) }
  function nearbyName(result) {
    const address = result.address || {}, locality = address.suburb || address.village || address.town || address.city || address.county;
    const name = result.name || address.amenity || address.shop || address.tourism || address.leisure || address.office || address.building || address.road || address.neighbourhood || locality;
    if (name) return locality && name.toLowerCase() !== locality.toLowerCase() ? `${name}, ${locality}` : name;
    return result.display_name ? result.display_name.split(",").slice(0, 2).join(",").trim() : "";
  }
  function processGeocodeQueue() {
    if (geocodeTimer !== null || !geocodeQueue.length) return;
    const delay = Math.max(0, 1100 - (Date.now() - lastGeocodeRequest));
    geocodeTimer = setTimeout(async () => {
      geocodeTimer = null;
      const request = geocodeQueue.shift();
      if (!request) return;
      const generation = geocodeGeneration;
      lastGeocodeRequest = Date.now();
      try {
        const url = new window.URL("https://nominatim.openstreetmap.org/reverse");
        url.search = new URLSearchParams({ format: "jsonv2", addressdetails: "1", zoom: "18", lat: String(request.latitude), lon: String(request.longitude) }).toString();
        const response = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(10000) });
        if (!response.ok) throw new Error(`OpenStreetMap returned HTTP ${response.status}`);
        const result = await response.json();
        if (generation !== geocodeGeneration) return;
        const name = nearbyName(result);
        locationLookups.set(request.key, { name, error: name ? "" : "No nearby name found", requestedAt: request.requestedAt });
      } catch (error) {
        if (generation !== geocodeGeneration) return;
        locationLookups.set(request.key, { name: "", error: error.message || "Location name lookup failed", requestedAt: request.requestedAt });
      } finally {
        if (generation === geocodeGeneration) {
          queuedLocationKeys.delete(request.key);
          render();
          processGeocodeQueue();
        }
      }
    }, delay);
  }
  function requestLocationName(p, priority = false) {
    if (!user || !coordinates(p) || Number.isFinite(+p.accuracy_m) && +p.accuracy_m > 250) return;
    const key = locationKey(p), cached = locationLookups.get(key);
    if (cached && (!cached.error || Date.now() - cached.requestedAt < 300000) || queuedLocationKeys.has(key)) return;
    if (!priority && geocodeQueue.length >= 10) return;
    const requestedAt = Date.now();
    locationLookups.set(key, { name: "", error: "", requestedAt });
    queuedLocationKeys.add(key);
    const request = { key, latitude: +p.latitude, longitude: +p.longitude, requestedAt };
    if (priority) geocodeQueue.unshift(request);
    else geocodeQueue.push(request);
    processGeocodeQueue();
  }
  function clearLocationLookups() {
    geocodeGeneration++;
    if (geocodeTimer !== null) clearTimeout(geocodeTimer);
    geocodeTimer = null;
    geocodeQueue.length = 0;
    queuedLocationKeys.clear();
    locationLookups.clear();
  }
  function drawMap() { initMap(); let coords = points.slice().reverse().filter(coordinates).map(p => [+p.latitude, +p.longitude]); if (!map) return; if (!coords.length) { if (line) { line.remove(); line = null } if (marker) { marker.remove(); marker = null } return } if (line) line.remove(); line = L.polyline(coords, { color: "#5279d7", weight: 4, opacity: .8 }).addTo(map); let last = coords[coords.length - 1], current = points.find(coordinates), saved = current && match(current), landmark = current && !saved && knownLandmark(current), nearby = current && lookupFor(current), label = saved?.name || landmark?.name || nearby?.name || "Current GPS location"; if (marker) marker.setLatLng(last); else marker = L.marker(last).addTo(map); marker.bindPopup(esc(label)); map.setView(last, 15); setTimeout(() => map.invalidateSize(), 100) }
  function calcDistance() { let a = valid(points.filter(p => today(p.recorded_at))).reverse(), m = 0; for (let i = 1; i < a.length; i++) { let d = distance(a[i - 1], a[i]); if (d >= 10 && d <= 2000) m += d } return m >= 1000 ? (m / 1000).toFixed(2) + " km" : Math.round(m) + " m" }
  function visits() {
    let rows = visitPoints(points.filter(p => today(p.recorded_at))).reverse(), groups = [], active = null, unknown = null;
    for (let p of rows) {
      let q = resolvedPlace(p), key = q ? "place-" + q.id : (unknown && distance(p, unknown.point) <= 150 ? unknown.key : "unknown-" + p.id), name = q ? q.name : "Unlabeled GPS location";
      if (!q) unknown = { key, point: p }; else unknown = null;
      let gap = active && new Date(p.recorded_at) - new Date(active.last) > 1800000;
      if (!active || active.key !== key || gap) {
        active = { key, name, first: p.recorded_at, last: p.recorded_at, count: 1, latitude: +p.latitude, longitude: +p.longitude };
        groups.push(active)
      } else {
        active.last = p.recorded_at;
        active.latitude = (active.latitude * active.count + +p.latitude) / (active.count + 1);
        active.longitude = (active.longitude * active.count + +p.longitude) / (active.count + 1);
        active.count++
      }
    }
    let now = Date.now(); return groups.filter(v => v.count >= 2 && new Date(v.last) - new Date(v.first) >= 300000).map(v => ({ ...v, ongoing: groups[groups.length - 1] === v, duration: (groups[groups.length - 1] === v ? now : new Date(v.last).getTime()) - new Date(v.first).getTime() }))
  }
  function render() {
    let latestRows = points;
    if (latestRows.length && coordinates(latestRows[0])) {
      latest = latestRows[0];
      let q = match(latest), landmark = q ? null : knownLandmark(latest), nearest = nearestPlace(latest), coords = `${(+latest.latitude).toFixed(5)}, ${(+latest.longitude).toFixed(5)}`, lookup = q || landmark ? null : lookupFor(latest), inaccurate = Number.isFinite(+latest.accuracy_m) && +latest.accuracy_m > 250;
      if (!q && !landmark) requestLocationName(latest, true);
      $("currentPlaceValue").textContent = q?.name || landmark?.name || lookup?.name || (lookup?.error ? "Place name unavailable" : inaccurate ? "GPS accuracy too low" : "Finding nearby place…");
      $("currentPlaceSub").textContent = q
        ? `Saved place · ${Math.round(distance(latest, { latitude: +q.latitude, longitude: +q.longitude }))} m from center · ${coords}`
        : landmark
          ? `Campus area · ${Math.round(distance(latest, landmark))} m from AVCOE pin · ${coords}`
        : lookup?.error
          ? `Could not find a nearby name (${lookup.error}) · GPS: ${coords}`
          : inaccurate
            ? `Improve the phone's GPS signal to look up a nearby name · GPS: ${coords}`
          : `Nearby name from OpenStreetMap · GPS: ${coords}${nearest ? ` · Saved place: ${nearest.place.name} (${Math.round(nearest.metres)} m away)` : ""}`;
      const accuracy = Number(latest.accuracy_m);
      $("accuracyValue").textContent = latest.accuracy_m !== null && latest.accuracy_m !== "" && Number.isFinite(accuracy) && accuracy >= 0 ? Math.round(accuracy) + " m" : "Unknown";
      $("updatedValue").textContent = "Last update: " + time(latest.recorded_at)
    } else {
      latest = null;
      $("currentPlaceValue").textContent = "Waiting for GPS";
      $("currentPlaceSub").textContent = latestRows.length ? "Latest GPS record has invalid coordinates" : "No recent location";
      $("accuracyValue").textContent = "—";
      $("updatedValue").textContent = "Last update: —"
    }
    $("distanceValue").textContent = calcDistance();
    let v = visits();
    $("placesCountValue").textContent = v.length;
    v.filter(x => x.key.startsWith("unknown-")).slice(-10).forEach(x => requestLocationName(x));
    $("historyBody").innerHTML = points.length ? points.slice(0, 30).map(p => `<tr><td>${esc(dateTime(p.recorded_at))}</td><td>${(+p.latitude).toFixed(6)}</td><td>${(+p.longitude).toFixed(6)}</td><td>${Math.round(+p.accuracy_m || 0)} m</td></tr>`).join("") : '<tr><td colspan="4" class="emptycell">No location records yet. Start tracking on the phone.</td></tr>';
    $("visitsBody").innerHTML = v.length ? v.map(x => {
      const lookup = x.key.startsWith("unknown-") ? lookupFor(x) : null;
      const name = x.key.startsWith("unknown-") ? lookup?.name || (lookup?.error ? "Location name unavailable" : "Finding nearby place…") : x.name;
      const actions = x.key.startsWith("unknown-") ? `<small class="visitcoords">${x.latitude.toFixed(5)}, ${x.longitude.toFixed(5)}</small>${lookup?.name ? "" : `<button class="labelvisit" type="button" data-lat="${x.latitude}" data-lon="${x.longitude}">Save as place</button>`}` : "";
      return `<tr><td class="placename">${esc(name)}${actions}</td><td>${time(x.first)}</td><td>${x.ongoing ? "—" : time(x.last)}</td><td>${duration(x.duration)}</td><td class="${x.ongoing ? "visitlive" : ""}">${x.ongoing ? "Currently here" : "Completed"}</td></tr>`
    }).join("") : '<tr><td colspan="5" class="emptycell">No confirmed visits yet. Keep GPS tracking active at a place for at least 5 minutes.</td></tr>';
    document.querySelectorAll(".labelvisit").forEach(b => b.onclick = () => {
      $("placeLat").value = (+b.dataset.lat).toFixed(7);
      $("placeLon").value = (+b.dataset.lon).toFixed(7);
      $("placeName").value = "";
      $("places-section").scrollIntoView({ behavior: "smooth", block: "center" });
      $("placeName").focus();
    });
    drawMap()
  }
  async function loadPoints() { if (!sb || !user) return false; let { data, error } = await sb.from(POINTS).select("id,latitude,longitude,accuracy_m,recorded_at").eq("user_id", user.id).order("recorded_at", { ascending: false }).limit(2000); if (error) { tracking("Could not load location history: " + error.message); return false } points = data || []; render(); return true }
  function renderPlaces() { $("placesList").innerHTML = places.length ? places.map(p => `<div class="placeitem"><span class="placesymbol">⌂</span><span class="placeinfo"><b>${esc(p.name)}</b><small>${+p.radius_m || 100} m radius · ${(+p.latitude).toFixed(4)}, ${(+p.longitude).toFixed(4)}</small></span><button class="deleteplace" data-id="${esc(p.id)}" title="Delete">×</button></div>`).join("") : '<div class="empty">No saved places yet. Add Home, Hospital or another place above.</div>'; document.querySelectorAll(".deleteplace").forEach(b => b.onclick = async () => { if (!confirm("Delete this saved place?")) return; let { error } = await sb.from(PLACES).delete().eq("id", b.dataset.id).eq("user_id", user.id); if (error) alert(error.message); else loadPlaces() }) }
  async function loadPlaces() { let { data, error } = await sb.from(PLACES).select("id,name,latitude,longitude,radius_m,created_at").eq("user_id", user.id).order("created_at"); if (error) { $("placesList").textContent = "Could not load saved places: " + error.message + ". Check the saved_places table and its access policies."; return false } places = data || []; renderPlaces(); render(); return true }
  async function signedIn(u) { if (user?.id === u.id) return; clearLocationLookups(); if (watchId !== null) stop(); if (channel) { await sb.removeChannel(channel); channel = null } user = u; points = []; places = []; latest = null; renderPlaces(); render(); $("accountLabel").textContent = u.email || "Signed in"; $("accountSub").textContent = "Connected account"; $("auth-section").classList.add("hidden"); buttons(); await loadPlaces(); if (await loadPoints()) tracking(points.length ? "Location history loaded. Connecting to live updates." : "No GPS records yet. Waiting for phone GPS and connecting to live updates."); channel = sb.channel("blindqueue-" + u.id).on("postgres_changes", { event: "INSERT", schema: "public", table: POINTS, filter: "user_id=eq." + u.id }, () => { void loadPoints() }).subscribe((state, error) => { if (state === "SUBSCRIBED") tracking(points.length ? "Live updates connected. Location history loaded." : "Live updates connected. Waiting for phone GPS."); else if (state === "CHANNEL_ERROR" || state === "TIMED_OUT") tracking("Live updates could not connect. Check your internet connection and that location_points is enabled in the Supabase supabase_realtime publication." + (error?.message ? " " + error.message : "")) }); status("Signed in successfully.", "success") }
  $("signupBtn").onclick = async () => { if (!sb) return status("Set Supabase URL and key in js/config.js.", "error"); let email = $("email").value.trim(), password = $("password").value; if (!email || password.length < 6) return status("Enter email and a password of at least 6 characters.", "error"); let { data, error } = await sb.auth.signUp({ email, password }); if (error) return status(error.message, "error"); if (data.session) await signedIn(data.user); else status("Account created. Confirm your email, then sign in.", "success") };
  $("loginBtn").onclick = async () => { if (!sb) return status("Set Supabase URL and key in js/config.js.", "error"); let { data, error } = await sb.auth.signInWithPassword({ email: $("email").value.trim(), password: $("password").value }); if (error) return status(error.message, "error"); await signedIn(data.user) };
  $("logoutBtn").onclick = async () => { stop(); if (channel) { await sb.removeChannel(channel); channel = null } let { error } = await sb.auth.signOut(); if (error) return status("Sign out failed: " + error.message, "error"); clearLocationLookups(); user = null; points = []; places = []; latest = null; renderPlaces(); render(); $("auth-section").classList.remove("hidden"); $("accountLabel").textContent = "Not signed in"; $("accountSub").textContent = "Connect your account"; buttons(); status("Signed out.") };
  $("refreshBtn").onclick = async () => { await loadPlaces(); await loadPoints() };
  $("useCurrentBtn").onclick = () => { if (!latest) return alert("No GPS location yet. Start tracking on the phone first."); $("placeLat").value = (+latest.latitude).toFixed(7); $("placeLon").value = (+latest.longitude).toFixed(7) };
  $("placeForm").onsubmit = async e => { e.preventDefault(); let name = $("placeName").value.trim(), latitude = +$("placeLat").value, longitude = +$("placeLon").value, radius_m = +$("placeRadius").value; if (!name || !Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180 || radius_m < 30 || radius_m > 1000) return alert("Check place name, coordinates and radius (30–1000 m)."); let { error } = await sb.from(PLACES).insert({ user_id: user.id, name, latitude, longitude, radius_m }); if (error) return alert("Could not save place: " + error.message); $("placeForm").reset(); $("placeRadius").value = 100; await loadPlaces() };
  function stop() { if (watchId !== null && navigator.geolocation) navigator.geolocation.clearWatch(watchId); watchId = null; buttons(); $("trackingPill").textContent = "● Not tracking"; $("trackingPill").classList.remove("active"); tracking("Tracking stopped.") }
  $("stopBtn").onclick = stop;
  $("startBtn").onclick = () => { if (!navigator.geolocation) return tracking("This browser does not support GPS."); if (!window.isSecureContext) return tracking("GPS requires HTTPS. Open the Vercel HTTPS address."); tracking("Requesting GPS permission…"); watchId = navigator.geolocation.watchPosition(async pos => { let now = Date.now(); $("trackingPill").textContent = "● Tracking active"; $("trackingPill").classList.add("active"); tracking("GPS active · Accuracy about " + Math.round(pos.coords.accuracy) + " m · Saving phone GPS updates."); latest = { latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy_m: pos.coords.accuracy }; $("placeLat").value = pos.coords.latitude.toFixed(7); $("placeLon").value = pos.coords.longitude.toFixed(7); if (now - lastUpload < 10000) return; lastUpload = now; let { error } = await sb.from(POINTS).insert({ user_id: user.id, latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy_m: pos.coords.accuracy, recorded_at: new Date(pos.timestamp || now).toISOString() }); if (error) tracking("GPS received but upload failed: " + error.message); else await loadPoints() }, err => { tracking("GPS error: " + err.message + ". Check phone location permission."); stop() }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 }); buttons() };
  $("todayLabel").textContent = new Date().toLocaleDateString([], { weekday: "short", day: "numeric", month: "short", year: "numeric" }); $("visitDateLabel").textContent = new Date().toLocaleDateString([], { day: "numeric", month: "short" }); initMap();
  if (configured && window.supabase) { sb = window.supabase.createClient(URL, KEY); sb.auth.getSession().then(({ data }) => data.session ? signedIn(data.session.user) : buttons()); sb.auth.onAuthStateChange((_e, s) => { if (s && (!user || user.id !== s.user.id)) signedIn(s.user) }); status("Supabase client loaded. Sign in to continue.", "success") } else { status(configured ? "Could not load the Supabase client. Check your internet connection and refresh." : "Add Supabase URL and publishable/anon key in js/config.js before signing in.", "error"); buttons() }
})();