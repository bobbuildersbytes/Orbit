const availableBtn = document.getElementById("available-btn");
const busyBtn = document.getElementById("busy-btn");
const simulateToggle = document.getElementById("simulate-toggle");
const simulateInputs = document.getElementById("simulate-inputs");
const simLat = document.getElementById("sim-lat");
const simLon = document.getElementById("sim-lon");
const pushSimBtn = document.getElementById("push-sim-location");
const usersList = document.getElementById("users-list");

let pollTimer = null;
let isAvailable = false;
let isBusy = false;
let geoWatchId = null;

// Orbit: Use window.orbitUser injected from EJS
const currentUser = window.orbitUser;

async function bootstrap() {
  await amplitudeClient.initFromServer();

  if (currentUser) {
    // Initialize Auth UI with injected user
    authUI.setUser(currentUser);

    // Initial fetch of presence
    await fetchMe();

    wireEvents();
    requestGeolocationPermission();

    // Initial State: Sidebar is open, so hide the floating toggle
    const desktopSidebarToggle = document.getElementById(
      "desktop-sidebar-toggle",
    );
    if (desktopSidebarToggle && window.innerWidth > 768) {
      desktopSidebarToggle.classList.add("hidden");
    }

    startPolling();
    // suggestionsUI.fetchSuggestions(); // Uncomment when suggestions API is ready
  }
}

async function fetchMe() {
  try {
    const res = await fetch("/api/me");
    if (!res.ok) return;
    const data = await res.json();
    // authUI.setUser(data.user); // No need to reset user, we have it
    if (data.presence) {
      isAvailable = data.presence.available;
      isBusy = !!data.presence.isBusy;
      syncAvailabilityUI(isAvailable);
      syncBusyUI();
    }
  } catch (err) {
    console.error(err);
  }
}

function wireEvents() {
  if (availableBtn) {
    availableBtn.addEventListener("click", async () => {
      await updatePresence(!isAvailable, isBusy);
    });
  }

  if (busyBtn) {
    busyBtn.addEventListener("click", async () => {
      await updatePresence(isAvailable, !isBusy);
    });
  }

  if (simulateToggle) {
    simulateToggle.addEventListener("change", (e) => {
      simulateInputs.classList.toggle("hidden", !e.target.checked);
      if (e.target.checked) {
        stopLocationWatch();
      } else {
        startLocationWatch();
      }
    });
  }

  if (pushSimBtn) {
    pushSimBtn.addEventListener("click", sendLocation);
  }

  const sidebar = document.getElementById("sidebar");
  const desktopSidebarToggle = document.getElementById(
    "desktop-sidebar-toggle",
  );
  const sidebarCloseBtn = document.getElementById("sidebar-close-btn");
  const bottomNavItems = document.querySelectorAll(".nav-item");

  function toggleSidebar(show) {
    if (show) {
      sidebar.classList.remove("collapsed");
      desktopSidebarToggle.classList.add("hidden");
    } else {
      sidebar.classList.add("collapsed");
      desktopSidebarToggle.classList.remove("hidden");
    }
    setTimeout(() => {
      if (mapUI && mapUI.map) {
        mapUI.map.invalidateSize();
      }
    }, 300);
  }

  // Sidebar Open (Desktop)
  desktopSidebarToggle?.addEventListener("click", () => {
    toggleSidebar(true);
  });

  // Sidebar Close (Desktop)
  sidebarCloseBtn?.addEventListener("click", () => {
    toggleSidebar(false);
  });

  // Desktop Sidebar Navigation
  const desktopNavIcons = document.querySelectorAll(".nav-icon");
  const sidebarTitle = document.getElementById("sidebar-title");
  const activitiesPanel = document.getElementById("activities-panel");
  const profilePanel = document.getElementById("profile-panel");

  desktopNavIcons.forEach((btn) => {
    btn.addEventListener("click", () => {
      // 1. Update Active State
      desktopNavIcons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");

      // 2. Open sidebar if collapsed
      if (sidebar.classList.contains("collapsed")) {
        toggleSidebar(true);
      }

      // 3. Switch Content
      const targetId = btn.dataset.target;
      if (targetId === "activities-panel") {
        activitiesPanel.classList.remove("hidden");
        profilePanel.classList.add("hidden");
        if (sidebarTitle) sidebarTitle.textContent = "Activities";
      } else if (targetId === "profile-panel") {
        profilePanel.classList.remove("hidden");
        activitiesPanel.classList.add("hidden");
        if (sidebarTitle) sidebarTitle.textContent = "Profile & Settings";
      }
    });
  });

  // Mobile Navigation
  bottomNavItems.forEach((btn) => {
    btn.addEventListener("click", () => {
      const isActive = btn.classList.contains("active");

      // Always reset active state first
      bottomNavItems.forEach((b) => b.classList.remove("active"));

      // If clicking already active tab -> Close (Toggle off)
      if (isActive) {
        sidebar.classList.remove("mobile-open");
        sidebar.classList.remove("show-activities");
        sidebar.classList.remove("show-profile");
        return;
      }

      // Otherwise -> Open and set Active
      btn.classList.add("active");
      const target = btn.dataset.target;

      if (target === "activities-panel") {
        sidebar.classList.add("mobile-open");
        sidebar.classList.add("show-activities");
        sidebar.classList.remove("show-profile");
      } else if (target === "profile-panel") {
        sidebar.classList.add("mobile-open");
        sidebar.classList.add("show-profile");
        sidebar.classList.remove("show-activities");
      }
    });
  });

  suggestionsUI.setHandlers({
    onPage: (toUserId) => pageUser(toUserId),
    onAvailability: (available) => updatePresence(available, isBusy),
  });

  startLocationWatch();
}

