'use strict';
function reindex(player) {
  return player.system.refreshShareIndex();
}

export default function(api) {
  api.registerAction('reindex', reindex);
}
