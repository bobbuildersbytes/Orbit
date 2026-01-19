const availableBtn = document.getElementById("available-btn");
const busyBtn = document.getElementById("busy-btn");
const usersList = document.getElementById("users-list");

let pollTimer = null;
let isAvailable = false;
let isBusy = false;
let geoWatchId = null;
let lastIdentitySignature = null;

// Orbit: Use window.orbitUser injected from EJS
const currentUser = window.orbitUser;

async function bootstrap() {
  // 1. Initialize Auth UI
  // Always set user, even if null, to ensure correct Login vs App view toggle
  // CRITICAL: Do this BEFORE any network calls (like Amplitude) to ensure instant UI
  authUI.setUser(currentUser);

  // 2. Wire Events IMMEDIATELY (Non-blocking)
  wireEvents();
  renderSkeletonUsers();

  // 3. Initialize Amplitude (Background)
  // Don't let this block the UI
  amplitudeClient
    .initFromServer()
    .catch((err) => console.error("Amplitude init failed", err));

  if (currentUser) {
    updateAmplitudeIdentity(); // Identify immediately with injected user

    // 3. Request permissions
    requestGeolocationPermission();

    // Initial State: Sidebar is open, so hide the floating toggle
    const desktopSidebarToggle = document.getElementById(
      "desktop-sidebar-toggle",
    );
    if (desktopSidebarToggle && window.innerWidth > 768) {
      desktopSidebarToggle.classList.add("hidden");
    }

    // 4. Start Data Fetching (Async)
    await fetchMe();
    startPolling();
  } else {
    // If no user, ensure we stop any polling or location watching
    console.log("No valid current user found during bootstrap.");
  }
}

