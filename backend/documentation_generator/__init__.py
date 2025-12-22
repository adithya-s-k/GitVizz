from .structures import WikiPage, WikiSection, WikiStructure, Document, RepositoryAnalysis

# Graph-aware modules (no LLM dependencies)
from .graph_doc_analyzer import GraphDocAnalyzer, DocTopic, ClusterContext, FileContext
from .mermaid_generator import MermaidGenerator

# Lazy imports for modules with LLM dependencies
def _get_doc_generator():
    from .core import DocumentationGenerator
    return DocumentationGenerator

def _get_graph_aware_generator():
    from .graph_aware_generator import GraphAwareDocGenerator
    return GraphAwareDocGenerator

def _get_documentation_api():
    from .api import app
    return app

__all__ = [
    # V1 (legacy)
    'DocumentationGenerator',
    # V2 (graph-aware) 
    'GraphAwareDocGenerator',
    'GraphDocAnalyzer',
    'DocTopic',
    'ClusterContext',
    'FileContext',
    'MermaidGenerator',
    # API
    'documentation_api', 
    # Data structures
    'WikiPage',
    'WikiSection', 
    'WikiStructure',
    'RepositoryAnalysis',
    'Document'
]

# For backward compatibility, expose via __getattr__
def __getattr__(name):
    if name == 'DocumentationGenerator':
        return _get_doc_generator()
    elif name == 'GraphAwareDocGenerator':
        return _get_graph_aware_generator()
    elif name == 'generate_documentation':
        from .graph_aware_generator import generate_documentation
        return generate_documentation
    elif name == 'documentation_api':
        return _get_documentation_api()
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")

