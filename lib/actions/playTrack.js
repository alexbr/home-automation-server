const logger = require('../logger');
const libraryDef = require('../music_services/libraryDef');

function playTrack(player, tracks) {
   const track = tracks[0];
   const queueURI = `x-rincon-queue:${player.coordinator.uuid}#0`;
   let empty = false;
   let nextTrackNo = 0;

   return player.coordinator.getQueue(0, 1).then(queue => {
      empty = queue.length === 0;
      nextTrackNo = empty ? 1 : player.coordinator.state.trackNo + 1;
   }).then(() => {
      logger.info(`adding uri to queue ${track.uri}`);
      return player.coordinator.addURIToQueue(
         track.uri,
         track.metadata,
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

module.exports = function(api) {
   api.registerAction('playtrack', playTrack);
   libraryDef.read();
};
