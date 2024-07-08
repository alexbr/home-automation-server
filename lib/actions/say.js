'use strict';
import tryDownloadTTS from '../helpers/try-download-tts.js';
import singlePlayerAnnouncement from '../helpers/single-player-announcement.js';
import settings from '../../settings.js';

let port;
let system;

function say(player, values) {
  let text;
  try {
    text = decodeURIComponent(values[0]);
  } catch (err) {
    if (err instanceof URIError) {
      err.message = `The encoded phrase ${values[0]} could not be URI decoded. Make sure your url encoded values (%xx) are within valid ranges. xx should be hexadecimal representations`;
    }
    return Promise.reject(err);
  }
  let announceVolume;
  let language;

  if (/^\d+$/i.test(values[1])) {
    // first parameter is volume
    announceVolume = values[1];
    // language = 'en-gb';
  } else {
    language = values[1];
    announceVolume = values[2] || settings.announceVolume || 40;
  }

  return tryDownloadTTS(text, language)
    .then((result) => {
      return singlePlayerAnnouncement(player, `http://${system.localEndpoint}:${port}${result.uri}`, announceVolume, result.duration);
    });
}

export default function(api) {
  port = api.getPort();
  api.registerAction('say', say);

  system = api.discovery;
}
