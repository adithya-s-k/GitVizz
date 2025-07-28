import { NextRequest } from 'next/server';
import { auth } from '@/utils/auth';

interface GraphChunk {
  chunk_id: number;
  nodes: any[];
  edges: any[];
  total_chunks: number;
  progress: number;
  is_final: boolean;
  metadata?: {
    total_nodes: number;
    total_edges: number;
    chunk_size: number;
  };
}

interface StreamRequest {
  repo_url?: string;
  branch?: string;
  access_token?: string;
  zip_file?: File;
  chunk_size?: number;
  priority_nodes?: boolean; // Load important nodes first
  include_metadata?: boolean;
}

export async function POST(req: NextRequest): Promise<Response> {
  // Check authentication
  const session = await auth();
  if (!session?.jwt_token) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { 
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const requestData: StreamRequest = await req.json();
    
    // Default chunk size for optimal performance
    const chunkSize = Math.min(Math.max(requestData.chunk_size || 200, 50), 500);
    
    // Create a readable stream for chunked responses
    const encoder = new TextEncoder();
    
    const stream = new ReadableStream({
      async start(controller) {
        try {
          // First, get the complete graph from backend (we'll optimize this later)
          const backendResponse = await fetch(`${process.env.BACKEND_URL || 'http://localhost:8003'}/api/repo/generate-graph`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${session.jwt_token}`,
            },
            body: JSON.stringify({
              repo_url: requestData.repo_url,
              branch: requestData.branch || 'main',
              access_token: requestData.access_token,
              zip_file: requestData.zip_file,
              jwt_token: session.jwt_token,
            }),
          });

          if (!backendResponse.ok) {
            throw new Error(`Backend error: ${backendResponse.status}`);
          }

          const fullGraphData = await backendResponse.json();
          const { nodes = [], edges = [] } = fullGraphData;

          // Sort nodes by importance if priority loading is enabled
          let sortedNodes = [...nodes];
          if (requestData.priority_nodes) {
            sortedNodes.sort((a, b) => {
              // Sort by importance heuristics:
              // 1. Modules first
              // 2. Classes second  
              // 3. Functions/methods third
              // 4. By name length (shorter names often more important)
              
              const categoryPriority = {
                'module': 1,
                'class': 2,
                'function': 3,
                'method': 3,
                'external_symbol': 4,
                'directory': 5
              };
              
              const aPriority = categoryPriority[a.category as keyof typeof categoryPriority] || 6;
              const bPriority = categoryPriority[b.category as keyof typeof categoryPriority] || 6;
              
              if (aPriority !== bPriority) {
                return aPriority - bPriority;
              }
              
              // Secondary sort by name length (shorter = more important)
              return (a.name?.length || 999) - (b.name?.length || 999);
            });
          }

          const totalChunks = Math.ceil(sortedNodes.length / chunkSize);
          
          // Send metadata first if requested
          if (requestData.include_metadata) {
            const metadataChunk: GraphChunk = {
              chunk_id: -1,
              nodes: [],
              edges: [],
              total_chunks: totalChunks,
              progress: 0,
              is_final: false,
              metadata: {
                total_nodes: nodes.length,
                total_edges: edges.length,
                chunk_size: chunkSize,
              }
            };
            
            const chunk = encoder.encode(`data: ${JSON.stringify(metadataChunk)}\n\n`);
            controller.enqueue(chunk);
          }

          // Send nodes in chunks
          for (let i = 0; i < sortedNodes.length; i += chunkSize) {
            const chunkNodes = sortedNodes.slice(i, i + chunkSize);
            const chunkId = Math.floor(i / chunkSize);
            
            // Get edges that involve nodes in this chunk
            const nodeIds = new Set(chunkNodes.map(node => node.id));
            const chunkEdges = edges.filter((edge: any) => 
              nodeIds.has(edge.source) || nodeIds.has(edge.target)
            );

            const chunk: GraphChunk = {
              chunk_id: chunkId,
              nodes: chunkNodes,
              edges: chunkEdges,
              total_chunks: totalChunks,
              progress: Math.min((i + chunkNodes.length) / sortedNodes.length, 1),
              is_final: i + chunkSize >= sortedNodes.length,
            };

            const encodedChunk = encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`);
            controller.enqueue(encodedChunk);

            // Small delay to prevent overwhelming the client
            if (chunkId % 5 === 0) { // Every 5 chunks
              await new Promise(resolve => setTimeout(resolve, 10));
            }
          }

          // Send completion signal
          const finalChunk = encoder.encode(`data: {"type": "complete"}\n\n`);
          controller.enqueue(finalChunk);
          
        } catch (error) {
          console.error('Graph streaming error:', error);
          
          const errorChunk = encoder.encode(`data: ${JSON.stringify({
            type: 'error',
            error: error instanceof Error ? error.message : 'Unknown error'
          })}\n\n`);
          
          controller.enqueue(errorChunk);
        } finally {
          controller.close();
        }
      }
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    });

  } catch (error) {
    console.error('Stream setup error:', error);
    
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Failed to setup graph stream' 
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// Handle preflight requests
export async function OPTIONS() {
  return new Response(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}