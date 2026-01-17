window.suggestionsUI = (function () {
  const list = document.getElementById("suggestions-list");
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

      el.innerHTML = `
        <div style="margin-bottom: 8px;">
          <div style="font-weight: bold; display:flex; align-items:center; gap:8px;">
            <span>${icon}</span>
            <span class="suggestion-label">${item.label}</span>
          </div>
          <div class="suggestion-detail" style="font-size: 0.9em; color: var(--color-primary-600); margin-top:2px;">
            ${item.detail || ""}
          </div>
          <div class="muted" style="margin-top:4px; font-size: 0.8em;">${item.reason || "AI Suggested"}</div>
        </div>
        <div class="actions" style="display:flex; gap: 4px; margin-top: 8px;">
          <button class="small primary action-btn">${item.actionLabel || "Go"}</button>
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
        // Optional: Send feedback to API that this was declined
        console.log("Declined suggestion:", item);
      });

      list.appendChild(el);
    });
  }

  function execute(item) {
    console.log("Executing suggestion:", item);
    amplitudeClient.track("suggestion_clicked", {
      type: item.type,
      label: item.label,
    });

    if (item.type === "page_friend") {
      handlers.onPage(item.data.userId);
    } else if (item.type === "activity_suggestion") {
      // For activity, maybe we "page" friends with the activity details?
      const message = `Invite to ${item.label}: ${item.detail}`;
      // Basic implementation: Prompt user who to invite or just alert functionality for now
      alert(
        `Action: ${message}\n(Feature to invite multiple friends coming soon)`,
      );
    } else if (item.type === "go_available") {
      handlers.onAvailability(true);
    }
  }

  return { fetchSuggestions, setHandlers };
})();
