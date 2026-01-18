window.suggestionsUI = (function () {
  const list = document.getElementById("suggestions-list");
  const modal = createInviteModal();
  let context = null;
  let suggestionConfidence = 1; // Start optimistic; ratchet down on declines/cancels
  let handlers = {
    onPage: () => {},
    onAvailability: () => {},
  };

  let lastFetchTime = 0;
  const FETCH_COOLDOWN = 5000; // 5 seconds

  function setHandlers(h) {
    handlers = { ...handlers, ...h };
  }

  async function fetchSuggestions(force = false) {
    const now = Date.now();
    if (!force && now - lastFetchTime < FETCH_COOLDOWN) {
      console.log("Skipping suggestion fetch (cooldown)");
      return;
    }

    lastFetchTime = now;

    // Show loading state if forcing (e.g. initial open or manual refresh)
    if (force && list) {
      list.innerHTML = '<div class="muted">Loading suggestions...</div>';
    }

    try {
      const res = await fetch("/api/suggestions/context");
      if (!res.ok) return;
      const data = await res.json();
      context = data.context || null;
      render(data.suggestions || []);
    } catch (err) {
      console.error(err);
      if (list)
        list.innerHTML =
          '<div class="muted" style="color:var(--color-error)">Failed to load.</div>';
    }
  }

  function render(items) {
    if (!list) return;
    list.innerHTML = "";
    if (!items.length) {
      list.innerHTML = '<div class="muted">No suggestions right now.</div>';
      return;
    }

    items.forEach((item, index) => {
      // Auto-assign friend if missing for activity suggestions
      if (
        item.type === "activity_suggestion" &&
        (!item.data || !item.data.userId)
      ) {
        const candidates = getAvailableFriendsSorted();
        if (candidates.length > 0) {
          if (!item.data) item.data = {};
          item.data.userId = candidates[0].id || candidates[0]._id;
          // Update label to show who it's with
          item.label = `${item.label} with ${displayName(candidates[0])}`;
        }
      }

      const el = document.createElement("div");
      el.className = "suggestion-card";

      // Determine icon based on type
      // Determine icon based on type
      // Determine icon based on type
      const icon = item.type === "activity_suggestion" ? "📍" : "👋";
      let actionLabel = item.actionLabel || "Go";

      // Determine users involved
      let involvedNames = [];
      const rawUserIds = item.data?.userIds;
      const userIds =
        rawUserIds && rawUserIds.length > 0
          ? rawUserIds
          : item.data?.userId
            ? [item.data.userId]
            : [];

      if (userIds.length > 0) {
        userIds.forEach((uid) => {
          const f = lookupFriendById(uid);
          if (f) involvedNames.push(displayName(f).split(" ")[0]);
        });
      }

      if (item.type === "activity_suggestion") {
        if (!actionLabel || actionLabel === "Go") {
          actionLabel = "Invite";
          if (involvedNames.length === 1) {
            actionLabel = `Invite ${involvedNames[0]}`;
          } else if (involvedNames.length > 1) {
            actionLabel = "Invite friends";
          }
        }
      }

      el.innerHTML = `
        <div style="margin-bottom: 8px;">
          <div style="font-weight: bold; display:flex; align-items:center; gap:8px;">
            <span>${icon}</span>
            <span class="suggestion-label">${item.label}</span>
          </div>
          <div class="suggestion-detail" style="font-size: 0.9em; margin-top:2px;">
            ${item.detail || ""}
          </div>
          <div class="muted" style="margin-top:4px; font-size: 0.8em;">${item.reason || "AI Suggested"}</div>
        </div>
        <div class="actions" style="display:flex; gap: 4px; margin-top: 8px;">
          <button class="small primary action-btn">${actionLabel}</button>
          ${item.type !== "go_available" ? '<button class="small secondary edit-btn">Edit</button>' : ""}
          <button class="small secondary decline-btn" style="color: var(--color-error)">Decline</button>
        </div>
      `;

      // Wire events
      const actionBtn = el.querySelector(".action-btn");
      const editBtn = el.querySelector(".edit-btn");
      const declineBtn = el.querySelector(".decline-btn");
      const labelEl = el.querySelector(".suggestion-label");

      actionBtn.addEventListener("click", () => execute(item));

      if (editBtn) {
        editBtn.addEventListener("click", () =>
          openEditSuggestionModal(item, (updatedItem) => {
            // Re-render essentially or update local DOM
            const newUserIds = updatedItem.data?.userIds || [];
            let newNames = [];
            newUserIds.forEach((uid) => {
              const f = lookupFriendById(uid);
              if (f) newNames.push(displayName(f).split(" ")[0]);
            });

            if (newNames.length === 1) {
              // Single person
              actionBtn.textContent = `Invite ${newNames[0]}`;
              // Update title
              const baseLabel = updatedItem.label.split(" with ")[0];
              const validId = newUserIds.find((uid) => lookupFriendById(uid));
              const f = validId ? lookupFriendById(validId) : null;
              if (f) {
                updatedItem.label = `${baseLabel} with ${displayName(f)}`;
                labelEl.textContent = updatedItem.label;
              }
            } else if (newNames.length > 1) {
              // Multiple people
              actionBtn.textContent = "Invite friends";
              const baseLabel = updatedItem.label.split(" with ")[0];
              updatedItem.label = `${baseLabel} with friends`;
              labelEl.textContent = updatedItem.label;
            } else {
              // No one? Fallback
              actionBtn.textContent = "Invite";
            }
          }),
        );
      }

      declineBtn.addEventListener("click", () => {
        el.remove();
        suggestionConfidence = Math.max(0.2, suggestionConfidence - 0.15);
        // Optional: Send feedback to API that this was declined
        console.log("Declined suggestion:", item);
      });

      list.appendChild(el);
    });
  }

  function openEditSuggestionModal(item, onUpdate) {
    const overlay = document.getElementById("edit-suggestion-modal-overlay");
    const modalContent = document.getElementById("edit-modal-content");
    const listContainer = document.getElementById("edit-friend-list");
    const detailInput = document.getElementById("edit-suggestion-detail");
    let cancelBtn = document.getElementById("edit-cancel-btn");
    let saveBtn = document.getElementById("edit-save-btn");

    // Dynamic Header Elements
    const titleEl = document.getElementById("edit-modal-title");
    const subTitleEl = document.getElementById("edit-modal-subtitle");
    const step1Label = document.getElementById("edit-step1-label");
    const step2Label = document.getElementById("edit-step2-label");
    const confidenceEl = document.getElementById("edit-modal-confidence");

    if (!overlay) return;

    // STATE
    let currentStep = 1;
    let selectedIds = new Set();

    // Initialize Selection from existing item data
    if (item.data) {
      const addId = (id) => {
        if (!id) return;
        // Verify this ID exists in friends, or try to resolve by name
        let found = lookupFriendById(id);
        if (!found && context && context.friends) {
          // Fallback: Try to find by name match
          const lowerId = String(id).toLowerCase();
          found = context.friends.find(
            (f) =>
              (f.name && f.name.toLowerCase() === lowerId) ||
              (f.email && f.email.toLowerCase() === lowerId) ||
              displayName(f).toLowerCase().includes(lowerId),
          );
        }

        if (found) {
          selectedIds.add(String(found.id || found._id));
        } else {
          // If purely just an ID that exists but maybe not in our partial context list?
          // Or if we trust the ID blindly?
          // Better to only select if we can map it to a rendered row.
          // But let's trust it if it looks like an ID, just in case.
          selectedIds.add(String(id));
        }
      };

      if (item.data.userIds) {
        item.data.userIds.forEach(addId);
      } else if (item.data.userId) {
        addId(item.data.userId);
      }
    }

    // --- STEP 1: Friend Selection ---
    const renderStep1 = () => {
      currentStep = 1;

      // Update Headers
      if (titleEl) titleEl.textContent = item.label || "Edit Suggestion";
      if (subTitleEl) subTitleEl.textContent = "Who is this suggestion for?";

      // Visibility
      listContainer.style.display = "flex";
      detailInput.style.display = "none";
      if (step1Label) step1Label.style.display = "block";
      if (step2Label) step2Label.style.display = "none";
      if (confidenceEl) confidenceEl.style.display = "none";

      if (saveBtn) saveBtn.textContent = "Next";

      // Render Friends
      listContainer.innerHTML = "";
      let friends = context?.friends || [];

      if (!friends.length) {
        listContainer.innerHTML = '<div class="muted">No friends found</div>';
        return;
      }

      // Sort friends by distance/availability
      const me = context.user;
      const sorted = friends
        .map((f) => ({
          ...f,
          distanceKm: computeDistance(
            me?.location?.lat,
            me?.location?.lon,
            f?.location?.lat,
            f?.location?.lon,
          ),
          idx: f.id || f._id,
        }))
        .sort((a, b) => {
          const da = Number.isFinite(a.distanceKm) ? a.distanceKm : Infinity;
          const db = Number.isFinite(b.distanceKm) ? b.distanceKm : Infinity;
          return da - db;
        });

      // HTML Generation
      const listHtml = sorted
        .map((f, i) => {
          const isSelected = selectedIds.has(String(f.id || f._id));
          const busyBadge = f.isBusy
            ? '<div class="busy-badge">BUSY</div>'
            : "";

          return `
              <div class="invite-row selection-row ${isSelected ? "selected" : ""}" data-user-id="${f.id || f._id}" data-idx="${f.id || f._id}">
                <div class="invite-map-shell">
                  ${
                    f.location
                      ? `<div class="invite-map" data-lat="${f.location.lat}" data-lon="${f.location.lon}" id="edit-map-${f.id || f._id}"></div>`
                      : '<div class="invite-map missing">No Loc</div>'
                  }
                </div>
                <div class="invite-copy">
                  <div style="display:flex; justify-content:space-between; align-items:center;">
                    <div class="invite-name">${displayName(f)}</div>
                    ${busyBadge}
                  </div>
                  <div class="invite-meta">${formatDistance(f.distanceKm)}</div>
                </div>
              </div>
            `;
        })
        .join("");

      listContainer.innerHTML = listHtml;

      // Event Listeners (Row Click)
      const rows = Array.from(listContainer.querySelectorAll(".invite-row"));
      rows.forEach((row) => {
        row.addEventListener("click", () => {
          const uid = row.dataset.userId;

          if (selectedIds.has(uid)) {
            selectedIds.delete(uid);
            row.classList.remove("selected");
          } else {
            // Is this single select or multi select?
            // "autmatically select the friend thats already been chosen" implies one friend usually.
            // But UI supports multi. Let's keep multi for now to avoid breaking multi-friend suggestions.
            selectedIds.add(uid);
            row.classList.add("selected");
          }
        });
      });

      // Render Maps (Mini)
      setTimeout(() => {
        sorted.forEach((c) => {
          if (typeof L === "undefined") return;
          if (!c.location || typeof c.location.lat !== "number") return;
          const el = document.getElementById(`edit-map-${c.id || c._id}`);
          if (!el) return;
          // Check if map already initialized?
          // Simple approach: try-catch or check innerHTML empty
          if (el._leaflet_id) return;

          try {
            const map = L.map(el, {
              zoomControl: false,
              attributionControl: false,
              dragging: false,
              scrollWheelZoom: false,
              doubleClickZoom: false,
              boxZoom: false,
              keyboard: false,
              tap: false,
            }).setView([c.location.lat, c.location.lon], 13);

            L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
              maxZoom: 19,
            }).addTo(map);

            L.circleMarker([c.location.lat, c.location.lon], {
              radius: 4,
              fillColor: "#6366f1", // Indigo
              color: "#ffffff",
              weight: 1,
              opacity: 1,
              fillOpacity: 1,
            }).addTo(map);
          } catch (e) {
            console.error(e);
          }
        });
      }, 100);
    };

    // --- STEP 2: Details ---
    const renderStep2 = () => {
      currentStep = 2;

      // Update Headers
      if (titleEl) titleEl.textContent = "Add Details";
      if (subTitleEl)
        subTitleEl.textContent = "Add a note, time, or specific place";

      // Visibility
      listContainer.style.display = "none";
      detailInput.style.display = "block";
      if (step1Label) step1Label.style.display = "none";
      if (step2Label) step2Label.style.display = "block";

      if (saveBtn) saveBtn.textContent = "Save Suggestion";

      detailInput.value = item.detail || "";
      detailInput.focus();
    };

    // INIT
    renderStep1();
    overlay.classList.remove("hidden");

    // HANDLERS
    const close = () => {
      overlay.classList.add("hidden");
      cleanup();
    };

    const onAction = () => {
      if (currentStep === 1) {
        if (selectedIds.size === 0) {
          // Optional: Shake animation or alert
          if (!confirm("No friends selected. Proceed with just yourself?"))
            return;
        }
        renderStep2();
      } else {
        // Step 2 -> Save
        item.detail = detailInput.value;
        const finalIds = Array.from(selectedIds);

        if (!item.data) item.data = {};
        item.data.userIds = finalIds;
        item.data.userId = finalIds.length > 0 ? finalIds[0] : null;

        if (onUpdate) onUpdate(item);
        close();
      }
    };

    const cleanup = () => {
      saveBtn.removeEventListener("click", onAction);
      cancelBtn.removeEventListener("click", close);
    };

    // One-time bind (need to be careful not to stack bindings if recycled)
    // The previous implementation added listeners every open.
    // We should use { once: true } or remove old ones.
    // The structure here uses local `cleanup` but `saveBtn` is global global ID.
    // Better to clone or remove old listeners.
    // Simplest fix:
    const newSave = saveBtn.cloneNode(true);
    const newCancel = cancelBtn.cloneNode(true);
    saveBtn.parentNode.replaceChild(newSave, saveBtn);
    cancelBtn.parentNode.replaceChild(newCancel, cancelBtn);

    // UPDATE REFERENCES so render steps affect the live button!
    saveBtn = newSave;
    cancelBtn = newCancel;

    saveBtn.addEventListener("click", onAction);
    cancelBtn.addEventListener("click", close);
  }

  function execute(item) {
    console.log("Executing suggestion:", item);
    const now = new Date();
    const location = context?.user?.location;
    amplitudeClient.track("suggestion_clicked", {
      type: item.type,
      label: item.label,
      detail: item.detail,
      hour: now.getHours(),
      dayOfWeek: now.getDay(),
      dayName: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][now.getDay()],
      timestamp: now.toISOString(),
      userLat: location?.lat,
      userLon: location?.lon,
    });

    if (item.type === "page_friend") {
      const friend = lookupFriendById(item.data.userId); // page_friend remains single for now as per model
      showInviteUI(item, friend ? [friend] : []);
    } else if (item.type === "activity_suggestion") {
      // Logic for Multi-Paging
      const userIds =
        item.data?.userIds || (item.data?.userId ? [item.data.userId] : []);

      if (userIds.length > 0) {
        // If 1 or more friends selected, page them all directly without showing picker again
        // unless userIds is empty.
        const inviteMessage = buildInviteMessage(item);
        userIds.forEach((uid) => {
          const friend = lookupFriendById(uid);
          if (friend) {
            handlers.onPage(friend.id || friend._id, inviteMessage);
          }
        });
        return;
      }

      // Fallback: If no friends selected, try to find one automatically or show picker
      const candidates = getAvailableFriendsSorted();
      if (candidates.length > 0) {
        const topCandidate = candidates[0];
        const inviteMessage = buildInviteMessage(item);
        handlers.onPage(topCandidate.id || topCandidate._id, inviteMessage);
      } else {
        alert("No available friends found to invite.");
      }
    } else if (item.type === "go_available") {
      handlers.onAvailability(true);
    }
  }

  function computeDistance(lat1, lon1, lat2, lon2) {
    if (
      typeof lat1 !== "number" ||
      typeof lon1 !== "number" ||
      typeof lat2 !== "number" ||
      typeof lon2 !== "number"
    ) {
      return Infinity;
    }
    const toRad = (deg) => (deg * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat1)) *
        Math.cos(toRad(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return Math.round(6371 * c * 10) / 10; // km, one decimal
  }

  function buildInviteMessage(item) {
    const detail = (item.detail || "").trim();
    if (detail) return `Want to meet at "${item.label}"? ${detail}`;
    return `Want to meet at "${item.label}"?`;
  }

  function showInviteUI(item, candidates) {
    if (!modal || !modal.backdrop) return;

    const withMeta = candidates.map((f, idx) => {
      const conf = clampConfidence(computeFriendConfidence(item, f));
      return {
        ...f,
        conf,
        distLabel: formatDistance(f.distanceKm),
        idx,
      };
    });

    const bestConf = withMeta.length
      ? Math.max(...withMeta.map((c) => c.conf))
      : suggestionConfidence;
    const confidencePct = Math.round(bestConf * 100);

    const listHtml = withMeta.length
      ? withMeta
          .map(
            (f) => `
              <div class="invite-row" data-user-id="${f.id}" data-idx="${f.idx}">
                <div class="invite-map-shell">
                  ${
                    f.location
                      ? `<div class="invite-map" data-lat="${f.location.lat}" data-lon="${f.location.lon}" id="invite-map-${f.idx}"></div>`
                      : '<div class="invite-map missing">No location</div>'
                  }
                </div>
                <div class="invite-copy">
                  <div class="invite-name">${displayName(f)}</div>
                  <div class="invite-meta">${f.distLabel}${
                    f.isBusy ? " • busy" : ""
                  }${formatLastSeenText(f.lastSeenMinutesAgo)}</div>
                </div>
                <span class="invite-confidence-pill">${Math.round(
                  f.conf * 100,
                )}%</span>
              </div>
            `,
          )
          .join("")
      : '<div class="muted">No available friends right now.</div>';

    modal.body.innerHTML = `
      <div class="invite-header">
        <div>
          <div class="invite-title">${item.label}</div>
          <div class="invite-detail">${item.detail || "AI suggestion"}</div>
        </div>
        <span class="invite-close" aria-label="Close">✕</span>
      </div>
      <div class="invite-confidence">AI confidence: ${confidencePct}%</div>
      <div class="invite-list">${listHtml}</div>
      <div class="invite-actions">
        <button class="small secondary" data-action="cancel">Cancel</button>
        <button class="small primary" data-action="send" ${candidates.length ? "" : "disabled"}>Page</button>
      </div>
    `;

    modal.backdrop.classList.remove("hidden");

    const closeBtn = modal.body.querySelector(".invite-close");
    const cancelBtn = modal.body.querySelector('[data-action="cancel"]');
    const sendBtn = modal.body.querySelector('[data-action="send"]');
    const rows = Array.from(modal.body.querySelectorAll(".invite-row"));
    const selectedIds = new Set(withMeta.length ? [withMeta[0].id] : []);

    const closeModal = () => {
      modal.backdrop.classList.add("hidden");
    };

    closeBtn?.addEventListener("click", () => {
      suggestionConfidence = Math.max(0.2, suggestionConfidence - 0.1);
      closeModal();
    });
    cancelBtn?.addEventListener("click", () => {
      suggestionConfidence = Math.max(0.2, suggestionConfidence - 0.1);
      closeModal();
    });

    const updateSendEnabled = () => {
      if (selectedIds.size) sendBtn?.removeAttribute("disabled");
      else sendBtn?.setAttribute("disabled", "disabled");
      rows.forEach((row) => {
        const id = row.dataset.userId;
        if (selectedIds.has(id)) row.classList.add("selected");
        else row.classList.remove("selected");
      });
    };

    rows.forEach((row) => {
      row.addEventListener("click", (e) => {
        e.stopPropagation();
        const id = row.dataset.userId;
        if (!id) return;
        if (selectedIds.has(id)) selectedIds.delete(id);
        else selectedIds.add(id);
        updateSendEnabled();
      });
    });
    updateSendEnabled();

    sendBtn?.addEventListener("click", () => {
      if (!selectedIds.size) return;
      const inviteMessage = buildInviteMessage(item);
      selectedIds.forEach((id) => {
        const friend = candidates.find((c) => c.id === id);
        if (friend) handlers.onPage(friend.id, inviteMessage);
      });
      suggestionConfidence = Math.max(0.2, suggestionConfidence - 0.05);
      closeModal();
    });

    renderMiniMaps(withMeta);
  }

  function getAvailableFriendsSorted() {
    if (!context?.friends?.length) return [];
    const me = context.user;
    const availableFriends = context.friends
      .filter((f) => f.available && !f.isBusy)
      .map((f) => ({
        ...f,
        distanceKm: computeDistance(
          me?.location?.lat,
          me?.location?.lon,
          f?.location?.lat,
          f?.location?.lon,
        ),
      }));

    return availableFriends.sort((a, b) => {
      const da = Number.isFinite(a.distanceKm) ? a.distanceKm : Infinity;
      const db = Number.isFinite(b.distanceKm) ? b.distanceKm : Infinity;
      if (da !== db) return da - db;
      return (a.name || a.email || "").localeCompare(b.name || b.email || "");
    });
  }

  function lookupFriendById(id) {
    if (!context?.friends) return null;
    return context.friends.find((f) => f.id === id || f._id === id);
  }

  function computeFriendConfidence(item, friend) {
    const scoreFromAi =
      item?.data?.scores?.[friend.id] || item?.data?.scores?.[friend._id];
    if (typeof scoreFromAi === "number") return clampConfidence(scoreFromAi);

    const base =
      typeof friend.pageHistory?.acceptanceRate === "number"
        ? friend.pageHistory.acceptanceRate / 100
        : 0.6;
    const distance = Number.isFinite(friend.distanceKm)
      ? friend.distanceKm
      : null;
    let distFactor = 0;
    if (distance !== null) {
      if (distance < 1) distFactor = 0.1;
      else if (distance < 5) distFactor = 0.05;
      else if (distance > 20) distFactor = -0.2;
    }
    return clampConfidence(base + distFactor);
  }

  function clampConfidence(val) {
    return Math.min(0.95, Math.max(0.35, val));
  }

  function renderMiniMaps(candidates) {
    if (typeof L === "undefined") return;
    candidates.forEach((c) => {
      if (!c.location || typeof c.location.lat !== "number") return;
      const el = document.getElementById(`invite-map-${c.idx}`);
      if (!el) return;
      const map = L.map(el, {
        zoomControl: false,
        attributionControl: false,
        dragging: false,
        scrollWheelZoom: false,
        doubleClickZoom: false,
        boxZoom: false,
        keyboard: false,
        tap: false,
      }).setView([c.location.lat, c.location.lon], 13);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 17,
        minZoom: 5,
      }).addTo(map);
      L.circleMarker([c.location.lat, c.location.lon], {
        radius: 6,
        fillColor: "#60a5fa",
        color: "#ffffff",
        weight: 2,
        opacity: 1,
        fillOpacity: 1,
      }).addTo(map);
      // Center main map when clicking map thumbnail
      el.addEventListener("click", () => {
        if (window.mapUI?.centerOn)
          window.mapUI.centerOn(c.location.lat, c.location.lon);
      });
    });
  }

  function formatDistance(distanceKm) {
    if (!Number.isFinite(distanceKm)) return "Distance unknown";
    if (distanceKm < 1) return `${Math.round(distanceKm * 1000)}m away`;
    return `${distanceKm.toFixed(1)}km away`;
  }

  function displayName(f) {
    return f.name || f.email || f.uniqueId || f.id || f._id || "Unknown friend";
  }

  function formatLastSeenText(minutesAgo) {
    if (!Number.isFinite(minutesAgo)) return "";
    if (minutesAgo < 1) return " • seen just now";
    if (minutesAgo < 60) return ` • seen ${Math.round(minutesAgo)}m ago`;
    const hours = Math.floor(minutesAgo / 60);
    if (hours < 24) return ` • seen ${hours}h ago`;
    const days = Math.floor(hours / 24);
    return ` • seen ${days}d ago`;
  }

  function createInviteModal() {
    const backdrop = document.createElement("div");
    backdrop.className = "suggestion-modal-backdrop hidden";
    const body = document.createElement("div");
    body.className = "suggestion-modal";
    backdrop.appendChild(body);
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) backdrop.classList.add("hidden");
    });
    document.body.appendChild(backdrop);
    return { backdrop, body };
  }

  async function suggestPage(suggestion = {}) {
    if (!context) {
      await fetchSuggestions(true);
    }
    const friend =
      suggestion.data?.userId && lookupFriendById(suggestion.data.userId);
    const candidates = friend ? [friend] : getAvailableFriendsSorted();
    showInviteUI(
      {
        type: "page_friend",
        label: suggestion.label || "Page friend",
        detail: suggestion.detail || suggestion.reason || "AI suggestion",
      },
      candidates,
    );
  }

  return { fetchSuggestions, setHandlers, suggestPage };
})();
