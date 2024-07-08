'use strict';

import { join } from 'path';
import fileDuration from '../helpers/file-duration.js';
import settings from '../../settings.js';
import singlePlayerAnnouncement from '../helpers/single-player-announcement.js';

let port;

const LOCAL_PATH_LOCATION = join(settings.webroot, 'clips');

function playClip(player, values) {
  const clipFileName = values[0];
  let announceVolume = settings.announceVolume || 40;

  if (/^\d+$/i.test(values[1])) {
    // first parameter is volume
    announceVolume = values[1];
  }

  return fileDuration(join(LOCAL_PATH_LOCATION, clipFileName))
    .then((duration) => {
      return singlePlayerAnnouncement(player, `http://${player.system.localEndpoint}:${port}/clips/${clipFileName}`, announceVolume, duration);
    });
}

export default function(api) {
  port = api.getPort();
  api.registerAction('clip', playClip);
}
