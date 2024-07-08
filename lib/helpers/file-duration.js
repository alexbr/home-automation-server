import { parseFile } from 'music-metadata';

async function fileDuration(path) {
  const info = await parseFile(path, { duration: true });
  return Math.ceil(info.format.duration * 1000);
}

export default fileDuration;
