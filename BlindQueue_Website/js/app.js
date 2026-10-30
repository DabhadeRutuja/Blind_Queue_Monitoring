// STEP: Replace these two placeholders with your Supabase Project URL and publishable/anon key.
  // Never put a service_role/secret key in a browser file.
  const SUPABASE_URL = window.BLINDQUEUE_SUPABASE_URL || "PASTE_YOUR_SUPABASE_PROJECT_URL_HERE";
  const SUPABASE_KEY = window.BLINDQUEUE_SUPABASE_KEY || "PASTE_YOUR_SUPABASE_PUBLISHABLE_OR_ANON_KEY_HERE";
  const TABLE = "location_points";

  const $ = (id) => document.getElementById(id);
  const configured = SUPABASE_URL.startsWith("https://") && !SUPABASE_URL.includes("PASTE_") &&
                     SUPABASE_KEY.length > 20 && !SUPABASE_KEY.includes("PASTE_");
  let sb = null, currentUser = null, watchId = null, channel = null;
  let marker = null, pathLine = null, map = null, positions = [];
  let lastSentAt = 0, lastSavedPoint = null;

  if (window.L) {
    map = L.map('map').setView([18.5204, 73.8567], 12); // default view only; replace when GPS data arrives
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);
  }

  if (configured && window.supabase) {
    sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    $('authStatus').textContent = 'Supabase configuration loaded. Create an account or sign in.';
  }

  function setStatus(id, msg) { $(id).textContent = msg; }
  function updateButtons() {
    const signedIn = !!currentUser;
    $('startBtn').disabled = !signedIn || watchId !== null;
    $('stopBtn').disabled = watchId === null;
    $('refreshBtn').disabled = !signedIn;
    $('signupBtn').classList.toggle('hidden', signedIn);
    $('loginBtn').classList.toggle('hidden', signedIn);
    $('logoutBtn').classList.toggle('hidden', !signedIn);
  }
  function formatTime(v) {
    if (!v) return '—';
    return new Date(v).toLocaleString();
  }
  function haversine(a, b) {
    const R = 6371000, rad = n => n * Math.PI / 180;
    const dLat = rad(b.latitude - a.latitude), dLon = rad(b.longitude - a.longitude);
    const x = Math.sin(dLat/2)**2 + Math.cos(rad(a.latitude))*Math.cos(rad(b.latitude))*Math.sin(dLon/2)**2;
    return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1-x));
  }
  function updateMap(rows) {
    positions = rows.slice().reverse().map(r => ({ latitude: Number(r.latitude), longitude: Number(r.longitude) }))
      .filter(p => Number.isFinite(p.latitude) && Number.isFinite(p.longitude));
    if (!map || positions.length === 0) return;
    const latlngs = positions.map(p => [p.latitude, p.longitude]);
    if (pathLine) pathLine.remove();
    pathLine = L.polyline(latlngs, { color: '#1769d2', weight: 4 }).addTo(map);
    const latest = positions[positions.length - 1];
    if (marker) marker.setLatLng([latest.latitude, latest.longitude]);
    else marker = L.marker([latest.latitude, latest.longitude]).addTo(map).bindPopup('Latest recorded location');
    map.setView([latest.latitude, latest.longitude], Math.max(map.getZoom(), 15));
    const today = new Date().toDateString();
    const todays = rows.filter(r => new Date(r.recorded_at).toDateString() === today)
      .slice().reverse().map(r => ({ latitude: Number(r.latitude), longitude: Number(r.longitude) }));
    let metres = 0;
    for (let i = 1; i < todays.length; i++) {
      const d = haversine(todays[i-1], todays[i]);
      // Ignore large GPS jumps that would badly distort the rough estimate.
      if (d < 2000) metres += d;
    }
    $('distanceValue').textContent = metres >= 1000 ? (metres/1000).toFixed(2) + ' km' : Math.round(metres) + ' m';
  }
  function renderRows(rows) {
    const body = $('historyBody');
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="4">No location records yet. Start tracking on the phone.</td></tr>';
      return;
    }
    body.innerHTML = rows.slice(0, 30).map(r =>
      `<tr><td>${escapeHtml(formatTime(r.recorded_at))}</td><td>${Number(r.latitude).toFixed(6)}</td><td>${Number(r.longitude).toFixed(6)}</td><td>${Math.round(Number(r.accuracy_m) || 0)} m</td></tr>`
    ).join('');
    const latest = rows[0];
    $('latValue').textContent = Number(latest.latitude).toFixed(6);
    $('lonValue').textContent = Number(latest.longitude).toFixed(6);
    $('accuracyValue').textContent = Math.round(Number(latest.accuracy_m) || 0) + ' m';
    $('updatedValue').textContent = formatTime(latest.recorded_at);
    updateMap(rows);
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  async function loadHistory() {
    if (!sb || !currentUser) return;
    const { data, error } = await sb.from(TABLE).select('id, latitude, longitude, accuracy_m, recorded_at')
      .eq('user_id', currentUser.id).order('recorded_at', { ascending: false }).limit(500);
    if (error) { setStatus('trackingStatus', 'Could not load history: ' + error.message); return; }
    renderRows(data || []);
  }
  function subscribeRealtime() {
    if (!sb || !currentUser) return;
    if (channel) sb.removeChannel(channel);
    channel = sb.channel('location-live-' + currentUser.id)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: TABLE, filter: 'user_id=eq.' + currentUser.id },
        () => loadHistory())
      .subscribe();
  }
  async function onSignedIn(user) {
    currentUser = user;
    setStatus('authStatus', 'Signed in as ' + user.email);
    updateButtons();
    await loadHistory();
    subscribeRealtime();
  }
  $('signupBtn').onclick = async () => {
    if (!sb) return setStatus('authStatus', 'First add your Supabase URL and publishable/anon key in the HTML file.');
    const email = $('email').value.trim(), password = $('password').value;
    if (!email || password.length < 6) return setStatus('authStatus', 'Enter a valid email and a password of at least 6 characters.');
    const { data, error } = await sb.auth.signUp({ email, password });
    if (error) return setStatus('authStatus', error.message);
    if (data.session) await onSignedIn(data.user);
    else setStatus('authStatus', 'Account created. Check your email to confirm it, then sign in.');
  };
  $('loginBtn').onclick = async () => {
    if (!sb) return setStatus('authStatus', 'First add your Supabase URL and publishable/anon key in the HTML file.');
    const { data, error } = await sb.auth.signInWithPassword({ email: $('email').value.trim(), password: $('password').value });
    if (error) return setStatus('authStatus', error.message);
    await onSignedIn(data.user);
  };
  $('logoutBtn').onclick = async () => {
    stopTracking();
    if (channel) await sb.removeChannel(channel);
    await sb.auth.signOut();
    currentUser = null;
    setStatus('authStatus', 'Signed out.');
    updateButtons();
  };
  $('refreshBtn').onclick = loadHistory;

  function stopTracking() {
    if (watchId !== null && navigator.geolocation) navigator.geolocation.clearWatch(watchId);
    watchId = null;
    updateButtons();
    setStatus('trackingStatus', 'Tracking stopped.');
  }
  $('stopBtn').onclick = stopTracking;
  $('startBtn').onclick = () => {
    if (!currentUser) return;
    if (!navigator.geolocation) return setStatus('trackingStatus', 'This browser does not support geolocation.');
    if (!window.isSecureContext) return setStatus('trackingStatus', 'GPS needs HTTPS. Host this page on an HTTPS site, then reopen it on the phone.');
    lastSentAt = 0;
    setStatus('trackingStatus', 'Requesting GPS permission…');
    watchId = navigator.geolocation.watchPosition(async (pos) => {
      const now = Date.now();
      setStatus('trackingStatus', `GPS active. Accuracy: about ${Math.round(pos.coords.accuracy)} m. Location uploads at most every 10 seconds.`);
      if (now - lastSentAt < 10000) return;
      lastSentAt = now;
      const row = {
        user_id: currentUser.id,
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracy_m: pos.coords.accuracy,
        recorded_at: new Date(pos.timestamp || now).toISOString()
      };
      const { error } = await sb.from(TABLE).insert(row);
      if (error) setStatus('trackingStatus', 'GPS received, but database upload failed: ' + error.message);
    }, (err) => {
      setStatus('trackingStatus', 'GPS error: ' + err.message + '. Check phone location settings and browser permission.');
      stopTracking();
    }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
    updateButtons();
  };

  async function initAuth() {
    if (!sb) { updateButtons(); return; }
    const { data } = await sb.auth.getSession();
    if (data.session) await onSignedIn(data.session.user);
    else updateButtons();
    sb.auth.onAuthStateChange((_event, session) => {
      if (session && (!currentUser || currentUser.id !== session.user.id)) onSignedIn(session.user);
    });
  }
  initAuth();
