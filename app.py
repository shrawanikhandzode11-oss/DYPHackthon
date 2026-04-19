from flask import Flask, request, jsonify
from flask_cors import CORS
import requests
import base64
import re
import os
import ast
import io
import zipfile
from datetime import datetime, timezone

def github_headers(token_override=None, raw=False):
    headers = {
        "User-Agent": "RepoNavigator/1.0",
        "Accept": "application/vnd.github.v3.raw" if raw else "application/vnd.github+json"
    }
    token = (token_override or os.getenv("GITHUB_TOKEN", "")).strip()
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers

def get_commit_history(owner, repo, file_path, token_override=None):
    # Create cache key for this file's commit history
    cache_key = f"{owner}/{repo}/{file_path}"
    
    # Check cache first
    if cache_key in commit_cache:
        return commit_cache[cache_key]
    
    try:
        url = f"https://api.github.com/repos/{owner}/{repo}/commits?path={file_path}&per_page=1"
        res = requests.get(url, timeout=8, headers=github_headers(token_override=token_override))

        if res.status_code == 200:
            commits = []
            for c in res.json():
                commits.append({
                    "message": c["commit"]["message"],
                    "author": c["commit"]["author"]["name"],
                    "date": c["commit"]["author"]["date"]
                })
            
            # Cache the result
            commit_cache[cache_key] = commits
            return commits
        elif res.status_code in [401, 403]:
            # Private repository or token issue
            if not token_override:
                return [{
                    "message": "Private repository - requires authentication",
                    "author": "Authentication Required",
                    "date": None
                }]
    except Exception as e:
        print(f"Error fetching commits for {file_path}: {e}")
        pass

    # Cache empty result to avoid repeated failed requests
    commit_cache[cache_key] = []
    return []

def parse_iso_datetime(date_str):
    """Parse GitHub ISO datetime safely."""
    try:
        return datetime.fromisoformat(date_str.replace("Z", "+00:00"))
    except:
        return None

def get_stability(commit_count):
    """Map commit count to stability level."""
    if commit_count >= 5:
        return "unstable"
    if commit_count >= 3:
        return "watch"
    return "stable"

def build_evolution_summary(name, commits, is_orphan_candidate=False):
    """Generate architecture evolution hints using recent commits."""
    now = datetime.now(timezone.utc)
    dates = []
    for commit in commits:
        dt = parse_iso_datetime(commit.get("date", ""))
        if dt:
            dates.append(dt)

    recent_changes = [d for d in dates if (now - d).days <= 21]
    very_recent = any((now - d).days <= 5 for d in dates)

    if is_orphan_candidate and not dates:
        return "This module appears isolated and has no recent evolution signals. It may be deprecated or unused."
    if very_recent and len(dates) <= 2:
        return "This module looks newly active and may represent a recently added architectural component."
    if len(recent_changes) >= 3:
        return "This module has been modified frequently and may be unstable due to ongoing refactors."
    if len(dates) >= 4:
        return "This module has regular change activity and should be monitored during major releases."
    if not dates:
        return "No recent commit activity detected for this module."
    return "This module shows low-to-moderate change frequency and appears relatively stable."

def fetch_repo_files_from_zip(owner, repo_name, token_override=None):
    """Fallback live data source when GitHub API is rate-limited."""
    branches_to_try = ["main", "master"]
    code_extensions = ['.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.cpp', '.c', '.go', '.rb', '.php', '.swift', '.cs']

    for branch in branches_to_try:
        try:
            zip_url = f"https://codeload.github.com/{owner}/{repo_name}/zip/refs/heads/{branch}"
            zip_res = requests.get(zip_url, timeout=20, headers=github_headers(token_override=token_override))
            if zip_res.status_code != 200:
                continue

            files = []
            with zipfile.ZipFile(io.BytesIO(zip_res.content)) as zf:
                for info in zf.infolist():
                    if info.is_dir():
                        continue
                    path = info.filename
                    name = os.path.basename(path)
                    if not any(name.endswith(ext) for ext in code_extensions):
                        continue
                    try:
                        raw = zf.read(info).decode("utf-8", errors="ignore")
                    except:
                        raw = ""

                    files.append({
                        "name": name,
                        "path": path,
                        "content": raw
                    })

            if files:
                return files[:40]
        except:
            continue

    return []
app = Flask(__name__)
CORS(app)
    
# Cache to reduce GitHub API calls
repo_cache = {}
commit_cache = {}  # Cache for commit history to avoid duplicate requests

