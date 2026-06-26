import createTicketHandler, {
  closeTicketHandler,
  claimTicketHandler,
  priorityTicketHandler,
  pinTicketHandler,
  unclaimTicketHandler,
  reopenTicketHandler,
  deleteTicketHandler,
  linkRsnButtonHandler,
  unlinkRsnButtonHandler,
  linkRsnModalHandler,
  unlinkRsnModalHandler,
} from '../../handlers/ticketButtons.js';

export default [
  createTicketHandler,
  closeTicketHandler,
  claimTicketHandler,
  priorityTicketHandler,
  pinTicketHandler,
  unclaimTicketHandler,
  reopenTicketHandler,
  deleteTicketHandler,
  linkRsnButtonHandler,
  unlinkRsnButtonHandler,
  linkRsnModalHandler,
  unlinkRsnModalHandler,
];
