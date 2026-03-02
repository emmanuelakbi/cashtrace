import { describe, expect, it } from 'vitest';

import { containsPii, redact, redactObject } from './pii-redactor.js';

describe('PiiRedactor', () => {
  describe('redact()', () => {
    describe('Nigerian phone numbers', () => {
      it('should redact 080x numbers', () => {
        expect(redact('Call me at 08012345678')).toBe('Call me at [PHONE]');
      });

      it('should redact 081x numbers', () => {
        expect(redact('Phone: 08112345678')).toBe('Phone: [PHONE]');
      });

      it('should redact 070x numbers', () => {
        expect(redact('Reach 07012345678 today')).toBe('Reach [PHONE] today');
      });

      it('should redact 090x numbers', () => {
        expect(redact('SMS 09012345678')).toBe('SMS [PHONE]');
      });

      it('should redact 091x numbers', () => {
        expect(redact('Dial 09112345678')).toBe('Dial [PHONE]');
      });

      it('should redact +234 prefixed numbers', () => {
        expect(redact('International: +2348012345678')).toBe('International: [PHONE]');
      });

      it('should redact multiple phone numbers', () => {
        const input = 'Primary: 08012345678, Secondary: 09098765432';
        const result = redact(input);
        expect(result).toBe('Primary: [PHONE], Secondary: [PHONE]');
      });
    });

    describe('account numbers', () => {
      it('should redact 10-digit account numbers', () => {
        expect(redact('Account: 0123456789')).toBe('Account: [ACCOUNT]');
      });

      it('should redact account numbers in context', () => {
        expect(redact('Transfer to 1234567890 at GTBank')).toBe('Transfer to [ACCOUNT] at GTBank');
      });
    });

    describe('BVN numbers', () => {
      it('should redact 11-digit BVN numbers', () => {
        expect(redact('BVN: 12345678901')).toBe('BVN: [BVN]');
      });
    });

    describe('email addresses', () => {
      it('should redact email addresses', () => {
        expect(redact('Email: user@example.com')).toBe('Email: [EMAIL]');
      });

      it('should redact emails with subdomains', () => {
        expect(redact('Contact admin@mail.company.ng')).toBe('Contact [EMAIL]');
      });

      it('should redact emails with special chars', () => {
        expect(redact('Send to first.last+tag@domain.com')).toBe('Send to [EMAIL]');
      });
    });

    describe('names with prefixes', () => {
      it('should redact Mr. prefixed names', () => {
        expect(redact('Payment to Mr. Adebayo Ogunlesi')).toBe('Payment to [NAME]');
      });

      it('should redact Mrs. prefixed names', () => {
        expect(redact('From Mrs. Funke Akindele')).toBe('From [NAME]');
      });

      it('should redact Chief prefixed names', () => {
        expect(redact('Signed by Chief Obi Nwosu')).toBe('Signed by [NAME]');
      });

      it('should redact Alhaji prefixed names', () => {
        expect(redact('Alhaji Musa Ibrahim sent funds')).toBe('[NAME] sent funds');
      });

      it('should redact Dr. prefixed names', () => {
        expect(redact('Consultation with Dr. Amina Bello')).toBe('Consultation with [NAME]');
      });
    });

    describe('mixed PII', () => {
      it('should redact multiple PII types in one string', () => {
        const input =
          'Mr. John Doe called 08012345678 about account 0123456789 and emailed info@test.com';
        const result = redact(input);
        expect(result).toBe('[NAME] called [PHONE] about account [ACCOUNT] and emailed [EMAIL]');
      });

      it('should return text unchanged when no PII present', () => {
        const input = 'This is a normal business transaction for supplies';
        expect(redact(input)).toBe(input);
      });
    });
  });

  describe('redactObject()', () => {
    it('should redact string values in a flat object', () => {
      const obj = { name: 'Mr. Ade Bola', phone: '08012345678' };
      const result = redactObject(obj);
      expect(result.name).toBe('[NAME]');
      expect(result.phone).toBe('[PHONE]');
    });

    it('should redact nested objects', () => {
      const obj = {
        customer: {
          email: 'user@example.com',
          details: {
            bvn: '12345678901',
          },
        },
      };
      const result = redactObject(obj);
      expect(result.customer.email).toBe('[EMAIL]');
      expect(result.customer.details.bvn).toBe('[BVN]');
    });

    it('should redact strings inside arrays', () => {
      const obj = { phones: ['08012345678', '09098765432'] };
      const result = redactObject(obj);
      expect(result.phones).toEqual(['[PHONE]', '[PHONE]']);
    });

    it('should preserve non-string primitives', () => {
      const obj = { amount: 5000, active: true, label: null as string | null };
      const result = redactObject(obj);
      expect(result.amount).toBe(5000);
      expect(result.active).toBe(true);
      expect(result.label).toBeNull();
    });

    it('should not mutate the original object', () => {
      const original = { email: 'user@example.com' };
      redactObject(original);
      expect(original.email).toBe('user@example.com');
    });

    it('should handle undefined input', () => {
      expect(redactObject(undefined)).toBeUndefined();
    });
  });

  describe('containsPii()', () => {
    it('should return true when text contains a phone number', () => {
      expect(containsPii('Call 08012345678')).toBe(true);
    });

    it('should return true when text contains an email', () => {
      expect(containsPii('Email: test@example.com')).toBe(true);
    });

    it('should return false for clean text', () => {
      expect(containsPii('Normal business text')).toBe(false);
    });

    it('should return true when text contains an account number', () => {
      expect(containsPii('Account 0123456789')).toBe(true);
    });

    it('should return true when text contains a BVN', () => {
      expect(containsPii('BVN 12345678901')).toBe(true);
    });
  });
});
