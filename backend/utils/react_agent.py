"""
ReAct Agent for Codebase Chat
Implements REASON → ACT → OBSERVE → REPEAT loop for intelligent codebase exploration
"""

import json
import time
import logging
from typing import Dict, List, Optional, Any, AsyncGenerator
from datetime import datetime
from dataclasses import dataclass, field
from pydantic import BaseModel

from utils.llm_utils import llm_service, LLMResponse, LLMStreamResponse
from utils.graph_utils import GraphUtils, SearchResult, GraphNode

logger = logging.getLogger(__name__)


# ==================== MODELS AND SCHEMAS ====================

class ReasoningResponse(BaseModel):
    """Response from reasoning phase"""
    reasoning: str
    confidence: float
    missing_info: List[str]
    proposed_action: str
    action_parameters: Dict[str, Any]
    expected_outcome: str


class SatisfactionEvaluation(BaseModel):
    """Evaluation of whether we have enough information"""
    is_satisfied: bool
    satisfaction_score: float
    reasons: List[str]
    remaining_gaps: List[str]


class AgentResponse(BaseModel):
    """Final agent response"""
    success: bool
    answer: str
    iterations_used: int
    total_nodes_discovered: int
    confidence_score: float
    search_summary: List[str]
    error: Optional[str] = None


class StreamAgentResponse(BaseModel):
    """Streaming response for agent operations"""
    type: str  # reasoning, action, observation, complete, error
    content: Optional[str] = None
    iteration: int
    action: Optional[str] = None
    action_result: Optional[Dict[str, Any]] = None
    confidence: Optional[float] = None
    error: Optional[str] = None


@dataclass
class IterationMemory:
    """Memory for a single ReAct iteration"""
    reasoning: ReasoningResponse
    action_result: Any
    observation: str
    timestamp: datetime = field(default_factory=datetime.now)


@dataclass
class WorkingMemory:
    """Agent working memory across iterations"""
    user_query: str = ""
    iterations: List[IterationMemory] = field(default_factory=list)
    discovered_nodes: Dict[str, GraphNode] = field(default_factory=dict)
    key_insights: List[str] = field(default_factory=list)
    search_history: List[str] = field(default_factory=list)
    confidence_progression: List[float] = field(default_factory=list)
    
    def reset(self):
        """Reset memory for new query"""
        self.user_query = ""
        self.iterations.clear()
        self.discovered_nodes.clear()
        self.key_insights.clear()
        self.search_history.clear()
        self.confidence_progression.clear()
    
    def add_iteration(self, reasoning: ReasoningResponse, action_result: Any, observation: str):
        """Add a new iteration to memory"""
        iteration = IterationMemory(reasoning, action_result, observation)
        self.iterations.append(iteration)
        self.confidence_progression.append(reasoning.confidence)
    
    def get_current_understanding(self) -> str:
        """Summarize what we've learned so far"""
        if not self.iterations:
            return "No exploration has been done yet."
        
        understanding = []
        understanding.append(f"Discovered {len(self.discovered_nodes)} code components so far.")
        
        if self.key_insights:
            understanding.append("Key insights:")
            for insight in self.key_insights[-3:]:  # Last 3 insights
                understanding.append(f"- {insight}")
        
        if self.search_history:
            understanding.append(f"Search history: {', '.join(self.search_history[-3:])}")
        
        return "\n".join(understanding)
    
    def get_knowledge_gaps(self) -> List[str]:
        """Identify what we still don't know"""
        gaps = []
        
        if not self.iterations:
            gaps.append("No exploration has been performed yet")
            return gaps
        
        latest_reasoning = self.iterations[-1].reasoning
        gaps.extend(latest_reasoning.missing_info)
        
        return gaps
    
    def get_relevant_context(self) -> str:
        """Get most relevant discovered information"""
        if not self.discovered_nodes:
            return "No relevant code components have been discovered yet."
        
        # Prioritize nodes by category and relevance
        context_parts = []
        context_parts.append(f"Discovered {len(self.discovered_nodes)} relevant components:")
        
        # Group by category
        by_category = {}
        for node in self.discovered_nodes.values():
            if node.category not in by_category:
                by_category[node.category] = []
            by_category[node.category].append(node)
        
        for category, nodes in by_category.items():
            context_parts.append(f"\n{category.title()}s ({len(nodes)}):")
            for node in nodes[:3]:  # Limit to 3 per category
                context_parts.append(f"- {node.name} ({node.file})")
        
        return "\n".join(context_parts)