let lastLat = null;
let lastLon = null;

function startLocationWatch() {
  if (!navigator.geolocation) return;
  stopLocationWatch();
  geoWatchId = navigator.geolocation.watchPosition(
    (pos) => {
      const { latitude, longitude } = pos.coords;
      lastLat = latitude;
      lastLon = longitude;
      // console.log("WatchPosition tick:", { latitude, longitude, isAvailable, isBusy });
      mapUI.updateMyMarker(latitude, longitude, isAvailable, isBusy);
      if (isAvailable && (!simulateToggle || !simulateToggle.checked)) {
        pushLocation(latitude, longitude, pos.coords.accuracy);
      }
    },
    (err) => console.log("Location watch error", err),
    { enableHighAccuracy: true, maximumAge: 0, timeout: 5000 },
  );
}

function stopLocationWatch() {
  if (geoWatchId !== null && navigator.geolocation) {
    navigator.geolocation.clearWatch(geoWatchId);
    geoWatchId = null;
  }
}

function requestGeolocationPermission() {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    () => {},
    () => {},
    { enableHighAccuracy: true, timeout: 3000 },
  );
}

async function updatePresence(available, busy) {
  if (!currentUser) {
    alert("Login first");
    return;
  }
  console.log("updatePresence called with:", { available, busy });
  const res = await fetch("/api/availability", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ available, isBusy: busy }),
  });
  if (!res.ok) {
    const err = await res.json();
    alert(err.error || "Failed to update availability");
    // Revert toggle if failed?
    return;
  }
  const data = await res.json();
  console.log("updatePresence response:", data);
  // Success
  isAvailable = available;
  isBusy = busy;
  console.log("State updated to:", { isAvailable, isBusy });
  syncBusyUI();
  syncAvailabilityUI(isAvailable);

  amplitudeClient.track("presence_updated", { available, isBusy });

  if (lastLat && lastLon) {
    console.log("Updating marker immediately:", {
      lastLat,
      lastLon,
      isAvailable,
      isBusy,
    });
    mapUI.updateMyMarker(lastLat, lastLon, isAvailable, isBusy);
  }

  if (available) {
    sendLocation();
    if (!simulateToggle || !simulateToggle.checked) startLocationWatch();
  } else {
    stopLocationWatch();
  }
}

function syncAvailabilityUI(available) {
  if (!availableBtn) return;
  if (available) {
    availableBtn.textContent = "Location: Shared";
    availableBtn.classList.remove("hidden-state");
    availableBtn.classList.add("shared-state");
    // Show Busy Button
    if (busyBtn) busyBtn.classList.remove("hidden");
  } else {
    availableBtn.textContent = "Location: Hidden";
    availableBtn.classList.remove("shared-state");
    availableBtn.classList.add("hidden-state");
    // Hide and Reset Busy Button (local only? server persists it, but doesn't matter if hidden)
    if (busyBtn) busyBtn.classList.add("hidden");
  }
}

