import { readFileSync } from 'fs';
import json5 from 'json5';
import loggerJs from '../logger.js';

function tryLoadJson(path) {
  try {
    const fileContent = readFileSync(path);
    const parsedContent = json5.parse(fileContent);
    return parsedContent;
  } catch (e) {
    if (e.code === 'ENOENT') {
      loggerJs.info(`Could not find file ${path}`);
    } else {
      loggerJs.warn(`Could not read file ${path}, ignoring.`, e);
    }
  }
  return {};
}

export default tryLoadJson;
