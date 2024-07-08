'use strict';

import request from 'request-promise';
import { info } from '../logger.js';
import appleDef from '../music_services/appleDef.js';
import spotifyDef from '../music_services/spotifyDef.js';
import deezerDef from '../music_services/deezerDef.js';
import libraryDef from '../music_services/libraryDef.js';
const eliteDef = deezerDef.init(true);

const musicServices = new Set([
  'amazon', 'apple', 'spotify', 'deezer', 'elite', 'library'
]);
const serviceNames = {
  apple: 'Apple Music',
  spotify: 'Spotify',
  deezer: 'Deezer',
  elite: 'Deezer',
  amazon: 'Amazon',
  library: 'Library',
};
const musicTypes = new Set(['album', 'song', 'station', 'load', 'playlist']);

let country = 'US';
let accountId = '';
let accountSN = '';
let searchType = 0;

function getService(service) {
  if (service == 'apple') {
    return appleDef;
  }

  if (service == 'spotify') {
    return spotifyDef;
  }

  if (service == 'deezer') {
    return deezerDef;
  }

  if (service == 'elite') {
    return eliteDef;
  }

  if (service == 'library') {
    return libraryDef;
  }
}

async function getAccountId(player, service) {
  accountId = '';

  if (service !== 'library') {
    const request_ = { url: player.baseUrl + '/status/accounts', json: false };
    const res = await request(request_);
    const actLoc = res.indexOf(player.system.getServiceType(serviceNames[service]));
    if (actLoc != -1) {
      const idLoc = res.indexOf('<UN>', actLoc) + 4;
      const snLoc = res.indexOf('SerialNum="', actLoc) + 11;

      accountId = res.substring(idLoc, res.indexOf('</UN>', idLoc));
      accountSN = res.substring(snLoc, res.indexOf('"', snLoc));
    }
  }

  return Promise.resolve();
}

function getRequestOptions(serviceDef, url) {
  const headers = serviceDef.headers();
  return {
    url,
    json: true,
    headers,
  };
}

async function doSearch(service, type, term) {
  const serviceDef = getService(service);
  let url = serviceDef.search[type];
  const authenticate = serviceDef.authenticate;

  term = decodeURIComponent(term);

  let newTerm = '';
  let trackPos;
  let artistPos;

  // Check for search type specifiers
  if (term.includes(':')) {
    let artist = '';
    let album = '';
    let track = '';

    const tokens = term.split(' ');
    const fields = new Set(['artist', 'album', 'track', 'year']);
    let tokenIndex = 0;

    const accumulate = function accumulate() {
      let accumulated = '';

      while (tokenIndex < tokens.length) {
        const token = tokens[tokenIndex];
        const splitToken = token.split(':');

        if (splitToken.length > 1
          && fields.has(splitToken[0].toLowerCase())) {
          break;
        }

        accumulated += tokens[tokenIndex] + ' ';
        tokenIndex++;
      }

      return accumulated.trim();
    };

    while (tokenIndex < tokens.length) {
      const token = tokens[tokenIndex++];
      const splitToken = token.split(':');

      if (splitToken.length > 1) {
        const prefix = splitToken[0].toLowerCase();
        const suffix = splitToken[1];

        switch (prefix) {
          case 'artist': {
            artist = (suffix + ' ' + accumulate()).trim();

            break;
          }

          case 'album': {
            album = (suffix + ' ' + accumulate()).trim();

            break;
          }

          case 'track': {
            track = (suffix + ' ' + accumulate()).trim();

            break;
          }
          // No default
        }
      }
    }

    newTerm = serviceDef.term(type, term, artist, album, track);
  } else {
    newTerm = (service == 'library') ? term : encodeURIComponent(term);
  }

  if (type == 'song') {
    searchType = (trackPos > -1) ? 1 : (artistPos > -1 ? 2 : 0);
  }

  url += newTerm;

  info('search url: ' + url);

  if (service === 'library') {
    return Promise.resolve(libraryDef.searchlib(type, newTerm));
  }

  if (serviceDef.country !== '' && country === '') {
    const res = await request({ url: 'http://ipinfo.io', json: true });
    country = res.country;
    url += serviceDef.country + country;
    await authenticate();
    return await request(getRequestOptions(serviceDef, url));
  }

  if (serviceDef.country != '') {
    url += serviceDef.country + country;
  }

  const options = getRequestOptions(serviceDef, url);

  await authenticate();
  return await request(options);
}

function loadTracks(_player, service, type, tracksJson) {
  const tracks = getService(service).tracks(type, tracksJson);

  if (service === 'library' && type === 'album') {
    tracks.isArtist = true;
  } else if (type != 'album') {
    tracks.isArtist = searchType == 2;
  }

  return tracks;
}

async function search(player, values) {
  const service = values[0];
  const type = values[1];
  const term = values[2];

  if (!musicServices.has(service)) {
    return Promise.reject('Invalid music service');
  }

  if (!musicTypes.has(type)) {
    return Promise.reject('Invalid type ' + type);
  }

  if (service == 'library' && (type == 'load' || libraryDef.nolib())) {
    return libraryDef.load(player, (type == 'load'));
  }

  await getAccountId(player, service);
  const resList = await doSearch(service, type, term);
  const serviceDef = getService(service);
  serviceDef.service(player, accountId, accountSN, country);
  if (serviceDef.empty(type, resList)) {
    throw 'No matches were found';
  }
  if (type == 'station'
    || ((type == 'album' || type == 'playlist') && service != 'library')) {
    const uM = serviceDef.urimeta(type, resList);
    return {
      isUriAndMetadata: true,
      uriAndMetadata: uM,
    };
  }
  const tracks = loadTracks(player, service, type, resList);
  return tracks;
}

export default function(api) {
  api.registerAction('search', search);
  libraryDef.read();
};
