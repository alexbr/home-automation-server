'use strict';

import request from 'request-promise';
import { info, warn } from '../logger.js';
import settings from '../../settings.js';
import appleDef from '../music_services/appleDef.js';
import spotifyDef from '../music_services/spotifyDef.js';
import deezerDef from '../music_services/deezerDef.js';
import libraryDef from '../music_services/libraryDef.js';
const eliteDef = deezerDef.init(true);

const musicServices = ['apple', 'spotify', 'deezer', 'elite', 'library'];
const serviceNames = {
  apple: 'Apple Music',
  spotify: 'Spotify',
  deezer: 'Deezer',
  elite: 'Deezer',
  library: 'Library'
};
const musicTypes = ['album', 'song', 'station', 'load', 'playlist'];

var country = 'US';
var accountId = '';
var accountSN = '';
var searchType = 0;

function getService(service) {
  if (service == 'apple') {
    return appleDef;
  } else if (service == 'spotify') {
    return spotifyDef;
  } else if (service == 'deezer') {
    return deezerDef;
  } else if (service == 'elite') {
    return eliteDef;
  } else if (service == 'library') {
    return libraryDef;
  }
}

function getAccountId(player, service) {
  accountId = '';

  if (service != 'library') {
    info('making request to ', player.baseUrl + '/status/accounts');
    return request({
      url: player.baseUrl + '/status/accounts',
      json: false
    }).then(res => {
      const actLoc = res.indexOf(
        player.system.getServiceType(serviceNames[service]));

      if (actLoc != -1) {
        const idLoc = res.indexOf('<UN>', actLoc) + 4;
        const snLoc = res.indexOf('SerialNum="', actLoc) + 11;

        accountId = res.substring(idLoc, res.indexOf('</UN>', idLoc));
        accountSN = res.substring(snLoc, res.indexOf('"', snLoc));
      } else {
        warn('could not get accountSN, trying to get from settings');
        accountSN = settings[service] ? settings[service].accountSN : 3;
      }

      return Promise.resolve({ accountId: accountId, accountSN: accountSN });
    });
  } else {
    return Promise.resolve();
  }
}

function getRequestOptions(serviceDef, url) {
  const headers = serviceDef.headers();
  return {
    url: url,
    json: true,
    headers: headers,
  };
}

