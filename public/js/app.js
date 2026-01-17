const availableBtn = document.getElementById("available-btn");
const busyBtn = document.getElementById("busy-btn");
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
    // Map invalidation is now handled by ResizeObserver in bootstrap()
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
  const logoutBtn = document.getElementById("logout-btn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", () => {
      window.location.href = "/logout";
    });
  }
  const logoutBtnMobile = document.getElementById("logout-btn-mobile");
  if (logoutBtnMobile) {
    logoutBtnMobile.addEventListener("click", () => {
      window.location.href = "/logout";
    });
  }
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

  // ResizeObserver for smooth map transitions
  const mapContainer = document.getElementById("map");
  if (mapContainer) {
    const resizeObserver = new ResizeObserver(() => {
      if (mapUI && mapUI.map) {
        mapUI.map.invalidateSize();
      }
    });
    resizeObserver.observe(mapContainer);
  }
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
      if (isAvailable) {
        pushLocation(latitude, longitude, pos.coords.accuracy);
      }
    },
    (err) => {
      console.error("Location watch error:", err.message, err.code);
      if (err.code === 1) {
        console.warn(
          "Location permission denied. Enable location access in browser settings.",
        );
      } else if (err.code === 2) {
        console.warn("Location unavailable. Check device location settings.");
      } else if (err.code === 3) {
        console.warn("Location request timeout. Try again.");
      }
    },
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
    startLocationWatch();
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
    if (busyBtn) {
      busyBtn.classList.remove("hidden");
      busyBtn.disabled = false;
    }
  } else {
    availableBtn.textContent = "Location: Hidden";
    availableBtn.classList.remove("shared-state");
    availableBtn.classList.add("hidden-state");
    // Disable and Reset Busy Button
    if (busyBtn) {
      busyBtn.classList.remove("hidden");
      busyBtn.disabled = true;
    }
  }
}

async function sendLocation() {
  if (!isAvailable) {
    alert("Set availability on first");
    return;
  }
  if (!navigator.geolocation) {
    alert("Geolocation not supported.");
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

  // Sort by distance (closest first) if we have our location
  const sorted = [...filtered].sort((a, b) => {
    if (!lastLat || !lastLon) return 0;
    if (!a.lat || !a.lon) return 1;
    if (!b.lat || !b.lon) return -1;
    const distA = getDistanceFromLatLonInKm(lastLat, lastLon, a.lat, a.lon);
    const distB = getDistanceFromLatLonInKm(lastLat, lastLon, b.lat, b.lon);
    return distA - distB;
  });

  if (!usersList) return;

  if (!sorted.length) {
    usersList.innerHTML = '<div class="muted">No one else is available.</div>';
    return;
  }

  // Remove "No one else is available" message if it exists and we have users
  if (
    usersList.querySelector(".muted") &&
    usersList.children.length === 1 &&
    usersList.children[0].textContent.includes("No one else")
  ) {
    usersList.innerHTML = "";
  }

  // 1. Mark all existing cards for potential removal
  const existingCards = new Map();
  usersList.querySelectorAll(".user-card").forEach((card) => {
    existingCards.set(card.dataset.userId, card);
  });

  sorted.forEach((u) => {
    let card = existingCards.get(String(u.userId));
    const isBusy = !!u.isBusy;

    // Calculate distance
    let distanceText = '';
    if (lastLat && lastLon && u.lat && u.lon) {
      const distKm = getDistanceFromLatLonInKm(lastLat, lastLon, u.lat, u.lon);
      if (distKm < 1) {
        distanceText = `<span class="distance-badge">${Math.round(distKm * 1000)}m away</span>`;
      } else {
        distanceText = `<span class="distance-badge">${distKm.toFixed(1)}km away</span>`;
      }
    }

    // HTML content generator
    const generateInnerHTML = (user, busy, distance) => `
      <div><strong>${user.name || user.email}</strong>${busy ? ' <span class="busy-badge">🔴 Busy</span>' : ""}${distance}</div>
      <div class="muted">${user.email}</div>
      <div class="actions">
        <button class="small" data-action="center">Center</button>
        ${
          busy
            ? '<button class="small secondary" disabled title="User is busy - cannot page" style="opacity: 0.5; cursor: not-allowed;">Page</button>'
            : '<button class="small secondary" data-action="page">Page</button>'
        }
        <button class="small secondary" data-action="remove" style="background: #dc2626; color: white;">Remove</button>
      </div>
    `;

    if (card) {
      // UPDATE existing card
      const newHTML = generateInnerHTML(u, isBusy, distanceText);
      if (card.innerHTML !== newHTML) {
        card.innerHTML = newHTML;
        attachCardListeners(card, u);
      }

      // Update class
      if (isBusy) card.classList.add("busy-user");
      else card.classList.remove("busy-user");

      // Mark as kept
      existingCards.delete(String(u.userId));
    } else {
      // CREATE new card
      card = document.createElement("div");
      card.className = "user-card" + (isBusy ? " busy-user" : "");
      card.dataset.userId = u.userId;
      card.innerHTML = generateInnerHTML(u, isBusy, distanceText);
      usersList.appendChild(card);
      attachCardListeners(card, u);
    }
  });

  // Remove stale cards
  existingCards.forEach((card) => {
    card.remove();
  });
}

function attachCardListeners(card, u) {
  const centerBtn = card.querySelector('[data-action="center"]');
  const pageBtn = card.querySelector('[data-action="page"]');
  const removeBtn = card.querySelector('[data-action="remove"]');

  if (centerBtn) {
    centerBtn.addEventListener("click", () => {
      if (u.lat && u.lon) mapUI.centerOn(u.lat, u.lon);
    });
  }
  if (pageBtn) {
    pageBtn.addEventListener("click", () => pageUser(u.userId));
  }
  if (removeBtn) {
    removeBtn.addEventListener("click", () =>
      removeFriend(u.userId, u.name || u.email),
    );
  }
}

async function removeFriend(friendId, friendName) {
  if (!confirm(`Remove ${friendName} from your friends?`)) return;

  try {
    const res = await fetch("/remove-friend", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `friendId=${friendId}`,
    });

    if (res.ok) {
      alert("Friend removed");
      // Reload to update the friends list
      window.location.reload();
    } else {
      alert("Failed to remove friend");
    }
  } catch (err) {
    console.error("Error removing friend:", err);
    alert("Error removing friend");
  }
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

  if (!isAvailable) {
    busyBtn.disabled = true;
    busyBtn.textContent = "Status: Hidden";
    busyBtn.classList.remove("busy-state");
    busyBtn.classList.remove("shared-state");
    busyBtn.classList.add("hidden-state");
    return;
  }

  busyBtn.disabled = false;

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

function getDistanceFromLatLonInKm(lat1, lon1, lat2, lon2) {
  const R = 6371; // Radius of the earth in km
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(deg2rad(lat1)) *
      Math.cos(deg2rad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const d = R * c; // Distance in km
  return d;
}

function deg2rad(deg) {
  return deg * (Math.PI / 180);
}

bootstrap();
