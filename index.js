// Global variables
let map;
let userLat, userLng;
let allStations = [];
const TOMTOM_KEY = 'e1oZN4NMffflj3dTrbYSsRSBTwN60FiY';

// ─── 1. GET USER LOCATION ───────────────────────────────
function startLocate() {
  const btn = document.getElementById('locate-btn');
  btn.disabled = true;
  btn.textContent = 'Detecting...';
  setStatus('Accessing your GPS...');

  if (!navigator.geolocation) {
    setStatus('Geolocation not supported.');
    btn.disabled = false;
    return;
  }

  navigator.geolocation.getCurrentPosition(onSuccess, onError, {
    enableHighAccuracy: true,
    timeout: 10000
  });
}

function onSuccess(position) {
  userLat = position.coords.latitude;
  userLng = position.coords.longitude;
  document.getElementById('locate-title').textContent = 'Location found!';
  setStatus('Coordinates: ' + userLat.toFixed(4) + ', ' + userLng.toFixed(4));
  
  const btn = document.getElementById('locate-btn');
  btn.disabled = false;
  btn.textContent = 'Refresh Search';

  initMap(userLat, userLng);
  fetchStations(userLat, userLng);
}

function onError(err) {
  let msg = 'Could not get location.';
  if (err.code === 1) msg = 'Permission denied. Please allow location access.';
  if (err.code === 3) msg = 'Timed out. Please try again.';
  setStatus('Location error. Please enable GPS and refresh.');
  document.getElementById('locate-btn').disabled = false;
}

// ─── 2. INITIALISE THE MAP ──────────────────────────────
function initMap(lat, lng) {
  document.getElementById('map').style.display = 'block';
  if (map) {
    map.setView([lat, lng], 14);
    return;
  }
  map = L.map('map').setView([lat, lng], 14);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap',
    maxZoom: 17
  }).addTo(map);

  const youIcon = L.divIcon({
    html: '<div class="user-dot"></div>',
    iconSize: [14, 14],
    iconAnchor: [7, 7],
    className: ''
  });
  L.marker([lat, lng], { icon: youIcon }).addTo(map).bindPopup('You are here').openPopup();
}

// ─── 3. FETCH STATIONS & TRAFFIC ────────────────────────
async function fetchStations(lat, lng) {
  setStatus('Locating nearby pumps...');
  
  const query = `[out:json];node["amenity"="fuel"](around:5000,${lat},${lng});out body;`;
  
  try {
    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: query
    });
    const data = await response.json();

    if (data.elements.length === 0) {
      setStatus('No pumps found within 5km.');
      return;
    }

    // Map basic data
    let stations = data.elements.map(node => ({
      name: node.tags.name || node.tags.brand || 'Petrol Pump' || 'Petrol Bunk',
      addr: node.tags['addr:street'] || 'Hyderabad',
      dist: getDistance(lat, lng, node.lat, node.lon),
      lat: node.lat,
      lng: node.lon,
      trafficIndex: 0, // Default: No traffic
      isBusy: false
    }));

    setStatus('Checking real-time traffic/availability...');

    // Fetch traffic for the top 8 closest stations to avoid API spam
    stations = stations.sort((a, b) => a.dist - b.dist).slice(0, 8);

    const trafficPromises = stations.map(s => fetchTrafficStatus(s));
    allStations = await Promise.all(trafficPromises);

    // SORT: Prioritize Busy (Likely Available) pumps first
    allStations.sort((a, b) => {
      if (a.isBusy === b.isBusy) return a.dist - b.dist;
      return a.isBusy ? -1 : 1;
    });

    setStatus(allStations.length + ' pumps analyzed.');
    document.getElementById('count-badge').textContent = 'Live Traffic Sync';
    document.getElementById('filter-row').style.display = 'flex';

    addMapPins(allStations);
    renderCards(allStations);

  } catch (err) {
    setStatus('Error fetching data. Check connection.');
    console.error(err);
  }
}

async function fetchTrafficStatus(station) {
      // TomTom Traffic Flow API
     const url = `https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/10/json?key=${TOMTOM_KEY}&point=${station.lat},${station.lng}`;
  
     try {
      const resp = await fetch(url);
      const data = await resp.json();
    
      if (data.flowSegmentData) {
        const current = data.flowSegmentData.currentSpeed;
        const free = data.flowSegmentData.freeFlowSpeed;
      
        // If speed is less than 40% of free flow, traffic is heavy (likely a queue)
        station.isBusy = (current < (free));
        station.trafficIndex = Math.round((1 - (current / free)) * 100);
      }
    } catch (e) {
    console.warn("Traffic check failed for", station.name);
   }
    return station;
  }


// ─── 4. UI RENDERING ────────────────────────────────────
function renderCards(stations) {
  const area = document.getElementById('results');
  area.innerHTML = '';

  stations.forEach((s, i) => {
    const statusClass = s.isBusy ? 'status-available' : 'status-unknown';
    const statusText = s.isBusy ? ' High Traffic: fuel Likely Available ' : 'No Traffic: Mostly Fuel Empty';

    area.innerHTML += `
      <div class="station-card ${s.isBusy ? 'priority' : ''}" onclick="flyTo(${s.lat}, ${s.lng})">
        <div class="rank ${s.isBusy ? 'first' : ''}">${i + 1}</div>
        <div class="info">
          <div class="sname">${s.name}</div>
          <div class="saddr">${s.addr}</div>
          <div class="status-indicator ${statusClass}">${statusText}</div>
        </div>
        <div class="sdist">
          <div class="dist-num">${s.dist}</div>
          <div class="dist-unit">km away</div>
          <button class="nav-btn" onclick="event.stopPropagation(); navigate(${s.lat}, ${s.lng})">
            Navigate
          </button>
        </div>
      </div>`;
  });
}

