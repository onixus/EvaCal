import { describe, it, expect } from 'vitest';
import {
  DEFAULT_ENDPOINT_POLICY,
  EndpointNotAllowedError,
  assertAllowedEndpoint,
  isAllowedEndpoint,
} from '../endpointGuard';

describe('assertAllowedEndpoint', () => {
  it('accepts a local model endpoint and strips the trailing slash', () => {
    expect(assertAllowedEndpoint('http://localhost:11434/')).toBe('http://localhost:11434');
    expect(assertAllowedEndpoint('http://127.0.0.1:1234/v1')).toBe('http://127.0.0.1:1234/v1');
  });

  it('accepts a remote provider over HTTPS', () => {
    expect(assertAllowedEndpoint('https://api.example.com/v1')).toBe('https://api.example.com/v1');
  });

  it.each([
    ['http://169.254.169.254/latest/meta-data/', 'cloud metadata'],
    ['http://169.254.1.1/', 'link-local IPv4'],
    ['http://[fe80::1]/', 'link-local IPv6'],
  ])('rejects %s (%s)', (endpoint) => {
    expect(() => assertAllowedEndpoint(endpoint)).toThrow(EndpointNotAllowedError);
  });

  it.each([
    'http://10.0.0.5:8000/v1',
    'http://192.168.1.10:11434',
    'http://172.16.4.4:1234/v1',
    'http://100.100.0.1:8000',
    'http://[fd00::1]:11434',
  ])('rejects the private address %s by default', (endpoint) => {
    expect(() => assertAllowedEndpoint(endpoint)).toThrow(EndpointNotAllowedError);
  });

  it('allows private addresses when the policy opts in', () => {
    const policy = { ...DEFAULT_ENDPOINT_POLICY, allowPrivateNetwork: true };
    expect(assertAllowedEndpoint('http://10.0.0.5:8000/v1', policy)).toBe(
      'http://10.0.0.5:8000/v1',
    );
    // link-local stays blocked regardless of the policy
    expect(() => assertAllowedEndpoint('http://169.254.169.254/', policy)).toThrow(
      EndpointNotAllowedError,
    );
  });

  it('rejects loopback when the policy forbids it', () => {
    const policy = { ...DEFAULT_ENDPOINT_POLICY, allowLoopback: false };
    expect(() => assertAllowedEndpoint('http://localhost:11434', policy)).toThrow(
      EndpointNotAllowedError,
    );
  });

  it('rejects plain http for a remote host', () => {
    expect(() => assertAllowedEndpoint('http://api.example.com/v1')).toThrow(/HTTPS/);
  });

  it.each(['file:///etc/passwd', 'gopher://x/', 'ftp://example.com/', 'not-a-url'])(
    'rejects the non-http(s) target %s',
    (endpoint) => {
      expect(() => assertAllowedEndpoint(endpoint)).toThrow(EndpointNotAllowedError);
    },
  );

  it('rejects credentials embedded in the URL', () => {
    expect(() => assertAllowedEndpoint('https://user:pass@api.example.com/v1')).toThrow(
      EndpointNotAllowedError,
    );
  });
});

describe('isAllowedEndpoint', () => {
  it('returns a boolean instead of throwing', () => {
    expect(isAllowedEndpoint('https://api.example.com')).toBe(true);
    expect(isAllowedEndpoint('http://169.254.169.254')).toBe(false);
  });
});
