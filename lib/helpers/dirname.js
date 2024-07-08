'use strict';

import path from 'path';
import { fileURLToPath } from 'url';

export default function(modulePath) {
  const fileName = fileURLToPath(modulePath);
  const dirName = path.dirname(fileName);
  return dirName;
};
