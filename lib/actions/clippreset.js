'use strict';
import { join } from 'path';
import settings from '../../settings.js';
import presetAnnouncement from '../helpers/preset-announcement.js';
import fileDuration from '../helpers/file-duration.js';
import presets from '../presets-loader.js';

let port;
const LOCAL_PATH_LOCATION = join(settings.webroot, 'clips');

function playClipOnPreset(player, values) {
  const presetName = decodeURIComponent(values[0]);
  const clipFileName = decodeURIComponent(values[1]);

  const preset = presets[presetName];

  if (!preset) {
    return Promise.reject(new Error(`No preset named ${presetName} could be found`));
  }

  return fileDuration(join(LOCAL_PATH_LOCATION, clipFileName))
    .then((duration) => {
      return presetAnnouncement(player.system, `http://${player.system.localEndpoint}:${port}/clips/${clipFileName}`, preset, duration);
    });
}

export default function(api) {
  port = api.getPort();
  api.registerAction('clippreset', playClipOnPreset);
}