def get_file_extension(name):
    """Get file extension"""
    return os.path.splitext(name)[1].lower()

def extract_python_functions(content):
    """Extract function definitions and calls from Python code"""
    functions = []
    calls = set()
    
    try:
        tree = ast.parse(content)
        
        # Extract function definitions
        for node in ast.walk(tree):
            if isinstance(node, ast.FunctionDef):
                functions.append({
                    "name": node.name,
                    "line": node.lineno,
                    "type": "function"
                })
            elif isinstance(node, ast.Call):
                # Extract function calls
                if isinstance(node.func, ast.Name):
                    calls.add(node.func.id)
                elif isinstance(node.func, ast.Attribute):
                    calls.add(node.func.attr)
    except:
        pass
    
    return functions, list(calls)

def extract_javascript_functions(content):
    """Extract function definitions and calls from JavaScript/TypeScript"""
    functions = []
    calls = set()
    
    try:
        # Function declarations: function foo() or const foo = () =>
        func_defs = re.findall(r'(?:function|const|let|var)\s+(\w+)\s*(?:=\s*(?:async\s*)?\(.*?\)|{|\()', content)
        for func_name in func_defs:
            if func_name and len(func_name) > 2:  # Filter out keywords
                functions.append({
                    "name": func_name,
                    "type": "function"
                })
        
        # Function calls: foo() or this.foo() or obj.foo()
        call_pattern = r'[\w$.]+\s*\(\s*(?:[^()]*|\([^()]*\))*\s*\)'
        call_matches = re.findall(r'(\w+)\s*\(', content)
        calls = set(call_matches)
        
    except:
        pass
    
    return functions, list(calls)

def extract_function_calls(content, language="javascript"):
    """Extract function definitions and calls based on language"""
    if language == "python":
        return extract_python_functions(content)
    else:  # Default to JavaScript
        return extract_javascript_functions(content)

def detect_type(name, content_snippet=""):
    """Detect file type based on naming patterns and content"""
    name_lower = name.lower()
    
    # Check file extension first
    if name.endswith(('.test.js', '.spec.js', '.test.ts', '.spec.ts', '.test.py', '.spec.py')):
        return "test"
    if name.endswith(('.min.js', '.min.css')):
        return "util"
    
    # Check name patterns
    if any(x in name_lower for x in ["index", "app", "server", "main", "entry", "bootstrap"]):
        return "entry"
    if any(x in name_lower for x in ["service", "provider", "controller", "handler"]):
        return "service"
    if any(x in name_lower for x in ["config", "env", "settings", "constants", "config"]):
        return "config"
    if any(x in name_lower for x in ["test", "spec", "mock"]):
        return "test"
    if any(x in name_lower for x in ["util", "helper", "lib", "utils", "tool"]):
        return "util"
    
    return "util"

def get_risk_score(name, size=0):
    """Calculate risk score based on file characteristics"""
    risk = 1
    name_lower = name.lower()
    
    if any(x in name_lower for x in ["auth", "security", "payment", "config", "database"]):
        risk = 3
    elif any(x in name_lower for x in ["server", "api", "controller", "service"]):
        risk = 2
    elif size > 15000:  # Large file
        risk = 2
    
    return risk

def generate_summary(name, file_type, content_snippet=""):
    """Generate intelligent summary based on file type and name"""
    name_lower = name.lower()
    
    # Type-specific summaries
    if file_type == "entry":
        if "server" in name_lower or "main" in name_lower:
            return "Application entry point initializing core services, middleware, and server configuration. Serves as the bootstrap point for the entire system."
        elif "app" in name_lower or "index" in name_lower:
            return "Main application component managing global state, routing, and layout structure. Serves as the root entry point for user interface."
        else:
            return "Application entry point managing initialization, configuration setup, and service bootstrap."
    
    elif file_type == "service":
        if "auth" in name_lower:
            return "Authentication and authorization service handling user credentials, session management, and permission validation."
        elif "api" in name_lower or "controller" in name_lower:
            return "API controller or service handling business logic, data processing, and request/response management."
        elif "database" in name_lower or "model" in name_lower:
            return "Data model and database service managing entity schemas, queries, and persistence operations."
        else:
            return "Business logic service handling core application functionalities and data transformations."
    
    elif file_type == "util":
        if "helper" in name_lower or "utils" in name_lower:
            return "Utility functions collection providing reusable helpers for common operations like formatting, validation, and transformation."
        elif "validator" in name_lower:
            return "Validation utility providing functions for input validation, error checking, and data sanitization."
        elif "config" in name_lower or "settings" in name_lower:
            return "Configuration management providing environment variables, settings, and configuration values."
        else:
            return "Utility module providing shared functions and helper utilities across the application."
    
    elif file_type == "config":
        return "Configuration and settings file defining application constants, environment variables, and global configuration."
    
    elif file_type == "test":
        return "Unit tests and test specifications validating functionality, edge cases, and error handling scenarios."
    
    return f"{file_type.capitalize()} module handling application logic and data processing."

