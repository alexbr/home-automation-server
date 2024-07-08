'use strict';

import { createHash } from 'crypto';
import { accessSync, R_OK, writeFileSync } from 'fs';
import { resolve } from 'path';
import Polly from 'aws-sdk';
import fileDuration from '../helpers/file-duration.js';
import settings from '../../settings.js';
import logger from '../logger.js';

const DEFAULT_SETTINGS = {
  OutputFormat: 'mp3',
  VoiceId: 'Joanna',
  TextType: 'text'
};

async function polly(phrase, voiceName) {
  if (!settings.aws) {
    return Promise.resolve();
  }

  // Construct a filesystem neutral filename
  const dynamicParameters = { Text: phrase };
  const synthesizeParameters = Object.assign({}, DEFAULT_SETTINGS, dynamicParameters);
  if (settings.aws.name) {
    synthesizeParameters.VoiceId = settings.aws.name;
  }
  if (voiceName) {
    synthesizeParameters.VoiceId = voiceName;
  }

  const phraseHash = createHash('sha1').update(phrase).digest('hex');
  const filename = `polly-${phraseHash}-${synthesizeParameters.VoiceId}.mp3`;
  const filepath = resolve(settings.webroot, 'tts', filename);

  const expectedUri = `/tts/${filename}`;
  try {
    accessSync(filepath, R_OK);
    const duration = await fileDuration(filepath);
    return {
      duration,
      uri: expectedUri
    };
  } catch (err) {
    logger.info(`announce file for phrase "${phrase}" does not seem to exist, downloading`);
  }

  const constructorParameters = Object.assign({ apiVersion: '2016-06-10' }, settings.aws.credentials);
  const polly = new Polly(constructorParameters);
  const data_1 = await polly.synthesizeSpeech(synthesizeParameters).promise();
  writeFileSync(filepath, data_1.AudioStream);

  return {
    duration,
    uri: expectedUri
  };
}

export default polly;
