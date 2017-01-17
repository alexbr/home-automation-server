'use strict';

const fs = require('fs');
const path = require('path');

function merge(target, source) {
  Object.keys(source).forEach((key) => {
    if ((Object.getPrototypeOf(source[key]) === Object.prototype) && (target[key] !== undefined)) {
      merge(target[key], source[key]);
    } else {
      target[key] = source[key];
    }
  });
}

var settings = {
  port: 5005,
  securePort: 5006,
  cacheDir: path.resolve(__dirname, 'cache'),
  webroot: path.resolve(__dirname, 'static'),
  presetDir: path.resolve(__dirname, 'presets'),
  announceVolume: 40
};

// load user settings
try {
  const userSettings = require(path.resolve(__dirname, 'settings.json'));
  merge(settings, userSettings);
} catch (e) {
  console.log('no settings file found, will only use default settings');
}

console.log(settings);

if (!fs.existsSync(settings.webroot + '/tts/')) {
  fs.mkdirSync(settings.webroot + '/tts/');
}

if (!fs.existsSync(settings.cacheDir)) {
  try {
    fs.mkdirSync(settings.cacheDir);
  } catch (err) {
    console.warn(`Could not create cache directory ${settings.cacheDir}, please create it manually for all features to work.`);
  }
}

module.exports = settings;
