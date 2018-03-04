'use strict';

const request = require('request-promise');
const fs = require("fs");
const isRadioOrLineIn = require('../helpers/is-radio-or-line-in');
const logger = require('../logger');
const settings = require('../../settings');
const appleDef = require('../music_services/appleDef');
const spotifyDef = require('../music_services/spotifyDef');
const deezerDef = require('../music_services/deezerDef');
const eliteDef = deezerDef.init(true);
const libraryDef = require('../music_services/libraryDef');

const musicServices = ['apple','spotify','deezer','elite','library'];
const serviceNames = {
   apple:'Apple Music',
   spotify:'Spotify',
   deezer:'Deezer',
   elite:'Deezer',
   library:'Library'
};
const musicTypes = ['album','song','station','load','playlist'];

var country = '';
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
      logger.info('making request to ', player.baseUrl + '/status/accounts');
      return request({
         url: player.baseUrl + '/status/accounts',
         json: false
      }).then(res => {
         const actLoc = res.indexOf(player.system.getServiceType(serviceNames[service]));

         if (actLoc != -1) {
            const idLoc = res.indexOf('<UN>', actLoc) + 4;
            const snLoc = res.indexOf('SerialNum="', actLoc) + 11;

            accountId = res.substring(idLoc,res.indexOf('</UN>', idLoc));
            accountSN = res.substring(snLoc,res.indexOf('"', snLoc));
         } else {
            logger.warn('could not get accountSN, trying to get from settings');
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

function doSearch(service, type, term) {
   var serviceDef = getService(service);
   var url = serviceDef.search[type];
   var authenticate = serviceDef.authenticate;

   term = decodeURIComponent(term);

   let newTerm = '';
   let trackPos;
   let artistPos;
   let albumPos;

   // Check for search type specifiers
   if (term.indexOf(':') > -1) {
      var artist = '';
      var album = '';
      var track  = '';

      const tokens = term.split(' ');
      const fields = [ 'artist', 'album', 'track', 'year' ];
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

      logger.info(`type: ${type}, term: ${term}, artist: ${artist}, album: ${album}, track: ${track}`);

      newTerm = serviceDef.term(type, term, artist, album, track);
   } else {
      newTerm = (service === 'library') ? term : encodeURIComponent(term);
   }

   if (type == 'song') {
      searchType = (trackPos > -1) ? 1 : ((artistPos > -1) ? 2 : 0);
   }

   url += newTerm;

   logger.info(`search url: ${url}`);

   if (service == 'library') {
      return Promise.resolve(libraryDef.searchlib(type, newTerm));
   } else if (serviceDef.country !== '' && country === '') {
      return request({url: 'http://ipinfo.io', json: true}).then((res) => {
         country = res.country;
         url += serviceDef.country + country;
         return authenticate().then(() => request(getRequestOptions(serviceDef, url)));
      });
   } else {
      if (serviceDef.country !== '') {
         url += serviceDef.country + country;
      }

      return authenticate().then(() => request(getRequestOptions(serviceDef, url)));
   }
}

Array.prototype.shuffle = function() {
   var len = this.length;
   var temp;
   var i;

   while (len) {
      i = Math.random()*len-- >>> 0;
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

            for (var i=1; i < tracks.count;i++) {
               if (artists[i] != prevArtist) {
                  artistCount++;
                  prevArtist = artists[i];
               }
               if (songs[i] != prevTrack) {
                  trackCount++;
                  prevTrack = songs[i];
               }
            }
            tracks.isArtist = (trackCount/artistCount > 2);
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
            logger.info('found metadata', UaM);

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
                     logger.info('adding uri to queue:', tracks.queueTracks[0].uri);
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
                        logger.info('adding uri to queue:', track.uri);
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
                     logger.info('adding uri to queue:', tracks.queueTracks[0].uri);
                     return player.coordinator.addURIToQueue(
                        tracks.queueTracks[0].uri,
                        tracks.queueTracks[0].metadata,
                        true,
                        nextTrackNo);
                  }).then(() => {
                     return player.coordinator.setAVTransport(queueURI, '');
                  }).then(res => {
                     if (!empty) {
                        return player.coordinator.trackSeek(nextTrackNo);
                     } else {
                        return Promise.resolve();
                     }
                  }).then(res => {
                     return player.coordinator.play();
                  });
               }
            }
         }
      }
   });
}

module.exports = function(api) {
   api.registerAction('musicsearch', musicSearch);
   libraryDef.read();
};
