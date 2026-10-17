import { BodyModel } from './bodyModel';

/** Node/test helper: load the baked body from disk. */
export async function loadBodyFromDisk(dir = 'public/body'): Promise<BodyModel> {
  const fs = await import('node:fs/promises');
  const manifest = JSON.parse(await fs.readFile(`${dir}/body.json`, 'utf8'));
  const buf = await fs.readFile(`${dir}/body.bin`);
  return new BodyModel(manifest, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

