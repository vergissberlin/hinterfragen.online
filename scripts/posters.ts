import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import QRCode from 'qrcode';
import { mkdir, writeFile } from 'node:fs/promises';
const mm = (value: number) => (value * 72) / 25.4;
const url = 'https://hinterfragen.online';
const qr = await QRCode.toBuffer(url, {
  type: 'png',
  width: 900,
  errorCorrectionLevel: 'M',
  margin: 4,
  color: { dark: '#25382f', light: '#ffffff' },
});
await mkdir('public/downloads', { recursive: true });
for (const [size, width, height, columns, rows] of [
  ['a4', 210, 297, 2, 3],
  ['a3', 297, 420, 1, 1],
  ['a2', 420, 594, 1, 1],
] as const) {
  const doc = await PDFDocument.create(),
    page = doc.addPage([mm(width), mm(height)]);
  doc.setTitle(`Jetzt hinterfragen - ${size.toUpperCase()}`);
  doc.setAuthor('hinterfragen.online');
  const serif = await doc.embedFont(StandardFonts.TimesRoman),
    italic = await doc.embedFont(StandardFonts.TimesRomanItalic),
    sans = await doc.embedFont(StandardFonts.Helvetica);
  const image = await doc.embedPng(qr);
  const margin = mm(size === 'a4' ? 8 : 18),
    cellW = (mm(width) - margin * 2) / columns,
    cellH = (mm(height) - margin * 2) / rows;
  for (let row = 0; row < rows; row++)
    for (let col = 0; col < columns; col++) {
      const left = margin + col * cellW,
        bottom = margin + (rows - row - 1) * cellH,
        cx = left + cellW / 2;
      const card = size === 'a4',
        scale = card ? 1 : width / 210;
      const text = (
        value: string,
        y: number,
        font: typeof serif,
        fontSize: number,
        color = rgb(0.15, 0.22, 0.18),
      ) =>
        page.drawText(value, {
          x: cx - font.widthOfTextAtSize(value, fontSize) / 2,
          y,
          font,
          size: fontSize,
          color,
        });
      if (card)
        page.drawRectangle({
          x: left + mm(2),
          y: bottom + mm(2),
          width: cellW - mm(4),
          height: cellH - mm(4),
          borderWidth: 0.5,
          borderColor: rgb(0.76, 0.8, 0.73),
          borderDashArray: [3, 3],
        });
      const top = bottom + cellH;
      text('hinterfragen.', top - mm(card ? 11 : 22), serif, 13 * scale);
      text('Jetzt hinterfragen.', top - mm(card ? 23 : 49), serif, card ? 20 : 30 * scale);
      if (!card) {
        text('Man wird ja wohl noch', top - mm(68), serif, 22 * scale);
        text('fragen dürfen?', top - mm(83), italic, 26 * scale);
      }
      const qrSize = mm(card ? 33 : width * 0.39),
        qrY = card ? bottom + mm(23) : bottom + cellH * 0.27;
      page.drawImage(image, { x: cx - qrSize / 2, y: qrY, width: qrSize, height: qrSize });
      text(
        'hinterfragen.online',
        card ? bottom + mm(17) : qrY - mm(13),
        sans,
        card ? 10 : 13 * scale,
      );
      text(
        'Eine gute Frage kann etwas bewegen.',
        card ? bottom + mm(10) : qrY - mm(26),
        sans,
        card ? 7 : 9 * scale,
      );
      if (!card)
        text('Scannen. Nachdenken. Sachlich nachfragen.', bottom + mm(22), sans, 10 * scale);
    }
  await writeFile(`public/downloads/jetzt-hinterfragen-${size}.pdf`, await doc.save());
}
console.log('Druckvorlagen A4, A3 und A2 erstellt.');
