"use client";

import { useEffect, useMemo } from "react";
import L from "leaflet";
import { MapContainer, Marker, Popup, TileLayer, useMap, useMapEvents } from "react-leaflet";

import type { Coordinate } from "@/lib/types";

type DraggablePinMapProps = {
  location: Coordinate;
  onLocationChange: (location: Coordinate) => void;
  className?: string;
};

const markerIcon = new L.Icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
});

function ClickHandler({ onPick }: { onPick: (location: Coordinate) => void }) {
  useMapEvents({
    click(event) {
      onPick({ lat: event.latlng.lat, lng: event.latlng.lng });
    },
  });
  return null;
}

function RecenterMap({ location }: { location: Coordinate }) {
  const map = useMap();
  useEffect(() => {
    map.setView([location.lat, location.lng], map.getZoom(), { animate: true });
  }, [location.lat, location.lng, map]);
  return null;
}

export function DraggablePinMap({
  location,
  onLocationChange,
  className,
}: DraggablePinMapProps) {
  const isClient = typeof window !== "undefined";

  const markerPosition = useMemo(
    () => [location.lat, location.lng] as [number, number],
    [location],
  );

  if (!isClient) {
    return (
      <div
        className={`h-56 w-full rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] ${className ?? ""}`}
      >
        <div className="flex h-full items-center justify-center text-xs text-[var(--text-muted)]">
          Loading map...
        </div>
      </div>
    );
  }

  return (
    <div
      className={`h-56 w-full overflow-hidden rounded-xl border border-[var(--border)] ${className ?? ""}`}
    >
      <MapContainer center={markerPosition} zoom={13} className="h-full w-full" scrollWheelZoom>
        <RecenterMap location={location} />
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <ClickHandler onPick={onLocationChange} />
        <Marker
          position={markerPosition}
          icon={markerIcon}
          draggable
          eventHandlers={{
            dragend: (event) => {
              const next = event.target.getLatLng();
              onLocationChange({ lat: next.lat, lng: next.lng });
            },
          }}
        >
          <Popup>Drag pin or tap map to adjust location.</Popup>
        </Marker>
      </MapContainer>
    </div>
  );
}
