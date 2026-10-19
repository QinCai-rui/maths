// Slip geometry shared by the PDF exporter, the HTML print preview and the editor's
// on-screen proof. Kept free of imports so the editor can load it eagerly.

export const SLIP_GEOMETRY = {
  pageWidthMm: 210,
  pageHeightMm: 297,
  /** Distance of the solid binding rule from the left page edge. */
  bindingMm: 10,
  /** Padding inside each slip. The right padding is measured from the cut line, so the
   * full right padding is `cutMargin + contentPaddingMm.right`. */
  contentPaddingMm: { top: 4, right: 5, bottom: 3, left: 16 },
  /** The "QUESTION 3" label above the slip text. */
  label: { sizePt: 7.5, gapMm: 1, letterSpacingEm: 0.08, color: "#1f6b57" },
  /** Body line height as a multiple of the text size. Lines with tall maths grow. */
  lineHeight: 1.3,
  /** Vertical space between blocks, in millimetres. */
  paragraphGapMm: 1.2,
  imageGapMm: 1,
  /** Left indent per list level, and the gap between a list marker and its text. */
  listIndentMm: 5,
  listMarkerGapMm: 1.5,
  /** Blockquote rule width (pt) and the padding between the rule and the text (mm). */
  quoteRulePt: 1.5,
  quotePaddingMm: 2,
  /** Cover title. */
  titleSizePt: 17,
  titleGapMm: 1.5
} as const;

export type SlipGeometry = typeof SLIP_GEOMETRY;
