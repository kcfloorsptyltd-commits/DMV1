import { linkRsnModalHandler, unlinkRsnModalHandler } from '../../handlers/rsnTicketHandlers.js';

const linkExecute = typeof linkRsnModalHandler === 'function'
  ? linkRsnModalHandler
  : linkRsnModalHandler.execute;

const unlinkExecute = typeof unlinkRsnModalHandler === 'function'
  ? unlinkRsnModalHandler
  : unlinkRsnModalHandler.execute;

export default [
  {
    name: 'ticket_link_rsn_modal',
    execute: linkExecute
  },
  {
    name: 'ticket_unlink_rsn_modal',
    execute: unlinkExecute
  }
];
