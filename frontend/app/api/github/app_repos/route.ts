// app/api/github/app_repos/route.ts

import { NextRequest } from 'next/server';

export async function GET(req: NextRequest): Promise<Response> {
  const { searchParams } = new URL(req.url);
  const installationId = searchParams.get('installationId');

  if (!installationId) {
    return new Response(JSON.stringify({ error: 'Missing installationId' }), {
      status: 400,
    });
  }

  // Authenticate the user making the request
  const authHeader = req.headers.get('authorization');
  const userAccessToken = authHeader?.split(' ')[1];

  if (!userAccessToken) {
    return new Response(JSON.stringify({ error: 'Missing access token' }), {
      status: 401,
    });
  }

  try {
    // First, verify the user has access to this installation
    const userInstallationsRes = await fetch('https://api.github.com/user/installations', {
      headers: {
        Authorization: `Bearer ${userAccessToken}`,
        Accept: 'application/vnd.github+json',
      },
    });

    if (!userInstallationsRes.ok) {
      return new Response(JSON.stringify({ error: 'Unable to verify user installations' }), {
        status: 403,
      });
    }

    const userInstallations = await userInstallationsRes.json();
    const hasAccess = userInstallations.installations?.some(
      (installation: any) => installation.id === Number(installationId)
    );

    if (!hasAccess) {
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