function renderSkeletonUsers() {
  if (!usersList) return;
  // Generate 5 skeleton items
  let skeletons = "";
  for (let i = 0; i < 5; i++) {
    skeletons += `
      <div class="user-card skeleton-card">
        <div class="skeleton-info">
          <div class="skeleton-text skeleton-title" style="width: 120px; margin-bottom: 4px;"></div>
          <div class="skeleton-text" style="width: 80px;"></div>
        </div>
        <div class="skeleton-actions">
           <div class="skeleton-btn"></div>
           <div class="skeleton-btn"></div>
        </div>
      </div>
    `;
  }
  usersList.innerHTML = skeletons;
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
    // Always (re)identify after /api/me to ensure Amplitude user_id is set
    updateAmplitudeIdentity();
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
  const mobileNavIcons = document.querySelectorAll(".mobile-nav-icon");
  const mobileDrawerBackdrop = document.getElementById(
    "mobile-drawer-backdrop",
  );

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

  function setMobileDrawerOpen(open) {
    if (!sidebar) return;
    if (open) {
      sidebar.classList.add("mobile-open");
      mobileDrawerBackdrop?.classList.remove("hidden");
    } else {
      sidebar.classList.remove("mobile-open");
      mobileDrawerBackdrop?.classList.add("hidden");
      sidebar.classList.remove(
        "show-activities",
        "show-profile",
        "show-suggestions",
      );
    }
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

  // Generic Panel Switching Logic
  const panels = document.querySelectorAll(".panel-section");

  function switchPanel(targetId) {
    // Hide all panels
    panels.forEach((p) => p.classList.add("hidden"));

    // Show target
    const targetPanel = document.getElementById(targetId);
    if (targetPanel) {
      targetPanel.classList.remove("hidden");
    }

    // Update Title based on target
    if (sidebarTitle) {
      if (targetId === "activities-panel") sidebarTitle.textContent = "Friends";
      else if (targetId === "profile-panel")
        sidebarTitle.textContent = "Profile & Settings";
      else if (targetId === "suggestions-panel") {
        sidebarTitle.textContent = "AI Suggestions";
        if (suggestionsUI && suggestionsUI.fetchSuggestions) {
          suggestionsUI.fetchSuggestions(false); // Use cache on tab switch
        }
      }
    }
  }

  // Track active panel for polling
  function isSuggestionsActive() {
    const p = document.getElementById("suggestions-panel");
    return p && !p.classList.contains("hidden");
  }

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
      switchPanel(targetId);
    });
  });

  // Mobile Side Navigation (Drawer)
  mobileDrawerBackdrop?.addEventListener("click", () => {
    setMobileDrawerOpen(false);
  });

  mobileNavIcons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = btn.dataset.target;
      if (!target) return;

      const isSameTarget =
        btn.classList.contains("active") &&
        sidebar &&
        sidebar.classList.contains("mobile-open");

      // Always update active state (so it shows the "current" section)
      mobileNavIcons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");

      if (isSameTarget) {
        setMobileDrawerOpen(false);
        return;
      }

      setMobileDrawerOpen(true);

      // Add specific class for potential CSS styling hooks
      sidebar.classList.remove(
        "show-activities",
        "show-profile",
        "show-suggestions",
      );
      if (target === "activities-panel")
        sidebar.classList.add("show-activities");
      else if (target === "profile-panel")
        sidebar.classList.add("show-profile");
      else if (target === "suggestions-panel")
        sidebar.classList.add("show-suggestions");

      switchPanel(target);
    });
  });

  // Mobile Navigation
  bottomNavItems.forEach((btn) => {
    btn.addEventListener("click", () => {
      const isActive = btn.classList.contains("active");

      // Always reset active state first
      bottomNavItems.forEach((b) => b.classList.remove("active"));

      // If clicking already active tab -> Toggle Drawer
      if (isActive) {
        if (sidebar && sidebar.classList.contains("mobile-open")) {
          setMobileDrawerOpen(false);
        } else {
          setMobileDrawerOpen(true);
        }
        return;
      }

      // Otherwise -> Open and set Active
      btn.classList.add("active");
      const target = btn.dataset.target;

      setMobileDrawerOpen(true);

      // Reset specific classes
      sidebar.classList.remove(
        "show-activities",
        "show-profile",
        "show-suggestions",
      );

      // Add specific class for potential CSS styling hooks
      if (target === "activities-panel")
        sidebar.classList.add("show-activities");
      else if (target === "profile-panel")
        sidebar.classList.add("show-profile");
      else if (target === "suggestions-panel")
        sidebar.classList.add("show-suggestions");

      // Also switch the inner panel content so it matches desktop logic
      switchPanel(target);
    });
  });

  suggestionsUI.setHandlers({
    onPage: (toUserId, message) => pageUser(toUserId, message),
    onAvailability: (available) => updatePresence(available, isBusy),
  });

  const refreshBtn = document.getElementById("refresh-suggestions-btn");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", () => {
      suggestionsUI.fetchSuggestions(true); // Force refresh
    });
  }

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

  // OPTIMISTIC UPDATE:
  // 1. Snapshot previous state for rollback
  const prevAvailable = isAvailable;
  const prevBusy = isBusy;

  // 2. Update local state immediately
  isAvailable = available;
  isBusy = busy;

  // 3. Update UI immediately
  syncBusyUI();
  syncAvailabilityUI(isAvailable);

  // 4. Update map marker immediately
  if (lastLat && lastLon) {
    mapUI.updateMyMarker(lastLat, lastLon, isAvailable, isBusy);
  }

  // 5. Handle Side Effects (Location Watch) immediately based on intent
  if (available) {
    // If turning on, ensure we have location
    // Don't wait for sendLocation to finish
    sendLocation();
    startLocationWatch();
  } else {
    stopLocationWatch();
  }

  try {
    const res = await fetch("/api/availability", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ available, isBusy: busy }),
    });

    if (!res.ok) {
      throw new Error(
        (await res.json()).error || "Failed to update availability",
      );
    }

    const data = await res.json();
    console.log("updatePresence confirmed by server:", data);

    // Track success
    const now = new Date();
    amplitudeClient.track("presence_updated", {
      available,
      isBusy,
      timestamp: now.toISOString(),
    });
    trackAvailabilityPattern();
    updateAmplitudeIdentity();
  } catch (err) {
    console.error("Presence update failed, reverting UI:", err);

    // REVERT STATE
    isAvailable = prevAvailable;
    isBusy = prevBusy;

    // REVERT UI
    syncBusyUI();
    syncAvailabilityUI(isAvailable);
    if (lastLat && lastLon) {
      mapUI.updateMyMarker(lastLat, lastLon, isAvailable, isBusy);
    }

    // REVERT LOCATION WATCH
    if (prevAvailable) startLocationWatch();
    else stopLocationWatch();

    alert("Failed to update status. Reverting.");
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
    updateAmplitudeIdentity({ location: { lat: lastLat, lon: lastLon } });
    return;
  }

  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const { latitude, longitude, accuracy } = pos.coords;
      lastLat = latitude;
      lastLon = longitude;

      // OPTIMISTIC UPDATE: Update marker locally first
      mapUI.updateMyMarker(latitude, longitude, isAvailable, isBusy);

      // Then send to server
      await pushLocation(latitude, longitude, accuracy);

      updateAmplitudeIdentity({ location: { lat: latitude, lon: longitude } });
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
  };
  poll();
  pollTimer = setInterval(poll, 5000);
}

