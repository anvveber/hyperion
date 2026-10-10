import { describe, it, expect, beforeEach, vi } from 'vitest';

// Use vi.hoisted to create mocks before hoisting
const mocks = vi.hoisted(() => ({
  userCount: vi.fn(),
  isSaasMode: vi.fn(),
  isFeatureEnabled: vi.fn(),
}));

// Mock Prisma
vi.mock('../../lib/prisma', () => ({
  prisma: {
    user: {
      count: mocks.userCount,
    },
  },
}));

vi.mock('../../lib/features', () => ({
  isSaasMode: mocks.isSaasMode,
  isFeatureEnabled: mocks.isFeatureEnabled,
}));

// Mock api-utils (withLogging is a passthrough so it doesn't affect test behavior)
vi.mock('../../lib/api-utils', () => ({
  handleApiError: vi.fn((error: Error) => {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }),
  withLogging: vi.fn((fn: (...args: unknown[]) => unknown) => fn),
}));

// Import after mocking
import { GET as registrationStatus } from '../../app/api/auth/registration-status/route';

async function getStatus() {
  const response = await registrationStatus(new Request('http://localhost/api/auth/registration-status'));
  return { response, body: await response.json() };
}

describe('Registration Status API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.DISABLE_REGISTRATION;
    mocks.isSaasMode.mockReturnValue(false);
    mocks.isFeatureEnabled.mockReturnValue(true);
  });

  describe('self-hosted', () => {
    it('is open with setupRequired on an empty instance', async () => {
      mocks.userCount.mockResolvedValue(0);
      const { response, body } = await getStatus();

      expect(response.status).toBe(200);
      expect(body).toEqual({ enabled: true, setupRequired: true });
    });

    it('is closed once an account exists, even without DISABLE_REGISTRATION', async () => {
      mocks.userCount.mockResolvedValue(1);
      const { body } = await getStatus();

      expect(body.enabled).toBe(false);
      expect(body.setupRequired).toBe(false);
      expect(body.message).toBe('Registration is currently disabled');
    });

    it('ignores DISABLE_REGISTRATION=false', async () => {
      process.env.DISABLE_REGISTRATION = 'false';
      mocks.userCount.mockResolvedValue(3);
      const { body } = await getStatus();

      expect(body.enabled).toBe(false);
    });

    it('reports password signup disabled but setup still required when only SSO is available', async () => {
      mocks.isFeatureEnabled.mockReturnValue(false);
      mocks.userCount.mockResolvedValue(0);
      const { body } = await getStatus();

      expect(body.enabled).toBe(false);
      expect(body.setupRequired).toBe(true);
    });
  });

  describe('SaaS mode', () => {
    beforeEach(() => {
      mocks.isSaasMode.mockReturnValue(true);
    });

    it('is open when DISABLE_REGISTRATION is not set', async () => {
      mocks.userCount.mockResolvedValue(5);
      const { body } = await getStatus();

      expect(body).toEqual({ enabled: true, setupRequired: false });
    });

    it('is closed when DISABLE_REGISTRATION is true and users exist', async () => {
      process.env.DISABLE_REGISTRATION = 'true';
      mocks.userCount.mockResolvedValue(1);
      const { body } = await getStatus();

      expect(body.enabled).toBe(false);
      expect(body.message).toBe('Registration is currently disabled');
    });

    it('lets the first user sign up when DISABLE_REGISTRATION is true', async () => {
      process.env.DISABLE_REGISTRATION = 'true';
      mocks.userCount.mockResolvedValue(0);
      const { body } = await getStatus();

      expect(body.enabled).toBe(true);
      expect(body.setupRequired).toBe(true);
    });
  });

  it('should handle database errors gracefully', async () => {
    mocks.userCount.mockRejectedValue(new Error('Database error'));
    const { response } = await getStatus();

    expect(response.status).toBe(500);
  });
});