# ==================== ACTION DEFINITIONS ====================

SEARCH_ACTIONS = {
    "search_by_name": {
        "description": "Search for code components by exact or partial name match",
        "parameters": {"query": str, "limit": int}
    },
    "search_by_pattern": {
        "description": "Search using regex patterns or wildcards",
        "parameters": {"pattern": str, "limit": int}
    },
    "search_code_content": {
        "description": "Search within code content for specific terms or logic",
        "parameters": {"query": str, "limit": int}
    },
    "search_by_category": {
        "description": "Find all components of a specific type (function, class, etc.)",
        "parameters": {"category": str, "limit": int}
    },
    "fuzzy_search": {
        "description": "Find similar matches when exact search fails",
        "parameters": {"query": str, "threshold": float, "limit": int}
    },
    "smart_search": {
        "description": "Intelligent search combining multiple strategies",
        "parameters": {"query": str, "limit": int}
    }
}

EXPLORATION_ACTIONS = {
    "get_connected_nodes": {
        "description": "Explore relationships and dependencies of found components",
        "parameters": {"node_id": str, "relationship": str, "direction": str, "limit": int}
    },
    "get_node_neighbors": {
        "description": "Get parents, children, siblings, and dependencies of a component",
        "parameters": {"node_id": str, "max_neighbors": int}
    },
    "traverse_graph": {
        "description": "Explore code structure through breadth-first or depth-first traversal",
        "parameters": {"start_node": str, "max_depth": int, "traversal_type": str}
    }
}

ANALYSIS_ACTIONS = {
    "build_focused_context": {
        "description": "Build detailed context around specific nodes",
        "parameters": {"node_ids": List[str], "include_neighbors": bool}
    },
    "analyze_code_structure": {
        "description": "Analyze architectural patterns and code organization",
        "parameters": {"nodes": List[str]}
    }
}


# ==================== REASONING PROMPTS ====================

REASONING_PROMPT = """
You are a senior software engineer with deep knowledge of codebases. You're helping a user understand their code.

CURRENT SITUATION:
User Query: {user_query}
Current Understanding: {current_understanding}
Previous Actions Taken: {previous_actions}
Information Gathered So Far: {gathered_info}
Gaps in Knowledge: {knowledge_gaps}

AVAILABLE ACTIONS:
{available_actions}

Your task is to REASON about what to do next:

1. ANALYZE the current situation
2. IDENTIFY what information is missing
3. CHOOSE the best action to gather that information
4. EXPLAIN your reasoning

Respond in JSON format with:
- reasoning: Your step-by-step thinking process
- confidence: How confident you are in current knowledge (0.0-1.0)
- missing_info: Array of specific information you still need
- proposed_action: The action you want to take
- action_parameters: Parameters for the action
- expected_outcome: What you expect to learn from this action
"""

SATISFACTION_PROMPT = """
TASK: Evaluate if we have sufficient information to comprehensively answer the user's query.

USER QUERY: {user_query}

INFORMATION DISCOVERED:
{discovered_info}

ANALYSIS CRITERIA:
1. Completeness: Do we have all necessary components/information?
2. Relevance: Is the information directly related to the query?
3. Depth: Do we understand the implementation details enough?
4. Context: Do we have sufficient surrounding context?
5. Examples: Do we have concrete examples or usage patterns?

Respond in JSON format with:
- is_satisfied: Boolean indicating if query can be answered
- satisfaction_score: Float from 0.0 to 1.0
- reasons: Array of reasons why we are/aren't satisfied
- remaining_gaps: Array of specific gaps that still need to be filled
"""

FINAL_RESPONSE_PROMPT = """
Based on your exploration of the codebase, provide a comprehensive answer to the user's query.

USER QUERY: {user_query}

DISCOVERED INFORMATION:
{discovered_info}

EXPLORATION SUMMARY:
{exploration_summary}

Provide a detailed, accurate response that:
1. Directly answers the user's question
2. References specific files and line numbers when relevant
3. Includes code examples if appropriate
4. Explains the context and relationships
5. Provides actionable insights or recommendations

Be thorough but focused on what's most relevant to the user's query.
"""