// Track last known presences for UI lookups
let lastKnownPresences = [];

async function loadPresence() {
  if (!currentUser) return;
  const res = await fetch("/api/presence");
  if (!res.ok) return;
  const data = await res.json();

  const presences = data.presences || [];
  lastKnownPresences = presences; // Store for lookup
  renderUsers(presences);

  // Filter self from map markers (we have a custom dot now)
  const others = presences.filter(
    (u) => u.userId !== (currentUser._id || currentUser.id),
  );
  mapUI.updateMarkers(others);

  mapUI.updateMarkers(others);
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

  // Clear skeletons if present
  if (usersList.querySelector(".skeleton-card")) {
    usersList.innerHTML = "";
  }

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
    let distanceText = "";
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
      <div><strong>${user.name || user.email}</strong>${busy ? ' <span class="busy-badge"><span class="status-dot" aria-hidden="true"></span>Busy</span>' : ""}${distance}</div>
      <div class="muted">${user.email}</div>
      ${
        user.lastSeen
          ? `<div class="muted">${formatLastSeen(user.lastSeen)}</div>`
          : ""
      }
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

async function openPagingModal(toUserId) {
  const overlay = document.getElementById("pager-modal-overlay");
  const modalContent = overlay.querySelector(".pager-modal"); // Container
  const input = document.getElementById("pager-message-input");
  const cancelBtn = document.getElementById("pager-cancel-btn");
  const sendBtn = document.getElementById("pager-send-btn");
  const titleEl = overlay.querySelector(".pager-title");
  const subtitleEl = overlay.querySelector(".pager-subtitle");

  // Find user data
  const targetUser = lastKnownPresences.find((u) => u.userId === toUserId) || {
    name: "Friend",
    userId: toUserId,
  };

  // Inject User Card if not exists
  let userCardContainer = document.getElementById("pager-user-card");
  if (!userCardContainer) {
    userCardContainer = document.createElement("div");
    userCardContainer.id = "pager-user-card";
    // Insert after subtitle
    subtitleEl.parentNode.insertBefore(userCardContainer, input);
  }

  // Calculate distance string
  let distanceText = "";
  if (lastLat && lastLon && targetUser.lat && targetUser.lon) {
    const dist = getDistanceFromLatLonInKm(
      lastLat,
      lastLon,
      targetUser.lat,
      targetUser.lon,
    );
    distanceText =
      dist < 1
        ? `${Math.round(dist * 1000)}m away`
        : `${dist.toFixed(1)}km away`;
  } else {
    distanceText = "Location unknown";
  }

  // Render User Card
  userCardContainer.innerHTML = `
    <div class="invite-row selected" style="cursor: default">
      <div class="invite-map-shell">
        ${targetUser.lat ? `<div id="pager-mini-map" style="width:100%; height:100%"></div>` : '<div class="invite-map missing">No Loc</div>'}
      </div>
      <div>
        <div class="invite-name">${targetUser.name || targetUser.email || "Friend"}</div>
        <div class="invite-detail" style="font-size:0.8em; opacity:0.8">${distanceText} ${targetUser.isBusy ? "• Busy" : ""}</div>
      </div>
    </div>
  `;

  if (titleEl)
    titleEl.textContent = `Page ${targetUser.name ? targetUser.name.split(" ")[0] : "Friend"}`;
  if (subtitleEl)
    subtitleEl.textContent = "Send a quick message or location request.";

  if (!overlay || !input || !cancelBtn || !sendBtn) {
    console.error("Missing pager modal elements");
    return prompt("Optional message?");
  }

  // Init Mini Map
  if (targetUser.lat && window.L) {
    setTimeout(() => {
      const mapEl = document.getElementById("pager-mini-map");
      if (mapEl) {
        try {
          const m = L.map(mapEl, {
            zoomControl: false,
            attributionControl: false,
            dragging: false,
            scrollWheelZoom: false,
            doubleClickZoom: false,
            boxZoom: false,
            keyboard: false,
            tap: false,
          }).setView([targetUser.lat, targetUser.lon], 13);
          L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
            maxZoom: 19,
          }).addTo(m);
          L.circleMarker([targetUser.lat, targetUser.lon], {
            radius: 5,
            fillColor: "#6366f1",
            color: "#fff",
            weight: 2,
            opacity: 1,
            fillOpacity: 1,
          }).addTo(m);
        } catch (e) {
          console.error("Mini map error", e);
        }
      }
    }, 100);
  }

  // Reset UI
  input.value = "";
  overlay.classList.remove("hidden");
  setTimeout(() => input.focus(), 50);

  return new Promise((resolve) => {
    const close = () => {
      overlay.classList.add("hidden");
      cleanup();
    };

    const onSend = () => {
      const msg = input.value;
      close();
      resolve(msg || undefined);
    };

    const onCancel = () => {
      close();
      resolve(null);
    };

    const onKey = (e) => {
      if (e.key === "Escape") onCancel();
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        onSend();
      }
    };

    const cleanup = () => {
      sendBtn.removeEventListener("click", onSend);
      cancelBtn.removeEventListener("click", onCancel);
      overlay.removeEventListener("click", onBackdropClick);
      input.removeEventListener("keydown", onKey);
    };

    const onBackdropClick = (e) => {
      if (e.target === overlay) onCancel();
    };

    sendBtn.addEventListener("click", onSend);
    cancelBtn.addEventListener("click", onCancel);
    overlay.addEventListener("click", onBackdropClick);
    input.addEventListener("keydown", onKey);
  });
}

