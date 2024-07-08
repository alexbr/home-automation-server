'use strict';
import { createHash } from 'crypto';
import { accessSync, R_OK, createWriteStream } from 'fs';
import { request } from 'http';
import { resolve as _resolve } from 'path';
import fileDuration from '../../helpers/file-duration.js';
import settings from '../../../settings.js';
import { info } from '../../logger.js';

async function google(phrase, language) {
  if (!language) {
    language = 'en';
  }

  // Use Google tts translation service to create a mp3 file

  // Construct a filesystem neutral filename
  const phraseHash = createHash('sha1').update(phrase).digest('hex');
  const filename = `google-${phraseHash}-${language}.mp3`;
  const filepath = _resolve(settings.webroot, 'tts', filename);

  const expectedUri = `/tts/${filename}`;
  try {
    accessSync(filepath, R_OK);
    const duration = await fileDuration(filepath);
    return {
      duration,
      uri: expectedUri
    };
  } catch (err) {
    info(`announce file for phrase "${phrase}" does not seem to exist, downloading`);
  }

  await new Promise((resolve, reject) => {
    const file = createWriteStream(filepath);
    const options = {
      "headers": { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/47.0.2526.106 Safari/537.36" },
      "host": "translate.google.com",
      "path": "/translate_tts?client=tw-ob&tl=" + language + "&q=" + encodeURIComponent(phrase)
    };
    const callback = function(response_1) {
      if (response_1.statusCode < 300 && response_1.statusCode >= 200) {
        response_1.pipe(file);
        file.on('finish', function() {
          file.end();
          resolve(expectedUri);
        });
      } else {
        reject(new Error(`Download from google TTS failed with status ${response_1.statusCode}, ${response_1.message}`));

      }
    };

    request(options, callback).on('error', function(err_1) {
      reject(err_1);
    }).end();
  });
  return {
    duration,
    uri: expectedUri
  };
}

export default google;
