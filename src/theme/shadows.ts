// ALPHA TWIN — depth is expressed with borders + translucent fills, NOT drop shadows.
// The only real shadow is the device mock frame; in-app use these sparingly.
export const shadows = {
  none: {},
  glowAccent: { shadowColor: '#22d3ee', shadowOpacity: 0.25, shadowRadius: 12, shadowOffset: { width: 0, height: 0 } },
} as const;
