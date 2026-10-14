import { cpSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

// Worker, CMaps, fonts and decoders must come from the same installed release.
// De app vraagt ze op onder <basis>pdfjs/web/… (js/core/basis-url.js), dus
// luistert de dev-server ook onder de basis: `vite --base=/x/` werkt zo ook.
export function pdfjsAssets() {
  let root, outDir, base = '/';
  const folders = ['cmaps', 'standard_fonts', 'wasm'];
  return {
    name: 'pdfjs-assets',
    configResolved(config) {
      root = config.root;
      outDir = resolve(root, config.build.outDir);
      base = config.base?.startsWith('/') ? config.base : '/';
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
    },
  };
}
