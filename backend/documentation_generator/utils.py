import os
import subprocess
import glob
from typing import List, Dict, Any
from datetime import datetime
from pathlib import Path

import zipfile
import shutil
from pathlib import Path


# Use absolute imports to avoid relative import issues
try:
    from structures import WikiPage, WikiStructure, Document, RepositoryAnalysis
except ImportError:
    # Fallback for when running as part of a package
    from .structures import WikiPage, WikiStructure, Document, RepositoryAnalysis

def count_tokens(text: str) -> int:
    """Count tokens in text"""
    try:
        import tiktoken
        encoding = tiktoken.get_encoding("cl100k_base")
        return len(encoding.encode(text))
    except:
        return len(text) // 4

def download_repo(repo_url: str, local_path: str) -> str:
    """Download repository from URL or use existing one"""

    local_path = Path(local_path)

    if local_path.exists() and any(local_path.iterdir()):
        return f"Using existing repo at {local_path.resolve()}"

    local_path.mkdir(parents=True, exist_ok=True)

    try:
        result = subprocess.run(
            ["git", "clone", repo_url, str(local_path)],
            capture_output=True, text=True, check=True
        )
        return result.stdout
    except subprocess.CalledProcessError as e:
        return f"Git clone failed:\n{e.stderr}"

def setup_repository_from_zip(zip_path: str, extract_to: str) -> str:
    """
    Unzips a repository archive and flattens the directory structure
    by removing the top-level parent folder if one exists.
    """
    zip_p = Path(zip_path)
    extract_p = Path(extract_to)

    if not zip_p.is_file():
        raise FileNotFoundError(f"The specified zip file was not found: {zip_path}")

    # Ensure a clean extraction destination
    if extract_p.exists():
        shutil.rmtree(extract_p)
    
    extract_p.mkdir(parents=True, exist_ok=True)

    try:
        with zipfile.ZipFile(zip_p, 'r') as zip_ref:
            zip_ref.extractall(extract_p)

        # Check if the zip extracted into a single sub-directory (e.g., temp_repo/repo-name/)
        items_in_extract_dir = list(extract_p.iterdir())
        if len(items_in_extract_dir) == 1 and items_in_extract_dir[0].is_dir():
            # This is the single sub-directory (e.g., /path/to/temp_repo/repo-name)
            inner_dir = items_in_extract_dir[0]
            
            # Move all contents from the inner directory up to the parent (extract_p)
            for item in inner_dir.iterdir():
                shutil.move(str(item), str(extract_p))
            
            # Remove the now-empty inner directory
            inner_dir.rmdir()

        return f"✅ Successfully unzipped and flattened repository to {extract_p.resolve()}"

    except zipfile.BadZipFile:
        raise zipfile.BadZipFile(f"Error: The file at {zip_path} is not a valid zip file.")
    except Exception as e:
        raise IOError(f"An unexpected error occurred during unzipping: {e}")

def read_files_for_graph(repo_path: str) -> List[Dict[str, Any]]:
    """
    Read files from a repository in the format expected by GraphGenerator.
    
    This function returns a list of dicts with 'path', 'content', and 'full_path'
    keys, which is what GraphGenerator expects for parsing.
    
    Args:
        repo_path: Path to the repository root
        
    Returns:
        List of file dictionaries for GraphGenerator
    """
    files = []
    repo_root = Path(repo_path).resolve()
    
    # Extensions that GraphGenerator can parse
    parseable_extensions = {
        ".py", ".js", ".jsx", ".ts", ".tsx", ".ipynb"
    }
    
    # Directories to skip
    skip_dirs = {
        '.git', 'node_modules', '__pycache__', '.venv', 'venv', 
        'env', '.env', 'dist', 'build', '.next', '.cache',
        'coverage', '.nyc_output', '.pytest_cache'
    }
    
    for root, dirs, filenames in os.walk(repo_root):
        # Filter out skip directories
        dirs[:] = [d for d in dirs if d not in skip_dirs and not d.startswith('.')]
        
        for filename in filenames:
            file_ext = Path(filename).suffix.lower()
            if file_ext not in parseable_extensions:
                continue
            
            full_path = Path(root) / filename
            
            try:
                content = full_path.read_text(encoding='utf-8', errors='ignore')
                
                # Skip empty or very small files
                if len(content.strip()) < 10:
                    continue
                
                # Get relative path from repo root
                try:
                    relative_path = full_path.relative_to(repo_root)
                except ValueError:
                    relative_path = full_path.name
                
                files.append({
                    "path": str(relative_path).replace("\\", "/"),
                    "content": content,
                    "full_path": str(full_path)
                })
                
            except Exception as e:
                print(f"Warning: Could not read {full_path}: {e}")
    
    return files


