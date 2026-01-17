window.mapUI = (function () {
  const map = L.map("map", {
    zoomControl: false,
    attributionControl: false,
  }).setView([43.6532, -79.3832], 12);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap",
  }).addTo(map);

  const markers = new Map();

  function getPopupContent(p) {
    const name = p.name || p.email || "Unknown";
    const initial = name.charAt(0).toUpperCase();
    const busyTag = p.isBusy
      ? '<br><span style="color:red; font-size: 0.8em;">Busy (DND)</span>'
      : "";

    let avatarHtml = "";
    if (p.profilePicture) {
      avatarHtml = `<img src="/uploads/${p.profilePicture}" style="width: 32px; height: 32px; border-radius: 50%; object-fit: cover; margin-right: 8px;">`;
    } else {
      avatarHtml = `<div style="width: 32px; height: 32px; border-radius: 50%; background: #ccc; color: #fff; display: flex; align-items: center; justify-content: center; font-weight: bold; margin-right: 8px;">${initial}</div>`;
    }

    return `
      <div style="display: flex; align-items: center;">
        ${avatarHtml}
        <div>
          <strong>${name}</strong>
          ${busyTag}
        </div>
      </div>
    `;
  }

  function updateMarkers(presences) {
    const seen = new Set();
    presences.forEach((p) => {
      if (!p.lat || !p.lon) return;
      seen.add(String(p.userId));

      const color = p.isBusy ? "#ea580c" : "#3b82f6"; // Orange-600 : Blue-500

      const popupContent = getPopupContent(p);

      if (!markers.has(String(p.userId))) {
        const marker = L.circleMarker([p.lat, p.lon], {
          radius: 8,
          fillColor: color,
          color: "#ffffff",
          weight: 2,
          opacity: 1,
          fillOpacity: 1,
        }).addTo(map);
        marker.bindPopup(popupContent);
        markers.set(String(p.userId), marker);
      } else {
        const marker = markers.get(String(p.userId));
        marker.setLatLng([p.lat, p.lon]);
        marker.setStyle({ fillColor: color });
        marker.bindPopup(popupContent);
      }
    });
    Array.from(markers.keys()).forEach((id) => {
      if (id === "me") return; // Don't remove local marker
      if (!seen.has(id)) {
        const marker = markers.get(id);
        map.removeLayer(marker);
        markers.delete(id);
      }
    });
  }

  function centerOn(lat, lon) {
    map.setView([lat, lon], 14);
  }

  function updateMyMarker(lat, lon, isSharing, isBusy = false) {
    if (!map) return;
    let color = "#64748b"; // Gray (Hidden)
    if (isSharing) {
      color = isBusy ? "#ea580c" : "#3b82f6"; // Orange : Blue
    }

    const me = window.orbitUser || { firstName: "You" };
    const myPopupContent = getPopupContent({
      name: (me.firstName + " " + (me.lastName || "")).trim() || "You",
      email: me.email,
      profilePicture: me.profilePicture, // Ensure this is available in orbitUser
      isBusy: isBusy,
    });

    if (!markers.has("me")) {
      const marker = L.circleMarker([lat, lon], {
        radius: 8,
        fillColor: color,
        color: "#9333ea", // Theme Purple (accent-600)
        weight: 3,
        opacity: 1,
        fillOpacity: 1,
        zIndexOffset: 1000,
      }).addTo(map);
      marker.bindPopup(myPopupContent);
      markers.set("me", marker);
    } else {
      const marker = markers.get("me");
      marker.setLatLng([lat, lon]);
      marker.setStyle({ fillColor: color, color: "#9333ea" });
      marker.bindPopup(myPopupContent);
    }
  }

  return { updateMarkers, centerOn, updateMyMarker, map };
})();
