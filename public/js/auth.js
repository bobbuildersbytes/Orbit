window.authUI = (function () {
  let currentUser = undefined;

  function setUser(u) {
    currentUser = u;
    updateUI();
  }

  function getUser() {
    return currentUser;
  }

  function updateUI() {
    const loginView = document.getElementById("login-view");
    const appView = document.getElementById("app-view");
    const userInfo = document.getElementById("user-info");

    if (currentUser) {
      loginView.classList.add("hidden");
      appView.classList.remove("hidden");
      if (userInfo) {
        userInfo.textContent = currentUser.name || currentUser.email;
      }
    } else {
      loginView.classList.remove("hidden");
      appView.classList.add("hidden");
    }
  }

  // Initial Check (can move to bootstrap)
  // But we rely on correct bootstrapping sequence in app.js

  // Logout
  document.getElementById("logout-btn")?.addEventListener("click", async () => {
    // Current Orbit uses /logout link, but we can do fetch + redirect
    window.location.href = "/logout";
  });

  document.querySelectorAll("#google-login").forEach((btn) => {
    btn.addEventListener("click", () => {
      window.location.href = "/auth/google";
    });
  });

  return { setUser, getUser };
})();
