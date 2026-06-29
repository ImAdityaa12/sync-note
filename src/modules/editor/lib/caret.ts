export interface CaretRect {
  /** Offset from the textarea's top border, in px (scroll already applied). */
  top: number;
  /** Offset from the textarea's left border, in px (scroll already applied). */
  left: number;
  /** Caret height in px (one line). */
  height: number;
}

// Layout-affecting properties copied onto a hidden mirror so a caret index can
// be measured at the exact pixel the textarea would paint it. (A native textarea
// exposes no API for this — mirroring is the standard technique.)
const MIRRORED_PROPS = [
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "font-style",
  "font-variant",
  "font-weight",
  "font-stretch",
  "font-size",
  "line-height",
  "font-family",
  "text-align",
  "text-transform",
  "text-indent",
  "letter-spacing",
  "word-spacing",
  "tab-size",
  "word-break",
];

/**
 * Pixel position of `index` within a textarea's content, relative to the
 * textarea's top-left border and accounting for current scroll. Used to overlay
 * remote collaborators' carets onto our own editor.
 */
export function caretRectAt(
  textarea: HTMLTextAreaElement,
  index: number
): CaretRect {
  const cs = window.getComputedStyle(textarea);
  const padX =
    (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);

  const mirror = document.createElement("div");
  mirror.style.cssText =
    MIRRORED_PROPS.map((p) => `${p}:${cs.getPropertyValue(p)}`).join(";") +
    ";position:absolute;top:0;left:-9999px;visibility:hidden;overflow:hidden" +
    ";box-sizing:content-box;white-space:pre-wrap;word-wrap:break-word" +
    `;width:${Math.max(0, textarea.clientWidth - padX)}px`;

  // Text up to the caret, then a marker span whose box is the caret position.
  mirror.textContent = textarea.value.slice(0, index);
  const marker = document.createElement("span");
  marker.textContent = textarea.value.slice(index) || "."; // non-empty at line end
  mirror.appendChild(marker);
  document.body.appendChild(mirror);

  const borderTop = parseFloat(cs.borderTopWidth) || 0;
  const borderLeft = parseFloat(cs.borderLeftWidth) || 0;
  const rect: CaretRect = {
    top: marker.offsetTop + borderTop - textarea.scrollTop,
    left: marker.offsetLeft + borderLeft - textarea.scrollLeft,
    height: parseFloat(cs.lineHeight) || (parseFloat(cs.fontSize) || 14) * 1.4,
  };

  document.body.removeChild(mirror);
  return rect;
}
