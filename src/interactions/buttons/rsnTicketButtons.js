import { linkRsnButtonHandler, unlinkRsnButtonHandler } from '../../handlers/rsnTicketHandlers.js';

const linkExecute = typeof linkRsnButtonHandler === 'function'
  ? linkRsnButtonHandler
  : linkRsnButtonHandler.execute;

const unlinkExecute = typeof unlinkRsnButtonHandler === 'function'
  ? unlinkRsnButtonHandler
  : unlinkRsnButtonHandler.execute;

export default [
  {
    name: 'ticket_link_rsn',
    execute: linkExecute
  },
  {
    name: 'ticket_unlink_rsn',
    execute: unlinkExecute
  }
];
