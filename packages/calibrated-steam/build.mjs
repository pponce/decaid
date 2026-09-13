import { readFile, mkdir, writeFile } from 'node:fs/promises';

const root = new URL('./', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('manifest.src.json', root), 'utf8'));
const core = (await readFile(new URL('src/core.mjs', root), 'utf8')).replace(/^export /gm, '');
const navigation = (await readFile(new URL('src/settings-navigation.mjs', root), 'utf8')).replace(/^export /gm, '');
const calibration = (await readFile(new URL('src/calibration-session.mjs', root), 'utf8')).replace(/^export /gm, '');
const guided = await readFile(new URL('src/calibration-page.js', root), 'utf8');
const page = await readFile(new URL('src/settings-page.js', root), 'utf8');
const runtime = await readFile(new URL('src/plugin-runtime.js', root), 'utf8');
const output = new URL('../../assets/plugins/calibrated-steam.reaplugin/', root);
await mkdir(output, { recursive: true });
await writeFile(new URL('manifest.json', output), JSON.stringify(manifest, null, 2) + '\n');
await writeFile(new URL('plugin.js', output), `/* Calibrated Steam Timer. GPL-3.0-only. Inspired by Damian / Damian-AU, DSx2. */\n(function () {\n"use strict";\nconst MANIFEST = ${JSON.stringify(manifest)};\n${core}\n${navigation}\n${calibration}\n${guided}\n${page}\n${runtime}\n})();\n`);
