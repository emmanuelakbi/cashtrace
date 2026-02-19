/**
 * Email service adapter for the authentication module.
 *
 * Provides a thin wrapper around an injected email transport for sending
 * magic link and password reset emails. The actual email delivery is
 * delegated to the transport — this adapter handles URL formatting,
 * email content construction, and typed error handling.
 *
 * Supports graceful degradation: when the transport fails, a typed
 * {@link EmailServiceError} is thrown so callers can fall back to
 * alternative authentication methods (e.g. password login).
 *
 * @module services/emailService
 */

// ─── Interfaces ──────────────────────────────────────────────────────────────

/**
 * Transport interface for sending emails.
 *
 * Implementations may use SMTP, a third-party API (SendGrid, SES, etc.),
 * or an in-memory transport for testing. The email service adapter
 * delegates all actual delivery to this interface.
 */
export interface EmailTransport {
  sendMail(options: { to: string; subject: string; html: string }): Promise<void>;
}

/**
 * Public interface for the email service used by the auth module.
 *
 * Matches the contracts expected by the auth controller:
 * - {@link EmailService.sendMagicLink} for magic link authentication (Req 3.3)
 * - {@link EmailService.sendPasswordReset} for password reset flows (Req 5.3)
 */
export interface EmailService {
  sendMagicLink(email: string, token: string): Promise<void>;
  sendPasswordReset(email: string, token: string): Promise<void>;
}

/**
 * Configuration for the email service adapter.
 */
export interface EmailServiceConfig {
  /** Base URL for constructing magic link and reset URLs (e.g. "https://app.cashtrace.ng") */
  baseUrl: string;
}

// ─── Error ───────────────────────────────────────────────────────────────────

/**
 * Typed error thrown when the email transport fails.
 *
 * Callers (e.g. the auth controller) catch this to trigger graceful
 * degradation — returning a friendly error and suggesting password
 * login as an alternative (Req 3.7).
 */
export class EmailServiceError extends Error {
  public readonly code = 'EMAIL_SERVICE_ERROR';

  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'EmailServiceError';
  }
}

// ─── Adapter Implementation ──────────────────────────────────────────────────

/**
 * Concrete email service adapter.
 *
 * Accepts an {@link EmailTransport} and {@link EmailServiceConfig} via
 * constructor injection, making it easy to swap transports for testing
 * or different environments.
 *
 * @example
 * ```typescript
 * const transport: EmailTransport = { sendMail: async (opts) => { ... } };
 * const emailService = new EmailServiceAdapter(transport, { baseUrl: 'https://app.cashtrace.ng' });
 * await emailService.sendMagicLink('user@example.com', 'abc123');
 * ```
 */
export class EmailServiceAdapter implements EmailService {
  constructor(
    private readonly transport: EmailTransport,
    private readonly config: EmailServiceConfig,
  ) {}

  /**
   * Send a magic link email to the user.
   *
   * Constructs a URL embedding the token and sends an HTML email
   * via the injected transport.
   *
   * Per Requirement 3.3: send the magic link to the user's registered email.
   * Per Requirement 3.7: throws {@link EmailServiceError} on transport failure
   * so callers can degrade gracefully.
   *
   * @param email - The recipient's email address
   * @param token - The raw magic link token to embed in the URL
   * @throws {EmailServiceError} When the transport fails to deliver
   */
  async sendMagicLink(email: string, token: string): Promise<void> {
    const url = `${this.config.baseUrl}/auth/magic-link/verify?token=${encodeURIComponent(token)}`;

    try {
      await this.transport.sendMail({
        to: email,
        subject: 'Your CashTrace Login Link',
        html: buildMagicLinkHtml(url),
      });
    } catch (err) {
      throw new EmailServiceError('Failed to send magic link email', err);
    }
  }

  /**
   * Send a password reset email to the user.
   *
   * Constructs a URL embedding the reset token and sends an HTML email
   * via the injected transport.
   *
   * Per Requirement 5.3: send the reset link to the user's email.
   * Per Requirement 3.7 (applied to resets): throws {@link EmailServiceError}
   * on transport failure so callers can degrade gracefully.
   *
   * @param email - The recipient's email address
   * @param token - The raw password reset token to embed in the URL
   * @throws {EmailServiceError} When the transport fails to deliver
   */
  async sendPasswordReset(email: string, token: string): Promise<void> {
    const url = `${this.config.baseUrl}/auth/password/reset?token=${encodeURIComponent(token)}`;

    try {
      await this.transport.sendMail({
        to: email,
        subject: 'Reset Your CashTrace Password',
        html: buildPasswordResetHtml(url),
      });
    } catch (err) {
      throw new EmailServiceError('Failed to send password reset email', err);
    }
  }
}

// ─── Email Templates ─────────────────────────────────────────────────────────

/**
 * Build the HTML body for a magic link email.
 *
 * @param url - The full magic link URL including the token
 * @returns HTML string for the email body
 */
function buildMagicLinkHtml(url: string): string {
  return [
    '<div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">',
    '<h2>Login to CashTrace</h2>',
    '<p>Click the link below to log in to your account. This link expires in 15 minutes.</p>',
    `<p><a href="${url}" style="display: inline-block; padding: 12px 24px; background: #2563eb; color: #fff; text-decoration: none; border-radius: 6px;">Log In</a></p>`,
    '<p>If you did not request this link, you can safely ignore this email.</p>',
    '</div>',
  ].join('\n');
}

/**
 * Build the HTML body for a password reset email.
 *
 * @param url - The full password reset URL including the token
 * @returns HTML string for the email body
 */
function buildPasswordResetHtml(url: string): string {
  return [
    '<div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">',
    '<h2>Reset Your CashTrace Password</h2>',
    '<p>Click the link below to reset your password. This link expires in 1 hour.</p>',
    `<p><a href="${url}" style="display: inline-block; padding: 12px 24px; background: #2563eb; color: #fff; text-decoration: none; border-radius: 6px;">Reset Password</a></p>`,
    '<p>If you did not request a password reset, you can safely ignore this email.</p>',
    '</div>',
  ].join('\n');
}
