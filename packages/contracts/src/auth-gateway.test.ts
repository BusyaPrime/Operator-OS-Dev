import { describe, expect, it } from 'vitest';

import { sanitizedJwtSchema, signinRequestSchema } from './auth-gateway.js';

// Well-formed 3-segment base64url payload used as the reference token
// across these cases. Signature byte content does not matter here —
// we only test the shape / sanitisation pipeline, not cryptographic
// verification (that is google-auth-library's job).
const WELL_FORMED_JWT =
  'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9' +
  '.eyJzdWIiOiJzdHViLXN1YmplY3QiLCJpYXQiOjF9' +
  '.sig-stub-abc_DEF-123';

describe('sanitizedJwtSchema', () => {
  it('accepts a clean well-formed token', () => {
    const result = sanitizedJwtSchema.parse(WELL_FORMED_JWT);
    expect(result).toBe(WELL_FORMED_JWT);
  });

  it('trims leading and trailing whitespace', () => {
    const padded = `   \t${WELL_FORMED_JWT}\n\n  `;
    const result = sanitizedJwtSchema.parse(padded);
    expect(result).toBe(WELL_FORMED_JWT);
  });

  it('strips embedded newlines inside a segment (web-ui copy-paste)', () => {
    // Simulate OAuth Playground textbox word-wrap: an \n injected
    // inside the payload segment during copy.
    const contaminated =
      'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9' +
      '.eyJzdWIiOiJzdHViLXN1YmplY3QiL\nCJpYXQiOjF9' +
      '.sig-stub-abc_DEF-123';
    const result = sanitizedJwtSchema.parse(contaminated);
    expect(result).toBe(WELL_FORMED_JWT);
  });

  it('strips embedded carriage returns + tabs across segments', () => {
    const contaminated =
      'eyJhbGci\rOiJSUzI1NiIs\tInR5cCI6IkpXVCJ9' +
      '.\teyJzdWIiOiJzdHViLXN1YmplY3QiLCJpYXQiOjF9' +
      '.sig-stub-abc_DEF-123\r';
    const result = sanitizedJwtSchema.parse(contaminated);
    expect(result).toBe(WELL_FORMED_JWT);
  });

  it('rejects empty string', () => {
    expect(() => sanitizedJwtSchema.parse('')).toThrow();
  });

  it('rejects whitespace-only input after sanitisation', () => {
    expect(() => sanitizedJwtSchema.parse('  \n\t\r  ')).toThrow(
      /empty after whitespace sanitisation/
    );
  });

  it('rejects a token with fewer than three segments', () => {
    expect(() =>
      sanitizedJwtSchema.parse('eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.payload')
    ).toThrow(/three dot-separated segments/);
  });

  it('rejects a token with more than three segments', () => {
    const extra = `${WELL_FORMED_JWT}.extra-fourth-segment`;
    expect(() => sanitizedJwtSchema.parse(extra)).toThrow(
      /three dot-separated segments/
    );
  });

  it('rejects non-JWT plain strings', () => {
    expect(() => sanitizedJwtSchema.parse('stub-google-id-token')).toThrow();
  });

  it('rejects segments that contain characters outside base64url', () => {
    // Contains '@' and '!' which are not in the base64url alphabet.
    const bad = 'valid.segment!but.not@base64url';
    expect(() => sanitizedJwtSchema.parse(bad)).toThrow(/base64url/);
  });

  it('accepts JWT-shaped tokens that are not from Google (shape-only validation)', () => {
    // Cryptographic validity and issuer trust are google-auth-library's
    // job; the schema only enforces shape. A custom / third-party JWT
    // should pass shape validation here.
    const custom =
      'eyJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJjdXN0b20ifQ.ncG-_mMCUhSXAwuxaIK';
    const result = sanitizedJwtSchema.parse(custom);
    expect(result).toBe(custom);
  });

  it('accepts tokens that include the base64 padding character "="', () => {
    // Rare but legal per RFC 7515 (JWTs typically omit padding, but a
    // permissive reader should accept it when the client includes it).
    const padded = 'aaa=.bbb=.ccc=';
    const result = sanitizedJwtSchema.parse(padded);
    expect(result).toBe(padded);
  });
});

describe('signinRequestSchema', () => {
  it('parses a request with a clean JWT', () => {
    const parsed = signinRequestSchema.parse({
      provider: 'google',
      idToken: WELL_FORMED_JWT
    });
    expect(parsed.provider).toBe('google');
    expect(parsed.idToken).toBe(WELL_FORMED_JWT);
  });

  it('defaults provider to "google" when omitted', () => {
    const parsed = signinRequestSchema.parse({ idToken: WELL_FORMED_JWT });
    expect(parsed.provider).toBe('google');
  });

  it('rejects a request without idToken', () => {
    expect(() => signinRequestSchema.parse({ provider: 'google' })).toThrow();
  });

  it('rejects a request whose idToken is malformed', () => {
    expect(() =>
      signinRequestSchema.parse({
        provider: 'google',
        idToken: 'not-a-jwt'
      })
    ).toThrow();
  });

  it('applies sanitisation before downstream handlers see the value', () => {
    const parsed = signinRequestSchema.parse({
      provider: 'google',
      idToken: `\t  ${WELL_FORMED_JWT}\n`
    });
    expect(parsed.idToken).toBe(WELL_FORMED_JWT);
  });
});
