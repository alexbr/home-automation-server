'use strict';

import { join } from 'path';
import settings from '../../settings.js';
import allPlayerAnnouncement from '../helpers/all-player-announcement.js';
import fileDuration from '../helpers/file-duration.js';

let port;

const LOCAL_PATH_LOCATION = join(settings.webroot, 'clips');

async function playClipOnAll(player, values) {
  const clipFileName = values[0];
  let announceVolume = settings.announceVolume || 40;

  if (/^\d+$/i.test(values[1])) {
    // first parameter is volume
    announceVolume = values[1];
  }

  const duration = await fileDuration(join(LOCAL_PATH_LOCATION, clipFileName));
  return allPlayerAnnouncement(player.system,
    `http://${player.system.localEndpoint}:${port}/clips/${clipFileName}`, announceVolume, duration);
}

export default function(api) {
  port = api.getPort();
  api.registerAction('clipall', playClipOnAll);
}
