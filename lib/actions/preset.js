'use strict';

import presets from '../presets-loader.js';
import logger from '../logger.js';

function presetsAction(player, values) {
  const value = decodeURIComponent(values[0]);
  let preset;
  if (value.startsWith('{')) {
    preset = JSON.parse(value);
  } else {
    preset = presets[value];
  }

  logger.info(`got preset ${preset}`);

  if (preset) {
    return player.system.applyPreset(preset);
  } else {
    const simplePresets = Object.keys(presets);
    return Promise.resolve(simplePresets);
  }
}

export default function(api) {
  api.registerAction('preset', presetsAction);
};
