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
      const el = document.createElement("div");
      el.className = "suggestion-card";

      // Determine icon based on type
      const icon = item.type === "activity_suggestion" ? "📍" : "👋";
      const actionLabel =
        item.type === "activity_suggestion"
          ? item.actionLabel || "Invite"
          : item.actionLabel || "Go";

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
          ${item.type === "activity_suggestion" ? '<button class="small secondary edit-btn">Edit</button>' : ""}
          <button class="small secondary decline-btn" style="color: var(--color-error)">Decline</button>
        </div>
      `;

      // Wire events
      const actionBtn = el.querySelector(".action-btn");
      const editBtn = el.querySelector(".edit-btn");
      const declineBtn = el.querySelector(".decline-btn");

      const labelEl = el.querySelector(".suggestion-label");
      const detailEl = el.querySelector(".suggestion-detail");

      actionBtn.addEventListener("click", () => execute(item));

      if (editBtn) {
        editBtn.addEventListener("click", () => {
          const newDetail = prompt(
            "Edit details (e.g., change time):",
            item.detail,
          );
          if (newDetail !== null) {
            item.detail = newDetail; // Update local state
            detailEl.textContent = newDetail;
          }
        });
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
      const friend = lookupFriendById(item.data.userId);
      showInviteUI(item, friend ? [friend] : []);
    } else if (item.type === "activity_suggestion") {
      const candidates = getAvailableFriendsSorted();
      showInviteUI(item, candidates);
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

    const confidencePct = Math.round(suggestionConfidence * 100);
    const listHtml = candidates.length
      ? candidates
          .map((f, idx) => {
            const dist =
              Number.isFinite(f.distanceKm) && f.distanceKm < 1
                ? `${Math.round(f.distanceKm * 1000)}m`
                : Number.isFinite(f.distanceKm)
                  ? `${f.distanceKm.toFixed(1)}km`
                  : "distance unknown";
            return `
              <label class="invite-row">
                <input type="radio" name="invite-friend" value="${f.id}" ${idx === 0 ? "checked" : ""} />
                <div>
                  <div class="invite-name">${f.name || f.email}</div>
                  <div class="invite-meta">${dist}${f.isBusy ? " • busy" : ""}</div>
                </div>
              </label>
            `;
          })
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

    sendBtn?.addEventListener("click", () => {
      const selected = modal.body.querySelector(
        'input[name="invite-friend"]:checked',
      );
      if (!selected) return;
      const friend = candidates.find((c) => c.id === selected.value);
      if (!friend) return;
      const inviteMessage = buildInviteMessage(item);
      handlers.onPage(friend.id, inviteMessage);
      suggestionConfidence = Math.max(0.2, suggestionConfidence - 0.05);
      closeModal();
    });
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

  // Expose a helper so an AI hook can invoke a page suggestion UI directly.
  // Example: suggestionsUI.suggestPage({ label: "Page Alex", detail: "Close by", data: { userId: "<id>" } })
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