def extract_imports(file_content, file_name="", all_files=None):
    """Extract imports/dependencies from file content with accurate parsing"""
    deps = []
    
    try:
        # Try to decode if it's base64 (GitHub API returns base64 encoded content)
        if isinstance(file_content, str):
            try:
                decoded = base64.b64decode(file_content).decode('utf-8')
            except:
                decoded = file_content
        else:
            decoded = file_content
        
        # JavaScript/TypeScript imports - more comprehensive patterns
        js_patterns = [
            r"import\s+.*?\s+from\s+['\"]([^'\"]+)['\"]",  # import ... from 'module'
            r"import\s+['\"]([^'\"]+)['\"]",                    # import 'module'
            r"require\s*\(\s*['\"]([^'\"]+)['\"]\s*\)",      # require('module')
            r"import\s*\(\s*['\"]([^'\"]+)['\"]\s*\)",      # import('module')
        ]
        
        js_imports = []
        for pattern in js_patterns:
            matches = re.findall(pattern, decoded, re.MULTILINE)
            js_imports.extend(matches)
        
        # Clean up JavaScript imports - remove relative paths and node_modules
        js_imports = [imp for imp in js_imports if imp and not imp.startswith('.') and not imp.startswith('/')]
        
        # Python imports - more comprehensive patterns
        py_patterns = [
            r"from\s+([a-zA-Z_][\w]*)\s+import",                   # from module import
            r"import\s+([a-zA-Z_][\w]*)",                          # import module
            r"from\s+([a-zA-Z_][\w]*\.[a-zA-Z_][\w]*)\s+import", # from module.sub import
        ]
        
        py_imports = []
        for pattern in py_patterns:
            matches = re.findall(pattern, decoded, re.MULTILINE)
            py_imports.extend(matches)
        
        # Clean up Python imports - split on dots to get base module names
        py_imports = [imp.split('.')[0] for imp in py_imports if imp]
        
        all_deps = list(set(js_imports + py_imports))
        
        # If we have a list of all files in the repo, try to match imports to actual files
        if all_files:
            matched_deps = []
            for dep in all_deps:
                dep_lower = dep.lower()
                for file_info in all_files:
                    file_name = file_info.get('name', '').lower()
                    # Try to match import to actual file name
                    if (dep_lower == file_name or 
                        dep_lower in file_name or 
                        file_name.startswith(dep_lower) or 
                        dep_lower.replace('_', '') == file_name.replace('_', '') or
                        dep_lower.replace('-', '') == file_name.replace('-', '')):
                        matched_deps.append(file_info.get('name', file_name))
            deps = matched_deps
        else:
            deps = all_deps
        
        # Filter out standard library and common third-party packages
        standard_libs = {
            'fs', 'path', 'os', 'sys', 'json', 'http', 'https', 'url', 'util', 'events', 'stream',
            'crypto', 'buffer', 'child_process', 'cluster', 'dgram', 'dns', 'net', 'readline',
            'repl', 'tls', 'tty', 'zlib', 'assert', 'console', 'module', 'process', 'timers',
            'collections', 'datetime', 'math', 'random', 'string', 'itertools', 'functools',
            'operator', 're', 'json', 'urllib', 'http', 'socket', 'ssl', 'hashlib', 'hmac',
            'time', 'threading', 'multiprocessing', 'subprocess', 'queue', 'asyncio',
            'react', 'vue', 'angular', 'lodash', 'underscore', 'jquery', 'axios', 'express',
            'mongoose', 'pg', 'mysql', 'redis', 'cors', 'helmet', 'morgan', 'body-parser'
        }
        
        deps = [d for d in deps if d and len(d) > 1 and d.lower() not in standard_libs]
        
    except Exception as e:
        print(f"Error extracting imports: {e}")
        pass
    
    return deps[:10]  # Limit to 10 imports for performance


