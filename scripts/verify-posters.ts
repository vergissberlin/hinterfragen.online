import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { PDFDocument } from 'pdf-lib';
import { PNG } from 'pngjs';
import { createRequire } from 'node:module';
const jsQR: (data: Uint8ClampedArray, width: number, height: number) => { data: string } | null =
  createRequire(import.meta.url)('jsqr');
const temporary = await mkdtemp(resolve(tmpdir(), 'hf-posters-'));
try {
  for (const [size, width, height, columns, rows] of [
    ['a4', 210, 297, 2, 3],
    ['a3', 297, 420, 1, 1],
    ['a2', 420, 594, 1, 1],
  ] as const) {
    const input = `public/downloads/jetzt-hinterfragen-${size}.pdf`,
      pdf = await PDFDocument.load(await readFile(input));
    if (pdf.getPageCount() !== 1) throw new Error('Unerwartete Seitenzahl.');
    const page = pdf.getPage(0);
    if (
      Math.abs((page.getWidth() * 25.4) / 72 - width) > 0.1 ||
      Math.abs((page.getHeight() * 25.4) / 72 - height) > 0.1
    )
      throw new Error('Falsches Papierformat.');
    const output = resolve(temporary, size);
    execFileSync('pdftoppm', ['-scale-to', '1300', '-singlefile', '-png', input, output], {
      stdio: 'ignore',
    });
    const png = PNG.sync.read(await readFile(output + '.png')),
      w = Math.floor(png.width / columns),
      h = Math.floor(png.height / rows);
    for (let row = 0; row < rows; row++)
      for (let col = 0; col < columns; col++) {
        const crop = new PNG({ width: w, height: h });
        PNG.bitblt(png, crop, col * w, row * h, w, h, 0, 0);
        const code = jsQR(new Uint8ClampedArray(crop.data), w, h);
        if (code?.data !== 'https://hinterfragen.online')
          throw new Error('QR-Code nicht lesbar oder falsches Ziel.');
      }
    console.log(`${size.toUpperCase()}: Maße und ${rows * columns} QR-Codes geprüft.`);
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}