async function sendLocation() {
  if (!isAvailable) {
    // If we just want to update the local marker, we can do it here, but watchPosition handles it.
    // Explicit sendLocation is for the SERVER.
    if (simulateToggle && !simulateToggle.checked) {
      alert("Set availability on first");
      return;
    }
  }
  if (simulateToggle && simulateToggle.checked) {
    const lat = parseFloat(simLat.value);
    const lon = parseFloat(simLon.value);
    if (Number.isNaN(lat) || Number.isNaN(lon)) return alert("Enter lat/lon");
    await pushLocation(lat, lon, 5);
    // Also update local marker for simulation
    lastLat = lat;
    lastLon = lon;
    mapUI.updateMyMarker(lat, lon, isAvailable, isBusy);
    return;
  }
  if (!navigator.geolocation) {
    alert("Geolocation not supported; use simulate.");
    return;
  }

  // Use cached location if available to avoid timeout
  if (lastLat && lastLon) {
    await pushLocation(lastLat, lastLon, 0);
    mapUI.updateMyMarker(lastLat, lastLon, isAvailable, isBusy);
    return;
  }

  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const { latitude, longitude, accuracy } = pos.coords;
      lastLat = latitude;
      lastLon = longitude;
      await pushLocation(latitude, longitude, accuracy);
      // await pushLocation(latitude, longitude, accuracy); // Duplicate call removed
      mapUI.updateMyMarker(latitude, longitude, isAvailable, isBusy);
    },
    (err) => alert(err.message),
    { enableHighAccuracy: true, timeout: 20000 },
  );
}

async function pushLocation(lat, lon, accuracy) {
  const res = await fetch("/api/location", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lat, lon, accuracy }),
  });
  if (!res.ok) {
    const err = await res.json();
    // alert(err.error || "Failed to update location"); // Silent fail preferred often
    console.error("Failed to update location");
    return;
  }
  amplitudeClient.track("location_sent", { lat, lon });
}

function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  const poll = () => {
    loadPresence();
    // suggestionsUI.fetchSuggestions();
  };
  poll();
  pollTimer = setInterval(poll, 5000);
}

async function loadPresence() {
  if (!currentUser) return;
  const res = await fetch("/api/presence");
  if (!res.ok) return;
  const data = await res.json();

  const presences = data.presences || [];
  renderUsers(presences);

  // Filter self from map markers (we have a custom dot now)
  const others = presences.filter(
    (u) => u.userId !== (currentUser._id || currentUser.id),
  );
  mapUI.updateMarkers(others);

  amplitudeClient.track("presence_polled");
}

function renderUsers(users) {
  // Filter out self
  const filtered = users.filter(
    (u) => !currentUser || u.userId !== (currentUser._id || currentUser.id),
  );

  if (!usersList) return;

  if (!filtered.length) {
    usersList.innerHTML = '<div class="muted">No one else is available.</div>';
    return;
  }
  usersList.innerHTML = "";
  filtered.forEach((u) => {
    const card = document.createElement("div");
    card.className = "user-card";
    card.innerHTML = `
      <div><strong>${u.name || u.email}</strong></div>
      <div class="muted">${u.email}</div>
      <div class="actions">
        <button class="small" data-action="center">Center</button>
        ${
          u.isBusy
            ? '<button class="small secondary" disabled title="User is busy">Busy</button>'
            : '<button class="small secondary" data-action="page">Page</button>'
        }
      </div>
    `;
    const [centerBtn, pageBtn] = card.querySelectorAll("button");
    centerBtn.addEventListener("click", () => {
      if (u.lat && u.lon) mapUI.centerOn(u.lat, u.lon);
    });
    if (pageBtn) {
      pageBtn.addEventListener("click", () => pageUser(u.userId));
    }
    usersList.appendChild(card);
  });
}

async function pageUser(toUserId) {
  const message = prompt("Optional message?") || undefined;
  // This originally went to /api/page, we can keep it
  const res = await fetch("/pager", {
    // Reusing Orbit's existing endpoint or creating new
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ friendId: toUserId, message }),
  });
  if (!res.ok) {
    // Fallback to original Orbit logic or error
    alert("Failed to send page");
    return;
  }
  // Orbit's /pager redirects, so fetch might follow it.
  // Ideally we change /pager to return JSON.
  alert("Page sent!");
  amplitudeClient.track("page_clicked", { toUserId });
}

function syncBusyUI() {
  if (!busyBtn) return;

  if (isAvailable) {
    busyBtn.classList.remove("hidden");
  } else {
    busyBtn.classList.add("hidden");
  }

  if (isBusy) {
    busyBtn.textContent = "Status: Busy (DND)";
    busyBtn.classList.remove("hidden-state");
    busyBtn.classList.remove("shared-state");
    busyBtn.classList.add("busy-state");
  } else {
    busyBtn.textContent = "Status: Available";
    busyBtn.classList.remove("busy-state");
    busyBtn.classList.remove("hidden-state");
    busyBtn.classList.add("shared-state");
  }
}

bootstrap();