@app.route("/analyze", methods=["POST"])
def analyze():
    try:
        payload = request.get_json(silent=True) or {}
        repo_url = payload.get("repo", "").strip()
        github_token = payload.get("githubToken", "").strip()
        
        if not repo_url:
            return jsonify({"error": "Repository URL required"}), 400
        
        # Parse GitHub URL
        try:
            # Handle various GitHub URL formats
            url_clean = repo_url.replace("https://github.com/", "").replace("https://", "").replace("github.com/", "").replace(".git", "")
            parts = url_clean.split("/")
            owner = parts[0]
            repo_name = parts[1]
        except:
            return jsonify({"error": "Invalid GitHub URL format. Use: github.com/owner/repo"}), 400
        
        # Check cache first
        cache_key = f"{owner}/{repo_name}"
        if cache_key in repo_cache:
            return jsonify(repo_cache[cache_key])
        
        nodes = []
        file_map = {}  # Map file names to node IDs
        all_functions = {}  # Store functions from each file

        # Fetch repository metadata to get default branch
        repo_api = f"https://api.github.com/repos/{owner}/{repo_name}"
        repo_res = requests.get(repo_api, timeout=10, headers=github_headers(token_override=github_token))
        use_zip_fallback = False
        all_files = []

        if repo_res.status_code == 403:
            # Rate limited or private repo - try zip fallback first
            use_zip_fallback = True
        elif repo_res.status_code == 404:
            return jsonify({"error": f"Repository '{owner}/{repo_name}' not found. Please verify the repository URL and ensure you have access to private repositories if applicable."}), 404
        elif repo_res.status_code == 401:
            if github_token:
                return jsonify({"error": f"Invalid GitHub token or insufficient permissions. Please check your token and ensure it has 'repo' scope."}), 401
            else:
                use_zip_fallback = True
        elif repo_res.status_code != 200:
            use_zip_fallback = True
        else:
            repo_info = repo_res.json()
            default_branch = repo_info.get("default_branch", "main")

            # Fetch full recursive tree for reliable file discovery
            tree_api = f"https://api.github.com/repos/{owner}/{repo_name}/git/trees/{default_branch}?recursive=1"
            tree_res = requests.get(tree_api, timeout=15, headers=github_headers(token_override=github_token))

            if tree_res.status_code == 200:
                tree_data = tree_res.json()
                tree_items = tree_data.get("tree", [])
                all_files = [{"name": os.path.basename(item.get("path", "")), "path": item.get("path", "")}
                             for item in tree_items
                             if item.get("type") == "blob" and item.get("path")]
            else:
                use_zip_fallback = True
        
        if use_zip_fallback or not all_files:
            all_files = fetch_repo_files_from_zip(owner, repo_name, github_token)
            if not all_files:
                # If zip fallback fails and we didn't have a token, suggest using one
                if not github_token:
                    return jsonify({"error": f"Unable to access repository '{owner}/{repo_name}'. This may be due to GitHub API rate limits or private repository access. Try providing a GitHub Personal Access Token."}), 403
                else:
                    return jsonify({"error": "Unable to read repository files (API limited and zip fallback failed)."}), 502
        
        # Filter only relevant code files
        code_extensions = ['.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.cpp', '.c', '.go', '.rb', '.php', '.swift', '.cs']
        files = [f for f in all_files if any(f.get('name', '').endswith(ext) for ext in code_extensions)]
        
        # Limit to 40 files for performance
        files = files[:40]
        
        # First pass: create all nodes and extract functions
        for i, file in enumerate(files):
            name = file["name"]
            size = file.get('size', 0)
            file_type = detect_type(name)
            risk = get_risk_score(name, size)
            
            # Fetch file content to extract functions
            functions = []
            function_calls = []
            if file.get('content'):
                try:
                    content = file.get('content', '')
                    language = "python" if name.endswith('.py') else "javascript"
                    functions, function_calls = extract_function_calls(content, language)
                except:
                    pass
            elif file.get('path'):
                try:
                    file_contents_url = f"https://api.github.com/repos/{owner}/{repo_name}/contents/{file['path']}"
                    file_res = requests.get(file_contents_url, timeout=8, headers=github_headers(token_override=github_token, raw=True))
                    if file_res.status_code == 200:
                        content = file_res.text
                        # Determine language
                        language = "python" if name.endswith('.py') else "javascript"
                        functions, function_calls = extract_function_calls(content, language)
                except:
                    pass
            
            # Always fetch commit history for every file to get real lastModified and author
            commits = get_commit_history(owner, repo_name, file["path"], github_token)
            all_functions[str(i)] = {
                "fileName": name,
                "functions": functions,
                "calls": function_calls
            }
            
            node = {
                "id": str(i),
                "name": name,
                "type": file_type,
                "risk": risk,
                "deps": [],
                "summary": generate_summary(name, file_type),
                "functions": functions[:10],  # Include top 10 functions
                "callCount": len(function_calls),
                "commits": commits,
                "lastModified": commits[0]["date"] if commits else None,
                "lastAuthor": commits[0]["author"] if commits else "No commit info",
                "commitCount": len(commits),
                "stability": get_stability(len(commits)),
                "isUnstable": len(commits) >= 5
            }
            
            nodes.append(node)
            file_map[name.lower()] = str(i)
        
        # Second pass: extract dependencies and link nodes
        for i, file in enumerate(files):
            deps_indices = set()
            
            # Try to fetch file content and extract imports
            if file.get('content'):
                try:
                    imports = extract_imports(file.get('content', ''), file['name'], files)
                    # Now imports should be actual file names, so we can map directly
                    for imp in imports:
                        imp_lower = imp.lower()
                        for j, other_file in enumerate(files):
                            if i != j:  # Don't self-reference
                                other_name_lower = other_file['name'].lower()
                                # Direct file name matching
                                if imp_lower == other_name_lower or imp_lower.replace('_', '') == other_name_lower.replace('_', ''):
                                    deps_indices.add(str(j))
                except:
                    pass
            elif file.get('path'):
                try:
                    file_contents_url = f"https://api.github.com/repos/{owner}/{repo_name}/contents/{file['path']}"
                    file_res = requests.get(file_contents_url, timeout=8, headers=github_headers(token_override=github_token, raw=True))
                    if file_res.status_code == 200:
                        imports = extract_imports(file_res.text, file['name'], files)
                        
                        # Match imports to files in repo
                        for imp in imports:
                            imp_lower = imp.lower()
                            for j, other_file in enumerate(files):
                                if i != j:  # Don't self-reference
                                    other_name_lower = other_file['name'].lower()
                                    # Direct file name matching
                                    if imp_lower == other_name_lower or imp_lower.replace('_', '') == other_name_lower.replace('_', ''):
                                        deps_indices.add(str(j))
                except:
                    pass
            
            # Heuristic linking: entry points depend on services, services depend on utils
            file_type = detect_type(files[i]['name'])
            if file_type == "entry" or file_type == "service":
                for j in range(i + 1, min(i + 4, len(files))):
                    other_type = detect_type(files[j]['name'])
                    if file_type == "entry" and other_type in ["service", "util"]:
                        deps_indices.add(str(j))
                    elif file_type == "service" and other_type in ["util", "config"]:
                        deps_indices.add(str(j))
            
            nodes[i]["deps"] = list(deps_indices)

        # Third pass: derive incoming edges and architecture evolution hints
        incoming_count = {node["id"]: 0 for node in nodes}
        outgoing_count = {node["id"]: len(node.get("deps", [])) for node in nodes}

        for node in nodes:
            for dep in node.get("deps", []):
                incoming_count[dep] = incoming_count.get(dep, 0) + 1

        now = datetime.now(timezone.utc)
        for node in nodes:
            commits = node.get("commits", [])
            last_modified = parse_iso_datetime(node.get("lastModified", "")) if node.get("lastModified") else None
            node["incomingDeps"] = incoming_count.get(node["id"], 0)
            node["outgoingDeps"] = outgoing_count.get(node["id"], 0)
            node["isOrphan"] = node["incomingDeps"] == 0 and node["outgoingDeps"] == 0
            node["isNewModule"] = bool(last_modified and (now - last_modified).days <= 7 and len(commits) <= 2)
            node["isRefactoredOften"] = len(commits) >= 4
            node["evolutionSummary"] = build_evolution_summary(node["name"], commits, node["isOrphan"])
        
        # Build response with both file-level and function-level data
        response_data = {
            "nodes": nodes,
            "callGraph": all_functions,  # Include function call graph
            "sourceMode": "zip-fallback" if use_zip_fallback else "github-api"
        }
        
        # Cache and return
        repo_cache[cache_key] = response_data
        return jsonify(response_data)
    
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    app.run(debug=True, port=5000)