async function doSearch(service, type, term) {
  var serviceDef = getService(service);
  var url = serviceDef.search[type];
  var authenticate = serviceDef.authenticate;

  term = decodeURIComponent(term);

  let newTerm = '';
  let trackPos;
  let artistPos;

  // Check for search type specifiers
  if (term.indexOf(':') > -1) {
    var artist = '';
    var album = '';
    var track = '';

    const tokens = term.split(' ');
    const fields = ['artist', 'album', 'track', 'year'];
    let tokenIndex = 0;

    var accumulate = function accumulate() {
      let accumulated = '';

      while (tokenIndex < tokens.length) {
        let token = tokens[tokenIndex];
        const splitToken = token.split(':');

        if (splitToken.length > 1 &&
          fields.indexOf(splitToken[0].toLowerCase()) > -1) {
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

        if (prefix === 'artist') {
          artist = (suffix + ' ' + accumulate()).trim();
        } else if (prefix === 'album') {
          album = (suffix + ' ' + accumulate()).trim();
        } else if (prefix === 'track') {
          track = (suffix + ' ' + accumulate()).trim();
        }
      }
    }

    info(`type: ${type}, term: ${term}, artist: ${artist}, album: ${album}, track: ${track}`);

    newTerm = serviceDef.term(type, term, artist, album, track);
  } else {
    newTerm = (service === 'library') ? term : encodeURIComponent(term);
  }

  if (type == 'song') {
    searchType = (trackPos > -1) ? 1 : ((artistPos > -1) ? 2 : 0);
  }

  url += newTerm;

  if (service == 'library') {
    info(`library search url: ${url}`);
    return Promise.resolve(libraryDef.searchlib(type, newTerm));
  } else if (serviceDef.country !== '' && country === '') {
    const res = await request({ url: 'http://ipinfo.io', json: true });
    country = res.country;
    url += serviceDef.country + country;
    info(`ipinfo search url: ${url}`);
    await authenticate();
    return await request(getRequestOptions(serviceDef, url));
  } else {
    if (serviceDef.country !== '') {
      url += serviceDef.country + country;
    }
    info(`search url: ${url}`);
    await authenticate();
    return await request(getRequestOptions(serviceDef, url));
  }
}

Array.prototype.shuffle = function() {
  var len = this.length;
  var temp;
  var i;

  while (len) {
    i = Math.random() * len-- >>> 0;
    temp = this[len];
    this[len] = this[i];
    this[i] = temp;
  }

  return this;
};

function loadTracks(player, service, type, tracksJson) {
  var tracks = getService(service).tracks(type, tracksJson);

  if (service === 'library' && type === 'album') {
    tracks.isArtist = true;
  } else if (type !== 'album') {
    if (searchType === 0) {
      // Determine if the request was for a specific song or for many songs by
      // a specific artist
      if (tracks.count > 1) {
        var artistCount = 1;
        var trackCount = 1;
        var artists = tracks.queueTracks.map(function(track) {
          return track.artistName.toLowerCase();
        }).sort();
        var songs = tracks.queueTracks.map(function(track) {
          return track.trackName.toLowerCase();
        }).sort();

        var prevArtist = artists[0];
        var prevTrack = songs[0];

        for (var i = 1; i < tracks.count; i++) {
          if (artists[i] != prevArtist) {
            artistCount++;
            prevArtist = artists[i];
          }
          if (songs[i] != prevTrack) {
            trackCount++;
            prevTrack = songs[i];
          }
        }
        tracks.isArtist = (trackCount / artistCount > 2);
      }
    } else {
      tracks.isArtist = searchType == 2;
    }
  }

  // To avoid playing the same song first in a list of artist tracks when
  // shuffle is on
  if (tracks.isArtist && player.coordinator.state.playMode.shuffle) {
    tracks.queueTracks.shuffle();
  }

  return tracks;
}

function musicSearch(player, values) {
  const service = values[0].toLowerCase();
  const type = values[1];
  const term = values[2];
  const queueURI = 'x-rincon-queue:' + player.coordinator.uuid + '#0';

  if (musicServices.indexOf(service) == -1) {
    return Promise.reject('Invalid music service');
  }

  if (musicTypes.indexOf(type) == -1) {
    return Promise.reject('Invalid type ' + type);
  }

  if (service == 'library' && (type == 'load' || libraryDef.nolib())) {
    return libraryDef.load(player, (type == 'load'));
  }

  return getAccountId(player, service).then(() => {
    return doSearch(service, type, term);
  }).then(resList => {
    const serviceDef = getService(service);
    serviceDef.service(player, accountId, accountSN, country);

    if (serviceDef.empty(type, resList)) {
      return Promise.reject('No matches were found');
    } else {
      var UaM = null;

      if (type === 'station') {
        UaM = serviceDef.urimeta(type, resList);

        return player.coordinator.setAVTransport(UaM.uri, UaM.metadata).then(() => {
          return player.coordinator.play();
        });
      } else if ((type === 'album' || type === 'playlist') && service !== 'library') {
        UaM = serviceDef.urimeta(type, resList);
        info('found metadata', UaM);

        return player.coordinator.clearQueue()
          .then(() => player.coordinator.setAVTransport(queueURI, ''))
          .then(() => player.coordinator.addURIToQueue(
            UaM.uri, UaM.metadata, true, 1))
          .then(() => player.coordinator.play());
      } else { // Play songs
        var tracks = loadTracks(player, service, type, resList);

        if (tracks.count === 0) {
          return Promise.reject('No matches were found');
        } else {
          if (tracks.isArtist) {  // Play numerous songs by the specified artist
            return player.coordinator.clearQueue().then(() => {
              return player.coordinator.setAVTransport(queueURI, '');
            }).then(() => {
              info(`adding uri to queue: ${tracks.queueTracks[0].uri}`);
              return player.coordinator.addURIToQueue(
                tracks.queueTracks[0].uri,
                tracks.queueTracks[0].metadata,
                true,
                1);
            }).then(() => {
              return player.coordinator.play();
            }).then(() => {
              // XXX: don't return this promise, it will generally take
              // too long and alexa skills will timeout
              tracks.queueTracks.slice(1).reduce((promise, track, index) => {
                info(`adding uri to queue: ${track.uri}`);
                return promise.then(() => {
                  return player.coordinator.addURIToQueue(
                    track.uri,
                    track.metadata,
                    true,
                    index + 2);
                });
              }, Promise.resolve());
            });
          } else { // Play the one specified song
            var empty = false;
            var nextTrackNo = 0;

            return player.coordinator.getQueue(0, 1).then(queue => {
              empty = queue.length === 0;
              nextTrackNo = empty ? 1 : player.coordinator.state.trackNo + 1;
            }).then(() => {
              info(`adding uri to queue: ${tracks.queueTracks[0].uri}`);
              return player.coordinator.addURIToQueue(
                tracks.queueTracks[0].uri,
                tracks.queueTracks[0].metadata,
                true,
                nextTrackNo);
            }).then(() => {
              return player.coordinator.setAVTransport(queueURI, '');
            }).then(() => {
              if (!empty) {
                return player.coordinator.trackSeek(nextTrackNo);
              } else {
                return Promise.resolve();
              }
            }).then(() => {
              return player.coordinator.play();
            });
          }
        }
      }
    }
  });
}

export default function(api) {
  api.registerAction('musicsearch', musicSearch);
  libraryDef.read();
};
