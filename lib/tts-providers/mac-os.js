'use strict';
import { createHash } from 'crypto';
import { accessSync, R_OK } from 'fs';
import { resolve as _resolve } from 'path';
import fileDuration from '../helpers/file-duration.js';
import settings from '../../settings.js';
import { info } from '../logger.js';
import { exec } from 'child_process';

async function macSay(phrase, voice) {
  if (!settings.macSay) {
    return Promise.resolve();
  }

  var selcetedRate = settings.macSay.rate;
  if (!selcetedRate) {
    selcetedRate = "default";
  }
  var selectedVoice = settings.macSay.voice;
  if (voice) {
    selectedVoice = voice;
  }

  // Construct a filesystem neutral filename
  const phraseHash = createHash('sha1').update(phrase).digest('hex');
  const filename = `macSay-${phraseHash}-${selcetedRate}-${selectedVoice}.m4a`;
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
    // For more information on the "say" command, type "man say" in Terminal
    // or go to
    // https://developer.apple.com/legacy/library/documentation/Darwin/Reference/ManPages/man1/say.1.html
    //
    // The list of available voices can be configured in
    // System Preferences -> Accessibility -> Speech -> System Voice
    var execCommand = `say "${phrase}" -o ${filepath}`;
    if (selectedVoice && selcetedRate != "default") {
      execCommand = `say -r ${selcetedRate} -v ${selectedVoice} "${phrase}" -o ${filepath}`;
    } else if (selectedVoice) {
      execCommand = `say -v ${selectedVoice} "${phrase}" -o ${filepath}`;
    } else if (selcetedRate != "default") {
      execCommand = `say -r ${selcetedRate} "${phrase}" -o ${filepath}`;
    }

    exec(execCommand,
      function(error, _stdout) {
        if (error !== null) {
          reject(error);
        } else {
          resolve(expectedUri);
        }
      });

  });
  return {
    duration,
    uri: expectedUri
  };
}

export default macSay;
