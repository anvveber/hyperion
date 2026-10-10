import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { handleApiError, withLogging } from '@/lib/api-utils';
import { isFeatureEnabled } from '@/lib/features';
import { isPublicSignupOpen } from '@/lib/registration';

export const GET = withLogging(async function GET() {
  try {
    const userCount = await prisma.user.count();
    // An empty instance needs its admin account created first
    const setupRequired = userCount === 0;

    // Password registration is not available when password login is disabled.
    // On an empty instance the first SSO login creates the admin account.
    if (!isFeatureEnabled('passwordLogin')) {
      return NextResponse.json({
        enabled: false,
        setupRequired,
        message: 'Password registration is disabled. Use the configured SSO provider.',
      });
    }

    if (isPublicSignupOpen(userCount)) {
      return NextResponse.json({ enabled: true, setupRequired });
    }

    return NextResponse.json({
      enabled: false,
      setupRequired,
      message: 'Registration is currently disabled',
    });
  } catch (error) {
    return handleApiError(error, 'registration-status');
  }
});
