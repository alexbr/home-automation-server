'use strict';

import { existsSync, mkdirSync, readFileSync } from 'fs';
import { resolve } from 'path';
import logger from './lib/logger.js';
import dirname from './lib/helpers/dirname.js';

function merge(target, source) {
  Object.keys(source).forEach((key) => {
    if ((Object.getPrototypeOf(source[key]) === Object.prototype)
      && (target[key] !== undefined)) {
      merge(target[key], source[key]);
    } else {
      target[key] = source[key];
    }
  });
}

const dirName = dirname(import.meta.url);
var settings = {
  port: 5005,
  securePort: 5006,
  cacheDir: resolve(dirName, 'cache'),
  webroot: resolve(dirName, 'static'),
  presetDir: resolve(dirName, 'presets'),
  announceVolume: 40
};

// Load user settings
const settingsJson = resolve(dirName, 'settings.json');
logger.info(`trying to load ${settingsJson}`);
try {
  const userSettings = JSON.parse(readFileSync(settingsJson, 'utf8'));
  merge(settings, userSettings);
} catch (err) {
  logger.warn(`error loading ${settingsJson}, will use default settings`, err);
}

if (!existsSync(settings.webroot + '/tts/')) {
  mkdirSync(settings.webroot + '/tts/');
}

if (!existsSync(settings.cacheDir)) {
  try {
    mkdirSync(settings.cacheDir);
  } catch (err) {
    logger.warn(`Could not create cache directory ${settings.cacheDir}, please create it manually for all features to work.`);
  }
}

export default settings;
