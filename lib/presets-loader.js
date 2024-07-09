"use strict";

import { readdirSync, statSync, watch } from 'fs';
import { inspect } from 'util';
import { join } from 'path';
import { warn, debug, info } from './logger.js';
import tryLoadJson from './helpers/try-load-json.js';
import settings from '../settings.js';
import dirname from './helpers/dirname.js';

const dirName = dirname(import.meta.url);

const PRESETS_PATH = settings.presetDir;
const PRESETS_FILENAME = `${dirName}/../presets.json`;
const presets = {};

function readPresetsFromDir(presets, presetPath) {
  let files;
  try {
    files = readdirSync(presetPath);
  } catch (e) {
    warn(`Could not find dir ${presetPath}`);
    return;
  }

  files.map((name) => {
    let fullPath = join(presetPath, name);
    return {
      name,
      fullPath,
      stat: statSync(fullPath)
    };
  }).filter((file) => {
    return !file.stat.isDirectory() && !file.name.startsWith('.') && file.name.endsWith('.json');
  }).forEach((file) => {
    const presetName = file.name.replace(/\.json/i, '');
    const preset = tryLoadJson(file.fullPath);
    if (Object.keys(preset).length === 0) {
      warn(`could not parse preset file ${file.name}, please make sure syntax conforms with JSON5.`);
      return;
    }

    presets[presetName] = preset;
  });
}

async function readPresetsFromFile(presets, filename) {
  try {
    const presetStat = statSync(filename);
    if (!presetStat.isFile()) {
      return;
    }

    const filePresets = await import(filename);
    Object.keys(filePresets).forEach(presetName => {
      presets[presetName] = filePresets[presetName];
    });

    warn('You are using a presets.json file! ' +
      'Consider migrating your presets into the presets/ ' +
      'folder instead, and enjoy auto-reloading of presets when you change them');
  } catch (err) {
    debug(`no presets.json file exists, skipping`);
  }
}

async function initPresets() {
  Object.keys(presets).forEach(presetName => {
    delete presets[presetName];
  });
  await readPresetsFromFile(presets, PRESETS_FILENAME);
  readPresetsFromDir(presets, PRESETS_PATH);

  info('Presets loaded:', inspect(presets, { depth: null }));

}

await initPresets();
let watchTimeout;
try {
  watch(PRESETS_PATH, { persistent: false }, () => {
    clearTimeout(watchTimeout);
    watchTimeout = setTimeout(initPresets, 200);
  });
} catch (e) {
  warn(`Could not start watching dir ${PRESETS_PATH}, will not auto reload any presets. Make sure the dir exists`);
  warn(e.message);
}

export default presets;
