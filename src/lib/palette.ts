// Distinguishable in both themes and reasonably colour-blind safe. Shared by
// every place that assigns a colour to a new theme or code, so codes made
// mid-coding do not look out of place next to the ones the lead created.
export const PALETTE = [
  "#2f6f5e", "#8c5a2b", "#3b5f9e", "#8a3d6b", "#6b6a2f",
  "#2e6f7a", "#94472f", "#5a4a8c", "#3f7a3f", "#7a3f52",
];

export function pickColor(index: number): string {
  return PALETTE[index % PALETTE.length];
}
