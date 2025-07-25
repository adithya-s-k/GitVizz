// app/api/github/app_repos/route.ts

import { NextRequest } from 'next/server';

export async function GET(req: NextRequest): Promise<Response> {
  const { searchParams } = new URL(req.url);
  const installationId = searchParams.get('installationId');

  // Validate installation ID
  if (!installationId) {
    return new Response(JSON.stringify({ error: 'Missing installationId' }), {
      status: 400,
    });
  }

  // Validate installation ID is a valid number
  const installationIdNum = Number(installationId);
  if (isNaN(installationIdNum) || installationIdNum <= 0) {
    return new Response(JSON.stringify({ error: 'Invalid installationId format' }), {
      status: 400,
    });
  }

  // Authenticate the user making the request
  const authHeader = req.headers.get('authorization');
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Missing or invalid authorization header' }), {
      status: 401,
    });
  }

  const userAccessToken = authHeader.split(' ')[1];

  if (!userAccessToken || userAccessToken.length < 10) {
    return new Response(JSON.stringify({ error: 'Invalid access token format' }), {
      status: 401,
    });
  }

  try {
    // Log the security-sensitive operation
    console.log(`[SECURITY] Repository access request: installationId=${installationId}, hasAuth=${!!userAccessToken}`);

    // First, verify the user has access to this installation
    const userInstallationsRes = await fetch('https://api.github.com/user/installations', {
      headers: {
        Authorization: `Bearer ${userAccessToken}`,
        Accept: 'application/vnd.github+json',
      },
    });

    if (!userInstallationsRes.ok) {
      console.log(`[SECURITY] Failed to verify user installations: ${userInstallationsRes.status}`);
      return new Response(JSON.stringify({ error: 'Unable to verify user installations' }), {
        status: 403,
      });
    }

    const userInstallations = await userInstallationsRes.json();
    const hasAccess = userInstallations.installations?.some(
      (installation: any) => installation.id === installationIdNum
    );

    if (!hasAccess) {
      console.log(`[SECURITY] Access denied: user does not have access to installation ${installationId}`);
      return new Response(JSON.stringify({ error: 'Access denied to this installation' }), {
        status: 403,
      });
    }

    // Get repositories accessible to the user for this specific installation
    const userReposRes = await fetch(
      `https://api.github.com/user/installations/${installationId}/repositories`,
      {
        headers: {
          Authorization: `Bearer ${userAccessToken}`,
          Accept: 'application/vnd.github+json',
        },
      }
    );

    if (!userReposRes.ok) {
      const errorData = await userReposRes.json();
      return new Response(
        JSON.stringify({ error: errorData.message || 'Failed to fetch repositories' }),
        { status: userReposRes.status }
      );
    }

    const userReposData = await userReposRes.json();

    console.log(`[DEBUG] Installation ID: ${installationId}`);
    console.log(`[DEBUG] User has access to ${userReposData.repositories?.length || 0} repositories`);

    return new Response(
      JSON.stringify({
        repositories: userReposData.repositories || [],
        total_count: userReposData.total_count || 0,
      }),
      {
        status: 200,
      },
    );
  } catch (error: unknown) {
    console.error('[GITHUB ERROR]', error);

    const message = error instanceof Error ? error.message : 'Internal Server Error';

    return new Response(JSON.stringify({ error: message }), {
      status: 500,
    });
  }
}
