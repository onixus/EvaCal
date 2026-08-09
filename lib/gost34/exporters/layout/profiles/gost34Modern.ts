import { LayoutProfile } from '../types';

export const GOST34_MODERN_LAYOUT: LayoutProfile = {
  id: 'gost34-modern',
  name: 'ГОСТ 34 — Современный стиль (без штампов ЕСКД)',
  description: 'Современное аккуратное корпоративное оформление по ГОСТ 34.602-2020 без устаревших чертежных рамок ЕСКД',
  showEskdFrames: false,
  margins: {
    topMm: 20,
    bottomMm: 20,
    leftMm: 25,
    rightMm: 15,
  },
  fontFamily: 'Times New Roman',
  fontSizePt: 14,
  includeTOC: true,
  tableHeaderBgColor: 'F2F4F8',
};
