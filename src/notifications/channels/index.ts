/**
 * Notification Channels
 *
 * Delivery channel implementations for email, in-app, and push notifications.
 *
 * @module notifications/channels
 */

export type { EmailProvider, EmailChannel } from './emailChannel.js';
export { createEmailChannel, createSendGridProvider, createSESProvider } from './emailChannel.js';

export type { InAppChannel } from './inAppChannel.js';
export { createInAppChannel } from './inAppChannel.js';

export type { PushProvider, PushChannel, PushMessage } from './pushChannel.js';
export { createPushChannel, createFCMProvider } from './pushChannel.js';
