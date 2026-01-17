window.suggestionsUI = (function () {
  const list = document.getElementById("suggestions-list");
  let handlers = {
    onPage: () => {},
    onAvailability: () => {},
  };

  function setHandlers(h) {
    handlers = { ...handlers, ...h };
  }

  async function fetchSuggestions() {
    try {
      const res = await fetch("/api/suggestions/context");
      if (!res.ok) return;
      const data = await res.json();
      render(data.suggestions || []);
    } catch (err) {
      console.error(err);
    }
  }

  function render(items) {
    if (!list) return;
    list.innerHTML = "";
    if (!items.length) {
      list.innerHTML = '<div class="muted">No suggestions right now.</div>';
      return;
    }

    items.forEach((item) => {
      // item: { type: 'page_friend' | 'go_available' | 'go_busy', label, data }
      const el = document.createElement("div");
      el.className = "suggestion-card";
      el.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center">
          <strong>${item.label}</strong>
          <button class="small">Go</button>
        </div>
        <div class="muted" style="margin-top:4px">${item.reason || "AI Suggested"}</div>
      `;
      const btn = el.querySelector("button");
      btn.addEventListener("click", () => execute(item));
      list.appendChild(el);
    });
  }

  function execute(item) {
    console.log("Executing suggestion:", item);
    amplitudeClient.track("suggestion_clicked", { type: item.type });

    if (item.type === "page_friend") {
      handlers.onPage(item.data.userId); // userId of friend
    } else if (item.type === "go_available") {
      handlers.onAvailability(true);
    } else if (item.type === "go_busy") {
      // handlers.onAvailability(true, true); // available + busy
      // Simplify for now: Just toggle presence logic in app
    }
  }

  return { fetchSuggestions, setHandlers };
})();
