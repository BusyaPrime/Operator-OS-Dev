import { describe, expectTypeOf, it } from 'vitest';

import type {
  AgentBinaryRequirement,
  AgentManifest,
  AgentPricing,
  AgentRequirements,
  AgentSignature
} from '../agent-manifest.js';
import type {
  AgentCapability,
  CapabilityDescriptor
} from '../capabilities.js';

describe('AgentCapability', () => {
  it('is a narrow union of known capabilities', () => {
    type Sample = 'code-generation' | 'long-context' | 'vision';
    expectTypeOf<Sample>().toMatchTypeOf<AgentCapability>();
  });

  it('includes context-size tiers (long + extended)', () => {
    type Expect = 'long-context' | 'extended-context';
    expectTypeOf<Expect>().toMatchTypeOf<AgentCapability>();
  });
});

describe('CapabilityDescriptor', () => {
  it('bundles capability + version + optional limitations', () => {
    expectTypeOf<CapabilityDescriptor['capability']>().toEqualTypeOf<AgentCapability>();
    expectTypeOf<CapabilityDescriptor['version']>().toEqualTypeOf<string>();
    expectTypeOf<CapabilityDescriptor>()
      .toHaveProperty('limitations')
      .toEqualTypeOf<string | undefined>();
  });
});

describe('AgentManifest', () => {
  it("manifestVersion is literal '1'", () => {
    expectTypeOf<AgentManifest['manifestVersion']>().toEqualTypeOf<'1'>();
  });

  it('requires providerId, providerVersion, displayName, description, author, license', () => {
    expectTypeOf<AgentManifest['providerId']>().toEqualTypeOf<string>();
    expectTypeOf<AgentManifest['providerVersion']>().toEqualTypeOf<string>();
    expectTypeOf<AgentManifest['displayName']>().toEqualTypeOf<string>();
    expectTypeOf<AgentManifest['description']>().toEqualTypeOf<string>();
    expectTypeOf<AgentManifest['author']>().toEqualTypeOf<string>();
    expectTypeOf<AgentManifest['license']>().toEqualTypeOf<string>();
  });

  it('capabilities is readonly array of CapabilityDescriptor', () => {
    expectTypeOf<AgentManifest['capabilities']>().toEqualTypeOf<
      readonly CapabilityDescriptor[]
    >();
  });

  it('requirements is AgentRequirements (required)', () => {
    expectTypeOf<AgentManifest['requirements']>().toEqualTypeOf<AgentRequirements>();
  });

  it('pricing + signature are optional', () => {
    expectTypeOf<AgentManifest>()
      .toHaveProperty('pricing')
      .toEqualTypeOf<AgentPricing | undefined>();
    expectTypeOf<AgentManifest>()
      .toHaveProperty('signature')
      .toEqualTypeOf<AgentSignature | undefined>();
  });
});

describe('AgentRequirements', () => {
  it('requiredPlatform is readonly platform array (optional)', () => {
    expectTypeOf<AgentRequirements>()
      .toHaveProperty('requiredPlatform')
      .toEqualTypeOf<readonly ('win32' | 'darwin' | 'linux')[] | undefined>();
  });

  it('requiredBinaries is readonly AgentBinaryRequirement array (optional)', () => {
    expectTypeOf<AgentRequirements>()
      .toHaveProperty('requiredBinaries')
      .toEqualTypeOf<readonly AgentBinaryRequirement[] | undefined>();
  });
});

describe('AgentPricing', () => {
  it('model is the 4-variant union', () => {
    expectTypeOf<AgentPricing['model']>().toEqualTypeOf<
      'free' | 'subscription' | 'usage-based' | 'byok'
    >();
  });
});

describe('AgentSignature', () => {
  it("algorithm is literal 'ed25519'", () => {
    expectTypeOf<AgentSignature['algorithm']>().toEqualTypeOf<'ed25519'>();
  });

  it('carries publicKeyHex, signatureHex, signedAt', () => {
    expectTypeOf<AgentSignature['publicKeyHex']>().toEqualTypeOf<string>();
    expectTypeOf<AgentSignature['signatureHex']>().toEqualTypeOf<string>();
    expectTypeOf<AgentSignature['signedAt']>().toEqualTypeOf<string>();
  });
});