function addMapPins(stations) {
  stations.forEach(s => {
    const color = s.isBusy ? '#22c55e' : '#ef4444'; // Green for busy (available), red for unknown
    const pinIcon = L.divIcon({
      html: `<div style="width:12px;height:12px;background:${color};border:2px solid #fff;border-radius:50%;box-shadow:0 0 10px ${color}"></div>`,
      iconSize: [12, 12],
      className: ''
    });
    L.marker([s.lat, s.lng], { icon: pinIcon }).addTo(map)
      .bindPopup(`<b>${s.name}</b><br>${s.isBusy ? 'Queue detected (Likely Fuel)' : 'No queue detected'}`);
  });
}
function applyFilter(type, el) {
  // Update active chip
  document.querySelectorAll('.chip').forEach(function(c) {
    c.classList.remove('active');
  });
  el.classList.add('active');

  let filtered = allStations;
  if (type === 'open')  filtered = allStations.filter(function(s) { return s.open === true; });
  if (type === 'brand') filtered = allStations.filter(function(s) { return s.brand !== ''; });

  renderCards(filtered);
}


// ... existing variables (map, userLat, userLng, TOMTOM_KEY)

// ─── NEW: SEARCH BY PLACE / PINCODE ─────────────────────
async function searchByPlace() {
  const query = document.getElementById('search-input').value;
  if (!query) return alert("Please enter a landmark or pincode.");

  setStatus(`Searching for "${query}"...`);
  
  // Nominatim API - Free Geocoding
  // We append "Hyderabad" to the query to ensure local results
  const geoUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query + " Hyderabad")}&limit=1`;

  try {
    const resp = await fetch(geoUrl);
    const results = await resp.json();

    if (results.length > 0) {
      const { lat, lon, display_name } = results[0];
      
      // Update "User Location" to the searched location
      userLat = parseFloat(lat);
      userLng = parseFloat(lon);

      document.getElementById('locate-title').textContent = 'Viewing: ' + query;
      setStatus('Area found: ' + display_name.split(',')[0]);

      initMap(userLat, userLng);
      fetchStations(userLat, userLng);
    } else {
      setStatus("Location not found. Try a different landmark.");
    }
  } catch (err) {
    console.error(err);
    setStatus("Search failed. Check your connection.");
  }
}

// ─── UPDATED: FETCH STATIONS ────────────────────────────
async function fetchStations(lat, lng) {
  // Clear previous state
  document.getElementById('no-results-suggestion').style.display = 'none';
  setStatus('Locating nearby pumps...');
  
  const query = `[out:json];node["amenity"="fuel"](around:5000,${lat},${lng});out body;`;
  
  try {
    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: query
    });
    const data = await response.json();

    if (data.elements.length === 0) {
      setStatus('No pumps found in this 5km radius.');
      document.getElementById('results').innerHTML = '';
      document.getElementById('no-results-suggestion').style.display = 'block';
      return;
    }

    // ... (Existing traffic fetch logic remains the same)
    let stations = data.elements.map(node => ({
      name: node.tags.name || node.tags.brand || 'Petrol Pump',
      addr: node.tags['addr:street'] || 'Hyderabad',
      dist: getDistance(lat, lng, node.lat, node.lon),
      lat: node.lat,
      lng: node.lon,
      trafficIndex: 0,
      isBusy: false
    }));

    setStatus('Analyzing traffic for fuel availability...');
    stations = stations.sort((a, b) => a.dist - b.dist).slice(0, 10);
    const trafficPromises = stations.map(s => fetchTrafficStatus(s));
    allStations = await Promise.all(trafficPromises);

    // If no pumps are "Busy", show the fallback suggestion anyway
    const hasAnyBusy = allStations.some(s => s.isBusy);
    if (!hasAnyBusy) {
        document.getElementById('no-results-suggestion').style.display = 'block';
    }

    allStations.sort((a, b) => (a.isBusy === b.isBusy) ? a.dist - b.dist : (a.isBusy ? -1 : 1));

    renderCards(allStations);
    addMapPins(allStations);
    setStatus(`Showing ${allStations.length} pumps near ${lat.toFixed(3)}, ${lng.toFixed(3)}`);

  } catch (err) {
    setStatus('Error fetching data.');
  }
}

// ─── 5. HELPERS ─────────────────────────────────────────
function applyFilter(type, el) {
  document.querySelectorAll('.chip').forEach(function(c) {
    c.classList.remove('active');
  });
  el.classList.add('active');

  let filtered = allStations;
  if (type === 'open') filtered = allStations.filter(s => s.isBusy);
  if (type === 'open')  filtered = allStations.filter(function(s) { return s.open === true; });
  if (type === 'brand') filtered = allStations.filter(function(s) { return s.brand !== ''; });

  renderCards(filtered);
}

function flyTo(lat, lng) {
  map.flyTo([lat, lng], 16);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function navigate(lat, lng) {
  window.open(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`, '_blank');
}

function setStatus(msg) {
  document.getElementById('status-txt').textContent = msg;
}

function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return +(6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))).toFixed(1);
}