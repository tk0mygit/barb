// Public lake locations. Metres in world XZ; independent of scene geometry.
export const FISHING_SPOTS = Object.freeze([
  Object.freeze({ id: 'north-water', name: '北の沖', x: 0, z: -65, radius: 20, hitMultiplier: 1.5 }),
  Object.freeze({ id: 'west-water', name: '西の静水域', x: -75, z: 15, radius: 20, hitMultiplier: 1.5 }),
  Object.freeze({ id: 'east-water', name: '東の沖合', x: 70, z: -35, radius: 20, hitMultiplier: 1.5 }),
]);