async function pageUser(toUserId, presetMessage) {
  let message = presetMessage;
  if (typeof message !== "string") {
    message = await openPagingModal(toUserId);
    if (message === null) return; // Cancelled
  }
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
  showToast("Page sent!");

  // Track with time context
  const now = new Date();
  amplitudeClient.track("page_clicked", {
    toUserId,
    hour: now.getHours(),
    dayOfWeek: now.getDay(), // 0 = Sunday, 6 = Saturday
    dayName: [
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
      "Sunday",
    ][now.getDay()],
    timestamp: now.toISOString(),
    userLat: lastLat,
    userLon: lastLon,
  });
  return res;
}

window.trackSuggestionDecision = function (item, decision, friendIds = []) {
  if (typeof amplitudeClient === "undefined") return;

  // Ensure friendIds is an array
  const fidArray = Array.isArray(friendIds) ? friendIds : [friendIds];

  const now = new Date();
  const location = lastLat && lastLon ? { lat: lastLat, lon: lastLon } : null;

  amplitudeClient.track("suggestion_decision", {
    decision: decision, // "Accept" or "Reject"
    label: item.label,
    type: item.type,
    venue: item.detail || "No Venue Details",
    friendIds: fidArray,
    timestamp: now.toISOString(),
    hour: now.getHours(),
    dayOfWeek: now.getDay(),
    dayName: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][now.getDay()],
    userLat: location?.lat,
    userLon: location?.lon,
  });
};

