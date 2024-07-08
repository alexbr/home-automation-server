'use strict';

import { readdirSync, statSync } from 'fs';
import { join } from 'path';
import logger from '../logger.js';

export default function(cwd, cb) {
  let files = readdirSync(cwd);

  files.map(name => {
    let fullPath = join(cwd, name);
    return {
      name,
      fullPath,
      stat: statSync(fullPath)
    };
  }).filter(file => {
    return !file.stat.isDirectory()
      && !file.name.startsWith('.')
      && file.name.endsWith('.js');
  }).forEach(async file => {
      logger.info(`loading ${file.fullPath}`);
      const { default: result } = await import(file.fullPath);
      cb(result);
  });
};
