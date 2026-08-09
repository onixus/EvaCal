import { LayoutProfile } from "../types";

export const GOST34_ESKD_FRAME_LAYOUT: LayoutProfile = {
  id: "gost34-eskd-frame",
  name: "ГОСТ 34 — ЕСКД с рамками и штампами (ГОСТ 2.104-2006)",
  description:
    "Классическое оформление с рамками ЕСКД (Формы 2 и 2а) и увеличенным нижним отступом под штампы",
  showEskdFrames: true,
  margins: {
    topMm: 15,
    bottomMm: 45, // room for Form 2 / 2a stamps
    leftMm: 20,
    rightMm: 10,
  },
  fontFamily: "Times New Roman",
  fontSizePt: 14,
  includeTOC: false,
};
