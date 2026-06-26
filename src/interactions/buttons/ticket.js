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
import {
  rsnLinkApproveHandler,
  rsnLinkDeclineHandler,
  rsnUnlinkApproveHandler,
  rsnUnlinkDeclineHandler,
} from '../../handlers/rsnApprovalHandlers.js';

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
  rsnLinkApproveHandler,
  rsnLinkDeclineHandler,
  rsnUnlinkApproveHandler,
  rsnUnlinkDeclineHandler,
];
