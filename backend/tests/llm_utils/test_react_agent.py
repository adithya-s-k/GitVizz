#!/usr/bin/env python3
"""
Test ReAct Agent Implementation
Simple test to verify the ReAct agent works with existing graph utilities
"""

import asyncio
import sys
import os

# Add backend to path
sys.path.append(os.path.join(os.path.dirname(__file__), '..', '..'))

# Load environment variables
try:
    from dotenv import load_dotenv
    load_dotenv()
    print("✅ Loaded .env file")
except ImportError:
    print("⚠️  python-dotenv not available")

from utils.graph_utils import GraphUtils
from utils.react_agent import get_react_agent


async def test_react_agent_basic():
    """Test basic ReAct agent functionality"""
    print("\n🤖 Testing ReAct Agent")
    print("="*50)
    
    # Create mock graph data for testing
    graph_utils = GraphUtils()
    
    # Create some sample nodes and edges for testing
    from schemas.graph_schemas import GraphNode, GraphEdge, GraphData
    
    mock_nodes = [
        GraphNode(
            id="node1",
            name="authenticate_user",
            category="function",
            file="auth.py",
            start_line=10,
            end_line=25,
            code="def authenticate_user(token):\n    return validate_jwt(token)"
        ),
        GraphNode(
            id="node2", 
            name="validate_jwt",
            category="function",
            file="auth.py",
            start_line=30,
            end_line=45,
            code="def validate_jwt(token):\n    return jwt.decode(token, secret)"
        ),
        GraphNode(
            id="node3",
            name="UserController",
            category="class",
            file="controllers/user.py",
            start_line=1,
            end_line=50,
            code="class UserController:\n    def __init__(self):\n        pass"
        )
    ]
    
    mock_edges = [
        GraphEdge(source="node1", target="node2", relationship="calls"),
        GraphEdge(source="node3", target="node1", relationship="references_symbol")
    ]
    
    # Initialize with mock data
    graph_data = GraphData(nodes=mock_nodes, edges=mock_edges)
    graph_utils.graph_data = graph_data
    graph_utils._build_indices()
    
    # Get agent
    agent = get_react_agent(graph_utils)
    
    print("Testing agent with mock graph data:")
    print(f"- {len(mock_nodes)} nodes")
    print(f"- {len(mock_edges)} edges")
    
    # Test query
    test_query = "How does user authentication work?"
    print(f"\nQuery: {test_query}")
    
    try:
        # Test non-streaming first
        print("\n--- Non-streaming test ---")
        response = await agent.process_query(test_query)
        
        print(f"Success: {response.success}")
        print(f"Iterations used: {response.iterations_used}")
        print(f"Nodes discovered: {response.total_nodes_discovered}")
        print(f"Confidence: {response.confidence_score:.2f}")
        print(f"Answer: {response.answer[:200]}...")
        
        # Test streaming
        print("\n--- Streaming test ---")
        async for chunk in agent.process_query_streaming(test_query):
            print(f"{chunk.type}: {chunk.content[:100] if chunk.content else 'N/A'}...")
            if chunk.type == "complete":
                print("✅ Streaming completed successfully")
                break
                
    except Exception as e:
        print(f"❌ Error testing agent: {e}")
        import traceback
        traceback.print_exc()


async def test_graph_operations():
    """Test graph operations used by the agent"""
    print("\n📊 Testing Graph Operations")
    print("="*50)
    
    graph_utils = GraphUtils()
    
    # Test search operations that the agent will use
    print("Testing search operations:")
    
    # This will return empty results but shouldn't crash
    result = graph_utils.search_by_name("test", limit=5)
    print(f"- search_by_name: {len(result.nodes)} results")
    
    result = graph_utils.search_by_code_content("function", limit=5)
    print(f"- search_by_code_content: {len(result.nodes)} results")
    
    result = graph_utils.fuzzy_search("auth", limit=5)
    print(f"- fuzzy_search: {len(result.nodes)} results")
    
    print("✅ Graph operations test completed")


async def main():
    """Run all tests"""
    print("🧪 ReAct Agent Tests")
    
    try:
        await test_graph_operations()
        await test_react_agent_basic()
        
        print("\n\n✅ All tests completed!")
        
    except Exception as e:
        print(f"\n❌ Error running tests: {e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    asyncio.run(main())