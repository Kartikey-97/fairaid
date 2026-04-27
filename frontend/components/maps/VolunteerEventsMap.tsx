"use client";

import { useMemo } from "react";
import L from "leaflet";
import { MapContainer, Marker, Popup, TileLayer, Tooltip } from "react-leaflet";

import type { VolunteerNeedCard } from "@/lib/types";

type VolunteerEventsMapProps = {
  items: VolunteerNeedCard[];
  className?: string;
};

const iconBase = {
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png",
  iconSize: [25, 41] as [number, number],
  iconAnchor: [12, 41] as [number, number],
  popupAnchor: [1, -34] as [number, number],
  shadowSize: [41, 41] as [number, number],
};

const emergencyIcon = new L.Icon({
  iconUrl: "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png",
  ...iconBase,
});

const nearbyIcon = new L.Icon({
  iconUrl: "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png",
  ...iconBase,
});

const otherIcon = new L.Icon({
  iconUrl: "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png",
  ...iconBase,
});

function toTimeLabel(value?: string): string {
  if (!value) {
    return "--:--";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value.slice(11, 16);
  }
  return parsed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

export function VolunteerEventsMap({ items, className }: VolunteerEventsMapProps) {
  const mapItems = useMemo(
    () => items.filter((item) => Boolean(item.need_location?.lat && item.need_location?.lng)),
    [items],
  );

  const center = useMemo<[number, number]>(() => {
    if (!mapItems.length) {
      return [28.6139, 77.209];
    }
    const latAvg = mapItems.reduce((sum, item) => sum + (item.need_location?.lat ?? 0), 0) / mapItems.length;
    const lngAvg = mapItems.reduce((sum, item) => sum + (item.need_location?.lng ?? 0), 0) / mapItems.length;
    return [latAvg, lngAvg];
  }, [mapItems]);

  return (
    <div className={`h-72 w-full overflow-hidden rounded-xl border border-[var(--border)] ${className ?? ""}`}>
      <MapContainer center={center} zoom={10.5} className="h-full w-full" scrollWheelZoom>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {mapItems.map((item) => {
          const location = item.need_location;
          if (!location) {
            return null;
          }

          const icon = item.emergency_level === "emergency"
            ? emergencyIcon
            : item.within_distance && item.recommendation_score >= 0.5
              ? nearbyIcon
              : otherIcon;

          return (
            <Marker key={item.need_id} position={[location.lat, location.lng]} icon={icon}>
              <Tooltip direction="top" offset={[0, -12]} sticky>
                <div className="text-xs">
                  <p className="font-semibold">{item.title}</p>
                  <p>{item.ngo_name}</p>
                  <p>{item.distance_km} km • {Math.round(item.recommendation_score * 100)}% match</p>
                </div>
              </Tooltip>
              <Popup>
                <div className="space-y-1 text-xs">
                  <p className="text-sm font-bold">{item.title}</p>
                  <p>{item.ngo_name}</p>
                  <p>{item.need_type}</p>
                  <p>Distance: {item.distance_km} km</p>
                  <p>Shift: {toTimeLabel(item.shift_start)} - {toTimeLabel(item.shift_end)}</p>
                  <p>Need: {item.required_volunteers} • Accepted: {item.accepted_count}</p>
                  <p>Address: {item.need_address ?? "Not shared"}</p>
                </div>
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>
    </div>
  );
}
