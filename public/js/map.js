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

  function createPopupContent(p) {
    const profilePic = p.profilePicture 
      || 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="%23666" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M6 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"/></svg>';
    
    return `
      <div style="text-align: center; min-width: 120px;">
        <img src="${profilePic}" alt="${p.name}" 
             style="width: 48px; height: 48px; border-radius: 50%; object-fit: cover; margin-bottom: 8px; border: 2px solid #fff; box-shadow: 0 2px 4px rgba(0,0,0,0.2);" 
             onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2248%22 height=%2248%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%23666%22 stroke-width=%222%22><circle cx=%2212%22 cy=%228%22 r=%224%22/><path d=%22M6 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2%22/></svg>'">
        <div><strong>${p.name || p.email}</strong></div>
        ${p.isBusy ? '<div style="color: #ea580c; font-weight: 500;">Busy (DND)</div>' : ''}
      </div>
    `;
  }

  function updateMarkers(presences) {
    const seen = new Set();
    presences.forEach((p) => {
      if (!p.lat || !p.lon) return;
      seen.add(String(p.userId));

      const color = p.isBusy ? "#ea580c" : "#3b82f6"; // Orange-600 : Blue-500

      if (!markers.has(String(p.userId))) {
        const marker = L.circleMarker([p.lat, p.lon], {
          radius: 8,
          fillColor: color,
          color: "#ffffff",
          weight: 2,
          opacity: 1,
          fillOpacity: 1,
        }).addTo(map);
        
        const popupContent = createPopupContent(p);
        marker.bindPopup(popupContent);
        markers.set(String(p.userId), marker);
      } else {
        const marker = markers.get(String(p.userId));
        marker.setLatLng([p.lat, p.lon]);
        marker.setStyle({ fillColor: color });
        
        const popupContent = createPopupContent(p);
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

    if (!markers.has("me")) {
      const marker = L.circleMarker([lat, lon], {
        radius: 8,
        fillColor: color,
        color: "#ffffff",
        weight: 3,
        opacity: 1,
        fillOpacity: 1,
        zIndexOffset: 1000,
      }).addTo(map);
      marker.bindPopup("<strong>You</strong>");
      markers.set("me", marker);
    } else {
      const marker = markers.get("me");
      marker.setLatLng([lat, lon]);
      marker.setStyle({ fillColor: color });
    }
  }

  return { updateMarkers, centerOn, updateMyMarker, map };
})();
