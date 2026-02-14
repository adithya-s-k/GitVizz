from typing import Callable, Optional, List
import asyncio
from utils.llm_utils import llm_service
from documentation_generator.structures import Document, WikiStructure, WikiPage, WikiSection, RepositoryAnalysis

# LLM client using llm_utils service
class LLMClient:
    """AI client for documentation generation using llm_service (supports OpenAI, Anthropic, Gemini, Groq)."""

    def __init__(
        self,
        api_key: str = None,
        provider: str = "openai",
        model: Optional[str] = None,
        temperature: float = 0.7,
        user=None,
        use_user_key: bool = False
    ):
        self.api_key = api_key
        self.provider = provider.lower()
        self.temperature = temperature
        self.user = user
        self.use_user_key = use_user_key

        # Default model per provider
        self.default_models = {
            "openai": "gpt-4o-mini",
            "anthropic": "claude-3-5-sonnet-20241022",
            "gemini": "gemini-2.0-flash",
            "groq": "llama-3.3-70b-versatile"
        }
        self.default_model = model or self.default_models.get(self.provider, "gpt-4o-mini")

        # Validate provider
        available_models = llm_service.get_available_models()
        if self.provider not in available_models:
            raise ValueError(f"Provider '{self.provider}' not supported. Available: {list(available_models.keys())}")

    def generate_content(
        self,
        prompt: str,
        model: str = None,
        temperature: float = None,
        max_tokens: int = 4000,
        progress_callback: Callable[[str], None] = None,
    ) -> str:
        """Generate content using llm_service for the configured provider."""
        return self._run_async(self._generate_content_async(
            prompt,
            model=model,
            temperature=self.temperature if temperature is None else temperature,
            max_tokens=max_tokens,
            progress_callback=progress_callback,
        ))
    
    def _run_async(self, coro):
        """Helper to run async functions in sync context"""
        try:
            loop = asyncio.get_event_loop()
        except RuntimeError:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
        
        return loop.run_until_complete(coro)

    async def _generate_content_async(
        self,
        prompt: str,
        model: str = None,
        temperature: float = 0.7,
        max_tokens: int = 4000,
        progress_callback: Callable[[str], None] = None,
    ) -> str:
        """Generate content using llm_service with robust error handling."""
        try:
            if progress_callback:
                progress_callback(f"  Generating content with {self.provider}...")

            # Prepare messages
            messages = [{"role": "user", "content": prompt}]
            
            # Use the model parameter or fall back to instance model
            use_model = model or self.default_model

            # Generate using llm_service
            response = await llm_service.generate(
                messages=messages,
                model=use_model,
                provider=self.provider,
                temperature=temperature,
                max_tokens=max_tokens,
                stream=False,
                user=self.user,
                use_user_key=self.use_user_key,
                api_key=self.api_key
            )

            if response.success and response.content:
                if progress_callback:
                    progress_callback(f"  Generated {len(response.content)} characters")
                return response.content
            else:
                error_msg = response.error or "Unknown error in content generation"
                raise Exception(f"Content generation failed: {error_msg}")

        except Exception as e:
            error_msg = str(e)
            if progress_callback:
                progress_callback(f"  Error: {error_msg}")
            raise Exception(f"AI generation failed: {error_msg}")
    


    def generate_wiki_structure(self, repo_analysis: 'RepositoryAnalysis',
                            file_tree: str, readme_content: str,
                            repo_info: dict = None,
                            language: str = "en",
                            progress_callback: Callable[[str], None] = None) -> WikiStructure:
        """Generate wiki structure using AI - RETURN WikiStructure not string"""
        
        # Generate structure XML using async method
        structure_xml = self._run_async(
            self._generate_structure_xml_async(repo_analysis, file_tree, readme_content, repo_info, language, progress_callback)
        )
        
        # Parse and return WikiStructure
        return self._parse_wiki_structure(structure_xml)


    # _generate_structure_xml with comprehensive doc prompt version:
    async def _generate_structure_xml_async(self, repo_analysis, file_tree, readme_content, repo_info, language, progress_callback) -> str:
        """Generate comprehensive structure XML - FULL VERSION"""
        
        if repo_info is None:
            repo_info = {'repo': 'repository', 'owner': 'owner', 'type': 'local'}
        
        repo_name = f"{repo_info['owner']}/{repo_info['repo']}"
        view_type = "comprehensive"
        analysis = repo_analysis

        # structure_prompt = self._create_comprehensive_structure_prompt(repo_analysis, repo_info, language)

        full_prompt = f"""
    <role>
    You are an expert software architect and technical documentation specialist analyzing the {repo_info['type']} repository: {repo_name}.
    You have deep expertise in software architecture, design patterns, and creating professional-grade technical documentation.
    You must create a sophisticated, well-structured wiki that serves as the definitive guide to this repository.
    IMPORTANT: You MUST respond in {language} language for all content.
    </role>
    <repository_analysis>
    Repository: {repo_name}
    Domain Type: {analysis.domain_type}
    Complexity Score: {analysis.complexity_score}/10
    Total Files Processed: {len(analysis.key_files) + len(analysis.config_files) + len(analysis.test_files)}
    Languages Detected: {', '.join([f"{lang}({count})" for lang, count in list(analysis.languages.items())[:5]])}
    Frameworks/Technologies: {', '.join(analysis.frameworks[:10])}
    Architecture Patterns: {', '.join(analysis.architecture_patterns)}
    Tech Stack: {', '.join(analysis.tech_stack[:8])}

    Key Repository Structure:
    Entry Points: {', '.join(analysis.entry_points[:5])}
    Configuration Files: {', '.join(analysis.config_files[:5])}
    Documentation: {', '.join(analysis.documentation_files[:3])}
    Test Coverage: {len(analysis.test_files)} test files detected

    File Structure Overview:
    {file_tree}
    </repository_analysis>

    <readme_context>
    README Content:
    {readme_content[:2000]}...
    </readme_context>

    <comprehensive_requirements>
    Create a {view_type} repository wiki with the following sophisticated structure:

    1. STRATEGIC OVERVIEW PAGE (Highest Priority)
    - Executive summary of the repository's purpose and value proposition
    - Comprehensive architecture overview with multiple interconnected Mermaid diagrams
    - Technology stack analysis and architectural decisions
    - Repository metrics, complexity analysis, and quality indicators
    - Strategic roadmap and development philosophy

    2. TECHNICAL ARCHITECTURE DOCUMENTATION
    - Detailed system architecture with layered Mermaid diagrams (system, component, deployment)
    - Design patterns and architectural principles implementation
    - Component interaction flows with sequence diagrams
    - Data flow architecture with detailed process diagrams
    - Integration patterns and external dependencies mapping

    3. COMPONENT-LEVEL DOCUMENTATION
    - Detailed analysis of core components and modules
    - Class diagrams and object relationship mapping
    - Component lifecycle and state management
    - Inter-component communication patterns
    - API contracts and interface specifications

    4. IMPLEMENTATION GUIDES
    - Comprehensive setup and installation procedures with validation steps
    - Development environment configuration with troubleshooting guides
    - Build and deployment processes with CI/CD pipeline documentation
    - Testing strategies and quality assurance procedures
    - Performance optimization and monitoring guidelines

    5. OPERATIONAL DOCUMENTATION
    - Configuration management and environment-specific settings
    - Monitoring, logging, and observability setup
    - Security considerations and implementation details
    - Troubleshooting guides and common issue resolution
    - Maintenance procedures and update strategies

    6. DEVELOPER EXPERIENCE
    - Comprehensive usage examples with progressive complexity
    - API documentation with interactive examples
    - Contributing guidelines and development workflow
    - Code style guides and best practices
    - Extension and customization guides
    </comprehensive_requirements>

    Return your analysis in the following XML format:

    <wiki_structure>
    <title>[Overall title for the wiki]</title>
    <description>[Brief description of the repository]</description>
    <sections>
        <section id="overview">
        <title>Strategic Overview</title>
        <pages>
            <page_ref>strategic-overview</page_ref>
            <page_ref>architecture-overview</page_ref>
        </pages>
        </section>
        <section id="technical">
        <title>Technical Documentation</title>
        <pages>
            <page_ref>technical-architecture</page_ref>
            <page_ref>component-design</page_ref>
        </pages>
        </section>
    </sections>
    <pages>
        <page id="strategic-overview" title="Strategic Overview" importance="high">
        <description>Executive summary and strategic overview</description>
        <relevant_files>
            <file_path>README.md</file_path>
            <file_path>package.json</file_path>
        </relevant_files>
        <related_pages>
            <related>architecture-overview</related>
        </related_pages>
        <parent_section>overview</parent_section>
        </page>
        <!-- More pages following the same structure -->
    </pages>
    </wiki_structure>

    IMPORTANT:
    1. Create 6-8 pages that would make a {view_type} wiki for this repository
    2. Each page should focus on a specific aspect of the codebase
    3. The relevant_files should be actual files from the repository
    4. Return ONLY valid XML with the structure specified above
    5. DO NOT wrap in markdown code blocks
    6. Start directly with <wiki_structure> and end with </wiki_structure>"""

        return await self._generate_content_async(
            full_prompt,
            temperature=0.3,
            max_tokens=4000,
            progress_callback=progress_callback
        )


    def generate_page_content(
        self,
        page: 'WikiPage',
        repo_analysis: 'RepositoryAnalysis',
        documents: List[Document],
        language: str = "en",
        progress_callback: Callable[[str], None] = None,
    ) -> 'WikiPage':
        """Generate comprehensive page content using AI and return updated WikiPage."""
        return self._run_async(self._generate_page_content_async(
            page, repo_analysis, documents, language, progress_callback
        ))
    
    async def _generate_page_content_async(
        self,
        page: 'WikiPage',
        repo_analysis: 'RepositoryAnalysis',
        documents: List[Document],
        language: str = "en",
        progress_callback: Callable[[str], None] = None,
    ) -> 'WikiPage':
        """Generate comprehensive page content using AI - async version."""
        
        # Get file paths from relevant documents
        relevant_docs = documents or []
        file_paths = [doc.meta_data.get('file_path', 'unknown') for doc in relevant_docs[:10]]

        # Create comprehensive prompt exactly like page.tsx (lines 353-556)
        prompt = f"""You are an expert technical writer and software architect.
    Your task is to generate a comprehensive and accurate technical wiki page in Markdown format about a specific feature, system, or module within a given software project.

    You will be given:
    1. The "[WIKI_PAGE_TOPIC]" for the page you need to create.
    2. A list of "[RELEVANT_SOURCE_FILES]" from the project that you MUST use as the sole basis for the content. You have access to the full content of these files. You MUST use AT LEAST 5 relevant source files for comprehensive coverage.
    3. Strictly follow the mermaid syntax and it should not be broken.

    CRITICAL STARTING INSTRUCTION:
    The very first thing on the page MUST be a `<details>` block listing ALL the `[RELEVANT_SOURCE_FILES]` you used to generate the content. There MUST be AT LEAST 5 source files listed.
    Format it exactly like this:
    <details>
    <summary>Relevant source files</summary>

    The following files were used as context for generating this wiki page:

    {chr(10).join(f'- [{path}]({path})' for path in file_paths)}
    </details>

    Immediately after the `<details>` block, the main title of the page should be a H1 Markdown heading: `# {page.title}`.

    Based ONLY on the content of the `[RELEVANT_SOURCE_FILES]`:

    1. **Introduction:** Start with a concise introduction explaining what "{page.title}" is and its role in the project.

    2. **Detailed Sections:** Break down "{page.title}" into logical sections. For each section:
    - Provide clear explanations grounded in the source code
    - Include relevant code snippets with proper syntax highlighting
    - Use Mermaid diagrams extensively to visualize:
        * System architecture and component relationships
        * Data flow and process workflows
        * Class structures and inheritance
        * Sequence diagrams for interactions
        * Entity relationship diagrams for data models

    3. **Technical Implementation:**
    - Explain how the functionality is implemented
    - Highlight key algorithms, patterns, or architectural decisions
    - Show configuration examples where applicable

    4. **Usage and Integration:**
    - Provide practical examples of how to use or integrate with this component
    - Include API documentation if applicable
    - Show common usage patterns

    5. **Dependencies and Relationships:**
    - Explain how this component relates to other parts of the system
    - Document key dependencies and interfaces

    6. **Best Practices and Considerations:**
    - Document any important patterns, conventions, or best practices
    - Highlight potential gotchas or common mistakes
    - Provide troubleshooting guidance where relevant

    7. **Future Considerations:**
    - Note any planned improvements or known limitations
    - Suggest areas for potential enhancement

    WIKI_PAGE_TOPIC: {page.title}

    RELEVANT_SOURCE_FILES:
    {chr(10).join(f'File: {doc.meta_data.get("file_path", "unknown")}' + chr(10) + f'Content: {doc.text[:1500]}...' + chr(10) for doc in relevant_docs[:5])}

    Requirements:
    - Use extensive Mermaid diagrams (at least 3-4 per page)
    - Include practical code examples
    - Ground every claim in the provided source files
    - Structure the document logically for easy understanding
    - Use proper Markdown formatting
    - Focus on technical accuracy and completeness

    Remember:
    - Ground every claim in the provided source files.
    - Prioritize accuracy and direct representation of the code's functionality and structure.
    - Structure the document logically for easy understanding by other developers.
    """

        content = await self._generate_content_async(
            prompt,
            temperature=self.temperature,
            max_tokens=6000,
            progress_callback=progress_callback,
        )
        page.content = content
        return page
    
    def _validate_wiki_structure(self, structure: WikiStructure) -> WikiStructure:
        """Validate and fix common issues in parsed wiki structure"""
        
        # Ensure minimum pages
        if len(structure.pages) < 3:
            print("⚠️ Too few pages generated, adding essential pages...")
            essential_pages = [
                WikiPage(id="overview", title="📋 Overview", importance=5),
                WikiPage(id="setup", title="⚙️ Setup", importance=4),
                WikiPage(id="usage", title="📖 Usage Guide", importance=3)
            ]
            
            existing_ids = [p.id for p in structure.pages]
            for page in essential_pages:
                if page.id not in existing_ids:
                    structure.pages.append(page)
        
        # Fix empty titles
        for page in structure.pages:
            if not page.title.strip():
                page.title = f"Page {page.id.title()}"
        
        # Ensure importance values are valid (1-5)
        for page in structure.pages:
            if page.importance < 1 or page.importance > 5:
                page.importance = 3
        
        # Remove duplicate pages by ID
        seen_ids = set()
        unique_pages = []
        for page in structure.pages:
            if page.id not in seen_ids:
                seen_ids.add(page.id)
                unique_pages.append(page)
        structure.pages = unique_pages
        
        # Ensure all pages have valid IDs (no spaces, special chars)
        for page in structure.pages:
            if not page.id or ' ' in page.id or not page.id.replace('-', '').replace('_', '').isalnum():
                page.id = page.title.lower().replace(' ', '-').replace('/', '-')[:20]
        
        return structure

    def generate_ai_title(self, page_id: str, context: str, repo_info: dict = None) -> str:
        """Generate an AI-powered, context-aware title for a documentation page"""
        try:
            return self._run_async(self._generate_ai_title_async(page_id, context, repo_info))
        except Exception as e:
            print(f"Warning: Could not generate AI title, using fallback: {e}")
            return f"📋 {page_id.replace('_', ' ').replace('-', ' ').title()}"
    
    async def _generate_ai_title_async(self, page_id: str, context: str, repo_info: dict = None) -> str:
        """Generate an AI-powered title - async version"""
        repo_name = repo_info.get('repo', 'Unknown Repository') if repo_info else 'Unknown Repository'
        
        title_prompt = f"""Generate a professional, descriptive title for a documentation page.

Repository: {repo_name}
Page ID: {page_id}
Context: {context[:500]}...

Requirements:
1. Title should be professional and descriptive
2. Max 8 words
3. Should reflect the content/purpose
4. Use appropriate emojis if suitable (📋 📖 🔧 ⚙️ 🏗️ 🔌 etc.)
5. Make it engaging but professional

Return ONLY the title, nothing else."""

        response = await self._generate_content_async(title_prompt, temperature=0.3, max_tokens=50)
        # Clean up the response
        title = response.strip().strip('"').strip("'")
        
        # Fallback if AI response is invalid
        if not title or len(title) > 100:
            title = f"📋 {page_id.replace('_', ' ').replace('-', ' ').title()}"
        
        return title

    def _parse_wiki_structure(self, ai_response: str) -> WikiStructure:
        """Parse AI response into WikiStructure object - EXACT SAME AS original"""
        try:
            import xml.etree.ElementTree as ET
            
            # Clean the response
            xml_content = ai_response.strip()
            if xml_content.startswith('```xml'):
                xml_content = xml_content[6:]
            if xml_content.endswith('```'):
                xml_content = xml_content[:-3]
            xml_content = xml_content.strip()
            
            root = ET.fromstring(xml_content)
            
            # Extract basic info
            title = root.find('title').text if root.find('title') is not None else "Repository Wiki"
            description = root.find('description').text if root.find('description') is not None else ""
            
            # Parse pages
            pages = []
            pages_element = root.find('pages')
            if pages_element is not None:
                for page_element in pages_element.findall('page'):
                    page_id = page_element.get('id', f'page_{len(pages)}')
                    page_title = page_element.get('title', 'Untitled Page')
                    
                    # Extract file paths
                    file_paths = []
                    relevant_files = page_element.find('relevant_files')
                    if relevant_files is not None:
                        for file_element in relevant_files.findall('file_path'):
                            if file_element.text:
                                file_paths.append(file_element.text)
                    
                    # Extract related pages
                    related_pages = []
                    related_element = page_element.find('related_pages')
                    if related_element is not None:
                        for related in related_element.findall('related'):
                            if related.text:
                                related_pages.append(related.text)
                    
                    # Extract importance
                    importance_str = page_element.get('importance', 'medium')
                    importance = {'high': 5, 'medium': 3, 'low': 1}.get(importance_str, 3)
                    
                    page = WikiPage(
                        id=page_id,
                        title=page_title,
                        file_paths=file_paths,
                        importance=importance,
                        related_pages=related_pages
                    )
                    pages.append(page)
            
            # Parse sections (if present)
            sections = []
            sections_element = root.find('sections')
            if sections_element is not None:
                for section_element in sections_element.findall('section'):
                    section_id = section_element.get('id', f'section_{len(sections)}')
                    section_title = section_element.get('title', 'Untitled Section')
                    
                    # Extract page references
                    section_pages = []
                    pages_ref = section_element.find('pages')
                    if pages_ref is not None:
                        for page_ref in pages_ref.findall('page_ref'):
                            if page_ref.text:
                                section_pages.append(page_ref.text)
                    
                    section = WikiSection(
                        id=section_id,
                        title=section_title,
                        pages=section_pages
                    )
                    sections.append(section)
            
            structure =  WikiStructure(
                title=title,
                description=description,
                pages=pages,
                sections=sections
            )
            #validate if its right or nuhh :(
            structure = self._validate_wiki_structure(structure)
            return structure

            
        except Exception as e:
            print(f"Error parsing wiki structure: {e}")
            # Fallback structure
            return WikiStructure(
                title="Repository Documentation",
                description="Comprehensive documentation for this repository",
                pages=[
                    WikiPage(id="overview", title="📋 Overview", importance=5),
                    WikiPage(id="architecture", title="🏗️ Architecture", importance=4),
                    WikiPage(id="setup", title="⚙️ Setup Guide", importance=4),
                    WikiPage(id="api", title="🔌 API Reference", importance=3)
                ]
            )
