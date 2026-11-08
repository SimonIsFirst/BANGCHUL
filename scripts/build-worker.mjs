import { build } from 'esbuild';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const assets = {};
const mimes = { '.html':'text/html;charset=utf-8', '.js':'text/javascript;charset=utf-8', '.css':'text/css;charset=utf-8', '.svg':'image/svg+xml', '.webp':'image/webp', '.png':'image/png', '.ico':'image/x-icon' };
async function collect(directory, prefix = '') {
  for (const entry of await readdir(directory, { withFileTypes:true })) {
    if (entry.isSymbolicLink()) throw new Error('Static assets must be regular files.');
    const name = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) await collect(path.join(directory, entry.name), name);
    else assets[name] = { mime:mimes[path.extname(name)] ?? 'application/octet-stream', body:(await readFile(path.join(directory, entry.name))).toString('base64') };
  }
}
await collect('dist/client');
await build({ entryPoints:['worker/index.ts'], outfile:'dist/server/index.js', bundle:true, platform:'browser', target:'es2023', format:'esm', minify:true, define:{ STATIC_ASSETS:JSON.stringify(assets) } });
await mkdir('dist/.openai', { recursive:true });
await writeFile('dist/.openai/hosting.json', await readFile('.openai/hosting.json'));
console.log(`Worker built with ${Object.keys(assets).length} static assets; private files are never bundled.`);
