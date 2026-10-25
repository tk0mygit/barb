// Pulse only the marker's visual radius. Keep a compact water marker near
// retrieval, where its original pulse would cover most of a portrait viewport.
export function nearRingExpansion(distance, landingDistance = 4.5) {
  return Math.max(0, Math.min(1, (distance - landingDistance) / (8 - landingDistance)));
}
