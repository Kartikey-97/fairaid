"use client";

import { useMemo } from "react";
import L from "leaflet";
import { MapContainer, Marker, Popup, TileLayer } from "react-leaflet";
import type { Coordinate, NeedRecord } from "@/lib/types";

// Dynamic loading of Leaflet CSS is handled automatically in Next.js when importing 'leaflet/dist/leaflet.css' in globals.css,
// but ensure it's available.

const emergencyIcon = new L.Icon({
  iconUrl: "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});

const normalIcon = new L.Icon({
  iconUrl: "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});

export function NeedsMap({ needs, center, className }: { needs: NeedRecord[]; center?: Coordinate; className?: string }) {
  const isClient = typeof window !== "undefined";

  // Calculate center based on first need if not provided, else default to a generic center (e.g., New Delhi for demo)
  const mapCenter = useMemo<[number, number]>(() => {
    if (center) return [center.lat, center.lng];
    if (needs.length > 0 && needs[0].location) return [needs[0].location.lat, needs[0].location.lng];
    return [28.6139, 77.2090];
  }, [center, needs]);

  if (!isClient) {
    return (
      <div className={`h-96 w-full rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] ${className ?? ""}`}>
        <div className="flex h-full items-center justify-center text-xs text-[var(--text-muted)]">
          Loading map...
        </div>
      </div>
    );
  }

  return (
    <div className={`h-96 w-full overflow-hidden rounded-xl border border-[var(--border)] ${className ?? ""}`}>
      <MapContainer center={mapCenter} zoom={11} className="h-full w-full" scrollWheelZoom>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {needs.map(need => {
          if (!need.location) return null;
          return (
            <Marker 
              key={need.id} 
              position={[need.location.lat, need.location.lng]} 
              icon={need.emergency_level === "emergency" ? emergencyIcon : normalIcon}
            >
              <Popup>
                <div className="text-sm">
                  <h3 className="font-bold text-[var(--text-strong)]">{need.title}</h3>
                  <p className="text-xs text-[var(--text-muted)] mt-1">{need.ngo_name}</p>
                  <p className="text-xs text-[var(--text-muted)]">{need.need_type.replace("-", " ")}</p>
                  <div className="mt-2 text-[10px] font-semibold text-white px-2 py-0.5 rounded-full inline-block" 
                       style={{ background: need.emergency_level === "emergency" ? "var(--accent)" : "var(--brand)" }}>
                    {need.emergency_level === "emergency" ? "Emergency" : "Standard"}
                  </div>
                </div>
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>
    </div>
  );
}
