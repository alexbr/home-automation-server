'use strict';
import tryDownloadTTS from '../helpers/try-download-tts.js';
import presetAnnouncement from '../helpers/preset-announcement.js';
import presets from '../presets-loader.js';

let port;

function sayPreset(player, values) {
  let text;
  const presetName = decodeURIComponent(values[0]);

  const preset = presets[presetName];

  if (!preset) {
    return Promise.reject(new Error(`No preset named ${presetName} could be found`));
  }

  try {
    text = decodeURIComponent(values[1]);
  } catch (err) {
    if (err instanceof URIError) {
      err.message = `The encoded phrase ${values[0]} could not be URI decoded. Make sure your url encoded values (%xx) are within valid ranges. xx should be hexadecimal representations`;
    }
    return Promise.reject(err);
  }

  const language = values[2];

  return tryDownloadTTS(text, language)
    .then((result) => {
      return presetAnnouncement(player.system, `http://${player.system.localEndpoint}:${port}${result.uri}`, preset, result.duration);
    })

}

export default function(api) {
  port = api.getPort();
  api.registerAction('saypreset', sayPreset);
};
