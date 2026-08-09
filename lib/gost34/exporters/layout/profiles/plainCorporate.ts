import { LayoutProfile } from '../types';

export const PLAIN_CORPORATE_LAYOUT: LayoutProfile = {
  id: 'plain-corporate',
  name: 'Минималистичный корпоративный стиль',
  description: 'Простое лаконичное оформление для внутренних документов и черновиков согласования',
  showEskdFrames: false,
  margins: {
    topMm: 20,
    bottomMm: 20,
    leftMm: 20,
    rightMm: 20,
  },
  fontFamily: 'Arial',
  fontSizePt: 12,
  includeTOC: true,
  tableHeaderBgColor: 'E5E7EB',
};
