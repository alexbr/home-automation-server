'use strict';
import { createHash } from 'crypto';
import { accessSync, R_OK, createWriteStream, unlink } from 'fs';
import { get } from 'http';
import { resolve as _resolve } from 'path';
import fileDuration from '../helpers/file-duration.js';
import settings from '../../settings.js';

async function voicerss(phrase, language) {
  if (!settings.voicerss) {
    return Promise.resolve();

  }

  if (!language) {
    language = 'en-gb';
  }
  // Use voicerss tts translation service to create a mp3 file
  const ttsRequestUrl = `http://api.voicerss.org/?key=${settings.voicerss}&f=22khz_16bit_mono&hl=${language}&src=${encodeURIComponent(phrase)}`;

  // Construct a filesystem neutral filename
  const phraseHash = createHash('sha1').update(phrase).digest('hex');
  const filename = `voicerss-${phraseHash}-${language}.mp3`;
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
    console.log(`announce file for phrase "${phrase}" does not seem to exist, downloading`);
  }

  await new Promise((resolve, reject) => {
    var file = createWriteStream(filepath);
    get(ttsRequestUrl, function(response) {
      if (response.statusCode < 300 && response.statusCode >= 200) {
        response.pipe(file);
        file.on('finish', function() {
          file.end();
          resolve(expectedUri);
        });
      } else {
        reject(new Error(`Download from voicerss failed with status ${response.statusCode}, ${response.message}`));

      }
    }).on('error', function(err_1) {
      unlink(dest);
      reject(err_1);
    });
  });
  return {
    duration,
    uri: expectedUri
  };
}

export default voicerss;
