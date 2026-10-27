import { cpSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

// Alles in pdfjs/web/ behalve deze mappen is de oude, losse PDF.js-viewer uit
// public/ (viewer.html, viewer.mjs, debugger, plaatjes, talen). De app gebruikt
// hem niet. In de gastbundel gaat hij eruit (#695): het is een losse pagina met
// eigen scripts en een window.open, en een gastsite serveert alles wat in de
// bundel staat.
export const PDFJS_MAPPEN = ['cmaps', 'standard_fonts', 'wasm'];

/** Namen in pdfjs/web/ die de gastbundel niet meekrijgt. */
export function viewerResten(namen) {
  return namen.filter((n) => !PDFJS_MAPPEN.includes(n));
}

// Worker, CMaps, fonts and decoders must come from the same installed release.
// De app vraagt ze op onder <basis>pdfjs/web/… (js/core/basis-url.js), dus
// luistert de dev-server ook onder de basis: `vite --base=/x/` werkt zo ook.
export function pdfjsAssets() {
  let root, outDir, base = '/', gast = false;
  const folders = PDFJS_MAPPEN;
  return {
    name: 'pdfjs-assets',
    configResolved(config) {
      root = config.root;
      outDir = resolve(root, config.build.outDir);
      base = config.base?.startsWith('/') ? config.base : '/';
      gast = config.mode === 'hosted';
    },
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        for (const folder of folders) {
          const prefix = `${base}pdfjs/web/${folder}/`;
          if (req.url?.startsWith(prefix)) {
            req.url = `${base}node_modules/pdfjs-dist/${folder}/${req.url.slice(prefix.length)}`;
            break;
          }
        }
        next();
      });
    },
    writeBundle() {
      for (const folder of folders) {
        const to = resolve(outDir, 'pdfjs/web', folder);
        mkdirSync(to, { recursive: true });
        cpSync(resolve(root, 'node_modules/pdfjs-dist', folder), to, { recursive: true });
      }
      if (gast) {
        const web = resolve(outDir, 'pdfjs/web');
        for (const naam of viewerResten(readdirSync(web))) {
          rmSync(resolve(web, naam), { recursive: true, force: true });
        }
      }
    },
  };
}
