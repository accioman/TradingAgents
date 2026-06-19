// Single source of truth for colors used inside JS-rendered charts (recharts).
// Mirrors the Tailwind palette in tailwind.config.ts so SVG and CSS stay in sync.

export const palette = {
  ink900: "#0A0E1A",
  ink800: "#0E1322",
  ink700: "#121A2E",
  line: "#1E2A44",
  lineStrong: "#2C3C60",
  fg: "#E7ECF7",
  muted: "#93A1C0",
  faint: "#5C6B89",
  brass: "#F5B642",
  brassBright: "#FFC95C",
  bull: "#2BD9A4",
  bear: "#FB6F84",
  azure: "#56A8FF",
  iris: "#9B8CFF"
} as const;

// The 5-tier rating scale rendered as a diverging bull -> bear ramp.
export const RATING_ORDER = ["Buy", "Overweight", "Hold", "Underweight", "Sell"] as const;
export type Rating = (typeof RATING_ORDER)[number];

export const RATING_COLOR: Record<string, string> = {
  Buy: "#2BD9A4",
  Overweight: "#7FD957",
  Hold: "#F5B642",
  Underweight: "#FB9A4B",
  Sell: "#FB6F84"
};

// Numeric weight per rating for computing an aggregate desk bias (-1 bearish .. +1 bullish).
export const RATING_WEIGHT: Record<string, number> = {
  Buy: 1,
  Overweight: 0.5,
  Hold: 0,
  Underweight: -0.5,
  Sell: -1
};

export function ratingClass(rating?: string | null): string {
  switch ((rating ?? "").toLowerCase()) {
    case "buy":
      return "rating-pill rating-buy";
    case "overweight":
      return "rating-pill rating-overweight";
    case "hold":
      return "rating-pill rating-hold";
    case "underweight":
      return "rating-pill rating-underweight";
    case "sell":
      return "rating-pill rating-sell";
    default:
      return "rating-pill rating-na";
  }
}

export const chartGrid = "rgba(44,60,96,0.45)";
export const chartAxis = "#5C6B89";
