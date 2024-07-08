'use strict';

import { join } from 'path';
import requireDir from './require-dir.js';
import path from 'path';
import { fileURLToPath } from 'url';

const fileName = fileURLToPath(import.meta.url);
const dirName = path.dirname(fileName);
const providers = [];

requireDir(join(dirName, '../tts-providers'), (provider) => {
  providers.push(provider);
});

providers.push(await import('../tts-providers/default/google.js'));

function tryDownloadTTS(phrase, language) {
  let result;
  return providers.reduce((promise, provider) => {
    return promise.then(() => {
      if (result) return result;
      return provider(phrase, language)
        .then((_result) => {
          result = _result;
          return result;
        });
    });
  }, Promise.resolve());
}

export default tryDownloadTTS;
