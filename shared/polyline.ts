import type { Coordinate } from "./types";

export function decodePolyline(encoded: string): Coordinate[] {
  let index = 0,
    lat = 0,
    lng = 0;
  const points: Coordinate[] = [];
  function read() {
    let value = 0,
      shift = 0,
      byte: number;
    do {
      if (index >= encoded.length || shift > 30)
        throw new Error("Invalid route geometry.");
      byte = encoded.charCodeAt(index++) - 63;
      if (byte < 0 || byte > 63) throw new Error("Invalid route geometry.");
      value |= (byte & 31) << shift;
      shift += 5;
    } while (byte >= 32);
    return value & 1 ? ~(value >> 1) : value >> 1;
  }
  while (index < encoded.length) {
    lat += read();
    lng += read();
    if (Math.abs(lat) > 9000000 || Math.abs(lng) > 18000000)
      throw new Error("Invalid route geometry.");
    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return points;
}

export function encodePolyline(points: Coordinate[]): string {
  let previousLat = 0,
    previousLng = 0,
    encoded = "";
  function write(delta: number) {
    let value = delta < 0 ? ~(delta << 1) : delta << 1;
    while (value >= 32) {
      encoded += String.fromCharCode((32 | (value & 31)) + 63);
      value >>= 5;
    }
    encoded += String.fromCharCode(value + 63);
  }
  for (const point of points) {
    const lat = Math.round(point.lat * 1e5),
      lng = Math.round(point.lng * 1e5);
    write(lat - previousLat);
    write(lng - previousLng);
    previousLat = lat;
    previousLng = lng;
  }
  return encoded;
}
