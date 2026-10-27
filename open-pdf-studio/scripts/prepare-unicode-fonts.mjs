// Licensed fixtures only; URLs and SHA-256 pins are recorded in unicode-fonts.json.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
const destination=process.env.OPS_UNICODE_FONT_DIR;
if(!destination) throw new Error('Set OPS_UNICODE_FONT_DIR to a fixture cache outside the checkout');
const assets=JSON.parse(await readFile(new URL('./unicode-fonts.json',import.meta.url),'utf8'));
await mkdir(destination,{recursive:true});
for(const a of assets) {
 const file=path.join(destination,a.name);let bytes;
 try {bytes=await readFile(file);} catch {}
 const hash=b=>createHash('sha256').update(b).digest('hex');
 if(!bytes || hash(bytes)!==a.sha256) {
  const response=await fetch(a.source);if(!response.ok)throw new Error(`Download ${a.name}: ${response.status}`);
  bytes=new Uint8Array(await response.arrayBuffer());
  if(hash(bytes)!==a.sha256)throw new Error(`Checksum mismatch: ${a.name}`);
  await writeFile(file,bytes);
 }
 console.log(`Verified ${a.name}`);
}