# ==================== REACT AGENT IMPLEMENTATION ====================

class CodebaseReActAgent:
    """ReAct Agent for intelligent codebase exploration"""
    
    def __init__(self, graph_utils: GraphUtils):
        self.graph = graph_utils
        self.working_memory = WorkingMemory()
        self.max_iterations = 5
        self.satisfaction_threshold = 0.8
    
    def get_available_actions_description(self) -> str:
        """Get formatted description of available actions"""
        all_actions = {**SEARCH_ACTIONS, **EXPLORATION_ACTIONS, **ANALYSIS_ACTIONS}
        
        descriptions = []
        for action, info in all_actions.items():
            descriptions.append(f"- {action}: {info['description']}")
        
        return "\n".join(descriptions)
    
    async def process_query(self, user_query: str, stream: bool = False) -> AgentResponse:
        """Process user query with ReAct loop (non-streaming)"""
        if stream:
            # For streaming, we need to collect all results
            response_parts = []
            async for chunk in self.process_query_streaming(user_query):
                if chunk.type == "complete":
                    return AgentResponse(
                        success=True,
                        answer=chunk.content or "",
                        iterations_used=len(self.working_memory.iterations),
                        total_nodes_discovered=len(self.working_memory.discovered_nodes),
                        confidence_score=self.working_memory.confidence_progression[-1] if self.working_memory.confidence_progression else 0.0,
                        search_summary=self.working_memory.search_history
                    )
        
        # Initialize working memory
        self.working_memory.reset()
        self.working_memory.user_query = user_query
        
        try:
            iteration = 0
            while iteration < self.max_iterations:
                # REASON
                reasoning = await self.reason()
                
                # ACT
                action_result = await self.act(reasoning.proposed_action, reasoning.action_parameters)
                
                # OBSERVE
                observation = self.observe(action_result, reasoning.proposed_action)
                
                # UPDATE MEMORY
                self.working_memory.add_iteration(reasoning, action_result, observation)
                
                # CHECK SATISFACTION
                satisfaction = await self.evaluate_satisfaction()
                
                if satisfaction.is_satisfied:
                    break
                
                iteration += 1
            
            # FINAL RESPONSE
            final_answer = await self.generate_final_response()
            
            return AgentResponse(
                success=True,
                answer=final_answer,
                iterations_used=len(self.working_memory.iterations),
                total_nodes_discovered=len(self.working_memory.discovered_nodes),
                confidence_score=self.working_memory.confidence_progression[-1] if self.working_memory.confidence_progression else 0.0,
                search_summary=self.working_memory.search_history
            )
            
        except Exception as e:
            logger.error(f"Error in ReAct agent processing: {e}")
            return AgentResponse(
                success=False,
                answer="",
                iterations_used=len(self.working_memory.iterations),
                total_nodes_discovered=len(self.working_memory.discovered_nodes),
                confidence_score=0.0,
                search_summary=self.working_memory.search_history,
                error=str(e)
            )
    
    async def process_query_streaming(self, user_query: str) -> AsyncGenerator[StreamAgentResponse, None]:
        """Process user query with ReAct loop (streaming version)"""
        # Initialize working memory
        self.working_memory.reset()
        self.working_memory.user_query = user_query
        
        try:
            iteration = 0
            while iteration < self.max_iterations:
                # REASON
                yield StreamAgentResponse(
                    type="reasoning",
                    content="Analyzing query and planning next action...",
                    iteration=iteration
                )
                
                reasoning = await self.reason()
                
                yield StreamAgentResponse(
                    type="reasoning",
                    content=reasoning.reasoning,
                    iteration=iteration,
                    confidence=reasoning.confidence
                )
                
                # ACT
                yield StreamAgentResponse(
                    type="action",
                    content=f"Executing: {reasoning.proposed_action}",
                    iteration=iteration,
                    action=reasoning.proposed_action
                )
                
                action_result = await self.act(reasoning.proposed_action, reasoning.action_parameters)
                
                # OBSERVE
                observation = self.observe(action_result, reasoning.proposed_action)
                
                yield StreamAgentResponse(
                    type="observation",
                    content=observation,
                    iteration=iteration,
                    action_result={
                        "action": reasoning.proposed_action,
                        "parameters": reasoning.action_parameters,
                        "nodes_found": len(action_result.nodes) if hasattr(action_result, 'nodes') else 0
                    }
                )
                
                # UPDATE MEMORY
                self.working_memory.add_iteration(reasoning, action_result, observation)
                
                # CHECK SATISFACTION
                satisfaction = await self.evaluate_satisfaction()
                
                if satisfaction.is_satisfied:
                    break
                
                iteration += 1
            
            # FINAL RESPONSE
            final_answer = await self.generate_final_response()
            
            yield StreamAgentResponse(
                type="complete",
                content=final_answer,
                iteration=iteration,
                confidence=self.working_memory.confidence_progression[-1] if self.working_memory.confidence_progression else 0.0
            )
            
        except Exception as e:
            logger.error(f"Error in streaming ReAct agent: {e}")
            yield StreamAgentResponse(
                type="error",
                error=str(e),
                iteration=len(self.working_memory.iterations)
            )
    
    async def reason(self) -> ReasoningResponse:
        """Generate reasoning for next action"""
        
        # Prepare action history
        previous_actions = []
        for i, iteration in enumerate(self.working_memory.iterations):
            previous_actions.append(f"Iteration {i+1}: {iteration.reasoning.proposed_action} -> {iteration.observation[:100]}...")
        
        prompt = REASONING_PROMPT.format(
            user_query=self.working_memory.user_query,
            current_understanding=self.working_memory.get_current_understanding(),
            previous_actions="\n".join(previous_actions) if previous_actions else "None",
            gathered_info=self.working_memory.get_relevant_context(),
            knowledge_gaps="\n".join(self.working_memory.get_knowledge_gaps()),
            available_actions=self.get_available_actions_description()
        )
        
        response = await llm_service.generate(
            messages=[{"role": "user", "content": prompt}],
            model="gpt-4o-mini",
            response_format={"type": "json_object"},
            temperature=0.3
        )
        
        if not response.success:
            raise Exception(f"Reasoning failed: {response.error}")
        
        try:
            reasoning_data = json.loads(response.content)
            
            # Handle case where LLM returns arrays instead of strings
            for key, value in reasoning_data.items():
                if isinstance(value, list) and key == "missing_info":
                    # Keep missing_info as list but ensure items are strings
                    reasoning_data[key] = [str(item) for item in value]
                elif isinstance(value, list):
                    reasoning_data[key] = " ".join(str(item) for item in value)
                elif isinstance(value, str) and key == "missing_info":
                    # Convert string to list for missing_info
                    reasoning_data[key] = [value]
            
            return ReasoningResponse(**reasoning_data)
        except (json.JSONDecodeError, TypeError) as e:
            raise Exception(f"Invalid reasoning response format: {e}")
    
    async def act(self, action: str, parameters: Dict[str, Any]) -> Any:
        """Execute the proposed action"""
        self.working_memory.search_history.append(f"{action}({parameters})")
        
        if action in SEARCH_ACTIONS:
            return await self.execute_search_action(action, parameters)
        elif action in EXPLORATION_ACTIONS:
            return await self.execute_exploration_action(action, parameters)
        elif action in ANALYSIS_ACTIONS:
            return await self.execute_analysis_action(action, parameters)
        else:
            logger.warning(f"Unknown action: {action}")
            return SearchResult([], "unknown", str(parameters), 0, 0)
    
    async def execute_search_action(self, action: str, params: Dict) -> SearchResult:
        """Execute search actions using GraphUtils"""
        try:
            if action == "search_by_name":
                return self.graph.search_by_name(
                    params.get("query", ""), 
                    params.get("limit", 20)
                )
            elif action == "search_by_pattern":
                return self.graph.search_by_pattern(
                    params.get("pattern", ""), 
                    params.get("limit", 20)
                )
            elif action == "search_code_content":
                return self.graph.search_by_code_content(
                    params.get("query", ""), 
                    params.get("limit", 10)
                )
            elif action == "search_by_category":
                return self.graph.search_by_category(
                    params.get("category", ""), 
                    params.get("limit", 50)
                )
            elif action == "fuzzy_search":
                return self.graph.fuzzy_search(
                    params.get("query", ""), 
                    params.get("limit", 15),
                    params.get("threshold", 0.6)
                )
            elif action == "smart_search":
                return self.graph.smart_search(
                    params.get("query", ""), 
                    params.get("limit", 20)
                )
            else:
                return SearchResult([], action, str(params), 0, 0)
                
        except Exception as e:
            logger.error(f"Error executing search action {action}: {e}")
            return SearchResult([], action, str(params), 0, 0)
    
    async def execute_exploration_action(self, action: str, params: Dict) -> Any:
        """Execute exploration actions using GraphUtils"""
        try:
            if action == "get_connected_nodes":
                nodes = self.graph.get_connected_nodes(
                    params.get("node_id", ""),
                    params.get("relationship"),
                    params.get("direction", "both"),
                    params.get("limit", 20)
                )
                return SearchResult(nodes, action, str(params), 0, len(nodes))
            
            elif action == "get_node_neighbors":
                neighbors_dict = self.graph.get_node_neighbors(
                    params.get("node_id", ""),
                    params.get("max_neighbors", 10)
                )
                # Flatten all neighbor types into a single list
                all_neighbors = []
                for neighbors in neighbors_dict.values():
                    all_neighbors.extend(neighbors)
                return SearchResult(all_neighbors, action, str(params), 0, len(all_neighbors))
            
            elif action == "traverse_graph":
                traversal_type = params.get("traversal_type", "bfs")
                if traversal_type == "bfs":
                    traversal_result = self.graph.bfs_traversal(
                        params.get("start_node", ""),
                        params.get("max_depth", 3)
                    )
                else:
                    traversal_result = self.graph.dfs_traversal(
                        params.get("start_node", ""),
                        params.get("max_depth", 3)
                    )
                
                # Flatten traversal results
                all_nodes = []
                for depth_nodes in traversal_result.values():
                    all_nodes.extend(depth_nodes)
                return SearchResult(all_nodes, action, str(params), 0, len(all_nodes))
            
            else:
                return SearchResult([], action, str(params), 0, 0)
                
        except Exception as e:
            logger.error(f"Error executing exploration action {action}: {e}")
            return SearchResult([], action, str(params), 0, 0)
    
    async def execute_analysis_action(self, action: str, params: Dict) -> Any:
        """Execute analysis actions using GraphUtils"""
        try:
            if action == "build_focused_context":
                context_result = self.graph.build_focused_context(
                    params.get("node_ids", []),
                    params.get("include_neighbors", True)
                )
                return context_result
            
            elif action == "analyze_code_structure":
                # For code structure analysis, get nodes by IDs and return them
                node_ids = params.get("nodes", [])
                nodes = [self.graph.nodes_by_id.get(node_id) for node_id in node_ids]
                nodes = [node for node in nodes if node is not None]
                return SearchResult(nodes, action, str(params), 0, len(nodes))
            
            else:
                return SearchResult([], action, str(params), 0, 0)
                
        except Exception as e:
            logger.error(f"Error executing analysis action {action}: {e}")
            return SearchResult([], action, str(params), 0, 0)
    
    def observe(self, action_result: Any, action_name: str) -> str:
        """Generate observations from action results"""
        
        if isinstance(action_result, SearchResult):
            observation = f"""
SEARCH COMPLETED: {action_name}
- Found {len(action_result.nodes)} results in {action_result.execution_time_ms}ms
- Query: {action_result.query}

KEY FINDINGS:
{self.summarize_search_results(action_result)}

RELEVANCE ASSESSMENT:
{self.assess_relevance_to_query(action_result)}
"""
            # Update discovered nodes
            for node in action_result.nodes:
                self.working_memory.discovered_nodes[node.id] = node
            
            return observation.strip()
        
        else:
            return f"Action {action_name} completed with result: {str(action_result)[:200]}..."
    
    def summarize_search_results(self, result: SearchResult) -> str:
        """Summarize search results for observation"""
        if not result.nodes:
            return "No relevant components found."
        
        summary = []
        
        # Group by category
        by_category = {}
        for node in result.nodes:
            if node.category not in by_category:
                by_category[node.category] = []
            by_category[node.category].append(node)
        
        for category, nodes in by_category.items():
            summary.append(f"- {len(nodes)} {category}{'s' if len(nodes) > 1 else ''}: {', '.join([n.name for n in nodes[:3]])}")
            if len(nodes) > 3:
                summary[-1] += f" and {len(nodes) - 3} more"
        
        return "\n".join(summary)
    
    def assess_relevance_to_query(self, result: SearchResult) -> str:
        """Assess how relevant the results are to the user query"""
        if not result.nodes:
            return "No results to assess."
        
        query_terms = self.working_memory.user_query.lower().split()
        relevant_count = 0
        
        for node in result.nodes:
            node_text = f"{node.name} {node.category} {node.code or ''}".lower()
            if any(term in node_text for term in query_terms):
                relevant_count += 1
        
        relevance_score = relevant_count / len(result.nodes)
        
        if relevance_score > 0.7:
            return f"High relevance: {relevant_count}/{len(result.nodes)} results directly related to query"
        elif relevance_score > 0.3:
            return f"Moderate relevance: {relevant_count}/{len(result.nodes)} results related to query"
        else:
            return f"Low relevance: {relevant_count}/{len(result.nodes)} results related to query - may need different search strategy"
    
    async def evaluate_satisfaction(self) -> SatisfactionEvaluation:
        """Determine if we have enough information to answer the user's query"""
        
        prompt = SATISFACTION_PROMPT.format(
            user_query=self.working_memory.user_query,
            discovered_info=self.working_memory.get_relevant_context()
        )
        
        response = await llm_service.generate(
            messages=[{"role": "user", "content": prompt}],
            model="gpt-4o-mini",
            response_format={"type": "json_object"},
            temperature=0.1
        )
        
        if not response.success:
            # Default to not satisfied if evaluation fails
            return SatisfactionEvaluation(
                is_satisfied=False,
                satisfaction_score=0.0,
                reasons=["Failed to evaluate satisfaction"],
                remaining_gaps=["Evaluation error"]
            )
        
        try:
            satisfaction_data = json.loads(response.content)
            
            # Handle case where LLM returns arrays instead of strings
            for key, value in satisfaction_data.items():
                if isinstance(value, list) and key in ["reasons", "remaining_gaps"]:
                    # Keep these as lists but ensure they are strings
                    satisfaction_data[key] = [str(item) for item in value]
                elif isinstance(value, list):
                    satisfaction_data[key] = " ".join(str(item) for item in value)
            
            return SatisfactionEvaluation(**satisfaction_data)
        except (json.JSONDecodeError, TypeError) as e:
            logger.error(f"Invalid satisfaction evaluation format: {e}")
            return SatisfactionEvaluation(
                is_satisfied=False,
                satisfaction_score=0.0,
                reasons=["Invalid evaluation response"],
                remaining_gaps=["Evaluation parsing error"]
            )
    
    async def generate_final_response(self) -> str:
        """Generate comprehensive final response"""
        
        # Prepare exploration summary
        exploration_summary = []
        for i, iteration in enumerate(self.working_memory.iterations):
            exploration_summary.append(
                f"Step {i+1}: {iteration.reasoning.proposed_action} -> "
                f"Found {len(iteration.action_result.nodes) if hasattr(iteration.action_result, 'nodes') else 'N/A'} items"
            )
        
        prompt = FINAL_RESPONSE_PROMPT.format(
            user_query=self.working_memory.user_query,
            discovered_info=self.working_memory.get_relevant_context(),
            exploration_summary="\n".join(exploration_summary)
        )
        
        response = await llm_service.generate(
            messages=[{"role": "user", "content": prompt}],
            model="claude-3-5-sonnet-20241022",
            temperature=0.3,
            max_tokens=2000
        )
        
        if response.success:
            return response.content
        else:
            return f"Error generating final response: {response.error}"


# ==================== GLOBAL INSTANCE ====================

# This will be initialized with graph data when needed
react_agent = None

def get_react_agent(graph_utils: GraphUtils) -> CodebaseReActAgent:
    """Get or create ReAct agent instance"""
    global react_agent
    if react_agent is None:
        react_agent = CodebaseReActAgent(graph_utils)
    else:
        # Update graph utils in case it changed
        react_agent.graph = graph_utils
    return react_agent