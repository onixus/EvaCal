export type LayoutProfileId =
  "gost34-modern" | "gost34-eskd-frame" | "plain-corporate";

export interface LayoutMargin {
  topMm: number;
  bottomMm: number;
  leftMm: number;
  rightMm: number;
}

export interface LayoutProfile {
  id: LayoutProfileId;
  name: string;
  description: string;
  showEskdFrames: boolean;
  margins: LayoutMargin;
  fontFamily: string;
  fontSizePt: number;
  includeTOC: boolean;
  tableHeaderBgColor?: string;
}
