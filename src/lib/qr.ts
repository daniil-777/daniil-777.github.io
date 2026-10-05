import QRCode from 'qrcode';

/**
 * Quiet zone around the code, in modules. The QR specification asks for four;
 * with two, stricter decoders failed to find the code at all.
 */
const MARGIN = 4;

/** Corner radius of a data module, as a fraction of its size. */
const MODULE_RADIUS = 0.32;

/**
 * Renders a QR code as an inline SVG with softly rounded data modules.
 *
 * Two things are deliberately left plain, because each was measured to break
 * decoding when styled:
 * - the three finder patterns in the corners are true squares (rounding them
 *   made strict decoders miss the code at card size);
 * - colours are fixed, dark on white, in both light and dark themes.
 */
export function qrSvg(text: string): string {
  const { modules } = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const n = modules.size;
  const size = n + MARGIN * 2;
  const inFinder = (r: number, c: number) => (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);

  let dots = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!modules.get(r, c) || inFinder(r, c)) continue;
      dots += `<rect x="${c + MARGIN}" y="${r + MARGIN}" width="1" height="1" rx="${MODULE_RADIUS}"/>`;
    }
  }

  // A 7×7 square ring, one module thick, around a solid 3×3 square.
  const finder = (r: number, c: number) => {
    const x = c + MARGIN;
    const y = r + MARGIN;
    return (
      `<path fill-rule="evenodd" d="M${x} ${y}h7v7h-7zM${x + 1} ${y + 1}v5h5v-5z"/>` +
      `<rect x="${x + 2}" y="${y + 2}" width="3" height="3"/>`
    );
  };

  const label = text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" role="img" aria-label="QR code for ${label}">` +
    `<rect width="${size}" height="${size}" fill="#fff"/>` +
    `<g fill="#1d1d1f">${dots}${finder(0, 0)}${finder(0, n - 7)}${finder(n - 7, 0)}</g></svg>`
  );
}
