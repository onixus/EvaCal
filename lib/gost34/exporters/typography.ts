import { TextRun } from 'docx';
import type { LayoutProfile } from './layout';
import { sanitizeDocText } from './textFormat';

export type DocxTypography = ReturnType<typeof createDocxTypography>;

export function createDocxTypography(layoutProfile: LayoutProfile) {
  /**
   * Кегли берутся из профиля: базовый размер — на текст, остальное отсчитывается
   * от него, поэтому смена профиля меняет типографику целиком, а не только поля.
   */
  const font = layoutProfile.fontFamily;
  const halfPt = (deltaPt = 0) => (layoutProfile.fontSizePt + deltaPt) * 2;
  const run = (text: string, opts: { bold?: boolean; deltaPt?: number } = {}) =>
    new TextRun({
      text: sanitizeDocText(text),
      bold: opts.bold,
      font,
      size: halfPt(opts.deltaPt ?? 0),
      color: '000000',
    });

  return { font, halfPt, run };
}
