'use strict';

async function status() {
  return {
    ok: true,
    mode: 'composite',
    runtime: 'host-panel',
  };
}

module.exports = {
  status,
};