def read_documents(path: str, max_tokens: int = 8000) -> List[Document]:
    """Read documents from directory"""
    documents = []
    extensions = [".py", ".js", ".ts", ".md", ".txt", ".json", ".yaml", ".yml", 
                ".java", ".cpp", ".c", ".go", ".rs", ".php", ".html", ".css", 
                ".jsx", ".tsx", ".vue", ".svelte", ".rb", ".swift", ".kt"]    
    for ext in extensions:
        for file_path in glob.glob(f"{path}/**/*{ext}", recursive=True):
            if any(skip in file_path for skip in ['.git', 'node_modules', '__pycache__']):
                continue
            
            try:
                with open(file_path, 'r', encoding='utf-8') as f:
                    content = f.read()
                    if len(content.strip()) > 10:  # Skip empty files
                        doc = Document(
                            text=content,
                            meta_data={
                                "file_path": file_path,
                                "type": ext[1:],  # Remove the dot
                                "size": len(content)
                            }
                        )
                        documents.append(doc)
            except Exception as e:
                print(f"Error reading {file_path}: {e}")
    
    return documents

def chunk_documents(documents: List[Document], chunk_size: int = 1000, overlap: int = 200) -> List[Document]:
    """Chunk documents for processing"""
    chunked_docs = []
    
    for doc in documents:
        text = doc.text
        if len(text) <= chunk_size:
            chunked_docs.append(doc)
            continue
            
        for i in range(0, len(text), chunk_size - overlap):
            chunk_text = text[i:i + chunk_size]
            if len(chunk_text.strip()) < 50:
                continue
                
            chunk_doc = Document(
                text=chunk_text,
                meta_data={
                    **doc.meta_data,
                    "chunk_index": len(chunked_docs),
                    "parent_file": doc.meta_data.get("file_path", "unknown"),
                    "chunk_start": i,
                    "chunk_end": i + len(chunk_text)
                }
            )
            chunked_docs.append(chunk_doc)
    
    return chunked_docs

def save_wiki_files(pages: List[WikiPage], structure: WikiStructure, 
                   output_dir: str, analysis: RepositoryAnalysis) -> Dict[str, Any]:
    """Save wiki files to directory"""
    os.makedirs(output_dir, exist_ok=True)
    
    # Save individual pages
    for page in pages:
        filename = f"{page.id}.md"
        filepath = os.path.join(output_dir, filename)
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(page.content)
    
    # Generate and save index
    index_content = generate_index_page(structure, pages, analysis)
    index_path = os.path.join(output_dir, "README.md")
    with open(index_path, 'w', encoding='utf-8') as f:
        f.write(index_content)
    
    return {
        "status": "success",
        "total_pages": len(pages),
        "output_directory": output_dir,
        "pages": [{"id": p.id, "title": p.title, "file": f"{p.id}.md"} for p in pages]
    }

def generate_index_page(structure: WikiStructure, pages: List[WikiPage], 
                       analysis: RepositoryAnalysis) -> str:
    """Generate index page content"""
    content = f"""# 📚 {structure.title}

{structure.description}

## 📊 Repository Analysis

- **Domain Type**: {analysis.domain_type}
- **Complexity Score**: {analysis.complexity_score}/10
- **Languages**: {len(analysis.languages)} ({', '.join(list(analysis.languages.keys())[:3])})
- **Frameworks**: {len(analysis.frameworks)} ({', '.join(analysis.frameworks[:3])})
- **Total Pages**: {len(pages)}

## 📖 Documentation Pages

"""
    
    for page in pages:
        content += f"- [{page.title}]({page.id}.md)\n"
    
    content += f"""

---

*Generated on {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}*
"""
    
    return content