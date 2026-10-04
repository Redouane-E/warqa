// Drawing helpers offered to third-party component packs (window.Warqa.kit and the pack setup's W.kit).
import { clamp, h, num, rich, svg, svgLabel, svgText, textWidth } from './dom.js';
import { COLORS, color, MATH_SIZE, mix, TEXT_SIZE } from './theme.js';
import { applyHtml, applySvg } from './views/apply.js';

export const kit = {
  h,
  svg,
  svgLabel,
  svgText,
  textWidth,
  rich,
  num,
  clamp,
  COLORS,
  color,
  mix,
  TEXT_SIZE,
  MATH_SIZE,
  applyHtml,
  applySvg,
};