function showToast(message, type = "success") {
  let container = document.getElementById("toast-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "toast-container";
    document.body.appendChild(container);
  }

  const toast = document.createElement("div");
  toast.className = "toast";

  const icon = type === "success" ? "✅" : "ℹ️";

  toast.innerHTML = `
    <span class="toast-icon">${icon}</span>
    <span>${message}</span>
  `;

  container.appendChild(toast);

  // Auto remove
  setTimeout(() => {
    toast.classList.add("fade-out");
    // Fallback remove after transition duration (350ms approx)
    setTimeout(() => {
      try {
        if (document.body.contains(toast)) {
          toast.remove();
          if (container.children.length === 0) {
            container.remove();
          }
        }
      } catch (e) {
        // ignore
      }
    }, 400);
  }, 3000);
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

function formatLastSeen(lastSeen) {
  const ts = new Date(lastSeen);
  if (Number.isNaN(ts.getTime())) return "Last seen: unknown";
  const minutes = Math.max(0, Math.round((Date.now() - ts.getTime()) / 60000));
  if (minutes < 1) return "Last seen: just now";
  if (minutes < 60) return `Last seen: ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Last seen: ${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `Last seen: ${days}d ago`;
}

function updateAmplitudeIdentity(extra = {}) {
  if (!currentUser || !window.amplitudeClient || !amplitudeClient.identifyUser)
    return;

  const location =
    extra.location ||
    (lastLat && lastLon ? { lat: lastLat, lon: lastLon } : undefined);

  const signature = JSON.stringify({
    available: isAvailable,
    isBusy,
    location,
  });

  if (signature === lastIdentitySignature) return;
  lastIdentitySignature = signature;

  amplitudeClient.identifyUser(currentUser, {
    available: isAvailable,
    isBusy,
    location,
  });
}

// Track availability patterns over time
let availabilityLog = [];
const MAX_LOG_ENTRIES = 168; // 1 week of hourly data

function trackAvailabilityPattern() {
  const now = new Date();
  const entry = {
    timestamp: now.toISOString(),
    hour: now.getHours(),
    dayOfWeek: now.getDay(),
    available: isAvailable,
    busy: isBusy,
  };

  availabilityLog.push(entry);

  // Keep only recent entries
  if (availabilityLog.length > MAX_LOG_ENTRIES) {
    availabilityLog = availabilityLog.slice(-MAX_LOG_ENTRIES);
  }

  // Save to localStorage
  try {
    localStorage.setItem("availability_log", JSON.stringify(availabilityLog));
  } catch (e) {
    console.error("Failed to save availability log", e);
  }
}

// Send availability analytics periodically (every hour)
function sendAvailabilityAnalytics() {
  if (availabilityLog.length === 0) return;

  const now = new Date();
  const currentHour = now.getHours();
  const currentDay = now.getDay();

  // Calculate availability percentage for current hour across all days
  const sameHourEntries = availabilityLog.filter((e) => e.hour === currentHour);
  const availableCount = sameHourEntries.filter(
    (e) => e.available && !e.busy,
  ).length;
  const hourlyAvailabilityPct =
    sameHourEntries.length > 0
      ? Math.round((availableCount / sameHourEntries.length) * 100)
      : 0;

  // Calculate availability percentage for current day of week
  const sameDayEntries = availabilityLog.filter(
    (e) => e.dayOfWeek === currentDay,
  );
  const dayAvailableCount = sameDayEntries.filter(
    (e) => e.available && !e.busy,
  ).length;
  const dailyAvailabilityPct =
    sameDayEntries.length > 0
      ? Math.round((dayAvailableCount / sameDayEntries.length) * 100)
      : 0;

  // Overall availability percentage
  const totalAvailable = availabilityLog.filter(
    (e) => e.available && !e.busy,
  ).length;
  const overallPct = Math.round(
    (totalAvailable / availabilityLog.length) * 100,
  );

  amplitudeClient.track("availability_pattern", {
    hour: currentHour,
    dayOfWeek: currentDay,
    dayName: [
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
    ][currentDay],
    hourlyAvailabilityPercentage: hourlyAvailabilityPct,
    dailyAvailabilityPercentage: dailyAvailabilityPct,
    overallAvailabilityPercentage: overallPct,
    dataPoints: availabilityLog.length,
    currentlyAvailable: isAvailable,
    currentlyBusy: isBusy,
  });
}

// Load availability log from localStorage on startup
try {
  const saved = localStorage.getItem("availability_log");
  if (saved) {
    availabilityLog = JSON.parse(saved);
  }
} catch (e) {
  console.error("Failed to load availability log", e);
}

// Send analytics every hour
setInterval(sendAvailabilityAnalytics, 60 * 60 * 1000);

// Send analytics on page load (after 10 seconds to let everything initialize)
setTimeout(sendAvailabilityAnalytics, 10000);

bootstrap();
